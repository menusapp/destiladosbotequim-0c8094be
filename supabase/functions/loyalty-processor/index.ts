import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-token',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId, restaurantId } = await req.json();
    
    console.log('[Loyalty] Processing order:', orderId, 'for restaurant:', restaurantId);

    if (!orderId || !restaurantId) {
      console.error('[Loyalty] Missing orderId or restaurantId');
      return new Response(
        JSON.stringify({ error: 'Missing orderId or restaurantId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Buscar dados do pedido
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        id,
        customer_cpf,
        customer_name,
        restaurant_id,
        order_items (
          quantity,
          price_at_order,
          order_item_extras (
            price_at_order
          )
        )
      `)
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('[Loyalty] Order not found:', orderError);
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[Loyalty] Order found:', { 
      id: order.id, 
      customer_cpf: order.customer_cpf, 
      customer_name: order.customer_name 
    });

    // 2. Calcular valor total do pedido
    let orderTotal = 0;
    for (const item of order.order_items || []) {
      const extrasSum = (item.order_item_extras || []).reduce(
        (sum: number, extra: any) => sum + (extra.price_at_order || 0), 
        0
      );
      orderTotal += (item.price_at_order + extrasSum) * item.quantity;
    }
    console.log('[Loyalty] Order total calculated:', orderTotal);

    // 3. Buscar programa de fidelidade ativo
    const { data: program, error: programError } = await supabase
      .from('loyalty_programs')
      .select(`
        id,
        name,
        type,
        loyalty_program_rewards (
          id,
          trigger_value,
          reward_type,
          reward_value,
          reward_product_id,
          description
        )
      `)
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle();

    if (programError) {
      console.error('[Loyalty] Error fetching program:', programError);
      return new Response(
        JSON.stringify({ error: 'Error fetching loyalty program' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!program) {
      console.log('[Loyalty] No active loyalty program found');
      return new Response(
        JSON.stringify({ message: 'No active loyalty program' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[Loyalty] Active program found:', { 
      id: program.id, 
      name: program.name, 
      type: program.type,
      rewards: program.loyalty_program_rewards?.length || 0
    });

    // 4. Buscar ou criar progresso do cliente
    const { data: existingProgress, error: progressError } = await supabase
      .from('customer_loyalty_progress')
      .select('*')
      .eq('customer_cpf', order.customer_cpf)
      .eq('program_id', program.id)
      .maybeSingle();

    if (progressError) {
      console.error('[Loyalty] Error fetching progress:', progressError);
    }

    let customerProgress;
    
    if (existingProgress) {
      console.log('[Loyalty] Existing progress found:', existingProgress);
      customerProgress = existingProgress;
    } else {
      // Criar novo registro de progresso
      const { data: newProgress, error: createError } = await supabase
        .from('customer_loyalty_progress')
        .insert({
          customer_cpf: order.customer_cpf,
          restaurant_id: restaurantId,
          program_id: program.id,
          purchase_count: 0,
          total_spent: 0,
          last_reward_trigger: 0,
        })
        .select()
        .single();

      if (createError) {
        console.error('[Loyalty] Error creating progress:', createError);
        return new Response(
          JSON.stringify({ error: 'Error creating customer progress' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[Loyalty] New progress created:', newProgress);
      customerProgress = newProgress;
    }

    // 5. Atualizar progresso baseado no tipo de programa
    const newPurchaseCount = (customerProgress.purchase_count || 0) + 1;
    const newTotalSpent = (customerProgress.total_spent || 0) + orderTotal;

    const { error: updateError } = await supabase
      .from('customer_loyalty_progress')
      .update({
        purchase_count: newPurchaseCount,
        total_spent: newTotalSpent,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerProgress.id);

    if (updateError) {
      console.error('[Loyalty] Error updating progress:', updateError);
      return new Response(
        JSON.stringify({ error: 'Error updating customer progress' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[Loyalty] Progress updated:', { newPurchaseCount, newTotalSpent });

    // 6. Verificar se cliente atingiu alguma recompensa
    const currentValue = program.type === 'purchases' ? newPurchaseCount : newTotalSpent;
    const lastTrigger = customerProgress.last_reward_trigger || 0;
    
    const rewards = (program.loyalty_program_rewards || []).sort(
      (a: any, b: any) => a.trigger_value - b.trigger_value
    );

    let triggeredReward = null;
    for (const reward of rewards) {
      // Verificar se esta recompensa foi atingida e ainda não foi resgatada
      if (reward.trigger_value > lastTrigger && currentValue >= reward.trigger_value) {
        triggeredReward = reward;
        break; // Pegar apenas a primeira recompensa não resgatada
      }
    }

    if (triggeredReward) {
      console.log('[Loyalty] Reward triggered!', triggeredReward);

      // Security check: verify this reward hasn't been redeemed already (all-time)
      const { data: existingRedemption } = await supabase
        .from('loyalty_reward_redemptions')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('customer_cpf', order.customer_cpf)
        .eq('program_id', program.id)
        .eq('reward_id', triggeredReward.id)
        .maybeSingle();

      if (existingRedemption) {
        console.log('[Loyalty] Reward already redeemed, skipping:', triggeredReward.id);
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Reward already redeemed',
            progress: { purchase_count: newPurchaseCount, total_spent: newTotalSpent }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Atualizar last_reward_trigger
      await supabase
        .from('customer_loyalty_progress')
        .update({ 
          last_reward_trigger: triggeredReward.trigger_value,
          updated_at: new Date().toISOString(),
        })
        .eq('id', customerProgress.id);

      // Gerar cupom automático baseado no tipo de recompensa
      let couponPayload: any = {
        restaurant_id: restaurantId,
        code: `FIDELIDADE${order.customer_cpf.slice(-4)}${Date.now().toString().slice(-4)}`.toUpperCase(),
        is_active: true,
        usage_limit: 1,
        usage_limit_per_user: 1,
        used_count: 0,
        min_order_value: 0,
        valid_from: new Date().toISOString(),
        // Válido por 30 dias
        valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };

      switch (triggeredReward.reward_type) {
        case 'discount_percentage':
          couponPayload.coupon_type = 'discount';
          couponPayload.discount_type = 'percentage';
          couponPayload.discount_value = triggeredReward.reward_value || 10;
          break;
        case 'discount_fixed':
          couponPayload.coupon_type = 'discount';
          couponPayload.discount_type = 'fixed';
          couponPayload.discount_value = triggeredReward.reward_value || 10;
          break;
        case 'free_item':
          couponPayload.coupon_type = 'free_product';
          couponPayload.discount_type = 'fixed';
          couponPayload.discount_value = 0;
          couponPayload.target_product_id = triggeredReward.reward_product_id;
          break;
        case 'free_delivery':
          couponPayload.coupon_type = 'free_delivery';
          couponPayload.discount_type = 'fixed';
          couponPayload.discount_value = 0;
          break;
        default:
          couponPayload.coupon_type = 'discount';
          couponPayload.discount_type = 'percentage';
          couponPayload.discount_value = 10;
      }

      const { data: newCoupon, error: couponError } = await supabase
        .from('coupons')
        .insert(couponPayload)
        .select()
        .single();

      if (couponError) {
        console.error('[Loyalty] Error creating reward coupon:', couponError);
      } else {
        console.log('[Loyalty] Reward coupon created:', newCoupon);
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Loyalty updated and reward triggered',
          reward: triggeredReward,
          coupon: newCoupon?.code || null,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Loyalty progress updated',
        progress: {
          purchase_count: newPurchaseCount,
          total_spent: newTotalSpent,
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Loyalty] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

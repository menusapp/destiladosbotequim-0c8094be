import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-token',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { restaurant_id, notification_type, context } = await req.json();

    if (!restaurant_id || !notification_type) {
      return new Response(
        JSON.stringify({ error: 'restaurant_id and notification_type are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[NOTIF] Type: ${notification_type}, Restaurant: ${restaurant_id}`);

    // Check WhatsApp is connected
    const { data: waConfig } = await supabase
      .from('whatsapp_config')
      .select('enabled, instance_status, review_link_url')
      .eq('restaurant_id', restaurant_id)
      .maybeSingle();

    // Só barramos quando o dono DESLIGOU explicitamente. Se a linha de config
    // estiver ausente/desatualizada, seguimos: o whatsapp-send confere o estado
    // ao vivo na Evolution, auto-corrige o banco e decide. Antes, um banco
    // desatualizado silenciava todas as notificações mesmo conectado.
    if (waConfig && waConfig.enabled === false) {
      return new Response(
        JSON.stringify({ success: false, reason: 'whatsapp_not_connected' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get notification config
    const { data: notifConfig } = await supabase
      .from('whatsapp_notification_configs')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .eq('notification_type', notification_type)
      .maybeSingle();

    // Só respeita o DESLIGADO explícito do dono. Linha ausente (restaurante
    // criado depois dos seeds) NÃO pode silenciar as mensagens — usa o
    // template padrão. Antes: sem linha → 'notification_disabled' → nenhuma
    // mensagem de status saía, mesmo com o WhatsApp conectado.
    if (notifConfig && notifConfig.is_active === false) {
      return new Response(
        JSON.stringify({ success: false, reason: 'notification_disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const DEFAULT_TEMPLATES: Record<string, string> = {
      order_accepted: '✅ Olá {{nome}}! Seu pedido foi aceito e está sendo preparado.\n\n{{resumo_pedido}}\n\n⏱️ Tempo estimado: {{tempo_estimado}} minutos.',
      order_preparing: '👨‍🍳 Olá {{nome}}! Seu pedido #{{numero_pedido}} está em preparo!\n\n⏱️ Tempo estimado: {{tempo_estimado}} minutos.',
      order_out_for_delivery: '🚗 Olá {{nome}}! Seu pedido #{{numero_pedido}} saiu para entrega / está pronto para retirada!',
      order_ready_pickup: '📦 Olá {{nome}}! Seu pedido #{{numero_pedido}} está pronto para retirada! Aguardamos você! 😊',
      order_cancelled: '❌ Olá {{nome}}, infelizmente seu pedido #{{numero_pedido}} foi cancelado. Motivo: {{motivo}}',
      order_delivered: '🎉 Pedido #{{numero_pedido}} finalizado! Obrigado, {{nome}}! Avalie sua experiência: {{link_avaliacao}}',
    };

    const template = notifConfig?.template_message || DEFAULT_TEMPLATES[notification_type];
    if (!template) {
      return new Response(
        JSON.stringify({ success: false, reason: 'no_template' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build enriched context: if order_id is provided (or we can resolve it via numero_pedido/phone),
    // fetch items + totals and expose them as {{resumo_pedido}} and {{total_pedido}}.
    const enrichedContext: Record<string, unknown> = { ...(context || {}) };

    let orderId: string | null = (context && typeof context === 'object') ? (context as any).order_id : null;
    const numeroPedido: string | null = (context && typeof context === 'object') ? (context as any).numero_pedido : null;
    const needsSummary = template.includes('{{resumo_pedido}}') || template.includes('{{total_pedido}}');
    console.log(`[NOTIF] orderId=${orderId} numeroPedido=${numeroPedido} needsSummary=${needsSummary}`);

    // Fallback 1: resolve order_id from numero_pedido (short id 8 chars) — for callers that forget order_id
    if (needsSummary && !orderId && numeroPedido) {
      try {
        const shortId = String(numeroPedido).toLowerCase().slice(0, 8);
        const { data: resolved } = await supabase
          .from('orders')
          .select('id')
          .eq('restaurant_id', restaurant_id)
          .ilike('id', `${shortId}%`)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (resolved?.id) {
          orderId = resolved.id;
          console.log(`[NOTIF] Resolved orderId from numero_pedido: ${orderId}`);
        }
      } catch (e) {
        console.warn('[NOTIF] Failed to resolve order_id from numero_pedido:', e);
      }
    }

    // Fallback 2: resolve from recent order by phone (last 10 minutes)
    const phoneCtx: string | null = (context && typeof context === 'object')
      ? ((context as any).phone || (context as any).customer_phone || null)
      : null;
    if (needsSummary && !orderId && phoneCtx) {
      try {
        const cleanPhone = String(phoneCtx).replace(/\D/g, '');
        const lastDigits = cleanPhone.slice(-8);
        const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const { data: resolved } = await supabase
          .from('orders')
          .select('id')
          .eq('restaurant_id', restaurant_id)
          .ilike('delivery_phone', `%${lastDigits}%`)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (resolved?.id) {
          orderId = resolved.id;
          console.log(`[NOTIF] Resolved orderId from phone fallback: ${orderId}`);
        }
      } catch (e) {
        console.warn('[NOTIF] Failed to resolve order_id from phone:', e);
      }
    }

    if (needsSummary && orderId) {
      try {
        const { data: order } = await supabase
          .from('orders')
          .select('id, delivery_fee, service_fee, coupon_discount, coupon_code, delivery_address, delivery_type, order_type, notes, dd_scheduled_for')
          .eq('id', orderId)
          .maybeSingle();

        // Fetch items — retry up to 5 times with backoff (handles race when items are inserted sequentially after order)
        let items: any[] | null = null;
        const delays = [0, 800, 1500, 2500, 4000];
        for (let attempt = 0; attempt < delays.length; attempt++) {
          if (delays[attempt] > 0) {
            await new Promise((r) => setTimeout(r, delays[attempt]));
          }
          const { data } = await supabase
            .from('order_items')
            .select('quantity, price_at_order, notes, products(name), order_item_extras(price_at_order, extra_name, product_extras(name))')
            .eq('order_id', orderId);
          items = data || [];
          console.log(`[NOTIF] Items attempt ${attempt + 1}: ${items.length} items`);
          if (items.length > 0) break;
        }

        const fmt = (n: number) => `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;

        const lines: string[] = ['📋 *Resumo do Pedido*', ''];
        let subtotal = 0;

        (items || []).forEach((it: any, idx: number) => {
          const qty = Number(it.quantity || 1);
          const unit = Number(it.price_at_order || 0);
          const extrasArr = Array.isArray(it.order_item_extras) ? it.order_item_extras : [];
          const extrasUnit = extrasArr.reduce((s: number, e: any) => s + Number(e.price_at_order || 0), 0);
          const lineTotal = (unit + extrasUnit) * qty;
          subtotal += lineTotal;

          const productName = it.products?.name || 'Item';
          lines.push(`${idx + 1}. *${productName}* x${qty} — ${fmt(lineTotal)}`);

          extrasArr.forEach((e: any) => {
            const extraName = e.extra_name || e.product_extras?.name || 'Adicional';
            const extraPrice = Number(e.price_at_order || 0);
            if (extraPrice > 0) {
              lines.push(`   + ${extraName} (${fmt(extraPrice)})`);
            } else {
              lines.push(`   + ${extraName}`);
            }
          });

          if (it.notes) lines.push(`   📝 ${it.notes}`);
        });

        const deliveryFee = Number(order?.delivery_fee || 0);
        const serviceFee = Number((order as any)?.service_fee || 0);
        const discount = Number(order?.coupon_discount || 0);
        const total = subtotal + deliveryFee + serviceFee - discount;

        if (deliveryFee > 0 || serviceFee > 0 || discount > 0) {
          lines.push('');
          lines.push(`Subtotal: ${fmt(subtotal)}`);
          if (deliveryFee > 0) lines.push(`🚚 Taxa de entrega: ${fmt(deliveryFee)}`);
          if (serviceFee > 0) lines.push(`🧾 Taxa de serviço: ${fmt(serviceFee)}`);
          if (discount > 0) {
            const couponCode = (order as any)?.coupon_code;
            lines.push(`🎟️ ${couponCode ? `Cupom ${couponCode}` : 'Desconto'}: -${fmt(discount)}`);
          }
        }

        const scheduledFor = (order as any)?.dd_scheduled_for;
        if (scheduledFor) {
          try {
            const d = new Date(scheduledFor);
            const dateStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
            const timeStr = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
            lines.push('');
            lines.push(`⏰ *Agendado para:* ${dateStr} às ${timeStr}`);
          } catch (_) { /* ignore */ }
        }

        if (order?.delivery_address) {
          lines.push('');
          lines.push(`📍 ${order.delivery_address}`);
        }

        lines.push('');
        lines.push(`💰 *Total: ${fmt(total)}*`);

        if ((items || []).length > 0) {
          enrichedContext.resumo_pedido = lines.join('\n');
          enrichedContext.total_pedido = fmt(total);
        } else {
          enrichedContext.resumo_pedido = '';
          enrichedContext.total_pedido = '';
        }
        console.log(`[NOTIF] Built summary: ${lines.length} lines, total=${fmt(total)}, items=${(items||[]).length}`);
      } catch (summaryErr) {
        console.warn('[NOTIF] Failed to build order summary:', summaryErr);
        enrichedContext.resumo_pedido = '';
        enrichedContext.total_pedido = '';
      }
    } else if (needsSummary) {
      enrichedContext.resumo_pedido = '';
      enrichedContext.total_pedido = '';
      console.log('[NOTIF] needsSummary but no orderId resolved — variables emptied');
    }

    // Link de avaliação configurável no painel (Google/personalizado).
    // Quando definido, substitui o link padrão (página do pedido).
    if (waConfig?.review_link_url) {
      enrichedContext.link_avaliacao = waConfig.review_link_url;
    }

    // Replace variables in template
    let message = template;
    for (const [key, value] of Object.entries(enrichedContext)) {
      message = message.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value ?? ''));
    }
    // Strip any remaining {{var}} placeholders to avoid sending literal template tokens
    message = message.replace(/\{\{\s*[\w-]+\s*\}\}/g, '').replace(/\n{3,}/g, '\n\n').trim();

    // Determine recipient phone
    const ownerTypes = ['cashier_open', 'cashier_close', 'daily_summary'];
    let phone: string | null = null;

    if (ownerTypes.includes(notification_type)) {
      // Get owner phone
      const { data: ownerConfig } = await supabase
        .from('owner_notification_config')
        .select('owner_phone, receive_cashier_open, receive_cashier_close, receive_daily_summary')
        .eq('restaurant_id', restaurant_id)
        .maybeSingle();

      if (!ownerConfig?.owner_phone) {
        return new Response(
          JSON.stringify({ success: false, reason: 'no_owner_phone' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check owner toggle
      if (notification_type === 'cashier_open' && !ownerConfig.receive_cashier_open) {
        return new Response(
          JSON.stringify({ success: false, reason: 'owner_toggle_off' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (notification_type === 'cashier_close' && !ownerConfig.receive_cashier_close) {
        return new Response(
          JSON.stringify({ success: false, reason: 'owner_toggle_off' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (notification_type === 'daily_summary' && !ownerConfig.receive_daily_summary) {
        return new Response(
          JSON.stringify({ success: false, reason: 'owner_toggle_off' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      phone = ownerConfig.owner_phone;
    } else {
      // Client notification — phone comes from context
      phone = context?.phone || null;
    }

    if (!phone) {
      return new Response(
        JSON.stringify({ success: false, reason: 'no_phone' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send via whatsapp-send
    const sendUrl = `${supabaseUrl}/functions/v1/whatsapp-send`;
    const sendResponse = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        restaurantId: restaurant_id,
        phone,
        message,
        messageType: notification_type,
      }),
    });

    const sendResult = await sendResponse.json();
    console.log(`[NOTIF] Send result:`, sendResult);

    return new Response(
      JSON.stringify({ success: sendResult.success ?? false, ...sendResult }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[NOTIF ERROR]', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

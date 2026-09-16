import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { orderId, restaurantId } = await req.json();

    console.log(`[marketing-trigger] Processing order ${orderId} for restaurant ${restaurantId}`);

    // Fetch order details with items and their products/categories
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(`
        id,
        customer_name,
        customer_cpf,
        delivery_phone,
        order_type,
        order_items(
          product_id,
          products(
            id,
            name,
            category_id,
            categories(id, name)
          )
        )
      `)
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      console.error("[marketing-trigger] Order not found:", orderError);
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get customer phone from order or from customers table
    let customerPhone = order.delivery_phone;
    if (!customerPhone) {
      const { data: customer } = await supabase
        .from("customers")
        .select("phone")
        .eq("cpf", order.customer_cpf)
        .eq("restaurant_id", restaurantId)
        .single();
      
      customerPhone = customer?.phone;
    }

    if (!customerPhone) {
      console.log("[marketing-trigger] No phone number found for customer, skipping");
      return new Response(JSON.stringify({ message: "No phone number found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch active campaigns for this restaurant
    const { data: campaigns, error: campaignsError } = await supabase
      .from("marketing_campaigns")
      .select(`
        id,
        name,
        marketing_campaign_rules(*, order_type_filter)
      `)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);

    if (campaignsError || !campaigns || campaigns.length === 0) {
      console.log("[marketing-trigger] No active campaigns found");
      return new Response(JSON.stringify({ message: "No active campaigns" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get restaurant name for message formatting
    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("name")
      .eq("id", restaurantId)
      .single();

    const restaurantName = restaurant?.name || "Restaurante";

    // Extract products and categories from the order
    const orderProducts = new Set<string>();
    const orderCategories = new Set<string>();
    const productNames: { [key: string]: string } = {};
    const categoryNames: { [key: string]: string } = {};

    for (const item of order.order_items || []) {
      if (item.product_id) {
        orderProducts.add(item.product_id);
        const product = item.products as any;
        if (product) {
          productNames[item.product_id] = product.name;
          if (product.category_id) {
            orderCategories.add(product.category_id);
            if (product.categories) {
              categoryNames[product.category_id] = product.categories.name;
            }
          }
        }
      }
    }

    console.log(`[marketing-trigger] Order products: ${[...orderProducts].join(", ")}`);
    console.log(`[marketing-trigger] Order categories: ${[...orderCategories].join(", ")}`);

    // Check each campaign for matching rules
    const scheduledMessages: any[] = [];

    for (const campaign of campaigns) {
      const rules = campaign.marketing_campaign_rules || [];
      
      for (const rule of rules) {
        let matches = false;
        let matchedProductName = "";
        let matchedCategoryName = "";
        let matchedCategoryId = "";

        switch (rule.trigger_type) {
          case "any_purchase":
            matches = true;
            matchedProductName = Object.values(productNames)[0] || "produto";
            matchedCategoryName = Object.values(categoryNames)[0] || "categoria";
            matchedCategoryId = [...orderCategories][0] || "";
            break;

          case "product_purchased":
            if (rule.trigger_product_id && orderProducts.has(rule.trigger_product_id)) {
              matches = true;
              matchedProductName = productNames[rule.trigger_product_id] || "produto";
            // Find the category of this product
              const matchedProduct = order.order_items?.find(
                (i: any) => i.product_id === rule.trigger_product_id
              ) as any;
              const matchedProd = matchedProduct?.products as any;
              if (matchedProd?.category_id) {
                matchedCategoryId = matchedProd.category_id;
                matchedCategoryName = matchedProd.categories?.name || "categoria";
              }
            }
            break;

          case "category_purchased":
            if (rule.trigger_category_id && orderCategories.has(rule.trigger_category_id)) {
              matches = true;
              matchedCategoryId = rule.trigger_category_id;
              matchedCategoryName = categoryNames[rule.trigger_category_id] || "categoria";
              // Find a product name from this category
              const catProduct = order.order_items?.find(
                (i: any) => (i.products as any)?.category_id === rule.trigger_category_id
              ) as any;
              matchedProductName = (catProduct?.products as any)?.name || "produto";
            }
            break;
        }

        if (matches) {
          // Check order type filter
          const orderType = order.order_type || 'local';
          // 'delivery' e 'balcao'/PDV contam como venda "online" para o filtro.
          const isOnlineOrder = orderType === 'delivery' || orderType === 'balcao';
          const filterType = rule.order_type_filter || 'all';

          if (filterType === 'online' && !isOnlineOrder) {
            console.log(`[marketing-trigger] Campaign ${campaign.name} skipped: filter is 'online' but order is 'local'`);
            continue;
          }
          if (filterType === 'local' && isOnlineOrder) {
            console.log(`[marketing-trigger] Campaign ${campaign.name} skipped: filter is 'local' but order is 'online'`);
            continue;
          }

          console.log(`[marketing-trigger] Campaign ${campaign.name} matches!`);

          // Calculate scheduled time
          let scheduledFor = new Date();
          switch (rule.delay_unit) {
            case "seconds":
              scheduledFor.setSeconds(scheduledFor.getSeconds() + rule.delay_value);
              break;
            case "minutes":
              scheduledFor.setMinutes(scheduledFor.getMinutes() + rule.delay_value);
              break;
            case "hours":
              scheduledFor.setHours(scheduledFor.getHours() + rule.delay_value);
              break;
            case "days":
              scheduledFor.setDate(scheduledFor.getDate() + rule.delay_value);
              break;
            case "weeks":
              scheduledFor.setDate(scheduledFor.getDate() + rule.delay_value * 7);
              break;
            case "months":
              scheduledFor.setMonth(scheduledFor.getMonth() + rule.delay_value);
              break;
            default:
              // Unidade desconhecida → trata como minutos (evita envio imediato inesperado).
              scheduledFor.setMinutes(scheduledFor.getMinutes() + (rule.delay_value || 0));
              break;
          }

          // Generate coupon code or use existing coupon
          let couponCode: string | null = null;
          let discountText = "";
          let validityText = "";

          if (rule.discount_type) {
            // Check if rule has an existing coupon_id to use
            if (rule.coupon_id) {
              // Use existing coupon
              const { data: existingCoupon } = await supabase
                .from("coupons")
                .select("code, valid_until, discount_type, discount_value")
                .eq("id", rule.coupon_id)
                .single();

              if (existingCoupon) {
                couponCode = existingCoupon.code;
                discountText = existingCoupon.discount_type === "percentage"
                  ? `${existingCoupon.discount_value}%`
                  : `R$ ${Number(existingCoupon.discount_value).toFixed(2)}`;
                
                // Format validity as date DD/MM/YYYY
                if (existingCoupon.valid_until) {
                  const validDate = new Date(existingCoupon.valid_until);
                  validityText = validDate.toLocaleDateString('pt-BR');
                } else {
                  validityText = `${rule.discount_validity_days || 7} dias`;
                }
                
                console.log(`[marketing-trigger] Using existing coupon: ${couponCode}`);
              }
            }
            
            // If no existing coupon or coupon not found, generate new one
            if (!couponCode) {
              couponCode = `MKT${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
              
              discountText = rule.discount_type === "percentage"
                ? `${rule.discount_value}%`
                : `R$ ${Number(rule.discount_value).toFixed(2)}`;

              // Determine category restriction
              let discountCategoryId: string | null = null;
              if (rule.discount_target_type === "same_category" && matchedCategoryId) {
                discountCategoryId = matchedCategoryId;
              } else if (rule.discount_target_type === "category" && rule.discount_target_category_id) {
                discountCategoryId = rule.discount_target_category_id;
              }

              // Create coupon in the coupons table
              const couponValidUntil = new Date();
              couponValidUntil.setDate(couponValidUntil.getDate() + (rule.discount_validity_days || 7));

              const { error: couponError } = await supabase
                .from("coupons")
                .insert({
                  restaurant_id: restaurantId,
                  code: couponCode,
                  discount_type: rule.discount_type,
                  discount_value: rule.discount_value,
                  min_order_value: 0,
                  is_active: true,
                  usage_limit: 1,
                  valid_from: new Date().toISOString(),
                  valid_until: couponValidUntil.toISOString(),
                });

              if (couponError) {
                console.error("[marketing-trigger] Error creating coupon:", couponError);
              }

              // Format validity as date DD/MM/YYYY
              validityText = couponValidUntil.toLocaleDateString('pt-BR');
              
              console.log(`[marketing-trigger] Created new coupon: ${couponCode}`);
            }
          }

          // Nome do cliente pode ser null; usa "cliente" como fallback para
          // não vazar "null" na mensagem NEM violar o NOT NULL da coluna
          // customer_name (que abortaria o INSERT de TODO o lote).
          const safeCustomerName = order.customer_name || "cliente";

          // Format the message
          let messageText = rule.message_template
            .replace(/{nome}/g, safeCustomerName)
            .replace(/{cupom}/g, couponCode || "")
            .replace(/{desconto}/g, discountText)
            .replace(/{produto}/g, matchedProductName)
            .replace(/{categoria}/g, matchedCategoryName)
            .replace(/{validade}/g, validityText)
            .replace(/{restaurante}/g, restaurantName);

          scheduledMessages.push({
            campaign_id: campaign.id,
            rule_id: rule.id,
            order_id: orderId,
            restaurant_id: restaurantId,
            customer_cpf: order.customer_cpf,
            customer_name: safeCustomerName,
            customer_phone: customerPhone,
            coupon_code: couponCode,
            message_text: messageText,
            scheduled_for: scheduledFor.toISOString(),
            status: "pending",
          });
        }
      }
    }

    // Insert all scheduled messages
    if (scheduledMessages.length > 0) {
      const { error: insertError } = await supabase
        .from("marketing_scheduled_messages")
        .insert(scheduledMessages);

      if (insertError) {
        console.error("[marketing-trigger] Error inserting scheduled messages:", insertError);
        throw insertError;
      }

      console.log(`[marketing-trigger] Scheduled ${scheduledMessages.length} messages`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        scheduledCount: scheduledMessages.length 
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("[marketing-trigger] Error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

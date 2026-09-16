import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-deliverydireto-signature, x-app-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const DD_CLIENT_SECRET = Deno.env.get("DD_CLIENT_SECRET");
    if (!DD_CLIENT_SECRET) {
      console.error("[dd-webhook] Missing DD_CLIENT_SECRET");
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    const bodyText = await req.text();
    console.log(`[dd-webhook] Received webhook, body length=${bodyText.length}`);

    // Validate HMAC signature
    const signature = req.headers.get("x-deliverydireto-signature") || req.headers.get("X-DeliveryDireto-Signature");
    if (signature) {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(DD_CLIENT_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(bodyText));
      const expectedSig = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
      
      if (signature !== expectedSig) {
        console.warn("[dd-webhook] Invalid signature");
        // Still return 200 to avoid retries, but don't process
        return new Response("OK", { status: 200, headers: corsHeaders });
      }
      console.log("[dd-webhook] Signature validated");
    } else {
      console.warn("[dd-webhook] No signature header, proceeding anyway");
    }

    const payload = JSON.parse(bodyText);
    const eventType = payload.event || payload.type;
    console.log(`[dd-webhook] Event type: ${eventType}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const DD_CLIENT_ID = Deno.env.get("DD_CLIENT_ID")!;

    if (eventType === "ORDER_PLACED") {
      const orderId = payload.order_id || payload.orderId || payload.data?.order_id;
      const storeId = payload.store_id || payload.storeId || payload.data?.store_id;
      console.log(`[dd-webhook] ORDER_PLACED orderId=${orderId}, storeId=${storeId}`);

      if (!orderId || !storeId) {
        console.error("[dd-webhook] Missing orderId or storeId");
        return new Response("OK", { status: 200, headers: corsHeaders });
      }

      // Find restaurant config
      const { data: config } = await supabase
        .from("deliverydireto_config")
        .select("restaurant_id, access_token, token_expires_at, store_id")
        .eq("store_id", storeId)
        .eq("enabled", true)
        .maybeSingle();

      if (!config) {
        console.error(`[dd-webhook] No active config for store_id=${storeId}`);
        return new Response("OK", { status: 200, headers: corsHeaders });
      }

      // Ensure token is valid
      let accessToken = config.access_token;
      if (config.token_expires_at) {
        const expiresAt = new Date(config.token_expires_at).getTime();
        if (expiresAt < Date.now() + 5 * 60 * 1000) {
          console.warn("[dd-webhook] Token expired or expiring soon, attempting refresh");
          // Try refresh via dd-auth
          try {
            const refreshRes = await fetch(`${supabaseUrl}/functions/v1/dd-auth`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "refresh_token", restaurant_id: config.restaurant_id }),
            });
            const refreshData = await refreshRes.json();
            if (refreshData.access_token) {
              accessToken = refreshData.access_token;
            }
          } catch (e) {
            console.warn("[dd-webhook] Token refresh failed:", e);
          }
        }
      }

      // Fetch order details from DD API
      console.log(`[dd-webhook] Fetching order details from DD API...`);
      const orderRes = await fetch(`https://deliverydireto.com.br/admin-api/v1/orders/${orderId}`, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "X-DeliveryDireto-Client-Id": DD_CLIENT_ID,
          "X-DeliveryDireto-Id": config.store_id,
        },
      });

      if (!orderRes.ok) {
        const errText = await orderRes.text();
        console.error(`[dd-webhook] Failed to fetch order: status=${orderRes.status}, body=${errText}`);
        return new Response("OK", { status: 200, headers: corsHeaders });
      }

      const orderData = await orderRes.json();
      console.log(`[dd-webhook] Order data received: customer=${orderData.customer?.name || "unknown"}`);

      // Map DD order to our orders table
      const customerName = orderData.customer?.name || "Cliente Delivery Direto";
      const customerPhone = orderData.customer?.phone || "";
      const customerCpf = orderData.customer?.cpf || orderData.customer?.document || "";
      
      const deliveryType = orderData.delivery_method === "PICKUP" ? "retirada" : "delivery";
      const deliveryAddress = orderData.delivery_address
        ? `${orderData.delivery_address.street || ""}, ${orderData.delivery_address.number || ""} - ${orderData.delivery_address.neighborhood || ""}, ${orderData.delivery_address.city || ""}`
        : null;

      const paymentType = orderData.payment?.prepaid ? "Pago pelo Delivery Direto" : (orderData.payment?.method || "Delivery Direto");

      // Insert order
      const { data: newOrder, error: orderError } = await supabase
        .from("orders")
        .insert({
          restaurant_id: config.restaurant_id,
          customer_name: customerName,
          customer_cpf: customerCpf,
          delivery_type: deliveryType,
          order_type: deliveryType,
          delivery_address: deliveryAddress,
          delivery_phone: customerPhone,
          payment_type: paymentType,
          status: "pending",
          dd_source: true,
          dd_order_id: String(orderId),
          delivery_fee: orderData.delivery_fee || 0,
          notes: orderData.observations || null,
        })
        .select("id")
        .single();

      if (orderError) {
        console.error("[dd-webhook] Order insert error:", orderError);
        return new Response("OK", { status: 200, headers: corsHeaders });
      }

      console.log(`[dd-webhook] Order created: ${newOrder.id}`);

      // Insert order items
      if (orderData.items && orderData.items.length > 0) {
        const items = orderData.items.map((item: any) => ({
          order_id: newOrder.id,
          product_id: null, // DD products don't map to local products
          quantity: item.quantity || 1,
          price_at_order: item.unit_price || item.price || 0,
          notes: item.observations || item.name || null,
        }));

        const { error: itemsError } = await supabase.from("order_items").insert(items);
        if (itemsError) {
          console.error("[dd-webhook] Items insert error:", itemsError);
        } else {
          console.log(`[dd-webhook] ${items.length} items inserted`);
        }
      }

      console.log("[dd-webhook] ORDER_PLACED processed successfully");
    }

    if (eventType === "ORDER_STATUS_CHANGED") {
      const ddOrderId = payload.order_id || payload.orderId || payload.data?.order_id;
      const newStatus = payload.status || payload.new_status || payload.data?.status;
      console.log(`[dd-webhook] ORDER_STATUS_CHANGED ddOrderId=${ddOrderId}, newStatus=${newStatus}`);

      if (ddOrderId && newStatus) {
        // Map DD status to our status
        const statusMap: Record<string, string> = {
          "CONFIRMED": "accepted",
          "PREPARING": "accepted",
          "READY": "ready",
          "DISPATCHED": "out_for_delivery",
          "DELIVERED": "delivered",
          "CANCELLED": "cancelled",
        };

        const mappedStatus = statusMap[newStatus] || newStatus.toLowerCase();

        const { error: updateError } = await supabase
          .from("orders")
          .update({ status: mappedStatus, updated_at: new Date().toISOString() })
          .eq("dd_order_id", String(ddOrderId));

        if (updateError) {
          console.error("[dd-webhook] Status update error:", updateError);
        } else {
          console.log(`[dd-webhook] Status updated to ${mappedStatus}`);
        }
      }
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("[dd-webhook] Unexpected error:", err);
    return new Response("OK", { status: 200, headers: corsHeaders });
  }
});

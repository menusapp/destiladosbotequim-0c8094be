import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-app-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("[MP Webhook] Received:", JSON.stringify(body));

    // Mercado Pago sends IPN with action and data.id
    const action = body.action || body.type;
    const dataId = body.data?.id;

    if (!dataId) {
      console.log("[MP Webhook] No data ID, ignoring");
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseServiceKey);

    // ========== Handle merchant_order events (QR Code PIX) ==========
    if (action === "merchant_order" || action === "merchant_order.updated" || body.topic === "merchant_order") {
      console.log("[MP Webhook] Merchant order event:", action, "id:", dataId);

      // We need an access token to fetch merchant order details
      // Try to find which restaurant this belongs to by checking point_order_payments
      // First fetch the merchant order without auth to get external_reference
      // Actually we need auth — find all restaurants and try
      const { data: configs } = await sb
        .from("online_payment_config")
        .select("restaurant_id, mp_access_token")
        .not("mp_access_token", "is", null);

      for (const config of (configs || [])) {
        try {
          const moRes = await fetch(`https://api.mercadopago.com/merchant_orders/${dataId}`, {
            headers: { Authorization: `Bearer ${config.mp_access_token}` },
          });
          if (!moRes.ok) continue;

          const mo = await moRes.json();
          const externalRef = mo.external_reference;
          if (!externalRef) continue;

          const approvedPayment = mo.payments?.find((p: any) => p.status === "approved");
          const isClosed = mo.status === "closed" || mo.order_status === "paid";

          if (approvedPayment || isClosed) {
            console.log("[MP Webhook] Merchant order paid, external_reference:", externalRef);

            // Update point_order_payments by external_reference
            const { data: updated } = await sb
              .from("point_order_payments")
              .update({ status: "paid" })
              .eq("external_reference", externalRef)
              .in("status", ["waiting_terminal", "processing"])
              .select("id, order_id");

            if (updated && updated.length > 0) {
              console.log("[MP Webhook] Point payment updated via merchant_order:", updated[0].id);
              // If there's a linked order, mark it as paid too
              if (updated[0].order_id) {
                await sb.from("orders").update({ payment_status: "paid", paid_at: new Date().toISOString() }).eq("id", updated[0].order_id);
              }
            }
          }
          break; // Found the right restaurant
        } catch (e: any) {
          console.log("[MP Webhook] merchant_order fetch error:", e.message);
        }
      }

      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // ========== Handle Point order events ==========
    if (action === "order.processed" || action === "order.canceled" || action === "order.expired") {
      console.log("[MP Webhook] Point order event:", action, "id:", dataId);

      // Look up in point_order_payments
      const { data: pointPayment } = await sb.rpc("get_point_order_payment", { p_mp_order_id: String(dataId) });

      if (pointPayment && pointPayment.length > 0) {
        const pp = pointPayment[0];
        let newStatus = "waiting_terminal";

        if (action === "order.processed") {
          // Fetch order details to validate transaction
          const { data: config } = await sb
            .from("online_payment_config")
            .select("mp_access_token")
            .eq("restaurant_id", pp.restaurant_id)
            .maybeSingle();

          if (config?.mp_access_token) {
            const mpRes = await fetch(`https://api.mercadopago.com/v1/orders/${dataId}`, {
              headers: { Authorization: `Bearer ${config.mp_access_token}` },
            });
            const mpOrder = await mpRes.json();
            const txn = mpOrder.transactions?.payments?.[0];
            if (txn?.status_detail === "accredited" || txn?.status === "approved") {
              newStatus = "paid";
              // Mark order as paid
              if (pp.order_id) {
                await sb.from("orders").update({ payment_status: "paid", paid_at: new Date().toISOString() }).eq("id", pp.order_id);
              }
            } else {
              newStatus = "failed";
            }
            await sb.rpc("update_point_order_payment", { p_mp_order_id: String(dataId), p_status: newStatus, p_mp_status_payload: mpOrder });
          }
        } else {
          newStatus = "canceled";
          await sb.rpc("update_point_order_payment", { p_mp_order_id: String(dataId), p_status: newStatus, p_mp_status_payload: body });
        }
        console.log("[MP Webhook] Point payment updated:", pp.id, "->", newStatus);
      }

      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    const paymentId = dataId;

    // Only process payment updates
    if (action !== "payment.updated" && action !== "payment.created" && action !== "payment") {
      console.log("[MP Webhook] Ignoring action:", action);
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // Find the online_payment record by provider_payment_id
    const { data: onlinePayment, error: findError } = await sb
      .from("online_payments")
      .select("id, restaurant_id, order_id, status, amount")
      .eq("provider_payment_id", String(paymentId))
      .maybeSingle();

    if (findError || !onlinePayment) {
      console.log("[MP Webhook] Payment not found for MP id:", paymentId);
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // Already confirmed, skip
    if (onlinePayment.status === "confirmed") {
      console.log("[MP Webhook] Already confirmed:", onlinePayment.id);
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // Fetch payment details from Mercado Pago to verify status
    const { data: config } = await sb
      .from("online_payment_config")
      .select("mp_access_token")
      .eq("restaurant_id", onlinePayment.restaurant_id)
      .maybeSingle();

    if (!config?.mp_access_token) {
      console.error("[MP Webhook] No access token for restaurant:", onlinePayment.restaurant_id);
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // Verify payment status with MP API
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${config.mp_access_token}` },
    });
    const mpPayment = await mpResponse.json();

    console.log("[MP Webhook] MP status:", mpPayment.status, "for payment:", onlinePayment.id);

    if (mpPayment.status === "approved") {
      // Update online_payments to confirmed
      const { error: updateError } = await sb
        .from("online_payments")
        .update({
          status: "confirmed",
          paid_at: new Date().toISOString(),
          webhook_received_at: new Date().toISOString(),
        })
        .eq("id", onlinePayment.id);

      if (updateError) {
        console.error("[MP Webhook] Update error:", updateError);
      } else {
        console.log("[MP Webhook] Payment confirmed:", onlinePayment.id);

        // Update order payment status if linked
        if (onlinePayment.order_id) {
          await sb
            .from("orders")
            .update({ payment_status: "paid" })
            .eq("id", onlinePayment.order_id);
        }

        // 🔥 Trigger NFC-e emission via Nuvem Fiscal
        try {
          const nfceUrl = `${supabaseUrl}/functions/v1/nuvem-fiscal-emit`;
          const nfceResponse = await fetch(nfceUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              order_id: onlinePayment.order_id,
              restaurant_id: onlinePayment.restaurant_id,
            }),
          });
          const nfceResult = await nfceResponse.text();
          console.log("[MP Webhook] Nuvem Fiscal response:", nfceResult);
        } catch (nfceError: any) {
          console.error("[MP Webhook] Nuvem Fiscal call failed:", nfceError.message);
        }
      }
    } else if (mpPayment.status === "rejected" || mpPayment.status === "cancelled") {
      await sb
        .from("online_payments")
        .update({
          status: "failed",
          webhook_received_at: new Date().toISOString(),
        })
        .eq("id", onlinePayment.id);
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error("[MP Webhook] Error:", error);
    return new Response("OK", { status: 200, headers: corsHeaders });
  }
});

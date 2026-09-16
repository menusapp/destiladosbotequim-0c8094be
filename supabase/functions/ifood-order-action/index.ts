import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
};

const IFOOD_API = "https://merchant-api.ifood.com.br";

function auditLog(input: {
  merchantId?: string | null;
  tokenMerchantId?: string | null;
  orderId?: string | null;
  action: string;
  endpoint: string;
  status?: number | null;
  response?: unknown;
}) {
  const responseBody = typeof input.response === "string"
    ? input.response
    : JSON.stringify(input.response ?? null);
  console.log(
    `[IFOOD_AUDIT] merchant_id=${input.merchantId ?? "null"} token_merchant_id=${input.tokenMerchantId ?? "null"} order_id=${input.orderId ?? "null"} action=${input.action} endpoint=${input.endpoint} status=${input.status ?? "null"} response=${responseBody.slice(0, 2000)} timestamp=${new Date().toISOString()}`
  );
}

function extractMerchantIdFromToken(accessToken?: string | null): string | null {
  if (!accessToken) return null;
  try {
    const jwtParts = accessToken.split(".");
    if (jwtParts.length < 2) return null;
    const payload = JSON.parse(atob(jwtParts[1]));
    const merchantScope = payload.merchant_scope;
    if (Array.isArray(merchantScope) && merchantScope.length > 0) {
      return String(merchantScope[0]).split(":")[0] || null;
    }
    return payload.merchant_id || payload.merchantId || null;
  } catch (_) {
    return null;
  }
}

const ACTION_MAP: Record<string, { method: string; path: string; newStatus?: string }> = {
  confirm: { method: "POST", path: "confirm", newStatus: "accepted" },
  start_preparation: { method: "POST", path: "startPreparation", newStatus: "preparing" },
  ready_to_pickup: { method: "POST", path: "readyToPickup", newStatus: "ready" },
  dispatch: { method: "POST", path: "dispatch", newStatus: "out_for_delivery" },
  cancel: { method: "POST", path: "requestCancellation", newStatus: "cancelled" },
  get_cancellation_reasons: { method: "GET", path: "cancellationReasons" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { restaurant_id, ifood_order_id, order_id, action, cancellation_code, reason } = await req.json();

    console.log(`[IFOOD_DEBUG] edge_invoked restaurant_id=${restaurant_id ?? "null"} ifood_order_id=${ifood_order_id ?? "null"} order_id=${order_id ?? "null"} action=${action ?? "null"} timestamp=${new Date().toISOString()}`);

    if (!restaurant_id || !ifood_order_id || !action) {
      console.warn(`[IFOOD_DEBUG] edge_bad_request missing fields restaurant_id=${!!restaurant_id} ifood_order_id=${!!ifood_order_id} action=${!!action}`);
      return new Response(
        JSON.stringify({ error: "restaurant_id, ifood_order_id and action are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const actionConfig = ACTION_MAP[action];
    if (!actionConfig) {
      return new Response(
        JSON.stringify({ error: `Invalid action: ${action}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get token
    const { data: config } = await supabase
      .from("ifood_config")
      .select("access_token, merchant_id")
      .eq("restaurant_id", restaurant_id)
      .single();

    if (!config?.access_token) {
      return new Response(
        JSON.stringify({ error: "iFood not connected" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenMerchantId = extractMerchantIdFromToken(config.access_token);
    if (config.merchant_id && tokenMerchantId && config.merchant_id !== tokenMerchantId) {
      auditLog({
        merchantId: config.merchant_id,
        tokenMerchantId,
        orderId: ifood_order_id,
        action: "merchant_mismatch",
        endpoint: "ifood_config.access_token",
        status: null,
        response: { restaurant_id, db_merchant_id: config.merchant_id, token_merchant_id: tokenMerchantId },
      });
    }

    // Build request
    const endpoint = `/order/v1.0/orders/${ifood_order_id}/${actionConfig.path}`;
    const url = `${IFOOD_API}${endpoint}`;
    const fetchOptions: RequestInit = {
      method: actionConfig.method,
      headers: {
        Authorization: `Bearer ${config.access_token}`,
        "Content-Type": "application/json",
      },
    };

    // Add cancellation body if needed — iFood requires BOTH code and reason
    if (action === "cancel") {
      const body: Record<string, string> = {
        cancellationCode: cancellation_code || "501",
        reason: reason || "Cancelado pelo restaurante",
      };
      fetchOptions.body = JSON.stringify(body);
    }

    // dispatch: iFood requires { deliveredBy: "MERCHANT" } when the
    // merchant performs the delivery (logística própria do restaurante).
    if (action === "dispatch") {
      fetchOptions.body = JSON.stringify({ deliveredBy: "MERCHANT" });
    }

    if (action === "get_cancellation_reasons") {
      console.log(`[IFOOD_CANCEL_REASONS] request order_id=${ifood_order_id} merchant_id=${config.merchant_id} endpoint=${endpoint} url=${url}`);
    }

    const response = await fetch(url, fetchOptions);
    const responseText = await response.text();
    auditLog({
      merchantId: config.merchant_id,
      tokenMerchantId,
      orderId: ifood_order_id,
      action,
      endpoint,
      status: response.status,
      response: responseText || null,
    });

    if (action === "get_cancellation_reasons") {
      console.log(`[IFOOD_CANCEL_REASONS] response status=${response.status} order_id=${ifood_order_id} merchant_id=${config.merchant_id}`);
      console.log(`[IFOOD_CANCEL_REASONS] body=${responseText || "(empty)"}`);

      let parsed: any = null;
      try { parsed = responseText ? JSON.parse(responseText) : null; } catch (_) { parsed = null; }

      if (!response.ok) {
        const ifoodMessage = parsed?.message || parsed?.error || responseText || `HTTP ${response.status}`;
        return new Response(
          JSON.stringify({
            reasons: [],
            error: `Não foi possível obter os motivos de cancelamento: ${ifoodMessage}`,
            ifood_status: response.status,
            ifood_code: parsed?.code || null,
            ifood_message: ifoodMessage,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const reasons = Array.isArray(parsed) ? parsed : (parsed?.reasons || []);
      return new Response(
        JSON.stringify({ reasons }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `iFood action failed: ${responseText}` }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update local order status
    if (actionConfig.newStatus && order_id) {
      await supabase
        .from("orders")
        .update({ status: actionConfig.newStatus })
        .eq("id", order_id);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("ifood-order-action error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

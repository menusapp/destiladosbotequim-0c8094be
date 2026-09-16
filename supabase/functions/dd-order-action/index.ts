import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
};

const DD_ADMIN_API = "https://deliverydireto.com.br/admin-api/v1";

// ────────────────────────────────────────────────────────────────────
// DD Admin API PUT /orders/{id}/status
// Documented statuses: APPROVED, DONE, IN_TRANSIT, HIDDEN, REJECTED, WARNING
// statusReason: required for REJECTED and HIDDEN
// ────────────────────────────────────────────────────────────────────

// Map ERP actions → DD status + local status
const ACTION_MAP: Record<string, { ddStatus: string; localStatus: string; needsReason: boolean }> = {
  accept:   { ddStatus: "APPROVED",   localStatus: "accepted",         needsReason: false },
  dispatch: { ddStatus: "IN_TRANSIT", localStatus: "out_for_delivery", needsReason: false },
  ready:    { ddStatus: "APPROVED",   localStatus: "ready",            needsReason: false },
  deliver:  { ddStatus: "DONE",       localStatus: "delivered",        needsReason: false },
  reject:   { ddStatus: "REJECTED",   localStatus: "cancelled",        needsReason: true },
  cancel:   { ddStatus: "REJECTED",   localStatus: "cancelled",        needsReason: true },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const { restaurant_id, dd_order_id, action, reason } = await req.json();

    console.log(`[dd-order-action] ▶ action=${action} dd_order_id=${dd_order_id} restaurant_id=${restaurant_id}`);

    if (!restaurant_id || !dd_order_id || !action) {
      return respond({ error: "restaurant_id, dd_order_id e action são obrigatórios" });
    }

    const actionCfg = ACTION_MAP[action];
    if (!actionCfg) {
      const valid = Object.keys(ACTION_MAP).join(", ");
      return respond({ error: `Ação inválida: "${action}". Válidas: ${valid}` });
    }

    // ── Supabase client ──────────────────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const DD_CLIENT_ID = Deno.env.get("DD_CLIENT_ID") || "";

    // ── Get DD config ────────────────────────────────────────────────
    const { data: config, error: configErr } = await supabase
      .from("deliverydireto_config")
      .select("store_id, access_token, token_expires_at")
      .eq("restaurant_id", restaurant_id)
      .eq("enabled", true)
      .maybeSingle();

    if (configErr) {
      console.error("[dd-order-action] Config query error:", configErr);
      return respond({ error: "Erro ao buscar configuração do Delivery Direto" });
    }
    if (!config?.access_token) {
      return respond({ error: "Delivery Direto não conectado ou sem token" });
    }

    // ── Token refresh if expiring ────────────────────────────────────
    let accessToken = config.access_token;
    if (config.token_expires_at) {
      const expiresAt = new Date(config.token_expires_at).getTime();
      if (expiresAt < Date.now() + 5 * 60 * 1000) {
        console.log("[dd-order-action] Token expiring soon, refreshing...");
        try {
          const refreshRes = await fetch(`${supabaseUrl}/functions/v1/dd-auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "refresh_token", restaurant_id }),
          });
          const refreshData = await refreshRes.json();
          if (refreshData.access_token) {
            accessToken = refreshData.access_token;
            console.log("[dd-order-action] ✓ Token refreshed");
          } else {
            console.warn("[dd-order-action] Token refresh returned no token, using existing");
          }
        } catch (e) {
          console.warn("[dd-order-action] Token refresh error:", e);
        }
      }
    }

    // ── Build DD API request ─────────────────────────────────────────
    const statusUrl = `${DD_ADMIN_API}/orders/${dd_order_id}/status`;

    const ddBody: Record<string, string> = {
      status: actionCfg.ddStatus,
    };

    // Always include statusReason for REJECTED/HIDDEN (required by DD API)
    if (actionCfg.needsReason) {
      ddBody.statusReason = reason || `Pedido ${action === "cancel" ? "cancelado" : "recusado"} pelo estabelecimento`;
    }

    const ddHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    };
    if (DD_CLIENT_ID) {
      ddHeaders["X-DeliveryDireto-Client-Id"] = DD_CLIENT_ID;
    }
    if (config.store_id) {
      ddHeaders["X-DeliveryDireto-Id"] = config.store_id;
    }

    console.log(`[dd-order-action] PUT ${statusUrl}`);
    console.log(`[dd-order-action] Body: ${JSON.stringify(ddBody)}`);
    console.log(`[dd-order-action] Headers: X-DeliveryDireto-Id=${config.store_id}, X-DeliveryDireto-Client-Id=${DD_CLIENT_ID ? "set" : "missing"}`);

    // ── Call DD API ──────────────────────────────────────────────────
    let apiRes: Response;
    try {
      apiRes = await fetch(statusUrl, {
        method: "PUT",
        headers: ddHeaders,
        body: JSON.stringify(ddBody),
      });
    } catch (fetchErr) {
      console.error("[dd-order-action] Fetch error:", fetchErr);
      // DO NOT update local status — DD is source of truth
      console.log(`[dd-order-action] ✗ Status local NÃO alterado — falha de conexão com DD`);
      return respond({
        success: false,
        dd_error: true,
        error: `Não foi possível conectar ao Delivery Direto: ${(fetchErr as Error).message}`,
        local_updated: false,
      });
    }

    const apiText = await apiRes.text();
    console.log(`[dd-order-action] DD Response: HTTP ${apiRes.status} | Body: ${apiText.substring(0, 500)}`);

    const ddSuccess = apiRes.ok || apiRes.status === 204 || apiRes.status === 202;

    if (!ddSuccess) {
      // Parse DD error for user-friendly message
      let ddErrorMsg = "";
      try {
        const errJson = JSON.parse(apiText);
        ddErrorMsg = errJson.message || errJson.error || errJson.detail || errJson.statusMessage || apiText.substring(0, 300);
      } catch {
        ddErrorMsg = apiText.substring(0, 300) || `HTTP ${apiRes.status}`;
      }

      // Build descriptive error
      const friendlyError = buildFriendlyError(action, actionCfg.ddStatus, apiRes.status, ddErrorMsg);
      console.error(`[dd-order-action] ✗ ${friendlyError}`);

      // DO NOT update local status — DD rejected the transition
      console.log(`[dd-order-action] ✗ Status local NÃO alterado — DD rejeitou a transição`);

      return respond({
        success: false,
        dd_error: true,
        dd_http_status: apiRes.status,
        dd_response: ddErrorMsg,
        error: friendlyError,
        local_updated: false,
      });
    }

    // ── DD accepted → update local ───────────────────────────────────
    const localOk = await updateLocalStatus(supabase, dd_order_id, actionCfg.localStatus, action, reason);

    console.log(`[dd-order-action] ✓ DD sync OK: ${action} → ${actionCfg.ddStatus} for order ${dd_order_id}, local=${actionCfg.localStatus}`);

    return respond({ success: true, local_updated: localOk });

  } catch (err) {
    console.error("[dd-order-action] Unexpected error:", err);
    return respond({ error: `Erro inesperado: ${(err as Error).message}` });
  }
});

// ── Helpers ──────────────────────────────────────────────────────────

async function updateLocalStatus(
  supabase: ReturnType<typeof createClient>,
  ddOrderId: string | number,
  localStatus: string,
  action: string,
  reason?: string,
): Promise<boolean> {
  const updateData: Record<string, unknown> = {
    status: localStatus,
    updated_at: new Date().toISOString(),
  };
  if ((action === "reject" || action === "cancel") && reason) {
    updateData.cancellation_reason = reason;
  }

  const { error } = await supabase
    .from("orders")
    .update(updateData)
    .eq("dd_order_id", String(ddOrderId));

  if (error) {
    console.error(`[dd-order-action] Local update failed: ${JSON.stringify(error)}`);
    return false;
  }
  console.log(`[dd-order-action] ✓ Local status → ${localStatus}`);
  return true;
}

function buildFriendlyError(action: string, ddStatus: string, httpStatus: number, ddMsg: string): string {
  const actionLabels: Record<string, string> = {
    accept: "aceitar",
    dispatch: "enviar para entrega",
    ready: "marcar como pronto",
    deliver: "finalizar",
    reject: "recusar",
    cancel: "cancelar",
  };
  const actionLabel = actionLabels[action] || action;

  if (httpStatus === 401 || httpStatus === 403) {
    return `Sem autorização para ${actionLabel} o pedido no Delivery Direto. Verifique as credenciais. (HTTP ${httpStatus})`;
  }
  if (httpStatus === 404) {
    return `Pedido não encontrado no Delivery Direto. Pode já ter sido removido ou o ID está incorreto. (HTTP 404)`;
  }
  if (httpStatus === 422) {
    return `Delivery Direto rejeitou a ação "${actionLabel}" (status ${ddStatus}): ${ddMsg}. Possivelmente o pedido não permite essa transição no estado atual.`;
  }
  if (httpStatus === 400) {
    return `Delivery Direto rejeitou o payload para "${actionLabel}": ${ddMsg}. (HTTP 400)`;
  }

  return `Delivery Direto retornou erro ao ${actionLabel} (HTTP ${httpStatus}, status enviado: ${ddStatus}): ${ddMsg}`;
}

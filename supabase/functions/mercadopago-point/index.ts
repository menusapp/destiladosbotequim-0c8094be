import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-app-token",
};

const MP_API = "https://api.mercadopago.com";

const MP_ERROR_MESSAGES: Record<string, string> = {
  already_queued_order_on_terminal: "Já existe uma cobrança pendente nessa maquininha. Aguarde ou cancele a anterior.",
  device_not_found: "Maquininha não encontrada. Verifique se está ligada.",
  invalid_terminal_id: "Terminal inválido.",
};

function log(action: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), action, ...data }));
}

function respond(ok: boolean, payload: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({ ok, ...payload }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

async function getRestaurantToken(restaurantId: string) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("online_payment_config")
    .select("mp_access_token, mp_user_id, token_expires_at, mp_external_pos_id")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (error || !data?.mp_access_token) {
    throw new Error("Conta Mercado Pago não conectada para este restaurante");
  }

  if (data.token_expires_at && new Date(data.token_expires_at) < new Date()) {
    throw new Error("TOKEN_EXPIRED");
  }

  return {
    accessToken: data.mp_access_token,
    mpUserId: data.mp_user_id,
    mpExternalPosId: data.mp_external_pos_id,
  };
}

async function mpFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: any }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };

  const res = await fetch(`${MP_API}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  log("mp_api_call", { path, method: options.method || "GET", status: res.status, ok: res.ok, response_body: data });

  return { ok: res.ok, status: res.status, data };
}

function translateMpError(result: { ok: boolean; status: number; data: any }): { error: string; code: string } {
  const errors = result.data?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const code = errors[0].code || "unknown";
    const msg = MP_ERROR_MESSAGES[code] || errors[0].message || "Erro desconhecido do Mercado Pago";
    return { error: msg, code };
  }
  const msg = result.data?.message || result.data?.error || `Erro do Mercado Pago (HTTP ${result.status})`;
  return { error: msg, code: "mp_error" };
}

// ============================================
// Actions
// ============================================

async function listTerminals(restaurantId: string) {
  const { accessToken } = await getRestaurantToken(restaurantId);
  const result = await mpFetch("/point/integration-api/devices", accessToken);
  if (!result.ok) return respond(false, { ...translateMpError(result), data: null });
  return respond(true, { data: result.data });
}

async function createStore(restaurantId: string, body: { name: string; external_id: string; location: { street_name: string; city_name: string; state_name: string } }) {
  const { accessToken, mpUserId } = await getRestaurantToken(restaurantId);
  if (!mpUserId) return respond(false, { error: "mp_user_id não encontrado", code: "missing_user_id" });
  if (!body.location || !body.location.street_name) {
    return respond(false, { error: "Campo 'location' é obrigatório para criar loja", code: "missing_location" });
  }
  const result = await mpFetch(`/users/${mpUserId}/stores`, accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!result.ok) return respond(false, { ...translateMpError(result), data: null });
  return respond(true, { data: result.data });
}

async function createPos(restaurantId: string, body: { name: string; external_id: string; external_store_id: string; fixed_amount?: boolean; category?: number }) {
  const { accessToken } = await getRestaurantToken(restaurantId);
  const result = await mpFetch("/pos", accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!result.ok) return respond(false, { ...translateMpError(result), data: null });

  // Save external_id (external_pos_id) to online_payment_config for QR Code PIX
  if (result.data?.external_id) {
    const sb = getSupabaseAdmin();
    await sb.from("online_payment_config")
      .update({ mp_external_pos_id: result.data.external_id })
      .eq("restaurant_id", restaurantId);
    log("[MP Point] saved_external_pos_id", { external_pos_id: result.data.external_id });
  }

  return respond(true, { data: result.data });
}

async function createOrder(
  restaurantId: string,
  body: { amount: number; description: string; order_id: string; device_id: string; idempotency_key: string; payment_type?: string }
) {
  const { accessToken, mpUserId, mpExternalPosId } = await getRestaurantToken(restaurantId);

  log("[MP Point] create_order_start", {
    restaurant_id: restaurantId,
    order_id: body.order_id,
    terminal_id: body.device_id,
    amount: body.amount,
    idempotency_key: body.idempotency_key,
    payment_type: body.payment_type,
  });

  let result: { ok: boolean; status: number; data: any };

  const isPix = body.payment_type === "bank_transfer";

  // ========== PIX: Use QR Code dinâmico para PDV presencial ==========
  if (isPix) {
    const userId = mpUserId;
    const externalPosId = mpExternalPosId;

    log("[MP PIX] QR Code attempt", { has_pos_id: !!externalPosId, has_user_id: !!userId });

    if (externalPosId && userId) {
      const pixQrPayload = {
        external_reference: body.order_id,
        title: body.description || "Pedido Totem",
        description: body.description || "Pagamento",
        notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mercadopago-webhook`,
        total_amount: body.amount,
        items: [{
          sku_number: body.order_id.substring(0, 20),
          category: "marketplace",
          title: body.description || "Pedido",
          description: body.description || "Pagamento",
          unit_price: body.amount,
          quantity: 1,
          unit_measure: "unit",
          total_amount: body.amount,
        }],
        cash_out: { amount: 0 },
      };

      result = await mpFetch(
        `/instore/orders/qr/seller/collectors/${userId}/pos/${externalPosId}/qrs`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify(pixQrPayload),
          headers: { "X-Idempotency-Key": body.idempotency_key },
        }
      );

      log("[MP PIX] QR Code response", { status: result.status, ok: result.ok, data: result.data });

      if (result.ok) {
        const qrOrderId = result.data?.in_store_order_id || result.data?.id || body.order_id;
        const sb = getSupabaseAdmin();
        try {
          await sb.rpc("insert_point_order_payment", {
            p_restaurant_id: restaurantId,
            p_order_id: null,
            p_mp_order_id: String(qrOrderId),
            p_mp_user_id: userId || "",
            p_terminal_id: body.device_id,
            p_external_reference: body.order_id,
            p_idempotency_key: body.idempotency_key,
            p_amount: body.amount,
            p_status: "waiting_terminal",
          });
          log("[MP PIX] db_save_success", { qr_order_id: qrOrderId });
        } catch (dbErr: any) {
          log("[MP PIX] db_save_error", { error: dbErr?.message });
        }
        return respond(true, { data: { ...result.data, id: qrOrderId, pix_qr: true } });
      }

      log("[MP PIX] QR Code failed, check if POS is registered correctly", {
        status: result.status,
        error: result.data,
      });
    }

    // Fallback: no POS configured — create normal order (terminal shows selection menu)
    log("[MP PIX] Falling back to /v1/orders without payment type (no POS configured)");
    result = await mpFetch("/v1/orders", accessToken, {
      method: "POST",
      body: JSON.stringify({
        type: "point",
        external_reference: body.order_id,
        description: body.description,
        transactions: { payments: [{ amount: Number(body.amount).toFixed(2) }] },
        config: { point: { terminal_id: body.device_id, print_on_terminal: "no_ticket" } },
      }),
      headers: { "X-Idempotency-Key": body.idempotency_key + "-fb" },
    });

    if (!result.ok) {
      log("[MP Point] create_order_failed", { status: result.status, payment_type: body.payment_type });
      return respond(false, { ...translateMpError(result), data: null });
    }

    // Save to DB
    const fallbackOrderId = result.data?.id || "";
    if (fallbackOrderId) {
      const sb = getSupabaseAdmin();
      try {
        await sb.rpc("insert_point_order_payment", {
          p_restaurant_id: restaurantId,
          p_order_id: null,
          p_mp_order_id: fallbackOrderId,
          p_mp_user_id: mpUserId || "",
          p_terminal_id: body.device_id,
          p_external_reference: body.order_id,
          p_idempotency_key: body.idempotency_key,
          p_amount: body.amount,
          p_status: "waiting_terminal",
        });
      } catch (dbErr: any) {
        log("[MP Point] db_save_error", { mp_order_id: fallbackOrderId, error: dbErr?.message });
      }
    }
    log("[MP Point] create_order_success", { mp_order_id: fallbackOrderId, response_status: result.status });
    return respond(true, { data: result.data });
  }

  // ========== CARD: /v1/orders with default_type ==========
  const configObj: any = {
    point: { terminal_id: body.device_id, print_on_terminal: "no_ticket" },
  };
  if (body.payment_type) {
    configObj.payment_method = { default_type: body.payment_type };
  }

  const orderPayload = {
    type: "point",
    external_reference: body.order_id,
    description: body.description,
    transactions: { payments: [{ amount: Number(body.amount).toFixed(2) }] },
    config: configObj,
  };

  log("[MP Point] v1_orders_with_default_type", { payment_type: body.payment_type || "none" });
  result = await mpFetch("/v1/orders", accessToken, {
    method: "POST",
    body: JSON.stringify(orderPayload),
    headers: { "X-Idempotency-Key": body.idempotency_key },
  });

  // Retry without payment_method restriction (fallback — terminal shows menu)
  if (!result.ok && body.payment_type) {
    const errCode = result.data?.errors?.[0]?.code;
    if (errCode !== "already_queued_order_on_terminal") {
      log("[MP Point] v1_orders_retry_without_default_type", { status: result.status, original_type: body.payment_type });
      const fallbackPayload = {
        type: "point",
        external_reference: body.order_id,
        description: body.description,
        transactions: { payments: [{ amount: Number(body.amount).toFixed(2) }] },
        config: { point: { terminal_id: body.device_id, print_on_terminal: "no_ticket" } },
      };
      result = await mpFetch("/v1/orders", accessToken, {
        method: "POST",
        body: JSON.stringify(fallbackPayload),
        headers: { "X-Idempotency-Key": body.idempotency_key + "-fb" },
      });
    }
  }

  // Retry once on 5xx
  if (!result.ok && result.status >= 500) {
    result = await mpFetch("/v1/orders", accessToken, {
      method: "POST",
      body: JSON.stringify(orderPayload),
      headers: { "X-Idempotency-Key": body.idempotency_key },
    });
  }

  if (!result.ok) {
    log("[MP Point] create_order_failed", { status: result.status, payment_type: body.payment_type });
    return respond(false, { ...translateMpError(result), data: null });
  }

  // Save to DB
  const mpOrderId = result.data?.id || "";
  if (mpOrderId) {
    const sb = getSupabaseAdmin();
    try {
      await sb.rpc("insert_point_order_payment", {
        p_restaurant_id: restaurantId,
        p_order_id: null,
        p_mp_order_id: mpOrderId,
        p_mp_user_id: mpUserId || "",
        p_terminal_id: body.device_id,
        p_external_reference: body.order_id,
        p_idempotency_key: body.idempotency_key,
        p_amount: body.amount,
        p_status: "waiting_terminal",
      });
      log("[MP Point] db_save_success", { mp_order_id: mpOrderId });
    } catch (dbErr: any) {
      log("[MP Point] db_save_error", { mp_order_id: mpOrderId, error: dbErr?.message });
    }
  }

  log("[MP Point] create_order_success", { mp_order_id: mpOrderId, response_status: result.status });
  return respond(true, { data: result.data });
}

async function getOrder(restaurantId: string, mpOrderId: string) {
  const { accessToken } = await getRestaurantToken(restaurantId);
  
  // Try /v1/orders first
  let result = await mpFetch(`/v1/orders/${mpOrderId}`, accessToken);
  
  // Fallback: try payment-intents
  if (!result.ok && result.status === 404) {
    result = await mpFetch(`/point/integration-api/payment-intents/${mpOrderId}`, accessToken);
  }

  if (!result.ok) return respond(false, { ...translateMpError(result), data: null });

  // Update internal status
  const sb = getSupabaseAdmin();
  const mpStatus = result.data.status;
  let internalStatus = "waiting_terminal";

  // Handle both /v1/orders and payment-intents response shapes
  if (mpStatus === "processed" || mpStatus === "finished") {
    const txn = result.data.transactions?.payments?.[0] || result.data.payment;
    if (txn?.status_detail === "accredited" || txn?.status === "approved") {
      internalStatus = "paid";
    } else {
      internalStatus = "failed";
    }
  } else if (mpStatus === "canceled" || mpStatus === "expired" || mpStatus === "cancelled") {
    internalStatus = "canceled";
  } else if (mpStatus === "processing" || mpStatus === "open") {
    internalStatus = "processing";
  }

  await sb.rpc("update_point_order_payment", {
    p_mp_order_id: mpOrderId,
    p_status: internalStatus,
  });

  return respond(true, { data: { ...result.data, internal_status: internalStatus } });
}

// Poll QR Code PIX payment via merchant_orders
async function getQrOrder(restaurantId: string, externalReference: string) {
  const { accessToken } = await getRestaurantToken(restaurantId);

  log("[MP PIX] get_qr_order", { external_reference: externalReference });

  // Search merchant orders by external_reference
  const result = await mpFetch(
    `/merchant_orders?external_reference=${encodeURIComponent(externalReference)}`,
    accessToken
  );

  if (!result.ok) {
    log("[MP PIX] merchant_orders_failed", { status: result.status });
    return respond(false, { ...translateMpError(result), data: null });
  }

  const elements = result.data?.elements || [];
  if (elements.length === 0) {
    // No merchant order yet — still waiting
    return respond(true, { data: { status: "waiting", internal_status: "waiting_terminal" } });
  }

  const order = elements[0];
  const payments = order.payments || [];
  const approvedPayment = payments.find((p: any) => p.status === "approved");

  let internalStatus = "waiting_terminal";

  if (approvedPayment || order.status === "closed" || order.order_status === "paid") {
    internalStatus = "paid";
  } else if (payments.some((p: any) => p.status === "rejected" || p.status === "cancelled")) {
    internalStatus = "failed";
  } else if (payments.length > 0) {
    internalStatus = "processing";
  }

  // Update DB
  const sb = getSupabaseAdmin();
  // Find by external_reference since QR orders use in_store_order_id
  if (internalStatus === "paid" || internalStatus === "failed" || internalStatus === "canceled") {
    await sb.from("point_order_payments")
      .update({ status: internalStatus })
      .eq("external_reference", externalReference)
      .in("status", ["waiting_terminal", "processing"]);
  }

  log("[MP PIX] get_qr_order_result", { internal_status: internalStatus, merchant_order_id: order.id, payments_count: payments.length });

  return respond(true, {
    data: {
      ...order,
      internal_status: internalStatus,
      status: internalStatus === "paid" ? "processed" : order.status,
      // Mimic the transactions shape for frontend compatibility
      transactions: approvedPayment ? { payments: [{ status: "approved", status_detail: "accredited" }] } : undefined,
    },
  });
}

async function cancelOrder(restaurantId: string, mpOrderId: string) {
  const { accessToken } = await getRestaurantToken(restaurantId);
  
  // Try /v1/orders DELETE
  let result = await mpFetch(`/v1/orders/${mpOrderId}`, accessToken, { method: "DELETE" });
  
  // Fallback: try payment-intents cancel
  if (!result.ok && result.status === 404) {
    result = await mpFetch(`/point/integration-api/payment-intents/${mpOrderId}`, accessToken, { method: "DELETE" });
  }

  log("[MP Point] cancel_order", { mp_order_id: mpOrderId, status: result.ok ? "success" : "error" });

  const sb = getSupabaseAdmin();
  await sb.rpc("update_point_order_payment", {
    p_mp_order_id: mpOrderId,
    p_status: "canceled",
  });

  if (!result.ok) return respond(false, { ...translateMpError(result), data: null });
  return respond(true, { data: result.data });
}

async function listPendingOrders(restaurantId: string, deviceId: string) {
  const sb = getSupabaseAdmin();

  const { data: localPending } = await sb
    .from("point_order_payments")
    .select("mp_order_id, status, created_at, amount")
    .eq("restaurant_id", restaurantId)
    .eq("device_id", deviceId)
    .in("status", ["waiting_terminal", "processing"])
    .order("created_at", { ascending: false })
    .limit(5);

  log("[MP Point] list_pending_local", { device_id: deviceId, local_count: localPending?.length || 0 });

  return respond(true, {
    data: {
      local_pending: localPending || [],
    },
  });
}

async function cancelDevicePending(restaurantId: string, deviceId: string) {
  const { accessToken } = await getRestaurantToken(restaurantId);
  
  const sb = getSupabaseAdmin();
  const { data: localPending } = await sb
    .from("point_order_payments")
    .select("mp_order_id")
    .eq("restaurant_id", restaurantId)
    .eq("device_id", deviceId)
    .in("status", ["waiting_terminal", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (localPending?.mp_order_id) {
    log("[MP Point] cancel_device_pending_local", { mp_order_id: localPending.mp_order_id });
    
    let result = await mpFetch(`/point/integration-api/payment-intents/${localPending.mp_order_id}`, accessToken, { method: "DELETE" });
    if (!result.ok) {
      result = await mpFetch(`/v1/orders/${localPending.mp_order_id}`, accessToken, { method: "DELETE" });
    }
    
    await sb.rpc("update_point_order_payment", {
      p_mp_order_id: localPending.mp_order_id,
      p_status: "canceled",
    });
    
    return respond(true, { data: { canceled_id: localPending.mp_order_id, api_ok: result.ok } });
  }

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const searchResult = await mpFetch(
    `/v1/orders?type=point&begin_date=${oneDayAgo.toISOString()}&end_date=${now.toISOString()}`,
    accessToken
  );
  
  log("[MP Point] cancel_device_search", { status: searchResult.status, ok: searchResult.ok, count: searchResult.data?.elements?.length });
  
  if (searchResult.ok && searchResult.data?.elements?.length > 0) {
    for (const order of searchResult.data.elements) {
      if (order.config?.point?.terminal_id === deviceId && order.status !== "processed" && order.status !== "canceled") {
        const cancelResult = await mpFetch(`/v1/orders/${order.id}`, accessToken, { method: "DELETE" });
        log("[MP Point] cancel_found_order", { mp_order_id: order.id, ok: cancelResult.ok });
        if (cancelResult.ok) {
          return respond(true, { data: { canceled_id: order.id, source: "v1_orders" } });
        }
      }
    }
  }

  const eventsResult = await mpFetch(
    `/point/integration-api/devices/${deviceId}/payment-intents?startDate=${oneDayAgo.toISOString()}&endDate=${now.toISOString()}`,
    accessToken
  );
  
  log("[MP Point] cancel_device_events", { status: eventsResult.status, ok: eventsResult.ok });
  
  if (eventsResult.ok && Array.isArray(eventsResult.data)) {
    for (const intent of eventsResult.data) {
      if (intent.state === "OPEN" || intent.status === "open") {
        const cancelResult = await mpFetch(
          `/point/integration-api/devices/${deviceId}/payment-intents/${intent.id}`,
          accessToken,
          { method: "DELETE" }
        );
        if (cancelResult.ok) {
          return respond(true, { data: { canceled_id: intent.id, source: "payment_intents" } });
        }
      }
    }
  }

  return respond(false, { error: "Não encontramos a cobrança pendente via API. Cancele direto na maquininha: pressione o X vermelho ou reinicie o app de pagamentos.", code: "not_found" });
}

async function changeOperatingMode(restaurantId: string, deviceId: string, mode: string) {
  const { accessToken } = await getRestaurantToken(restaurantId);
  const result = await mpFetch(`/point/integration-api/devices/${deviceId}`, accessToken, {
    method: "PATCH",
    body: JSON.stringify({ operating_mode: mode }),
  });
  log("[MP Point] change_operating_mode", { device_id: deviceId, mode, ok: result.ok, status: result.status });
  if (!result.ok) return respond(false, { ...translateMpError(result), data: null });
  return respond(true, { data: result.data });
}

async function testOrder(restaurantId: string, deviceId: string) {
  return createOrder(restaurantId, {
    amount: 1.0,
    description: "Teste de integração - R$ 1,00",
    order_id: crypto.randomUUID(),
    device_id: deviceId,
    idempotency_key: crypto.randomUUID(),
  });
}

// ============================================
// Handler
// ============================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return respond(false, { error: "Method not allowed", code: "method_not_allowed" });
  }

  try {
    const body = await req.json();
    const { action, restaurant_id, ...params } = body;

    if (!action || !restaurant_id) {
      return respond(false, { error: "Missing action or restaurant_id", code: "missing_params" });
    }

    switch (action) {
      case "list_terminals":
        return await listTerminals(restaurant_id);
      case "create_store":
        return await createStore(restaurant_id, params as any);
      case "create_pos":
        return await createPos(restaurant_id, params as any);
      case "create_order":
        return await createOrder(restaurant_id, params as any);
      case "get_order":
        return await getOrder(restaurant_id, params.mp_order_id);
      case "get_qr_order":
        return await getQrOrder(restaurant_id, params.external_reference);
      case "cancel_order":
        return await cancelOrder(restaurant_id, params.mp_order_id);
      case "test_order":
        return await testOrder(restaurant_id, params.device_id);
      case "list_pending_orders":
        return await listPendingOrders(restaurant_id, params.device_id);
      case "cancel_device_pending":
        return await cancelDevicePending(restaurant_id, params.device_id);
      case "change_operating_mode":
        return await changeOperatingMode(restaurant_id, params.device_id, params.mode || "PDV");
      default:
        return respond(false, { error: `Ação desconhecida: ${action}`, code: "unknown_action" });
    }
  } catch (err: any) {
    const isTokenExpired = err.message === "TOKEN_EXPIRED";
    log("error", { error: err.message, is_token_expired: isTokenExpired });

    return respond(false, {
      error: isTokenExpired
        ? "Token OAuth expirado. Reconecte a conta Mercado Pago."
        : err.message || "Erro interno",
      code: isTokenExpired ? "TOKEN_EXPIRED" : "INTERNAL_ERROR",
    });
  }
});

import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
};

const IFOOD_API = "https://merchant-api.ifood.com.br";

/** Normalize a string for comparison: trim, uppercase, collapse spaces */
function normalize(s: string | null | undefined): string {
  return (s || "").trim().toUpperCase().replace(/\s+/g, " ");
}

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

/**
 * Auto-execute the operational iFood Order API transition chain for IMMEDIATE DELIVERY orders
 * when the restaurant has auto_accept_orders enabled.
 * In homologation mode this is intentionally disabled so the Firefly/manual Kanban
 * certification flow is the only path that calls ifood-order-action/order endpoints.
 * Operational sequence: confirm → startPreparation
 * Idempotent: skips steps already reflected in the local order status, so it can be
 * safely invoked multiple times per polling cycle / per inbound event.
 */
const STEP_ORDER = ["pending", "accepted", "preparing", "ready", "out_for_delivery"] as const;
type LocalStatus = typeof STEP_ORDER[number];

async function runAutoIfoodFlow(params: {
  supabase: any;
  accessToken: string;
  merchantId: string | null;
  tokenMerchantId: string | null;
  ifoodOrderId: string;
  localOrderId: string;
  deliveryType: string | null;
  orderTiming: string | null;
  autoAccept: boolean;
  homologationMode: boolean;
  currentStatus: string | null;
}): Promise<void> {
  const {
    supabase, accessToken, merchantId, tokenMerchantId,
    ifoodOrderId, localOrderId, deliveryType, orderTiming, autoAccept, homologationMode, currentStatus,
  } = params;

  const baseCtx = `order_id=${ifoodOrderId} local_order_id=${localOrderId} current_status=${currentStatus ?? "null"} delivery_type=${deliveryType ?? "null"} order_timing=${orderTiming ?? "null"} auto_accept_orders=${autoAccept} homologation_mode=${homologationMode}`;


  if (homologationMode) {
    console.log(`[IFOOD_AUTO_FLOW] skip ${baseCtx} reason=homologation_manual_mode`);
    return;
  }
  if (!autoAccept) {
    console.log(`[IFOOD_AUTO_FLOW] skip ${baseCtx} reason=auto_accept_disabled`);
    return;
  }
  if ((orderTiming ?? "").toUpperCase() === "SCHEDULED") {
    console.log(`[IFOOD_AUTO_FLOW] skip ${baseCtx} reason=scheduled_order`);
    return;
  }
  if ((deliveryType ?? "").toLowerCase() !== "delivery") {
    console.log(`[IFOOD_AUTO_FLOW] skip ${baseCtx} reason=not_delivery`);
    return;
  }
  if (currentStatus === "cancelled" || currentStatus === "delivered" || currentStatus === "out_for_delivery") {
    console.log(`[IFOOD_AUTO_FLOW] skip ${baseCtx} reason=already_advanced`);
    return;
  }

  console.log(`[IFOOD_AUTO_FLOW] start ${baseCtx}`);

  // OPERATIONAL MODE: only confirm + startPreparation. The operator manually
  // advances ready → dispatch from the admin panel.
  const allSteps: Array<{ action: string; path: string; localStatus: LocalStatus; body?: Record<string, unknown> }> = [
    { action: "confirm",           path: "confirm",         localStatus: "accepted" },
    { action: "start_preparation", path: "startPreparation", localStatus: "preparing" },
    { action: "ready_to_pickup",   path: "readyToPickup",   localStatus: "ready" },
    { action: "dispatch",          path: "dispatch",        localStatus: "out_for_delivery", body: { deliveredBy: "MERCHANT" } },
  ];
  const steps = allSteps.slice(0, 2);


  const currentIdx = STEP_ORDER.indexOf((currentStatus ?? "pending") as LocalStatus);
  const startFromIdx = currentIdx < 0 ? 0 : currentIdx;

  for (const step of steps) {
    const stepIdx = STEP_ORDER.indexOf(step.localStatus);
    if (stepIdx <= startFromIdx) {
      console.log(`[IFOOD_AUTO_FLOW] skip-step order_id=${ifoodOrderId} action=${step.action} reason=already_done`);
      continue;
    }

    const endpoint = `/order/v1.0/orders/${ifoodOrderId}/${step.path}`;
    const url = `${IFOOD_API}${endpoint}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: step.body ? JSON.stringify(step.body) : undefined,
      });
      const text = await res.text();
      auditLog({
        merchantId,
        tokenMerchantId,
        orderId: ifoodOrderId,
        action: step.action,
        endpoint,
        status: res.status,
        response: text || null,
      });
      // Treat 409 as already-in-state (idempotent) and continue advancing.
      const okOrAlready = res.ok || res.status === 409;
      if (!okOrAlready) {
        console.error(`[IFOOD_AUTO_FLOW] error order_id=${ifoodOrderId} action=${step.action} status=${res.status} body=${text.slice(0, 300)}`);
        return;
      }
      await supabase
        .from("orders")
        .update({ status: step.localStatus })
        .eq("id", localOrderId);
      await new Promise((r) => setTimeout(r, 400));
    } catch (e) {
      auditLog({
        merchantId,
        tokenMerchantId,
        orderId: ifoodOrderId,
        action: step.action,
        endpoint,
        status: null,
        response: { error: (e as Error).message },
      });
      console.error(`[IFOOD_AUTO_FLOW] error order_id=${ifoodOrderId} action=${step.action} exception=${(e as Error).message}`);
      return;
    }
  }

  console.log(`[IFOOD_AUTO_FLOW] complete ${baseCtx}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { restaurant_id } = await req.json();

    // Get config
    const { data: config } = await supabase
      .from("ifood_config")
      .select("*")
      .eq("restaurant_id", restaurant_id)
      .single();

    if (!config || !config.enabled || !config.access_token) {
      return new Response(
        JSON.stringify({ error: "iFood not configured or disabled", new_orders: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve merchant_id: from DB or extract from JWT
    let tokenMerchantId = extractMerchantIdFromToken(config.access_token);
    let merchantId = config.merchant_id || tokenMerchantId;
    if (!config.merchant_id && merchantId) {
      await supabase
        .from("ifood_config")
        .update({ merchant_id: merchantId })
        .eq("restaurant_id", restaurant_id);
    }
    if (config.merchant_id && tokenMerchantId && config.merchant_id !== tokenMerchantId) {
      auditLog({
        merchantId: config.merchant_id,
        tokenMerchantId,
        orderId: null,
        action: "merchant_mismatch",
        endpoint: "ifood_config.access_token",
        status: null,
        response: { restaurant_id, db_merchant_id: config.merchant_id, token_merchant_id: tokenMerchantId },
      });
    }

    if (!merchantId) {
      return new Response(
        JSON.stringify({ error: "No merchant_id available", new_orders: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // DISTRIBUTED LOCK — garante execução única por merchant
    // ============================================================
    const lockKey = `ifood-polling:${merchantId}`;
    const { data: lockAcquired, error: lockError } = await supabase.rpc(
      "try_acquire_polling_lock",
      { _key: lockKey, _ttl_seconds: 120, _owner: `restaurant:${restaurant_id}` }
    );
    if (lockError) {
      console.error(`[IFOOD_POLLING] lock_rpc_error merchant_id=${merchantId} error=${lockError.message}`);
    }
    if (!lockAcquired) {
      console.log(`[IFOOD_POLLING] skipped reason=lock_already_acquired merchant_id=${merchantId}`);
      return new Response(
        JSON.stringify({ skipped: true, reason: "lock_already_acquired", merchant_id: merchantId, new_orders: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.log(`[IFOOD_POLLING] lock_acquired merchant_id=${merchantId}`);

    try {
    // Check token expiry (30 min buffer) — auto-refresh if needed

    let accessToken = config.access_token;
    const expiresAt = new Date(config.token_expires_at).getTime();
    const now = Date.now();
    if (expiresAt - now < 30 * 60 * 1000) {
      console.log("[ifood-polling] Token expiring soon, auto-refreshing...");
      const clientId = Deno.env.get("IFOOD_CLIENT_ID");
      const clientSecret = Deno.env.get("IFOOD_CLIENT_SECRET");
      if (!clientId || !clientSecret || !config.refresh_token) {
        return new Response(
          JSON.stringify({ error: "Cannot refresh token — missing credentials or refresh_token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      try {
        const refreshEndpoint = `/authentication/v1.0/oauth/token`;
        const refreshRes = await fetch(`${IFOOD_API}${refreshEndpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grantType: "refresh_token",
            clientId,
            clientSecret,
            refreshToken: config.refresh_token,
          }),
        });
        const refreshText = await refreshRes.text();
        auditLog({
          merchantId,
          tokenMerchantId,
          orderId: null,
          action: "refresh_token",
          endpoint: refreshEndpoint,
          status: refreshRes.status,
          response: refreshRes.ok ? { success: true, token_response_redacted: true } : refreshText || null,
        });
        if (!refreshRes.ok) {
          console.error("[ifood-polling] Refresh failed:", refreshText);
          return new Response(
            JSON.stringify({ error: "Token refresh failed. Reconnect iFood.", details: refreshText }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const tokenData = refreshText ? JSON.parse(refreshText) : null;
        if (!tokenData.accessToken) {
          return new Response(
            JSON.stringify({ error: "Invalid token response from iFood" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        accessToken = tokenData.accessToken;
        tokenMerchantId = extractMerchantIdFromToken(accessToken) || tokenMerchantId;
        const newExpiresAt = new Date(Date.now() + tokenData.expiresIn * 1000).toISOString();
        await supabase.from("ifood_config").update({
          access_token: tokenData.accessToken,
          refresh_token: tokenData.refreshToken,
          token_expires_at: newExpiresAt,
          updated_at: new Date().toISOString(),
        }).eq("restaurant_id", restaurant_id);
        console.log("[ifood-polling] Token refreshed successfully, expires:", newExpiresAt);
      } catch (e) {
        console.error("[ifood-polling] Refresh error:", e);
        return new Response(
          JSON.stringify({ error: "Token refresh exception", details: e.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Poll events
    const pollingEndpoint = `/events/v1.0/events:polling`;
    const eventsRes = await fetch(`${IFOOD_API}${pollingEndpoint}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Polling-Merchants": merchantId,
      },
    });

    const eventsText = await eventsRes.text();
    auditLog({
      merchantId,
      tokenMerchantId,
      orderId: null,
      action: "polling",
      endpoint: pollingEndpoint,
      status: eventsRes.status,
      response: eventsText || null,
    });

    if (!eventsRes.ok) {
      if (eventsRes.status === 401 || eventsRes.status === 403) {
        return new Response(
          JSON.stringify({ error: "Token invalid" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "Polling failed", status: eventsRes.status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const events = eventsText ? JSON.parse(eventsText) : [];

    if (!Array.isArray(events) || events.length === 0) {
      await supabase
        .from("ifood_config")
        .update({ last_polling_at: new Date().toISOString() })
        .eq("restaurant_id", restaurant_id);

      return new Response(
        JSON.stringify({ success: true, new_orders: 0, events_processed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Pre-fetch products & extras for matching ────────────────────────────
    const { data: restaurantCategories } = await supabase
      .from("categories")
      .select("id")
      .eq("restaurant_id", restaurant_id);
    const categoryIds = (restaurantCategories || []).map((c: any) => c.id);

    let productsList: any[] = [];
    let extraCategoryItemsList: any[] = [];

    if (categoryIds.length > 0) {
      const { data: allProducts } = await supabase
        .from("products")
        .select("id, name, pdv_code, price")
        .in("category_id", categoryIds);
      productsList = allProducts || [];
    }

    // Fetch extra_category_items (complementos do sistema) for this restaurant
    const { data: allExtraCategories } = await supabase
      .from("extra_categories")
      .select("id")
      .eq("restaurant_id", restaurant_id);
    const extraCatIds = (allExtraCategories || []).map((c: any) => c.id);

    if (extraCatIds.length > 0) {
      const { data: allExtraItems } = await supabase
        .from("extra_category_items")
        .select("id, name, pdv_code, price, category_id")
        .in("category_id", extraCatIds);
      extraCategoryItemsList = allExtraItems || [];
    }

    console.log(`[ifood-polling] Loaded ${productsList.length} products, ${extraCategoryItemsList.length} extra_category_items for matching`);

    let newOrdersCount = 0;
    const eventIds: { id: string }[] = [];
    const ackedEventIds = new Set<string>();
    const touchedIfoodOrderIds = new Set<string>();

    // Per-event immediate ACK helper.
    // Sends POST /events/v1.0/events/acknowledgment with body `[{"id":"<event_id>"}]`
    // BEFORE any business-logic processing, so a downstream exception cannot
    // prevent the ACK. Emits a single line with all Firefly-audit fields.
    const ackSingleEvent = async (ev: any, timestampRecebimento: string) => {
      if (!ev?.id || ackedEventIds.has(ev.id)) return;
      const ackEndpoint = `/events/v1.0/events/acknowledgment`;
      const ackUrl = `${IFOOD_API}${ackEndpoint}`;
      const ackPayloadArr = [{ id: ev.id }];
      const ackPayload = JSON.stringify(ackPayloadArr);
      let ackStatus: number | null = null;
      let ackText = "";
      let timestampAck = "";
      try {
        const ackRes = await fetch(ackUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Polling-Merchants": merchantId,
          },
          body: ackPayload,
        });
        ackStatus = ackRes.status;
        ackText = await ackRes.text();
        timestampAck = new Date().toISOString();
        ackedEventIds.add(ev.id);
        eventIds.push({ id: ev.id });
      } catch (e) {
        timestampAck = new Date().toISOString();
        ackText = `EXCEPTION:${(e as Error).message}`;
      }
      console.log(
        `[IFOOD_ACK] event_id=${ev.id} full_code=${ev.fullCode ?? "null"} code=${ev.code ?? "null"} order_id=${ev.orderId ?? "null"} merchant_id=${ev.merchantId ?? merchantId} token_merchant_id=${tokenMerchantId} timestamp_recebimento=${timestampRecebimento} timestamp_ack=${timestampAck} http_status=${ackStatus ?? "null"} payload_ack=${ackPayload} response_ack=${(ackText || "").slice(0, 1000)} url=${ackUrl}`
      );
      auditLog({
        merchantId,
        tokenMerchantId,
        orderId: ev.orderId ?? null,
        action: "acknowledgment",
        endpoint: ackEndpoint,
        status: ackStatus,
        response: { event_id: ev.id, full_code: ev.fullCode ?? null, payload: ackPayloadArr, response: ackText || null, timestamp_recebimento: timestampRecebimento, timestamp_ack: timestampAck },
      });
    };

    for (const event of events) {
      const timestampRecebimento = new Date().toISOString();
      const eventCode = event.fullCode || event.code || "";
      const orderId = event.orderId;
      if (orderId) touchedIfoodOrderIds.add(orderId);
      console.log("Evento recebido:", JSON.stringify({ id: event.id, code: event.code, fullCode: event.fullCode, orderId: event.orderId, timestamp_recebimento: timestampRecebimento }));
      console.log(
        `[IFOOD_POLLING_EVENT] event_id=${event.id} full_code=${event.fullCode ?? "null"} code=${event.code ?? "null"} order_id=${event.orderId ?? "null"} merchant_id=${event.merchantId ?? merchantId} received_at=${timestampRecebimento} created_at=${event.createdAt ?? "null"}`
      );
      auditLog({
        merchantId,
        tokenMerchantId,
        orderId,
        action: `event_${eventCode || "unknown"}`,
        endpoint: pollingEndpoint,
        status: eventsRes.status,
        response: { event_id: event.id, event_merchant_id: event.merchantId ?? null, created_at: event.createdAt ?? null, full_code: event.fullCode ?? null, timestamp_recebimento: timestampRecebimento },
      });

      // ACK immediately — BEFORE any processing — so the ACK is never blocked
      // by a downstream exception, and covers every code (PLC/CFM/PRS/RTP/DSP/CAN/CON/DDCR/...).
      await ackSingleEvent(event, timestampRecebimento);

      try {

      if (eventCode === "PLACED") {
        // Check if order already exists
        const { data: existing } = await supabase
          .from("orders")
          .select("id")
          .eq("ifood_order_id", orderId)
          .maybeSingle();

        if (existing) continue;

        // Get order details
        try {
          const orderEndpoint = `/order/v1.0/orders/${orderId}`;
          const orderRes = await fetch(`${IFOOD_API}${orderEndpoint}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const orderText = await orderRes.text();
          auditLog({ merchantId, tokenMerchantId, orderId, action: "get_order_details", endpoint: orderEndpoint, status: orderRes.status, response: orderText || null });

          if (!orderRes.ok) {
            continue;
          }

          if (!orderText) continue;
          const orderData = JSON.parse(orderText);

          const customerName = orderData.customer?.name || "Cliente iFood";
          const customerPhone = orderData.customer?.phone?.number || "";
          const deliveryAddress = orderData.delivery?.deliveryAddress
            ? `${orderData.delivery.deliveryAddress.streetName}, ${orderData.delivery.deliveryAddress.streetNumber} - ${orderData.delivery.deliveryAddress.neighborhood}, ${orderData.delivery.deliveryAddress.city}`
            : null;

          // ── Delivery fee with origin label ──────────────────────────────
          const deliveryFee = orderData.deliveryFee?.value
            ?? orderData.total?.deliveryFee
            ?? orderData.deliveryFee
            ?? 0;
          const deliveryFeeNum = typeof deliveryFee === 'object' ? (deliveryFee?.value || 0) : (deliveryFee || 0);

          // ── Service fee / additional fees (Taxa de serviço iFood) ───────
          // Ordem de extração (a primeira fonte com valor > 0 vence):
          //   1) additionalFees[] (array top-level, detalhado por taxa)
          //   2) total.additionalFees (agregado)
          //   3) otherFees[] (compatibilidade com payloads antigos)
          // Sempre ignora entradas cujo type/name contenha DELIVERY.
          const sumNonDelivery = (arr: any[]): number => {
            let s = 0;
            for (const f of arr || []) {
              const fType = String(f?.type || f?.name || "").toUpperCase();
              const fVal = Number(f?.value ?? 0);
              if (!Number.isFinite(fVal) || fVal <= 0) continue;
              if (fType.includes("DELIVERY")) continue;
              s += fVal;
            }
            return s;
          };
          const additionalFeesArr = Array.isArray(orderData.additionalFees) ? orderData.additionalFees : [];
          const otherFees = Array.isArray(orderData.otherFees) ? orderData.otherFees : [];
          let serviceFeeNum = sumNonDelivery(additionalFeesArr);
          if (serviceFeeNum <= 0) {
            const addFees = Number(orderData.total?.additionalFees ?? 0);
            if (Number.isFinite(addFees) && addFees > 0) serviceFeeNum = addFees;
          }
          if (serviceFeeNum <= 0) serviceFeeNum = sumNonDelivery(otherFees);

          // ── Auditoria financeira ────────────────────────────────────────
          const couponDiscountAudit = Number(orderData.total?.benefits ?? 0) || 0;
          const ifoodOrderAmount = Number(orderData.total?.orderAmount ?? 0);
          const itemsSubtotal = (orderData.items || []).reduce(
            (acc: number, it: any) => acc + (Number(it?.totalPrice ?? it?.price ?? 0) || 0),
            0,
          );
          const menusAppTotal = +(itemsSubtotal + deliveryFeeNum + serviceFeeNum - couponDiscountAudit).toFixed(2);
          console.log("[ifood-polling][audit]", JSON.stringify({
            orderId,
            delivery_fee: deliveryFeeNum,
            service_fee: serviceFeeNum,
            coupon_discount: couponDiscountAudit,
            orderAmount_ifood: ifoodOrderAmount,
            total_menusapp: menusAppTotal,
            sources: {
              additionalFees_top: additionalFeesArr,
              total_additionalFees: orderData.total?.additionalFees ?? null,
              otherFees,
            },
          }));
          if (ifoodOrderAmount > 0 && Math.abs(ifoodOrderAmount - menusAppTotal) > 0.01) {
            console.warn("[ifood-polling][audit][WARNING] divergência > R$0,01 entre orderAmount iFood e total MenusApp", JSON.stringify({
              orderId,
              diff: +(ifoodOrderAmount - menusAppTotal).toFixed(2),
              ifood: ifoodOrderAmount,
              menusapp: menusAppTotal,
            }));
          }

          // ── Order type: DELIVERY vs TAKEOUT/INDOOR (pickup) ─────────────
          const ifoodOrderType = String(orderData.orderType || "DELIVERY").toUpperCase();
          const isPickup = ifoodOrderType === "TAKEOUT" || ifoodOrderType === "INDOOR";
          const deliveryTypeValue = isPickup ? "pickup" : "delivery";

          // ── Scheduled order ────────────────────────────────────────────
          // IMPORTANTE: o iFood envia `delivery.deliveryDateTime` (ETA) em TODOS
          // os pedidos, inclusive imediatos. A única fonte confiável para saber
          // se é agendado é `orderTiming === "SCHEDULED"`. Só depois disso
          // capturamos a janela em `schedule.*` (ou fallback de ETA).
          const ifoodTiming = String(orderData.orderTiming || "").toUpperCase();
          const isScheduled = ifoodTiming === "SCHEDULED";
          const scheduledFor = isScheduled
            ? (orderData.schedule?.deliveryDateTime ||
               orderData.schedule?.scheduledDateTimeStart ||
               orderData.schedule?.windowStartTime ||
               orderData.schedule?.windowStart ||
               orderData.schedule?.startDateTime ||
               orderData.scheduledDateTime ||
               orderData.delivery?.deliveryDateTime ||
               null)
            : null;

          // Log detalhado para diagnóstico de homologação iFood
          console.log("[ifood-polling] scheduled-detection", JSON.stringify({
            orderId,
            orderTiming: orderData.orderTiming ?? null,
            schedule: orderData.schedule ?? null,
            scheduledDateTime: orderData.scheduledDateTime ?? null,
            deliveryDateTime: orderData.delivery?.deliveryDateTime ?? null,
            resolvedScheduledFor: scheduledFor,
            isScheduled,
            decision: isScheduled
              ? "TRATADO COMO AGENDADO (status=scheduled)"
              : "TRATADO COMO IMEDIATO (orderTiming != SCHEDULED)",
          }));

          // ── Voucher / coupon discount + sponsor breakdown ──────────────
          let couponCode: string | null = null;
          let couponDiscount = 0;
          let sponsorIfood = 0;
          let sponsorMerchant = 0;
          const benefits = Array.isArray(orderData.benefits) ? orderData.benefits : [];
          for (const b of benefits) {
            const benefitValue = Number(b?.value || b?.benefitValue || 0);
            if (benefitValue > 0) {
              couponDiscount += benefitValue;
            }
            const sponsorships = Array.isArray(b?.sponsorshipValues) ? b.sponsorshipValues : [];
            for (const sp of sponsorships) {
              if (sp?.name && !couponCode) couponCode = String(sp.name);
              const spName = String(sp?.name || "").toUpperCase();
              const spValue = Number(sp?.value || 0) || 0;
              if (spName.includes("IFOOD")) sponsorIfood += spValue;
              else if (spName.includes("MERCHANT") || spName.includes("RESTAURANT")) sponsorMerchant += spValue;
            }
            if (!couponCode && b?.target) couponCode = String(b.target);
          }
          if (couponDiscount === 0 && orderData.total?.benefits) {
            couponDiscount = Number(orderData.total.benefits) || 0;
          }
          // Resolve sponsor label for display
          let sponsorLabel: string | null = null;
          if (sponsorIfood > 0 && sponsorMerchant > 0) sponsorLabel = "iFood + Restaurante";
          else if (sponsorIfood > 0) sponsorLabel = "iFood";
          else if (sponsorMerchant > 0) sponsorLabel = "Restaurante";
          console.log("[ifood-polling][audit][coupon]", { orderId, couponCode, couponDiscount, sponsorIfood, sponsorMerchant, sponsorLabel });

          // ── Payment type + change (cash) ───────────────────────────────
          let paymentType = "Pago pelo iFood";
          let changeFor: number | null = null;
          const paymentsObj = orderData.payments;
          if (paymentsObj && Array.isArray(paymentsObj.methods) && paymentsObj.methods.length > 0) {
            const p = paymentsObj.methods[0];
            const pType = (p.type || "").toUpperCase();
            const pMethod = (p.method || p.name || "").toUpperCase();
            const isPrepaid = p.prepaid === true;

            if (pType === "ONLINE" || isPrepaid) {
              paymentType = "Pago pelo iFood";
            } else if (pMethod.includes("CREDIT")) {
              paymentType = "Cartão de Crédito";
            } else if (pMethod.includes("DEBIT")) {
              paymentType = "Cartão de Débito";
            } else if (pMethod.includes("PIX")) {
              paymentType = "PIX";
            } else if (pMethod.includes("CASH")) {
              paymentType = "Dinheiro";
              const cf = p.cash?.changeFor ?? p.changeFor ?? p.cash?.changeAmount;
              if (cf != null) changeFor = Number(cf);
            } else {
              paymentType = "Pago pelo iFood";
            }
          }

          // Customer CPF
          const customerCpf = orderData.customer?.documentNumber || "Não informado";

          // ── Customer observations / order notes from iFood ─────────────
          // iFood pode enviar a observação do cliente em vários campos
          // dependendo do canal/integração. Tentamos todos em cascata.
          const itemObs = Array.isArray(orderData.items)
            ? orderData.items
                .map((it: any) => it?.observations || it?.observation || "")
                .filter((s: string) => s && s.trim().length > 0)
                .join(" | ")
            : "";
          const customerObservation = String(
            orderData.observations ||
              orderData.extraInfo ||
              orderData.extra_info ||
              orderData.note ||
              orderData.notes ||
              orderData.comments ||
              orderData.customer?.observations ||
              orderData.customer?.note ||
              orderData.delivery?.observations ||
              orderData.delivery?.note ||
              itemObs ||
              ""
          ).trim();

          // ── Audit log (iFood) ─────────────────────────────────────────
          console.log("[ifood-polling][audit][customer]", {
            orderId,
            cpf: customerCpf,
            paymentType,
            changeFor,
            observation: customerObservation || "(vazio)",
          });

          // ── Build notes with delivery fee origin + scheduling + change + obs ──
          const noteParts: string[] = [`Pedido iFood #${orderId.slice(0, 8)}`];
          if (isScheduled && scheduledFor) {
            try {
              const dt = new Date(scheduledFor);
              noteParts.push(`AGENDADO: ${dt.toLocaleString("pt-BR")}`);
            } catch { noteParts.push(`AGENDADO: ${scheduledFor}`); }
          }
          if (isPickup) noteParts.push("RETIRADA NO LOCAL");
          if (deliveryFeeNum > 0) noteParts.push(`Taxa de entrega: iFood (R$ ${deliveryFeeNum.toFixed(2)})`);
          if (serviceFeeNum > 0) noteParts.push(`Taxa de serviço iFood: R$ ${serviceFeeNum.toFixed(2)}`);
          // Formato padrão reconhecido por parseChangeFor() no frontend ("Troco para: R$ X,YY")
          if (changeFor != null && changeFor > 0) noteParts.push(`Troco para: R$ ${changeFor.toFixed(2)}`);
          if (couponDiscount > 0) noteParts.push(`Voucher${couponCode ? ` (${couponCode})` : ""}: -R$ ${couponDiscount.toFixed(2)}`);
          if (sponsorLabel) noteParts.push(`Subsidiado por: ${sponsorLabel}`);
          if (customerObservation) noteParts.push(`Obs.: ${customerObservation}`);
          const orderNotes = noteParts.join(" | ");

          // Insert order
          const { data: insertedOrder, error: insertError } = await supabase
            .from("orders")
            .insert({
              restaurant_id,
              table_id: null,
              customer_name: customerName,
              customer_cpf: customerCpf,
              // Scheduled iFood orders sit in "scheduled" status until their delivery
              // time is reached; the frontend scheduler promotes them to "pending".
              status: isScheduled && scheduledFor ? "scheduled" : "pending",
              order_type: "delivery",
              delivery_type: deliveryTypeValue,
              delivery_address: isPickup ? null : deliveryAddress,
              delivery_phone: customerPhone,
              delivery_fee: isPickup ? 0 : deliveryFeeNum,
              service_fee: serviceFeeNum,
              payment_type: paymentType,
              ifood_order_id: orderId,
              ifood_display_id: orderData.displayId ? String(orderData.displayId) : null,
              ifood_merchant_id: merchantId || null,
              ifood_source: true,
              notes: orderNotes,
              coupon_code: couponCode,
              coupon_discount: couponDiscount,
              dd_scheduled_for: isScheduled && scheduledFor ? scheduledFor : null,
            })
            .select("id")
            .single();

          if (insertError) {
            console.error("Insert error:", insertError);
            continue;
          }

          if (insertedOrder) {
            newOrdersCount++;

            // ── Process items with PDV matching ───────────────────────────
            const insertItems: { itemData: any; extras: { name: string; price: number; matchedExtraId: string | null }[] }[] = [];

            if (orderData.items && orderData.items.length > 0) {
              for (const item of orderData.items) {
                const itemQty = item.quantity || 1;
                const itemName = item.name || "Item iFood";
                const externalCode = normalize(item.externalCode || "");

                // Base price: use totalPrice / qty (includes options)
                const rawUnitPrice = item.totalPrice != null
                  ? item.totalPrice / itemQty
                  : (item.unitPrice || item.price || 0);

                console.log(`[ifood-polling] ── ITEM: "${itemName}", externalCode="${item.externalCode || ""}", qty=${itemQty}, rawUnit=R$${rawUnitPrice.toFixed(2)}`);

                // ── Match product by externalCode → pdv_code, fallback by name ──
                let matchedProductId: string | null = null;

                if (externalCode) {
                  const match = productsList.find((p: any) => p.pdv_code && normalize(p.pdv_code) === externalCode);
                  if (match) {
                    matchedProductId = match.id;
                    console.log(`[ifood-polling]   ✓ MATCHED by externalCode "${item.externalCode}" → pdv_code "${match.pdv_code}" → "${match.name}"`);
                  }
                }

                if (!matchedProductId && itemName) {
                  const normalizedName = normalize(itemName);
                  let match = productsList.find((p: any) => normalize(p.name) === normalizedName);
                  if (!match) {
                    match = productsList.find((p: any) => normalize(p.name).includes(normalizedName) || normalizedName.includes(normalize(p.name)));
                  }
                  if (match) {
                    matchedProductId = match.id;
                    console.log(`[ifood-polling]   ✓ MATCHED by name "${itemName}" → "${match.name}"`);
                  } else {
                    console.log(`[ifood-polling]   ✗ No match for "${itemName}"`);
                  }
                }

                // ── Collect extras from options + customizations ──────────
                const collectedExtras: { name: string; price: number; matchedExtraId: string | null }[] = [];

                if (Array.isArray(item.options)) {
                  for (const opt of item.options) {
                    const optName = opt.name || "";
                    const optExternalCode = normalize(opt.externalCode || "");
                    const optPrice = opt.unitPrice || opt.price || 0;

                    if (!optName) continue;

                    // Try matching by externalCode → pdv_code in extra_category_items
                    let matchedExtraId: string | null = null;

                    if (optExternalCode) {
                      const extraMatch = extraCategoryItemsList.find((e: any) => e.pdv_code && normalize(e.pdv_code) === optExternalCode);
                      if (extraMatch) {
                        matchedExtraId = extraMatch.id;
                        console.log(`[ifood-polling]   ✓ OPTION "${optName}" matched by code "${opt.externalCode}" → "${extraMatch.name}"`);
                      }
                    }

                    if (!matchedExtraId) {
                      const normalizedOpt = normalize(optName);
                      const extraMatch = extraCategoryItemsList.find((e: any) => normalize(e.name) === normalizedOpt);
                      if (extraMatch) {
                        matchedExtraId = extraMatch.id;
                        console.log(`[ifood-polling]   ✓ OPTION "${optName}" matched by name → "${extraMatch.name}"`);
                      }
                    }

                    collectedExtras.push({ name: optName, price: optPrice, matchedExtraId });

                    // Also process customizations inside options
                    if (Array.isArray(opt.customization)) {
                      for (const cust of opt.customization) {
                        const custName = cust.name || "";
                        const custExternalCode = normalize(cust.externalCode || "");
                        const custPrice = cust.unitPrice || cust.price || 0;

                        if (!custName) continue;

                        let custMatchedId: string | null = null;

                        if (custExternalCode) {
                          const custMatch = extraCategoryItemsList.find((e: any) => e.pdv_code && normalize(e.pdv_code) === custExternalCode);
                          if (custMatch) {
                            custMatchedId = custMatch.id;
                            console.log(`[ifood-polling]   ✓ CUSTOMIZATION "${custName}" matched by code "${cust.externalCode}" → "${custMatch.name}"`);
                          }
                        }

                        if (!custMatchedId) {
                          const normalizedCust = normalize(custName);
                          const custMatch = extraCategoryItemsList.find((e: any) => normalize(e.name) === normalizedCust);
                          if (custMatch) {
                            custMatchedId = custMatch.id;
                          }
                        }

                        collectedExtras.push({ name: custName, price: custPrice, matchedExtraId: custMatchedId });
                      }
                    }
                  }
                }

                // ── Adjust base price: subtract extras to avoid double-counting ──
                const totalExtrasPrice = collectedExtras.reduce((sum, e) => sum + e.price, 0);
                const adjustedUnitPrice = totalExtrasPrice > 0 ? Math.max(0, rawUnitPrice - totalExtrasPrice) : rawUnitPrice;

                console.log(`[ifood-polling]   PRICING: raw=R$${rawUnitPrice.toFixed(2)}, extras=R$${totalExtrasPrice.toFixed(2)}, adjusted=R$${adjustedUnitPrice.toFixed(2)}, matched=${matchedProductId ? "YES" : "NO"}, extras_count=${collectedExtras.length}`);

                // Per-item observation from iFood (sem cebola, bem passado, etc.)
                const perItemObs = String(
                  item.observations || item.observation || item.notes || item.comments || ""
                ).trim();

                // Compor notes do item: prefixo [iFood] quando produto não casou + observação do cliente
                const notesParts: string[] = [];
                if (!matchedProductId) notesParts.push(`[iFood] ${itemName}`);
                if (perItemObs) notesParts.push(perItemObs);
                const itemNotes = notesParts.length > 0 ? notesParts.join(" — ") : null;

                if (perItemObs) {
                  console.log(`[ifood-polling][audit][item-obs] "${itemName}": ${perItemObs}`);
                }

                insertItems.push({
                  itemData: {
                    order_id: insertedOrder.id,
                    product_id: matchedProductId,
                    quantity: itemQty,
                    price_at_order: adjustedUnitPrice,
                    notes: itemNotes,
                  },
                  extras: collectedExtras,
                });
              }
            }

            // ── Insert all items + extras ─────────────────────────────────
            for (const entry of insertItems) {
              const { data: insertedItem, error: itemError } = await supabase
                .from("order_items")
                .insert(entry.itemData)
                .select("id")
                .single();

              if (itemError) {
                console.error("[ifood-polling] Error inserting item:", itemError);
                continue;
              }

              if (entry.extras.length > 0 && insertedItem) {
                const extrasToInsert = entry.extras.map((ex) => ({
                  order_item_id: insertedItem.id,
                  product_extra_id: null,
                  price_at_order: ex.price,
                  extra_name: ex.name,
                }));

                const { error: extrasError } = await supabase.from("order_item_extras").insert(extrasToInsert);
                if (extrasError) {
                  console.error("[ifood-polling] Error inserting extras:", extrasError);
                } else {
                  console.log(`[ifood-polling]   ✓ ${extrasToInsert.length} extras inserted for item ${insertedItem.id}`);
                }
              }
            }

            // Auto-flow trigger moved to a post-loop pass below so it fires regardless
            // of whether this event was the INSERT path (PLC) or an UPDATE path
            // (CFM/PRS/RTP/DSP) — and even if multiple events arrive in the same batch.
          }
        } catch (e) {
          console.error("Error processing iFood order:", e);
        }
      } else if (eventCode === "CONFIRMED") {
        if ((config as any)?.homologation_mode) continue;
        await supabase
          .from("orders")
          .update({ status: "accepted" })
          .eq("ifood_order_id", orderId)
          .eq("restaurant_id", restaurant_id);
      } else if (eventCode === "READY_TO_PICKUP" || eventCode === "RTP") {
        if ((config as any)?.homologation_mode) continue;
        await supabase
          .from("orders")
          .update({ status: "ready" })
          .eq("ifood_order_id", orderId)
          .eq("restaurant_id", restaurant_id);
      } else if (eventCode === "DISPATCHED" || eventCode === "DSP") {
        if ((config as any)?.homologation_mode) continue;
        await supabase
          .from("orders")
          .update({ status: "out_for_delivery" })
          .eq("ifood_order_id", orderId)
          .eq("restaurant_id", restaurant_id);
      } else if (eventCode === "CANCELLED" || eventCode === "CANCELLATION_REQUESTED" || eventCode === "CAN") {
        if ((config as any)?.homologation_mode) continue;
        const cancelReason =
          event.metadata?.cancellationReason ||
          event.metadata?.reason ||
          event.cancellationReason ||
          `Cancelado pelo iFood (${eventCode})`;
        await supabase
          .from("orders")
          .update({ status: "cancelled", cancellation_reason: cancelReason })
          .eq("ifood_order_id", orderId)
          .eq("restaurant_id", restaurant_id);
      } else if (eventCode === "CONCLUDED" || eventCode === "CONCLUSION" || eventCode === "CON") {
        if ((config as any)?.homologation_mode) continue;
        await supabase
          .from("orders")
          .update({ status: "delivered" })
          .eq("ifood_order_id", orderId)
          .eq("restaurant_id", restaurant_id);
      }
      } catch (perEventErr) {
        // Processing failed AFTER the ACK was already sent — log and continue.
        console.error(`[IFOOD_EVENT] processing error event_id=${event.id} full_code=${eventCode} order_id=${orderId ?? "null"} exception=${(perEventErr as Error).message}`);
      }
    }

    // ── Post-loop AUTO-FLOW pass ─────────────────────────────────────────
    // Runs once per unique iFood order touched in this batch, regardless of
    // whether the event was a new INSERT (PLC) or just an UPDATE (CFM/PRS/RTP/DSP).
    // Idempotent: runAutoIfoodFlow skips steps already reflected in the local status.
    if (touchedIfoodOrderIds.size > 0) {
      try {
        const { data: rest } = await supabase
          .from("restaurants")
          .select("auto_accept_orders")
          .eq("id", restaurant_id)
          .maybeSingle();
        const autoAccept = !!rest?.auto_accept_orders;
        const homologationMode = !!(config as any)?.homologation_mode;

        for (const ifoodOrderId of touchedIfoodOrderIds) {
          try {
            const { data: localOrder } = await supabase
              .from("orders")
              .select("id, status, delivery_type, dd_scheduled_for")
              .eq("ifood_order_id", ifoodOrderId)
              .eq("restaurant_id", restaurant_id)
              .maybeSingle();

            if (!localOrder) {
              console.log(`[IFOOD_AUTO_FLOW] skip order_id=${ifoodOrderId} reason=local_order_not_found`);
              continue;
            }

            // Infer order timing from dd_scheduled_for (SCHEDULED orders carry it set).
            const orderTiming = localOrder.dd_scheduled_for ? "SCHEDULED" : "IMMEDIATE";

            await runAutoIfoodFlow({
              supabase,
              accessToken,
              merchantId,
              tokenMerchantId,
              ifoodOrderId,
              localOrderId: localOrder.id,
              deliveryType: localOrder.delivery_type,
              orderTiming,
              autoAccept,
              homologationMode,
              currentStatus: localOrder.status,
            });
          } catch (perOrderErr) {
            console.error(`[IFOOD_AUTO_FLOW] error order_id=${ifoodOrderId} exception=${(perOrderErr as Error).message}`);
          }
        }
      } catch (outerErr) {
        console.error(`[IFOOD_AUTO_FLOW] error outer exception=${(outerErr as Error).message}`);
      }
    }


    // Per-event ACK is now performed immediately at the top of the event loop
    // (see ackSingleEvent above). The previous batch ACK block was removed to
    // guarantee SLA: ACK happens BEFORE any processing and cannot be skipped
    // by downstream exceptions. eventIds contains only the events that were
    // successfully ACK'd individually (kept for the response payload below).

    // Update last polling time
    await supabase
      .from("ifood_config")
      .update({ last_polling_at: new Date().toISOString() })
      .eq("restaurant_id", restaurant_id);

    return new Response(
      JSON.stringify({ success: true, new_orders: newOrdersCount, events_processed: eventIds.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
    } finally {
      // Libera o lock SEMPRE — sucesso, erro ou exceção
      try {
        await supabase.rpc("release_polling_lock", { _key: lockKey });
        console.log(`[IFOOD_POLLING] lock_released merchant_id=${merchantId}`);
      } catch (releaseErr) {
        console.error(`[IFOOD_POLLING] lock_release_error merchant_id=${merchantId} error=${(releaseErr as Error).message}`);
      }
    }

  } catch (error) {
    console.error("ifood-polling error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

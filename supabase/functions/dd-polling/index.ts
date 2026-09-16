import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
};

const DD_ADMIN_API = "https://deliverydireto.com.br/admin-api/v1";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert DD Money object (cents) to decimal */
function money(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "object" && v.value !== undefined) return v.value / 100;
  if (typeof v === "number") return v / 100;
  return 0;
}

/** Normalize a string for comparison: trim, uppercase, collapse spaces */
function normalize(s: string | null | undefined): string {
  return (s || "").trim().toUpperCase().replace(/\s+/g, " ");
}

/** Map DD paymentMethod object to a human-readable label */
function mapPaymentLabel(pm: any, isOnlinePayment: boolean): string {
  if (isOnlinePayment) return "Pago Delivery Direto";
  if (!pm) return "Delivery Direto";

  const name = (pm.name || "").toLowerCase();

  if (name.includes("pix")) return "PIX";
  if (name.includes("dinheiro") || name.includes("cash")) return "Dinheiro";

  if (name.includes("crédito") || name.includes("credito")) {
    const brand = (pm.name || "").replace(/\s*\(.*\)\s*/, "").trim();
    return brand ? `Cartão de Crédito ${brand}` : "Cartão de Crédito";
  }

  if (name.includes("débito") || name.includes("debito")) {
    const brand = (pm.name || "").replace(/\s*\(.*\)\s*/, "").trim();
    return brand ? `Cartão de Débito ${brand}` : "Cartão de Débito";
  }

  if (name.includes("vale") || name.includes("voucher") || name.includes("refeição")) {
    return "Vale Refeição";
  }

  return pm.name || "Delivery Direto";
}

// ─── DD Status → Local Status ───────────────────────────────────────────────

const statusMap: Record<string, string> = {
  WAITING: "pending",
  PLACED: "pending",
  APPROVED: "accepted",
  CONFIRMED: "accepted",
  PREPARING: "preparing",
  IN_TRANSIT: "out_for_delivery",
  DISPATCHED: "out_for_delivery",
  READY: "ready",
  DONE: "delivered",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
  REJECTED: "cancelled",
};

// ─── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { restaurant_id } = await req.json();
    if (!restaurant_id) {
      return new Response(JSON.stringify({ error: "restaurant_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const DD_CLIENT_ID = Deno.env.get("DD_CLIENT_ID");
    const DD_CLIENT_SECRET = Deno.env.get("DD_CLIENT_SECRET");

    if (!DD_CLIENT_ID || !DD_CLIENT_SECRET) {
      return new Response(JSON.stringify({ new_orders: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Get config ──────────────────────────────────────────────────────────
    const { data: config } = await supabase
      .from("deliverydireto_config")
      .select("store_id, access_token, refresh_token, token_expires_at, last_sync_at, enabled")
      .eq("restaurant_id", restaurant_id)
      .maybeSingle();

    if (!config?.enabled || !config?.store_id) {
      return new Response(JSON.stringify({ new_orders: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Check / refresh token ───────────────────────────────────────────────
    let accessToken = config.access_token;
    if (config.token_expires_at) {
      const expiresAt = new Date(config.token_expires_at).getTime();
      if (expiresAt < Date.now() + 30 * 60 * 1000) {
        console.log("[dd-polling] Token expiring soon, refreshing...");
        try {
          const refreshRes = await fetch(`${supabaseUrl}/functions/v1/dd-auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "refresh_token", restaurant_id }),
          });
          const refreshData = await refreshRes.json();
          if (refreshData.access_token) {
            accessToken = refreshData.access_token;
            console.log("[dd-polling] Token refreshed successfully");
          } else if (refreshData.expired) {
            console.warn("[dd-polling] Token expired, needs re-auth");
            return new Response(JSON.stringify({ new_orders: 0, expired: true }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } catch (e) {
          console.warn("[dd-polling] Token refresh failed:", e);
        }
      }
    }

    if (!accessToken) {
      return new Response(JSON.stringify({ new_orders: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── DD request headers (required by Admin API) ──────────────────────────
    const ddHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "X-DeliveryDireto-Client-Id": DD_CLIENT_ID,
      "X-DeliveryDireto-Id": config.store_id,
      Accept: "application/json",
    };

    // ── Build query ─────────────────────────────────────────────────────────
    const now = new Date();
    const lastSync = config.last_sync_at
      ? new Date(config.last_sync_at)
      : new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const params = new URLSearchParams();
    params.set("lastModifiedStart", lastSync.toISOString());
    params.set("limit", "50");
    params.set("showItems", "true");
    params.set("showExtras", "true");
    params.set("showMetadata", "true");

    const ordersUrl = `${DD_ADMIN_API}/orders?${params.toString()}`;
    console.log(`[dd-polling] Fetching orders: ${ordersUrl}`);

    const ordersRes = await fetch(ordersUrl, { headers: ddHeaders });

    if (!ordersRes.ok) {
      const errText = await ordersRes.text();
      console.error(`[dd-polling] Orders fetch failed: status=${ordersRes.status}, body=${errText.substring(0, 500)}`);
      return new Response(JSON.stringify({ new_orders: 0, error: "Falha ao buscar pedidos" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ordersText = await ordersRes.text();
    let ordersData: any;
    try {
      ordersData = JSON.parse(ordersText);
    } catch {
      console.error("[dd-polling] Failed to parse JSON response");
      return new Response(JSON.stringify({ new_orders: 0, error: "Invalid JSON from DD API" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle various response shapes
    let ordersList: any[] = [];
    if (ordersData?.data?.orders && Array.isArray(ordersData.data.orders)) {
      ordersList = ordersData.data.orders;
    } else if (Array.isArray(ordersData)) {
      ordersList = ordersData;
    } else if (ordersData?.data && Array.isArray(ordersData.data)) {
      ordersList = ordersData.data;
    } else if (ordersData?.orders && Array.isArray(ordersData.orders)) {
      ordersList = ordersData.orders;
    }

    console.log(`[dd-polling] Found ${ordersList.length} orders from admin-api`);

    if (ordersList.length > 0) {
      const first = ordersList[0];
      console.log(`[dd-polling] First order keys: ${Object.keys(first).join(", ")}`);
      console.log(`[dd-polling] First order items count: ${(first.items || []).length}, compositeItems: ${(first.compositeItems || []).length}`);
    }

    // ── Pre-fetch products for matching (via categories join) ────────────────
    // IMPORTANT: products table has NO restaurant_id column.
    // Must join through categories to filter by restaurant.
    const { data: restaurantCategories } = await supabase
      .from("categories")
      .select("id")
      .eq("restaurant_id", restaurant_id);
    const categoryIds = (restaurantCategories || []).map((c: any) => c.id);

    let productsList: any[] = [];
    let extrasList: any[] = [];

    if (categoryIds.length > 0) {
      const { data: allProducts } = await supabase
        .from("products")
        .select("id, name, pdv_code, price")
        .in("category_id", categoryIds);
      productsList = allProducts || [];

      // Also fetch product extras for option/property matching
      if (productsList.length > 0) {
        const { data: allExtras } = await supabase
          .from("product_extras")
          .select("id, name, pdv_code, price, product_id")
          .in("product_id", productsList.map((p: any) => p.id));
        extrasList = allExtras || [];
      }
    }

    console.log(`[dd-polling] Loaded ${productsList.length} products, ${extrasList.length} extras for restaurant ${restaurant_id}`);
    if (productsList.length > 0) {
      console.log(`[dd-polling] Products with pdv_code: ${productsList.filter((p: any) => p.pdv_code).map((p: any) => `"${p.name}"→pdv="${p.pdv_code}"`).join(", ")}`);
    }

    let newOrdersCount = 0;

    for (const ddOrder of ordersList) {
      const ddOrderId = String(ddOrder.orderNumber || ddOrder.id || "");
      if (!ddOrderId) continue;

      // ── Check if already imported ───────────────────────────────────────
      const { data: existing } = await supabase
        .from("orders")
        .select("id")
        .eq("dd_order_id", ddOrderId)
        .eq("restaurant_id", restaurant_id)
        .maybeSingle();

      if (existing) {
        const ddStatus = ddOrder.status || "";
        const mappedStatus = statusMap[ddStatus] || null;
        if (mappedStatus) {
          await supabase
            .from("orders")
            .update({ status: mappedStatus })
            .eq("id", existing.id)
            .neq("status", mappedStatus);
        }
        continue;
      }

      // ── NEW ORDER ─────────────────────────────────────────────────────────

      const rawItems = ddOrder.items || [];
      const compositeItems = ddOrder.compositeItems || [];

      console.log(`[dd-polling] Order ${ddOrderId}: items=${rawItems.length}, compositeItems=${compositeItems.length}`);

      // If listing still returned empty items, try GET /orders/{id} as fallback
      let fullOrder = ddOrder;
      if (rawItems.length === 0 && compositeItems.length === 0) {
        const orderId = ddOrder.id || ddOrder.orderNumber;
        try {
          const detailUrl = `${DD_ADMIN_API}/orders/${orderId}?showItems=true&showExtras=true&showMetadata=true`;
          console.log(`[dd-polling] Items empty in listing, fetching detail: GET ${detailUrl}`);
          const detailRes = await fetch(detailUrl, { headers: ddHeaders });
          if (detailRes.ok) {
            const detailText = await detailRes.text();
            const detailData = JSON.parse(detailText);
            fullOrder = detailData?.data || detailData;
            console.log(`[dd-polling] Detail items: ${(fullOrder.items || []).length}, compositeItems: ${(fullOrder.compositeItems || []).length}`);
          } else {
            const errBody = await detailRes.text();
            console.warn(`[dd-polling] Detail fetch failed: status=${detailRes.status}, body=${errBody.substring(0, 500)}`);
          }
        } catch (e) {
          console.warn(`[dd-polling] Detail error:`, e);
        }
      }

      // ── Extract customer ────────────────────────────────────────────────
      const customer = fullOrder.customer || {};
      const customerName = customer.firstName
        ? `${customer.firstName || ""} ${customer.lastName || ""}`.trim()
        : (customer.name || "Cliente Delivery Direto");
      const customerPhone = customer.telephone || customer.phone || "";
      const customerCpf = customer.document || customer.cpf || "";

      // ── Order type ──────────────────────────────────────────────────────
      const ddType = (fullOrder.type || "").toUpperCase();
      const isPickup = ddType === "TAKEOUT" || ddType === "PICKUP";
      const deliveryType = isPickup ? "pickup" : "delivery";

      // ── Address ─────────────────────────────────────────────────────────
      const addr = fullOrder.address || null;
      const deliveryAddress = addr
        ? `${addr.street || ""}, ${addr.number || ""} - ${addr.neighborhood || ""}, ${addr.city || ""}`
        : null;

      // ── Payment ─────────────────────────────────────────────────────────
      const paymentMethod = fullOrder.paymentMethod || {};
      const isOnlinePayment = fullOrder.isOnlinePayment === true;
      const paymentLabel = mapPaymentLabel(paymentMethod, isOnlinePayment);
      console.log(`[dd-polling] Order ${ddOrderId} payment: name="${paymentMethod.name}", isOnline=${isOnlinePayment}, mapped="${paymentLabel}"`);

      // ── Status ──────────────────────────────────────────────────────────
      const orderStatus = statusMap[fullOrder.status || "WAITING"] || "pending";

      // ── Prices (cents → decimal) ────────────────────────────────────────
      const values = fullOrder.total || {};
      const deliveryFee = money(values.deliveryFee);

      // ── Scheduled ───────────────────────────────────────────────────────
      const scheduledFor = fullOrder.scheduledOrder || null;

      // ── Insert order ────────────────────────────────────────────────────
      const { data: newOrder, error: orderError } = await supabase
        .from("orders")
        .insert({
          restaurant_id,
          customer_name: customerName,
          customer_cpf: customerCpf,
          delivery_type: deliveryType,
          order_type: "delivery",
          delivery_address: deliveryAddress,
          delivery_phone: customerPhone,
          payment_type: paymentLabel,
          status: orderStatus,
          dd_source: true,
          dd_order_id: ddOrderId,
          delivery_fee: deliveryFee,
          notes: fullOrder.notes || null,
          dd_scheduled_for: scheduledFor,
        })
        .select("id")
        .single();

      if (orderError) {
        console.error(`[dd-polling] Error inserting order ${ddOrderId}:`, orderError);
        continue;
      }

      // ── Process items ───────────────────────────────────────────────────
      const allDDItems = fullOrder.items || [];
      const allCompositeItems = fullOrder.compositeItems || [];

      if (!allDDItems.length && !allCompositeItems.length) {
        console.warn(`[dd-polling] ⚠ Order ${ddOrderId} has NO items and NO compositeItems!`);
      }

      // Each entry: { itemData, extras[] }
      const insertItems: { itemData: any; extras: { name: string; price: number; matchedExtraId: string | null }[] }[] = [];

      // ── Process regular items ───────────────────────────────────────────
      for (const item of allDDItems) {
        const itemName = item.name || "Produto DD";
        const rawCustomCode = item.customCode ?? item.custom_code ?? item.externalCode ?? item.code ?? item.pdvCode ?? "";
        const customCode = normalize(String(rawCustomCode));
        const quantity = item.amount || item.quantity || 1;

        let unitPrice = 0;
        if (item.totalPrice !== undefined) {
          unitPrice = money(item.totalPrice) / (quantity || 1);
        } else if (item.unitPrice !== undefined) {
          unitPrice = money(item.unitPrice);
        } else if (item.price !== undefined) {
          unitPrice = money(item.price);
        }

        console.log(`[dd-polling] ── ITEM ──`);
        console.log(`[dd-polling]   name="${itemName}", customCode="${rawCustomCode}", normalized="${customCode}", qty=${quantity}, price=R$${unitPrice.toFixed(2)}`);
        console.log(`[dd-polling]   RAW item payload: ${JSON.stringify(item).substring(0, 800)}`);

        // Match product
        let matchedProductId: string | null = null;
        let matchRule = "none";

        if (customCode && customCode !== "") {
          const match = productsList.find((p: any) => p.pdv_code && normalize(p.pdv_code) === customCode);
          if (match) {
            matchedProductId = match.id;
            matchRule = `customCode "${rawCustomCode}" → pdv_code "${match.pdv_code}"`;
            if (unitPrice === 0 && match.price) unitPrice = match.price;
            console.log(`[dd-polling]   ✓ MATCHED by ${matchRule} → product "${match.name}" (${match.id})`);
          } else {
            console.log(`[dd-polling]   ✗ No product with pdv_code="${customCode}".`);
          }
        } else {
          console.log(`[dd-polling]   ℹ No customCode on this item`);
        }

        if (!matchedProductId && itemName) {
          const normalizedName = normalize(itemName);
          let match = productsList.find((p: any) => normalize(p.name) === normalizedName);
          if (!match) {
            match = productsList.find((p: any) => normalize(p.name).includes(normalizedName) || normalizedName.includes(normalize(p.name)));
          }
          if (match) {
            matchedProductId = match.id;
            matchRule = `name "${itemName}" → "${match.name}"`;
            if (unitPrice === 0 && match.price) unitPrice = match.price;
            console.log(`[dd-polling]   ✓ MATCHED by ${matchRule} (${match.id})`);
          } else {
            console.log(`[dd-polling]   ✗ No product matching name "${itemName}"`);
            matchRule = "FALLBACK (no match)";
          }
        }

        // ── Collect extras from properties, options, subitems ──────────
        const collectedExtras: { name: string; price: number; matchedExtraId: string | null }[] = [];

        // Properties (variações do DD — ex: "Sabor": ["Cheese Bacon"])
        if (item.properties && Array.isArray(item.properties)) {
          console.log(`[dd-polling]   PROPERTIES found: ${JSON.stringify(item.properties).substring(0, 500)}`);
          for (const prop of item.properties) {
            const propName = prop.name || prop.propertyName || "";
            const options = prop.options || prop.selectedOptions || prop.values || [];
            if (Array.isArray(options) && options.length > 0) {
              for (const opt of options) {
                const optName = opt.name || opt.optionName || opt.value || "";
                const optPrice = opt.price !== undefined ? money(opt.price) : 0;
                if (!optName) continue;

                // Try to match against product_extras
                let matchedExtraId: string | null = null;
                if (matchedProductId) {
                  const productExtras = extrasList.filter((e: any) => e.product_id === matchedProductId);
                  const normalizedOpt = normalize(optName);
                  const extraMatch = productExtras.find((e: any) => normalize(e.name) === normalizedOpt);
                  if (extraMatch) {
                    matchedExtraId = extraMatch.id;
                    console.log(`[dd-polling]   ✓ VARIATION "${optName}" matched extra "${extraMatch.name}" (${extraMatch.id})`);
                  } else {
                    console.log(`[dd-polling]   ℹ VARIATION "${optName}" no extra match, saving with name only`);
                  }
                }

                collectedExtras.push({ name: `${propName ? propName + ": " : ""}${optName}`, price: optPrice, matchedExtraId });
                console.log(`[dd-polling]   → VARIATION saved as EXTRA: "${propName}: ${optName}", price=R$${optPrice.toFixed(2)}, extraId=${matchedExtraId || "NULL"}`);
              }
            }
          }
        }

        // Options (complementos diretos)
        if (item.options && Array.isArray(item.options)) {
          console.log(`[dd-polling]   OPTIONS found: ${JSON.stringify(item.options).substring(0, 500)}`);
          for (const opt of item.options) {
            const optName = opt.name || opt.optionName || "";
            const optPrice = opt.price !== undefined ? money(opt.price) : 0;
            if (!optName) continue;

            let matchedExtraId: string | null = null;
            if (matchedProductId) {
              const productExtras = extrasList.filter((e: any) => e.product_id === matchedProductId);
              const normalizedOpt = normalize(optName);
              const extraMatch = productExtras.find((e: any) => normalize(e.name) === normalizedOpt);
              if (extraMatch) matchedExtraId = extraMatch.id;
            }

            collectedExtras.push({ name: optName, price: optPrice, matchedExtraId });
            console.log(`[dd-polling]   → OPTION saved as EXTRA: "${optName}", price=R$${optPrice.toFixed(2)}`);
          }
        }

        // Subitems (extras adicionais)
        if (item.subitems && Array.isArray(item.subitems)) {
          console.log(`[dd-polling]   SUBITEMS found: ${JSON.stringify(item.subitems).substring(0, 500)}`);
          for (const sub of item.subitems) {
            const siItem = sub.item || sub;
            const subName = siItem.name || sub.name || "";
            const subPrice = siItem.price !== undefined ? money(siItem.price) : (sub.price !== undefined ? money(sub.price) : 0);
            if (!subName) continue;

            let matchedExtraId: string | null = null;
            if (matchedProductId) {
              const productExtras = extrasList.filter((e: any) => e.product_id === matchedProductId);
              const normalizedSub = normalize(subName);
              const extraMatch = productExtras.find((e: any) => normalize(e.name) === normalizedSub);
              if (extraMatch) matchedExtraId = extraMatch.id;
            }

            collectedExtras.push({ name: subName, price: subPrice, matchedExtraId });
            console.log(`[dd-polling]   → SUBITEM saved as EXTRA: "${subName}", price=R$${subPrice.toFixed(2)}`);
          }
        }

        // Only keep real observations in notes (not variations)
        const itemNotes = item.observations || item.comments || "";

        // ── FIX: Avoid double-counting variation prices ──────────────────
        // DD's totalPrice/unitPrice already includes variation surcharges.
        // Since we persist variations as separate extras, subtract their
        // prices from the base to avoid counting them twice.
        const totalExtrasPrice = collectedExtras.reduce((sum, e) => sum + e.price, 0);
        const adjustedUnitPrice = totalExtrasPrice > 0 ? Math.max(0, unitPrice - totalExtrasPrice) : unitPrice;

        // Also look up the ERP base price for validation logging
        const erpBasePrice = matchedProductId
          ? productsList.find((p: any) => p.id === matchedProductId)?.price || 0
          : 0;

        console.log(`[dd-polling]   PRICING: DD unitPrice=R$${unitPrice.toFixed(2)}, extrasTotal=R$${totalExtrasPrice.toFixed(2)}, adjustedBase=R$${adjustedUnitPrice.toFixed(2)}, erpBase=R$${erpBasePrice.toFixed(2)}`);
        console.log(`[dd-polling]   SUBTOTAL CHECK: adjustedBase(${adjustedUnitPrice.toFixed(2)}) + extras(${totalExtrasPrice.toFixed(2)}) = R$${(adjustedUnitPrice + totalExtrasPrice).toFixed(2)}`);
        console.log(`[dd-polling]   FINAL: product_id=${matchedProductId || "NULL"}, rule=${matchRule}, extras=${collectedExtras.length}, notes="${itemNotes}"`);

        insertItems.push({
          itemData: {
            order_id: newOrder.id,
            product_id: matchedProductId,
            quantity,
            price_at_order: adjustedUnitPrice,
            notes: matchedProductId ? (itemNotes || null) : `[DD] ${itemName}${itemNotes ? ` - ${itemNotes}` : ""}`,
          },
          extras: collectedExtras,
        });
      }

      // ── Process composite items (pizzas, combos) ────────────────────────
      for (const composite of allCompositeItems) {
        const compositeName = composite.name || composite.compositeName || "Combo DD";
        const quantity = composite.amount || composite.quantity || 1;
        let totalPrice = 0;

        if (composite.totalPrice !== undefined) {
          totalPrice = money(composite.totalPrice);
        } else if (composite.price !== undefined) {
          totalPrice = money(composite.price);
        }

        const unitPrice = totalPrice / (quantity || 1);

        console.log(`[dd-polling] CompositeItem: "${compositeName}", qty=${quantity}, total=R$${totalPrice.toFixed(2)}`);

        const compositeExtras: { name: string; price: number; matchedExtraId: string | null }[] = [];
        const subItems = composite.items || composite.subItems || [];
        if (Array.isArray(subItems)) {
          for (const si of subItems) {
            const siItem = si.item || si;
            const subName = siItem.name || si.name || "";
            const subPrice = siItem.price !== undefined ? money(siItem.price) : 0;
            if (subName) {
              compositeExtras.push({ name: subName, price: subPrice, matchedExtraId: null });
            }
          }
        }

        const customCode = normalize(composite.customCode || composite.custom_code || "");
        let matchedProductId: string | null = null;

        if (customCode) {
          const match = productsList.find((p: any) => p.pdv_code && normalize(p.pdv_code) === customCode);
          if (match) {
            matchedProductId = match.id;
            console.log(`[dd-polling] ✓ Composite matched by customCode "${customCode}" → "${match.name}"`);
          }
        }
        if (!matchedProductId) {
          const normalizedName = normalize(compositeName);
          let match = productsList.find((p: any) => normalize(p.name) === normalizedName);
          if (!match) {
            match = productsList.find((p: any) => normalize(p.name).includes(normalizedName) || normalizedName.includes(normalize(p.name)));
          }
          if (match) {
            matchedProductId = match.id;
            console.log(`[dd-polling] ✓ Composite matched by name "${compositeName}" → "${match.name}"`);
          }
        }

        insertItems.push({
          itemData: {
            order_id: newOrder.id,
            product_id: matchedProductId,
            quantity,
            price_at_order: unitPrice,
            notes: matchedProductId
              ? null
              : `[DD Combo] ${compositeName}`,
          },
          extras: compositeExtras,
        });
      }

      // ── Insert all items + extras ───────────────────────────────────────
      if (insertItems.length > 0) {
        console.log(`[dd-polling] Inserting ${insertItems.length} items for order ${ddOrderId}:`);

        for (const entry of insertItems) {
          const it = entry.itemData;
          console.log(`[dd-polling]   → product_id=${it.product_id || "NULL"}, qty=${it.quantity}, price=${it.price_at_order}, notes="${(it.notes || "").substring(0, 100)}", extras=${entry.extras.length}`);
        }

        // Insert items one by one to get IDs for extras
        for (const entry of insertItems) {
          const { data: insertedItem, error: itemError } = await supabase
            .from("order_items")
            .insert(entry.itemData)
            .select("id")
            .single();

          if (itemError) {
            console.error(`[dd-polling] Error inserting item:`, itemError);
            continue;
          }

          // Insert extras for this item
          if (entry.extras.length > 0 && insertedItem) {
            const extrasToInsert = entry.extras.map((ex) => ({
              order_item_id: insertedItem.id,
              product_extra_id: ex.matchedExtraId,
              price_at_order: ex.price,
              extra_name: ex.name,
            }));

            console.log(`[dd-polling]   Inserting ${extrasToInsert.length} extras for item ${insertedItem.id}:`);
            for (const ex of extrasToInsert) {
              console.log(`[dd-polling]     → extra_name="${ex.extra_name}", price=${ex.price_at_order}, extra_id=${ex.product_extra_id || "NULL"}`);
            }

            const { error: extrasError } = await supabase.from("order_item_extras").insert(extrasToInsert);
            if (extrasError) {
              console.error(`[dd-polling] Error inserting extras:`, extrasError);
            } else {
              console.log(`[dd-polling]   ✓ ${extrasToInsert.length} extras inserted as structured complements`);
            }
          }
        }

        console.log(`[dd-polling] ✓ All items+extras inserted for order ${ddOrderId}`);
      }

      newOrdersCount++;
      console.log(`[dd-polling] ✓ New order imported: DD#${ddOrderId} → ${newOrder.id} (${insertItems.length} items)`);
    }

    // ── Update last_sync_at ─────────────────────────────────────────────────
    await supabase
      .from("deliverydireto_config")
      .update({ last_sync_at: now.toISOString() })
      .eq("restaurant_id", restaurant_id);

    console.log(`[dd-polling] Done. New orders: ${newOrdersCount}`);
    return new Response(JSON.stringify({ success: true, new_orders: newOrdersCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[dd-polling] Unexpected error:", err);
    return new Response(JSON.stringify({ new_orders: 0, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

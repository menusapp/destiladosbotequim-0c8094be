import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
};

const DD_STORE_API_BASE = "https://deliverydireto.com.br/admin-api";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, restaurant_id, store_id, username, password } = await req.json();
    console.log(`[dd-auth] action=${action}, restaurant_id=${restaurant_id}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const DD_CLIENT_ID = Deno.env.get("DD_CLIENT_ID");
    const DD_CLIENT_SECRET = Deno.env.get("DD_CLIENT_SECRET");

    if (!DD_CLIENT_ID || !DD_CLIENT_SECRET) {
      console.error("[dd-auth] Missing DD_CLIENT_ID or DD_CLIENT_SECRET");
      return new Response(JSON.stringify({ error: "Credenciais do Delivery Direto não configuradas" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "connect") {
      if (!store_id || !username || !password) {
        return new Response(JSON.stringify({ error: "Store ID, username e password são obrigatórios" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Authenticate with DD store-api using password grant
      console.log("[dd-auth] Requesting token from store-api...");
      const tokenRes = await fetch(`${DD_STORE_API_BASE}/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-DeliveryDireto-Client-Id": DD_CLIENT_ID,
          "X-DeliveryDireto-Id": store_id,
        },
        body: new URLSearchParams({
          grant_type: "password",
          client_id: DD_CLIENT_ID,
          client_secret: DD_CLIENT_SECRET,
          username: username.trim(),
          password: password.trim(),
        }).toString(),
      });

      const tokenText = await tokenRes.text();
      console.log(`[dd-auth] Token response status=${tokenRes.status}`);

      if (!tokenRes.ok) {
        console.error(`[dd-auth] Token error: ${tokenText}`);
        return new Response(JSON.stringify({ error: `Erro na autenticação: ${tokenText}` }), {
          status: tokenRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tokenData = JSON.parse(tokenText);
      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token || null;
      const expiresIn = tokenData.expires_in || 21600;
      const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      console.log(`[dd-auth] Token obtained, expires_in=${expiresIn}, has_refresh=${!!refreshToken}`);

      // Save config
      const { error: upsertError } = await supabase
        .from("deliverydireto_config")
        .upsert({
          restaurant_id,
          store_id,
          username,
          client_id: DD_CLIENT_ID,
          access_token: accessToken,
          refresh_token: refreshToken,
          token_expires_at: tokenExpiresAt,
          enabled: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: "restaurant_id" });

      if (upsertError) {
        console.error("[dd-auth] DB upsert error:", upsertError);
        return new Response(JSON.stringify({ error: "Erro ao salvar configuração" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Register webhooks (non-blocking)
      console.log("[dd-auth] Registering webhooks...");
      const webhookUrl = `${supabaseUrl}/functions/v1/dd-webhook`;

      try {
        for (const event of ["ORDER_PLACED", "ORDER_STATUS_CHANGED"]) {
          const whRes = await fetch(`${DD_STORE_API_BASE}/v1/webhooks`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${accessToken}`,
              "X-DeliveryDireto-Client-Id": DD_CLIENT_ID,
              "X-DeliveryDireto-Id": store_id,
            },
            body: JSON.stringify({ url: webhookUrl, event }),
          });
          const whText = await whRes.text();
          console.log(`[dd-auth] Webhook ${event}: status=${whRes.status}, body=${whText}`);
        }
      } catch (whErr) {
        console.warn("[dd-auth] Webhook registration failed (non-blocking):", whErr);
      }

      console.log("[dd-auth] Connection successful!");
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "disconnect") {
      await supabase
        .from("deliverydireto_config")
        .update({
          enabled: false,
          access_token: null,
          refresh_token: null,
          token_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("restaurant_id", restaurant_id);

      console.log("[dd-auth] Disconnected successfully");
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "refresh_token") {
      return await refreshTokenFn(supabase, restaurant_id, DD_CLIENT_ID, DD_CLIENT_SECRET);
    }

    return new Response(JSON.stringify({ error: "Ação inválida" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[dd-auth] Unexpected error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function refreshTokenFn(supabase: any, restaurantId: string, clientId: string, clientSecret: string) {
  console.log("[dd-auth] Refreshing token...");

  const { data: config } = await supabase
    .from("deliverydireto_config")
    .select("store_id, username, refresh_token, access_token, token_expires_at")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (!config?.store_id) {
    return new Response(JSON.stringify({ error: "Config não encontrada" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Check if token is still valid (> 5 min remaining)
  if (config.token_expires_at) {
    const expiresAt = new Date(config.token_expires_at).getTime();
    const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
    if (expiresAt > fiveMinFromNow) {
      console.log("[dd-auth] Token still valid, skipping refresh");
      return new Response(JSON.stringify({ success: true, access_token: config.access_token }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  if (!config.refresh_token) {
    console.warn("[dd-auth] No refresh_token available, re-auth needed");
    return new Response(JSON.stringify({ error: "Token expirado. Reconecte a integração.", expired: true }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log("[dd-auth] Using refresh_token to get new access_token...");
  const tokenRes = await fetch(`${DD_STORE_API_BASE}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-DeliveryDireto-Client-Id": clientId,
      "X-DeliveryDireto-Id": config.store_id,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: config.refresh_token,
    }).toString(),
  });

  const tokenText = await tokenRes.text();
  console.log(`[dd-auth] Refresh response status=${tokenRes.status}`);

  if (!tokenRes.ok) {
    console.error(`[dd-auth] Refresh error: ${tokenText}`);
    return new Response(JSON.stringify({ error: "Falha ao renovar token. Reconecte a integração.", expired: true }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const tokenData = JSON.parse(tokenText);
  const newAccessToken = tokenData.access_token;
  const newRefreshToken = tokenData.refresh_token || config.refresh_token;
  const expiresIn = tokenData.expires_in || 21600;
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  await supabase
    .from("deliverydireto_config")
    .update({
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      token_expires_at: tokenExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("restaurant_id", restaurantId);

  console.log("[dd-auth] Token refreshed successfully");
  return new Response(JSON.stringify({ success: true, access_token: newAccessToken }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

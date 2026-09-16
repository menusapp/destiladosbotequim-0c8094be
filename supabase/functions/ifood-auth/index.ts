import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
};

const IFOOD_API = "https://merchant-api.ifood.com.br";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const clientId = Deno.env.get("IFOOD_CLIENT_ID");
    const clientSecret = Deno.env.get("IFOOD_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return new Response(
        JSON.stringify({ error: "iFood credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { action, restaurant_id, authorization_code } = await req.json();

    if (!restaurant_id) {
      return new Response(
        JSON.stringify({ error: "restaurant_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "generate_code") {
      // Request userCode from iFood
      const response = await fetch(`${IFOOD_API}/authentication/v1.0/oauth/userCode`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ clientId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return new Response(
          JSON.stringify({ error: "Failed to generate iFood code", details: errorText }),
          { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await response.json();

      // Save the verifier returned by iFood (not a locally generated one)
      await supabase
        .from("ifood_config")
        .upsert({
          restaurant_id,
          authorization_code_verifier: data.authorizationCodeVerifier,
          updated_at: new Date().toISOString(),
        }, { onConflict: "restaurant_id" });

      return new Response(
        JSON.stringify({
          userCode: data.userCode,
          verificationUrl: data.verificationUrl,
          verificationUrlComplete: data.verificationUrlComplete,
          authorizationCodeVerifier: data.authorizationCodeVerifier,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "exchange_token") {
      if (!authorization_code) {
        return new Response(
          JSON.stringify({ error: "authorization_code is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get verifier from DB
      const { data: config } = await supabase
        .from("ifood_config")
        .select("authorization_code_verifier")
        .eq("restaurant_id", restaurant_id)
        .single();

      if (!config?.authorization_code_verifier) {
        return new Response(
          JSON.stringify({ error: "No verifier found. Generate a code first." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Exchange authorization code for tokens
      const response = await fetch(`${IFOOD_API}/authentication/v1.0/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grantType: "authorization_code",
          clientId,
          clientSecret,
          authorizationCode: authorization_code,
          authorizationCodeVerifier: config.authorization_code_verifier,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return new Response(
          JSON.stringify({ error: "Failed to exchange token", details: errorText }),
          { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tokenData = await response.json();
      const expiresAt = new Date(Date.now() + tokenData.expiresIn * 1000).toISOString();

      // Extract merchant_id from JWT payload (works even when /merchants endpoint fails)
      let merchantId = null;
      try {
        const jwtParts = tokenData.accessToken.split(".");
        if (jwtParts.length >= 2) {
          const payload = JSON.parse(atob(jwtParts[1]));
          const merchantScope = payload.merchant_scope;
          if (Array.isArray(merchantScope) && merchantScope.length > 0) {
            merchantId = merchantScope[0].split(":")[0];
          }
          if (!merchantId) {
            merchantId = payload.merchant_id || payload.merchantId || null;
          }
        }
      } catch (_) { /* JWT decode failed */ }

      // Fallback: try /merchants endpoint
      if (!merchantId) {
        try {
          const merchantRes = await fetch(`${IFOOD_API}/merchant/v1.0/merchants`, {
            headers: { Authorization: `Bearer ${tokenData.accessToken}` },
          });
          if (merchantRes.ok) {
            const merchants = await merchantRes.json();
            if (merchants.length > 0) merchantId = merchants[0].id;
          }
        } catch (_) { /* merchant fetch is optional */ }
      }

      // Save tokens
      await supabase
        .from("ifood_config")
        .upsert({
          restaurant_id,
          access_token: tokenData.accessToken,
          refresh_token: tokenData.refreshToken,
          token_expires_at: expiresAt,
          merchant_id: merchantId,
          enabled: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: "restaurant_id" });

      return new Response(
        JSON.stringify({ success: true, merchant_id: merchantId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "disconnect") {
      await supabase
        .from("ifood_config")
        .update({
          enabled: false,
          access_token: null,
          refresh_token: null,
          token_expires_at: null,
          merchant_id: null,
          authorization_code_verifier: null,
          updated_at: new Date().toISOString(),
        })
        .eq("restaurant_id", restaurant_id);

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Use generate_code, exchange_token, or disconnect." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("ifood-auth error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

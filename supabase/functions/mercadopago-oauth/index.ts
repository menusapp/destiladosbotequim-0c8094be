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

  // GET: return client_id for frontend OAuth redirect
  if (req.method === "GET") {
    const clientId = Deno.env.get("MERCADOPAGO_APP_ID");
    if (!clientId) {
      return new Response(
        JSON.stringify({ error: "MERCADOPAGO_APP_ID not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ client_id: clientId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // POST: exchange authorization code for tokens
  if (req.method === "POST") {
    try {
      const { code, state, redirectUri } = await req.json();

      if (!code || !state || !redirectUri) {
        return new Response(
          JSON.stringify({ error: "Missing required fields: code, state, redirectUri" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const clientId = Deno.env.get("MERCADOPAGO_APP_ID");
      const clientSecret = Deno.env.get("MERCADOPAGO_CLIENT_SECRET");

      if (!clientId || !clientSecret) {
        return new Response(
          JSON.stringify({ error: "Mercado Pago credentials not configured on server" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Exchange code for tokens
      const tokenResponse = await fetch("https://api.mercadopago.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_secret: clientSecret,
          client_id: clientId,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok || !tokenData.access_token) {
        console.error("MP OAuth token error:", tokenData);
        return new Response(
          JSON.stringify({ error: tokenData.message || "Failed to exchange code for tokens" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Save tokens using service role (bypass RLS)
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      // Calculate token_expires_at from expires_in (seconds)
      const tokenExpiresAt = tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : null;

      const { error: updateError } = await supabaseAdmin
        .from("online_payment_config")
        .update({
          mp_access_token: tokenData.access_token,
          mp_public_key: tokenData.public_key,
          mp_refresh_token: tokenData.refresh_token,
          mp_user_id: String(tokenData.user_id),
          connection_status: "connected",
          connected_at: new Date().toISOString(),
          token_expires_at: tokenExpiresAt,
          provider: "mercadopago",
          enabled: false,
        })
        .eq("id", state);

      if (updateError) {
        console.error("DB update error:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to save credentials" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("mercadopago-oauth error:", err);
      return new Response(
        JSON.stringify({ error: err.message || "Internal error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
});

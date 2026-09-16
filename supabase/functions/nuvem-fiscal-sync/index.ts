// DISABLED — This function was causing excessive API consumption.
// It is intentionally a no-op to prevent any further Nuvem Fiscal calls.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-app-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Return immediately without making ANY external API calls
  return new Response(
    JSON.stringify({ synced: 0, message: "Sync desativado temporariamente" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

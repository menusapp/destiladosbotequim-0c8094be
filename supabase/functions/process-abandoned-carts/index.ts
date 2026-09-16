import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-app-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    // Find sessions that should be marked as abandoned
    const { data: sessions, error: fetchError } = await supabase
      .from("customer_sessions")
      .select("id")
      .in("status", ["cart_added", "checkout_started"])
      .lt("last_activity", twoHoursAgo);

    if (fetchError) throw fetchError;

    if (!sessions || sessions.length === 0) {
      return new Response(
        JSON.stringify({ message: "No sessions to abandon", count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ids = sessions.map((s: any) => s.id);

    const { error: updateError } = await supabase
      .from("customer_sessions")
      .update({
        status: "abandoned",
        abandoned_at: new Date().toISOString(),
      })
      .in("id", ids);

    if (updateError) throw updateError;

    return new Response(
      JSON.stringify({ message: "Processed abandoned carts", count: ids.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing abandoned carts:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

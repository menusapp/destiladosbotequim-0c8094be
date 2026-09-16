import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-app-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Expire trial subscriptions that are past due
    const { data: expiredSubs, error: subError } = await supabase
      .from("restaurant_subscriptions")
      .select("id, restaurant_id")
      .eq("is_trial", true)
      .eq("status", "active")
      .lt("trial_ends_at", new Date().toISOString());

    if (subError) {
      console.error("[check-trial-expiry] Error fetching expired trials:", subError);
      return new Response(JSON.stringify({ error: subError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hasExpired = expiredSubs && expiredSubs.length > 0;
    const restaurantIds = hasExpired ? expiredSubs.map((s) => s.restaurant_id) : [];
    const subIds = hasExpired ? expiredSubs.map((s) => s.id) : [];

    if (hasExpired) {
      const { error: updateSubError } = await supabase
        .from("restaurant_subscriptions")
        .update({ status: "expired" })
        .in("id", subIds);

      if (updateSubError) {
        console.error("[check-trial-expiry] Error updating subscriptions:", updateSubError);
      }

      const { error: updateRestError } = await supabase
        .from("restaurants")
        .update({ trial_expired: true })
        .in("id", restaurantIds);

      if (updateRestError) {
        console.error("[check-trial-expiry] Error updating restaurants:", updateRestError);
      }
    }

    console.log(`[check-trial-expiry] Expired ${hasExpired ? expiredSubs.length : 0} trials`);

    // ============================================================
    // 2. Período de graça expirado → downgrade para plano free
    // ============================================================
    const { data: expiredGrace } = await supabase
      .from("restaurant_subscriptions")
      .select("id, restaurant_id, plan_id")
      .eq("in_grace_period", true)
      .eq("status", "past_due")
      .lt("grace_period_ends_at", new Date().toISOString());

    let graceDowngraded = 0;
    if (expiredGrace && expiredGrace.length > 0) {
      // Buscar plano "free" / mais barato
      const { data: freePlan } = await supabase
        .from("subscription_plans")
        .select("id")
        .or("name.ilike.%free%,name.ilike.%gratuit%")
        .eq("is_active", true)
        .order("price", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (freePlan) {
        for (const sub of expiredGrace) {
          await supabase
            .from("restaurant_subscriptions")
            .update({
              plan_id: freePlan.id,
              status: "downgraded_free",
              in_grace_period: false,
              grace_period_start: null,
              grace_period_ends_at: null,
            })
            .eq("id", sub.id);
          graceDowngraded++;
          console.log("[check-trial-expiry] Restaurant downgraded to free:", sub.restaurant_id);
        }
      } else {
        console.warn("[check-trial-expiry] No free plan found, marking grace as expired only");
        for (const sub of expiredGrace) {
          await supabase
            .from("restaurant_subscriptions")
            .update({ status: "expired", in_grace_period: false })
            .eq("id", sub.id);
        }
      }
    }

    // ============================================================
    // 3. Downgrades agendados que chegaram na data
    // ============================================================
    const today = new Date();
    const todayDate = today.toISOString().split("T")[0];
    const { data: pendingDowngrades } = await supabase
      .from("restaurant_subscriptions")
      .select("id, pending_downgrade_plan_id")
      .not("pending_downgrade_plan_id", "is", null)
      .lte("pending_downgrade_at", todayDate);

    let downgradesApplied = 0;
    for (const sub of pendingDowngrades || []) {
      await supabase
        .from("restaurant_subscriptions")
        .update({
          plan_id: sub.pending_downgrade_plan_id,
          pending_downgrade_plan_id: null,
          pending_downgrade_at: null,
        })
        .eq("id", sub.id);
      downgradesApplied++;
    }

    return new Response(
      JSON.stringify({
        expired: hasExpired ? expiredSubs.length : 0,
        restaurant_ids: restaurantIds,
        grace_downgraded: graceDowngraded,
        scheduled_downgrades_applied: downgradesApplied,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[check-trial-expiry] Unhandled error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

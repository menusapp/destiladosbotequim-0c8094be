import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-app-token",
};

const RENEWAL_DAY = 5;

function getNextRenewalDate(): Date {
  const today = new Date();
  const next = new Date(today);
  if (today.getDate() >= RENEWAL_DAY) {
    next.setMonth(next.getMonth() + 1);
  }
  next.setDate(RENEWAL_DAY);
  next.setHours(0, 0, 0, 0);
  return next;
}

function daysUntilRenewal(): number {
  const next = getNextRenewalDate();
  const diff = next.getTime() - Date.now();
  return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function calculateProrateAmount(
  currentPrice: number,
  targetPrice: number,
  daysLeft: number
): number {
  const totalDays = 30;
  const dailyDiff = (targetPrice - currentPrice) / totalDays;
  return Math.max(0, Math.round(dailyDiff * daysLeft * 100) / 100);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const jsonOk = (body: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: true, ...body }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  const jsonErr = (error: string) =>
    new Response(JSON.stringify({ ok: false, error }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const { restaurant_id, action, target_plan_id } = await req.json();

    if (!restaurant_id || !action || !target_plan_id) {
      return jsonErr("Parâmetros obrigatórios: restaurant_id, action, target_plan_id");
    }

    if (!["upgrade", "downgrade"].includes(action)) {
      return jsonErr("action deve ser 'upgrade' ou 'downgrade'");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Buscar plano alvo
    const { data: targetPlan, error: tpErr } = await supabase
      .from("subscription_plans")
      .select("id, name, price")
      .eq("id", target_plan_id)
      .maybeSingle();

    if (tpErr || !targetPlan) {
      return jsonErr("Plano alvo não encontrado");
    }

    // 2. Buscar assinatura ativa atual (robusto contra duplicatas)
    const { data: currentSubs } = await supabase
      .from("restaurant_subscriptions")
      .select("id, plan_id, status, subscription_plans!restaurant_subscriptions_plan_id_fkey(name, price)")
      .eq("restaurant_id", restaurant_id)
      .in("status", ["active", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1);

    const currentSub = currentSubs?.[0] ?? null;
    const currentPrice = (currentSub?.subscription_plans as any)?.price || 0;

    // 3. Buscar link MP do plano alvo
    const { data: planLink } = await supabase
      .from("plan_payment_links")
      .select("mp_subscription_link")
      .eq("plan_id", target_plan_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!planLink?.mp_subscription_link) {
      return jsonErr("Link de pagamento não configurado para este plano. Contate o suporte.");
    }

    const mpUrl = new URL(planLink.mp_subscription_link);
    mpUrl.searchParams.set("external_reference", restaurant_id);

    const daysLeft = daysUntilRenewal();
    const renewalDate = getNextRenewalDate();

    if (action === "upgrade") {
      const prorate = calculateProrateAmount(currentPrice, targetPlan.price, daysLeft);

      // Marcar upgrade pendente — webhook confirmará após pagamento
      if (currentSub) {
        await supabase
          .from("restaurant_subscriptions")
          .update({ pending_upgrade_plan_id: target_plan_id })
          .eq("id", currentSub.id);
      }

      return jsonOk({
        type: "upgrade",
        redirect_url: mpUrl.toString(),
        plan_name: targetPlan.name,
        plan_price: targetPlan.price,
        prorate_amount: prorate,
        days_until_renewal: daysLeft,
        renewal_date: renewalDate.toISOString().split("T")[0],
      });
    }

    // DOWNGRADE
    if (!currentSub) {
      return jsonErr("Não há assinatura ativa para fazer downgrade");
    }

    // Agendar downgrade — plano atual continua ativo até o dia 5
    await supabase
      .from("restaurant_subscriptions")
      .update({
        pending_downgrade_plan_id: target_plan_id,
        pending_downgrade_at: renewalDate.toISOString().split("T")[0],
      })
      .eq("id", currentSub.id);

    return jsonOk({
      type: "downgrade",
      redirect_url: mpUrl.toString(),
      plan_name: targetPlan.name,
      plan_price: targetPlan.price,
      days_until_renewal: daysLeft,
      renewal_date: renewalDate.toISOString().split("T")[0],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[manage-plan-change] Error:", msg);
    return jsonErr(msg);
  }
});

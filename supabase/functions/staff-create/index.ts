import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashSync } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-app-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PLAN_LIMITS: Record<string, number> = {
  basic: 1,
  intermediate: 5,
  advanced: Infinity as unknown as number,
};

function resolvePlanId(name?: string | null): "basic" | "intermediate" | "advanced" {
  const n = (name || "").toLowerCase();
  if (n.includes("avanç") || n.includes("avanc")) return "advanced";
  if (n.includes("interm")) return "intermediate";
  return "basic";
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = await req.json();
    const {
      restaurant_id,
      username,
      password,
      display_name,
      role,
      allowed_sections,
      can_manage_orders,
      receives_order_notifications,
    } = body || {};

    if (!restaurant_id) return json(200, { error: "restaurant_id obrigatório" });
    if (!username || typeof username !== "string" || username.trim().length < 3)
      return json(200, { error: "Usuário inválido (mín. 3 caracteres)" });
    if (!password || typeof password !== "string" || password.length < 6)
      return json(200, { error: "Senha inválida (mín. 6 caracteres)" });
    if (!display_name || typeof display_name !== "string" || display_name.trim().length < 2)
      return json(200, { error: "Nome inválido" });
    if (!role || !["admin", "staff"].includes(role))
      return json(200, { error: "Função inválida" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) Determine current plan + active staff count
    const { data: subRows } = await supabase
      .from("restaurant_subscriptions")
      .select("plan_id, status, subscription_plans!restaurant_subscriptions_plan_id_fkey(name)")
      .eq("restaurant_id", restaurant_id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);
    const planName: string | null = subRows?.[0]
      ? (subRows[0] as any).subscription_plans?.name ?? null
      : null;
    const planId = resolvePlanId(planName);
    const max = PLAN_LIMITS[planId];

    const { count } = await supabase
      .from("restaurant_staff")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurant_id)
      .eq("is_active", true);
    const current = count ?? 0;

    if (Number.isFinite(max) && current >= max) {
      return json(200, {
        error: `Seu plano permite no máximo ${max} usuário${max === 1 ? "" : "s"}. Faça upgrade para adicionar mais.`,
        plan_limit_reached: true,
      });
    }

    // 2) Username uniqueness within restaurant
    const { data: existing } = await supabase
      .from("restaurant_staff")
      .select("id")
      .eq("restaurant_id", restaurant_id)
      .eq("username", username.trim())
      .maybeSingle();
    if (existing) return json(200, { error: "Já existe um usuário com este login" });

    // 3) Hash & insert via RPC
    const password_hash = hashSync(password, 10);
    const sections = Array.isArray(allowed_sections) ? allowed_sections : [];

    const { data: newId, error: rpcErr } = await supabase.rpc("admin_upsert_staff", {
      p_restaurant_id: restaurant_id,
      p_username: username.trim(),
      p_password_hash: password_hash,
      p_display_name: display_name.trim(),
      p_role: role,
      p_allowed_sections: JSON.stringify(sections),
      p_can_manage_orders: can_manage_orders ?? true,
      p_receives_order_notifications: receives_order_notifications ?? true,
    });

    if (rpcErr) {
      console.error("[staff-create] rpc error", rpcErr);
      return json(200, { error: rpcErr.message || "Erro ao criar usuário" });
    }

    return json(200, { ok: true, id: newId });
  } catch (err) {
    console.error("[staff-create] fatal", err);
    return json(200, { error: (err as Error).message || "Erro interno" });
  }
});

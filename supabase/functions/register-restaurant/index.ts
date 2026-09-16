import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashSync } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-app-token",
};

const MP_PLAN_LINKS: Record<string, string> = {
  basico: "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=ce558ba8031d48e78c875adbe8af561a",
  intermediario: "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=fe9ff4a87e634b86a493887ab8737b17",
  avancado: "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=e0f8cd5628974aa180490d2b6e9d78ea",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("[register-restaurant] Received body keys:", Object.keys(body));

    const { name, slug, cnpj, phone, address, username, password, adminUsername, adminPassword, planSlug, email } = body;

    // Validation
    if (!name || typeof name !== "string" || name.trim().length < 2 || name.length > 200) {
      return new Response(JSON.stringify({ error: "Nome do restaurante inválido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!slug || typeof slug !== "string" || !/^[a-z0-9-]{3,50}$/.test(slug)) {
      return new Response(JSON.stringify({ error: "Slug inválido (apenas letras minúsculas, números e hífens, 3-50 caracteres)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!username || typeof username !== "string" || username.trim().length < 3 || username.length > 100) {
      return new Response(JSON.stringify({ error: "Usuário do restaurante inválido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!password || typeof password !== "string" || password.length < 6 || password.length > 100) {
      return new Response(JSON.stringify({ error: "Senha do restaurante deve ter pelo menos 6 caracteres" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!adminUsername || typeof adminUsername !== "string" || adminUsername.trim().length < 3 || adminUsername.length > 100) {
      return new Response(JSON.stringify({ error: "Usuário da conta admin inválido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!adminPassword || typeof adminPassword !== "string" || adminPassword.length < 6 || adminPassword.length > 100) {
      return new Response(JSON.stringify({ error: "Senha da conta admin deve ter pelo menos 6 caracteres" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!planSlug || !["basico", "intermediario", "avancado", "trial"].includes(planSlug)) {
      return new Response(JSON.stringify({ error: "Plano inválido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check slug uniqueness
    const { data: existingSlug } = await supabase
      .from("restaurants")
      .select("id")
      .eq("slug", slug.trim())
      .maybeSingle();

    if (existingSlug) {
      return new Response(JSON.stringify({ error: "Este slug já está em uso. Escolha outro." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Username uniqueness is enforced per-restaurant by the DB constraint
    // (restaurant_id, username). Same username across different restaurants is allowed.

    // Determine the actual plan
    const isTrial = planSlug === "trial";
    const isPaid = !isTrial;
    const actualPlanName = {
      trial: "Básico",
      basico: "Básico",
      intermediario: "Intermediário",
      avancado: "Avançado",
    }[planSlug] || "Básico";

    // Find the subscription plan
    const { data: plan } = await supabase
      .from("subscription_plans")
      .select("id, name")
      .eq("name", actualPlanName)
      .eq("is_active", true)
      .maybeSingle();

    if (!plan) {
      return new Response(JSON.stringify({ error: "Plano não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Hash password
    let passwordHash: string;
    let adminPasswordHash: string;
    try {
      passwordHash = hashSync(password);
      adminPasswordHash = hashSync(adminPassword);
    } catch (hashError) {
      console.error("[register-restaurant] bcrypt hash failed:", hashError);
      return new Response(JSON.stringify({ error: "Erro ao processar senha. Tente novamente." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Calculate dates
    const now = new Date();
    const trialEndsAt = isTrial ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) : null;

    // 1. Create restaurant
    const trimmedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return new Response(JSON.stringify({ error: "Email do responsável inválido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const restaurantInsert: any = {
      name: name.trim(),
      slug: slug.trim(),
      cnpj: cnpj?.trim() || null,
      endereco_fiscal: address?.trim() || null,
      mp_payer_email: trimmedEmail,
    };
    if (isTrial) {
      restaurantInsert.trial_started_at = now.toISOString();
      restaurantInsert.trial_ends_at = trialEndsAt!.toISOString();
      restaurantInsert.trial_expired = false;
    }
    if (isPaid) {
      restaurantInsert.pending_plan_slug = planSlug;
    }

    const { data: restaurant, error: restError } = await supabase
      .from("restaurants")
      .insert(restaurantInsert)
      .select("id")
      .single();

    if (restError || !restaurant) {
      console.error("[register-restaurant] Restaurant creation failed:", restError);
      return new Response(JSON.stringify({ error: "Erro ao criar restaurante: " + (restError?.message || "desconhecido") }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log("[register-restaurant] Restaurant created:", restaurant.id);

    // 2. Create credentials
    const { error: credError } = await supabase
      .from("restaurant_credentials")
      .insert({
        restaurant_id: restaurant.id,
        username: username.trim(),
        password_hash: passwordHash,
      });

    if (credError) {
      console.error("[register-restaurant] Credentials creation failed:", credError);
      await supabase.from("restaurants").delete().eq("id", restaurant.id);
      return new Response(JSON.stringify({ error: "Erro ao criar credenciais: " + credError.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3. Create staff admin account with separate credentials
    const { data: staffData, error: staffError } = await supabase
      .from("restaurant_staff")
      .insert({
        restaurant_id: restaurant.id,
        display_name: adminUsername.trim(),
        username: adminUsername.trim(),
        password_hash: adminPasswordHash,
        role: "admin",
        allowed_sections: JSON.stringify([]),
        is_active: true,
      })
      .select("id")
      .single();

    if (staffError) {
      console.error("[register-restaurant] Staff creation error:", staffError);
    }

    // 4. Create subscription
    const nextPayment = new Date();
    nextPayment.setMonth(nextPayment.getMonth() + 1);

    const subInsert: any = {
      restaurant_id: restaurant.id,
      plan_id: plan.id,
      started_at: now.toISOString(),
    };

    if (isTrial) {
      subInsert.status = "active";
      subInsert.is_trial = true;
      subInsert.next_payment_at = trialEndsAt!.toISOString();
    } else {
      // Paid plan: pending until MP webhook confirms
      subInsert.status = "pending_payment";
      subInsert.is_trial = false;
      subInsert.next_payment_at = nextPayment.toISOString();
      subInsert.failed_payments = 0;
    }

    const { error: subError } = await (supabase.from("restaurant_subscriptions" as any) as any).insert(subInsert);

    if (subError) {
      console.error("[register-restaurant] Subscription error (non-blocking):", subError);
    }

    console.log("[register-restaurant] Registration complete for slug:", slug.trim(), "plan:", planSlug);

    // Build response
    const response: any = { success: true, restaurantId: restaurant.id, slug: slug.trim(), isTrial, staffId: staffData?.id || null };

    // For paid plans, build MP redirect URL with external_reference
    if (isPaid && MP_PLAN_LINKS[planSlug]) {
      const mpUrl = new URL(MP_PLAN_LINKS[planSlug]);
      mpUrl.searchParams.set("external_reference", restaurant.id);
      response.redirectUrl = mpUrl.toString();
    }

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[register-restaurant] Unhandled error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

import { createClient } from "npm:@supabase/supabase-js@2";

// =====================================================================
// Scanner de gatilhos por AUSÊNCIA (rodado periodicamente por cron):
//   - abandoned_cart     → sessão marcada como abandonada no funil
//   - inactive_customer  → cliente que já comprou e sumiu há X tempo
//   - no_purchase        → cliente cadastrado que nunca comprou há X tempo
// O delay_value/delay_unit da regra é o LIMIAR de ausência. Para cada
// cliente elegível agenda 1 mensagem (dedup por regra+telefone para não
// mandar repetido a cada varredura). O envio em si é feito pelo
// marketing-scheduler quando scheduled_for vence.
// =====================================================================

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
};

const ABSENCE_TRIGGERS = ["abandoned_cart", "inactive_customer", "no_purchase"];

function delayMs(value: number, unit: string): number {
  const v = Number(value) || 0;
  switch (unit) {
    case "seconds": return v * 1000;
    case "minutes": return v * 60_000;
    case "hours": return v * 3_600_000;
    case "days": return v * 86_400_000;
    case "weeks": return v * 7 * 86_400_000;
    case "months": return v * 30 * 86_400_000; // aproximação
    default: return v * 60_000;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = Date.now();

    // Campanhas ativas + regras
    const { data: campaigns } = await supabase
      .from("marketing_campaigns")
      .select("id, name, restaurant_id, is_active, marketing_campaign_rules(*)")
      .eq("is_active", true);

    if (!campaigns || campaigns.length === 0) {
      return json({ scheduled: 0, message: "no active campaigns" });
    }

    const restaurantNameCache: Record<string, string> = {};
    const getRestaurantName = async (rid: string): Promise<string> => {
      if (restaurantNameCache[rid]) return restaurantNameCache[rid];
      const { data } = await supabase.from("restaurants").select("name").eq("id", rid).single();
      const name = data?.name || "Restaurante";
      restaurantNameCache[rid] = name;
      return name;
    };

    // cache de pedidos por restaurante → mapa cpf → data do último pedido
    const lastOrderByRestaurant: Record<string, Record<string, number>> = {};
    const loadLastOrders = async (rid: string): Promise<Record<string, number>> => {
      if (lastOrderByRestaurant[rid]) return lastOrderByRestaurant[rid];
      const map: Record<string, number> = {};
      const { data } = await supabase
        .from("orders")
        .select("customer_cpf, created_at")
        .eq("restaurant_id", rid);
      (data as any[] | null)?.forEach((o) => {
        if (!o.customer_cpf) return;
        const t = new Date(o.created_at).getTime();
        if (!map[o.customer_cpf] || t > map[o.customer_cpf]) map[o.customer_cpf] = t;
      });
      lastOrderByRestaurant[rid] = map;
      return map;
    };

    const toSchedule: any[] = [];

    for (const campaign of campaigns as any[]) {
      const rid = campaign.restaurant_id;
      const rules = (campaign.marketing_campaign_rules || []).filter((r: any) =>
        ABSENCE_TRIGGERS.includes(r.trigger_type)
      );
      if (!rules.length) continue;

      const restaurantName = await getRestaurantName(rid);

      for (const rule of rules) {
        const threshold = delayMs(rule.delay_value, rule.delay_unit);

        // dedup: telefones já agendados para esta regra (qualquer status)
        const { data: already } = await supabase
          .from("marketing_scheduled_messages")
          .select("customer_phone")
          .eq("rule_id", rule.id);
        const seen = new Set((already as any[] | null)?.map((m) => normPhone(m.customer_phone)) || []);

        // candidatos: [{ cpf, name, phone, scheduledFor }]
        const candidates: { cpf: string; name: string; phone: string; scheduledFor: Date }[] = [];

        if (rule.trigger_type === "abandoned_cart") {
          const { data: sessions } = await supabase
            .from("customer_sessions")
            .select("id, name, phone, abandoned_at")
            .eq("restaurant_id", rid)
            .eq("status", "abandoned")
            .not("phone", "is", null);
          for (const s of (sessions as any[] | null) || []) {
            if (!s.phone) continue;
            const abandonedAt = s.abandoned_at ? new Date(s.abandoned_at).getTime() : now;
            candidates.push({
              cpf: "",
              name: s.name || "cliente",
              phone: s.phone,
              scheduledFor: new Date(abandonedAt + threshold),
            });
          }
        } else {
          // inactive_customer / no_purchase → base é o CRM (customers)
          const { data: customers } = await supabase
            .from("customers")
            .select("cpf, name, phone, created_at")
            .eq("restaurant_id", rid)
            .not("phone", "is", null);
          const lastOrders = await loadLastOrders(rid);
          for (const c of (customers as any[] | null) || []) {
            if (!c.phone) continue;
            const last = c.cpf ? lastOrders[c.cpf] : undefined;
            if (rule.trigger_type === "inactive_customer") {
              // já comprou e o último pedido é mais antigo que o limiar
              if (last && now - last >= threshold) {
                candidates.push({ cpf: c.cpf || "", name: c.name || "cliente", phone: c.phone, scheduledFor: new Date(now) });
              }
            } else {
              // no_purchase: nunca comprou e cadastro mais antigo que o limiar
              const createdAt = c.created_at ? new Date(c.created_at).getTime() : now;
              if (!last && now - createdAt >= threshold) {
                candidates.push({ cpf: c.cpf || "", name: c.name || "cliente", phone: c.phone, scheduledFor: new Date(now) });
              }
            }
          }
        }

        for (const cand of candidates) {
          if (seen.has(normPhone(cand.phone))) continue;
          seen.add(normPhone(cand.phone)); // evita duplicar dentro da mesma varredura

          // cupom (opcional)
          let couponCode: string | null = null;
          let discountText = "";
          let validityText = "";
          if (rule.discount_type) {
            if (rule.coupon_id) {
              const { data: ex } = await supabase
                .from("coupons").select("code, valid_until, discount_type, discount_value").eq("id", rule.coupon_id).single();
              if (ex) {
                couponCode = ex.code;
                discountText = ex.discount_type === "percentage" ? `${ex.discount_value}%` : `R$ ${Number(ex.discount_value).toFixed(2)}`;
                validityText = ex.valid_until ? new Date(ex.valid_until).toLocaleDateString("pt-BR") : `${rule.discount_validity_days || 7} dias`;
              }
            }
            if (!couponCode) {
              couponCode = `MKT${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
              discountText = rule.discount_type === "percentage" ? `${rule.discount_value}%` : `R$ ${Number(rule.discount_value).toFixed(2)}`;
              const validUntil = new Date(now + (rule.discount_validity_days || 7) * 86_400_000);
              await supabase.from("coupons").insert({
                restaurant_id: rid, code: couponCode, discount_type: rule.discount_type,
                discount_value: rule.discount_value, min_order_value: 0, is_active: true,
                usage_limit: 1, valid_from: new Date(now).toISOString(), valid_until: validUntil.toISOString(),
              });
              validityText = validUntil.toLocaleDateString("pt-BR");
            }
          }

          const messageText = String(rule.message_template || "")
            .replace(/{nome}/g, cand.name)
            .replace(/{cupom}/g, couponCode || "")
            .replace(/{desconto}/g, discountText)
            .replace(/{produto}/g, "")
            .replace(/{categoria}/g, "")
            .replace(/{validade}/g, validityText)
            .replace(/{restaurante}/g, restaurantName);

          toSchedule.push({
            campaign_id: campaign.id,
            rule_id: rule.id,
            order_id: null,
            restaurant_id: rid,
            customer_cpf: cand.cpf || "",
            customer_name: cand.name,
            customer_phone: cand.phone,
            coupon_code: couponCode,
            message_text: messageText,
            scheduled_for: cand.scheduledFor.toISOString(),
            status: "pending",
          });
        }
      }
    }

    if (toSchedule.length > 0) {
      const { error } = await supabase.from("marketing_scheduled_messages").insert(toSchedule);
      if (error) throw error;
    }

    return json({ scheduled: toSchedule.length });
  } catch (error: any) {
    console.error("[marketing-absence-scanner] Error:", error);
    return json({ error: error?.message || "unknown" }, 500);
  }
});

function normPhone(p: string | null | undefined): string {
  return (p || "").replace(/\D/g, "");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

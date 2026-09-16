// issue-session-token
// -------------------------------------------------------------------------
// ⚠️  LEGADO — NÃO ESTÁ EM USO.
// O modelo abaixo (JWT assinado com o JWT Secret do projeto) foi substituído
// pela sessão no servidor: as RPCs create_staff_session / create_ceo_session
// gravam um token opaco em public.staff_sessions e o app o envia no header
// `x-app-token` (ver migration 20260723010000 e src/integrations/supabase/
// client.ts). O frontend NÃO chama esta function. Mantida só por histórico;
// o secret JWT_SECRET não precisa existir.
// -------------------------------------------------------------------------
// Valida credenciais (restaurante / staff / CEO) usando as RPCs existentes
// (SECURITY DEFINER, que já comparam o hash da senha) e, em caso de sucesso,
// emite um JWT ASSINADO carregando os claims restaurant_id / staff_id / role.
//
// Esse token é anexado pelo frontend como `Authorization: Bearer <token>` em
// todas as requisições ao PostgREST, fazendo o app operar como papel
// `authenticated` — o que permite que o RLS diferencie um funcionário
// legítimo de um visitante anônimo (que continua com a chave publishable).
//
// IMPORTANTE (ver runbook): defina o secret JWT_SECRET desta function igual
// ao "JWT Secret" do projeto (Supabase Dashboard → Project Settings → API →
// JWT Settings). Sem ele, o token não pode ser assinado / validado.
// -------------------------------------------------------------------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-app-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 7 dias — alinhado com a expiração de sessão do painel (src/lib/sessionExpiry.ts)
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Erro específico de configuração (secret ausente) — tratado como 200 com
// mensagem clara para o usuário, em vez de um 500 genérico.
class ConfigError extends Error {}

// Importa o JWT secret (HS256) do projeto para uso com a Web Crypto API.
async function getSigningKey(): Promise<CryptoKey> {
  const secret =
    Deno.env.get("JWT_SECRET") ??
    Deno.env.get("SUPABASE_JWT_SECRET") ??
    "";
  if (!secret) {
    throw new ConfigError(
      "Login indisponível: o segredo de assinatura (JWT_SECRET) não está configurado nesta função. Configure o secret JWT_SECRET com o JWT Secret do projeto e faça deploy novamente.",
    );
  }
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = await req.json().catch(() => ({}));
    const type: string = body?.type;
    const username: string = (body?.username ?? "").toString().trim();
    const password: string = (body?.password ?? "").toString();
    const restaurant_id: string | undefined = body?.restaurant_id;

    if (!type || !["staff", "ceo", "restaurant"].includes(type)) {
      return json(400, { error: "type inválido" });
    }
    if (!username || !password) {
      return json(400, { error: "Credenciais obrigatórias" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Claims base exigidos pelo PostgREST/GoTrue para tratar como autenticado.
    const claims: Record<string, unknown> = {
      role: "authenticated",
      aud: "authenticated",
    };
    let validatedRow: Record<string, unknown> | null = null;
    let subject = "";

    if (type === "staff") {
      if (!restaurant_id) return json(400, { error: "restaurant_id obrigatório" });
      const { data, error } = await supabase.rpc("validate_staff_credentials", {
        p_restaurant_id: restaurant_id,
        p_username: username,
        p_password: password,
      });
      if (error) return json(200, { error: error.message });
      const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
      if (!row) return json(200, { error: "Credenciais inválidas" });
      validatedRow = row;
      subject = String((row as any).staff_id);
      claims.restaurant_id = restaurant_id;
      claims.staff_id = (row as any).staff_id;
      claims.staff_role = (row as any).role;
    } else if (type === "restaurant") {
      const { data, error } = await supabase.rpc("validate_restaurant_credentials", {
        p_username: username,
        p_password: password,
      });
      if (error) return json(200, { error: error.message });
      const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
      if (!row) return json(200, { error: "Credenciais inválidas" });
      validatedRow = row;
      subject = String((row as any).restaurant_id);
      claims.restaurant_id = (row as any).restaurant_id;
    } else {
      // ceo
      const { data, error } = await supabase.rpc("validate_ceo_credentials", {
        p_username: username,
        p_password: password,
      });
      if (error) return json(200, { error: error.message });
      const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
      if (!row) return json(200, { error: "Credenciais inválidas" });
      validatedRow = row;
      subject = String((row as any).ceo_user_id);
      claims.ceo = true;
      claims.staff_role = "ceo";
    }

    const key = await getSigningKey();
    const iat = getNumericDate(0);
    const exp = getNumericDate(TOKEN_TTL_SECONDS);
    const token = await create(
      { alg: "HS256", typ: "JWT" },
      { ...claims, sub: subject, iat, exp },
      key,
    );

    return json(200, {
      token,
      expires_at: exp,
      data: validatedRow,
    });
  } catch (err) {
    console.error("[issue-session-token] fatal", err);
    const message = (err as Error).message || "Erro interno";
    // Erros de configuração e demais falhas voltam como 200 com mensagem,
    // para o frontend exibir o motivo em vez do genérico "non-2xx".
    return json(200, { error: message });
  }
});

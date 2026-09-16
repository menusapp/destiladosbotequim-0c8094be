import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-app-token",
};

async function getNuvemFiscalToken(): Promise<string> {
  const clientId = Deno.env.get("NUVEM_FISCAL_CLIENT_ID");
  const clientSecret = Deno.env.get("NUVEM_FISCAL_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Credenciais Nuvem Fiscal não configuradas");

  const tokenRes = await fetch("https://auth.nuvemfiscal.com.br/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "empresa cep cnpj nfce",
      audience: "https://api.nuvemfiscal.com.br/",
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(`OAuth falhou: ${tokenData.error_description || tokenData.error || "desconhecido"}`);
  }
  return tokenData.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { nuvem_fiscal_ref, justificativa, fiscal_note_id } = await req.json();

    if (!nuvem_fiscal_ref) {
      return new Response(JSON.stringify({ error: "nuvem_fiscal_ref é obrigatório" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!justificativa || justificativa.trim().length < 15) {
      return new Response(JSON.stringify({ error: "Justificativa deve ter no mínimo 15 caracteres" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getNuvemFiscalToken();

    // First verify document exists
    const checkUrl = `https://api.nuvemfiscal.com.br/nfce/${nuvem_fiscal_ref}`;
    console.log("[NuvemFiscal-Cancel] Checking document at:", checkUrl);
    const checkRes = await fetch(checkUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!checkRes.ok) {
      const checkBody = await checkRes.text();
      console.log("[NuvemFiscal-Cancel] Document not found:", checkRes.status, checkBody);
      return new Response(JSON.stringify({ 
        error: `Documento não encontrado na Nuvem Fiscal (ref: ${nuvem_fiscal_ref}). A nota pode ter sido emitida em outro ambiente (produção/homologação) ou não existe no provedor.` 
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const docInfo = await checkRes.json();
    console.log("[NuvemFiscal-Cancel] Document found, status:", docInfo.status, "ambiente:", docInfo.ambiente);

    if (docInfo.status === "cancelado") {
      // Already canceled, just update DB
      if (fiscal_note_id) {
        await supabase.from("order_fiscal_notes").update({ status: "canceled" }).eq("id", fiscal_note_id);
      }
      return new Response(JSON.stringify({ success: true, message: "Nota já estava cancelada." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /nfce/{id}/cancelamento
    const cancelUrl = `https://api.nuvemfiscal.com.br/nfce/${nuvem_fiscal_ref}/cancelamento`;
    console.log("[NuvemFiscal-Cancel] Canceling at:", cancelUrl);
    const cancelRes = await fetch(cancelUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ justificativa: justificativa.trim() }),
    });

    const cancelResult = await cancelRes.json();
    console.log("[NuvemFiscal-Cancel] Response:", JSON.stringify(cancelResult));

    if (!cancelRes.ok) {
      const errMsg = cancelResult?.error?.message || cancelResult?.message || JSON.stringify(cancelResult).substring(0, 300);
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update note status in DB
    if (fiscal_note_id) {
      await supabase.from("order_fiscal_notes").update({ status: "canceled", error_message: `Cancelada: ${justificativa.trim()}` }).eq("id", fiscal_note_id);
    }

    return new Response(JSON.stringify({ success: true, result: cancelResult }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[NuvemFiscal-Cancel] Error:", error);
    return new Response(JSON.stringify({ error: error.message || "Erro interno" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

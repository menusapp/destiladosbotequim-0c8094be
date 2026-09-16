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

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { nuvem_fiscal_ref, type } = await req.json();
    console.log("[NuvemFiscal-Download] Request:", { nuvem_fiscal_ref, type });

    if (!nuvem_fiscal_ref || !type) {
      return new Response(JSON.stringify({ error: "nuvem_fiscal_ref e type (pdf|xml) são obrigatórios" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type !== "pdf" && type !== "xml") {
      return new Response(JSON.stringify({ error: "type deve ser 'pdf' ou 'xml'" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getNuvemFiscalToken();

    // First verify the document exists
    const checkUrl = `https://api.nuvemfiscal.com.br/nfce/${nuvem_fiscal_ref}`;
    console.log("[NuvemFiscal-Download] Checking document at:", checkUrl);
    const checkRes = await fetch(checkUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!checkRes.ok) {
      const checkBody = await checkRes.text();
      console.log("[NuvemFiscal-Download] Document check failed:", checkRes.status, checkBody);
      return new Response(JSON.stringify({ 
        error: `Documento não encontrado na Nuvem Fiscal. Verifique se a nota foi emitida no mesmo ambiente (produção/homologação). Status: ${checkRes.status}` 
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const docInfo = await checkRes.json();
    console.log("[NuvemFiscal-Download] Document found, status:", docInfo.status, "ambiente:", docInfo.ambiente);

    // Now download the file
    const downloadUrl = `https://api.nuvemfiscal.com.br/nfce/${nuvem_fiscal_ref}/${type}`;
    console.log("[NuvemFiscal-Download] Downloading from:", downloadUrl);

    const downloadRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!downloadRes.ok) {
      const errBody = await downloadRes.text();
      console.log("[NuvemFiscal-Download] Download failed:", downloadRes.status, errBody);
      return new Response(JSON.stringify({ error: `Erro ao baixar ${type}: Status ${downloadRes.status}. ${errBody.substring(0, 300)}` }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate content-type to avoid returning HTML error pages as file data
    const responseContentType = downloadRes.headers.get("content-type") || "";
    if (responseContentType.includes("text/html")) {
      const htmlBody = await downloadRes.text();
      console.log("[NuvemFiscal-Download] Got HTML instead of file:", htmlBody.substring(0, 300));
      return new Response(JSON.stringify({ error: "A API retornou uma página de erro. Verifique se as credenciais estão corretas e se a nota existe no ambiente atual." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileBytes = new Uint8Array(await downloadRes.arrayBuffer());
    const base64Data = uint8ToBase64(fileBytes);
    const contentType = type === "pdf" ? "application/pdf" : "application/xml";
    const filename = `nfce_${nuvem_fiscal_ref}.${type}`;

    console.log("[NuvemFiscal-Download] Success! File size:", fileBytes.length, "bytes");

    return new Response(JSON.stringify({
      data: base64Data,
      content_type: contentType,
      filename: filename,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[NuvemFiscal-Download] Error:", error);
    return new Response(JSON.stringify({ error: error.message || "Erro interno" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

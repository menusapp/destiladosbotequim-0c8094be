import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-app-token",
};

async function getAccessToken(): Promise<string> {
  const clientId = Deno.env.get("NUVEM_FISCAL_CLIENT_ID");
  const clientSecret = Deno.env.get("NUVEM_FISCAL_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("Credenciais Nuvem Fiscal não configuradas");
  }

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

  const tokenText = await tokenRes.text();
  let tokenData: any;
  try {
    tokenData = JSON.parse(tokenText);
  } catch {
    throw new Error(`Resposta inválida do OAuth: ${tokenText.substring(0, 200)}`);
  }

  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(`Falha na autenticação Nuvem Fiscal (${tokenRes.status}): ${tokenData.error_description || tokenData.error || "desconhecido"}`);
  }

  return tokenData.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { restaurantId, action } = await req.json();
    if (!restaurantId) {
      return new Response(
        JSON.stringify({ success: false, error: "restaurantId é obrigatório" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: config, error: dbError } = await supabase
      .from("fiscal_configs")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (dbError || !config) {
      return new Response(
        JSON.stringify({ success: false, error: "Configuração fiscal não encontrada" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cpfCnpj = (config.cnpj || "").replace(/\D/g, "");

    // ============ DISCONNECT ACTION ============
    if (action === "disconnect") {
      if (!cpfCnpj) {
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      try {
        const accessToken = await getAccessToken();

        // Delete company from Nuvem Fiscal
        const deleteRes = await fetch(`https://api.nuvemfiscal.com.br/empresas/${cpfCnpj}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        console.log(`[Disconnect] DELETE company response: ${deleteRes.status}`);

        if (!deleteRes.ok && deleteRes.status !== 404) {
          const body = await deleteRes.text();
          console.error(`[Disconnect] Failed to delete company: ${body}`);
        }
      } catch (err) {
        console.error("[Disconnect] Error calling Nuvem Fiscal:", err);
        // Continue anyway — we still want to clear local state
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ SYNC ACTION (default) ============
    const required = ["cnpj", "razao_social", "cep", "logradouro", "numero", "bairro", "municipio_codigo", "uf"];
    const missing = required.filter((f) => !config[f]);
    if (missing.length > 0) {
      return new Response(
        JSON.stringify({ success: false, error: `Campos obrigatórios faltando: ${missing.join(", ")}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = await getAccessToken();

    // 1. Create company payload
    const payload = {
      cpf_cnpj: cpfCnpj,
      inscricao_estadual: config.inscricao_estadual || "",
      inscricao_municipal: config.inscricao_municipal || "",
      nome_razao_social: config.razao_social,
      nome_fantasia: config.nome_fantasia || config.razao_social,
      email: config.email || "",
      fone: config.telefone ? config.telefone.replace(/\D/g, "") : "",
      endereco: {
        cep: config.cep ? config.cep.replace(/\D/g, "") : "",
        logradouro: config.logradouro,
        numero: config.numero,
        complemento: config.complemento || "",
        bairro: config.bairro,
        codigo_municipio: config.municipio_codigo,
        uf: config.uf,
      },
    };

    console.log("Creating company in Nuvem Fiscal:", JSON.stringify(payload));

    // 2. POST to create company (or handle already exists)
    const companyRes = await fetch("https://api.nuvemfiscal.com.br/empresas", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const companyText = await companyRes.text();
    let companyData: any;
    try {
      companyData = JSON.parse(companyText);
    } catch {
      console.error("Company API response not JSON:", companyText);
      return new Response(
        JSON.stringify({ success: false, error: `Resposta inválida da API: ${companyText.substring(0, 300)}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle EmpresaAlreadyExists — treat as success, proceed to certificate
    if (!companyRes.ok) {
      if (companyData?.error?.code === "EmpresaAlreadyExists") {
        console.log("Company already exists, proceeding to certificate upload...");
      } else {
        console.error("Nuvem Fiscal API error:", companyRes.status, companyData);
        const errorMsg = companyData?.error?.message || companyData?.message || JSON.stringify(companyData);
        return new Response(
          JSON.stringify({ success: false, error: `Erro Nuvem Fiscal (${companyRes.status}): ${errorMsg}` }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      console.log("Company created successfully:", companyData);
    }

    // 3. Upload certificate to Nuvem Fiscal
    const certPath = config.certificate_file_path;
    const certPassword = config.certificate_password;

    if (!certPath) {
      // No certificate uploaded yet — mark as synced without cert
      await supabase
        .from("fiscal_configs")
        .update({ nuvem_fiscal_status: "synced" })
        .eq("restaurant_id", restaurantId);

      return new Response(
        JSON.stringify({ success: true, data: companyData, warning: "Empresa sincronizada, mas certificado não encontrado no storage. Faça upload do .pfx e salve novamente." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!certPassword) {
      await supabase
        .from("fiscal_configs")
        .update({ nuvem_fiscal_status: "synced" })
        .eq("restaurant_id", restaurantId);

      return new Response(
        JSON.stringify({ success: true, data: companyData, warning: "Empresa sincronizada, mas senha do certificado não informada." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Download .pfx from Supabase Storage
    console.log(`Downloading certificate from storage: ${certPath}`);
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("fiscal-certificates")
      .download(certPath);

    if (downloadError || !fileData) {
      console.error("Failed to download certificate:", downloadError);
      await supabase
        .from("fiscal_configs")
        .update({ nuvem_fiscal_status: "synced" })
        .eq("restaurant_id", restaurantId);

      return new Response(
        JSON.stringify({ success: true, data: companyData, warning: "Empresa sincronizada, mas erro ao baixar certificado do storage." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upload certificate to Nuvem Fiscal via JSON + base64
    console.log(`Uploading certificate to Nuvem Fiscal for CNPJ: ${cpfCnpj}`);
    const certBytes = new Uint8Array(await fileData.arrayBuffer());
    let certBase64 = "";
    // Encode in chunks to avoid stack overflow on large files
    const CHUNK = 8192;
    for (let i = 0; i < certBytes.length; i += CHUNK) {
      certBase64 += String.fromCharCode(...certBytes.subarray(i, i + CHUNK));
    }
    certBase64 = btoa(certBase64);

    const certRes = await fetch(`https://api.nuvemfiscal.com.br/empresas/${cpfCnpj}/certificado`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        certificado: certBase64,
        password: certPassword,
      }),
    });

    const certText = await certRes.text();
    console.log(`Certificate upload response: ${certRes.status} ${certText.substring(0, 300)}`);

    if (!certRes.ok) {
      let certError = certText;
      try {
        const parsed = JSON.parse(certText);
        certError = parsed?.error?.message || parsed?.message || certText;
      } catch { /* ignore */ }

      return new Response(
        JSON.stringify({ success: false, error: `Empresa sincronizada, mas erro ao enviar certificado: ${certError}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Configure NFC-e settings (CSC) on Nuvem Fiscal
    const cscId = config.csc_id;
    const cscCode = config.csc_code;

    if (cscId && cscCode) {
      console.log(`Configuring NFC-e for CNPJ: ${cpfCnpj}`);
      const nfceConfigRes = await fetch(`https://api.nuvemfiscal.com.br/empresas/${cpfCnpj}/nfce`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ambiente: "producao",
          CRT: 1,
          sefaz: {
            id_csc: Number(cscId),
            csc: cscCode,
          },
        }),
      });

      const nfceConfigText = await nfceConfigRes.text();
      console.log(`NFC-e config response: ${nfceConfigRes.status} ${nfceConfigText.substring(0, 300)}`);

      if (!nfceConfigRes.ok) {
        let nfceError = nfceConfigText;
        try {
          const parsed = JSON.parse(nfceConfigText);
          nfceError = parsed?.error?.message || parsed?.message || nfceConfigText;
        } catch { /* ignore */ }

        return new Response(
          JSON.stringify({ success: false, error: `Empresa e certificado sincronizados, mas erro ao configurar NFC-e: ${nfceError}` }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // No CSC configured — warn user
      await supabase
        .from("fiscal_configs")
        .update({ nuvem_fiscal_status: "synced" })
        .eq("restaurant_id", restaurantId);

      return new Response(
        JSON.stringify({ success: true, data: companyData, warning: "Empresa e certificado sincronizados, mas CSC (Código de Segurança do Contribuinte) não configurado. Preencha o ID e Código CSC para emitir NFC-e." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // All good — mark as synced
    await supabase
      .from("fiscal_configs")
      .update({ nuvem_fiscal_status: "synced" })
      .eq("restaurant_id", restaurantId);

    return new Response(
      JSON.stringify({ success: true, data: companyData }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Erro interno" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

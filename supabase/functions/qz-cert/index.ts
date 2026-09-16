/**
 * Devolve o certificado público do QZ Tray (PEM).
 *
 * Pública (sem JWT). É seguro expor o certificado público — ele só
 * comprova a identidade. A chave privada nunca sai da edge function `qz-sign`.
 *
 * Aceita o secret QZ_CERTIFICATE em qualquer um destes formatos:
 *  1. PEM completo com BEGIN/END CERTIFICATE
 *  2. Base64 puro (envolve em PEM automaticamente)
 *  3. PEM com escapes \n literais (normaliza para newlines reais)
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-app-token",
};

function normalizeCertificate(raw: string): string {
  // Normaliza newlines (caso o secret tenha \n escapados)
  let cert = raw.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();

  if (cert.includes("BEGIN CERTIFICATE")) {
    return cert; // Já é PEM válido
  }

  // Conteúdo é base64 puro — envolve em PEM
  // Remove qualquer espaço/quebra que possa ter vindo
  const b64 = cert.replace(/\s+/g, "");
  // Reformat em linhas de 64 caracteres (padrão PEM)
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return [
    "-----BEGIN CERTIFICATE-----",
    ...lines,
    "-----END CERTIFICATE-----",
    "",
  ].join("\n");
}

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const raw = Deno.env.get("QZ_CERTIFICATE");
  if (!raw) {
    console.error("[qz-cert] QZ_CERTIFICATE not configured");
    return new Response(
      JSON.stringify({ error: "QZ_CERTIFICATE not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const cert = normalizeCertificate(raw);
  console.log("[qz-cert] Serving certificate (len:", cert.length, ")");

  return new Response(cert, {
    headers: { ...corsHeaders, "Content-Type": "text/plain" },
  });
});

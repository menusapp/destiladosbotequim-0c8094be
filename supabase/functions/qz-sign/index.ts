/**
 * Assina mensagens do QZ Tray com a chave privada do restaurante.
 *
 * O QZ Tray exige assinatura RSA-SHA512 (algoritmo "SHA512withRSA") sobre
 * o conteúdo da requisição (string `toSign`). A assinatura é devolvida em
 * base64 e o QZ valida com o certificado público (`qz-cert`).
 *
 * IMPORTANTE: A chave privada (QZ_PRIVATE_KEY) NUNCA é exposta ao frontend.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-app-token",
};

/** Normaliza o secret: aceita PEM, PEM com \n escapados, ou base64 puro. */
function normalizePem(raw: string): string {
  const cleaned = raw.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
  if (cleaned.includes("BEGIN")) return cleaned;
  // Base64 puro → assume PKCS#8 PRIVATE KEY (mais comum p/ secrets simples)
  const b64 = cleaned.replace(/\s+/g, "");
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return [
    "-----BEGIN PRIVATE KEY-----",
    ...lines,
    "-----END PRIVATE KEY-----",
    "",
  ].join("\n");
}

/** Converte PEM (PKCS#1 ou PKCS#8) → ArrayBuffer pronto pro WebCrypto. */
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * PKCS#1 ("BEGIN RSA PRIVATE KEY") → PKCS#8 ("BEGIN PRIVATE KEY").
 * WebCrypto só importa PKCS#8, então prependemos o header ASN.1 quando
 * o usuário forneceu PKCS#1 (saída padrão do `openssl genrsa`).
 */
function pkcs1ToPkcs8(pkcs1: ArrayBuffer): ArrayBuffer {
  const prefix = new Uint8Array([
    0x30, 0x82, 0x00, 0x00, // SEQUENCE (length placeholder)
    0x02, 0x01, 0x00,        // INTEGER 0 (version)
    0x30, 0x0d,              // SEQUENCE (algorithm identifier)
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, // rsaEncryption OID
    0x05, 0x00,              // NULL parameters
    0x04, 0x82, 0x00, 0x00,  // OCTET STRING (length placeholder)
  ]);
  const inner = new Uint8Array(pkcs1);
  const innerLen = inner.length;
  const totalLen = prefix.length + innerLen - 4; // SEQUENCE content length

  // Patch lengths (big-endian uint16)
  prefix[2] = (totalLen >> 8) & 0xff;
  prefix[3] = totalLen & 0xff;
  prefix[prefix.length - 2] = (innerLen >> 8) & 0xff;
  prefix[prefix.length - 1] = innerLen & 0xff;

  const out = new Uint8Array(prefix.length + innerLen);
  out.set(prefix, 0);
  out.set(inner, prefix.length);
  return out.buffer;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const isPkcs1 = pem.includes("BEGIN RSA PRIVATE KEY");
  let der = pemToArrayBuffer(pem);
  if (isPkcs1) der = pkcs1ToPkcs8(der);
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" },
    false,
    ["sign"],
  );
}

let cachedKey: CryptoKey | null = null;
async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = Deno.env.get("QZ_PRIVATE_KEY");
  if (!raw) throw new Error("QZ_PRIVATE_KEY not configured");
  const pem = normalizePem(raw);
  console.log("[qz-sign] Importing private key (PKCS#1?", pem.includes("RSA PRIVATE KEY"), ")");
  cachedKey = await importPrivateKey(pem);
  console.log("[qz-sign] Private key imported successfully");
  return cachedKey;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let toSign = url.searchParams.get("request");

    // QZ pode enviar via POST com body texto puro também
    if (!toSign && req.method === "POST") {
      const body = await req.text();
      try {
        const json = JSON.parse(body);
        toSign = json.request ?? json.toSign ?? body;
      } catch {
        toSign = body;
      }
    }

    if (!toSign) {
      return new Response("", {
        headers: { ...corsHeaders, "Content-Type": "text/plain" },
      });
    }

    const key = await getKey();
    const data = new TextEncoder().encode(toSign);
    const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, data);

    // base64 da assinatura
    const bytes = new Uint8Array(sigBuf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);

    return new Response(b64, {
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[qz-sign] error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

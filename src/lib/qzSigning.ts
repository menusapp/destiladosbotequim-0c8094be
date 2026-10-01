/**
 * Configura o QZ Tray para assinar todas as mensagens digitalmente.
 *
 * Sem signing, o QZ Tray mostra um popup "Untrusted website" toda vez.
 * Com signing válido + certificado adicionado em `QZ Tray → Site Manager`
 * (ou `<install>/auth/override.crt`), a conexão fica automática.
 *
 * Fluxo:
 *  1. `setCertificatePromise` → o frontend baixa o certificado público da edge
 *     function `qz-cert` e entrega ao QZ Tray.
 *  2. `setSignaturePromise` → cada requisição que o QZ envia é assinada pela
 *     edge function `qz-sign` (a chave privada NUNCA aparece no navegador).
 *
 * Em DEV, se as edge functions falharem, voltamos ao modo não-assinado e o
 * popup aparece (fallback seguro — não quebra a impressão).
 */
import qz from "qz-tray";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;
const FUNCTIONS_BASE = PROJECT_ID
  ? `https://${PROJECT_ID}.supabase.co/functions/v1`
  : "";

let setupPromise: Promise<void> | null = null;
let certPromise: Promise<string> | null = null;

async function fetchCertificate(): Promise<string> {
  if (!FUNCTIONS_BASE) throw new Error("VITE_SUPABASE_PROJECT_ID ausente");
  const res = await fetch(`${FUNCTIONS_BASE}/qz-cert`);
  if (!res.ok) throw new Error(`qz-cert HTTP ${res.status}`);
  const cert = await res.text();
  if (!cert.includes("BEGIN CERTIFICATE")) {
    throw new Error("Certificado QZ inválido recebido do backend");
  }
  return cert;
}

async function signRequest(toSign: string): Promise<string> {
  if (!FUNCTIONS_BASE) throw new Error("VITE_SUPABASE_PROJECT_ID ausente");
  const res = await fetch(
    `${FUNCTIONS_BASE}/qz-sign?request=${encodeURIComponent(toSign)}`,
  );
  if (!res.ok) throw new Error(`qz-sign HTTP ${res.status}`);
  return (await res.text()).trim();
}

/**
 * Configura QZ Tray para assinar mensagens. Idempotente — pode ser chamado
 * várias vezes; só executa a configuração na primeira chamada.
 */
export function setupQzSigning(): Promise<void> {
  // Promise compartilhada em vez de flag booleana: com a flag, uma segunda
  // chamada retornava imediatamente enquanto a primeira ainda sondava o
  // certificado — e o connect seguia sem as promises instaladas.
  if (!setupPromise) setupPromise = configurar();
  return setupPromise;
}

async function configurar(): Promise<void> {

  // Sonda o certificado ANTES de instalar as promises de assinatura.
  //
  // Por que isso importa: se o backend não tem QZ_CERTIFICATE/QZ_PRIVATE_KEY
  // configurados, as promises rejeitam — e uma assinatura rejeitada faz o
  // qz-tray.js falhar a chamada inteira. O sintoma é cruel: a conexão abre
  // normalmente, mas `qz.printers.find()` devolve erro e a tela diz apenas
  // "não foi possível listar impressoras".
  //
  // Sem as promises instaladas, o qz-tray.js opera em modo NÃO ASSINADO: o QZ
  // Tray pede permissão a cada operação (e o "Remember" fica desabilitado,
  // porque ele só memoriza sites assinados), mas tudo FUNCIONA. É melhor
  // pedir permissão do que não listar impressora nenhuma.
  try {
    await fetchCertificate();
  } catch (err) {
    console.warn(
      "[qz-signing] Certificado indisponível no backend — operando em modo NÃO ASSINADO.\n" +
      "O QZ Tray vai pedir permissão a cada impressão e o 'Remember' ficará desabilitado.\n" +
      "Para eliminar isso, configure os secrets QZ_CERTIFICATE e QZ_PRIVATE_KEY.",
      err instanceof Error ? err.message : err,
    );
    return; // não instala as promises
  }

  // Algoritmo de assinatura (precisa casar com a edge function: SHA-512)
  try {
    qz.security.setSignatureAlgorithm("SHA512");
  } catch {
    // Versões antigas do SDK não expõem essa API — usam SHA1 por padrão.
  }

  // Cache do certificado em memória pra não bater na edge a cada print.
  qz.security.setCertificatePromise((resolve: (cert: string) => void, reject: (e: any) => void) => {
    if (!certPromise) certPromise = fetchCertificate();
    certPromise
      .then((cert) => {
        console.log("🔐 [QZ] Certificado carregado (", cert.length, "chars)");
        resolve(cert);
      })
      .catch((err) => {
        console.warn("[qz-signing] certificado indisponível, fallback:", err?.message ?? err);
        certPromise = null;
        reject(err);
      });
  });

  qz.security.setSignaturePromise((toSign: string) => {
    return (resolve: (sig: string) => void, reject: (e: any) => void) => {
      console.log("🔐 [QZ] Assinatura solicitada (", toSign.length, "bytes)");
      signRequest(toSign)
        .then((sig) => {
          console.log("🔐 [QZ] Assinatura recebida (", sig.length, "chars base64)");
          resolve(sig);
        })
        .catch((err) => {
          console.warn("[qz-signing] assinatura falhou, fallback:", err?.message ?? err);
          reject(err);
        });
    };
  });

  console.log("🔐 [QZ] Signing configurado (RSA-SHA512 via edge functions).");
}

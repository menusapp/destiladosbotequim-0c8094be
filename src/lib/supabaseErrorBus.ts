/**
 * Barramento de erros do Supabase.
 *
 * Por que isto existe: o supabase-js NÃO lança exceção quando a requisição
 * falha — devolve `{ error }`. Qualquer chamada escrita como
 * `await supabase.from("x").insert(y)` sem olhar o retorno falha em SILÊNCIO.
 * Foi a causa de uma sequência de bugs em que o app dizia "salvo com sucesso"
 * e o banco continuava vazio, ou um dado simplesmente "desaparecia".
 *
 * Revisar cada chamada não resolve de forma durável: basta uma nova linha de
 * código esquecer o `error` e o problema volta. Então a detecção fica no
 * transporte (o fetch do client), onde não há como esquecer: toda resposta
 * HTTP de erro passa por aqui, independente de quem chamou.
 */

export interface ErroSupabase {
  status: number;
  url: string;
  metodo: string;
  mensagem: string;
  codigo?: string;
  detalhe?: string;
}

export const EVENTO_ERRO_SUPABASE = "supabase:erro";

/** Códigos que NÃO são falha real e só gerariam ruído. */
const BENIGNOS = new Set([
  "PGRST116", // "no rows" de .single()/.maybeSingle() — ausência esperada
]);

// Evita repetir o mesmo erro em rajada (um loop de 37 inserts, por exemplo).
const recentes = new Map<string, number>();
const JANELA_MS = 4000;

function repetido(chave: string): boolean {
  const agora = Date.now();
  for (const [k, t] of recentes) if (agora - t > JANELA_MS) recentes.delete(k);
  if (recentes.has(chave)) return true;
  recentes.set(chave, agora);
  return false;
}

/** Extrai a tabela/rpc da URL do PostgREST, para a mensagem ser útil. */
function recurso(url: string): string {
  const m = url.match(/\/rest\/v1\/(?:rpc\/)?([a-z_0-9]+)/i);
  if (m) return m[1];
  const f = url.match(/\/functions\/v1\/([a-z0-9-]+)/i);
  return f ? `função ${f[1]}` : "servidor";
}

export function reportarErroSupabase(status: number, url: string, metodo: string, corpo: string): void {
  let mensagem = corpo?.slice(0, 300) || `HTTP ${status}`;
  let codigo: string | undefined;
  let detalhe: string | undefined;

  try {
    const j = JSON.parse(corpo);
    codigo = j.code;
    mensagem = j.message || j.msg || j.error_description || j.error || mensagem;
    detalhe = j.details || j.hint || undefined;
  } catch {
    // corpo não-JSON: fica o texto cru
  }

  if (codigo && BENIGNOS.has(codigo)) return;

  const erro: ErroSupabase = { status, url, metodo, mensagem, codigo, detalhe };

  // Sempre registra, mesmo que a UI não esteja ouvindo.
  console.error(`[supabase] ${metodo} ${recurso(url)} falhou (${status}):`, mensagem, detalhe ?? "");

  if (repetido(`${status}|${recurso(url)}|${mensagem}`)) return;
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<ErroSupabase & { recurso: string }>(EVENTO_ERRO_SUPABASE, {
      detail: { ...erro, recurso: recurso(url) },
    }),
  );
}

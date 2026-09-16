/**
 * Storage da sessão do Supabase Auth.
 *
 * Originalmente este arquivo fazia um "broker" de sessão por postMessage para
 * o editor do Lovable, para que as telas de preview compartilhassem um login.
 * Fora do Lovable esse caminho nunca era ativado e o código caía em
 * `localStorage` de qualquer forma — então aqui ficou só o localStorage.
 *
 * O nome da função foi mantido para não alterar `client.ts`.
 */
export function brokeredPreviewStorage() {
  if (typeof window === 'undefined') return undefined;
  return localStorage;
}

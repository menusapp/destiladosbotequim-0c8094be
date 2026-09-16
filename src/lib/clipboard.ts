/**
 * Cópia para a área de transferência que funciona fora de contexto seguro.
 *
 * `navigator.clipboard` só existe em HTTPS ou localhost — mesma restrição do
 * `crypto.randomUUID`. Servindo por HTTP puro, copiar link de cardápio, QR de
 * mesa ou chave Pix simplesmente não funciona.
 *
 * Mantém o contrato do `navigator.clipboard.writeText`: devolve Promise e
 * LANÇA em caso de falha — as telas já tratam isso no catch delas, então a
 * troca é direta e o comportamento de erro continua igual.
 */
export async function copiarTexto(texto: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(texto);
  }

  // Fallback: textarea fora de tela + execCommand. Obsoleto, mas é o que
  // resta sem contexto seguro e funciona em todos os navegadores atuais.
  const ta = document.createElement("textarea");
  ta.value = texto;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-9999px";
  document.body.appendChild(ta);
  try {
    ta.select();
    ta.setSelectionRange(0, ta.value.length); // iOS ignora o select() sozinho
    if (!document.execCommand("copy")) {
      throw new Error("Não foi possível copiar automaticamente. Copie o texto manualmente.");
    }
  } finally {
    document.body.removeChild(ta);
  }
}

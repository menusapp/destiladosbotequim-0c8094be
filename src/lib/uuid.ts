/**
 * Gerador de UUID v4 que funciona fora de contexto seguro.
 *
 * `crypto.randomUUID()` só existe em contexto seguro — HTTPS ou localhost.
 * Servindo o app por HTTP puro (por IP, por exemplo, enquanto não há domínio),
 * a função é `undefined` e qualquer tela que gere id quebra com
 * "crypto.randomUUID is not a function". Isso derrubava o checkout, a comanda,
 * o PDV, o totem e a restauração de backup.
 *
 * `crypto.getRandomValues()`, ao contrário, existe também em contexto inseguro
 * — então o fallback continua criptograficamente sólido, não vira Math.random.
 */
export function novoId(): string {
  const c: Crypto | undefined = typeof crypto !== "undefined" ? crypto : undefined;

  if (typeof c?.randomUUID === "function") {
    return c.randomUUID();
  }

  if (typeof c?.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // versão 4
    b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // Navegador sem Web Crypto: não deveria acontecer, mas é melhor um id fraco
  // do que a tela quebrar no meio de um pedido.
  console.warn("[uuid] Web Crypto indisponível — usando fallback fraco.");
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Codificação de texto para impressoras térmicas ESC/POS.
 *
 * PROBLEMA QUE ESTE ARQUIVO RESOLVE
 * ---------------------------------
 * Em JavaScript toda string é Unicode. A impressora térmica, por outro lado,
 * recebe BYTES e os interpreta usando a *code page* selecionada por `ESC t n`.
 * Se mandarmos a string crua, o QZ Tray a serializa como UTF-8 e a impressora
 * imprime um byte por caractere — então "–" (E2 80 93 em UTF-8) sai como "ÔÇô"
 * e "ç" (C3 A7) sai como "├º".
 *
 * A opção `options.encoding` do QZ Tray **não** é aplicada quando passada no
 * item de dados (`{ type: "raw", ..., options: { encoding } }`): ela só existe
 * no config (`qz.configs.create`). Em vez de depender do nome do charset no
 * Java da máquina do cliente, nós mesmos convertemos o texto para bytes CP850
 * aqui e enviamos em hexadecimal (`flavor: "hex"`), que é inequívoco.
 *
 * GARANTIA DE NUNCA "BUGAR"
 * -------------------------
 * Todo caractere passa por três estágios:
 *   1. ASCII (< 0x80) → vai direto.
 *   2. Existe em CP850 → vira o byte correspondente (á é í ó ú â ê ô ã õ ç …).
 *   3. Não existe em CP850 → é TRANSLITERADO para ASCII (– vira "-", " vira
 *      '"', € vira "EUR", emoji vira "") antes de virar byte.
 * Resultado: nenhum caractere especial produz lixo na impressão. No pior caso
 * ele sai como o equivalente ASCII mais próximo.
 */

/**
 * Tabela CP850 (PC Multilingual Latin-1), posições 0x80 a 0xFF.
 * Gerada a partir do codec `cp850` de referência — não editar à mão.
 */
const CP850_ALTO =
  "ÇüéâäàåçêëèïîìÄÅ" + // 0x80-0x8F
  "ÉæÆôöòûùÿÖÜø£Ø×ƒ" + // 0x90-0x9F
  "áíóúñÑªº¿®¬½¼¡«»" + // 0xA0-0xAF
  "░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐" + // 0xB0-0xBF
  "└┴┬├─┼ãÃ╚╔╩╦╠═╬¤" + // 0xC0-0xCF
  "ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀" + // 0xD0-0xDF
  "ÓßÔÒõÕµþÞÚÛÙýÝ¯´" + // 0xE0-0xEF
  "­±‗¾¶§÷¸°¨·¹³²■ ";  // 0xF0-0xFF

/** Unicode → byte CP850, para tudo acima de 0x7F. */
const PARA_CP850 = new Map<string, number>();
for (let i = 0; i < CP850_ALTO.length; i++) {
  const ch = CP850_ALTO[i];
  // A tabela tem duplicatas visuais? Não — mas mantemos o primeiro sempre.
  if (!PARA_CP850.has(ch)) PARA_CP850.set(ch, 0x80 + i);
}

/**
 * Transliterações para caracteres que NÃO existem em CP850 e são comuns em
 * textos vindos de cardápio/observações (aspas e travessões do Word, símbolos
 * de moeda, bullets). Sem isso eles cairiam no "?" genérico.
 */
const TRANSLITERACAO: Record<string, string> = {
  // Travessões e hifens tipográficos
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-",
  "−": "-",
  // Aspas curvas
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"',
  "′": "'", "″": '"',
  // Pontuação
  "…": "...", "•": "*", "·": ".", "‧": ".",
  "‹": "<", "›": ">",
  " ": " ", " ": " ", " ": " ", " ": " ", " ": " ",
  " ": " ", "　": " ",
  "​": "", "‌": "", "‍": "", "﻿": "",
  // Moedas e símbolos
  "€": "EUR", "₡": "C", "™": "TM", "℅": "c/o",
  // Frações e matemática
  "⅓": "1/3", "⅔": "2/3", "⅛": "1/8",
  "≈": "~", "≠": "!=", "≤": "<=", "≥": ">=",
  // Setas (usadas em alguns textos de status)
  "←": "<-", "→": "->", "↑": "^", "↓": "v",
};

/**
 * Remove diacríticos de um caractere via decomposição Unicode (NFD).
 * Usado como penúltimo recurso: "ẽ" (inexistente em CP850) vira "e".
 */
function semAcento(ch: string): string {
  try {
    return ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
  } catch {
    return ch;
  }
}

/**
 * Converte texto Unicode em bytes CP850, transliterando o que não couber.
 * Nunca lança exceção e nunca devolve byte acima de 0xFF.
 */
export function paraBytesCp850(texto: string): Uint8Array {
  const bytes: number[] = [];

  const empurrarAscii = (s: string) => {
    for (const c of s) {
      const code = c.codePointAt(0) ?? 0x3f;
      bytes.push(code < 0x80 ? code : 0x3f);
    }
  };

  // Itera por code points (não por code units), para não quebrar surrogates.
  for (const ch of texto) {
    const code = ch.codePointAt(0)!;

    // 1) ASCII puro — inclui os comandos ESC/POS (\x1B, \x1D, \n, dígitos…).
    if (code < 0x80) {
      bytes.push(code);
      continue;
    }

    // 2) Existe em CP850.
    const direto = PARA_CP850.get(ch);
    if (direto !== undefined) {
      bytes.push(direto);
      continue;
    }

    // 3a) Transliteração explícita.
    const mapeado = TRANSLITERACAO[ch];
    if (mapeado !== undefined) {
      empurrarAscii(mapeado);
      continue;
    }

    // 3b) Mesma letra sem acento — tenta de novo em CP850 e depois em ASCII.
    const base = semAcento(ch);
    if (base && base !== ch) {
      for (const b of base) {
        const codeB = b.codePointAt(0)!;
        if (codeB < 0x80) {
          bytes.push(codeB);
          continue;
        }
        const alt = PARA_CP850.get(b);
        bytes.push(alt !== undefined ? alt : 0x3f);
      }
      continue;
    }

    // 3c) Emojis e pictogramas: melhor omitir do que imprimir lixo.
    if (code >= 0x1f000 || (code >= 0x2190 && code <= 0x2bff) || (code >= 0xfe00 && code <= 0xfe0f)) {
      continue;
    }

    // 3d) Último recurso.
    bytes.push(0x3f);
  }

  return new Uint8Array(bytes);
}

/**
 * Prefixo mínimo de qualquer impressão: reset + seleção da code page CP850 +
 * conjunto internacional latino.
 *
 * `ESC @`      reinicia a impressora (limpa negrito/tamanho de um job anterior).
 * `ESC t 2`    seleciona a code page 2 = PC850, que é a tabela que
 *              `paraBytesCp850` usa para gerar os bytes.
 * `ESC R 0`    conjunto internacional "USA": NENHUMA substituição de ASCII.
 *
 * Sem isto a impressora imprime os bytes na code page que estava ativa antes
 * (normalmente CP437, sem ã/ç), e os acentos saem errados mesmo com os bytes
 * corretos. Toda via montada neste projeto começa com este prefixo.
 *
 * Sobre o `ESC R 0`: `ESC R n` é um mecanismo legado de 7 bits que troca alguns
 * caracteres ASCII por versões nacionais. O código antes usava `ESC R 8`,
 * acreditando ser "Latin American" — mas 8 é JAPÃO na tabela da Epson, que
 * troca `\` por `¥`. Como os acentos vêm da code page (e não daqui), o certo é
 * zerar: `0` = USA = ASCII intacto, e já desfaz qualquer substituição deixada
 * por um job anterior.
 */
export const PREFIXO_CP850 = "\x1B@" + "\x1Bt\x02" + "\x1BR\x00";

/** Representação hexadecimal (sem separadores) exigida por `flavor: "hex"`. */
export function bytesParaHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0").toUpperCase();
  }
  return hex;
}

/**
 * Monta o item de dados do `qz.print` para uma via do cupom.
 *
 * Usa `format: "command"` + `flavor: "hex"` — contrato estável da API 2.1+ do
 * QZ Tray — para que os bytes cheguem à impressora exatamente como geramos,
 * sem nenhuma reinterpretação de charset no caminho.
 */
export function viaEscposParaQz(textoEscpos: string): {
  type: "raw";
  format: "command";
  flavor: "hex";
  data: string;
} {
  return {
    type: "raw",
    format: "command",
    flavor: "hex",
    data: bytesParaHex(paraBytesCp850(textoEscpos)),
  };
}

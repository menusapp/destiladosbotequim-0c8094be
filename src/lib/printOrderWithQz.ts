/**
 * Impressão térmica profissional via QZ Tray (ESC/POS).
 *
 * - Usa fetchOrderForPrinting() para carregar o pedido completo.
 * - Gera a via do CLIENTE e, se habilitada em Configurações → Impressoras
 *   (`printer_settings.print_kitchen_copy`), também a via da COZINHA.
 * - Aplica CORTE entre as vias e ao final.
 * - Converte o texto para bytes CP850 em JS (ver `escposEncoding.ts`), para que
 *   acentos e cedilha saiam corretos em qualquer máquina.
 * - NÃO altera a impressão atual (window.print continua intacto).
 *
 * ⚠️ Compatibilidade:
 * Comandos ESC/POS funcionam em impressoras térmicas profissionais
 * (Epson TM-T20, Bematech MP-4200, Elgin i9, etc.).
 * Em impressoras NÃO-ESC/POS (ex.: HP LaserJet P1005), os bytes de
 * controle podem ser ignorados ou impressos como caracteres estranhos
 * — a aplicação NÃO quebra, apenas o corte/negrito não terão efeito.
 */

import qz from "qz-tray";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchOrderForPrinting,
  type OrderForPrinting,
} from "@/lib/fetchOrderForPrinting";
import { resolveQzPrinter } from "@/lib/qzPrinterConfig";
import { PREFIXO_CP850, viaEscposParaQz } from "@/lib/escposEncoding";
import { ensureQzConnected } from "@/lib/qzConnectionManager";
import {
  buildOriginLabel,
  formatDateTimeFull,
  formatDateTimeShort,
  formatPaymentType,
  formatPhoneDisplay,
  formatPrice,
  shortOrderId,
  formatOrderLabel,
  parseChangeFor,
  cleanReceiptNotes,
} from "@/lib/receiptFormatters";

export type PrintReceiptMode = "pedido" | "conta";

export interface PrintOrderQzOptions {
  /**
   * Contexto da impressão:
   * - "pedido" (padrão): imprime a via do Cliente e, quando
   *   `printer_settings.print_kitchen_copy` estiver ligado, também a via da
   *   Cozinha, com corte entre elas.
   * - "conta": imprime APENAS UMA via (Cliente) — usado em fechamento/pagamento
   *   para evitar duplicação do cupom e via desnecessária da cozinha.
   */
  mode?: PrintReceiptMode;
}

export interface PrintOrderQzResult {
  success: boolean;
  printer: string | null;
  orderId: string;
  escposLikely: boolean;
  /** Modo realmente usado nesta impressão. */
  mode: PrintReceiptMode;
  /** Quantidade de vias enviadas para a impressora. */
  copies: number;
  error?: string;
  /** Código semântico para o frontend tratar diferentes cenários de erro. */
  errorCode?:
    | "no_printer_configured"
    | "printer_not_available"
    | "no_printers_found"
    | "print_timeout"
    | "qz_connect_failed"
    | "unknown";
}

/** Tempo máximo (ms) que o envio para a impressora pode demorar antes de abortar. */
const PRINT_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout: ${label} demorou mais de ${ms}ms.`));
    }, ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

const LINE_WIDTH = 42; // 80mm térmica, fonte A

// =============================================================
// ESC/POS commands
// =============================================================
const ESC = "\x1B";
const GS = "\x1D";

const ESCPOS = {
  // O reset + seleção de code page vive em escposEncoding.PREFIXO_CP850, para
  // não existir em dois lugares e divergir da tabela de bytes.
  ALIGN_LEFT: ESC + "a" + "\x00",
  ALIGN_CENTER: ESC + "a" + "\x01",
  ALIGN_RIGHT: ESC + "a" + "\x02",
  BOLD_ON: ESC + "E" + "\x01",
  BOLD_OFF: ESC + "E" + "\x00",
  UNDERLINE_ON: ESC + "-" + "\x01",
  UNDERLINE_OFF: ESC + "-" + "\x00",
  // GS ! n  (nibble alto = altura, nibble baixo = largura)
  SIZE_NORMAL: GS + "!" + "\x00",
  SIZE_DOUBLE_W: GS + "!" + "\x10",
  SIZE_DOUBLE_H: GS + "!" + "\x01",
  SIZE_DOUBLE: GS + "!" + "\x11",
  SIZE_TRIPLE: GS + "!" + "\x22",
  CUT: GS + "V" + "\x00",
  FEED_2: "\n\n",
  FEED_3: "\n\n\n",
};

// =============================================================
// Helpers de formatação
// =============================================================
function center(text: string, width = LINE_WIDTH): string {
  const t = text.length > width ? text.slice(0, width) : text;
  const left = Math.max(0, Math.floor((width - t.length) / 2));
  return " ".repeat(left) + t + "\n";
}

function divider(char = "-", width = LINE_WIDTH): string {
  return char.repeat(width) + "\n";
}

/** Word-wrap respeitando palavras; quebra à força palavras maiores que a largura. */
function wrap(text: string, width = LINE_WIDTH, indent = ""): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  const max = Math.max(1, width - indent.length);
  const pushWord = (w: string) => {
    if (!current.length) {
      if (w.length > max) {
        for (let i = 0; i < w.length; i += max) lines.push(indent + w.slice(i, i + max));
      } else current = w;
    } else if (current.length + 1 + w.length <= max) {
      current += " " + w;
    } else {
      lines.push(indent + current);
      current = "";
      if (w.length > max) {
        for (let i = 0; i < w.length; i += max) lines.push(indent + w.slice(i, i + max));
      } else current = w;
    }
  };
  for (const w of words) pushWord(w);
  if (current.length) lines.push(indent + current);
  return lines;
}

/** Linha esquerda + direita; preço encostado na borda direita (1ª linha). */
function lineLR(left: string, right: string, width = LINE_WIDTH): string {
  const space = Math.max(1, width - right.length - 1);
  if (left.length <= space) {
    return left + " ".repeat(width - left.length - right.length) + right + "\n";
  }
  const wrapped = wrap(left, space);
  let out =
    wrapped[0] +
    " ".repeat(width - wrapped[0].length - right.length) +
    right +
    "\n";
  for (let i = 1; i < wrapped.length; i++) out += wrapped[i] + "\n";
  return out;
}

/** "Rótulo: valor" com wrap alinhado ao rótulo. */
function labeled(label: string, value: string, width = LINE_WIDTH): string {
  const prefix = `${label} `;
  const indent = " ".repeat(prefix.length);
  const lines = wrap(value, width - prefix.length);
  if (!lines.length) return prefix + "\n";
  let out = prefix + lines[0] + "\n";
  for (let i = 1; i < lines.length; i++) out += indent + lines[i] + "\n";
  return out;
}

// Helpers de formatação importados de @/lib/receiptFormatters


// =============================================================
// Restaurante (nome da loja)
// =============================================================
/** Nome da loja + restaurant_id, em uma única consulta. */
async function fetchDadosDaLoja(
  orderId: string
): Promise<{ nome: string; restaurantId: string | null }> {
  const { data, error } = await supabase
    .from("orders")
    .select("restaurant_id, restaurants:restaurant_id(name)")
    .eq("id", orderId)
    .single();

  if (error || !data) {
    console.warn("[printOrderWithQz] Falha ao buscar nome da loja:", error);
    return { nome: "Loja", restaurantId: null };
  }
  const name = (data as any).restaurants?.name;
  return {
    nome: typeof name === "string" && name.length > 0 ? name : "Loja",
    restaurantId: data.restaurant_id ?? null,
  };
}

/**
 * Lê a preferência "imprimir via da cozinha" de `printer_settings`.
 *
 * Desligada → sai apenas a via do cliente.
 * Ligada    → saem as duas vias (cliente + cozinha), com corte entre elas.
 *
 * Em qualquer falha de leitura devolve `true`, preservando o comportamento
 * histórico (duas vias) em vez de silenciosamente deixar a cozinha sem pedido.
 */
async function fetchViaCozinhaHabilitada(
  restaurantId: string | null
): Promise<boolean> {
  if (!restaurantId) return true;
  const { data, error } = await supabase
    .from("printer_settings")
    .select("print_kitchen_copy")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (error) {
    console.warn(
      "[printOrderWithQz] Falha ao ler print_kitchen_copy; assumindo via da cozinha LIGADA:",
      error.message
    );
    return true;
  }
  // Sem registro em printer_settings ainda → mantém as duas vias.
  if (!data) return true;
  return data.print_kitchen_copy !== false;
}

// =============================================================
// Construção das vias
// =============================================================
function buildCustomerReceipt(
  order: OrderForPrinting,
  storeName: string
): string {
  let out = "";
  // Reset + code page CP850 (fonte única em escposEncoding.ts): precisa casar
  // com a tabela usada por `paraBytesCp850`, senão os acentos saem errados.
  out += PREFIXO_CP850;

  // ---------- Cabeçalho: nome da loja ----------
  out += ESCPOS.ALIGN_CENTER;
  out += ESCPOS.BOLD_ON + ESCPOS.SIZE_DOUBLE;
  for (const l of wrap(storeName.toUpperCase(), 21)) out += l + "\n";
  out += ESCPOS.SIZE_NORMAL;
  out += divider("=");

  // Título da via — mesmo tamanho do título da via da cozinha (SIZE_DOUBLE)
  out += ESCPOS.SIZE_DOUBLE;
  out += center("VIA DO CLIENTE", 21);
  out += ESCPOS.SIZE_NORMAL;
  out += divider("=");

  // Número do pedido bem grande (3x) — espelha a via da cozinha
  out += ESCPOS.SIZE_TRIPLE;
  out += center(formatOrderLabel(order), 14);
  out += ESCPOS.SIZE_NORMAL + ESCPOS.BOLD_OFF;
  out += divider("=");

  // ---------- Tipo do pedido em destaque ----------
  const originLabel = buildOriginLabel(order);
  out += ESCPOS.BOLD_ON + ESCPOS.SIZE_DOUBLE_H;
  out += center(originLabel, LINE_WIDTH);
  out += ESCPOS.SIZE_NORMAL + ESCPOS.BOLD_OFF;

  // ---------- Agendamento ----------
  if (order.dd_scheduled_for) {
    out += ESCPOS.BOLD_ON;
    out += center("** AGENDADO PARA **");
    out += center(formatDateTimeShort(order.dd_scheduled_for));
    out += ESCPOS.BOLD_OFF;
  }
  out += divider("=");

  // ---------- Identificação ----------
  out += ESCPOS.ALIGN_LEFT;
  if (order.tables) {
    const tname = order.tables.table_name?.trim();
    const tnum = order.tables.table_number;
    const mesaStr = tname ? `${tname} (No ${tnum})` : `Mesa ${tnum}`;
    out += ESCPOS.BOLD_ON + ESCPOS.SIZE_DOUBLE_H;
    out += "MESA: " + mesaStr + "\n";
    out += ESCPOS.SIZE_NORMAL + ESCPOS.BOLD_OFF;
  }
  out += labeled("Cliente: ", order.customer_name || "-");
  if (order.customer_cpf) out += labeled("CPF:     ", order.customer_cpf);
  if (order.customer_phone) {
    out += labeled("Telefone:", formatPhoneDisplay(order.customer_phone));
  }
  if (order.delivery_type === "delivery" && order.delivery_address) {
    out += labeled("Endereco:", order.delivery_address);
  }
  out += labeled("Hora:    ", formatDateTimeShort(order.created_at));
  out += divider();

  // ---------- Bloco: itens ----------
  out += ESCPOS.BOLD_ON + center("ITENS DO PEDIDO") + ESCPOS.BOLD_OFF;
  out += divider();

  let subtotal = 0;
  for (const item of order.order_items) {
    const extrasTotal = item.order_item_extras.reduce(
      (s, e) => s + e.price,
      0
    );
    const itemTotal = (item.price_at_order + extrasTotal) * item.quantity;
    subtotal += itemTotal;

    // Nome do item em destaque (SIZE_DOUBLE) — mesmo tamanho da via da cozinha
    out += ESCPOS.BOLD_ON + ESCPOS.SIZE_DOUBLE;
    for (const l of wrap(`${item.quantity}x ${item.products.name}`, 21))
      out += l + "\n";
    out += ESCPOS.SIZE_NORMAL + ESCPOS.BOLD_OFF;

    // Linha de preço (tamanho normal, alinhada à direita)
    out += lineLR("  Total do item", formatPrice(itemTotal));

    if (item.quantity > 1) {
      out +=
        "    " +
        `(${item.quantity} x ${formatPrice(item.price_at_order)})` +
        "\n";
    }

    // Extras / complementos
    for (const ex of item.order_item_extras) {
      out += ESCPOS.BOLD_ON + lineLR(`  + ${ex.name}`, formatPrice(ex.price)) + ESCPOS.BOLD_OFF;
    }

    if (item.notes && item.notes.trim()) {
      const obsLines = wrap(`>> Obs: ${item.notes.trim()}`, LINE_WIDTH - 4);
      out += ESCPOS.BOLD_ON;
      for (const l of obsLines) out += "    " + l + "\n";
      out += ESCPOS.BOLD_OFF;
    }
    out += divider("-");
  }

  // ---------- Totais com breakdown completo ----------
  const discount = order.coupon_discount || 0;
  const deliveryFee = order.delivery_fee || 0;
  const finalTotal = subtotal - discount + deliveryFee;
  const isDelivery = order.delivery_type === "delivery";
  const showBreakdown = discount > 0 || deliveryFee > 0 || isDelivery;

  if (showBreakdown) {
    out += lineLR("Subtotal", formatPrice(subtotal));
    if (discount > 0) {
      out += lineLR("Desconto", `- ${formatPrice(discount)}`);
      const reasonMatch = order.notes?.match(/\[Desconto: (.+?)\]/);
      if (reasonMatch) {
        for (const l of wrap(`Motivo: ${reasonMatch[1]}`, LINE_WIDTH)) {
          out += l + "\n";
        }
      }
    }
    if (isDelivery) {
      out += lineLR(
        "Taxa de entrega",
        deliveryFee > 0 ? formatPrice(deliveryFee) : "Gratis"
      );
    } else if (deliveryFee > 0) {
      out += lineLR("Taxa de entrega", formatPrice(deliveryFee));
    }
  }

  out += divider("=");
  out += ESCPOS.BOLD_ON + ESCPOS.SIZE_DOUBLE;
  out += lineLR("TOTAL", formatPrice(finalTotal), 21);
  out += ESCPOS.SIZE_NORMAL + ESCPOS.BOLD_OFF;
  out += divider("=");

  // ---------- Pagamento ----------
  if (order.payment_type) {
    out += ESCPOS.BOLD_ON;
    out += labeled(
      "Pagamento:",
      formatPaymentType(order.payment_type, order.payment_brand)
    );
    out += ESCPOS.BOLD_OFF;
  }

  // ---------- Troco (quando cliente informou "Troco para: R$ X") ----------
  const changeFor = parseChangeFor(order.notes);
  if (changeFor != null && changeFor >= finalTotal) {
    const troco = changeFor - finalTotal;
    out += divider("-");
    out += ESCPOS.BOLD_ON + ESCPOS.SIZE_DOUBLE_H;
    out += center("** TROCO **", LINE_WIDTH);
    out += ESCPOS.SIZE_NORMAL + ESCPOS.BOLD_OFF;
    out += lineLR("Total do pedido", formatPrice(finalTotal));
    out += lineLR("Cliente vai pagar com", formatPrice(changeFor));
    out += ESCPOS.BOLD_ON + ESCPOS.SIZE_DOUBLE_H;
    out += lineLR("TROCO A LEVAR", formatPrice(troco), LINE_WIDTH);
    out += ESCPOS.SIZE_NORMAL + ESCPOS.BOLD_OFF;
  }

  // ---------- Observações gerais (sem o tag de desconto e linha de troco) ----------
  const cleanNotes = cleanReceiptNotes(order.notes);
  if (cleanNotes) {
    out += divider();
    out += labeled("Obs:     ", cleanNotes);
  }

  // ---------- Cancelamento ----------
  if (order.cancellation_reason) {
    out += divider();
    out += ESCPOS.BOLD_ON;
    out += labeled("MOTIVO CANCELAMENTO:", order.cancellation_reason);
    out += ESCPOS.BOLD_OFF;
  }

  // ---------- Rodapé ----------
  out += "\n";
  out += divider("-");
  out += ESCPOS.ALIGN_CENTER;
  out += ESCPOS.BOLD_ON + ESCPOS.SIZE_DOUBLE_H;
  out += center("Obrigado pela preferencia!", LINE_WIDTH);
  out += ESCPOS.SIZE_NORMAL + ESCPOS.BOLD_OFF;
  out += center("Volte sempre :)");
  out += "\n";
  out += divider("-");
  out += center(`Impresso em ${formatDateTimeFull(new Date())}`);

  out += ESCPOS.FEED_3;
  out += ESCPOS.CUT;
  return out;
}

function buildKitchenReceipt(order: OrderForPrinting): string {
  let out = "";
  // Reset + code page CP850 (fonte única em escposEncoding.ts): precisa casar
  // com a tabela usada por `paraBytesCp850`, senão os acentos saem errados.
  out += PREFIXO_CP850;


  // ---------- Cabeçalho ----------
  out += ESCPOS.ALIGN_CENTER;
  out += ESCPOS.BOLD_ON + ESCPOS.SIZE_DOUBLE;
  out += center("VIA DA COZINHA", 21);
  out += ESCPOS.SIZE_NORMAL;
  out += divider("=");

  // Número do pedido bem grande (3x)
  out += ESCPOS.SIZE_TRIPLE;
  out += center(formatOrderLabel(order), 14);
  out += ESCPOS.SIZE_NORMAL + ESCPOS.BOLD_OFF;
  out += divider("=");

  // Tipo do pedido em destaque
  const originLabel = buildOriginLabel(order);
  out += ESCPOS.BOLD_ON + ESCPOS.SIZE_DOUBLE_H;
  out += center(originLabel, LINE_WIDTH);
  out += ESCPOS.SIZE_NORMAL + ESCPOS.BOLD_OFF;

  // Agendamento (cozinha precisa saber!)
  if (order.dd_scheduled_for) {
    out += ESCPOS.BOLD_ON;
    out += center("** AGENDADO **");
    out += center(formatDateTimeShort(order.dd_scheduled_for));
    out += ESCPOS.BOLD_OFF;
  }
  out += divider("=");

  // ---------- Identificação ----------
  out += ESCPOS.ALIGN_LEFT;
  if (order.tables) {
    const tname = order.tables.table_name?.trim();
    const tnum = order.tables.table_number;
    const mesaStr = tname ? `${tname} (No ${tnum})` : `Mesa ${tnum}`;
    out += ESCPOS.BOLD_ON + ESCPOS.SIZE_DOUBLE_H;
    out += "MESA: " + mesaStr + "\n";
    out += ESCPOS.SIZE_NORMAL + ESCPOS.BOLD_OFF;
  }
  out += labeled("Cliente:", order.customer_name || "-");
  out += labeled("Hora:   ", formatDateTimeShort(order.created_at));
  out += divider();

  // ---------- Itens ----------
  out += ESCPOS.BOLD_ON + center("ITENS A PREPARAR") + ESCPOS.BOLD_OFF;
  out += divider();

  for (const item of order.order_items) {
    out += ESCPOS.BOLD_ON + ESCPOS.SIZE_DOUBLE;
    for (const l of wrap(`${item.quantity}x ${item.products.name}`, 21))
      out += l + "\n";
    out += ESCPOS.SIZE_NORMAL + ESCPOS.BOLD_OFF;

    // Extras / complementos
    for (const ex of item.order_item_extras) {
      out += ESCPOS.BOLD_ON + "  + " + ex.name + "\n" + ESCPOS.BOLD_OFF;
    }

    if (item.notes && item.notes.trim()) {
      const obsLines = wrap(
        `>> OBS: ${item.notes.trim().toUpperCase()}`,
        LINE_WIDTH
      );
      out += ESCPOS.BOLD_ON;
      for (const l of obsLines) out += l + "\n";
      out += ESCPOS.BOLD_OFF;
    }
    out += divider("-");
  }

  // Observações gerais do pedido
  const cleanNotes = order.notes
    ? order.notes.replace(/\[Desconto:.+?\]/g, "").trim()
    : "";
  if (cleanNotes) {
    out += ESCPOS.BOLD_ON;
    out += labeled("OBS GERAL:", cleanNotes.toUpperCase());
    out += ESCPOS.BOLD_OFF;
  }

  out += "\n";
  out += divider("-");
  out += ESCPOS.ALIGN_CENTER;
  out += center(`Impresso em ${formatDateTimeFull(new Date())}`);
  out += ESCPOS.FEED_3;
  out += ESCPOS.CUT;
  return out;
}

// =============================================================
// Detecção heurística de impressora ESC/POS
// =============================================================
function looksLikeEscposPrinter(printerName: string): boolean {
  const n = printerName.toLowerCase();
  const escposHints = [
    "epson",
    "tm-",
    "bematech",
    "mp-4200",
    "elgin",
    "i9",
    "daruma",
    "thermal",
    "termica",
    "pos-",
    "pos58",
    "pos80",
    "generic / text only",
  ];
  const nonEscposHints = ["laserjet", "deskjet", "officejet", "inkjet", "hp p"];
  if (nonEscposHints.some((h) => n.includes(h))) return false;
  if (escposHints.some((h) => n.includes(h))) return true;
  return false;
}

// =============================================================
// Função principal
// =============================================================
export async function printOrderWithQz(
  orderId: string,
  printerNameOrOptions?: string | PrintOrderQzOptions,
  maybeOptions?: PrintOrderQzOptions
): Promise<PrintOrderQzResult> {
  // Compatibilidade retroativa: aceita (orderId), (orderId, "PrinterName"),
  // (orderId, { mode }) ou (orderId, "PrinterName", { mode }).
  let printerName: string | undefined;
  let options: PrintOrderQzOptions = {};
  if (typeof printerNameOrOptions === "string") {
    printerName = printerNameOrOptions;
    options = maybeOptions ?? {};
  } else if (printerNameOrOptions && typeof printerNameOrOptions === "object") {
    options = printerNameOrOptions;
  }

  // Fallback seguro: sempre que o modo não for informado, assume "pedido".
  const mode: PrintReceiptMode = options.mode === "conta" ? "conta" : "pedido";

  console.group(
    `🖨️ [QZ Tray] Impressão ESC/POS do pedido ${orderId} — modo: ${mode}`
  );

  let usedPrinter: string | null = null;
  let escposLikely = false;

  // Helper para anexar mode/copies em qualquer retorno (mantém compat).
  const fail = (
    partial: Omit<PrintOrderQzResult, "mode" | "copies">
  ): PrintOrderQzResult => ({ ...partial, mode, copies: 0 });

  try {
    console.log("⏳ Carregando pedido…");
    const [order, loja] = await Promise.all([
      fetchOrderForPrinting(orderId),
      fetchDadosDaLoja(orderId),
    ]);
    const storeName = loja.nome;
    console.log("✅ Pedido carregado:", order);
    console.log("🏪 Loja:", storeName);

    // Preferência do restaurante: imprimir (ou não) a via da cozinha.
    const imprimirViaCozinha = await fetchViaCozinhaHabilitada(loja.restaurantId);
    console.log(
      `🍳 Via da cozinha: ${imprimirViaCozinha ? "HABILITADA" : "DESABILITADA"} (printer_settings.print_kitchen_copy)`
    );

    try {
      console.log("🖨️ [QZ Print] garantindo conexão persistente antes de imprimir...");
      await ensureQzConnected({ timeoutMs: 5000, retries: 3 });
    } catch (e: any) {
      console.error("❌ Falha ao conectar ao QZ Tray:", e?.message ?? e);
      return fail({
        success: false,
        printer: null,
        orderId,
        escposLikely: false,
        error: "Não foi possível conectar ao QZ Tray. Verifique se o aplicativo está aberto.",
        errorCode: "qz_connect_failed",
      });
    }

    // ---------- Lista impressoras disponíveis ----------
    let availablePrinters: string[] = [];
    try {
      availablePrinters = (await withTimeout(
        qz.printers.find() as Promise<string[]>,
        5000,
        "listagem de impressoras"
      )) as string[];
      console.log(
        `🖨️ [QZ] ${availablePrinters.length} impressora(s) disponíveis:`,
        availablePrinters
      );
    } catch (e: any) {
      console.warn("⚠️ Falha ao listar impressoras:", e?.message ?? e);
    }

    if (printerName) {
      usedPrinter = printerName;
      console.log(`🎯 [QZ] Impressora informada via parâmetro: "${printerName}"`);
    } else {
      const resolved = await resolveQzPrinter();
      usedPrinter = resolved.printer;
      console.log(`📌 [QZ] Origem da impressora: ${resolved.source}`);
    }

    // ---------- Validação: nenhuma impressora no sistema ----------
    if (availablePrinters.length === 0) {
      console.error("❌ Nenhuma impressora disponível no sistema.");
      return fail({
        success: false,
        printer: usedPrinter,
        orderId,
        escposLikely: false,
        error:
          "Nenhuma impressora encontrada no sistema. Conecte uma impressora e tente novamente.",
        errorCode: "no_printers_found",
      });
    }

    if (!usedPrinter) {
      return fail({
        success: false,
        printer: null,
        orderId,
        escposLikely: false,
        error:
          "Nenhuma impressora configurada. Vá em Configurações Gerais → Impressoras.",
        errorCode: "no_printer_configured",
      });
    }

    // ---------- Validação: impressora salva ainda existe ----------
    if (availablePrinters.length > 0 && !availablePrinters.includes(usedPrinter)) {
      console.error(
        `❌ Impressora "${usedPrinter}" não está mais disponível. Disponíveis:`,
        availablePrinters
      );
      return fail({
        success: false,
        printer: usedPrinter,
        orderId,
        escposLikely: false,
        error: `A impressora configurada "${usedPrinter}" não está disponível. Vá em Configurações Gerais → Impressoras e escolha outra.`,
        errorCode: "printer_not_available",
      });
    }

    console.log("🖨️ Impressora utilizada:", usedPrinter);

    escposLikely = looksLikeEscposPrinter(usedPrinter);
    if (!escposLikely) {
      console.warn(
        "⚠️ A impressora selecionada NÃO parece ser ESC/POS térmica.\n" +
          "Os comandos de corte e negrito podem ser ignorados ou impressos como caracteres estranhos."
      );
    } else {
      console.log("✅ Impressora compatível com ESC/POS detectada.");
    }

    // ---------- Montagem das vias conforme o MODO ----------
    // - "pedido": 2 vias (Cliente + Cozinha) com corte entre elas (corte já vai
    //   embutido no final de cada buildXReceipt via ESCPOS.CUT).
    // - "conta":  1 via (Cliente apenas) — sem via da cozinha, sem duplicação.
    const customer = buildCustomerReceipt(order, storeName);
    console.log("📄 Via do CLIENTE preparada.");

    // IMPORTANTE: a conversão de charset é feita AQUI, em JS, por
    // `viaEscposParaQz` — que transforma o texto em bytes CP850 e os envia em
    // hexadecimal. Não dependemos de `options.encoding` do QZ Tray (que só vale
    // no config, nunca no item de dados) nem do charset do Java da máquina do
    // operador. Combinado com o `ESC t 2` embutido no início de cada via, isso
    // garante que acentos e cedilha (á é í ó ú â ê ô ã õ ç Ç) saiam corretos, e
    // que qualquer caractere fora da CP850 seja transliterado para ASCII em vez
    // de virar lixo na bobina.
    const data: ReturnType<typeof viaEscposParaQz>[] = [viaEscposParaQz(customer)];

    if (mode === "pedido" && imprimirViaCozinha) {
      const kitchen = buildKitchenReceipt(order);
      console.log("📄 Via da COZINHA preparada.");
      data.push(viaEscposParaQz(kitchen));
    } else if (mode === "pedido") {
      console.log(
        "ℹ️ Via da cozinha DESATIVADA em Configurações → Impressoras: apenas a via do cliente será impressa."
      );
    } else {
      console.log("ℹ️ Modo 'conta': via da cozinha NÃO será impressa.");
    }


    const copies = data.length;
    console.log(
      `🧾 [QZ] Modo de impressão: "${mode}" → ${copies} via(s) ${
        copies === 1 ? "(apenas Cliente)" : "(Cliente + Cozinha)"
      }`
    );

    const config = qz.configs.create(usedPrinter);

    console.log(`🚀 Iniciando impressão (timeout: ${PRINT_TIMEOUT_MS}ms)…`);
    try {
      await withTimeout(
        qz.print(config, data),
        PRINT_TIMEOUT_MS,
        "envio para impressora"
      );
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      const isTimeout = msg.toLowerCase().includes("timeout");
      console.error("❌ Falha no envio para impressora:", msg);
      return {
        success: false,
        printer: usedPrinter,
        orderId,
        escposLikely,
        mode,
        copies,
        error: isTimeout
          ? `Tempo esgotado ao enviar para "${usedPrinter}". A impressora pode estar offline ou desconectada.`
          : msg,
        errorCode: isTimeout ? "print_timeout" : "unknown",
      };
    }

    console.log(`✅ Impressão enviada com sucesso (${copies} via(s)).`);
    console.groupEnd();
    return {
      success: true,
      printer: usedPrinter,
      orderId,
      escposLikely,
      mode,
      copies,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("❌ Falha na impressão do pedido:", message);
    console.groupEnd();
    return fail({
      success: false,
      printer: usedPrinter,
      orderId,
      escposLikely,
      error: message,
      errorCode: "unknown",
    });
  }
  // NÃO desconectamos aqui: a conexão é mantida ativa pelo qzConnectionManager
  // para que prints subsequentes sejam instantâneos. Se o socket cair, o
  // próprio manager fará reconnect invisível na próxima chamada.
}

if (typeof window !== "undefined") {
  (window as any).printOrderWithQz = printOrderWithQz;
}

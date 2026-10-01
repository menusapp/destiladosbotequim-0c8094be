/**
 * Gera o texto puro do cupom térmico (mesmas regras do printOrderWithQz),
 * mas SEM bytes ESC/POS — para preview em tela usando fonte monoespaçada.
 *
 * Conteúdo equivalente ao PDF antigo (telefone, endereço, taxa de entrega,
 * desconto, pagamento, observações, agendamento, cancelamento, extras).
 *
 * Suporta DUAS larguras:
 *  - 80mm → 42 colunas
 *  - 58mm → 32 colunas
 */

import { supabase } from "@/integrations/supabase/client";
import {
  fetchOrderForPrinting,
  type OrderForPrinting,
} from "@/lib/fetchOrderForPrinting";
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

export type ReceiptWidth = "58mm" | "80mm";

export const WIDTH_COLUMNS: Record<ReceiptWidth, number> = {
  "58mm": 32,
  "80mm": 42,
};

function buildCutMark(width: number): string {
  const label = "✂  - - -  CORTE  - - -  ✂";
  const pad = Math.max(0, Math.floor((width - label.length) / 2));
  return (
    "\n" +
    "─".repeat(width) +
    "\n" +
    " ".repeat(pad) +
    label +
    "\n" +
    "─".repeat(width) +
    "\n\n"
  );
}

// =============================================================
// Helpers parametrizados pela largura
// =============================================================
function center(text: string, width: number): string {
  const t = text.length > width ? text.slice(0, width) : text;
  const left = Math.max(0, Math.floor((width - t.length) / 2));
  return " ".repeat(left) + t + "\n";
}

function divider(char: string, width: number): string {
  return char.repeat(width) + "\n";
}

function wrap(text: string, width: number, indent = ""): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  const max = Math.max(1, width - indent.length);
  const pushWord = (w: string) => {
    if (!current.length) {
      if (w.length > max) {
        for (let i = 0; i < w.length; i += max)
          lines.push(indent + w.slice(i, i + max));
      } else current = w;
    } else if (current.length + 1 + w.length <= max) {
      current += " " + w;
    } else {
      lines.push(indent + current);
      current = "";
      if (w.length > max) {
        for (let i = 0; i < w.length; i += max)
          lines.push(indent + w.slice(i, i + max));
      } else current = w;
    }
  };
  for (const w of words) pushWord(w);
  if (current.length) lines.push(indent + current);
  return lines;
}

function lineLR(left: string, right: string, width: number): string {
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

function labeled(label: string, value: string, width: number): string {
  const prefix = `${label} `;
  const indent = " ".repeat(prefix.length);
  const lines = wrap(value, width - prefix.length);
  if (!lines.length) return prefix + "\n";
  let out = prefix + lines[0] + "\n";
  for (let i = 1; i < lines.length; i++) out += indent + lines[i] + "\n";
  return out;
}

/**
 * Nome da loja + se a via da cozinha está habilitada — o preview precisa
 * refletir exactamente o que a impressora vai receber, então lê a mesma
 * preferência (`printer_settings.print_kitchen_copy`) que printOrderWithQz.
 */
async function fetchContextoDaLoja(
  orderId: string
): Promise<{ nome: string; imprimirViaCozinha: boolean }> {
  const { data } = await supabase
    .from("orders")
    .select("restaurant_id, restaurants:restaurant_id(name)")
    .eq("id", orderId)
    .single();
  const name = (data as any)?.restaurants?.name;
  const nome = typeof name === "string" && name.length > 0 ? name : "Loja";
  const restaurantId = data?.restaurant_id ?? null;

  if (!restaurantId) return { nome, imprimirViaCozinha: true };

  const { data: cfg, error } = await supabase
    .from("printer_settings")
    .select("print_kitchen_copy")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  // Qualquer falha de leitura → assume habilitada, igual à impressão real.
  if (error || !cfg) return { nome, imprimirViaCozinha: true };
  return { nome, imprimirViaCozinha: cfg.print_kitchen_copy !== false };
}

const dblWidth = (width: number) => Math.max(10, Math.floor(width / 2));

// =============================================================
// VIA DO CLIENTE
// =============================================================
function buildCustomerPreview(
  order: OrderForPrinting,
  storeName: string,
  width: number
): string {
  let out = "";

  // Nome da loja
  for (const l of wrap(storeName.toUpperCase(), dblWidth(width)))
    out += center(l, width).replace("\n", "  [GRANDE]\n");

  out += divider("=", width);
  out += center("VIA DO CLIENTE  [NEGRITO]", width);
  out += divider("=", width);

  // Pedido + data
  out += labeled(
    "Pedido: ",
    `${formatOrderLabel(order)} - ${formatDateTimeShort(order.created_at)}  [NEGRITO]`,
    width
  );

  // Tipo do pedido em destaque
  const originLabel = buildOriginLabel(order);
  out += "\n";
  out += center(originLabel + "  [GRANDE+NEGRITO]", width);
  out += "\n";

  if (order.dd_scheduled_for) {
    out += center("** AGENDADO PARA **  [NEGRITO]", width);
    out += center(formatDateTimeShort(order.dd_scheduled_for), width);
    out += "\n";
  }

  // Cliente / contato
  out += labeled("Cliente: ", order.customer_name || "-", width);
  if (order.customer_cpf) out += labeled("CPF:     ", order.customer_cpf, width);
  if (order.customer_phone) {
    out += labeled("Telefone:", formatPhoneDisplay(order.customer_phone), width);
  }
  if (order.delivery_type === "delivery" && order.delivery_address) {
    out += labeled("Endereco:", order.delivery_address, width);
  }
  if (order.tables) {
    const tname = order.tables.table_name?.trim();
    const tnum = order.tables.table_number;
    out += labeled(
      "Mesa:    ",
      tname ? `${tname} (No ${tnum})` : `Mesa ${tnum}`,
      width
    );
  }
  out += divider("-", width);

  out += center("ITENS DO PEDIDO  [NEGRITO]", width);
  out += divider("-", width);

  let subtotal = 0;
  for (const item of order.order_items) {
    const extrasTotal = item.order_item_extras.reduce(
      (s, e) => s + e.price,
      0
    );
    const itemTotal = (item.price_at_order + extrasTotal) * item.quantity;
    subtotal += itemTotal;

    const qty = `${item.quantity}x`.padEnd(3);
    const left = `${qty} ${item.products.name}`;
    out += lineLR(left, formatPrice(itemTotal), width) + "  [NEGRITO]";

    if (item.quantity > 1) {
      out +=
        "    " +
        `(${item.quantity} x ${formatPrice(item.price_at_order)})` +
        "\n";
    }

    for (const ex of item.order_item_extras) {
      out += lineLR(`  + ${ex.name}`, formatPrice(ex.price), width) + "  [NEGRITO]\n";
    }

    if (item.notes && item.notes.trim()) {
      const obsLines = wrap(`>> Obs: ${item.notes.trim()}`, width - 4);
      for (const l of obsLines) out += "    " + l + "  [NEGRITO]\n";
    }
    out += "\n";
  }

  out += divider("-", width);

  // Totais (mesmo breakdown do PDF)
  const discount = order.coupon_discount || 0;
  const deliveryFee = order.delivery_fee || 0;
  const serviceFee = order.service_fee || 0;
  const finalTotal = subtotal - discount + deliveryFee + serviceFee;
  const isDelivery = order.delivery_type === "delivery";
  const showBreakdown = discount > 0 || deliveryFee > 0 || serviceFee > 0 || isDelivery;

  if (showBreakdown) {
    out += lineLR("Subtotal", formatPrice(subtotal), width);
    if (discount > 0) {
      const discountLabel = order.coupon_code ? `Cupom ${order.coupon_code}` : "Desconto";
      out += lineLR(discountLabel, `- ${formatPrice(discount)}`, width);
      const sponsorMatch = order.notes?.match(/Subsidiado\s*por:\s*([^|]+?)(?:\s*\||\s*$)/i);
      if (sponsorMatch) {
        out += `  Subsidiado por: ${sponsorMatch[1].trim()}\n`;
      }
    }
    if (isDelivery) {
      out += lineLR(
        "Taxa de entrega",
        deliveryFee > 0 ? formatPrice(deliveryFee) : "Gratis",
        width
      );
    } else if (deliveryFee > 0) {
      out += lineLR("Taxa de entrega", formatPrice(deliveryFee), width);
    }
    if (serviceFee > 0) {
      out += lineLR("Taxa de servico", formatPrice(serviceFee), width);
    }
  }

  out += divider("=", width);
  out += lineLR("TOTAL", formatPrice(finalTotal), width) + "  [GRANDE+NEGRITO]\n";
  out += divider("=", width);

  if (order.payment_type) {
    out += "\n";
    out += labeled(
      "Pagamento:",
      formatPaymentType(order.payment_type, order.payment_brand),
      width
    );
  }

  const changeFor = parseChangeFor(order.notes);
  if (changeFor != null && changeFor >= finalTotal) {
    const troco = changeFor - finalTotal;
    out += divider("-", width);
    out += center("** TROCO **  [NEGRITO]", width);
    out += lineLR("Total do pedido", formatPrice(finalTotal), width);
    out += lineLR("Cliente vai pagar com", formatPrice(changeFor), width);
    out += lineLR("TROCO A LEVAR", formatPrice(troco), width) + "  [NEGRITO]\n";
  }

  const cleanNotes = cleanReceiptNotes(order.notes);
  if (cleanNotes) {
    out += divider("-", width);
    out += labeled("Obs:     ", cleanNotes, width);
  }

  if (order.cancellation_reason) {
    out += divider("-", width);
    out += labeled(
      "MOTIVO CANCELAMENTO:",
      order.cancellation_reason + "  [NEGRITO]",
      width
    );
  }

  out += "\n";
  out += center("Obrigado pela preferencia!  [NEGRITO]", width);
  out += center("Volte sempre :)", width);
  out += "\n";
  out += divider("-", width);
  out += center(`Impresso em ${formatDateTimeFull(new Date())}`, width);
  out += "\n";

  return out;
}

// =============================================================
// VIA DA COZINHA
// =============================================================
function buildKitchenPreview(order: OrderForPrinting, width: number): string {
  let out = "";

  out += center("VIA DA COZINHA  [GRANDE+NEGRITO]", width);
  out += divider("=", width);
  out += center(formatOrderLabel(order) + "  [GIGANTE]", width);
  out += divider("=", width);

  const originLabel = buildOriginLabel(order);
  out += center(originLabel + "  [GRANDE+NEGRITO]", width);

  if (order.dd_scheduled_for) {
    out += center("** AGENDADO **  [NEGRITO]", width);
    out += center(formatDateTimeShort(order.dd_scheduled_for), width);
  }
  out += divider("=", width);

  if (order.tables) {
    const tname = order.tables.table_name?.trim();
    const tnum = order.tables.table_number;
    const mesaStr = tname ? `${tname} (No ${tnum})` : `Mesa ${tnum}`;
    out += "MESA: " + mesaStr + "  [GRANDE+NEGRITO]\n";
  }
  out += labeled("Cliente:", order.customer_name || "-", width);
  out += labeled("Hora:   ", formatDateTimeShort(order.created_at), width);
  out += divider("-", width);

  out += center("ITENS A PREPARAR  [NEGRITO]", width);
  out += divider("-", width);

  for (const item of order.order_items) {
    for (const l of wrap(`${item.quantity}x ${item.products.name}`, dblWidth(width)))
      out += l + "  [GRANDE+NEGRITO]\n";

    for (const ex of item.order_item_extras) {
      out += "  + " + ex.name + "  [NEGRITO]\n";
    }

    if (item.notes && item.notes.trim()) {
      const obsLines = wrap(
        `>> OBS: ${item.notes.trim().toUpperCase()}`,
        width
      );
      for (const l of obsLines) out += l + "  [NEGRITO]\n";
    }
    out += divider("-", width);
  }

  const cleanNotes = order.notes
    ? order.notes.replace(/\[Desconto:.+?\]/g, "").trim()
    : "";
  if (cleanNotes) {
    out += labeled("OBS GERAL:", cleanNotes.toUpperCase() + "  [NEGRITO]", width);
  }

  out += "\n";
  out += divider("-", width);
  out += center(`Impresso em ${formatDateTimeFull(new Date())}`, width);
  out += "\n";
  return out;
}

export interface ReceiptPreviewResult {
  customer: string;
  kitchen: string;
  /** false quando a via da cozinha está desligada em Configurações → Impressoras. */
  kitchenEnabled: boolean;
  combined: string;
  storeName: string;
  orderId: string;
  lineWidth: number;
  widthLabel: ReceiptWidth;
  cutMark: string;
}

export async function buildReceiptPreview(
  orderId: string,
  widthLabel: ReceiptWidth = "80mm"
): Promise<ReceiptPreviewResult> {
  const width = WIDTH_COLUMNS[widthLabel];
  const [order, loja] = await Promise.all([
    fetchOrderForPrinting(orderId),
    fetchContextoDaLoja(orderId),
  ]);
  const storeName = loja.nome;
  const customer = buildCustomerPreview(order, storeName, width);
  const kitchen = buildKitchenPreview(order, width);
  const cutMark = buildCutMark(width);
  return {
    customer,
    kitchen,
    kitchenEnabled: loja.imprimirViaCozinha,
    combined: loja.imprimirViaCozinha
      ? customer + cutMark + kitchen + cutMark
      : customer + cutMark,
    storeName,
    orderId,
    lineWidth: width,
    widthLabel,
    cutMark,
  };
}

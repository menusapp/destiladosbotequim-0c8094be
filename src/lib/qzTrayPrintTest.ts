/**
 * Teste isolado de IMPRESSÃO via QZ Tray.
 *
 * Imprime um texto simples (modo "raw text", sem ESC/POS e sem corte)
 * na impressora padrão do sistema, ou em uma impressora informada por nome.
 *
 * NÃO altera o fluxo atual de impressão (window.print continua intacto).
 *
 * Uso no DevTools:
 *   await window.testPrintQz()                 // usa a padrão
 *   await window.testPrintQz("EPSON TM-T20")   // usa uma específica
 */

import qz from "qz-tray";
import { PREFIXO_CP850, viaEscposParaQz } from "@/lib/escposEncoding";

export interface QzPrintTestResult {
  success: boolean;
  printer: string | null;
  error?: string;
}

const TEST_TEXT = [
  PREFIXO_CP850 + "Menu's Teste",
  "Pedido #123",
  "Cliente: Teste",
  "1x Porção de Açúcar — ãõç",
  "",
  "",
  "",
].join("\n");

export async function testPrintQz(
  printerName?: string
): Promise<QzPrintTestResult> {
  console.group("🖨️ [QZ Tray] Teste de impressão");

  let usedPrinter: string | null = null;

  try {
    if (!qz.websocket.isActive()) {
      console.log("⏳ Conectando ao QZ Tray (ws://localhost:8181)…");
      await qz.websocket.connect();
    } else {
      console.log("ℹ️ Já estava conectado.");
    }

    // Seleciona impressora
    if (printerName) {
      usedPrinter = printerName;
      console.log("🎯 Impressora informada:", usedPrinter);
    } else {
      usedPrinter = (await qz.printers.getDefault()) as string;
      console.log("⭐ Usando impressora padrão:", usedPrinter);
    }

    if (!usedPrinter) {
      throw new Error(
        "Nenhuma impressora encontrada. Defina uma padrão no SO ou passe o nome."
      );
    }

    const config = qz.configs.create(usedPrinter);

    const data = [viaEscposParaQz(TEST_TEXT)];

    console.log("📤 Enviando texto para impressão:");
    console.log(TEST_TEXT);

    await qz.print(config, data);

    console.log("✅ Impressão enviada com sucesso.");
    console.log("🔒 [QZ Tray] conexão mantida ativa para reutilização.");
    console.groupEnd();
    return { success: true, printer: usedPrinter };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("❌ Falha na impressão de teste:", message);
    console.warn(
      "Verifique se o QZ Tray está rodando e se a impressora está disponível."
    );
    console.groupEnd();
    return { success: false, printer: usedPrinter, error: message };
  }
}

// Exposição no window para chamar via DevTools:
//   await window.testPrintQz()
//   await window.testPrintQz("Nome da Impressora")
if (typeof window !== "undefined") {
  (window as any).testPrintQz = testPrintQz;
}

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installProductionLogSilencer } from "./lib/logger";

// Silencia console.log/info/warn/debug em produção (mantém console.error).
// Em dev/preview, todos os logs continuam funcionando normalmente.
installProductionLogSilencer();

// Corrige a tela "bugada" no celular ao digitar no checkout (faixa em branco /
// campos deslocados quando o teclado abre/fecha em drawers e dialogs).
import { installMobileKeyboardFix } from "./lib/mobileKeyboardFix";
installMobileKeyboardFix();

// Side-effect import: registra window.testQzTrayConnection para teste via DevTools.
// NÃO altera o fluxo de impressão atual.
import "./lib/qzTrayTest";
import "./lib/qzTrayPrintTest";
import "./lib/qzPrinterConfig";
import "./lib/printOrderWithQz";

// Configura assinatura digital do QZ Tray (elimina o popup "Untrusted website"
// quando o certificado correspondente está instalado no QZ Tray do cliente).
import { setupQzSigning } from "./lib/qzSigning";
void setupQzSigning();

// Meta Pixel — inicializa o mais cedo possível (PageView inicial automático)
import { initMetaPixel } from "./lib/metaPixel";
initMetaPixel();

createRoot(document.getElementById("root")!).render(<App />);

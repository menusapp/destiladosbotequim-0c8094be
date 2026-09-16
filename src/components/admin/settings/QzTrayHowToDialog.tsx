/**
 * Diálogo "Como configurar QZ Tray" — passo a passo detalhado
 * para o operador instalar o certificado override.crt e ativar a
 * impressão automática.
 *
 * NÃO altera nenhuma lógica de impressão / assinatura — apenas exibe
 * instruções e caminhos.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  HelpCircle,
  Download,
  FolderOpen,
  RefreshCw,
  Plug,
  Printer,
  AlertTriangle,
  Copy,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

import { copiarTexto } from "@/lib/clipboard";
const PATHS = {
  windows: String.raw`C:\Program Files\QZ Tray\resources\override.crt`,
  mac: "/Applications/QZ Tray.app/Contents/Resources/override.crt",
  linux: "/opt/qz-tray/resources/override.crt",
};

const PathRow = ({ label, path }: { label: string; path: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await copiarTexto(path);
      setCopied(true);
      toast.success("Caminho copiado");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  return (
    <div className="rounded-md border bg-muted/30 p-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="secondary">{label}</Badge>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          onClick={handleCopy}
        >
          {copied ? (
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
          ) : (
            <Copy className="h-3.5 w-3.5 mr-1" />
          )}
          Copiar
        </Button>
      </div>
      <code className="block text-xs font-mono break-all">{path}</code>
    </div>
  );
};

export const QzTrayHowToDialog = () => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <HelpCircle className="h-4 w-4" />
          Como configurar QZ Tray
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Como configurar a impressão automática (QZ Tray)
          </DialogTitle>
          <DialogDescription>
            Siga os passos abaixo na ordem. Em poucos minutos sua impressora
            térmica imprime sem precisar do popup do navegador.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 space-y-6 text-sm">
          {/* Passo 1 */}
          <section className="space-y-2">
            <h3 className="font-semibold flex items-center gap-2">
              <Printer className="h-4 w-4" />
              Passo 1 — Selecione o método QZ Tray
            </h3>
            <p className="text-muted-foreground">
              No topo desta página, em <strong>Método de impressão padrão</strong>,
              marque a opção <strong>QZ Tray</strong>. Esse será o método usado
              em todo o sistema (pedidos, mesas, contas, PDV).
            </p>
          </section>

          {/* Passo 2 */}
          <section className="space-y-2">
            <h3 className="font-semibold flex items-center gap-2">
              <Download className="h-4 w-4" />
              Passo 2 — Baixe o certificado de segurança
            </h3>
            <p className="text-muted-foreground">
              Role a página até a seção <strong>Configurar Impressão Automática
              (Sem Popup)</strong> e clique em <strong>Baixar Certificado de
              Segurança</strong>. Um arquivo <code>override.crt</code> será
              salvo na pasta de Downloads do seu computador.
            </p>
          </section>

          {/* Passo 3 */}
          <section className="space-y-3">
            <h3 className="font-semibold flex items-center gap-2">
              <FolderOpen className="h-4 w-4" />
              Passo 3 — Cole na pasta correta do QZ Tray
            </h3>
            <p className="text-muted-foreground">
              Copie o <code>override.crt</code> baixado para a pasta exata do
              seu sistema operacional:
            </p>
            <div className="space-y-2">
              <PathRow label="Windows" path={PATHS.windows} />
              <PathRow label="macOS" path={PATHS.mac} />
              <PathRow label="Linux" path={PATHS.linux} />
            </div>

            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-1">
              <div className="flex items-center gap-2 font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Atenção — pontos que mais causam erro:
              </div>
              <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
                <li>
                  Se já existir um <code>override.crt</code> antigo,{" "}
                  <strong>substitua</strong> pelo novo.
                </li>
                <li>
                  <strong>Não</strong> use a pasta <code>/auth</code> — o
                  arquivo deve ficar dentro de <code>resources</code>.
                </li>
                <li>
                  No Windows pode ser pedida permissão de administrador para
                  colar — confirme.
                </li>
                <li>
                  O nome do arquivo precisa ser exatamente{" "}
                  <code>override.crt</code> (sem renomear).
                </li>
              </ul>
            </div>
          </section>

          {/* Passo 4 */}
          <section className="space-y-2">
            <h3 className="font-semibold flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Passo 4 — Feche e abra o QZ Tray
            </h3>
            <p className="text-muted-foreground">
              Vá no ícone do QZ Tray ao lado do relógio, clique com o botão
              direito e escolha <strong>Exit</strong>. Depois abra o QZ Tray
              novamente pelo menu Iniciar (ou Launchpad no Mac). Sem reiniciar,
              o certificado novo não é aplicado.
            </p>
          </section>

          {/* Passo 5 */}
          <section className="space-y-2">
            <h3 className="font-semibold flex items-center gap-2">
              <Plug className="h-4 w-4" />
              Passo 5 — Conecte ao QZ Tray
            </h3>
            <p className="text-muted-foreground">
              Volte para a seção <strong>Impressão Térmica (QZ Tray)</strong>
              {" "}desta página e clique em{" "}
              <strong>Conectar / Testar QZ Tray</strong>. O sistema vai
              conversar com o QZ Tray instalado e listar as impressoras
              disponíveis logo abaixo.
            </p>
          </section>

          {/* Passo 6 */}
          <section className="space-y-2">
            <h3 className="font-semibold flex items-center gap-2">
              <Printer className="h-4 w-4" />
              Passo 6 — Selecione sua impressora e teste
            </h3>
            <p className="text-muted-foreground">
              Escolha na lista a impressora térmica que vai imprimir os pedidos
              — a escolha é salva automaticamente. Em seguida clique em{" "}
              <strong>Testar impressão</strong>. Se o papel sair sem aparecer
              popup de permissão, está tudo certo: a impressão automática está
              ativa em todo o sistema.
            </p>
          </section>

          {/* Erro comum */}
          <section className="space-y-2 rounded-md border bg-muted/30 p-3">
            <h3 className="font-semibold flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Se aparecer "Invalid Certificate"
            </h3>
            <ol className="list-decimal list-inside text-xs text-muted-foreground space-y-1">
              <li>Feche completamente o QZ Tray (Exit no ícone do relógio).</li>
              <li>
                Confirme que o <code>override.crt</code> NÃO está na pasta{" "}
                <code>/auth</code>.
              </li>
              <li>Verifique se o caminho usado é exatamente o indicado no passo 3.</li>
              <li>Substitua qualquer <code>override.crt</code> antigo pelo novo.</li>
              <li>Abra o QZ Tray novamente e teste a impressão.</li>
            </ol>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default QzTrayHowToDialog;

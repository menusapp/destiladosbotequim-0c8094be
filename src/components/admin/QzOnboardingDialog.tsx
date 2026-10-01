/**
 * Onboarding guiado do QZ Tray.
 *
 * Aparece apenas quando:
 *  - O método de impressão configurado é "qz_tray"
 *  - O usuário ainda não concluiu o onboarding (qz:configured !== "true")
 *  - O usuário não dispensou nesta sessão
 *
 * Fluxo:
 *  1. Intro → botão "Conectar impressora"
 *  2. Conexão (avisa sobre o popup "Allow")
 *  3. Seleção da impressora
 *  4. Teste de impressão
 *  5. Sucesso → marca qz:configured = true
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Printer, Plug, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import qz from "qz-tray";
import { PREFIXO_CP850, viaEscposParaQz } from "@/lib/escposEncoding";
import {
  markQzConfigured,
  setSavedQzPrinter,
  dismissQzOnboarding,
} from "@/lib/qzPrinterConfig";
import { ensureQzConnected } from "@/lib/qzConnectionManager";

type Step = "intro" | "connecting" | "select" | "testing" | "done" | "error";

interface Props {
  open: boolean;
  onClose: () => void;
}

const SAMPLE_TEXT = [
  PREFIXO_CP850 + "Menu's - Teste de impressão",
  "----------------------------",
  "Impressora configurada com sucesso!",
  "Acentuação: ãõáéíóúâêôç ÃÕÁÉÍÓÚÂÊÔÇ",
  "",
  "",
  "",
].join("\n");

export const QzOnboardingDialog = ({ open, onClose }: Props) => {
  const [step, setStep] = useState<Step>("intro");
  const [printers, setPrinters] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    if (open) {
      setStep("intro");
      setErrorMsg("");
    }
  }, [open]);

  const handleConnect = async () => {
    setStep("connecting");
    setErrorMsg("");
    try {
      await ensureQzConnected();
      const list = (await qz.printers.find()) as string[];
      setPrinters(list);
      if (list.length === 0) {
        setErrorMsg(
          "Nenhuma impressora detectada. Conecte uma impressora ao computador e tente novamente."
        );
        setStep("error");
        return;
      }
      // Pré-seleciona a padrão se vier
      try {
        const def = (await qz.printers.getDefault()) as string;
        if (def && list.includes(def)) setSelected(def);
        else setSelected(list[0]);
      } catch {
        setSelected(list[0]);
      }
      setStep("select");
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErrorMsg(
        "Não foi possível conectar ao QZ Tray. Verifique se o aplicativo está aberto no computador."
      );
      console.error("[QZ Onboarding] connect error:", msg);
      setStep("error");
    }
  };

  const handleTest = async () => {
    if (!selected) return;
    setStep("testing");
    setErrorMsg("");
    try {
      await ensureQzConnected();
      const config = qz.configs.create(selected);
      await qz.print(config, [viaEscposParaQz(SAMPLE_TEXT)]);
      setSavedQzPrinter(selected);
      markQzConfigured();
      setStep("done");
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErrorMsg(`Falha ao imprimir: ${msg}`);
      console.error("[QZ Onboarding] print error:", msg);
      setStep("error");
    }
  };

  const handleDismiss = () => {
    dismissQzOnboarding();
    onClose();
  };

  const handleFinish = () => {
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleDismiss();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {step === "intro" && (
          <>
            <DialogHeader>
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Printer className="h-6 w-6 text-primary" />
              </div>
              <DialogTitle className="text-center">
                Tudo pronto para imprimir
              </DialogTitle>
              <DialogDescription className="text-center">
                Vamos conectar sua impressora térmica em 10 segundos.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Como funciona:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Clique em <strong>Conectar impressora</strong> abaixo</li>
                <li>O QZ Tray vai pedir permissão — clique em <strong>Allow</strong></li>
                <li>Escolha sua impressora térmica</li>
                <li>Faça um teste de impressão</li>
              </ol>
            </div>
            <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
              <Button variant="ghost" onClick={handleDismiss}>
                Agora não
              </Button>
              <Button onClick={handleConnect}>
                <Plug className="h-4 w-4 mr-2" />
                Conectar impressora
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "connecting" && (
          <>
            <DialogHeader>
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Loader2 className="h-6 w-6 text-primary animate-spin" />
              </div>
              <DialogTitle className="text-center">Conectando ao QZ Tray...</DialogTitle>
              <DialogDescription className="text-center">
                Quando aparecer um popup, clique em <strong>Allow</strong> para continuar.
              </DialogDescription>
            </DialogHeader>
          </>
        )}

        {step === "select" && (
          <>
            <DialogHeader>
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Printer className="h-6 w-6 text-primary" />
              </div>
              <DialogTitle className="text-center">Escolha sua impressora</DialogTitle>
              <DialogDescription className="text-center">
                Encontramos {printers.length} impressora(s) no computador.
              </DialogDescription>
            </DialogHeader>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {printers.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
              <Button variant="ghost" onClick={handleDismiss}>
                Cancelar
              </Button>
              <Button onClick={handleTest} disabled={!selected}>
                <Printer className="h-4 w-4 mr-2" />
                Testar impressão
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "testing" && (
          <>
            <DialogHeader>
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Loader2 className="h-6 w-6 text-primary animate-spin" />
              </div>
              <DialogTitle className="text-center">Enviando teste...</DialogTitle>
              <DialogDescription className="text-center">
                Verifique se a impressora está imprimindo.
              </DialogDescription>
            </DialogHeader>
          </>
        )}

        {step === "done" && (
          <>
            <DialogHeader>
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <CheckCircle2 className="h-6 w-6 text-primary" />
              </div>
              <DialogTitle className="text-center">Tudo certo!</DialogTitle>
              <DialogDescription className="text-center">
                Sua impressora <strong>{selected}</strong> está configurada e pronta para uso.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={handleFinish} className="w-full">
                Concluir
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "error" && (
          <>
            <DialogHeader>
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <DialogTitle className="text-center">Não foi possível conectar</DialogTitle>
              <DialogDescription className="text-center">
                {errorMsg}
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border bg-muted/50 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Verifique:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>QZ Tray instalado e <strong>aberto</strong> (ícone na bandeja do sistema)</li>
                <li>Se apareceu o popup do QZ, você clicou em <strong>Allow</strong></li>
                <li>Impressora ligada e conectada ao computador</li>
              </ul>
            </div>
            <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
              <Button variant="ghost" onClick={handleDismiss}>
                Fechar
              </Button>
              <Button onClick={handleConnect}>Tentar novamente</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default QzOnboardingDialog;

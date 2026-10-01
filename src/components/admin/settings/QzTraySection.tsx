/**
 * Seção QZ Tray dentro da aba "Impressoras".
 *
 * - Conecta/testa QZ Tray
 * - Lista impressoras
 * - Seleciona e persiste em localStorage (qzPrinterConfig)
 * - Testa impressão simples (texto puro, sem ESC/POS)
 *
 * NÃO altera a impressão antiga (window.print) — totalmente isolado.
 */

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Printer,
  Plug,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import qz from "qz-tray";
import {
  getSavedQzPrinter,
  setSavedQzPrinter,
  clearSavedQzPrinter,
} from "@/lib/qzPrinterConfig";
import { ensureQzConnected } from "@/lib/qzConnectionManager";

type ConnStatus = "idle" | "connecting" | "connected" | "error";

const SAMPLE_TEXT = [
  "Menu's Teste (QZ Tray)",
  "------------------------",
  "Conexao OK",
  "Impressao funcionando",
  "",
  "",
  "",
].join("\n");

export const QzTraySection = () => {
  const [status, setStatus] = useState<ConnStatus>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [printers, setPrinters] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [savedMissing, setSavedMissing] = useState(false);

  // Carrega impressora salva no mount
  useEffect(() => {
    const saved = getSavedQzPrinter();
    if (saved) setSelected(saved);
  }, []);

  // Marca se a impressora salva NÃO está na lista atual
  useEffect(() => {
    const saved = getSavedQzPrinter();
    if (saved && printers.length > 0 && !printers.includes(saved)) {
      setSavedMissing(true);
    } else {
      setSavedMissing(false);
    }
  }, [printers]);

  const ensureConnected = async () => {
    await ensureQzConnected();
  };

  const handleConnect = async () => {
    setStatus("connecting");
    try {
      await ensureConnected();
      const v = (await qz.api.getVersion()) as string;
      setVersion(v);
      setStatus("connected");
      toast.success(`QZ Tray conectado (v${v})`);
      await loadPrinters(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[QZ] connect error:", msg);
      setStatus("error");
      // A causa mais comum NÃO é o QZ Tray estar fechado: é a página estar em
      // HTTP numa origem pública. O navegador proíbe esse tipo de página de
      // falar com localhost (Private Network Access), então a conexão falha
      // mesmo com o QZ rodando. `isSecureContext` distingue os dois casos sem
      // chute — e é a mesma coisa que quebra crypto.randomUUID e a cópia de
      // links, então vale dizer ao usuário o que realmente resolve.
      const contextoInseguro =
        typeof window !== "undefined" && !window.isSecureContext;

      toast.error("Falha ao conectar ao QZ Tray", {
        description: contextoInseguro
          ? `A página está em HTTP (${window.location.origin}). O navegador bloqueia páginas inseguras de acessarem o QZ Tray em localhost — ele pode estar rodando normalmente. Solução: publicar o sistema em HTTPS com domínio próprio. Detalhe técnico: ${msg}`
          : `O QZ Tray parece não estar respondendo. Confira se está aberto (ícone ao lado do relógio) e tente de novo. Detalhe técnico: ${msg}`,
        duration: 20000,
      });
    }
  };

  const loadPrinters = async (showToast = true) => {
    setLoadingList(true);
    try {
      await ensureConnected();
      const list = (await qz.printers.find()) as string[];
      setPrinters(list);
      if (showToast) toast.success(`${list.length} impressora(s) encontrada(s)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[QZ] list error:", msg);
      toast.error("Não foi possível listar impressoras");
    } finally {
      setLoadingList(false);
    }
  };

  const handleSelect = (name: string) => {
    setSelected(name);
    setSavedQzPrinter(name);
    setSavedMissing(false);
    toast.success("Impressora selecionada", { description: name });
  };

  const handleClear = () => {
    clearSavedQzPrinter();
    setSelected(null);
    toast("Configuração de impressora removida");
  };

  const handleTestPrint = async () => {
    if (!selected) {
      toast.error("Selecione uma impressora antes de testar");
      return;
    }
    setPrinting(true);
    try {
      await ensureConnected();
      const config = qz.configs.create(selected);
      await qz.print(config, [
        { type: "raw", format: "plain", data: SAMPLE_TEXT },
      ]);
      toast.success("Teste enviado para impressão");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[QZ] print error:", msg);
      toast.error("Falha na impressão de teste", { description: msg });
    } finally {
      setPrinting(false);
    }
  };

  const savedName = getSavedQzPrinter();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-5 w-5" />
          Impressão Térmica (QZ Tray)
        </CardTitle>
        <CardDescription>
          Conecte o QZ Tray para imprimir diretamente em impressoras térmicas
          instaladas no computador, sem usar o diálogo do navegador.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Status da conexão */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={handleConnect}
            disabled={status === "connecting"}
            data-tour="qz-connect"
          >
            <Plug className="h-4 w-4 mr-2" />
            {status === "connecting"
              ? "Conectando..."
              : status === "connected"
                ? "Reconectar / Testar"
                : "Conectar / Testar QZ Tray"}
          </Button>

          {status === "connected" && (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Conectado{version ? ` · v${version}` : ""}
            </Badge>
          )}
          {status === "error" && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              Falha na conexão
            </Badge>
          )}
        </div>

        {/* Status da impressora salva */}
        <div className="rounded-md border p-3 text-sm">
          <p className="font-medium mb-1">Impressora configurada</p>
          {savedName ? (
            <div className="flex items-center gap-2">
              <Printer className="h-4 w-4 text-muted-foreground" />
              <span>{savedName}</span>
              {savedMissing && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Não encontrada agora
                </Badge>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">
              Nenhuma impressora salva. Conecte o QZ Tray e selecione uma abaixo.
            </p>
          )}
        </div>

        {/* Lista + seleção */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Impressoras disponíveis</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => loadPrinters(true)}
              disabled={loadingList}
            >
              <RefreshCw
                className={`h-4 w-4 mr-1 ${loadingList ? "animate-spin" : ""}`}
              />
              Atualizar
            </Button>
          </div>

          <Select
            value={selected ?? undefined}
            onValueChange={handleSelect}
            disabled={printers.length === 0}
          >
            <SelectTrigger data-tour="qz-printer-select">
              <SelectValue
                placeholder={
                  printers.length === 0
                    ? "Conecte o QZ Tray para listar impressoras"
                    : "Selecione uma impressora"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {printers.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {savedMissing && (
            <p className="text-xs text-destructive">
              A impressora salva não foi encontrada agora. Selecione outra acima
              para atualizar a configuração.
            </p>
          )}
        </div>

        {/* Ações */}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleTestPrint}
            disabled={!selected || printing}
            data-tour="qz-test-print"
          >
            <Printer className="h-4 w-4 mr-2" />
            {printing ? "Imprimindo..." : "Testar impressão"}
          </Button>
          {savedName && (
            <Button variant="outline" onClick={handleClear}>
              Limpar configuração
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Esta configuração é independente e não altera a impressão atual via
          navegador. Ela é usada pela nova impressão térmica (QZ Tray) do sistema.
        </p>
      </CardContent>
    </Card>
  );
};

export default QzTraySection;

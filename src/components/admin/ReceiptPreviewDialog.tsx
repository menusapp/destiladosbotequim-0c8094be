import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, Check, X, Printer } from "lucide-react";
import { toast } from "sonner";
import { copiarTexto } from "@/lib/clipboard";
import {
  buildReceiptPreview,
  type ReceiptPreviewResult,
  type ReceiptWidth,
} from "@/lib/buildReceiptPreview";

interface ReceiptPreviewDialogProps {
  orderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReceiptPreviewDialog({
  orderId,
  open,
  onOpenChange,
}: ReceiptPreviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReceiptPreviewResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [width, setWidth] = useState<ReceiptWidth>("80mm");

  useEffect(() => {
    if (!open || !orderId) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    buildReceiptPreview(orderId, width)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        console.error("[ReceiptPreviewDialog] erro ao gerar preview:", err);
        toast.error("Não foi possível gerar o preview do cupom");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, orderId, width]);

  const rulerText = useMemo(() => {
    if (!data) return "";
    let r = "";
    for (let i = 1; i <= data.lineWidth; i++) {
      if (i % 10 === 0) r += String(i / 10);
      else if (i % 5 === 0) r += "+";
      else r += "·";
    }
    return r;
  }, [data]);

  const copyContent = async () => {
    if (!data) return;
    try {
      await copiarTexto(data.combined);
      setCopied(true);
      toast.success("Texto do cupom copiado");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Falha ao copiar");
    }
  };

  // Largura visual da bobina em "ch" (caracteres)
  // 80mm → ~44ch, 58mm → ~34ch
  const paperMaxWidth = data
    ? `${data.lineWidth + 2}ch`
    : "44ch";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <DialogTitle className="flex items-center gap-2">
                <Printer className="w-4 h-4" />
                Preview do cupom térmico
              </DialogTitle>
              <DialogDescription className="mt-1">
                Pré-visualização fiel ao cupom ESC/POS enviado pela impressão
                via QZ Tray. Marcadores como{" "}
                <span className="font-mono text-xs">[NEGRITO]</span> /{" "}
                <span className="font-mono text-xs">[GRANDE]</span> são apenas
                indicativos do efeito visual aplicado — não aparecem no papel.
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 border-b bg-muted/30">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Largura da bobina:
            </span>
            <div className="inline-flex rounded-md border bg-background p-0.5">
              {(["58mm", "80mm"] as ReceiptWidth[]).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWidth(w)}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    width === w
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
            {data && (
              <span className="text-[11px] text-muted-foreground">
                ({data.lineWidth} colunas)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {data && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Loja: <span className="font-medium">{data.storeName}</span> ·
                Pedido{" "}
                <span className="font-mono">{data.orderId.slice(0, 8)}</span>
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={!data}
              onClick={copyContent}
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 mr-1" /> Copiado
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-1" /> Copiar texto
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Área de preview — fundo cinza tipo "visualização de impressão" */}
        <div className="flex-1 overflow-auto bg-[hsl(var(--muted))] p-6">
          {loading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Gerando preview…
            </div>
          )}

          {!loading && data && (
            <div className="flex justify-center">
              {/* Bobina simulada */}
              <div
                className="bg-white text-black shadow-2xl rounded-sm relative"
                style={{
                  width: paperMaxWidth,
                  // Bordas serrilhadas no topo e na base — aparência de papel térmico
                  paddingTop: "1.25rem",
                  paddingBottom: "1.25rem",
                  paddingLeft: "0.9rem",
                  paddingRight: "0.9rem",
                  fontFamily:
                    '"Courier New", "Courier", "Lucida Console", monospace',
                }}
              >
                {/* Régua superior discreta */}
                <pre
                  className="text-[10px] leading-none mb-2 select-none"
                  style={{
                    color: "#9ca3af",
                    fontFamily: "inherit",
                    whiteSpace: "pre",
                  }}
                >
                  {rulerText}
                </pre>

                <pre
                  className="text-[12px] leading-[1.4] whitespace-pre"
                  style={{
                    fontFamily: "inherit",
                    color: "#111827",
                  }}
                >
                  {data.combined}
                </pre>

                {/* Sombra/serrilhado inferior visual (opcional) */}
                <div
                  aria-hidden
                  className="absolute -bottom-[6px] left-0 right-0 h-[6px]"
                  style={{
                    backgroundImage:
                      "linear-gradient(135deg, white 25%, transparent 25%), linear-gradient(225deg, white 25%, transparent 25%)",
                    backgroundSize: "8px 8px",
                    backgroundPosition: "0 0, 0 0",
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t bg-background">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

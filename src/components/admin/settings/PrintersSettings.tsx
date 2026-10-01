import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Printer, CheckCircle2, Globe, FileText, Zap } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { QzTraySection } from "./QzTraySection";
import { QzTrustSetup } from "./QzTrustSetup";
import { QzTrayHowToDialog } from "./QzTrayHowToDialog";
import { QzTrayDownloadCard } from "./QzTrayDownloadCard";
import type { PrintMethod } from "@/lib/printDispatcher";

interface WebPrinterConfig {
  paperSize: string;
  autoPrintOrders: boolean;
  autoPrintReceipts: boolean;
  fontFamily: string;
  fontSize: number;
  fontBold: boolean;
  printCopies: number;
  supportsAutoCut: boolean;
  printMethod: PrintMethod;
  /** Imprimir também a via da cozinha (só afeta a impressão via QZ Tray). */
  printKitchenCopy: boolean;
}

const FONT_OPTIONS = [
  { value: 'Arial Black', label: 'Arial Black' },
  { value: 'Courier New', label: 'Courier New' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Verdana', label: 'Verdana' },
  { value: 'Tahoma', label: 'Tahoma' },
  { value: 'Impact', label: 'Impact' },
  { value: 'Lucida Console', label: 'Lucida Console' },
  { value: 'monospace', label: 'Monospace' },
];

const FONT_SIZE_OPTIONS = [8, 9, 10, 11, 12, 13, 14, 16, 18];

const PrintersSettings = ({ restaurantId }: { restaurantId: string }) => {
  const [testing, setTesting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [webConfig, setWebConfig] = useState<WebPrinterConfig>({
    paperSize: '80mm',
    autoPrintOrders: false,
    autoPrintReceipts: false,
    fontFamily: 'Arial Black',
    fontSize: 12,
    fontBold: true,
    printCopies: 1,
    supportsAutoCut: false,
    printMethod: 'pdf',
    printKitchenCopy: true,
  });

  useEffect(() => {
    loadWebConfig();
  }, [restaurantId]);

  const loadWebConfig = async () => {
    try {
      const { data } = await supabase
        .from('printer_settings')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();
      if (data) {
        const rawMethod = (data as any).print_method;
        setWebConfig({
          paperSize: data.paper_size || '80mm',
          autoPrintOrders: Boolean(data.auto_print_orders),
          autoPrintReceipts: Boolean(data.auto_print_receipts),
          fontFamily: (data as any).font_family || 'Arial Black',
          fontSize: (data as any).font_size || 12,
          fontBold: (data as any).font_bold !== undefined ? Boolean((data as any).font_bold) : true,
          printCopies: (data as any).print_copies || 1,
          supportsAutoCut: Boolean((data as any).supports_auto_cut),
          printMethod: rawMethod === 'qz_tray' ? 'qz_tray' : 'pdf',
          // Só desliga quando o banco diz explicitamente `false`.
          printKitchenCopy: data.print_kitchen_copy !== false,
        });
      }
    } catch (error) {
      console.error('Error loading web printer config:', error);
    }
  };

  const saveWebConfig = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('printer_settings')
        .upsert({
          restaurant_id: restaurantId,
          paper_size: webConfig.paperSize,
          auto_print_orders: webConfig.autoPrintOrders,
          auto_print_receipts: webConfig.autoPrintReceipts,
          font_family: webConfig.fontFamily,
          font_size: webConfig.fontSize,
          font_bold: webConfig.fontBold,
          print_copies: webConfig.printCopies,
          supports_auto_cut: webConfig.supportsAutoCut,
          print_method: webConfig.printMethod,
          print_kitchen_copy: webConfig.printKitchenCopy,
          updated_at: new Date().toISOString(),
        } as any, { onConflict: 'restaurant_id' });
      if (error) throw error;
      toast.success('Configurações salvas!');
    } catch (error) {
      console.error('Error saving web config:', error);
      toast.error('Erro ao salvar configurações');
    } finally {
      setSaving(false);
    }
  };

  const testWebPrint = () => {
    setTesting('web');
    const width = webConfig.paperSize === '58mm' ? '58mm' : '80mm';
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) {
      toast.error('Popup bloqueado. Permita popups para imprimir.');
      setTesting(null);
      return;
    }
    const fontW = webConfig.fontBold ? 'bold' : 'normal';
    const fontF = webConfig.fontFamily;
    const fontS = webConfig.fontSize;
    printWindow.document.write(`
      <html>
      <head>
        <title>Teste de Impressão</title>
        <style>
          @page { margin: 0; size: ${width} auto; }
          body { font-family: '${fontF}', monospace; width: ${width}; margin: 0 auto; padding: 8px; font-size: ${fontS}px; font-weight: ${fontW}; }
          .center { text-align: center; }
          .line { border-top: 1px dashed #000; margin: 8px 0; }
          h2 { margin: 4px 0; font-size: ${fontS + 2}px; }
        </style>
      </head>
      <body>
        <div class="center">
          <h2>*** TESTE DE IMPRESSÃO ***</h2>
          <p>Menu's - Sistema de Gestão</p>
        </div>
        <div class="line"></div>
        <p>Tamanho do papel: ${width}</p>
        <p>Data: ${new Date().toLocaleString('pt-BR')}</p>
        <div class="line"></div>
        <table style="width:100%">
          <tr><td>Item Exemplo 1</td><td style="text-align:right">R$ 25,90</td></tr>
          <tr><td>Item Exemplo 2</td><td style="text-align:right">R$ 18,50</td></tr>
          <tr><td>Item Exemplo 3</td><td style="text-align:right">R$ 32,00</td></tr>
        </table>
        <div class="line"></div>
        <table style="width:100%">
          <tr><td><strong>TOTAL</strong></td><td style="text-align:right"><strong>R$ 76,40</strong></td></tr>
        </table>
        <div class="line"></div>
        <div class="center">
          <p>✓ Impressão funcionando!</p>
          <p>Obrigado pela preferência</p>
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      setTesting(null);
    }, 500);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Impressoras</h2>
          <p className="text-muted-foreground">Configure a impressão de pedidos e cupons via navegador</p>
        </div>
        <QzTrayHowToDialog />
      </div>

      <QzTrayDownloadCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Método de impressão padrão
          </CardTitle>
          <CardDescription>
            Este será o método de impressão usado em <strong>todo o sistema</strong>. Todos os botões "Imprimir" do painel
            (pedidos, mesas, contas, PDV) usarão automaticamente o método selecionado aqui.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={webConfig.printMethod}
            onValueChange={(v) => setWebConfig((prev) => ({ ...prev, printMethod: v as PrintMethod }))}
            className="space-y-3"
            data-tour="printers-method"
          >
            <label
              htmlFor="print-method-pdf"
              className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition"
            >
              <RadioGroupItem value="pdf" id="print-method-pdf" className="mt-1" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <p className="font-medium">PDF / Impressora do sistema</p>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Abre o diálogo de impressão do navegador. Funciona em qualquer impressora — térmica, jato de tinta ou laser.
                </p>
              </div>
            </label>

            <label
              htmlFor="print-method-qz"
              data-tour="printers-method-qz"
              className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition"
            >
              <RadioGroupItem value="qz_tray" id="print-method-qz" className="mt-1" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-muted-foreground" />
                  <p className="font-medium">QZ Tray</p>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Impressão direta na térmica via ESC/POS. Requer o QZ Tray instalado e aberto no computador, e uma impressora selecionada na seção QZ Tray abaixo.
                </p>
              </div>
            </label>
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Impressão via Navegador
          </CardTitle>
          <CardDescription>
            Na versão web, a impressão usa o diálogo nativo do navegador (Ctrl+P / Cmd+P)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3">
            <CheckCircle2 className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Como configurar:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Instale o driver da impressora térmica no seu computador</li>
                <li>Conecte a impressora (USB, rede ou Bluetooth)</li>
                <li>Escolha o tamanho do papel abaixo</li>
                <li>Clique em "Testar Impressão" para verificar</li>
                <li>No diálogo de impressão do navegador, selecione sua impressora térmica</li>
                <li>Salve as configurações</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Configurações de Impressão
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2 max-w-xs">
            <Label>Tamanho do Papel</Label>
            <Select value={webConfig.paperSize} onValueChange={(value) => setWebConfig(prev => ({ ...prev, paperSize: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="80mm">80mm (padrão)</SelectItem>
                <SelectItem value="58mm">58mm</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <Label>Imprimir ao aceitar pedido</Label>
              <p className="text-sm text-muted-foreground">Imprime a comanda sozinho quando você aceita um pedido. Pedidos que já entram aceitos (totem, PDV e mesa) são impressos na hora em que chegam.</p>
            </div>
            <Switch checked={webConfig.autoPrintOrders} onCheckedChange={(checked) => setWebConfig(prev => ({ ...prev, autoPrintOrders: checked }))} />
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <Label>Imprimir cupom ao fechar conta</Label>
              <p className="text-sm text-muted-foreground">Ao marcar uma conta como paga, abre automaticamente o diálogo de impressão do cupom</p>
            </div>
            <Switch checked={webConfig.autoPrintReceipts} onCheckedChange={(checked) => setWebConfig(prev => ({ ...prev, autoPrintReceipts: checked }))} />
          </div>

          <div className="space-y-2 max-w-xs">
            <Label>Número de Vias</Label>
            <p className="text-sm text-muted-foreground">Quantas cópias imprimir de cada pedido</p>
            <Select value={String(webConfig.printCopies)} onValueChange={(value) => setWebConfig(prev => ({ ...prev, printCopies: parseInt(value) }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 via</SelectItem>
                <SelectItem value="2">2 vias</SelectItem>
                <SelectItem value="3">3 vias</SelectItem>
                <SelectItem value="4">4 vias</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Corte Automático (ESC/POS)</Label>
              <p className="text-sm text-muted-foreground">Envia comando de corte entre vias (impressoras térmicas compatíveis)</p>
            </div>
            <Switch checked={webConfig.supportsAutoCut} onCheckedChange={(checked) => setWebConfig(prev => ({ ...prev, supportsAutoCut: checked }))} />
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <Label>Imprimir via da cozinha</Label>
              <p className="text-sm text-muted-foreground">
                {webConfig.printKitchenCopy
                  ? 'Ligado: a cada impressão de pedido saem duas vias — a do cliente e a da cozinha (com corte entre elas).'
                  : 'Desligado: sai apenas a via do cliente.'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Vale para a impressão direta via QZ Tray.
              </p>
            </div>
            <Switch
              checked={webConfig.printKitchenCopy}
              onCheckedChange={(checked) => setWebConfig(prev => ({ ...prev, printKitchenCopy: checked }))}
            />
          </div>

          <Button variant="outline" onClick={testWebPrint} disabled={testing === 'web'}>
            <Printer className="h-4 w-4 mr-2" />
            {testing === 'web' ? 'Abrindo...' : 'Testar Impressão'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="text-lg font-bold">A</span>
            Tipografia da Impressão
          </CardTitle>
          <CardDescription>Configure a fonte, tamanho e estilo do texto impresso</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Fonte</Label>
              <Select value={webConfig.fontFamily} onValueChange={(value) => setWebConfig(prev => ({ ...prev, fontFamily: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FONT_OPTIONS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      <span style={{ fontFamily: f.value }}>{f.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tamanho (px)</Label>
              <Select value={String(webConfig.fontSize)} onValueChange={(value) => setWebConfig(prev => ({ ...prev, fontSize: parseInt(value) }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FONT_SIZE_OPTIONS.map((s) => (
                    <SelectItem key={s} value={String(s)}>{s}px</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-1">
              <div className="flex items-center gap-2">
                <Switch checked={webConfig.fontBold} onCheckedChange={(checked) => setWebConfig(prev => ({ ...prev, fontBold: checked }))} />
                <Label>Negrito</Label>
              </div>
            </div>
          </div>

          <div className="rounded-md border p-3 bg-muted/50">
            <p className="text-xs text-muted-foreground mb-2">Pré-visualização:</p>
            <div style={{ fontFamily: webConfig.fontFamily, fontSize: `${webConfig.fontSize}px`, fontWeight: webConfig.fontBold ? 'bold' : 'normal' }}>
              <p>1x X-Burger ............. R$ 25,90</p>
              <p>2x Refrigerante ......... R$ 12,00</p>
              <p style={{ marginTop: 4 }}>TOTAL: R$ 37,90</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div data-tour="printers-qz-tray">
        <QzTraySection />
      </div>

      <div data-tour="printers-qz-trust">
        <QzTrustSetup />
      </div>

      <QzTrayDownloadCard />

      <div className="flex justify-end">
        <Button onClick={saveWebConfig} disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar Configurações'}
        </Button>
      </div>
    </div>
  );
};

export default PrintersSettings;

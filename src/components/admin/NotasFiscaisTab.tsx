import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel";
import { useCargaInicial } from "@/hooks/useCargaInicial";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { CalendarIcon, FileText, Download, FileCode, AlertCircle, CheckCircle2, Clock, XCircle, Loader2, FileArchive, RotateCcw, Ban, Search } from "lucide-react";
import { format, startOfDay, endOfDay } from "date-fns";
import PendingOrdersPanel from "./PendingOrdersPanel";
import FiscalNoteDetailSheet from "./FiscalNoteDetailSheet";
import { ptBR } from "date-fns/locale";
import { toast } from "@/components/ui/sonner";
import type { DateRange } from "react-day-picker";
import JSZip from "jszip";

interface FiscalNote {
  id: string;
  order_id: string;
  status: string;
  nfe_number: string | null;
  nfe_key: string | null;
  nuvem_fiscal_ref: string | null;
  xml_url: string | null;
  pdf_url: string | null;
  error_message: string | null;
  created_at: string;
  url_consulta?: string | null;
  url_qrcode?: string | null;
  orders: {
    id: string;
    customer_name: string;
    customer_cpf: string;
    payment_type: string | null;
    order_type: string | null;
    created_at: string;
    order_items: {
      quantity: number;
      price_at_order: number;
      notes: string | null;
      products: { name: string } | null;
      order_item_extras: { price_at_order: number; product_extras: { name: string } | null }[];
    }[];
  } | null;
}

const NotasFiscaisTab = ({ restaurantId }: { restaurantId: string }) => {
  const [notes, setNotes] = useState<FiscalNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [pendingSearch, setPendingSearch] = useState("");
  const [selectedNote, setSelectedNote] = useState<FiscalNote | null>(null);
  const [cancelModal, setCancelModal] = useState<{ open: boolean; note: FiscalNote | null }>({ open: false, note: null });
  const [cancelJustificativa, setCancelJustificativa] = useState("");
  const [canceling, setCanceling] = useState(false);
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  });
  const [pendingDateRange, setPendingDateRange] = useState<DateRange | undefined>();
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);

  // Export XMLs state
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportDateRange, setExportDateRange] = useState<DateRange | undefined>({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  });
  const [pendingExportDateRange, setPendingExportDateRange] = useState<DateRange | undefined>();
  const [exportDialogKey, setExportDialogKey] = useState(0);
  const [exporting, setExporting] = useState(false);

  // Placeholder apenas na primeira carga e quando período/filtro mudam; os
  // refetches do Realtime/polling atualizam a tabela sem remontá-la.
  const primeiraCarga = useCargaInicial(
    `${restaurantId}|${statusFilter}|${dateRange.from.getTime()}-${dateRange.to.getTime()}`
  );

  const fetchNotes = useCallback(async () => {
    if (primeiraCarga.pendente()) setLoading(true);
    try {
      let query = supabase
        .from("order_fiscal_notes")
        .select(`
          id, order_id, status, nfe_number, nfe_key, nuvem_fiscal_ref, xml_url, pdf_url, error_message, created_at, url_consulta, url_qrcode,
          orders (
            id, customer_name, customer_cpf, payment_type, order_type, created_at,
            order_items (
              quantity, price_at_order, notes,
              products (name),
              order_item_extras (price_at_order, product_extras (name))
            )
          )
        `)
        .eq("restaurant_id", restaurantId)
        .gte("created_at", dateRange.from.toISOString())
        .lte("created_at", dateRange.to.toISOString())
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setNotes((data as any) || []);
    } catch (error) {
      console.error("Erro ao buscar notas fiscais:", error);
      toast.error("Erro ao carregar notas fiscais");
    } finally {
      primeiraCarga.concluir();
      setLoading(false);
    }
  }, [restaurantId, dateRange, statusFilter, primeiraCarga]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // Realtime subscription (centralized hook with debounce + cleanup)
  useRealtimeChannel({
    channelName: `fiscal-notes-rt-${restaurantId}`,
    bindings: [{ table: "order_fiscal_notes", filter: `restaurant_id=eq.${restaurantId}` }],
    onChange: () => fetchNotes(),
    debounceMs: 400,
  });

  const handleRetry = async (note: FiscalNote) => {
    setRetrying(prev => new Set(prev).add(note.id));
    try {
      if (note.nuvem_fiscal_ref) {
        toast.info("Esta nota já foi enviada. Verifique o status no painel fiscal.");
      } else {
        const { data, error } = await supabase.functions.invoke("nuvem-fiscal-emit", {
          body: { order_id: note.order_id, restaurant_id: restaurantId, fiscal_note_id: note.id },
        });
        if (error) {
          toast.error("Erro ao retentar emissão");
        } else if (data?.error) {
          toast.error(`Erro: ${data.error}`);
        } else {
          toast.success("Emissão retentada com sucesso!");
        }
        fetchNotes();
      }
    } catch (err) {
      toast.error("Erro ao retentar emissão");
    } finally {
      setRetrying(prev => { const s = new Set(prev); s.delete(note.id); return s; });
    }
  };

  const handleDownload = async (note: FiscalNote, type: "pdf" | "xml") => {
    if (!note.nuvem_fiscal_ref) {
      toast.error("Referência Nuvem Fiscal não encontrada para esta nota.");
      return;
    }
    const key = `${note.id}-${type}`;
    setDownloading(prev => new Set(prev).add(key));
    try {
      const { data, error } = await supabase.functions.invoke("nuvem-fiscal-download", {
        body: { nuvem_fiscal_ref: note.nuvem_fiscal_ref, type },
      });
      if (error) throw error;

      if (data?.error) {
        toast.error(data.error);
        return;
      }

      if (!data?.data) {
        toast.error("Resposta vazia da função de download.");
        return;
      }

      const binaryString = atob(data.data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const contentType = data.content_type || (type === "pdf" ? "application/pdf" : "application/xml");
      const blob = new Blob([bytes], { type: contentType });
      const url = URL.createObjectURL(blob);

      if (type === "pdf") {
        window.open(url, "_blank");
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = data.filename || `nfce_${note.nfe_number || note.id}.xml`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      console.error("Download error:", err);
      toast.error(`Erro ao baixar ${type.toUpperCase()}`);
    } finally {
      setDownloading(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  const handleCancel = async () => {
    if (!cancelModal.note || cancelJustificativa.trim().length < 15) return;
    setCanceling(true);
    try {
      const { data, error } = await supabase.functions.invoke("nuvem-fiscal-cancel", {
        body: {
          nuvem_fiscal_ref: cancelModal.note.nuvem_fiscal_ref,
          justificativa: cancelJustificativa.trim(),
          fiscal_note_id: cancelModal.note.id,
        },
      });
      if (error) throw error;
      if (data?.error) {
        toast.error(`Erro: ${data.error}`);
      } else {
        toast.success("Nota cancelada com sucesso!");
        setCancelModal({ open: false, note: null });
        setCancelJustificativa("");
        fetchNotes();
      }
    } catch (err) {
      toast.error("Erro ao cancelar nota fiscal");
    } finally {
      setCanceling(false);
    }
  };

  const handleExportXmls = async () => {
    if (!exportDateRange?.from || !exportDateRange?.to) {
      toast.error("Selecione o período para exportar");
      return;
    }

    setExporting(true);
    try {
      const from = startOfDay(exportDateRange.from);
      const to = endOfDay(exportDateRange.to);

      const { data: authorizedNotes, error } = await supabase
        .from("order_fiscal_notes")
        .select("id, nfe_number, nuvem_fiscal_ref, created_at")
        .eq("restaurant_id", restaurantId)
        .eq("status", "authorized")
        .not("nuvem_fiscal_ref", "is", null)
        .gte("created_at", from.toISOString())
        .lte("created_at", to.toISOString())
        .order("created_at", { ascending: true });

      if (error) throw error;

      if (!authorizedNotes || authorizedNotes.length === 0) {
        toast.error("Nenhuma nota autorizada encontrada no período selecionado");
        setExporting(false);
        return;
      }

      toast.info(`Baixando ${authorizedNotes.length} XMLs...`);

      const zip = new JSZip();
      let successCount = 0;

      for (const note of authorizedNotes) {
        try {
          const { data } = await supabase.functions.invoke("nuvem-fiscal-download", {
            body: { nuvem_fiscal_ref: note.nuvem_fiscal_ref, type: "xml" },
          });

          if (data?.data) {
            const binaryString = atob(data.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const filename = data.filename || `nfce_${note.nfe_number || note.id}.xml`;
            zip.file(filename, bytes);
            successCount++;
          }
        } catch (err) {
          console.error(`Erro ao baixar XML da nota ${note.id}:`, err);
        }
      }

      if (successCount === 0) {
        toast.error("Não foi possível baixar nenhum XML");
        setExporting(false);
        return;
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `xmls_${format(from, "dd-MM-yyyy")}_a_${format(to, "dd-MM-yyyy")}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      toast.success(`${successCount} XMLs exportados com sucesso!`);
      setExportDialogOpen(false);
    } catch (err) {
      console.error("Erro ao exportar XMLs:", err);
      toast.error("Erro ao exportar XMLs");
    } finally {
      setExporting(false);
    }
  };

  const calculateOrderTotal = (note: FiscalNote) => {
    if (!note.orders?.order_items) return 0;
    return note.orders.order_items.reduce((total, item) => {
      const extrasTotal = item.order_item_extras?.reduce((s, e) => s + e.price_at_order, 0) || 0;
      return total + (item.price_at_order + extrasTotal) * item.quantity;
    }, 0);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "authorized":
        return <Badge className="bg-green-100 text-green-800 border-green-300"><CheckCircle2 className="w-3 h-3 mr-1" /> Autorizada</Badge>;
      case "processing":
        return <Badge className="bg-blue-100 text-blue-800 border-blue-300"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Processando</Badge>;
      case "pending":
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300"><Clock className="w-3 h-3 mr-1" /> Pendente</Badge>;
      case "error":
        return <Badge className="bg-red-100 text-red-800 border-red-300"><AlertCircle className="w-3 h-3 mr-1" /> Rejeitada</Badge>;
      case "canceled":
        return <Badge className="bg-gray-100 text-gray-800 border-gray-300"><XCircle className="w-3 h-3 mr-1" /> Cancelada</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const stats = useMemo(() => ({
    total: notes.length,
    authorized: notes.filter(n => n.status === "authorized").length,
    pending: notes.filter(n => n.status === "pending" || n.status === "processing").length,
    error: notes.filter(n => n.status === "error").length,
  }), [notes]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-2xl font-bold">Central de Notas Fiscais</h2>
            <p className="text-sm text-muted-foreground">Gerencie todas as NFC-e emitidas pelo sistema</p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{stats.total}</p><p className="text-xs text-muted-foreground">Total de Notas</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-green-600">{stats.authorized}</p><p className="text-xs text-muted-foreground">Autorizadas</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-yellow-600">{stats.pending}</p><p className="text-xs text-muted-foreground">Pendentes</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-red-600">{stats.error}</p><p className="text-xs text-muted-foreground">Com Erro</p></CardContent></Card>
      </div>

      {/* Date filter + status filter + export */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center">
          <Popover
            open={datePopoverOpen}
            onOpenChange={(open) => {
              setDatePopoverOpen(open);
              if (open) setPendingDateRange(undefined);
            }}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(dateRange.from, "dd/MM/yyyy")} - {format(dateRange.to, "dd/MM/yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                selected={pendingDateRange}
                onSelect={(range) => {
                  setPendingDateRange(range);
                  if (range?.from && range?.to) {
                    const isForward = range.from <= range.to;
                    const from = isForward ? range.from : range.to;
                    const to = isForward ? range.to : range.from;
                    setDateRange({ from: startOfDay(from), to: endOfDay(to) });
                    setDatePopoverOpen(false);
                  }
                }}
                locale={ptBR}
                className="pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Filtrar por status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Status</SelectItem>
              <SelectItem value="authorized">Autorizadas</SelectItem>
              <SelectItem value="pending">Pendentes</SelectItem>
              <SelectItem value="processing">Processando</SelectItem>
              <SelectItem value="error">Com Erro</SelectItem>
              <SelectItem value="canceled">Canceladas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setExportDateRange({ from: startOfDay(new Date()), to: endOfDay(new Date()) });
            setPendingExportDateRange(undefined);
            setExportDialogKey(prev => prev + 1);
            setExportDialogOpen(true);
          }}
          className="gap-2"
        >
          <FileArchive className="h-4 w-4" />
          Exportar XMLs
        </Button>
      </div>

      {/* Split layout: left = pending, right = emitted */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4" style={{ height: "calc(100vh - 420px)", minHeight: "400px" }}>
        {/* Left: A Emitir */}
        <Card className="flex flex-col overflow-hidden">
          <div className="p-4 border-b space-y-2">
            <div>
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Clock className="h-4 w-4 text-yellow-600" />
                A Emitir
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">Pedidos aguardando emissão de nota</p>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, CPF ou ID..."
                value={pendingSearch}
                onChange={(e) => setPendingSearch(e.target.value)}
                className="h-8 text-xs pl-8"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3">
              <PendingOrdersPanel
                restaurantId={restaurantId}
                dateRange={dateRange}
                onEmitted={fetchNotes}
                searchTerm={pendingSearch}
              />
            </div>
          </ScrollArea>
        </Card>

        {/* Right: Emitidas */}
        <Card className="flex flex-col overflow-hidden">
          <div className="p-4 border-b">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              Emitidas
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">Notas fiscais já processadas</p>
          </div>
          <ScrollArea className="flex-1">
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-muted-foreground">Carregando notas...</span>
                </div>
              ) : notes.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm font-medium">Nenhuma nota fiscal encontrada</p>
                  <p className="text-xs">As notas emitidas aparecerão aqui</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pedido</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Nº Nota</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-center">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {notes.map((note) => (
                      <TableRow
                        key={note.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedNote(note)}
                      >
                        <TableCell className="font-mono text-sm">#{note.order_id.slice(0, 8)}</TableCell>
                        <TableCell className="text-sm">{format(new Date(note.created_at), "dd/MM/yyyy HH:mm")}</TableCell>
                        <TableCell className="text-sm">{note.orders?.customer_name || "—"}</TableCell>
                        <TableCell className="text-right font-medium">R$ {calculateOrderTotal(note).toFixed(2)}</TableCell>
                        <TableCell className="text-sm">{note.nfe_number || "—"}</TableCell>
                        <TableCell>
                          {getStatusBadge(note.status)}
                          {note.status === "error" && note.error_message && (
                            <p className="text-xs text-red-500 mt-1 max-w-[300px] truncate" title={note.error_message}>
                              {note.error_message}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                            {note.status === "authorized" && note.nuvem_fiscal_ref && (
                              <>
                                <Button
                                  variant="ghost" size="sm"
                                  onClick={() => handleDownload(note, "pdf")}
                                  disabled={downloading.has(`${note.id}-pdf`)}
                                  title="Baixar PDF/DANFE"
                                >
                                  {downloading.has(`${note.id}-pdf`) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 text-red-600" />}
                                </Button>
                                <Button
                                  variant="ghost" size="sm"
                                  onClick={() => handleDownload(note, "xml")}
                                  disabled={downloading.has(`${note.id}-xml`)}
                                  title="Baixar XML"
                                >
                                  {downloading.has(`${note.id}-xml`) ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCode className="h-4 w-4 text-blue-600" />}
                                </Button>
                                <Button
                                  variant="ghost" size="sm"
                                  onClick={() => { setCancelModal({ open: true, note }); setCancelJustificativa(""); }}
                                  title="Cancelar Nota"
                                >
                                  <Ban className="h-4 w-4 text-gray-600" />
                                </Button>
                              </>
                            )}
                            {(note.status === "error" || note.status === "pending") && !note.nuvem_fiscal_ref && (
                              <Button variant="ghost" size="sm" onClick={() => handleRetry(note)} disabled={retrying.has(note.id)} title="Retentar emissão">
                                {retrying.has(note.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4 text-amber-600" />}
                              </Button>
                            )}
                            {note.status === "canceled" && (
                              <span className="text-xs text-muted-foreground">Cancelada</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </ScrollArea>
        </Card>
      </div>

      {/* Cancel Modal */}
      <Dialog open={cancelModal.open} onOpenChange={(o) => { if (!o) setCancelModal({ open: false, note: null }); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar Nota Fiscal</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Informe a justificativa para o cancelamento (mínimo 15 caracteres). A SEFAZ permite cancelamento em até 30 minutos após a emissão.
            </p>
            <Textarea
              placeholder="Motivo do cancelamento..."
              value={cancelJustificativa}
              onChange={(e) => setCancelJustificativa(e.target.value)}
              rows={3}
            />
            {cancelJustificativa.trim().length > 0 && cancelJustificativa.trim().length < 15 && (
              <p className="text-xs text-red-500">Mínimo 15 caracteres ({cancelJustificativa.trim().length}/15)</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelModal({ open: false, note: null })}>Voltar</Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={canceling || cancelJustificativa.trim().length < 15}
            >
              {canceling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirmar Cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export XMLs Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileArchive className="h-5 w-5" />
              Exportar XMLs
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Selecione o período para exportar os XMLs das notas autorizadas em um arquivo ZIP.
            </p>
            <div className="text-sm text-center font-medium text-muted-foreground">
              {exportDateRange?.from && exportDateRange?.to
                ? `${format(exportDateRange.from, "dd/MM/yyyy")} - ${format(exportDateRange.to, "dd/MM/yyyy")}`
                : "Clique para selecionar o período"}
            </div>
            <Calendar
              mode="range"
              selected={pendingExportDateRange}
              onSelect={(range) => {
                setPendingExportDateRange(range);
                if (range?.from && range?.to) {
                  const isForward = range.from <= range.to;
                  const from = isForward ? range.from : range.to;
                  const to = isForward ? range.to : range.from;
                  setExportDateRange({ from: startOfDay(from), to: endOfDay(to) });
                }
              }}
              locale={ptBR}
              className="pointer-events-auto mx-auto"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleExportXmls} disabled={exporting || !exportDateRange?.from || !exportDateRange?.to}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
              {exporting ? "Exportando..." : "Exportar ZIP"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FiscalNoteDetailSheet note={selectedNote} open={!!selectedNote} onClose={() => setSelectedNote(null)} />
    </div>
  );
};

export default NotasFiscaisTab;

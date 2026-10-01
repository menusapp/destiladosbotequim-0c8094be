import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarIcon, Plus, ArrowUpCircle, ArrowDownCircle } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel";
import { useCargaInicial } from "@/hooks/useCargaInicial";
import { startOfDay, endOfDay, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";

interface StockItem {
  id: string;
  name: string;
  unit: string;
}

interface StockMovement {
  id: string;
  stock_item_id: string;
  quantity: number;
  movement_type: string;
  reason: string | null;
  order_id: string | null;
  created_at: string;
  stock_items: StockItem | null;
}

interface StockMovementsTabProps {
  restaurantId: string;
}

export default function StockMovementsTab({ restaurantId }: StockMovementsTabProps) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  });
  const [pendingDateRange, setPendingDateRange] = useState<DateRange | undefined>();
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state for manual movement
  const [formStockItemId, setFormStockItemId] = useState("");
  const [formType, setFormType] = useState<"entrada" | "saida">("entrada");
  const [formQuantity, setFormQuantity] = useState("");
  const [formReason, setFormReason] = useState("");

  useEffect(() => {
    fetchStockItems();
  }, [restaurantId]);

  // Placeholder apenas na primeira carga e quando o período muda; os refetches
  // do Realtime/polling atualizam a tabela sem remontá-la (evita o flick).
  const primeiraCarga = useCargaInicial(
    `${dateRange.from.getTime()}-${dateRange.to.getTime()}`
  );

  const fetchMovements = useCallback(async () => {
    if (primeiraCarga.pendente()) setLoading(true);

    const { data, error } = await supabase
      .from("stock_movements")
      .select(`
        id,
        stock_item_id,
        quantity,
        movement_type,
        reason,
        order_id,
        created_at,
        stock_items!inner(id, name, unit, restaurant_id)
      `)
      .eq("stock_items.restaurant_id", restaurantId)
      .gte("created_at", dateRange.from.toISOString())
      .lte("created_at", dateRange.to.toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Erro ao carregar movimentações:", error);
      toast.error("Erro ao carregar movimentações");
      primeiraCarga.concluir();
      setLoading(false);
      return;
    }

    setMovements(data || []);
    primeiraCarga.concluir();
    setLoading(false);
  }, [restaurantId, dateRange, primeiraCarga]);

  useEffect(() => {
    fetchMovements();
  }, [fetchMovements]);

  // Realtime subscription (centralized)
  useRealtimeChannel({
    channelName: `stock-movements-rt-${restaurantId}`,
    bindings: [{ table: "stock_movements" }],
    onChange: () => fetchMovements(),
    debounceMs: 400,
  });

  const fetchStockItems = async () => {
    const { data, error } = await supabase
      .from("stock_items")
      .select("id, name, unit")
      .eq("restaurant_id", restaurantId)
      .order("name");

    if (error) {
      console.error("Erro ao carregar insumos:", error);
      return;
    }

    setStockItems(data || []);
  };

  const handleSubmitMovement = async () => {
    if (!formStockItemId) {
      toast.error("Selecione um insumo");
      return;
    }
    
    const quantity = parseFloat(formQuantity);
    if (isNaN(quantity) || quantity <= 0) {
      toast.error("Informe uma quantidade válida");
      return;
    }

    setSubmitting(true);

    const { error: movementError } = await supabase
      .from("stock_movements")
      .insert({
        stock_item_id: formStockItemId,
        movement_type: formType,
        quantity: quantity,
        reason: formReason.trim() || "Movimentação manual",
      });

    if (movementError) {
      toast.error("Erro ao registrar movimentação");
      setSubmitting(false);
      return;
    }

    const selectedItem = stockItems.find(s => s.id === formStockItemId);
    if (selectedItem) {
      const { data: currentItem } = await supabase
        .from("stock_items")
        .select("current_quantity")
        .eq("id", formStockItemId)
        .single();

      if (currentItem) {
        const newQuantity = formType === "entrada"
          ? currentItem.current_quantity + quantity
          : currentItem.current_quantity - quantity;

        await supabase
          .from("stock_items")
          .update({ current_quantity: Math.max(0, newQuantity) })
          .eq("id", formStockItemId);
      }
    }

    toast.success("Movimentação registrada com sucesso!");
    setDialogOpen(false);
    resetForm();
    fetchMovements();
    setSubmitting(false);
  };

  const resetForm = () => {
    setFormStockItemId("");
    setFormType("entrada");
    setFormQuantity("");
    setFormReason("");
  };

  const openDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Header with action and filter */}
      <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
        <Button onClick={openDialog} className="bg-primary hover:bg-primary/90">
          <Plus className="h-4 w-4 mr-2" />
          Nova Movimentação
        </Button>

        {/* Date Filter - unified range */}
        <Popover
          open={datePopoverOpen}
          onOpenChange={(open) => {
            setDatePopoverOpen(open);
            if (open) setPendingDateRange(undefined);
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <CalendarIcon className="h-4 w-4" />
              {format(dateRange.from, "dd/MM/yy", { locale: ptBR })} - {format(dateRange.to, "dd/MM/yy", { locale: ptBR })}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
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
      </div>

      {/* Movements Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Histórico de Movimentações</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Carregando...</div>
          ) : movements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Nenhuma movimentação encontrada para o período selecionado
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Insumo</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Quantidade</TableHead>
                    <TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell className="whitespace-nowrap">
                        {format(new Date(movement.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                      </TableCell>
                      <TableCell className="font-medium">
                        {movement.stock_items?.name || "Insumo removido"}
                      </TableCell>
                      <TableCell>
                        {movement.movement_type === "entrada" ? (
                          <Badge variant="outline" className="bg-green-100 text-green-700 border-green-300">
                            <ArrowUpCircle className="h-3 w-3 mr-1" />
                            Entrada
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-red-100 text-red-700 border-red-300">
                            <ArrowDownCircle className="h-3 w-3 mr-1" />
                            Saída
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {movement.quantity} {movement.stock_items?.unit || ""}
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate" title={movement.reason || "-"}>
                        {movement.reason || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog for Manual Movement */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Nova Movimentação Manual</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Insumo *</Label>
              <Select value={formStockItemId} onValueChange={setFormStockItemId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o insumo" />
                </SelectTrigger>
                <SelectContent>
                  {stockItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} ({item.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Tipo *</Label>
              <Select value={formType} onValueChange={(v) => setFormType(v as "entrada" | "saida")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">
                    <span className="flex items-center gap-2">
                      <ArrowUpCircle className="h-4 w-4 text-green-600" />
                      Entrada (adicionar)
                    </span>
                  </SelectItem>
                  <SelectItem value="saida">
                    <span className="flex items-center gap-2">
                      <ArrowDownCircle className="h-4 w-4 text-red-600" />
                      Saída (remover)
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Quantidade *</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Ex: 5.5"
                value={formQuantity}
                onChange={(e) => setFormQuantity(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Motivo (opcional)</Label>
              <Input
                placeholder="Ex: Compra fornecedor, Ajuste de inventário..."
                value={formReason}
                onChange={(e) => setFormReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmitMovement} disabled={submitting}>
              {submitting ? "Registrando..." : "Registrar Movimentação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

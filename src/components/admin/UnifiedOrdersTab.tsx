import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel";
import { useDebounce } from "@/hooks/useDebounce";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CalendarIcon, Search, Truck, ShoppingBag, UtensilsCrossed, Package, Store,
  Printer, AlertTriangle, CreditCard, Banknote, Smartphone, Zap
} from "lucide-react";
import { useOrderStatusAdvance, getNextStatus } from "@/hooks/useOrderStatusAdvance";
import { toast } from "@/components/ui/sonner";
import { formatPaymentForDisplay } from "@/lib/utils";
import { format, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { OrderDetailModal } from "./OrderDetailModal";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { printDocument } from "@/lib/printDispatcher";
import { useCargaInicial } from "@/hooks/useCargaInicial";
import { ReceiptPreviewDialog } from "./ReceiptPreviewDialog";
import { useStaffOrderPermissions } from "@/hooks/useStaffOrderPermissions";
import { OrderCard } from "./orders/OrderCard";
import type { DateRange } from "react-day-picker";
import { normalizeSearch } from "@/lib/searchNormalize";

interface OrderItemExtra {
  price_at_order: number;
  extra_name?: string | null;
  product_extras: { name: string } | null;
}

interface OrderItem {
  id: string;
  quantity: number;
  price_at_order: number;
  notes?: string;
  products: { name: string } | null;
  order_item_extras: OrderItemExtra[];
}

interface Order {
  id: string;
  status: string;
  created_at: string;
  customer_name: string;
  customer_cpf: string;
  delivery_type?: string;
  order_type?: string;
  delivery_address?: string;
  delivery_phone?: string;
  notes?: string;
  payment_type?: string;
  payment_brand?: string;
  table_id?: string;
  tables?: { table_number: number };
  order_items: OrderItem[];
  delivery_fee?: number;
  coupon_discount?: number;
  loyalty_points_used?: number;
  ifood_source?: boolean;
  ifood_order_id?: string;
  ifood_display_id?: string | null;
  ifood_merchant_id?: string | null;
  dd_source?: boolean;
  dd_order_id?: string;
  dd_scheduled_for?: string;
  cancellation_reason?: string;
}

interface UnifiedOrdersTabProps {
  restaurantId: string;
  pendingOrderToOpen: string | null;
  onOrderOpened: () => void;
  showPrepTimer?: boolean;
}

const PAYMENT_LABELS: Record<string, { icon: React.ReactNode; label: string }> = {
  "Dinheiro": { icon: <Banknote className="w-3 h-3" />, label: "Dinheiro" },
  "PIX": { icon: <Smartphone className="w-3 h-3" />, label: "PIX" },
  "Cartão de Crédito": { icon: <CreditCard className="w-3 h-3" />, label: "Crédito" },
  "Cartão de Débito": { icon: <CreditCard className="w-3 h-3" />, label: "Débito" },
  "credit": { icon: <CreditCard className="w-3 h-3" />, label: "Crédito" },
  "debit": { icon: <CreditCard className="w-3 h-3" />, label: "Débito" },
  "cash": { icon: <Banknote className="w-3 h-3" />, label: "Dinheiro" },
  "pix": { icon: <Smartphone className="w-3 h-3" />, label: "PIX" },
  "online": { icon: <Smartphone className="w-3 h-3" />, label: "Pago Online" },
  "Pago pelo iFood": { icon: <Smartphone className="w-3 h-3" />, label: "Pago pelo iFood" },
  "Pago Delivery Direto": { icon: <Smartphone className="w-3 h-3" />, label: "Pago DD" },
  "Cartão": { icon: <CreditCard className="w-3 h-3" />, label: "Cartão" },
  "Vale Refeição": { icon: <CreditCard className="w-3 h-3" />, label: "Vale Refeição" },
};

const UnifiedOrdersTab = ({ restaurantId, pendingOrderToOpen, onOrderOpened, showPrepTimer = true }: UnifiedOrdersTabProps) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("todos");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const { advanceStatus, loadingOrderId } = useOrderStatusAdvance(restaurantId);
  const [autoPrint, setAutoPrint] = useState(false);
  const [autoAccept, setAutoAccept] = useState(false);
  const { canManageOrders } = useStaffOrderPermissions();
  const [dateRange, setDateRange] = useState(() => ({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  }));
  const [pendingDateRange, setPendingDateRange] = useState<DateRange | undefined>();
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [previewOrderId, setPreviewOrderId] = useState<string | null>(null);

  // O placeholder "Carregando pedidos..." só aparece na primeira carga e quando
  // o período muda. Os refetches do Realtime/polling atualizam a lista em
  // silêncio, sem desmontar a tela (era a origem do flick a cada ciclo).
  const primeiraCarga = useCargaInicial(
    `${dateRange.from.getTime()}-${dateRange.to.getTime()}`
  );

  // Initial load + refetch when date range changes
  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, dateRange]);

  // Centralized realtime: coalesces order/order_items bursts into a single refetch
  useRealtimeChannel({
    channelName: `unified-orders-${restaurantId}`,
    bindings: [
      { table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
      { table: "order_items" },
    ],
    onChange: () => fetchOrders(),
    debounceMs: 400,
  });

  useEffect(() => {
    if (pendingOrderToOpen && orders.length > 0) {
      const o = orders.find(o => o.id === pendingOrderToOpen);
      if (o) {
        setSelectedOrder(o);
        onOrderOpened();
      }
    }
  }, [pendingOrderToOpen, orders]);

  useEffect(() => {
    supabase.from('printer_settings').select('auto_print_orders').eq('restaurant_id', restaurantId).maybeSingle()
      .then(({ data }) => { if (data) setAutoPrint(data.auto_print_orders); });
    supabase.from('restaurants').select('auto_accept_orders').eq('id', restaurantId).single()
      .then(({ data }) => { if (data) setAutoAccept(data.auto_accept_orders ?? false); });
  }, [restaurantId]);

  // Auto-accept: when orders change and autoAccept is on, accept all pending orders
  const autoAcceptRef = { current: autoAccept };
  autoAcceptRef.current = autoAccept;

  // Auto-accept guard: avoid re-processing the same order id (prevents repeat advanceStatus calls)
  const autoAcceptedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!autoAccept) return;
    const pendingOrders = orders.filter(o => o.status === "pending" && !autoAcceptedIdsRef.current.has(o.id));
    if (pendingOrders.length === 0) return;
    pendingOrders.forEach(async (order) => {
      autoAcceptedIdsRef.current.add(order.id);
      await advanceStatus(order, "accepted");
    });
  }, [orders, autoAccept, advanceStatus]);

  // Scheduler: promote scheduled orders whose dd_scheduled_for has arrived.
  // Timezone-agnostic: dd_scheduled_for is stored as timestamptz (UTC) and iFood
  // returns ISO 8601 with offset, so a direct Date comparison works regardless of
  // the operator's locale. Display uses America/Sao_Paulo via pt-BR formatting.
  const promotedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const tick = async () => {
      const now = Date.now();
      const ONE_HOUR_MS = 60 * 60 * 1000;
      // Libera o pedido agendado 1 hora antes do horário de entrega/retirada agendado.
      const due = orders.filter(o =>
        o.status === "scheduled" &&
        o.dd_scheduled_for &&
        new Date(o.dd_scheduled_for).getTime() - ONE_HOUR_MS <= now &&
        !promotedIdsRef.current.has(o.id)
      );

      for (const order of due) {
        promotedIdsRef.current.add(order.id);
        console.log(`[scheduler] Promovendo pedido agendado ${order.id.slice(0,8)} (agendado para ${order.dd_scheduled_for})`);
        try {
          if (autoAcceptRef.current) {
            // Auto-accept: confirms on iFood + updates local status to "accepted"
            await advanceStatus({ ...order, status: "pending" } as any, "accepted");
          } else {
            // Manual flow: promote to pending so it triggers sound/popup/operator action
            await supabase.rpc("admin_update_order_status", {
              p_order_id: order.id,
              p_new_status: "pending",
              p_restaurant_id: restaurantId,
            });
          }
        } catch (e) {
          console.error("[scheduler] Falha ao promover pedido agendado:", e);
          promotedIdsRef.current.delete(order.id); // allow retry
        }
      }
      if (due.length > 0) fetchOrders();
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [orders, restaurantId, advanceStatus]);


  // iFood polling every 30 seconds
  useEffect(() => {
    const SUPABASE_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co`;
    let active = true;

    const pollIfood = async () => {
      if (!active) return;
      try {
        let res = await fetch(`${SUPABASE_URL}/functions/v1/ifood-polling`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restaurant_id: restaurantId }),
        });
        if (res.status === 401) {
          await res.text(); // consume body
          // Try refresh then retry polling
          const refreshRes = await fetch(`${SUPABASE_URL}/functions/v1/ifood-refresh-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ restaurant_id: restaurantId }),
          });
          await refreshRes.text();
          if (refreshRes.ok) {
            res = await fetch(`${SUPABASE_URL}/functions/v1/ifood-polling`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ restaurant_id: restaurantId }),
            });
          }
        }
        if (res.ok) {
          const data = await res.json();
          if (data.new_orders > 0) {
            fetchOrders();
            toast.info(`${data.new_orders} novo(s) pedido(s) do iFood!`);
          }
        } else {
          await res.text(); // consume body
        }
      } catch (_) { /* silent fail */ }
    };

    pollIfood(); // Run immediately on mount
    const interval = setInterval(pollIfood, 30000);
    return () => { active = false; clearInterval(interval); };
  }, [restaurantId]);

  // Delivery Direto polling every 30 seconds
  // NOTE: No separate DD toast here — realtime channel already triggers fetchOrders
  // and the standard NewOrderNotification handles the notification pill.
  useEffect(() => {
    const SUPABASE_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co`;
    let active = true;

    const pollDD = async () => {
      if (!active) return;
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/dd-polling`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restaurant_id: restaurantId }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.new_orders > 0) {
            // Just refetch — the standard notification system handles the alert
            fetchOrders();
          }
        } else {
          await res.text(); // consume body
        }
      } catch (_) { /* silent fail */ }
    };

    pollDD();
    const interval = setInterval(pollDD, 30000);
    return () => { active = false; clearInterval(interval); };
  }, [restaurantId]);

  // Stable ref to fetchOrders so polling effects don't recreate intervals on every render
  const fetchOrdersRef = useRef<() => void>(() => {});

  const fetchOrders = async () => {
    if (primeiraCarga.pendente()) setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select(`id, daily_order_number, status, created_at, customer_name, customer_cpf, delivery_type, order_type, delivery_address, delivery_phone, notes, payment_type, payment_brand, delivery_fee, service_fee, coupon_discount, coupon_code, loyalty_points_used, ifood_source, ifood_order_id, ifood_display_id, ifood_merchant_id, dd_source, dd_order_id, dd_scheduled_for, cancellation_reason, table_id, tables(table_number), order_items(id, quantity, price_at_order, notes, products(name), order_item_extras(price_at_order, extra_name, product_extras(name)))`)
      .eq("restaurant_id", restaurantId)
      .in("order_type", ["delivery", "balcao"])
      .gte("created_at", dateRange.from.toISOString())
      .lte("created_at", dateRange.to.toISOString())
      .order("created_at", { ascending: false });
    if (!error) setOrders(data || []);
    primeiraCarga.concluir();
    setLoading(false);
  };
  fetchOrdersRef.current = fetchOrders;

  const calculateTotal = (order: Order) => {
    return (order.order_items || []).reduce((total, item) => {
      const extrasTotal = (item.order_item_extras || []).reduce((s, e) => s + e.price_at_order, 0) * item.quantity;
      return total + item.price_at_order * item.quantity + extrasTotal;
    }, 0);
  };

  const getElapsedMinutes = (createdAt: string) => Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  const getElapsedColor = (m: number) => m < 5 ? "text-green-600 bg-green-50 border-green-200" : m < 15 ? "text-amber-600 bg-amber-50 border-amber-200" : "text-red-600 bg-red-50 border-red-200";

  // Debounce search input — keeps typing snappy on large lists
  const debouncedSearch = useDebounce(searchQuery, 200);

  const filteredOrders = useMemo(() => {
    let filtered = orders;

    if (activeTab === "delivery") {
      filtered = filtered.filter(o => o.order_type === "delivery" && o.delivery_type === "delivery");
    } else if (activeTab === "retirada") {
      filtered = filtered.filter(o => o.order_type === "balcao" || (o.order_type === "delivery" && (o.delivery_type === "pickup" || o.delivery_type === "takeaway")));
    }
    // "todos" shows everything

    if (debouncedSearch) {
      const q = normalizeSearch(debouncedSearch);
      filtered = filtered.filter(o =>
        normalizeSearch(o.customer_name).includes(q) ||
        o.customer_cpf.includes(q) ||
        o.delivery_phone?.includes(q) ||
        o.id.slice(0, 8).includes(q)
      );
    }

    return filtered;
  }, [orders, activeTab, debouncedSearch]);

  const groupedOrders = useMemo(() => {
    return {
      // Scheduled iFood orders share the "Aguardando" column with pending orders.
      // They stay visually distinct (faded + AGENDADO badge) and don't fire
      // sound/popup/auto-accept until the scheduler promotes them to "pending".
      pending: filteredOrders.filter(o => ["pending", "scheduled"].includes(o.status)),
      preparing: filteredOrders.filter(o => ["accepted", "preparing"].includes(o.status)),
      out: filteredOrders.filter(o => ["out_for_delivery", "ready"].includes(o.status)),
      delivered: filteredOrders.filter(o => ["delivered", "picked_up"].includes(o.status)),
      cancelled: filteredOrders.filter(o => o.status === "cancelled"),
    };
  }, [filteredOrders]);

  const getOrderTypeIcon = (order: Order) => {
    if (order.order_type === "balcao") return <Store className="w-3.5 h-3.5" />;
    if (order.order_type === "local") return <UtensilsCrossed className="w-3.5 h-3.5" />;
    if (order.delivery_type === "delivery") return <Truck className="w-3.5 h-3.5" />;
    if (order.delivery_type === "takeaway") return <Package className="w-3.5 h-3.5" />;
    return <ShoppingBag className="w-3.5 h-3.5" />;
  };

  const getOrderTypeLabel = (order: Order) => {
    if (order.order_type === "balcao") return "Balcão";
    if (order.order_type === "local") return `Mesa ${order.tables?.table_number || "?"}`;
    if (order.delivery_type === "delivery") return "Entrega";
    if (order.delivery_type === "takeaway") return "Para Viagem";
    return "Retirada";
  };

  const getPaymentDisplay = (paymentType?: string, paymentBrand?: string) => {
    if (!paymentType || paymentType === "pending") {
      return { label: "Falta pagamento", className: "text-red-600 bg-red-50 dark:bg-red-950/30", icon: <AlertTriangle className="w-3 h-3" /> };
    }
    const formatted = formatPaymentForDisplay(paymentType, paymentBrand);
    let icon: React.ReactNode = <CreditCard className="w-3 h-3" />;
    if (formatted === "Dinheiro") icon = <Banknote className="w-3 h-3" />;
    else if (formatted === "PIX" || formatted.startsWith("Pago")) icon = <Smartphone className="w-3 h-3" />;
    return { label: formatted, className: "text-green-700 bg-green-50 dark:bg-green-950/30", icon };
  };

  const kanbanColumns = [
    { key: "pending", title: "Aguardando", color: "bg-orange-400", count: groupedOrders.pending.length },
    { key: "preparing", title: "Preparando", color: "bg-orange-500", count: groupedOrders.preparing.length },
    { key: "out", title: "Saiu / Pronto", color: "bg-orange-600", count: groupedOrders.out.length },
    { key: "delivered", title: "Entregue / Retirado", color: "bg-orange-700", count: groupedOrders.delivered.length },
    { key: "cancelled", title: "Cancelado", color: "bg-orange-300", count: groupedOrders.cancelled.length },
  ];

  const handleQuickAdvance = async (e: React.MouseEvent, order: Order) => {
    e.stopPropagation();
    const next = getNextStatus(order as any);
    console.log(`[IFOOD_DEBUG] button_clicked source=kanban_quick_advance order_id=${order.id} current_status=${order.status} next_status=${next?.status ?? "null"} ifood_source=${!!(order as any).ifood_source} ifood_order_id=${(order as any).ifood_order_id ?? "null"} order_type=${(order as any).order_type ?? "null"} delivery_type=${(order as any).delivery_type ?? "null"} payment_type=${(order as any).payment_type ?? "null"}`);
    if (!next) {
      console.warn(`[IFOOD_DEBUG] button_aborted order_id=${order.id} reason=no_next_status current_status=${order.status}`);
      return;
    }
    const success = await advanceStatus(order as any, next.status);
    console.log(`[IFOOD_DEBUG] button_result source=kanban_quick_advance order_id=${order.id} success=${success}`);
    if (success) fetchOrders();
  };


  const handleQuickPrint = async (e: React.MouseEvent, order: Order) => {
    e.stopPropagation();
    // Respeita o método configurado em Configurações Gerais → Impressoras.
    await printDocument(order as any, restaurantId);
  };

  const handleQuickCancel = (e: React.MouseEvent, order: Order) => {
    e.stopPropagation();
    setSelectedOrder(order);
  };

  const handleSelectOrder = (order: Order) => setSelectedOrder(order);
  const handlePreviewOrder = (orderId: string) => setPreviewOrderId(orderId);

  const renderOrderCard = (order: Order) => {
    const total = calculateTotal(order);
    const grandTotal = total + (order.delivery_fee ?? 0) + ((order as any).service_fee ?? 0) - (order.coupon_discount ?? 0) - (order.loyalty_points_used ?? 0);
    const elapsed = getElapsedMinutes(order.created_at);
    const payment = getPaymentDisplay(order.payment_type, order.payment_brand);
    const next = getNextStatus(order);
    const isAdvancing = loadingOrderId === order.id;

    return (
      <OrderCard
        key={order.id}
        order={order as any}
        showPrepTimer={showPrepTimer}
        canManageOrders={canManageOrders}
        isAdvancing={isAdvancing}
        next={next}
        payment={payment}
        typeIcon={getOrderTypeIcon(order)}
        typeLabel={getOrderTypeLabel(order)}
        grandTotal={grandTotal}
        elapsed={elapsed}
        elapsedClass={getElapsedColor(elapsed)}
        onSelect={handleSelectOrder as any}
        onAdvance={handleQuickAdvance as any}
        onPrint={handleQuickPrint as any}
        onPreview={handlePreviewOrder}
        onCancel={handleQuickCancel as any}
      />
    );
  };

  const renderKanban = () => (
    <div className="flex gap-3 pb-4 w-full">
      {kanbanColumns.map(({ key, title, color, count }) => {
        const colOrders = groupedOrders[key as keyof typeof groupedOrders] || [];
        return (
          <div key={key} className="flex-1 min-w-0 flex flex-col">
            <div className={`${color} text-white px-3 py-2 rounded-t-lg flex items-center justify-between`}>
              <span className="font-semibold text-sm">{title}</span>
              <Badge variant="secondary" className="bg-white/20 text-white border-0 text-xs">{count}</Badge>
            </div>
            <div className="bg-muted/30 border border-t-0 border-border/50 rounded-b-lg p-2 space-y-2 min-h-[200px] max-h-[60vh] overflow-y-auto flex-1">
              {colOrders.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">Nenhum pedido</p>
              ) : (
                colOrders.map(renderOrderCard)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  if (loading) {
    return <div className="flex items-center justify-center h-96 text-muted-foreground">Carregando pedidos...</div>;
  }

  const totalPendingCount = orders.filter(o => o.status === "pending").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Pedidos</h2>
          <p className="text-sm text-muted-foreground">{totalPendingCount} aguardando • {orders.length} no total</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2" data-tour="pedidos-auto-accept">
            <Zap className="w-4 h-4 text-muted-foreground" />
            <Label htmlFor="auto-accept" className="text-xs">Aceitar automaticamente</Label>
            <Switch id="auto-accept" checked={autoAccept} onCheckedChange={async (v) => {
              setAutoAccept(v);
              await supabase.from('restaurants').update({ auto_accept_orders: v }).eq('id', restaurantId);
              toast.success(v ? "Pedidos serão aceitos automaticamente" : "Aceite automático desativado");
            }} />
          </div>
          <div className="flex items-center gap-2" data-tour="pedidos-auto-print">
            <Printer className="w-4 h-4 text-muted-foreground" />
            <Label htmlFor="auto-print" className="text-xs">Impressão automática</Label>
            <Switch id="auto-print" checked={autoPrint} onCheckedChange={async (v) => {
              setAutoPrint(v);
              await supabase.from('printer_settings').upsert({ restaurant_id: restaurantId, auto_print_orders: v }, { onConflict: 'restaurant_id' });
            }} />
          </div>
          <Popover
            open={datePopoverOpen}
            onOpenChange={(open) => {
              setDatePopoverOpen(open);
              if (open) setPendingDateRange(undefined);
            }}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" data-tour="pedidos-date">
                <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                {format(dateRange.from, "dd/MM")} - {format(dateRange.to, "dd/MM")}
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
      </div>

      {/* Search */}
      <div className="relative max-w-md" data-tour="pedidos-search">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, telefone, CPF ou código..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-tour="pedidos-tabs">
          <TabsTrigger value="todos">Todos</TabsTrigger>
          <TabsTrigger value="delivery">Delivery</TabsTrigger>
          <TabsTrigger value="retirada">Retirada</TabsTrigger>
        </TabsList>

        <TabsContent value="todos">{renderKanban()}</TabsContent>
        <TabsContent value="delivery">{renderKanban()}</TabsContent>
        <TabsContent value="retirada">{renderKanban()}</TabsContent>
      </Tabs>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          restaurantId={restaurantId}
          onClose={() => setSelectedOrder(null)}
          onStatusUpdate={fetchOrders}
        />
      )}

      {/* Preview do cupom térmico (sem impressora) */}
      <ReceiptPreviewDialog
        orderId={previewOrderId}
        open={!!previewOrderId}
        onOpenChange={(o) => { if (!o) setPreviewOrderId(null); }}
      />
    </div>
  );
};

export default UnifiedOrdersTab;

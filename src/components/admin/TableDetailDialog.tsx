import { useState, useMemo, useEffect } from "react";
import { formatPaymentMethod, formatPaymentWithBrand } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Users, ShoppingBag, Clock, Eraser, Plus, Minus, CreditCard, User, Receipt, Truck, Scissors, ChevronDown, CheckCircle2, Printer, Pencil, Trash2 } from "lucide-react";
import { broadcastOrderModified } from "@/lib/broadcastOrderModified";
import { useIsMobile } from "@/hooks/use-mobile";
import { CustomerSelectDialog } from "./CustomerSelectDialog";
import { AddItemsToOrderDrawer } from "./AddItemsToOrderDrawer";
import { toast } from "@/components/ui/sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PaymentConfirmationModal } from "./PaymentConfirmationModal";
import { SplitPaymentDialog } from "./SplitPaymentDialog";
import { SplitPaymentSelect } from "./SplitPaymentSelect";
import { printDocument } from "@/lib/printDispatcher";
import { useStaffOrderPermissions } from "@/hooks/useStaffOrderPermissions";
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel";

interface TableDetailDialogProps {
  restaurantId: string;
  table: {
    id: string;
    table_number: number;
    table_name: string | null;
    is_occupied: boolean;
    occupied_at: string | null;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddOrder: (tableId: string) => void;
  onTableCleared: () => void;
}

interface Split {
  id: string;
  order_item_id: string;
  order_id: string;
  split_number: number;
  total_splits: number;
  value: number;
  status: string;
  paid_at: string | null;
  payment_type: string | null;
}

export const TableDetailDialog = ({
  restaurantId,
  table,
  open,
  onOpenChange,
  onAddOrder,
  onTableCleared,
}: TableDetailDialogProps) => {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [payingComanda, setPayingComanda] = useState<any>(null);
  const [splittingItem, setSplittingItem] = useState<any>(null);
  const [splittingOrderId, setSplittingOrderId] = useState<string>("");
  const [payingSplit, setPayingSplit] = useState<Split | null>(null);
  const [editingComandaId, setEditingComandaId] = useState<string | null>(null);
  const [addItemsOrderId, setAddItemsOrderId] = useState<string | null>(null);
  const [cancellingItem, setCancellingItem] = useState<{ id: string; name: string; total: number } | null>(null);
  const [addingQtyItem, setAddingQtyItem] = useState<{ id: string; name: string; unitPrice: number; currentQty: number } | null>(null);
  const [extraQty, setExtraQty] = useState(1);
  const [savingQty, setSavingQty] = useState(false);
  const { canManageOrders } = useStaffOrderPermissions();

  // Fetch active comandas for the table
  const { data: comandas, refetch: refetchComandas } = useQuery({
    queryKey: ["table-detail-comandas", table?.id],
    queryFn: async () => {
      if (!table) return [];
      const { data, error } = await supabase
        .from("comandas")
        .select("id, customer_name, customer_cpf, created_at, status")
        .eq("table_id", table.id)
        .eq("status", "active")
        .order("created_at");
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!table,
    staleTime: 0,
  });

  // Fetch orders for this table grouped by comanda
  const { data: orders, refetch: refetchOrders } = useQuery({
    queryKey: ["table-detail-orders", table?.id],
    queryFn: async () => {
      if (!table) return [];
      const { data, error } = await supabase
        .from("orders")
        .select(`
          id, status, payment_status, payment_type, payment_brand, paid_at, customer_name, customer_cpf, comanda_id, created_at, coupon_discount, notes,
          order_items(
            id, quantity, price_at_order, notes,
            products(name),
            order_item_extras(price_at_order, extra_name, product_extra_id, product_extras(name))
          )
        `)
        .eq("table_id", table.id)
        .eq("order_type", "local")
        .in("status", ["pending", "accepted", "preparing", "ready"])
        .order("created_at");
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!table,
    staleTime: 0,
  });

  // Fetch splits for all orders in this table
  const { data: allSplits, refetch: refetchSplits } = useQuery({
    queryKey: ["table-detail-splits", table?.id],
    queryFn: async () => {
      if (!table || !orders || orders.length === 0) return [];
      const orderIds = orders.map(o => o.id);
      const { data, error } = await supabase
        .from("order_item_splits" as any)
        .select("*")
        .in("order_id", orderIds);
      if (error) throw error;
      return (data || []) as unknown as Split[];
    },
    enabled: open && !!table && !!orders && orders.length > 0,
  });

  // Build a map: order_item_id -> Split[]
  const splitsByItem = useMemo(() => {
    const map = new Map<string, Split[]>();
    allSplits?.forEach(s => {
      if (!map.has(s.order_item_id)) map.set(s.order_item_id, []);
      map.get(s.order_item_id)!.push(s);
    });
    // Sort each array by split_number
    map.forEach((arr) => arr.sort((a, b) => a.split_number - b.split_number));
    return map;
  }, [allSplits]);

  // Force refetch when dialog opens to avoid stale cached data
  useEffect(() => {
    if (open && table) {
      refetchComandas();
      refetchOrders();
    }
  }, [open, table?.id]);

  // Realtime da mesa consolidado no hook central (canal único + cleanup
  // garantido + polling de fallback de 6s pausado com a aba em background).
  useRealtimeChannel({
    channelName: `table-detail-${table?.id ?? "none"}`,
    enabled: !!open && !!table?.id,
    debounceMs: 200,
    pollMs: 6000,
    bindings: [
      { table: "orders", filter: `table_id=eq.${table?.id}` },
      { table: "bills", filter: `table_id=eq.${table?.id}` },
      { table: "comandas", filter: `table_id=eq.${table?.id}` },
      { table: "order_item_splits", filter: `restaurant_id=eq.${restaurantId}` },
    ],
    onChange: () => {
      refetchOrders();
      refetchComandas();
      refetchBills();
      refetchSplits();
    },
  });

  // Fetch requested/on_the_way bills for this table
  const { data: requestedBills, refetch: refetchBills } = useQuery({
    queryKey: ["table-detail-bills", table?.id],
    queryFn: async () => {
      if (!table) return [];
      const { data, error } = await supabase
        .from("bills")
        .select("id, comanda_id, status, total_amount, payment_method")
        .eq("table_id", table.id)
        .in("status", ["requested", "on_the_way"])
        .order("created_at");
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!table,
  });

  const getOrderTotal = (order: any) => {
    const itemsTotal = order.order_items?.reduce((sum: number, item: any) => {
      const extrasTotal = item.order_item_extras?.reduce((s: number, e: any) => s + e.price_at_order, 0) || 0;
      return sum + (item.price_at_order + extrasTotal) * item.quantity;
    }, 0) || 0;
    return itemsTotal - (order.coupon_discount || 0);
  };

  const getItemTotal = (item: any) => {
    const extrasTotal = item.order_item_extras?.reduce((s: number, e: any) => s + e.price_at_order, 0) || 0;
    return (item.price_at_order + extrasTotal) * item.quantity;
  };

  // Agrupa itens iguais (mesmo produto, extras, observação e preço) para exibir
  // como uma única linha somando a quantidade. Itens com splits ficam isolados.
  const groupItems = (items: any[]): any[] => {
    if (!items || items.length === 0) return [];
    const groups: any[] = [];
    const indexByKey = new Map<string, number>();
    items.forEach((item: any) => {
      const hasSplits = (splitsByItem.get(item.id)?.length || 0) > 0;
      const extrasKey = (item.order_item_extras || [])
        .map((e: any) => `${e.product_extras?.name || e.extra_name || ""}:${e.price_at_order}`)
        .sort()
        .join("|");
      const key = hasSplits
        ? `solo:${item.id}`
        : `${item.products?.name || ""}|${item.price_at_order}|${item.notes || ""}|${extrasKey}`;
      const existingIdx = indexByKey.get(key);
      if (existingIdx === undefined || hasSplits) {
        indexByKey.set(key, groups.length);
        groups.push({ ...item, _ids: [item.id], _aggregatedQty: item.quantity });
      } else {
        const g = groups[existingIdx];
        g._ids.push(item.id);
        g._aggregatedQty += item.quantity;
      }
    });
    return groups.map((g) => ({
      ...g,
      quantity: g._aggregatedQty,
    }));
  };

  const ordersByComanda = useMemo(() => {
    if (!orders || !comandas) return new Map<string, any[]>();
    const map = new Map<string, any[]>();
    comandas.forEach(c => map.set(c.id, []));
    orders.forEach(order => {
      const key = order.comanda_id || "sem-comanda";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(order);
    });
    return map;
  }, [orders, comandas]);

  const tableTotal = useMemo(() => {
    return orders?.filter((order: any) => order.payment_status !== "paid").reduce((sum, order) => sum + getOrderTotal(order), 0) || 0;
  }, [orders]);

  // Calculate paid total from splits
  const totalPaidViaSplits = useMemo(() => {
    return allSplits?.filter(s => s.status === "paid").reduce((sum, s) => sum + s.value, 0) || 0;
  }, [allSplits]);

  // Bill by comanda_id lookup
  const billByComanda = useMemo(() => {
    const map = new Map<string, any>();
    requestedBills?.forEach(bill => {
      if (bill.comanda_id) map.set(bill.comanda_id, bill);
    });
    return map;
  }, [requestedBills]);

  const getStatusBadge = (status: string) => {
    const config: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
      pending: { label: "Aguardando", variant: "destructive" },
      accepted: { label: "Aceito", variant: "default" },
      preparing: { label: "Preparando", variant: "default" },
      ready: { label: "Pronto", variant: "secondary" },
    };
    const c = config[status] || { label: status, variant: "outline" as const };
    return <Badge variant={c.variant} className="text-[10px]">{c.label}</Badge>;
  };

  const handleAcceptOrder = async (orderId: string) => {
    const acceptedOrder = orders?.find(o => o.id === orderId);
    await supabase.from("orders").update({ status: "accepted" }).eq("id", orderId);

    if (table?.id) {
      await supabase.from("tables").update({
        is_occupied: true,
        occupied_at: new Date().toISOString(),
        occupied_by: acceptedOrder?.customer_name || "Cliente",
      }).eq("id", table.id);
    }

    toast.success("Pedido aceito!");
    refetchOrders();
    onTableCleared();
  };

  // Abre o drawer de adicionar itens. Usa o pedido ativo mais recente da comanda;
  // se não houver, cria um novo pedido vazio (status 'accepted') para a comanda.
  const openAddItemsForComanda = async (comanda: any) => {
    if (!table) return;
    try {
      const comandaOrders = (orders || []).filter((o: any) => o.comanda_id === comanda.id);
      const activeOrder = comandaOrders.find((o: any) =>
        ["pending", "accepted", "preparing", "ready"].includes(o.status)
      );

      if (activeOrder) {
        setAddItemsOrderId(activeOrder.id);
        return;
      }

      const { data: newOrder, error: createError } = await supabase
        .from("orders")
        .insert({
          restaurant_id: restaurantId,
          table_id: table.id,
          comanda_id: comanda.id,
          customer_name: comanda.customer_name,
          customer_cpf: comanda.customer_cpf,
          status: "accepted",
          order_type: "local",
          pdv_source: true,
        })
        .select("id")
        .single();

      if (createError) throw createError;
      setAddItemsOrderId(newOrder.id);
    } catch (err: any) {
      console.error("Erro ao abrir adicionar itens:", err);
      toast.error(err.message || "Erro ao abrir adicionar itens");
    }
  };

  // Cancela um item individual da comanda. Restaura estoque via RPC e
  // libera a mesa caso não restem mais pedidos/itens ativos.
  const confirmCancelItem = async () => {
    if (!cancellingItem || !table) return;
    try {
      const { error } = await supabase.rpc("admin_cancel_order_item", {
        p_order_item_id: cancellingItem.id,
        p_restaurant_id: restaurantId,
      });
      if (error) throw error;

      toast.success("Item removido da comanda");

      // Verifica se restam itens ativos na mesa. Se não restar nada, libera a mesa.
      const { data: remainingOrders } = await supabase
        .from("orders")
        .select("id, order_items(id)")
        .eq("table_id", table.id)
        .in("status", ["pending", "accepted", "preparing", "ready"]);

      const hasAnyItems = (remainingOrders || []).some((o: any) => (o.order_items || []).length > 0);

      const { data: pendingBills } = await supabase
        .from("bills")
        .select("id")
        .eq("table_id", table.id)
        .neq("status", "paid")
        .limit(1);

      if (!hasAnyItems && (!pendingBills || pendingBills.length === 0)) {
        // Cancela orders vazios e libera a mesa
        if (remainingOrders && remainingOrders.length > 0) {
          await supabase
            .from("orders")
            .update({ status: "cancelled", cancellation_reason: "Sem itens" })
            .in("id", remainingOrders.map((o: any) => o.id));
        }
        await supabase.from("tables").update({
          is_occupied: false,
          occupied_at: null,
          occupied_by: null,
        }).eq("id", table.id);
        await supabase.from("comandas").update({ status: "closed", closed_at: new Date().toISOString() })
          .eq("table_id", table.id).eq("status", "active");
        onTableCleared();
      }

      setCancellingItem(null);
      refetchOrders();
      refetchComandas();
    } catch (err: any) {
      console.error("Erro ao cancelar item:", err);
      toast.error(err.message || "Erro ao cancelar item");
    }
  };

  const confirmAddQty = async () => {
    if (!addingQtyItem || extraQty < 1) return;
    setSavingQty(true);
    try {
      const newQty = addingQtyItem.currentQty + extraQty;
      const { error } = await supabase
        .from("order_items")
        .update({ quantity: newQty })
        .eq("id", addingQtyItem.id);
      if (error) throw error;
      toast.success(`+${extraQty} ${addingQtyItem.name} adicionado(s)`);
      // Find the order id for broadcast
      const order = (orders || []).find((o: any) =>
        (o.order_items || []).some((it: any) => it.id === addingQtyItem.id)
      );
      if (order) broadcastOrderModified({ restaurantId, orderId: order.id, action: "item_added" });
      setAddingQtyItem(null);
      setExtraQty(1);
      refetchOrders();
      refetchComandas();
    } catch (err: any) {
      console.error("Erro ao aumentar quantidade:", err);
      toast.error(err.message || "Erro ao aumentar quantidade");
    } finally {
      setSavingQty(false);
    }
  };

  const handleClearTable = async () => {
    if (!table) return;
    await supabase.from("orders").update({ status: "cancelled" })
      .eq("table_id", table.id).in("status", ["pending", "accepted", "preparing", "ready"]);
    await supabase.from("bills").update({ status: "cancelled" })
      .eq("table_id", table.id).neq("status", "paid");

    const { data: activeComandas } = await supabase.from("comandas")
      .select("id").eq("table_id", table.id).eq("status", "active");
    if (activeComandas && activeComandas.length > 0) {
      for (const comanda of activeComandas) {
        await supabase.from("bills").insert({
          table_id: table.id,
          comanda_id: comanda.id,
          status: "paid",
          paid_at: new Date().toISOString(),
          subtotal: 0,
          service_fee: 0,
          total_amount: 0,
        });
      }
    }

    await supabase.from("comandas").update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("table_id", table.id).eq("status", "active");
    await supabase.from("tables").update({ is_occupied: false, occupied_by: null, occupied_at: null }).eq("id", table.id);
    toast.success(`Mesa ${table.table_number} liberada`);
    onTableCleared();
    onOpenChange(false);
  };

  const handleMarkBillOnTheWay = async (billId: string) => {
    await supabase.from("bills").update({ status: "on_the_way" }).eq("id", billId);
    toast.success("Conta marcada como 'a caminho'!");
    refetchBills();
  };

  const handlePayComanda = async (comanda: any) => {
    const comandaOrders = ordersByComanda.get(comanda.id) || [];
    if (comandaOrders.length === 0) {
      toast.error("Nenhum pedido ativo nesta comanda");
      return;
    }
    const allItems = comandaOrders.flatMap((o: any) => o.order_items || []);
    const orderIds = comandaOrders.map((o: any) => o.id);

    // Calculate total already paid via splits
    let splitsPaidTotal = 0;
    if (allSplits && allSplits.length > 0) {
      splitsPaidTotal = allSplits
        .filter((s: Split) => s.status === "paid" && orderIds.includes(s.order_id))
        .reduce((sum: number, s: Split) => sum + Number(s.value), 0);
    }

    const totalDiscount = comandaOrders.reduce((sum: number, o: any) => sum + (o.coupon_discount || 0), 0);
    const virtualOrder = {
      id: comandaOrders[0].id,
      table_id: table?.id,
      order_type: "local",
      restaurant_id: restaurantId,
      customer_name: comanda.customer_name,
      order_items: allItems,
      coupon_discount: totalDiscount > 0 ? totalDiscount : undefined,
      _comanda_id: comanda.id,
      _comanda_order_ids: orderIds,
      _splits_paid_total: splitsPaidTotal,
    };
    setPayingComanda(virtualOrder);
  };

  const handlePaymentConfirmed = async () => {
    if (!payingComanda) return;

    const orderIds = payingComanda._comanda_order_ids || [payingComanda.id];
    
    // Fetch all orders in parallel to check status
    const orderDataResults = await Promise.all(
      orderIds.map((oid: string) =>
        supabase.from("orders").select("id, status, order_items(id)").eq("id", oid).single()
      )
    );

    // Mark all orders as delivered - stock deduction handled by DB trigger
    await Promise.all(
      orderDataResults.map(async ({ data: orderData }) => {
        if (!orderData) return;
        await supabase.from("orders").update({ status: "delivered" }).eq("id", orderData.id);
      })
    );

    const comandaId = payingComanda._comanda_id;
    const now = new Date().toISOString();

    // Step 1: Close comanda + update bills in parallel (safe, different tables)
    await Promise.all([
      comandaId
        ? supabase.from("comandas").update({ status: "closed", closed_at: now }).eq("id", comandaId)
        : Promise.resolve(),
      comandaId
        ? supabase.from("bills").update({ status: "paid", paid_at: now })
            .eq("comanda_id", comandaId).in("status", ["requested", "on_the_way"])
        : Promise.resolve(),
    ]);

    // Step 2: AFTER closing, check remaining active comandas
    const remainingRes = await supabase
      .from("comandas").select("id").eq("table_id", table!.id).eq("status", "active");
    const remainingCmdas = remainingRes.data || [];
    if (remainingCmdas.length === 0) {
      await supabase.from("tables").update({ is_occupied: false, occupied_by: null, occupied_at: null }).eq("id", table!.id);
    } else {
      await supabase.from("tables").update({ occupied_by: `${remainingCmdas.length} cliente${remainingCmdas.length !== 1 ? "s" : ""}` }).eq("id", table!.id);
    }

    setPayingComanda(null);
    refetchComandas();
    refetchOrders();
    refetchBills();
    onTableCleared();
    toast.success("Pagamento registrado!");
  };

  const handleSwapCustomer = async (comandaId: string, newCustomer: { cpf: string; name: string; phone: string | null }) => {
    const { error: e1 } = await supabase
      .from("comandas")
      .update({ customer_name: newCustomer.name, customer_cpf: newCustomer.cpf })
      .eq("id", comandaId);

    const { error: e2 } = await supabase
      .from("orders")
      .update({ customer_name: newCustomer.name, customer_cpf: newCustomer.cpf })
      .eq("comanda_id", comandaId);

    if (e1 || e2) {
      toast.error("Erro ao trocar cliente");
      return;
    }

    toast.success(`Cliente alterado para ${newCustomer.name}`);
    setEditingComandaId(null);
    refetchComandas();
    refetchOrders();
  };

  const handleSplitItem = (item: any, orderId: string) => {
    setSplittingItem(item);
    setSplittingOrderId(orderId);
  };

  const handleSplitCreated = () => {
    setSplittingItem(null);
    refetchSplits();
  };

  const handleSplitPaid = async () => {
    setPayingSplit(null);
    await refetchSplits();

    // After refetch, check if all splits for ANY comanda are fully paid → auto-close
    // We need fresh data, so query directly
    if (!table || !orders || orders.length === 0) return;

    const orderIds = orders.map(o => o.id);
    const { data: freshSplits } = await supabase
      .from("order_item_splits" as any)
      .select("*")
      .in("order_id", orderIds);

    if (!freshSplits || freshSplits.length === 0) return;

    const splitsTyped = freshSplits as unknown as Split[];

    // Check each comanda
    for (const comanda of (comandas || [])) {
      const comandaOrders = ordersByComanda.get(comanda.id) || [];
      if (comandaOrders.length === 0) continue;

      const comandaOrderIds = new Set(comandaOrders.map(o => o.id));
      const comandaSplits = splitsTyped.filter(s => comandaOrderIds.has(s.order_id));
      if (comandaSplits.length === 0) continue;

      // Check: all items in the comanda must have splits, and all splits must be paid
      const allItems = comandaOrders.flatMap((o: any) => o.order_items || []);
      const allItemsHaveSplits = allItems.every((item: any) => {
        const itemSplits = comandaSplits.filter(s => s.order_item_id === item.id);
        return itemSplits.length > 0 && itemSplits.every(s => s.status === "paid");
      });

      if (!allItemsHaveSplits) continue;

      // All splits paid for this comanda — auto-close using existing flow
      const orderIdsToClose = comandaOrders.map((o: any) => o.id);

      // Mark all orders as delivered - stock deduction handled by DB trigger
      for (const oid of orderIdsToClose) {
        await supabase.from("orders").update({ status: "delivered" }).eq("id", oid);
      }

      // Close comanda
      await supabase.from("comandas").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", comanda.id);
      await supabase.from("bills").update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("comanda_id", comanda.id).in("status", ["requested", "on_the_way"]);

      // Create a bill record for the split payment
      const comandaTotal = comandaOrders.reduce((sum: number, o: any) => sum + getOrderTotal(o), 0);
      await supabase.from("bills").insert({
        table_id: table.id,
        comanda_id: comanda.id,
        status: "paid",
        paid_at: new Date().toISOString(),
        subtotal: comandaTotal,
        service_fee: 0,
        total_amount: comandaTotal,
        payment_method: null,
      });

      toast.success("Conta paga e mesa liberada!");
    }

    // Check if any active comandas remain
    const { data: remaining } = await supabase
      .from("comandas").select("id").eq("table_id", table.id).eq("status", "active");

    if (!remaining || remaining.length === 0) {
      await supabase.from("tables").update({ is_occupied: false, occupied_by: null, occupied_at: null }).eq("id", table.id);
      onTableCleared();
    } else {
      await supabase.from("tables").update({ occupied_by: `${remaining.length} cliente${remaining.length !== 1 ? "s" : ""}` }).eq("id", table.id);
    }

    refetchComandas();
    refetchOrders();
    refetchBills();
  };

  const printSingleOrder = async (order: any) => {
    try {
      const thermalOrder = {
        id: order.id,
        created_at: order.created_at,
        customer_name: order.customer_name,
        order_type: "local" as const,
        tables: { table_number: table!.table_number },
        coupon_discount: order.coupon_discount || undefined,
        notes: order.notes || undefined,
        order_items: (order.order_items || []).map((item: any) => ({
          id: item.id,
          quantity: item.quantity,
          price_at_order: item.price_at_order,
          notes: item.notes,
          products: item.products,
          order_item_extras: (item.order_item_extras || []).map((e: any) => ({
            price_at_order: e.price_at_order,
            extra_name: e.extra_name,
            product_extras: e.product_extras,
          })),
        })),
      };
      await printDocument(thermalOrder as any, restaurantId);
    } catch {
      toast.error("Erro ao imprimir pedido");
    }
  };

  const printFullComanda = async (comanda: any) => {
    try {
      const comandaOrders = ordersByComanda.get(comanda.id) || [];
      if (comandaOrders.length === 0) {
        toast.error("Nenhum pedido para imprimir");
        return;
      }
      // Consolidate all items from all orders into one virtual order
      const allItems = comandaOrders.flatMap((o: any) =>
        (o.order_items || []).map((item: any) => ({
          id: item.id,
          quantity: item.quantity,
          price_at_order: item.price_at_order,
          notes: item.notes,
          products: item.products,
          order_item_extras: (item.order_item_extras || []).map((e: any) => ({
            price_at_order: e.price_at_order,
            extra_name: e.extra_name,
            product_extras: e.product_extras,
          })),
        }))
      );
      const totalDiscount = comandaOrders.reduce((sum: number, o: any) => sum + (o.coupon_discount || 0), 0);
      const virtualOrder = {
        id: comandaOrders[0].id,
        created_at: comandaOrders[0].created_at,
        customer_name: comanda.customer_name,
        order_type: "local" as const,
        tables: { table_number: table!.table_number },
        order_items: allItems,
        coupon_discount: totalDiscount > 0 ? totalDiscount : undefined,
      };
      await printDocument(virtualOrder as any, restaurantId);
    } catch {
      toast.error("Erro ao imprimir comanda");
    }
  };

  const occupiedTime = table?.occupied_at
    ? Math.floor((Date.now() - new Date(table.occupied_at).getTime()) / 60000)
    : 0;

  // Render item with splits
  const renderItem = (item: any, orderId: string) => {
    const splits = splitsByItem.get(item.id);
    const hasSplits = splits && splits.length > 0;
    const allSplitsPaid = hasSplits && splits.every(s => s.status === "paid");
    const itemTotal = getItemTotal(item);

    return (
      <div key={item.id} className={allSplitsPaid ? "opacity-60" : ""}>
        <div className="flex justify-between text-xs items-start gap-2">
          <span className="flex-1 flex items-center gap-1.5 flex-wrap">
            <span>{item.quantity}x {item.products?.name || "Produto"}</span>
            {!hasSplits && !allSplitsPaid && (
              <span className="inline-flex items-center gap-1 ml-1 shrink-0 align-middle">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 w-6 p-0 shrink-0 border-destructive/60 bg-background"
                  title="Remover uma unidade"
                  onClick={async () => {
                    if (item.quantity <= 1) {
                      setCancellingItem({
                        id: item.id,
                        name: `${item.quantity}x ${item.products?.name || "Produto"}`,
                        total: itemTotal,
                      });
                      return;
                    }
                    const newQty = item.quantity - 1;
                    const { error } = await supabase
                      .from("order_items")
                      .update({ quantity: newQty })
                      .eq("id", item.id);
                    if (error) {
                      toast.error("Erro ao remover unidade");
                      return;
                    }
                    toast.success(`-1 ${item.products?.name || "item"}`);
                    broadcastOrderModified({ restaurantId, orderId, action: "item_removed" });
                    refetchOrders();
                    refetchComandas();
                  }}
                >
                  <Minus className="h-3 w-3 text-destructive" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 w-6 p-0 shrink-0 border-primary/60 bg-background"
                  title="Adicionar mais deste item"
                  onClick={() => {
                    setAddingQtyItem({
                      id: item.id,
                      name: item.products?.name || "Produto",
                      unitPrice: item.price_at_order,
                      currentQty: item.quantity,
                    });
                    setExtraQty(1);
                  }}
                >
                  <Plus className="h-3 w-3 text-primary" />
                </Button>
              </span>
            )}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-muted-foreground ${allSplitsPaid ? "line-through" : ""}`}>
              R$ {itemTotal.toFixed(2)}
            </span>
            {!hasSplits && !allSplitsPaid && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0"
                title="Dividir pagamento"
                onClick={() => handleSplitItem(item, orderId)}
              >
                <Scissors className="h-3 w-3 text-muted-foreground" />
              </Button>
            )}
            {!allSplitsPaid && canManageOrders && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                title="Remover item"
                onClick={() => setCancellingItem({
                  id: item.id,
                  name: `${item.quantity}x ${item.products?.name || "Produto"}`,
                  total: itemTotal,
                })}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Notes */}
        {item.notes && (
          <div className="text-[11px] text-muted-foreground italic ml-4">
            Obs: {item.notes}
          </div>
        )}

        {/* Extras */}
        {item.order_item_extras?.length > 0 && (
          <div className="ml-4 space-y-0.5">
            {item.order_item_extras.map((extra: any, idx: number) => {
              const extraName = extra.extra_name || extra.product_extras?.name || extra.extra_category_items?.name || "Adicional";
              return (
                <div key={idx} className="text-[11px] text-muted-foreground flex justify-between">
                  <span>+ {extraName}</span>
                  <span>R$ {extra.price_at_order.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Splits */}
        {hasSplits && (
          <div className="ml-4 mt-1 space-y-1">
            {splits.map((split) => (
              <div
                key={split.id}
                className={`flex items-center justify-between text-[11px] rounded px-2 py-1 ${
                  split.status === "paid"
                    ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                    : "bg-muted"
                }`}
              >
                <span>
                  Parte {split.split_number}/{split.total_splits} — R$ {split.value.toFixed(2)}
                </span>
                {split.status === "paid" ? (
                  <Badge variant="outline" className="text-[9px] h-4 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 border-green-300">
                    <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                    {formatPaymentMethod(split.payment_type)}
                  </Badge>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-5 text-[10px] px-2"
                    onClick={() => setPayingSplit(split)}
                  >
                    <CreditCard className="w-2.5 h-2.5 mr-0.5" />
                    Pagar
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Reusable header content (used by both Dialog and Sheet)
  const headerContent = (
    <div className="flex items-start justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0 ${
          table?.is_occupied ? "bg-green-500" : "bg-muted-foreground/40"
        }`}>
          {table?.table_number}
        </div>
        <div className="min-w-0">
          <span className="block truncate text-base font-semibold">{table?.table_name || `Mesa ${table?.table_number}`}</span>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <Badge variant={table?.is_occupied ? "default" : "secondary"}>
              {table?.is_occupied ? "Ocupada" : "Livre"}
            </Badge>
            {table?.is_occupied && occupiedTime > 0 && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" /> {occupiedTime}min
              </span>
            )}
          </div>
        </div>
      </div>
      {canManageOrders && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              size="sm"
              disabled={!table?.is_occupied}
              className="h-11 px-4 shrink-0"
            >
              <Eraser className="w-4 h-4 mr-1" /> Limpar Mesa
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Limpar Mesa {table?.table_number}?</AlertDialogTitle>
              <AlertDialogDescription>
                Isso irá cancelar pedidos ativos, fechar comandas e liberar a mesa.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleClearTable}>Limpar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );

  if (!table) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={
            isMobile
              ? "max-w-full w-screen h-[92vh] max-h-[92vh] rounded-t-2xl rounded-b-none p-4 overflow-hidden flex flex-col bottom-0 top-auto left-0 right-0 translate-x-0 translate-y-0 data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom border-x-0 border-b-0 [&>button[aria-label='Close'],&>button:has(>svg.lucide-x)]:h-11 [&>button[aria-label='Close'],&>button:has(>svg.lucide-x)]:w-11 [&>button[aria-label='Close'],&>button:has(>svg.lucide-x)]:flex [&>button[aria-label='Close'],&>button:has(>svg.lucide-x)]:items-center [&>button[aria-label='Close'],&>button:has(>svg.lucide-x)]:justify-center [&>button>svg.lucide-x]:h-5 [&>button>svg.lucide-x]:w-5"
              : "max-w-4xl h-[90vh] max-h-[90vh] overflow-hidden flex flex-col"
          }
        >
          <DialogHeader className={`flex-shrink-0 ${isMobile ? "pr-12 text-left" : ""}`}>
            <DialogDescription className="sr-only">Detalhes da mesa</DialogDescription>
            <DialogTitle asChild>
              <div>{headerContent}</div>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0">
            <ScrollArea className={`relative h-full overflow-hidden ${isMobile ? "-mx-4 px-4" : "-mx-6 px-[24px]"} py-0 my-0`}>
              <div className="space-y-6 pb-4">
              {/* Clients Section */}
              {comandas && comandas.length > 0 && (
                <div>
                  <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
                    <Users className="w-4 h-4" /> Clientes Logados ({comandas.length})
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {comandas.map(comanda => {
                      const bill = billByComanda.get(comanda.id);
                      return (
                        <Card key={comanda.id} className={`p-3 ${bill ? "border-amber-400" : ""}`}>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                              <User className="w-4 h-4 text-primary" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{comanda.customer_name}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">{comanda.customer_cpf}</p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 flex-shrink-0"
                              onClick={(e) => { e.stopPropagation(); setEditingComandaId(comanda.id); }}
                              title="Trocar cliente"
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                          </div>
                          {bill && (
                            <div className="mt-2 flex items-center gap-1.5">
                              {bill.status === "requested" ? (
                                <>
                                  <Badge variant="warning" className="text-[10px] gap-0.5">
                                    <Receipt className="w-3 h-3" /> Conta Solicitada
                                  </Badge>
                                  <Button size="sm" variant="outline" className="h-6 text-[10px] ml-auto" onClick={() => handleMarkBillOnTheWay(bill.id)}>
                                    <Truck className="w-3 h-3 mr-0.5" /> A Caminho
                                  </Button>
                                </>
                              ) : (
                                <Badge variant="default" className="text-[10px] gap-0.5">
                                  <Truck className="w-3 h-3" /> Conta a Caminho
                                </Badge>
                              )}
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Orders by Comanda */}
              {comandas && comandas.length > 0 ? (
                comandas.map(comanda => {
                  const comandaOrders = ordersByComanda.get(comanda.id) || [];
                  const unpaidComandaOrders = comandaOrders.filter((o: any) => o.payment_status !== "paid");
                  const comandaItemsTotal = comandaOrders.reduce((sum, o) => {
                    return sum + (o.order_items?.reduce((s: number, item: any) => {
                      const ext = item.order_item_extras?.reduce((es: number, e: any) => es + e.price_at_order, 0) || 0;
                      return s + (item.price_at_order + ext) * item.quantity;
                    }, 0) || 0);
                  }, 0);
                  const comandaDiscount = comandaOrders.reduce((sum, o) => sum + (o.coupon_discount || 0), 0);
                  const comandaTotal = comandaItemsTotal - comandaDiscount;
                  const unpaidComandaTotal = unpaidComandaOrders.reduce((sum: number, o: any) => sum + getOrderTotal(o), 0);

                  // Calculate splits totals for this comanda
                  const comandaOrderIds = new Set(comandaOrders.map(o => o.id));
                  const comandaSplits = allSplits?.filter(s => comandaOrderIds.has(s.order_id)) || [];
                  const comandaPaidSplits = comandaSplits.filter(s => s.status === "paid");
                  const comandaPaidTotal = comandaPaidSplits.reduce((sum, s) => sum + s.value, 0);
                  const hasSplits = comandaSplits.length > 0;

                  // Get paid items (all splits paid)
                  const allItems = comandaOrders.flatMap(o => (o.order_items || []).map((item: any) => ({ ...item, _orderId: o.id })));
                  const paidItems = allItems.filter(item => {
                    const splits = splitsByItem.get(item.id);
                    return splits && splits.length > 0 && splits.every(s => s.status === "paid");
                  });

                  return (
                    <div key={comanda.id}>
                      <Separator className="mb-4" />
                      <div className="no-min-tap flex flex-wrap items-center justify-between gap-2 mb-3">
                        <h3 className="font-semibold text-sm flex items-center gap-1.5 min-w-0 flex-1">
                          <ShoppingBag className="w-4 h-4 shrink-0" />
                          <span className="truncate">Pedidos de {comanda.customer_name}</span>
                          {comandaOrders.length > 0 && (
                            <Badge variant="outline" className="ml-1 text-[10px] shrink-0">{comandaOrders.length}</Badge>
                          )}
                        </h3>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {comandaOrders.length > 0 && (
                            <span className="text-sm font-bold">R$ {comandaTotal.toFixed(2)}</span>
                          )}
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-7 w-7 shrink-0"
                            title="Adicionar item à comanda"
                            onClick={() => openAddItemsForComanda(comanda)}
                          >
                            <Plus className="w-4 h-4" />
                          </Button>
                          {comandaOrders.length > 0 && (
                            <>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" title="Imprimir comanda" onClick={() => printFullComanda(comanda)}>
                                <Printer className="w-4 h-4" />
                              </Button>
                              {unpaidComandaTotal > 0.01 ? (
                                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => handlePayComanda(comanda)}>
                                  <CreditCard className="w-3.5 h-3.5 mr-1" /> Pagar
                                </Button>
                              ) : (
                                <Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400">
                                  Pago
                                </Badge>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      {comandaOrders.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhum pedido ativo</p>
                      ) : (
                        <div className="space-y-2">
                          {comandaOrders.map(order => (
                            <Card key={order.id} className="p-3">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  {getStatusBadge(order.status)}
                                  {order.payment_status === "paid" && (
                                    <Badge variant="outline" className="text-[10px] border-green-500 text-green-700 dark:text-green-400">
                                      Pago - {formatPaymentWithBrand(order.payment_type, order.payment_brand)}
                                    </Badge>
                                  )}
                                  <span className="text-xs text-muted-foreground">
                                    {format(new Date(order.created_at), "HH:mm", { locale: ptBR })}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 w-6 p-0"
                                    title="Imprimir pedido"
                                    onClick={() => printSingleOrder(order)}
                                  >
                                    <Printer className="w-4 h-4 text-muted-foreground" />
                                  </Button>
                                  <span className="text-sm font-bold">R$ {getOrderTotal(order).toFixed(2)}</span>
                                  {(order.coupon_discount || 0) > 0 && (
                                    <Badge variant="outline" className="text-[9px] text-green-600 border-green-300">
                                      -{((order.coupon_discount || 0)).toFixed(2)}
                                    </Badge>
                                  )}
                                  {order.status === "pending" && !(order as any).pdv_source && canManageOrders && (
                                    <Button size="sm" variant="default" className="h-6 text-xs" onClick={() => handleAcceptOrder(order.id)}>
                                      Aceitar
                                    </Button>
                                  )}
                                </div>
                              </div>
                              <div className="text-sm space-y-0.5">
                                {groupItems(order.order_items || []).map((item: any) => renderItem(item, order.id))}
                              </div>
                            </Card>
                          ))}

                          {/* Paid items section */}
                          {paidItems.length > 0 && (
                            <Collapsible>
                              <CollapsibleTrigger asChild>
                                <Button variant="ghost" size="sm" className="w-full justify-between text-xs text-green-600 hover:text-green-700 h-7">
                                  <span className="flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" />
                                    {paidItems.length} item(ns) totalmente pago(s)
                                  </span>
                                  <ChevronDown className="w-3 h-3" />
                                </Button>
                              </CollapsibleTrigger>
                              <CollapsibleContent className="mt-1">
                                <Card className="p-2 bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-900">
                                  <div className="text-sm space-y-0.5">
                                    {paidItems.map((item: any) => (
                                      <div key={item.id} className="flex justify-between text-xs text-green-700 dark:text-green-400 line-through">
                                        <span>{item.quantity}x {item.products?.name || "Produto"}</span>
                                        <span>R$ {getItemTotal(item).toFixed(2)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </Card>
                              </CollapsibleContent>
                            </Collapsible>
                          )}

                          {/* Financial summary for this comanda when splits exist */}
                          {hasSplits && (
                            <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-1">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Total da comanda:</span>
                                <span className="font-medium">R$ {comandaTotal.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between text-green-600">
                                <span>Já pago (divisões):</span>
                                <span className="font-medium">R$ {comandaPaidTotal.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between font-bold">
                                <span>Pendente:</span>
                                <span>R$ {(comandaTotal - comandaPaidTotal).toFixed(2)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                !table.is_occupied && (
                  <div className="text-center py-8 text-muted-foreground">
                    <ShoppingBag className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p>Mesa livre — nenhum pedido ativo</p>
                  </div>
                )
              )}

              {/* Orders without comanda */}
              {ordersByComanda.has("sem-comanda") && (ordersByComanda.get("sem-comanda")?.length || 0) > 0 && (
                <div>
                  <Separator className="mb-4" />
                  <h3 className="font-semibold text-sm mb-3">Pedidos sem comanda</h3>
                  <div className="space-y-2">
                    {ordersByComanda.get("sem-comanda")!.map(order => (
                      <Card key={order.id} className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {getStatusBadge(order.status)}
                            <span className="text-xs">{order.customer_name}</span>
                          </div>
                          <span className="text-sm font-bold">R$ {getOrderTotal(order).toFixed(2)}</span>
                        </div>
                        <div className="text-xs space-y-0.5">
                          {groupItems(order.order_items || []).map((item: any) => renderItem(item, order.id))}
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* Table Total + Splits Summary */}
              {table.is_occupied && tableTotal > 0 && (
                <>
                  <Separator />
                  <div className="space-y-1 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-lg">Total da Mesa</span>
                      <span className="font-bold text-lg text-primary">R$ {tableTotal.toFixed(2)}</span>
                    </div>
                    {totalPaidViaSplits > 0 && (
                      <>
                        <div className="flex items-center justify-between text-sm text-green-600">
                          <span>Pago (divisões)</span>
                          <span>R$ {totalPaidViaSplits.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm font-bold">
                          <span>Pendente</span>
                          <span>R$ {(tableTotal - totalPaidViaSplits).toFixed(2)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      {/* Payment Modal */}
      {payingComanda && (
        <PaymentConfirmationModal
          order={payingComanda}
          restaurantId={restaurantId}
          onClose={() => setPayingComanda(null)}
          onConfirm={handlePaymentConfirmed}
        />
      )}

      {/* Split Payment Dialog */}
      {splittingItem && (
        <SplitPaymentDialog
          open={!!splittingItem}
          onOpenChange={(o) => { if (!o) setSplittingItem(null); }}
          item={splittingItem}
          orderId={splittingOrderId}
          restaurantId={restaurantId}
          onSplitCreated={handleSplitCreated}
        />
      )}

      {/* Split Payment Select */}
      {payingSplit && (
        <SplitPaymentSelect
          open={!!payingSplit}
          onOpenChange={(o) => { if (!o) setPayingSplit(null); }}
          splitId={payingSplit.id}
          splitValue={payingSplit.value}
          restaurantId={restaurantId}
          onPaid={handleSplitPaid}
        />
      )}

      {/* Customer Edit Dialog */}
      {editingComandaId && (
        <CustomerSelectDialog
          restaurantId={restaurantId}
          open={!!editingComandaId}
          onOpenChange={(o) => { if (!o) setEditingComandaId(null); }}
          onSelect={(customer) => handleSwapCustomer(editingComandaId, customer)}
        />
      )}

      {/* Add Items to Order Drawer */}
      <AddItemsToOrderDrawer
        open={!!addItemsOrderId}
        onClose={() => setAddItemsOrderId(null)}
        orderId={addItemsOrderId || ""}
        restaurantId={restaurantId}
        onItemsAdded={() => {
          refetchOrders();
          refetchComandas();
        }}
      />

      {/* Cancel Item Confirmation */}
      <AlertDialog open={!!cancellingItem} onOpenChange={(o) => { if (!o) setCancellingItem(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover este item do pedido?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <div>O item será removido da comanda, voltará ao estoque e sairá das métricas.</div>
                {cancellingItem && (
                  <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm font-medium text-foreground flex justify-between">
                    <span>{cancellingItem.name}</span>
                    <span>R$ {cancellingItem.total.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCancelItem} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Quantity Confirmation */}
      <AlertDialog open={!!addingQtyItem} onOpenChange={(o) => { if (!o) { setAddingQtyItem(null); setExtraQty(1); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Adicionar mais deste item</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <div>Confirme a quantidade adicional. O valor será somado ao item.</div>
                {addingQtyItem && (
                  <div className="rounded-md border bg-muted/50 px-3 py-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-foreground">{addingQtyItem.name}</div>
                      <div className="text-xs text-muted-foreground">Atual: {addingQtyItem.currentQty}x</div>
                    </div>
                    <div className="flex items-center justify-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => setExtraQty((q) => Math.max(1, q - 1))}
                        disabled={extraQty <= 1}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <div className="text-2xl font-bold w-12 text-center text-foreground">+{extraQty}</div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => setExtraQty((q) => q + 1)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex justify-between text-sm text-foreground pt-1 border-t">
                      <span>Adicional:</span>
                      <span className="font-bold">R$ {(addingQtyItem.unitPrice * extraQty).toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingQty}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmAddQty(); }} disabled={savingQty}>
              {savingQty ? "Salvando…" : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default TableDetailDialog;

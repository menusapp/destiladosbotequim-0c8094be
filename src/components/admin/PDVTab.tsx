import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/useDebounce";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
// Tabs removed — order type now uses pill buttons in header
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Search, ShoppingCart, UserPlus, X, Loader2, Settings,
  MoreVertical, QrCode, Link2, Eraser, Eye, EyeOff, MapPin, Plus,
  ChevronDown, ChevronUp, AlertTriangle, ClipboardList
} from "lucide-react";
import { format, startOfDay, endOfDay } from "date-fns";
import { toast } from "@/components/ui/sonner";
import { validateCPF, validatePhone } from "@/lib/cpfValidator";
import { Switch } from "@/components/ui/switch";
import { Printer } from "lucide-react";
import { PDVProductDrawer } from "./PDVProductDrawer";
import { printDocument } from "@/lib/printDispatcher";
import { CustomerSelectDialog } from "./CustomerSelectDialog";
import { TableDetailDialog } from "./TableDetailDialog";
import { ManageTablesDrawer } from "./ManageTablesDrawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { notifyOrderAcceptedFromPDV } from "@/lib/pdvNotifications";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { checkUnpaidBeforeTableClear } from "@/lib/dangerChecks";
import { getTableMenuLink } from "@/lib/shareableLinks";
import {
  ACTIVE_RESERVATION_STATUSES,
  buildActiveReservationByTable,
  isReservationExpired,
} from "@/lib/reservations";
import { normalizeSearch } from "@/lib/searchNormalize";
import { withProductComplements } from "@/lib/productComplements";
import { TableCardMobile } from "./pdv/mobile/TableCardMobile";
import { TableFilterChips } from "./pdv/mobile/TableFilterChips";
import { cn } from "@/lib/utils";
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel";

import { copiarTexto } from "@/lib/clipboard";
interface CartItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  notes?: string;
  extras: { extraId: string; name: string; price: number; is_complement?: boolean }[];
}

interface TableData {
  id: string;
  table_number: number;
  table_name: string | null;
  is_occupied: boolean;
  occupied_by: string | null;
  occupied_at: string | null;
  min_capacity: number;
  max_capacity: number;
  is_hidden: boolean;
  comandas?: { id: string; customer_name: string; customer_cpf: string }[];
}

interface TableReservation {
  id: string;
  table_id: string | null;
  reservation_date: string;
  reservation_time: string | null;
  customer_name: string;
  status: string | null;
}

interface SelectedCustomer {
  name: string;
  cpf: string;
  phone: string;
}

interface SelectedAddress {
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
}

interface PDVTabProps {
  restaurantId: string;
  restaurantSlug?: string;
  pendingTableToOpen?: string | null;
  onTableOpened?: () => void;
  showPrepTimer?: boolean;
}

const normalizeZoneText = (value?: string | null) =>
  (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const normalizeCityName = (value?: string | null) => {
  const raw = (value || "").trim();
  if (!raw) return "";
  return normalizeZoneText(raw.split(" - ")[0]);
};

const findMatchingDeliveryZone = ({
  orderType,
  deliveryCep,
  deliveryNeighborhood,
  deliveryCity,
  deliveryAddress,
  zones,
}: {
  orderType: "mesa" | "delivery" | "retirada";
  deliveryCep: string;
  deliveryNeighborhood: string;
  deliveryCity: string;
  deliveryAddress: string;
  zones?: any[] | null;
}) => {
  if (orderType !== "delivery" || !zones?.length) return null;

  const cleanCep = deliveryCep.replace(/\D/g, "");
  const normalizedNeighborhood = normalizeZoneText(deliveryNeighborhood);
  const normalizedCity = normalizeCityName(deliveryCity);
  const normalizedAddress = normalizeZoneText(
    [deliveryAddress, deliveryNeighborhood, deliveryCity].filter(Boolean).join(" ")
  );

  if (cleanCep.length >= 5) {
    const cepMatches = zones.flatMap((zone) =>
      (zone.zip_codes || [])
        .map((zipCode: string) => ({
          zone,
          prefix: (zipCode || "").replace(/\D/g, ""),
        }))
        .filter(({ prefix }: { prefix: string }) => prefix && cleanCep.startsWith(prefix))
    );

    if (cepMatches.length > 0) {
      return cepMatches.sort((a, b) => b.prefix.length - a.prefix.length)[0].zone;
    }
  }

  if (normalizedNeighborhood) {
    const neighborhoodZone = zones.find((zone) =>
      zone.neighborhoods?.some((neighborhood: string) => {
        const target = normalizeZoneText(neighborhood);
        return target && (
          normalizedNeighborhood.includes(target) ||
          target.includes(normalizedNeighborhood)
        );
      })
    );
    if (neighborhoodZone) return neighborhoodZone;
  }

  if (normalizedCity) {
    const cityZone = zones.find((zone) => {
      const zoneName = normalizeZoneText(zone.zone_name);
      return zoneName && (
        zoneName === normalizedCity ||
        normalizedAddress.includes(zoneName)
      );
    });
    if (cityZone) return cityZone;
  }

  return null;
};

const PDVTab = ({ restaurantId, restaurantSlug: slugProp, pendingTableToOpen, onTableOpened, showPrepTimer = true }: PDVTabProps) => {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const confirm = useConfirmDialog();
  const [mobileOrderPanelOpen, setMobileOrderPanelOpen] = useState(false);
  const [mobileTableFilter, setMobileTableFilter] = useState<import("./pdv/mobile/TableFilterChips").TableFilter>("all");
  const [mobileStep, setMobileStep] = useState<"dados" | "produtos" | "pagamento">("dados");
  const [mobileCategoryFilter, setMobileCategoryFilter] = useState<string>("all");

  // Order creation state
  const [orderType, setOrderType] = useState<"mesa" | "delivery" | "retirada">("mesa");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [isProductDrawerOpen, setIsProductDrawerOpen] = useState(false);
  const [isCustomerSelectOpen, setIsCustomerSelectOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [orderSearchTerm, setOrderSearchTerm] = useState("");
  const [orderSearchDate, setOrderSearchDate] = useState<Date | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  // Customer fields (source of truth for submit)
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerCpf, setCustomerCpf] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryCep, setDeliveryCep] = useState("");
  const [deliveryNeighborhood, setDeliveryNeighborhood] = useState("");
  const [deliveryCity, setDeliveryCity] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentType, setPaymentType] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [selectedTableId, setSelectedTableId] = useState("");

  // New UX states
  const [selectedCustomer, setSelectedCustomer] = useState<SelectedCustomer | null>(null);
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClientCpf, setNewClientCpf] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [savingNewClient, setSavingNewClient] = useState(false);
  const [cpfSearching, setCpfSearching] = useState(false);
  const [cpfSearched, setCpfSearched] = useState(false);
  const [phoneSearching, setPhoneSearching] = useState(false);

  // Address UX states
  const [selectedAddress, setSelectedAddress] = useState<SelectedAddress | null>(null);
  const [showAddressDialog, setShowAddressDialog] = useState(false);
  const [customerAddresses, setCustomerAddresses] = useState<any[]>([]);
  const [showNewAddressForm, setShowNewAddressForm] = useState(false);
  const [newAddrCep, setNewAddrCep] = useState("");
  const [newAddrStreet, setNewAddrStreet] = useState("");
  const [newAddrNumber, setNewAddrNumber] = useState("");
  const [newAddrComplement, setNewAddrComplement] = useState("");
  const [newAddrNeighborhood, setNewAddrNeighborhood] = useState("");
  const [newAddrCity, setNewAddrCity] = useState("");
  const [newAddrState, setNewAddrState] = useState("");

  // Discount states
  const [discountExpanded, setDiscountExpanded] = useState(false);
  const [discountType, setDiscountType] = useState<"percentage" | "value">("value");
  const [discountTarget, setDiscountTarget] = useState("total");
  const [discountValue, setDiscountValue] = useState("");
  const [discountNotes, setDiscountNotes] = useState("");

  // Employee credit states
  const [employeeCreditName, setEmployeeCreditName] = useState("");
  const [employeeCreditNotes, setEmployeeCreditNotes] = useState("");
  const [employeeNameSuggestions, setEmployeeNameSuggestions] = useState<string[]>([]);

  // Auto-print toggle
  const [autoPrint, setAutoPrint] = useState(() => localStorage.getItem("pdv_auto_print") === "true");

  // Table management state
  const [selectedTableForDrawer, setSelectedTableForDrawer] = useState<TableData | null>(null);
  const [isManageTablesOpen, setIsManageTablesOpen] = useState(false);
  const [restaurantSlug, setRestaurantSlug] = useState<string | null>(slugProp || null);

  // Fetch restaurant slug if not provided via prop
  useEffect(() => {
    if (restaurantSlug || !restaurantId) return;
    supabase.from("restaurants").select("slug").eq("id", restaurantId).single()
      .then(({ data, error }) => {
        if (error) console.error("[PDV] Erro ao buscar slug:", error);
        if (data?.slug) setRestaurantSlug(data.slug);
      });
  }, [restaurantId, restaurantSlug]);

  const { data: deliveryConfig } = useQuery({
    queryKey: ["pdv-delivery-config", restaurantId],
    queryFn: async () => {
      const { data } = await supabase
        .from("delivery_config")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      return data;
    },
  });

  const { data: deliveryZones } = useQuery({
    queryKey: ["pdv-delivery-zones", restaurantId],
    queryFn: async () => {
      const { data } = await supabase
        .from("delivery_zones")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true);
      return data || [];
    },
  });

  // Fetch products
  const { data: products } = useQuery({
    queryKey: ["pdv-products-create", restaurantId],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("*, categories!inner(id, name, restaurant_id), product_extras(*, extra_categories(name))")
        .eq("categories.restaurant_id", restaurantId)
        .eq("available", true)
        .order("name");
      return data || [];
    },
  });

  // Fetch pending local orders per table (for "Pedido Novo" badge)
  const { data: pendingLocalOrders, refetch: refetchPendingOrders } = useQuery({
    queryKey: ["pdv-pending-local-orders", restaurantId],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, table_id, customer_name, order_items(id)")
        .eq("restaurant_id", restaurantId)
        .eq("order_type", "local")
        .eq("status", "pending");
      return data || [];
    },
    staleTime: 0,
  });

  // Fetch ALL active local orders per table (for permanent preview)
  const { data: activeLocalOrders, refetch: refetchActiveOrders } = useQuery({
    queryKey: ["pdv-active-local-orders", restaurantId],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, table_id, customer_name, order_items(id)")
        .eq("restaurant_id", restaurantId)
        .eq("order_type", "local")
        .in("status", ["pending", "accepted", "preparing", "ready"]);
      return data || [];
    },
    staleTime: 0,
  });

  // Fetch searchable orders with items and table info
  const { data: searchableOrders } = useQuery({
    queryKey: ["pdv-searchable-orders", restaurantId, orderSearchDate?.toISOString()],
    queryFn: async () => {
      let query = supabase
        .from("orders")
        .select("id, status, customer_name, customer_cpf, table_id, created_at, order_items(id, quantity, products(name)), tables(table_number, table_name)")
        .eq("restaurant_id", restaurantId)
        .eq("order_type", "local");

      if (orderSearchDate) {
        query = query
          .gte("created_at", startOfDay(orderSearchDate).toISOString())
          .lte("created_at", endOfDay(orderSearchDate).toISOString());
      } else {
        query = query.in("status", ["pending", "accepted", "preparing", "ready", "delivered"]);
      }

      const { data } = await query;
      return data || [];
    },
  });

  // Group pending orders by table_id (for badge only)
  const pendingByTable = useMemo(() => {
    const map = new Map<string, number>();
    pendingLocalOrders?.forEach(order => {
      if (!order.table_id) return;
      map.set(order.table_id, (map.get(order.table_id) || 0) + 1);
    });
    return map;
  }, [pendingLocalOrders]);

  // Group ALL active orders by table_id (for permanent preview)
  const activeByTable = useMemo(() => {
    const map = new Map<string, { customerNames: string[]; itemCount: number }>();
    activeLocalOrders?.forEach(order => {
      if (!order.table_id) return;
      const existing = map.get(order.table_id) || { customerNames: [], itemCount: 0 };
      if (order.customer_name && !existing.customerNames.includes(order.customer_name)) {
        existing.customerNames.push(order.customer_name);
      }
      existing.itemCount += order.order_items?.length || 0;
      map.set(order.table_id, existing);
    });
    return map;
  }, [activeLocalOrders]);

  // Filter searchable orders based on search term and/or date
  const filteredOrders = useMemo(() => {
    if (!searchableOrders) return [];
    if (orderSearchDate && orderSearchTerm.length < 2) return searchableOrders;
    if (orderSearchTerm.length < 2) return [];
    const term = normalizeSearch(orderSearchTerm);
    return searchableOrders.filter((order: any) => {
      if (normalizeSearch(order.customer_name).includes(term)) return true;
      if (order.customer_cpf?.includes(term)) return true;
      if (order.order_items?.some((item: any) => normalizeSearch(item.products?.name).includes(term))) return true;
      return false;
    });
  }, [searchableOrders, orderSearchTerm, orderSearchDate]);

  const { data: tables, refetch: refetchTables } = useQuery({
    queryKey: ["pdv-tables", restaurantId],
    queryFn: async () => {
      const { data: tablesData } = await supabase
        .from("tables").select("*").eq("restaurant_id", restaurantId)
        .neq("table_number", 9999).order("display_order").order("table_number");

      const tableIds = (tablesData || []).map(t => t.id);
      let comandasData: any[] = [];
      if (tableIds.length > 0) {
        const { data } = await supabase.from("comandas")
          .select("id, table_id, customer_name, customer_cpf")
          .in("table_id", tableIds).eq("status", "active");
        comandasData = data || [];
      }

      return (tablesData || []).map(t => ({
        ...t,
        comandas: comandasData.filter(c => c.table_id === t.id),
      })) as TableData[];
    },
    staleTime: 0,
  });

  // Fetch active reservations in batch for table badges; stale/finalized statuses never block tables
  const { data: todayReservations, refetch: refetchTodayReservations } = useQuery({
    queryKey: ["pdv-today-reservations", restaurantId],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const { data } = await supabase
        .from("reservations")
        .select("id, table_id, reservation_date, reservation_time, customer_name, status")
        .eq("restaurant_id", restaurantId)
        .lte("reservation_date", today)
        .in("status", Array.from(ACTIVE_RESERVATION_STATUSES));

      const reservations = (data || []) as TableReservation[];
      const expiredIds = reservations
        .filter((reservation) => isReservationExpired(reservation))
        .map((reservation) => reservation.id);

      if (expiredIds.length > 0) {
        await supabase.from("reservations").update({ status: "expired" }).in("id", expiredIds);
      }

      return reservations.filter((reservation) =>
        reservation.reservation_date === today && !expiredIds.includes(reservation.id)
      );
    },
  });

  // Map table_id → active reservation info for the current time window
  const reservationByTable = useMemo(() => {
    return buildActiveReservationByTable(todayReservations || []);
  }, [todayReservations]);

  // Realtime + fallback de polling consolidados em um único canal/timer.
  // Antes havia dois mecanismos concorrentes (canal próprio + usePolling de 12s),
  // dobrando as requisições. Agora é um canal só, com polling de 6s (tela
  // operacional crítica) e pausa automática quando a aba não está visível.
  const refetchPdvTables = useCallback(() => {
    refetchTables();
    refetchTodayReservations();
  }, [refetchTables, refetchTodayReservations]);

  const refetchPdvOrders = useCallback(() => {
    refetchPendingOrders();
    refetchActiveOrders();
    queryClient.invalidateQueries({ queryKey: ["pdv-searchable-orders"] });
  }, [refetchPendingOrders, refetchActiveOrders, queryClient]);

  useRealtimeChannel({
    channelName: `pdv-tables-rt-${restaurantId}`,
    enabled: !!restaurantId,
    debounceMs: 250,
    pollMs: 6000,
    bindings: [
      { table: "tables", filter: `restaurant_id=eq.${restaurantId}` },
      { table: "comandas", filter: `restaurant_id=eq.${restaurantId}` },
      { table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
      { table: "reservations", filter: `restaurant_id=eq.${restaurantId}` },
    ],
    onChange: () => {
      refetchPdvTables();
      refetchPdvOrders();
    },
  });

  // Debounced search keeps typing snappy on large product lists
  const debouncedSearchTerm = useDebounce(searchTerm, 180);
  const filteredProducts = useMemo(() => {
    if (!products) return [];
    const q = normalizeSearch(debouncedSearchTerm).trim();
    if (!q) return products;
    return products.filter(p => normalizeSearch(p.name).includes(q));
  }, [products, debouncedSearchTerm]);

  const cartSubtotal = useMemo(() => {
    return cart.reduce((sum, item) => {
      const extrasTotal = item.extras.reduce((s, e) => s + e.price, 0);
      return sum + (item.price + extrasTotal) * item.quantity;
    }, 0);
  }, [cart]);

  // Calculated discount
  const calculatedDiscount = useMemo(() => {
    const val = parseFloat(discountValue) || 0;
    if (val <= 0) return 0;
    if (discountType === "percentage") {
      if (discountTarget === "total") {
        const pct = Math.min(val, 100);
        return Math.min(cartSubtotal * (pct / 100), cartSubtotal);
      } else {
        const item = cart.find(c => c.productId === discountTarget);
        if (!item) return 0;
        const itemTotal = (item.price + item.extras.reduce((s, e) => s + e.price, 0)) * item.quantity;
        const pct = Math.min(val, 100);
        return Math.min(itemTotal * (pct / 100), itemTotal);
      }
    } else {
      if (discountTarget === "total") {
        return Math.min(val, cartSubtotal);
      } else {
        const item = cart.find(c => c.productId === discountTarget);
        if (!item) return 0;
        const itemTotal = (item.price + item.extras.reduce((s, e) => s + e.price, 0)) * item.quantity;
        return Math.min(val, itemTotal);
      }
    }
  }, [discountType, discountValue, discountTarget, cartSubtotal, cart]);

  const matchedZone = useMemo(() => findMatchingDeliveryZone({
    orderType,
    deliveryCep,
    deliveryNeighborhood,
    deliveryCity,
    deliveryAddress,
    zones: deliveryZones,
  }), [deliveryZones, deliveryAddress, deliveryCep, deliveryNeighborhood, deliveryCity, orderType]);

  const resolvedDeliveryFee = orderType === "delivery"
    ? Number(matchedZone?.delivery_fee ?? deliveryConfig?.delivery_fee ?? 0)
    : 0;
  const minOrderValue = Number(matchedZone?.min_order_value ?? deliveryConfig?.min_order_value ?? 0);
  const belowMinimum = orderType === "delivery" && minOrderValue > 0 && cartSubtotal > 0 && cartSubtotal < minOrderValue;

  const cartTotal = cartSubtotal - calculatedDiscount + resolvedDeliveryFee;
  const phoneDigits = customerPhone.replace(/\D/g, "");
  const cpfDigits = customerCpf.replace(/\D/g, "");
  const hasTypedCustomerData = Boolean(customerName.trim() || phoneDigits || cpfDigits);
  const isRegisteredCustomer = !!selectedCustomer;
  const hasSavedAddresses = customerAddresses.length > 0;
  const hasManualSelectedAddress = !isRegisteredCustomer && !!selectedAddress;
  const shouldShowAddAddressButton =
    !isRegisteredCustomer &&
    !hasSavedAddresses &&
    !selectedAddress &&
    (customerName.trim() || phoneDigits.length >= 10 || cpfDigits.length === 11);

  // Auto-search customer by CPF
  const handleCpfAutoSearch = async (rawCpf: string) => {
    setCustomerCpf(rawCpf);
    setCpfSearched(false);
    const clean = rawCpf.replace(/\D/g, "");
    if (clean.length !== 11 || !validateCPF(rawCpf)) return;
    setCpfSearching(true);
    try {
      const { data } = await supabase
        .from("customers")
        .select("id, cpf, name, phone")
        .eq("restaurant_id", restaurantId)
        .eq("cpf", rawCpf)
        .maybeSingle();
      if (data) {
        setCustomerName(data.name);
        setCustomerPhone(data.phone || "");
        setSelectedCustomer({ name: data.name, cpf: data.cpf, phone: data.phone || "" });
        toast.success("Cliente encontrado!");
        // Auto-fetch addresses
        const { data: addrs } = await supabase
          .from("customer_addresses")
          .select("*")
          .eq("customer_cpf", data.cpf)
          .order("is_default", { ascending: false });
        setCustomerAddresses(addrs || []);
        // Auto-select default address
        const defaultAddr = addrs?.find((a: any) => a.is_default) || addrs?.[0];
        if (defaultAddr) {
          applyAddress({
            street: defaultAddr.street, number: defaultAddr.number || "",
            complement: defaultAddr.complement || "", neighborhood: defaultAddr.neighborhood || "",
            city: defaultAddr.city || "", state: defaultAddr.state || "", zip_code: defaultAddr.zip_code || "",
          });
        }
      } else {
        setCpfSearched(true);
        setSelectedCustomer(null);
        // Only clear addresses if none were manually added
        if (!selectedAddress) {
          setCustomerAddresses([]);
        }
      }
    } catch { /* ignore */ }
    finally { setCpfSearching(false); }
  };

  // Auto-search customer by phone
  const handlePhoneAutoSearch = async (rawPhone: string) => {
    setCustomerPhone(rawPhone);
    const clean = rawPhone.replace(/\D/g, "");
    if (clean.length < 10 || clean.length > 11) return;
    if (selectedCustomer) return;
    setPhoneSearching(true);
    try {
      const { data } = await supabase
        .from("customers")
        .select("id, cpf, name, phone")
        .eq("restaurant_id", restaurantId)
        .eq("phone", rawPhone)
        .maybeSingle();
      if (data) {
        setCustomerName(data.name);
        setCustomerCpf(data.cpf || "");
        setSelectedCustomer({ name: data.name, cpf: data.cpf, phone: data.phone || "" });
        toast.success("Cliente encontrado!");
        const { data: addrs } = await supabase
          .from("customer_addresses")
          .select("*")
          .eq("customer_cpf", data.cpf)
          .order("is_default", { ascending: false });
        setCustomerAddresses(addrs || []);
        if (addrs && addrs.length > 0) {
          const def = addrs.find((a: any) => a.is_default) || addrs[0];
          setSelectedAddress(def);
          setDeliveryAddress(`${def.street}, ${def.number}${def.complement ? ` - ${def.complement}` : ""}`);
          setDeliveryNeighborhood(def.neighborhood || "");
        }
      } else {
        setSelectedCustomer(null);
        if (!selectedAddress) {
          setCustomerAddresses([]);
        }
      }
    } catch { /* ignore */ }
    finally { setPhoneSearching(false); }
  };

  const handleAddToCart = (item: CartItem) => {
    setCart(prev => [...prev, item]);
    toast.success(`${item.productName} adicionado!`);
    if (isMobile) { setMobileStep("dados"); setMobileOrderPanelOpen(true); }
  };

  // Sync selectedCustomer to source-of-truth states
  const applyCustomer = (c: SelectedCustomer) => {
    setSelectedCustomer(c);
    setCustomerName(c.name);
    setCustomerCpf(c.cpf);
    setCustomerPhone(c.phone);
    setShowNewClientForm(false);
  };

  const clearCustomer = () => {
    setSelectedCustomer(null);
    setCustomerName("");
    setCustomerCpf("");
    setCustomerPhone("");
    setCpfSearched(false);
    setSelectedAddress(null);
    setCustomerAddresses([]);
    setShowNewAddressForm(false);
    setDeliveryAddress("");
    setDeliveryCep("");
    setDeliveryNeighborhood("");
    setDeliveryCity("");
  };

  const applyAddress = (addr: SelectedAddress) => {
    setSelectedAddress(addr);
    setDeliveryAddress(`${addr.street}${addr.number ? `, ${addr.number}` : ""}`);
    setDeliveryCep(addr.zip_code);
    setDeliveryNeighborhood(addr.neighborhood);
    setDeliveryCity(`${addr.city} - ${addr.state}`);
  };

  const handleCustomerSelect = (customer: { id: string; cpf: string; name: string; phone: string | null; defaultAddress?: any }) => {
    applyCustomer({ name: customer.name, cpf: customer.cpf, phone: customer.phone || "" });
    // Auto-fill address if delivery and address available
    if (customer.defaultAddress && orderType === "delivery") {
      applyAddress({
        street: customer.defaultAddress.street,
        number: customer.defaultAddress.number || "",
        complement: customer.defaultAddress.complement || "",
        neighborhood: customer.defaultAddress.neighborhood || "",
        city: customer.defaultAddress.city || "",
        state: customer.defaultAddress.state || "",
        zip_code: customer.defaultAddress.zip_code || "",
      });
    }
  };

  const handleCepLookup = async (cep: string) => {
    const clean = cep.replace(/\D/g, "");
    if (clean.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
      const data = await res.json();
      if (!data.erro) {
        return { street: data.logradouro || "", neighborhood: data.bairro || "", city: data.localidade || "", state: data.uf || "" };
      }
    } catch { /* ignore */ }
    return null;
  };

  const handleSaveNewClient = async () => {
    if (!newClientName.trim()) { toast.error("Nome é obrigatório"); return; }
    if (!validateCPF(newClientCpf)) { toast.error("Informe um CPF válido"); return; }
    if (!validatePhone(newClientPhone)) { toast.error("Informe um celular válido"); return; }
    setSavingNewClient(true);
    try {
      const finalCpf = newClientCpf;
      const finalName = newClientName.trim();
      const finalPhone = newClientPhone.trim();

      const { data: existing } = await supabase
        .from("customers").select("id").eq("restaurant_id", restaurantId).eq("cpf", finalCpf).maybeSingle();
      if (existing) {
        await supabase.from("customers").update({ name: finalName, phone: finalPhone }).eq("id", existing.id);
      } else {
        await supabase.from("customers").insert({ restaurant_id: restaurantId, cpf: finalCpf, name: finalName, phone: finalPhone });
      }

      applyCustomer({ name: finalName, cpf: finalCpf, phone: finalPhone });
      setNewClientCpf("");
      setNewClientName("");
      setNewClientPhone("");
      toast.success("Cliente salvo!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar cliente");
    } finally {
      setSavingNewClient(false);
    }
  };

  // Fetch customer addresses when opening address dialog
  const fetchCustomerAddresses = async () => {
    if (!selectedCustomer?.cpf) {
      setCustomerAddresses([]);
      return;
    }
    const { data } = await supabase
      .from("customer_addresses")
      .select("*")
      .eq("customer_cpf", selectedCustomer.cpf)
      .order("is_default", { ascending: false });
    setCustomerAddresses(data || []);
  };

  const handleNewAddrCepLookup = async (cep: string) => {
    setNewAddrCep(cep);
    const result = await handleCepLookup(cep);
    if (result) {
      setNewAddrStreet(result.street);
      setNewAddrNeighborhood(result.neighborhood);
      setNewAddrCity(result.city);
      setNewAddrState(result.state);
    }
  };

  const handleSaveNewAddress = async () => {
    if (!newAddrStreet.trim()) { toast.error("Rua é obrigatória"); return; }
    const addr: SelectedAddress = {
      street: newAddrStreet, number: newAddrNumber, complement: newAddrComplement,
      neighborhood: newAddrNeighborhood, city: newAddrCity, state: newAddrState, zip_code: newAddrCep,
    };

    // Save to DB if customer has CPF (registered or not — will be saved to CRM on order creation)
    const cpfToUse = selectedCustomer?.cpf || customerCpf;
    const nameToUse = selectedCustomer?.name || customerName.trim();
    const phoneToUse = selectedCustomer?.phone || customerPhone;
    if (cpfToUse && validateCPF(cpfToUse)) {
      await supabase.from("customer_addresses").insert({
        customer_cpf: cpfToUse,
        customer_name: nameToUse || "Cliente",
        customer_phone: phoneToUse || "",
        street: addr.street, number: addr.number, complement: addr.complement,
        neighborhood: addr.neighborhood, city: addr.city, state: addr.state, zip_code: addr.zip_code,
      });
    }

    applyAddress(addr);
    setShowAddressDialog(false);
    resetNewAddrForm();
    toast.success("Endereço selecionado!");
  };

  const resetNewAddrForm = () => {
    setShowNewAddressForm(false);
    setNewAddrCep(""); setNewAddrStreet(""); setNewAddrNumber("");
    setNewAddrComplement(""); setNewAddrNeighborhood(""); setNewAddrCity(""); setNewAddrState("");
  };

  const clearForm = () => {
    setCart([]);
    setCustomerName(""); setCustomerPhone(""); setCustomerCpf("");
    setDeliveryAddress(""); setDeliveryCep(""); setDeliveryNeighborhood(""); setDeliveryCity("");
    setNotes(""); setPaymentType(""); setCashReceived(""); setSelectedTableId("");
    setSelectedCustomer(null);
    setSelectedAddress(null);
    setCustomerAddresses([]);
    setShowNewAddressForm(false);
    setCpfSearched(false);
    setShowNewClientForm(false);
    setDiscountExpanded(false);
    setDiscountType("value");
    setDiscountTarget("total");
    setDiscountValue("");
    setDiscountNotes("");
    setEmployeeCreditName("");
    setEmployeeCreditNotes("");
  };

  const insertOrderItems = async (orderId: string) => {
    for (const item of cart) {
      const { data: oi, error } = await supabase.from("order_items").insert({
        order_id: orderId, product_id: item.productId,
        quantity: item.quantity, price_at_order: item.price, notes: item.notes || null,
      }).select().single();
      if (error) throw error;
      if (item.extras.length > 0) {
        const { error: extrasError } = await supabase.from("order_item_extras").insert(
          item.extras.map(e => ({
            order_item_id: oi.id,
            product_extra_id: e.is_complement ? null : e.extraId,
            price_at_order: e.price,
            extra_name: e.name,
          }))
        );
        if (extrasError) {
          console.error("Erro ao inserir adicionais:", extrasError);
          throw extrasError;
        }
      }
    }
  };

  // CRM: Save/update customer data before creating orders
  const upsertCustomerCRM = async () => {
    const cpf = customerCpf?.replace(/\D/g, "");
    if (!cpf || cpf.length < 11) return;
    const name = customerName.trim();
    const phone = customerPhone || null;

    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("cpf", customerCpf)
      .maybeSingle();

    if (existing) {
      await supabase.from("customers").update({
        name, phone,
      }).eq("id", existing.id);
    } else {
      await supabase.from("customers").insert({
        restaurant_id: restaurantId,
        cpf: customerCpf,
        name,
        phone,
      });
    }
  };

  const handleSubmit = async () => {
    if (!customerName.trim()) {
      toast.error("Informe o nome do cliente");
      return;
    }
    if (cart.length === 0) { toast.error("Adicione produtos ao carrinho"); return; }
    if (orderType === "delivery" && !customerPhone.trim()) {
      toast.error("Telefone é obrigatório para delivery");
      return;
    }
    if (orderType === "delivery" && !deliveryAddress.trim()) {
      toast.error("Informe o endereço de entrega");
      return;
    }
    if (orderType === "delivery" && (deliveryZones?.length ?? 0) > 0 && !matchedZone) {
      toast.error("Endereço fora das regiões de entrega cadastradas. Verifique CEP/bairro ou cadastre a região.");
      return;
    }
    if (belowMinimum) {
      toast.error(`Pedido mínimo para essa região: R$ ${minOrderValue.toFixed(2)}. Subtotal atual: R$ ${cartSubtotal.toFixed(2)}.`);
      return;
    }

    setSubmitting(true);
    let createdOrderId: string | null = null;
    const cashReceivedNum = parseFloat((cashReceived || "").replace(",", "."));
    const cashChangeText = paymentType === "cash" && Number.isFinite(cashReceivedNum) && cashReceivedNum > cartTotal
      ? ` Troco para: R$ ${cashReceivedNum.toFixed(2).replace(".", ",")}`
      : "";
    try {
      // Auto-create/update customer in CRM
      await upsertCustomerCRM();
      if (orderType === "delivery") {
        const discountForOrder = calculatedDiscount > 0 ? calculatedDiscount : null;
        const discountNotesText = discountNotes ? ` [Desconto: ${discountNotes}]` : "";
        const cityParts = (deliveryCity || "").split(" - ");
        const resolvedCityName = (selectedAddress?.city || cityParts[0] || matchedZone?.zone_name || "").trim();
        const resolvedState = (selectedAddress?.state || cityParts[1] || "").trim();
        const resolvedCityLabel = resolvedCityName
          ? `${resolvedCityName}${resolvedState ? ` - ${resolvedState}` : ""}`
          : "";
        const fullAddress = [
          resolvedCityLabel,
          deliveryAddress || "",
          deliveryNeighborhood || selectedAddress?.neighborhood || "",
          deliveryCep ? `CEP ${deliveryCep}` : "",
        ].filter(Boolean).join(" - ");
        const finalDeliveryFee = Math.round(resolvedDeliveryFee * 100) / 100;

        const { data: order, error } = await supabase.from("orders").insert({
          restaurant_id: restaurantId, order_type: "delivery", delivery_type: "delivery",
          status: "preparing", customer_name: customerName.trim(),
          customer_cpf: customerCpf,
          delivery_phone: customerPhone,
          delivery_address: fullAddress || null,
          delivery_city: resolvedCityName || null,
          delivery_neighborhood: deliveryNeighborhood || selectedAddress?.neighborhood || null,
          notes: ((notes || "") + discountNotesText + cashChangeText).trim() || null, payment_type: paymentType || null,
          coupon_discount: discountForOrder,
          delivery_fee: finalDeliveryFee,
          pdv_source: true,
        }).select().single();
        if (error) throw error;
        createdOrderId = order.id;
        await insertOrderItems(order.id);

        // Employee credit for delivery
        if (paymentType === "employee_credit") {
          await supabase.from("employee_credits").insert({
            restaurant_id: restaurantId,
            employee_name: employeeCreditName || customerName || "Funcionário",
            order_id: order.id,
            amount: cartTotal,
            status: "pending",
            notes: employeeCreditNotes || null,
            created_by: "Sistema PDV",
          });
        }

        // Trigger WhatsApp "order accepted" notification (PDV orders skip pending->accepted transition)
        notifyOrderAcceptedFromPDV({
          restaurantId,
          orderId: order.id,
          customerName: customerName.trim(),
          customerPhone,
        });

      } else if (orderType === "retirada") {
        const discountForOrder = calculatedDiscount > 0 ? calculatedDiscount : null;
        const discountNotesText = discountNotes ? ` [Desconto: ${discountNotes}]` : "";
        const { data: order, error } = await supabase.from("orders").insert({
          restaurant_id: restaurantId, order_type: "delivery", delivery_type: "pickup",
          status: "preparing", customer_name: customerName.trim(),
          customer_cpf: customerCpf,
          notes: ((notes || "") + discountNotesText + cashChangeText).trim() || null, payment_type: paymentType || null,
          coupon_discount: discountForOrder,
          pdv_source: true,
        }).select().single();
        if (error) throw error;
        createdOrderId = order.id;
        await insertOrderItems(order.id);

        // Trigger WhatsApp "order accepted" notification (PDV pickup)
        notifyOrderAcceptedFromPDV({
          restaurantId,
          orderId: order.id,
          customerName: customerName.trim(),
          customerPhone,
        });

        // Employee credit for retirada
        if (paymentType === "employee_credit") {
          await supabase.from("employee_credits").insert({
            restaurant_id: restaurantId,
            employee_name: employeeCreditName || customerName || "Funcionário",
            order_id: order.id,
            amount: cartTotal,
            status: "pending",
            notes: employeeCreditNotes || null,
            created_by: "Sistema PDV",
          });
        }

      } else {
        // Mesa
        const tableId = selectedTableId;
        if (!tableId) throw new Error("Selecione uma mesa");
        const table = tables?.find(t => t.id === tableId);
        if (!table) throw new Error("Mesa não encontrada");

        let comandaId: string | null = null;
        const currentCustomerName = customerName.trim();
        const currentCustomerCpf = customerCpf;

        if (table.is_occupied) {
          const { data: existingComanda } = await supabase.from("comandas")
            .select("*").eq("table_id", tableId).eq("status", "active")
            .eq("customer_name", currentCustomerName)
            .eq("customer_cpf", currentCustomerCpf)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          if (existingComanda) {
            comandaId = existingComanda.id;
          } else {
            const { data: nc } = await supabase.from("comandas").insert({
              restaurant_id: restaurantId, table_id: tableId,
              customer_name: currentCustomerName,
              customer_cpf: currentCustomerCpf, status: "active",
            }).select().single();
            comandaId = nc?.id || null;
          }
        } else {
          await supabase.from("tables").update({
            is_occupied: true, occupied_at: new Date().toISOString(),
            occupied_by: currentCustomerName,
          }).eq("id", tableId);
          const { data: nc } = await supabase.from("comandas").insert({
            restaurant_id: restaurantId, table_id: tableId,
            customer_name: currentCustomerName,
            customer_cpf: currentCustomerCpf, status: "active",
          }).select().single();
          comandaId = nc?.id || null;
        }

        // Resolve payment type label
        let resolvedPaymentType: string | null = null;
        if (paymentType === "cash") resolvedPaymentType = "Dinheiro";
        else if (paymentType === "pix") resolvedPaymentType = "PIX";
        else if (paymentType === "employee_credit") resolvedPaymentType = "Crédito Funcionário";
        else if (paymentType === "meal_voucher") resolvedPaymentType = "Vale Refeição";
        else if (paymentType.includes(" - ")) resolvedPaymentType = paymentType;
        else if (paymentType) resolvedPaymentType = paymentType;

        const discountForOrder = calculatedDiscount > 0 ? calculatedDiscount : null;
        const discountNotesText = discountNotes ? ` [Desconto: ${discountNotes}]` : "";

        // Insert order already accepted (PDV orders skip pending stage)
        const { data: order, error } = await supabase.from("orders").insert({
          restaurant_id: restaurantId, order_type: "local", table_id: tableId,
          comanda_id: comandaId, status: "accepted",
          customer_name: currentCustomerName,
          customer_cpf: currentCustomerCpf,
          notes: ((notes || "") + discountNotesText + cashChangeText).trim() || null,
          payment_type: null,
          payment_brand: null,
          coupon_discount: discountForOrder,
          pdv_source: true,
        }).select().single();
        if (error) throw error;
        createdOrderId = order.id;

        // Insert items first so trigger calculates total correctly
        await insertOrderItems(order.id);

        // UPDATE payment_type to fire add_local_order_to_cash_register trigger
        // If a payment method was selected, mark the order as paid
        if (resolvedPaymentType) {
          await supabase.from("orders").update({
            payment_type: resolvedPaymentType,
            payment_status: "paid",
            paid_at: new Date().toISOString(),
          }).eq("id", order.id);
        }

        // Trigger WhatsApp "order accepted" notification (lookup phone by CPF)
        try {
          let phoneForNotify: string | null = null;
          if (currentCustomerCpf) {
            const { data: cust } = await supabase
              .from("customers")
              .select("phone")
              .eq("restaurant_id", restaurantId)
              .eq("cpf", currentCustomerCpf)
              .maybeSingle();
            phoneForNotify = cust?.phone || null;
          }
          if (phoneForNotify) {
            notifyOrderAcceptedFromPDV({
              restaurantId,
              orderId: order.id,
              customerName: currentCustomerName,
              customerPhone: phoneForNotify,
            });
          }
        } catch {}

        // Insert employee credit record if payment type is employee_credit
        if (paymentType === "employee_credit") {
          await supabase.from("employee_credits").insert({
            restaurant_id: restaurantId,
            employee_name: employeeCreditName || customerName || "Funcionário",
            order_id: order.id,
            amount: cartTotal,
            status: "pending",
            notes: employeeCreditNotes || null,
            created_by: "Sistema PDV",
          });
        }
      }

      // Stock deduction is handled by DB trigger on status change to delivered/picked_up

      toast.success("Pedido criado com sucesso!");

      // Auto-print é disparado pelo painel global (RestaurantAdmin) nas
      // contas com notificações ativadas (tipicamente o PC primário). Assim
      // o pedido NÃO imprime no celular do garçom que criou o pedido.

      clearForm();
      refetchTables();
      queryClient.invalidateQueries({ queryKey: ["unified-orders"] });
      if (isMobile) setMobileOrderPanelOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar pedido");
    } finally {
      setSubmitting(false);
    }
  };

  // Table actions
  const getTableMenuUrl = (tableNumber: number) => {
    if (!restaurantSlug) return null;
    // Use the shareable link helper so WhatsApp previews show the restaurant's logo
    return getTableMenuLink(restaurantSlug, tableNumber);
  };

  const handleCopyLink = (table: TableData) => {
    const url = getTableMenuUrl(table.table_number);
    if (!url) { toast.error("Slug do restaurante não encontrado"); return; }
    copiarTexto(url);
    toast.success(`Link da Mesa ${table.table_number} copiado!`);
  };

  const handleShowQR = (table: TableData) => {
    const url = getTableMenuUrl(table.table_number);
    if (!url) { toast.error("Slug do restaurante não encontrado"); return; }
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(url)}`;
    window.open(qrUrl, "_blank");
  };

  const handleClearTable = async (table: TableData) => {
    const warnings = await checkUnpaidBeforeTableClear(table.id);
    const ok = await confirm({
      variant: "destructive",
      title: `Limpar Mesa ${table.table_number}?`,
      description: "Isso irá cancelar pedidos ativos, fechar comandas e liberar a mesa para um novo cliente.",
      consequence: "Esta ação não pode ser desfeita.",
      warnings,
      confirmLabel: "Sim, limpar mesa",
    });
    if (!ok) return;
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
    refetchTables();
    refetchActiveOrders();
  };

  const handleToggleHidden = async (table: TableData) => {
    const newHidden = !table.is_hidden;
    await supabase.from("tables").update({ is_hidden: newHidden }).eq("id", table.id);
    toast.success(newHidden ? `Mesa ${table.table_number} ocultada` : `Mesa ${table.table_number} visível`);
    refetchTables();
  };

  const handleTableClick = (table: TableData) => {
    setSelectedTableForDrawer(table);
  };

  const handleTableSelect = (table: TableData) => {
    setOrderType("mesa");
    setSelectedTableId(table.id);
  };

  const occupiedTables = tables?.filter(t => t.is_occupied).length || 0;
  const availableTables = tables?.filter(t => !t.is_occupied).length || 0;

  return (
    <div className="h-[calc(100vh-7rem)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 flex-shrink-0 gap-2">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-bold">PDV</h2>
          <p className="text-[11px] sm:text-sm text-muted-foreground truncate">
            {tables?.length || 0} mesas • {occupiedTables} ocup. • {availableTables} livres
          </p>
        </div>
        <div className="no-min-tap hidden sm:flex items-center gap-1.5 flex-shrink-0 h-8 px-2 rounded-button border border-border" data-tour="pdv-auto-print">
          <Printer className="h-3.5 w-3.5 text-muted-foreground" />
          <label htmlFor="auto-print-toggle" className="text-[11px] sm:text-xs text-muted-foreground cursor-pointer">Auto-print</label>
          <Switch
            id="auto-print-toggle"
            checked={autoPrint}
            onCheckedChange={(checked) => {
              setAutoPrint(checked);
              localStorage.setItem("pdv_auto_print", String(checked));
              toast.success(checked ? "Impressão automática ativada" : "Impressão automática desativada");
            }}
            className="h-4 w-7 scale-90"
          />
        </div>
      </div>

      {/* Main content: tables grid + order panel */}
      <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
        {/* Left: Tables Grid */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Order Search Bar */}
          <div className="flex gap-2 mb-2 flex-shrink-0" data-tour="pdv-search">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar pedido por nome, CPF ou item..."
                value={orderSearchTerm}
                onChange={e => setOrderSearchTerm(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
              {orderSearchTerm && (
                <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                  onClick={() => setOrderSearchTerm("")}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>

          {/* Search Results */}
          {(orderSearchTerm.length >= 2) && (
            <div className="mb-2 flex-shrink-0">
              {filteredOrders.length === 0 && orderSearchTerm.length >= 2 ? (
                <p className="text-sm text-muted-foreground text-center py-3">Nenhum pedido encontrado</p>
              ) : filteredOrders.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{filteredOrders.length} pedido{filteredOrders.length !== 1 ? "s" : ""} encontrado{filteredOrders.length !== 1 ? "s" : ""}</p>
                  <div className="max-h-[260px] overflow-y-auto space-y-1.5 pr-1">
                    {filteredOrders.map((order: any) => {
                      const statusMap: Record<string, { label: string; variant: "default" | "warning" | "success" | "secondary" | "destructive" }> = {
                        pending: { label: "Pendente", variant: "warning" },
                        accepted: { label: "Aceito", variant: "default" },
                        preparing: { label: "Preparando", variant: "default" },
                        ready: { label: "Pronto", variant: "success" },
                        delivered: { label: "Entregue", variant: "secondary" },
                        cancelled: { label: "Cancelado", variant: "destructive" },
                        paid: { label: "Pago", variant: "success" },
                      };
                      const status = statusMap[order.status] || { label: order.status, variant: "secondary" as const };
                      const itemsSummary = order.order_items?.map((i: any) => `${i.quantity}x ${i.products?.name || "?"}`).join(", ") || "";
                      const tableInfo = order.tables;
                      const tableLabel = tableInfo ? (tableInfo.table_name || `Mesa ${tableInfo.table_number}`) : "—";
                      const orderTime = order.created_at ? format(new Date(order.created_at), "HH:mm") : "";

                      return (
                        <Card
                          key={order.id}
                          className="cursor-pointer hover:shadow-md transition-shadow"
                          onClick={() => {
                            if (order.table_id && tables) {
                              const t = tables.find(tb => tb.id === order.table_id);
                              if (t) { setSelectedTableForDrawer(t); setOrderSearchTerm(""); }
                            }
                          }}
                        >
                          <CardContent className="p-2.5 flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                              {tableInfo?.table_number || "?"}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium truncate">{order.customer_name}</span>
                                <Badge variant={status.variant} className="text-[10px] flex-shrink-0">{status.label}</Badge>
                                <span className="text-[10px] text-muted-foreground flex-shrink-0">{orderTime}</span>
                              </div>
                              <p className="text-[10px] text-muted-foreground truncate">{tableLabel} • {itemsSummary}</p>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Gerenciar Mesas button */}
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={() => setIsManageTablesOpen(true)} className="text-xs h-7">
              <Settings className="w-3.5 h-3.5 mr-1" />
              Gerenciar Mesas
            </Button>
          </div>

          {/* Mobile filter chips */}
          {isMobile && tables && (
            <div className="mb-2 flex-shrink-0">
              <TableFilterChips
                value={mobileTableFilter}
                onChange={setMobileTableFilter}
                counts={{
                  all: tables.filter(t => !t.is_hidden).length,
                  occupied: tables.filter(t => !t.is_hidden && t.is_occupied).length,
                  free: tables.filter(t => !t.is_hidden && !t.is_occupied).length,
                  pending: tables.filter(t => !t.is_hidden && (pendingByTable.get(t.id) || 0) > 0).length,
                }}
              />
            </div>
          )}

          {/* Tables Grid (scrollable) */}
          <div className="flex-1 overflow-y-auto pr-1 pb-24 sm:pb-1">
            {isMobile ? (
              <div className="grid grid-cols-2 gap-2.5">
                {tables
                  ?.filter(table => {
                    if (table.is_hidden && mobileTableFilter !== "all") return false;
                    if (mobileTableFilter === "occupied") return table.is_occupied;
                    if (mobileTableFilter === "free") return !table.is_occupied;
                    if (mobileTableFilter === "pending") return (pendingByTable.get(table.id) || 0) > 0;
                    return true;
                  })
                  .map(table => {
                    const active = activeByTable.get(table.id);
                    return (
                      <TableCardMobile
                        key={table.id}
                        table={table}
                        isSelected={selectedTableId === table.id}
                        pendingCount={pendingByTable.get(table.id) || 0}
                        itemCount={active?.itemCount || 0}
                        reservationTime={reservationByTable.get(table.id)?.reservation_time || null}
                        onClick={() => !table.is_hidden && handleTableClick(table)}
                        onShowQR={() => handleShowQR(table)}
                        onCopyLink={() => handleCopyLink(table)}
                        onToggleHidden={() => handleToggleHidden(table)}
                        onClearTable={() => handleClearTable(table)}
                      />
                    );
                  })}
              </div>
            ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {tables?.map(table => {
                const active = activeByTable.get(table.id);
                return (
                  <TableCardMobile
                    key={table.id}
                    table={table}
                    isSelected={selectedTableId === table.id}
                    pendingCount={pendingByTable.get(table.id) || 0}
                    itemCount={active?.itemCount || 0}
                    reservationTime={reservationByTable.get(table.id)?.reservation_time || null}
                    onClick={() => !table.is_hidden && handleTableClick(table)}
                    onShowQR={() => handleShowQR(table)}
                    onCopyLink={() => handleCopyLink(table)}
                    onToggleHidden={() => handleToggleHidden(table)}
                    onClearTable={() => handleClearTable(table)}
                  />
                );
              })}
            </div>
            )}
          </div>
        </div>

        {/* Right: Order Creation Panel — desktop inline, mobile bottom sheet */}
        <div
          className={`
            ${isMobile
              ? `fixed inset-x-0 bottom-0 z-50 bg-background flex flex-col px-3 pt-2 rounded-t-2xl shadow-2xl border-t transition-transform duration-300 h-[100dvh] max-h-[100dvh] ${mobileOrderPanelOpen ? "translate-y-0" : "translate-y-full"}`
              : "w-[520px] flex-shrink-0 border-l pl-6 flex flex-col min-h-0"
            }
          `}
        >
          {/* Mobile drag handle */}
          {isMobile && (
            <div className="absolute top-1 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-muted-foreground/30" />
          )}

          {isMobile ? (
            <div className="shrink-0 pt-2">
              {/* Mobile header: close + title + progress + clear */}
              <div className="flex items-center gap-2 mb-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setMobileOrderPanelOpen(false)}
                  className="h-8 w-8 -ml-1"
                  aria-label="Fechar"
                >
                  <X className="w-5 h-5" />
                </Button>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-sm truncate leading-tight">
                    {mobileStep === "dados" ? "Dados do pedido" : mobileStep === "produtos" ? "Produtos" : "Pagamento"}
                  </h3>
                </div>
                {cart.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={clearForm} className="text-[11px] text-muted-foreground h-8 px-2">
                    Limpar
                  </Button>
                ) : (
                  <div className="w-8" />
                )}
              </div>

              {/* Mobile order type pills — compact */}
              <div className="grid grid-cols-3 gap-0.5 p-0.5 bg-muted rounded-md mb-1">
                {(["mesa", "delivery", "retirada"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setOrderType(t)}
                    className={cn(
                      "h-6 rounded text-[11px] font-semibold transition-all capitalize leading-none",
                      orderType === t
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground active:scale-95"
                    )}
                  >
                    {t === "mesa" ? "Mesa" : t === "delivery" ? "Delivery" : "Retirada"}
                  </button>
                ))}
              </div>

              {/* Steps indicator — below order type pills */}
              <div className="flex items-center gap-1 mb-1">
                {([
                  { key: "dados", label: "Dados" },
                  { key: "produtos", label: "Produtos" },
                  { key: "pagamento", label: "Pagamento" },
                ] as const).map(({ key, label }, idx) => {
                  const currentIdx = (["dados", "produtos", "pagamento"] as const).indexOf(mobileStep);
                  const active = mobileStep === key;
                  const done = currentIdx > idx;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setMobileStep(key)}
                      className={cn(
                        "h-4 flex-1 rounded-full font-semibold leading-none transition-colors px-1 flex items-center justify-center text-[10px]",
                        active
                          ? "bg-primary text-primary-foreground"
                          : done
                          ? "bg-primary/60 text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      )}
                      aria-label={`Etapa ${label}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="shrink-0 mb-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="font-bold text-base">Novo Pedido</h3>
                {cart.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearForm} className="text-xs text-muted-foreground h-7 px-2">
                    Limpar
                  </Button>
                )}
              </div>

              {/* Order type pills */}
              <div className="grid grid-cols-3 gap-0.5 p-0.5 bg-muted rounded-md mb-1.5" data-tour="pdv-order-type">
                {(["mesa", "delivery", "retirada"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setOrderType(t)}
                    className={cn(
                      "h-7 rounded text-xs font-semibold transition-all capitalize leading-none",
                      orderType === t
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t === "mesa" ? "Mesa" : t === "delivery" ? "Delivery" : "Retirada"}
                  </button>
                ))}
              </div>

              {/* Steps indicator */}
              <div className="flex items-center gap-1">
                {([
                  { key: "dados", label: "Dados" },
                  { key: "produtos", label: "Produtos" },
                  { key: "pagamento", label: "Pagamento" },
                ] as const).map(({ key, label }, idx) => {
                  const currentIdx = (["dados", "produtos", "pagamento"] as const).indexOf(mobileStep);
                  const active = mobileStep === key;
                  const done = currentIdx > idx;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setMobileStep(key)}
                      className={cn(
                        "h-5 flex-1 rounded-full font-semibold leading-none transition-colors px-1 flex items-center justify-center text-[11px]",
                        active
                          ? "bg-primary text-primary-foreground"
                          : done
                          ? "bg-primary/60 text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <ScrollArea className={cn("flex-1 min-h-0", isMobile && "-mx-1")}>
            <div className={cn("space-y-5", isMobile ? "px-1 pb-2" : "pr-3")}>
              {/* Customer Section — Inline Fields */}
              <div className={cn("border rounded-lg bg-muted/30", isMobile ? "p-3" : "p-4", mobileStep !== "dados" && "hidden")} data-tour="pdv-customer">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-muted-foreground">Cliente</p>
                  {(customerName || customerCpf || customerPhone) && (
                    <Button variant="ghost" size="sm" onClick={clearCustomer} className="h-6 px-2 text-xs text-muted-foreground">
                      <X className="w-3 h-3 mr-1" /> Limpar
                    </Button>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="relative">
                    <Label className="text-xs mb-1.5 block">Celular</Label>
                    <Input
                      placeholder="(00) 00000-0000"
                      value={customerPhone}
                      onChange={e => handlePhoneAutoSearch(e.target.value)}
                      className={`h-9 text-sm pr-8 ${customerPhone.replace(/\D/g, "").length >= 10 ? (validatePhone(customerPhone) ? "border-green-500 focus-visible:ring-green-500" : "border-destructive focus-visible:ring-destructive") : ""}`}
                      disabled={!!selectedCustomer}
                    />
                    {phoneSearching ? (
                      <Loader2 className="w-4 h-4 animate-spin absolute right-2.5 top-[34px] text-muted-foreground" />
                    ) : customerPhone.replace(/\D/g, "").length >= 10 ? (
                      validatePhone(customerPhone) ? (
                        <span className="absolute right-2.5 top-[34px] text-green-500 text-xs font-bold">✓</span>
                      ) : (
                        <span className="absolute right-2.5 top-[34px] text-destructive text-xs font-bold">✗</span>
                      )
                    ) : null}
                    {customerPhone.replace(/\D/g, "").length >= 10 && !validatePhone(customerPhone) && (
                      <p className="text-xs text-destructive mt-1">Celular inválido</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs mb-1.5 block">Nome *</Label>
                    <Input
                      placeholder="Nome do cliente"
                      value={customerName}
                      onChange={e => setCustomerName(e.target.value)}
                      className="h-9 text-sm"
                      disabled={!!selectedCustomer}
                    />
                  </div>
                  <div className="relative">
                    <Label className="text-xs mb-1.5 block">CPF *</Label>
                    <Input
                      placeholder="000.000.000-00"
                      value={customerCpf}
                      onChange={e => handleCpfAutoSearch(e.target.value)}
                      className={`h-9 text-sm pr-8 ${customerCpf.replace(/\D/g, "").length === 11 ? (validateCPF(customerCpf) ? "border-green-500 focus-visible:ring-green-500" : "border-destructive focus-visible:ring-destructive") : ""}`}
                    />
                    {cpfSearching ? (
                      <Loader2 className="w-4 h-4 animate-spin absolute right-2.5 top-[34px] text-muted-foreground" />
                    ) : customerCpf.replace(/\D/g, "").length === 11 ? (
                      validateCPF(customerCpf) ? (
                        <span className="absolute right-2.5 top-[34px] text-green-500 text-xs font-bold">✓</span>
                      ) : (
                        <span className="absolute right-2.5 top-[34px] text-destructive text-xs font-bold">✗</span>
                      )
                    ) : null}
                    {customerCpf.replace(/\D/g, "").length === 11 && !validateCPF(customerCpf) && (
                      <p className="text-xs text-destructive mt-1">CPF inválido</p>
                    )}
                    {cpfSearched && !selectedCustomer && validateCPF(customerCpf) && (
                      <p className="text-xs text-amber-600 mt-1">Cliente não encontrado — será cadastrado ao criar o pedido</p>
                    )}
                  </div>
                  {selectedCustomer && (
                    <Badge variant="secondary" className="text-xs">✓ Cliente cadastrado</Badge>
                  )}
                </div>
              </div>

              {/* Delivery Address Section */}
              {orderType === "delivery" && (
                <div className={cn("border rounded-lg bg-muted/30", isMobile ? "p-3" : "p-4", mobileStep !== "dados" && "hidden")}>
                  <p className="text-sm font-medium text-muted-foreground mb-3">Endereço de Entrega</p>

                  {/* No customer data at all */}
                  {!isRegisteredCustomer && !hasTypedCustomerData && (
                    <p className="text-sm text-muted-foreground italic">
                      Preencha o celular ou CPF do cliente para ver os endereços salvos
                    </p>
                  )}

                  {/* Customer data partially filled but not registered — show add address button */}
                  {shouldShowAddAddressButton && (
                    <div>
                      <p className="text-sm text-muted-foreground italic mb-3">Cliente não cadastrado — adicione um endereço</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => { setShowAddressDialog(true); setShowNewAddressForm(true); }}
                      >
                        <Plus className="w-4 h-4 mr-1" /> Adicionar endereço
                      </Button>
                    </div>
                  )}

                  {/* Show selected address for unregistered customer */}
                  {hasManualSelectedAddress && (
                    <div className="space-y-2">
                      <div className="p-3 rounded-lg border bg-primary/10 border-primary text-sm">
                        <div className="flex items-start gap-2">
                          <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 text-primary" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{selectedAddress.street}{selectedAddress.number ? `, ${selectedAddress.number}` : ""}</p>
                            <p className="text-muted-foreground text-xs">{selectedAddress.neighborhood} — {selectedAddress.city}{selectedAddress.state ? ` - ${selectedAddress.state}` : ""}</p>
                            {selectedAddress.complement && <p className="text-muted-foreground text-xs">{selectedAddress.complement}</p>}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => { setShowAddressDialog(true); setShowNewAddressForm(true); }}
                      >
                        <Plus className="w-4 h-4 mr-1" /> Alterar endereço
                      </Button>
                    </div>
                  )}

                  {/* Show all addresses inline for registered customer */}
                  {isRegisteredCustomer && hasSavedAddresses && (
                    <div className="space-y-2">
                      {customerAddresses.map((addr: any) => {
                        const isSelected = selectedAddress?.street === addr.street && selectedAddress?.number === addr.number && selectedAddress?.zip_code === addr.zip_code;
                        return (
                          <div
                            key={addr.id}
                            className={`p-3 rounded-lg border text-sm cursor-pointer transition-colors ${isSelected ? 'bg-primary/10 border-primary' : 'bg-background hover:bg-muted/50'}`}
                            onClick={() => applyAddress({
                              street: addr.street, number: addr.number || "",
                              complement: addr.complement || "", neighborhood: addr.neighborhood || "",
                              city: addr.city || "", state: addr.state || "", zip_code: addr.zip_code || "",
                            })}
                          >
                            <div className="flex items-start gap-2">
                              <MapPin className={`w-4 h-4 mt-0.5 flex-shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium">{addr.street}{addr.number ? `, ${addr.number}` : ""}</p>
                                <p className="text-muted-foreground text-xs">{addr.neighborhood} — {addr.city}{addr.state ? ` - ${addr.state}` : ""}</p>
                                {addr.complement && <p className="text-muted-foreground text-xs">{addr.complement}</p>}
                              </div>
                              {addr.is_default && <Badge variant="secondary" className="text-[10px] flex-shrink-0">Padrão</Badge>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {isRegisteredCustomer && !hasSavedAddresses && (
                    <p className="text-sm text-muted-foreground italic">Nenhum endereço cadastrado</p>
                  )}

                  {isRegisteredCustomer && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full"
                      onClick={() => { fetchCustomerAddresses(); setShowAddressDialog(true); }}
                    >
                      <Plus className="w-4 h-4 mr-1" /> Adicionar novo endereço
                    </Button>
                  )}
                </div>
              )}

              {/* Mesa selector */}
              {orderType === "mesa" && (
                <div className={cn("space-y-3", mobileStep !== "dados" && "hidden")}>
                  <Label className="text-xs font-semibold mb-1.5 block">Mesa</Label>
                  <Select value={selectedTableId} onValueChange={setSelectedTableId}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione uma mesa" /></SelectTrigger>
                    <SelectContent>
                      {tables?.map(t => (
                        <SelectItem key={t.id} value={t.id}>
                          Mesa {t.table_number} {t.is_occupied ? "(Ocupada)" : "(Livre)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Notes */}
              <div className={cn("space-y-1.5", mobileStep !== "dados" && "hidden")}>
                <Label className="text-xs font-semibold mb-1.5 block">Observações</Label>
                <Textarea placeholder="Observações..." value={notes} onChange={e => setNotes(e.target.value)} className="min-h-[50px] text-sm" />
              </div>

              {/* Payment */}
              <div className={cn("space-y-1.5", mobileStep !== "pagamento" && "hidden")}>
                <Label className="text-xs font-semibold mb-1.5 block">Pagamento</Label>
                <Select value={paymentType} onValueChange={(v) => setPaymentType(v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Método de pagamento" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Dinheiro</SelectItem>
                    <SelectItem value="debit">Débito</SelectItem>
                    <SelectItem value="credit">Crédito</SelectItem>
                    <SelectItem value="pix">Pix</SelectItem>
                    <SelectItem value="meal_voucher">Vale Refeição</SelectItem>
                    <SelectItem value="employee_credit">Crédito de Funcionário</SelectItem>
                  </SelectContent>
                </Select>
                {(paymentType === "credit" || paymentType === "debit" || paymentType.startsWith("Crédito") || paymentType.startsWith("Débito")) && (
                  <Select
                    value={paymentType.includes(" - ") ? paymentType : ""}
                    onValueChange={(v) => setPaymentType(v)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Selecione a bandeira do cartão" />
                    </SelectTrigger>
                    <SelectContent>
                      {(paymentType === "credit" || paymentType.startsWith("Crédito")) ? (
                        <>
                          <SelectItem value="Crédito - Visa">Crédito - Visa</SelectItem>
                          <SelectItem value="Crédito - Mastercard">Crédito - Mastercard</SelectItem>
                          <SelectItem value="Crédito - Elo">Crédito - Elo</SelectItem>
                          <SelectItem value="Crédito - Amex">Crédito - Amex</SelectItem>
                          <SelectItem value="Crédito - Hipercard">Crédito - Hipercard</SelectItem>
                          <SelectItem value="Crédito - Diners">Crédito - Diners</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="Débito - Visa">Débito - Visa</SelectItem>
                          <SelectItem value="Débito - Mastercard">Débito - Mastercard</SelectItem>
                          <SelectItem value="Débito - Elo">Débito - Elo</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                )}

                {/* Cash received / change calculation */}
                {paymentType === "cash" && (
                  <div className="space-y-2 border rounded-lg p-3 bg-emerald-50/50">
                    <Label className="text-xs font-medium">Valor recebido (para troco)</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      placeholder="Ex: 100,00"
                      value={cashReceived}
                      onChange={e => setCashReceived(e.target.value)}
                      className="h-9 text-sm"
                    />
                    {(() => {
                      const v = parseFloat((cashReceived || "").replace(",", "."));
                      if (!Number.isFinite(v) || v <= 0) return null;
                      if (v < cartTotal) {
                        return (
                          <p className="text-xs text-muted-foreground">
                            Total do pedido: R$ {cartTotal.toFixed(2).replace(".", ",")}
                          </p>
                        );
                      }
                      const troco = v - cartTotal;
                      return (
                        <div className="text-xs space-y-0.5">
                          <div className="flex justify-between"><span>Total do pedido</span><span>R$ {cartTotal.toFixed(2).replace(".", ",")}</span></div>
                          <div className="flex justify-between"><span>Cliente vai pagar com</span><span>R$ {v.toFixed(2).replace(".", ",")}</span></div>
                          <div className="flex justify-between font-semibold text-emerald-700"><span>TROCO</span><span>R$ {troco.toFixed(2).replace(".", ",")}</span></div>
                        </div>
                      );
                    })()}
                  </div>
                )}


                {/* Employee Credit Fields */}
                {paymentType === "employee_credit" && (
                  <div className="space-y-2 border rounded-lg p-3 bg-amber-50/50">
                    <div className="flex items-center gap-2 text-amber-700 text-xs font-medium">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Este pedido será lançado como crédito pendente.
                    </div>
                    <div>
                      <Label className="text-xs">Nome do Funcionário *</Label>
                      <Input
                        placeholder="Nome do funcionário"
                        value={employeeCreditName}
                        onChange={e => setEmployeeCreditName(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Observação</Label>
                      <Input
                        placeholder="Observação (opcional)"
                        value={employeeCreditNotes}
                        onChange={e => setEmployeeCreditNotes(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Discount Section */}
              {cart.length > 0 && (
                <Collapsible open={discountExpanded} onOpenChange={setDiscountExpanded} className={cn(mobileStep !== "pagamento" && "hidden")}>
                  <div className="border rounded-lg p-4 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-muted-foreground">Desconto</p>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setDiscountExpanded(!discountExpanded)}>
                        {discountExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </div>

                    <CollapsibleContent className="mt-3 space-y-3">
                      {/* Type toggle */}
                      <div className="flex gap-2">
                        <Button
                          variant={discountType === "percentage" ? "default" : "outline"}
                          size="sm" className="flex-1"
                          onClick={() => setDiscountType("percentage")}
                        >
                          %
                        </Button>
                        <Button
                          variant={discountType === "value" ? "default" : "outline"}
                          size="sm" className="flex-1"
                          onClick={() => setDiscountType("value")}
                        >
                          R$
                        </Button>
                      </div>

                      {/* Target selector */}
                      <Select value={discountTarget} onValueChange={setDiscountTarget}>
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder="Aplicar no total do pedido" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="total">Total do pedido</SelectItem>
                          {cart.map(item => (
                            <SelectItem key={item.productId} value={item.productId}>
                              {item.productName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Value input */}
                      <Input
                        type="number"
                        min={0}
                        max={discountType === "percentage" ? 100 : undefined}
                        placeholder={discountType === "percentage" ? "Ex: 10" : "Ex: 15.00"}
                        value={discountValue}
                        onChange={e => setDiscountValue(e.target.value)}
                        className="h-9 text-sm"
                      />

                      {/* Notes */}
                      <Input
                        placeholder="Motivo do desconto (opcional)"
                        value={discountNotes}
                        onChange={e => setDiscountNotes(e.target.value)}
                        className="h-9 text-sm"
                      />
                    </CollapsibleContent>

                    {/* Preview */}
                    {calculatedDiscount > 0 && (
                      <div className="mt-2 flex justify-between text-sm">
                        <span className="text-muted-foreground">Desconto aplicado</span>
                        <span className="text-green-600 font-medium">- R$ {calculatedDiscount.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                </Collapsible>
              )}


              <div className={cn("space-y-3", mobileStep !== "produtos" && "hidden")} data-tour="pdv-products">
                <Label className={cn("text-xs font-semibold mb-1.5 block", isMobile && "hidden")}>Produtos</Label>
                <div className="relative">
                  <Search className={cn("absolute top-1/2 -translate-y-1/2 text-muted-foreground", isMobile ? "left-3 w-4 h-4" : "left-2.5 w-3.5 h-3.5")} />
                  <Input
                    placeholder={isMobile ? "Buscar produto ou código" : "Buscar produto..."}
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className={cn(isMobile ? "pl-10 h-11 text-sm rounded-xl" : "pl-8 h-9 text-sm")}
                  />
                </div>
                <div className={cn(isMobile ? "pr-1" : "max-h-[50vh] min-h-[300px] overflow-y-auto pr-1")}>
                  {(() => {
                    // Group products by category
                    const categoryMap = new Map<string, { name: string; products: typeof filteredProducts }>();
                    const uncategorized: typeof filteredProducts = [];
                    
                    filteredProducts.forEach(product => {
                      const cat = (product as any).categories;
                      if (cat?.id) {
                        if (!categoryMap.has(cat.id)) {
                          categoryMap.set(cat.id, { name: cat.name, products: [] });
                        }
                        categoryMap.get(cat.id)!.products.push(product);
                      } else {
                        uncategorized.push(product);
                      }
                    });

                    const categoriesArr = Array.from(categoryMap.entries());

                    const renderProductDesktop = (product: any) => (
                      <Card
                        key={product.id}
                        className="cursor-pointer hover:shadow-md active:scale-[0.98] transition-all touch-manipulation"
                        onClick={async () => {
                          try {
                            setSelectedProduct(await withProductComplements(product));
                          } catch (error) {
                            console.error("Erro ao carregar complementos:", error);
                            setSelectedProduct(product);
                          }
                          setIsProductDrawerOpen(true);
                        }}
                      >
                        <CardContent className="p-2 space-y-1">
                          {product.image_url ? (
                            <img src={product.image_url} alt={product.name} loading="lazy" className="w-full h-14 object-cover rounded" />
                          ) : (
                            <div className="w-full h-14 bg-muted rounded flex items-center justify-center text-base font-bold text-muted-foreground">
                              {product.name.charAt(0)}
                            </div>
                          )}
                          <p className="text-xs font-medium line-clamp-2 leading-tight">{product.name}</p>
                          <p className="text-xs font-bold text-primary">R$ {product.price.toFixed(2)}</p>
                        </CardContent>
                      </Card>
                    );

                    const renderProductMobile = (product: any) => {
                      const inCart = cart.filter(c => c.productId === product.id).reduce((s, c) => s + c.quantity, 0);
                      return (
                        <button
                          key={product.id}
                          type="button"
                          onClick={async () => {
                            try {
                              setSelectedProduct(await withProductComplements(product));
                            } catch (error) {
                              console.error("Erro ao carregar complementos:", error);
                              setSelectedProduct(product);
                            }
                            setIsProductDrawerOpen(true);
                          }}
                          className="w-full flex items-center gap-3 p-2.5 bg-background border border-border rounded-2xl active:scale-[0.98] active:bg-muted transition-all text-left"
                        >
                          {product.image_url ? (
                            <img src={product.image_url} alt={product.name} loading="lazy" className="w-16 h-16 object-cover rounded-xl flex-shrink-0" />
                          ) : (
                            <div className="w-16 h-16 bg-muted rounded-xl flex items-center justify-center text-xl font-bold text-muted-foreground flex-shrink-0">
                              {product.name.charAt(0)}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold leading-tight line-clamp-2">{product.name}</p>
                            <p className="text-base font-bold text-primary mt-1">R$ {product.price.toFixed(2).replace(".", ",")}</p>
                          </div>
                          <div className="relative flex-shrink-0">
                            <div className="h-11 px-3 rounded-full bg-primary text-primary-foreground flex items-center gap-1 shadow-sm">
                              <Plus className="w-4 h-4" />
                              <span className="text-xs font-bold">Adicionar</span>
                            </div>
                            {inCart > 0 && (
                              <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center shadow">
                                {inCart}
                              </span>
                            )}
                          </div>

                        </button>
                      );
                    };

                    const renderProduct = isMobile ? renderProductMobile : renderProductDesktop;

                    // Mobile: category chips horizontal + filtered list
                    if (isMobile) {
                      const allCats = [
                        { id: "all", name: "Todos" },
                        ...categoriesArr.map(([id, { name }]) => ({ id, name })),
                        ...(uncategorized.length > 0 ? [{ id: "__other", name: "Outros" }] : []),
                      ];
                      const visibleProducts = mobileCategoryFilter === "all"
                        ? filteredProducts
                        : mobileCategoryFilter === "__other"
                          ? uncategorized
                          : (categoryMap.get(mobileCategoryFilter)?.products || []);

                      return (
                        <>
                          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none sticky top-0 bg-background z-10">
                            {allCats.map(c => {
                              const active = mobileCategoryFilter === c.id;
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => setMobileCategoryFilter(c.id)}
                                  className={cn(
                                    "flex-shrink-0 h-9 px-4 rounded-full text-xs font-semibold border transition-all whitespace-nowrap",
                                    active
                                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                      : "bg-background text-foreground border-border active:scale-95"
                                  )}
                                >
                                  {c.name}
                                </button>
                              );
                            })}
                          </div>
                          <div className="space-y-2 mt-2">
                            {visibleProducts.length === 0 ? (
                              <p className="text-sm text-muted-foreground text-center py-8">Nenhum produto</p>
                            ) : (
                              visibleProducts.map(renderProductMobile)
                            )}
                          </div>
                        </>
                      );
                    }

                    return (
                      <>
                        {categoriesArr.map(([catId, { name, products: catProducts }]) => (
                          <div key={catId} className="mb-4">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 bg-muted/50 rounded mb-2 sticky top-0 z-10">
                              {name}
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              {catProducts.map(renderProduct)}
                            </div>
                          </div>
                        ))}
                        {uncategorized.length > 0 && (
                          <div className="mb-4">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 bg-muted/50 rounded mb-2">
                              Outros
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              {uncategorized.map(renderProduct)}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Cart Summary */}
              {cart.length > 0 && (
                <div className={cn("space-y-2 border-t pt-4", mobileStep !== "pagamento" && "hidden")}>
                  <h4 className="font-semibold text-sm flex items-center gap-1.5">
                    <ShoppingCart className="w-4 h-4" /> Carrinho ({cart.length})
                  </h4>
                  {cart.map((item, i) => {
                    const extrasTotal = item.extras.reduce((s, e) => s + e.price, 0);
                    const itemTotal = (item.price + extrasTotal) * item.quantity;
                    return (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">{item.quantity}x</span> {item.productName}
                          {item.extras.length > 0 && (
                            <span className="text-muted-foreground ml-1">(+{item.extras.length})</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">R$ {itemTotal.toFixed(2)}</span>
                          <Button variant="ghost" size="sm" onClick={() => setCart(c => c.filter((_, idx) => idx !== i))} className="h-5 w-5 p-0">
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  <div className="pt-2 border-t space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>Subtotal</span>
                      <span>R$ {cartSubtotal.toFixed(2)}</span>
                    </div>
                    {calculatedDiscount > 0 && (
                      <div className="flex items-center justify-between text-sm text-green-600">
                        <span>Desconto</span>
                        <span>- R$ {calculatedDiscount.toFixed(2)}</span>
                      </div>
                    )}
                    {orderType === "delivery" && (
                      <div className="flex items-center justify-between text-sm">
                        <span>Taxa de entrega</span>
                        <span>{resolvedDeliveryFee > 0 ? `R$ ${resolvedDeliveryFee.toFixed(2)}` : "Grátis"}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between font-bold text-sm">
                      <span>Total</span>
                      <span>R$ {cartTotal.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Footer — desktop step-aware */}
          {!isMobile && (
            <div className="border-t pt-3 mt-2 flex items-center gap-2">
              {mobileStep !== "dados" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMobileStep(mobileStep === "pagamento" ? "produtos" : "dados")}
                >
                  ← Voltar
                </Button>
              )}
              <div className="flex-1 text-xs flex items-center gap-2">
                <ShoppingCart className="w-3.5 h-3.5 inline" />
                <span>
                  {cart.length} ite{cart.length !== 1 ? "ns" : "m"} • <span className="font-bold">R$ {cartTotal.toFixed(2)}</span>
                </span>
              </div>
              {mobileStep === "pagamento" ? (
                <Button size="sm" onClick={handleSubmit} disabled={submitting || cart.length === 0 || !customerName.trim()} data-tour="pdv-confirm">
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Criar Pedido
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => {
                    if (mobileStep === "dados") {
                      if (orderType === "mesa" && !selectedTableId) {
                        toast.error("Selecione uma mesa");
                        return;
                      }
                      if (orderType === "delivery" && !deliveryAddress.trim()) {
                        toast.error("Informe o endereço de entrega");
                        return;
                      }
                      setMobileStep("produtos");
                    } else {
                      setMobileStep("pagamento");
                    }
                  }}
                  disabled={mobileStep === "produtos" && cart.length === 0}
                >
                  Próximo →
                </Button>
              )}
            </div>
          )}

          {/* Footer — mobile step-aware */}
          {isMobile && (
            <div className="shrink-0 border-t pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] flex items-center gap-2">
              {/* Back button */}
              {mobileStep !== "dados" && (
                <Button
                  variant="outline"
                  size="lg"
                  className="h-11 px-3 rounded-xl"
                  onClick={() => setMobileStep(mobileStep === "pagamento" ? "produtos" : "dados")}
                >
                  ←
                </Button>
              )}

              {/* Cart pill */}
              <div className="flex-1 flex items-center gap-2 h-11 px-3 rounded-xl bg-muted min-w-0">
                <ShoppingCart className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] leading-none text-muted-foreground">
                    {cart.length} ite{cart.length !== 1 ? "ns" : "m"}
                  </p>
                  <p className="text-sm font-bold leading-tight truncate">
                    R$ {cartTotal.toFixed(2).replace(".", ",")}
                  </p>
                </div>
              </div>

              {/* Primary CTA */}
              {mobileStep === "pagamento" ? (
                <Button
                  size="lg"
                  className="h-11 px-4 rounded-xl font-bold flex-shrink-0"
                  onClick={handleSubmit}
                  disabled={submitting || cart.length === 0 || !customerName.trim()}
                  data-tour="pdv-confirm"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Criar
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="h-11 px-4 rounded-xl font-bold flex-shrink-0"
                  onClick={() => {
                    if (mobileStep === "dados") {
                      if (orderType === "mesa" && !selectedTableId) {
                        toast.error("Selecione uma mesa");
                        return;
                      }
                      if (orderType === "delivery" && !deliveryAddress.trim()) {
                        toast.error("Informe o endereço de entrega");
                        return;
                      }
                      setMobileStep("produtos");
                    } else {
                      setMobileStep("pagamento");
                    }
                  }}
                  disabled={mobileStep === "produtos" && cart.length === 0}
                >
                  Próximo →
                </Button>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Mobile floating "Novo Pedido" button */}
      {isMobile && !mobileOrderPanelOpen && (
        <Button
          onClick={() => { setMobileStep("dados"); setMobileOrderPanelOpen(true); }}
          className="fixed bottom-24 right-4 z-50 h-14 rounded-full shadow-lg flex items-center gap-2 px-5 md:bottom-4"
          size="lg"
        >
          <ShoppingCart className="w-5 h-5" />
          <span className="font-bold">Novo Pedido</span>
          {cart.length > 0 && (
            <Badge variant="secondary" className="ml-1 h-6 min-w-6 px-1.5">
              {cart.length}
            </Badge>
          )}
        </Button>
      )}

      {/* Product Drawer */}
      <PDVProductDrawer
        product={selectedProduct}
        open={isProductDrawerOpen}
        onClose={() => setIsProductDrawerOpen(false)}
        onAddToCart={handleAddToCart}
      />

      {/* Customer Select */}
      <CustomerSelectDialog
        restaurantId={restaurantId}
        open={isCustomerSelectOpen}
        onOpenChange={setIsCustomerSelectOpen}
        onSelect={handleCustomerSelect}
      />

      {/* Address Dialog */}
      <Dialog open={showAddressDialog} onOpenChange={setShowAddressDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Selecionar Endereço</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {customerAddresses.length > 0 && (
              <div className="space-y-2">
                {customerAddresses.map((addr: any) => (
                  <div
                    key={addr.id}
                    className="p-3 border rounded-lg cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => {
                      applyAddress({
                        street: addr.street, number: addr.number, complement: addr.complement || "",
                        neighborhood: addr.neighborhood, city: addr.city, state: addr.state, zip_code: addr.zip_code,
                      });
                      setShowAddressDialog(false);
                      toast.success("Endereço selecionado!");
                    }}
                  >
                    <p className="text-sm font-medium">{addr.street}, {addr.number}</p>
                    <p className="text-xs text-muted-foreground">{addr.neighborhood} — {addr.city} - {addr.state}</p>
                    {addr.is_default && <Badge variant="secondary" className="text-[10px] mt-1">Padrão</Badge>}
                  </div>
                ))}
              </div>
            )}

            {customerAddresses.length === 0 && !showNewAddressForm && (
              <p className="text-sm text-muted-foreground text-center py-2">Nenhum endereço salvo</p>
            )}

            <Button variant="outline" size="sm" className="w-full" onClick={() => setShowNewAddressForm(!showNewAddressForm)}>
              <Plus className="w-4 h-4 mr-2" /> Novo endereço
            </Button>

            {showNewAddressForm && (
              <div className="space-y-3 border-t pt-3">
                <div>
                  <Label className="text-xs mb-1.5 block">CEP</Label>
                  <Input placeholder="00000-000" value={newAddrCep} onChange={e => handleNewAddrCepLookup(e.target.value)} className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">Rua</Label>
                  <Input placeholder="Rua" value={newAddrStreet} onChange={e => setNewAddrStreet(e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs mb-1.5 block">Número</Label>
                    <Input placeholder="Nº" value={newAddrNumber} onChange={e => setNewAddrNumber(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs mb-1.5 block">Complemento</Label>
                    <Input placeholder="Apto, Bloco..." value={newAddrComplement} onChange={e => setNewAddrComplement(e.target.value)} className="h-9 text-sm" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">Bairro</Label>
                  <Input placeholder="Bairro" value={newAddrNeighborhood} onChange={e => setNewAddrNeighborhood(e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs mb-1.5 block">Cidade</Label>
                    <Input placeholder="Cidade" value={newAddrCity} onChange={e => setNewAddrCity(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs mb-1.5 block">Estado</Label>
                    <Input placeholder="UF" value={newAddrState} onChange={e => setNewAddrState(e.target.value)} className="h-9 text-sm" />
                  </div>
                </div>
                <Button size="sm" onClick={handleSaveNewAddress} className="w-full">
                  Confirmar Endereço
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Table Detail Dialog */}
      <TableDetailDialog
        restaurantId={restaurantId}
        table={selectedTableForDrawer}
        open={!!selectedTableForDrawer}
        onOpenChange={(open) => { if (!open) setSelectedTableForDrawer(null); }}
        onAddOrder={(tableId) => {
          setSelectedTableForDrawer(null);
          setOrderType("mesa");
          setSelectedTableId(tableId);
          if (isMobile) { setMobileStep("dados"); setMobileOrderPanelOpen(true); }
        }}
        onTableCleared={() => refetchTables()}
      />

      {/* Manage Tables Drawer */}
      <ManageTablesDrawer
        restaurantId={restaurantId}
        open={isManageTablesOpen}
        onOpenChange={setIsManageTablesOpen}
        onTablesChanged={() => refetchTables()}
      />
    </div>
  );
};

export default PDVTab;

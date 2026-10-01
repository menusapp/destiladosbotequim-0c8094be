import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/admin/AppSidebar";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { MobileBottomNav } from "@/components/admin/MobileBottomNav";
import { TourProvider, useTour } from "@/components/admin/tour/TourContext";
import { TourOverlay } from "@/components/admin/tour/TourOverlay";
import type { TourSectionId } from "@/components/admin/tour/types";
import { ConfirmDialogProvider } from "@/hooks/useConfirmDialog";

import { lazy, Suspense } from "react";

// Critical tabs loaded eagerly (always visible on first render)
import UnifiedOrdersTab from "@/components/admin/UnifiedOrdersTab";
import PDVTab from "@/components/admin/PDVTab";
import OverviewTab from "@/components/admin/OverviewTab";

// Lazy-loaded tabs (only loaded when user navigates to them)
const MarketingTab = lazy(() => import("@/components/admin/MarketingTab"));
const ReportsTab = lazy(() => import("@/components/admin/ReportsTab").then(m => ({ default: m.ReportsTab })));
const CardapioTab = lazy(() => import("@/components/admin/CardapioTab"));
const TablesTab = lazy(() => import("@/components/admin/TablesTab"));
const StockTab = lazy(() => import("@/components/admin/StockTab"));
const CostosTab = lazy(() => import("@/components/admin/CostosTab"));
const MargensTab = lazy(() => import("@/components/admin/MargensTab"));
const FluxoCaixaTab = lazy(() => import("@/components/admin/FluxoCaixaTab"));
const ClientesTab = lazy(() => import("@/components/admin/ClientesTab"));
const FidelityTab = lazy(() => import("@/components/admin/FidelityTab"));
const FiscalTab = lazy(() => import("@/components/admin/FiscalTab"));
const ContasTab = lazy(() => import("@/components/admin/ContasTab"));
const EquipeTab = lazy(() => import("@/components/admin/EquipeTab"));
const IntegrationsTab = lazy(() => import("@/components/admin/IntegrationsTab"));
const ModulosTab = lazy(() => import("@/components/admin/ModulosTab"));
const CompanyDataSettings = lazy(() => import("@/components/admin/settings/CompanyDataSettings"));
const WhatsAppSettings = lazy(() => import("@/components/admin/settings/WhatsAppSettings"));
const KioskSettings = lazy(() => import("@/components/admin/settings/KioskSettings"));
const KioskUpsellScreen = lazy(() => import("@/components/admin/settings/KioskUpsellScreen"));
const RoboMenusTab = lazy(() => import("@/components/admin/RoboMenusTab"));

import { useInactivityLogout } from "@/hooks/useInactivityLogout";
import { useRestaurantModules } from "@/hooks/useRestaurantModules";

import { BlockedOverlay } from "@/components/admin/BlockedOverlay";
import { NewOrderNotification } from "@/components/admin/NewOrderNotification";
import { NewBillNotification } from "@/components/admin/NewBillNotification";
import { NewReservationNotification } from "@/components/admin/NewReservationNotification";
import { SupportChatWidget } from "@/components/admin/SupportChatWidget";
import { QzOnboardingGate } from "@/components/admin/QzOnboardingGate";
import { GracePeriodBanner } from "@/components/admin/GracePeriodBanner";
import { clearAdminSession } from "@/lib/sessionExpiry";
import { printDocument } from "@/lib/printDispatcher";

// Prefetch map: section → dynamic import. Definido fora do componente para
// evitar recriação a cada render.
const prefetchMap: Record<string, () => Promise<unknown>> = {
  cardapio: () => import("@/components/admin/CardapioTab"),
  estoque: () => import("@/components/admin/StockTab"),
  custos: () => import("@/components/admin/CostosTab"),
  margens: () => import("@/components/admin/MargensTab"),
  caixa: () => import("@/components/admin/FluxoCaixaTab"),
  clientes: () => import("@/components/admin/ClientesTab"),
  fidelidade: () => import("@/components/admin/FidelityTab"),
  marketing: () => import("@/components/admin/MarketingTab"),
  fiscal: () => import("@/components/admin/FiscalTab"),
  integracoes: () => import("@/components/admin/IntegrationsTab"),
  modulos: () => import("@/components/admin/ModulosTab"),
  contas: () => import("@/components/admin/ContasTab"),
  relatorios: () => import("@/components/admin/ReportsTab"),
  "mesas-reservas": () => import("@/components/admin/TablesTab"),
  "config-dados": () => import("@/components/admin/settings/CompanyDataSettings"),
  "config-whatsapp": () => import("@/components/admin/settings/WhatsAppSettings"),
  "config-totem": () => import("@/components/admin/settings/KioskSettings"),
};

interface Restaurant {
  id: string;
  name: string;
  slug: string;
  is_open: boolean;
  prep_time_minutes: number;
  pickup_time_minutes: number;
  auto_open_close?: boolean;
  primary_color?: string;
  show_prep_timer?: boolean;
}

/**
 * Registra a função de troca de aba no TourContext, permitindo que o tour
 * contínuo navegue entre as abas do painel automaticamente.
 */
const TourSectionBridge = ({
  onChangeSection,
}: {
  onChangeSection: (section: string) => void;
}) => {
  const { setSectionChanger } = useTour();
  useEffect(() => {
    setSectionChanger((sectionId: TourSectionId) => onChangeSection(sectionId));
    return () => setSectionChanger(null);
  }, [setSectionChanger, onChangeSection]);
  return null;
};

const RestaurantAdmin = () => {
  const navigate = useNavigate();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  // Ref para evitar stale closure no setInterval do auto open/close
  const restaurantRef = useRef<Restaurant | null>(null);
  useEffect(() => { restaurantRef.current = restaurant; }, [restaurant]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("dashboard");
  const activeSectionRef = useRef(activeSection);
  useEffect(() => { activeSectionRef.current = activeSection; }, [activeSection]);
  const [hasNewOrders, setHasNewOrders] = useState(false);
  const [hasNewBills, setHasNewBills] = useState(false);
  const [hasNewDeliveryOrders, setHasNewDeliveryOrders] = useState(false);
  const [hasNewLocalOrders, setHasNewLocalOrders] = useState(false);
  const [notificationQueue, setNotificationQueue] = useState<Array<{
    orderId: string;
    customerName: string;
    total: number;
    orderType: 'local' | 'delivery' | 'balcao';
    tableNumber?: number;
    deliveryType?: 'delivery' | 'pickup';
    items?: Array<{name: string; quantity: number}>;
    kind?: 'new' | 'modified';
  }>>([]);
  const [cascadeExpanded, setCascadeExpanded] = useState(false);
  const notificationQueueRef = useRef<typeof notificationQueue>([]);
  const [billNotificationQueue, setBillNotificationQueue] = useState<Array<{
    billId: string;
    tableNumber: number;
    total: number;
    customerName: string;
  }>>([]);
  const [billCascadeExpanded, setBillCascadeExpanded] = useState(false);
  const [reservationNotification, setReservationNotification] = useState<{
    reservationId: string;
    customerName: string;
    tableName: string;
    date: string;
    time: string;
    partySize: number;
  } | null>(null);
  const [notifiedOrders, setNotifiedOrders] = useState<Set<string>>(new Set());
  const [notifiedBills, setNotifiedBills] = useState<Set<string>>(new Set());
  const [notifiedReservations, setNotifiedReservations] = useState<Set<string>>(new Set());
  const notifiedOrdersRef = useRef<Set<string>>(new Set());
  const notifiedBillsRef = useRef<Set<string>>(new Set());
  const notifiedReservationsRef = useRef<Set<string>>(new Set());
  const billNotificationQueueRef = useRef<typeof billNotificationQueue>([]);
  const reservationNotificationRef = useRef<typeof reservationNotification>(null);
  const [pendingOrderToOpen, setPendingOrderToOpen] = useState<string | null>(null);
  const [pendingTableToOpen, setPendingTableToOpen] = useState<string | null>(null);

  // Global sound control — MP3 loop
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [soundMuted, setSoundMuted] = useState(false);

  const startGlobalSound = useCallback(() => {
    if (audioRef.current) return; // Already playing
    try {
      const audio = new Audio('/notification-sound.mp3');
      audio.loop = true;
      audio.volume = 0.7;
      audio.play().catch(e => console.error("Erro ao tocar som:", e));
      audioRef.current = audio;
    } catch (e) {
      console.error("Erro ao iniciar som:", e);
    }
  }, []);

  const stopGlobalSound = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
  }, []);

  // Auto-start/stop sound based on ALL notification types (orders, bills, reservations)
  useEffect(() => {
    const hasAnyNotification =
      notificationQueue.length > 0 ||
      billNotificationQueue.length > 0 ||
      reservationNotification !== null;

    if (hasAnyNotification && !soundMuted) {
      startGlobalSound();
    } else {
      stopGlobalSound();
    }
  }, [
    notificationQueue.length,
    billNotificationQueue.length,
    reservationNotification,
    soundMuted,
    startGlobalSound,
    stopGlobalSound,
  ]);

  // Reset mute when ALL notifications cleared
  useEffect(() => {
    if (
      notificationQueue.length === 0 &&
      billNotificationQueue.length === 0 &&
      reservationNotification === null
    ) {
      setSoundMuted(false);
    }
  }, [notificationQueue.length, billNotificationQueue.length, reservationNotification]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopGlobalSound();
  }, [stopGlobalSound]);
  
  // Sync refs with state to avoid stale closure in realtime callback
  useEffect(() => {
    notifiedOrdersRef.current = notifiedOrders;
  }, [notifiedOrders]);
  
  useEffect(() => {
    notifiedBillsRef.current = notifiedBills;
  }, [notifiedBills]);
  
  useEffect(() => {
    notifiedReservationsRef.current = notifiedReservations;
  }, [notifiedReservations]);
  
  useEffect(() => {
    notificationQueueRef.current = notificationQueue;
  }, [notificationQueue]);
  
  useEffect(() => {
    billNotificationQueueRef.current = billNotificationQueue;
  }, [billNotificationQueue]);

  useEffect(() => {
    reservationNotificationRef.current = reservationNotification;
  }, [reservationNotification]);
  
  useInactivityLogout();
  const { isSectionAllowed, hasActiveSubscription, allowedModules, planName, isDelinquent, loaded: modulesLoaded } = useRestaurantModules(restaurant?.id || null);
  const isTotemUnlocked = Array.isArray(allowedModules) && allowedModules.includes("totem");

  // No longer force modulos — overlays handle blocked access now

  // Read staff data from localStorage
  const staffRole = localStorage.getItem('staff_role') || '';
  const staffAllowedSections: string[] = (() => {
    try {
      return JSON.parse(localStorage.getItem('staff_allowed_sections') || '[]');
    } catch { return []; }
  })();

  useEffect(() => {
    const restaurantId = localStorage.getItem('restaurant_id');
    const restaurantName = localStorage.getItem('restaurant_name');
    const staffId = localStorage.getItem('staff_id');
    
    if (!restaurantId || !restaurantName) {
      toast.error("Você precisa estar logado para acessar esta página");
      navigate("/login");
      return;
    }

    // If no staff session, redirect to staff login
    if (!staffId) {
      const slug = localStorage.getItem("restaurant_slug") || "";
      navigate(`/login/staff`);
      return;
    }

    fetchRestaurant(restaurantId);
    return setupNotifications(restaurantId);
  }, [navigate]);

  const setupNotifications = (restaurantId: string) => {
    // Load notified orders from localStorage
    const stored = localStorage.getItem("notifiedGlobalOrders");
    if (stored) {
      const storedSet = new Set<string>(JSON.parse(stored));
      setNotifiedOrders(storedSet);
      notifiedOrdersRef.current = storedSet;
    }

    // Shared handler used by INSERT (new order) and UPDATE (scheduled → pending promotion)
    const handleNewOrderNotification = async (order: any) => {
      const orderRestaurantId = order.restaurant_id;
      const orderType = order.order_type;
      const orderId = order.id;
      const status = order.status;
      const activeLocalStatuses = ['pending', 'accepted', 'preparing'];
      const shouldNotify =
        status === 'pending' ||
        (order.order_channel === 'totem' && ['accepted', 'preparing'].includes(status)) ||
        (order.order_type === 'local' && activeLocalStatuses.includes(status)) ||
        (order.pdv_source === true && activeLocalStatuses.includes(status));

      const staffRoleLS = localStorage.getItem('staff_role') || '';
      const receivesRaw = localStorage.getItem('staff_receives_order_notifications');
      const receivesNotifications = staffRoleLS === 'admin' || receivesRaw === null || receivesRaw === 'true';

      if (orderRestaurantId !== restaurantId || !shouldNotify || !receivesNotifications) return;
      if (notifiedOrdersRef.current.has(orderId)) return;

      {
        const updated = new Set(notifiedOrdersRef.current);
        updated.add(orderId);
        notifiedOrdersRef.current = updated;
        try {
          localStorage.setItem("notifiedGlobalOrders", JSON.stringify(Array.from(updated)));
        } catch {}
      }

      await new Promise(r => setTimeout(r, 1500));

      const fetchOrderWithRetry = async (retries = 4): Promise<any> => {
        const { data: orderData } = await supabase
          .from('orders')
          .select(`
            *,
            order_items(
              price_at_order,
              quantity,
              order_item_extras(price_at_order, extra_name, product_extras(name))
            )
          `)
          .eq('id', orderId)
          .single();
        if (orderData && (!orderData.order_items || orderData.order_items.length === 0) && retries > 0) {
          await new Promise(r => setTimeout(r, 800));
          return fetchOrderWithRetry(retries - 1);
        }
        return orderData;
      };

      const orderData = await fetchOrderWithRetry();

      if (orderData) {
        const itemsTotal = orderData.order_items.reduce((sum: number, item: any) => {
          const extrasTotal = item.order_item_extras?.reduce((s: number, e: any) => s + e.price_at_order, 0) || 0;
          return sum + (item.price_at_order + extrasTotal) * item.quantity;
        }, 0);
        const total = itemsTotal + (orderData.delivery_fee || 0);

        let tableNumber: number | undefined;
        if (order.table_id) {
          const { data: tableData } = await supabase
            .from('tables')
            .select('table_number')
            .eq('id', order.table_id)
            .single();
          tableNumber = tableData?.table_number;
        }

        const { data: orderItems } = await supabase
          .from('order_items')
          .select('quantity, products(name)')
          .eq('order_id', orderId)
          .limit(5);

        const items = orderItems?.map((oi: any) => ({
          name: oi.products?.name || 'Item',
          quantity: oi.quantity,
        })) || [];

        const newNotification = {
          orderId: orderId,
          customerName: order.customer_name,
          total,
          orderType: (orderType === 'balcao' ? 'balcao' : orderType === 'delivery' ? 'delivery' : 'local') as 'local' | 'delivery' | 'balcao',
          tableNumber,
          deliveryType: order.delivery_type as 'delivery' | 'pickup' | undefined,
          items,
        };
        setNotificationQueue(prev => [...prev, newNotification]);

        // ---------- Impressão automática na CHEGADA do pedido ----------
        // Só vale para pedidos que já chegam aceitos (totem, PDV, mesa): esses
        // nunca passam pelo botão "Aceitar", então se não imprimirem aqui não
        // imprimem em lugar nenhum.
        //
        // Pedido que chega como "pending" NÃO imprime aqui: ele imprime quando o
        // operador aceita (useOrderStatusAdvance). Imprimir nos dois lugares
        // sairia em duas vias, e imprimir na chegada significaria gastar bobina
        // com pedido que ainda pode ser recusado.
        if (status !== 'pending') {
          try {
            const { data: printerCfg, error: printerErr } = await supabase
              .from('printer_settings')
              .select('auto_print_orders')
              .eq('restaurant_id', restaurantId)
              .maybeSingle();
            if (printerErr) {
              console.error('[auto-print] falha ao ler auto_print_orders:', printerErr);
            } else if (printerCfg?.auto_print_orders) {
              // showToasts: true — sucesso continua silencioso, falha aparece.
              printDocument(orderData as any, restaurantId, { showToasts: true })
                .catch(err => console.error('[auto-print] erro:', err));
            }
          } catch (err) {
            console.error('[auto-print] falha inesperada:', err);
          }
        }

        setNotifiedOrders(new Set(notifiedOrdersRef.current));
      }

      if ((orderType === 'delivery' || orderType === 'balcao') && activeSectionRef.current !== 'pedidos') {
        setHasNewDeliveryOrders(true);
      } else if ((orderType === 'local' || !orderType) && activeSectionRef.current !== 'pdv') {
        setHasNewLocalOrders(true);
      }
    };

    // Canal para novos pedidos
    const ordersChannel = supabase
      .channel(`new-orders-${restaurantId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'orders',
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        async (payload) => {
          // Scheduled iFood orders enter with status='scheduled' and must NOT
          // trigger sound/popup until the scheduler promotes them to 'pending'.
          await handleNewOrderNotification(payload.new);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        async (payload) => {
          const order = payload.new as any;
          const orderId = order.id;
          const status = order.status;

          // Promotion of a previously-scheduled order: fire the regular new-order flow.
          if (status === 'pending' && !notifiedOrdersRef.current.has(orderId)) {
            await handleNewOrderNotification(order);
            return;
          }

          const keepTotemNotification = order.order_channel === 'totem' && ['accepted', 'preparing'].includes(status);
          const keepLocalNotification = order.order_type === 'local' && ['pending', 'accepted', 'preparing'].includes(status);

          if (!keepTotemNotification && !keepLocalNotification && status !== 'pending') {
            setNotificationQueue(prev => prev.filter(n => n.orderId !== orderId));
          }
        }
      )
      .subscribe();


    // Canal para novas contas
    const billsChannel = supabase
      .channel(`new-bills-${restaurantId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bills',
        },
        async (payload) => {
          const bill = payload.new as any;
          const billId = bill.id;
          
          // Verificar se já foi notificado
          if (notifiedBillsRef.current.has(billId)) return;
          
          // Verificar se a conta é do restaurante atual através da mesa
          const { data: tableData } = await supabase
            .from('tables')
            .select('restaurant_id, table_number')
            .eq('id', bill.table_id)
            .single();
            
          if (tableData?.restaurant_id === restaurantId && bill.status === 'requested') {
            // Buscar nome do cliente da comanda que solicitou a conta
            let customerName = 'Cliente';
            if (bill.comanda_id) {
              const { data: comandaData } = await supabase
                .from('comandas')
                .select('customer_name')
                .eq('id', bill.comanda_id)
                .maybeSingle();
              if (comandaData?.customer_name) customerName = comandaData.customer_name;
            } else {
              const { data: comandaData } = await supabase
                .from('comandas')
                .select('customer_name')
                .eq('table_id', bill.table_id)
                .eq('status', 'active')
                .maybeSingle();
              if (comandaData?.customer_name) customerName = comandaData.customer_name;
            }
            
            // Mostrar notificação pop-up
            setBillNotificationQueue(prev => {
              if (prev.some(b => b.billId === billId)) return prev;
              return [...prev, {
                billId: billId,
                tableNumber: tableData.table_number,
                total: bill.total_amount,
                customerName,
              }];
            });
            
            // Marcar como notificado
            const updated = new Set(notifiedBillsRef.current);
            updated.add(billId);
            notifiedBillsRef.current = updated;
            setNotifiedBills(updated);
            
            // Atualizar badge
            if (activeSection !== 'pedidos') {
              setHasNewBills(true);
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'bills',
        },
        (payload) => {
          const bill = payload.new as any;
          const billId = bill.id;
          const status = bill.status;
          
          // Se a conta foi atualizada (não mais requested), remover da fila
          if (status !== 'requested') {
            setBillNotificationQueue(prev => prev.filter(b => b.billId !== billId));
          }
        }
      )
      .subscribe();

    // Canal para novas reservas (filtrado por restaurant_id no servidor)
    const reservationsChannel = supabase
      .channel(`new-reservations-${restaurantId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'reservations',
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        async (payload) => {
          const reservation = payload.new as any;
          const reservationId = reservation.id;
          
          // Verificar se já foi notificado
          if (notifiedReservationsRef.current.has(reservationId)) return;
          
          // Verificar se é do restaurante atual e está pendente
          if (reservation.restaurant_id === restaurantId && reservation.status === 'pending') {
            // Buscar dados da mesa
            const { data: tableData } = await supabase
              .from('tables')
              .select('table_name, table_number')
              .eq('id', reservation.table_id)
              .single();
            
            setReservationNotification({
              reservationId: reservationId,
              customerName: reservation.customer_name,
              tableName: tableData?.table_name || `Mesa ${tableData?.table_number || '?'}`,
              date: reservation.reservation_date,
              time: reservation.reservation_time,
              partySize: reservation.party_size,
            });
            
            // Marcar como notificado
            const updated = new Set(notifiedReservationsRef.current);
            updated.add(reservationId);
            notifiedReservationsRef.current = updated;
            setNotifiedReservations(updated);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'reservations',
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload) => {
          const reservation = payload.new as any;
          const reservationId = reservation.id;
          const status = reservation.status;
          
          // Se a reserva foi confirmada/cancelada, fechar notificação
          if (reservationNotificationRef.current && 
              reservationNotificationRef.current.reservationId === reservationId && 
              status !== 'pending') {
            setReservationNotification(null);
          }
        }
      )
      .subscribe();

    // Realtime para status is_open do restaurante (canal único por restaurante para evitar colisão entre abas)
    const restaurantChannel = supabase
      .channel(`restaurant-status-sync-${restaurantId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'restaurants',
        filter: `id=eq.${restaurantId}`,
      }, (payload) => {
        const updated = payload.new as any;
        if (updated.is_open !== undefined) {
          setRestaurant(prev => prev ? { ...prev, is_open: updated.is_open } : null);
        }
      })
      .subscribe();

    // Canal de broadcast para alterações em pedidos existentes
    // (itens adicionados/removidos via PDV / OrderDetailModal / Mesa).
    const orderModificationsChannel = supabase
      .channel(`order-modifications-${restaurantId}`)
      .on('broadcast', { event: 'order-modified' }, async (payload) => {
        try {
          const data = (payload as any).payload || {};
          const orderId: string | undefined = data.orderId;
          const actorId: string | undefined = data.actorId;
          if (!orderId) return;

          // Respeita preferência de notificações do staff
          const staffRoleLS = localStorage.getItem('staff_role') || '';
          const receivesRaw = localStorage.getItem('staff_receives_order_notifications');
          const receivesNotifications = staffRoleLS === 'admin' || receivesRaw === null || receivesRaw === 'true';
          if (!receivesNotifications) return;

          // Não notifica quem fez a alteração
          const myStaffId = localStorage.getItem('staff_id') || localStorage.getItem('restaurant_id');
          if (actorId && myStaffId && actorId === myStaffId) return;

          // Buscar dados do pedido
          const { data: orderData } = await supabase
            .from('orders')
            .select(`
              id, customer_name, order_type, delivery_type, table_id, delivery_fee, restaurant_id,
              order_items(price_at_order, quantity, products(name), order_item_extras(price_at_order))
            `)
            .eq('id', orderId)
            .maybeSingle();

          if (!orderData || orderData.restaurant_id !== restaurantId) return;

          const itemsTotal = (orderData.order_items || []).reduce((sum: number, item: any) => {
            const extrasTotal = (item.order_item_extras || []).reduce((s: number, e: any) => s + Number(e.price_at_order || 0), 0);
            return sum + (Number(item.price_at_order || 0) + extrasTotal) * Number(item.quantity || 0);
          }, 0);
          const total = itemsTotal + Number((orderData as any).delivery_fee || 0);

          let tableNumber: number | undefined;
          if (orderData.table_id) {
            const { data: tableData } = await supabase
              .from('tables')
              .select('table_number')
              .eq('id', orderData.table_id)
              .maybeSingle();
            tableNumber = tableData?.table_number;
          }

          const items = (orderData.order_items || []).slice(0, 5).map((oi: any) => ({
            name: oi.products?.name || 'Item',
            quantity: oi.quantity,
          }));

          const orderType = (orderData.order_type === 'balcao'
            ? 'balcao'
            : orderData.order_type === 'delivery'
              ? 'delivery'
              : 'local') as 'local' | 'delivery' | 'balcao';

          setNotificationQueue(prev => {
            // Substitui notificação "modified" anterior do mesmo pedido (evita empilhar)
            const filtered = prev.filter(n => !(n.orderId === orderId && n.kind === 'modified'));
            return [
              ...filtered,
              {
                orderId,
                customerName: orderData.customer_name,
                total,
                orderType,
                tableNumber,
                deliveryType: (orderData as any).delivery_type as 'delivery' | 'pickup' | undefined,
                items,
                kind: 'modified',
              },
            ];
          });
        } catch (e) {
          console.warn('order-modified handler error:', e);
        }
      })
      .subscribe();

    // ------------------------------------------------------------------
    // VIGIA POR POLLING: no modelo de sessão por token, o Realtime não
    // recebe eventos de tabelas protegidas por RLS (o token não trafega no
    // websocket) — por isso o pop-up + som de pedido novo pararam. Este
    // vigia consulta a cada 10s e alimenta o MESMO fluxo de notificação
    // dos canais acima. A deduplicação (notifiedOrdersRef/notifiedBillsRef/
    // notifiedReservationsRef) garante que canais e polling coexistam sem
    // avisar duas vezes.
    // ------------------------------------------------------------------
    const handleNewBillNotification = async (bill: any) => {
      const billId = bill.id;
      if (notifiedBillsRef.current.has(billId)) return;
      if (bill.status !== 'requested') return;

      const { data: tableData } = await supabase
        .from('tables')
        .select('restaurant_id, table_number')
        .eq('id', bill.table_id)
        .maybeSingle();
      if (tableData?.restaurant_id !== restaurantId) return;

      let customerName = 'Cliente';
      if (bill.comanda_id) {
        const { data: comandaData } = await supabase
          .from('comandas')
          .select('customer_name')
          .eq('id', bill.comanda_id)
          .maybeSingle();
        if (comandaData?.customer_name) customerName = comandaData.customer_name;
      } else {
        const { data: comandaData } = await supabase
          .from('comandas')
          .select('customer_name')
          .eq('table_id', bill.table_id)
          .eq('status', 'active')
          .maybeSingle();
        if (comandaData?.customer_name) customerName = comandaData.customer_name;
      }

      setBillNotificationQueue(prev => {
        if (prev.some(b => b.billId === billId)) return prev;
        return [...prev, {
          billId,
          tableNumber: tableData.table_number,
          total: bill.total_amount,
          customerName,
        }];
      });

      const updatedBills = new Set(notifiedBillsRef.current);
      updatedBills.add(billId);
      notifiedBillsRef.current = updatedBills;
      setNotifiedBills(updatedBills);
      if (activeSectionRef.current !== 'pedidos') setHasNewBills(true);
    };

    let notificationPollBusy = false;
    const pollForNotifications = async () => {
      if (notificationPollBusy || document.visibilityState !== 'visible') return;
      notificationPollBusy = true;
      try {
        const sinceISO = new Date(Date.now() - 30 * 60 * 1000).toISOString();

        // Pedidos novos — o handler aplica as mesmas regras/dedup do canal.
        const { data: recentOrders } = await supabase
          .from('orders')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .in('status', ['pending', 'accepted', 'preparing'])
          .gte('created_at', sinceISO)
          .order('created_at', { ascending: true });
        for (const o of recentOrders || []) {
          if (!notifiedOrdersRef.current.has(o.id)) {
            await handleNewOrderNotification(o);
          }
        }

        // Contas solicitadas na mesa.
        const { data: recentBills } = await supabase
          .from('bills')
          .select('*')
          .eq('status', 'requested')
          .gte('created_at', sinceISO);
        for (const b of recentBills || []) {
          await handleNewBillNotification(b);
        }

        // Reservas pendentes (notificação é única — uma por vez).
        const { data: recentReservations } = await supabase
          .from('reservations')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .eq('status', 'pending')
          .gte('created_at', sinceISO);
        for (const r of recentReservations || []) {
          if (notifiedReservationsRef.current.has(r.id)) continue;
          const { data: tableData } = await supabase
            .from('tables')
            .select('table_name, table_number')
            .eq('id', r.table_id)
            .maybeSingle();
          setReservationNotification({
            reservationId: r.id,
            customerName: r.customer_name,
            tableName: tableData?.table_name || `Mesa ${tableData?.table_number || '?'}`,
            date: r.reservation_date,
            time: r.reservation_time,
            partySize: r.party_size,
          });
          const updatedRes = new Set(notifiedReservationsRef.current);
          updatedRes.add(r.id);
          notifiedReservationsRef.current = updatedRes;
          setNotifiedReservations(updatedRes);
          break;
        }
      } catch (e) {
        console.warn('[notification-poll] erro:', e);
      } finally {
        notificationPollBusy = false;
      }
    };
    pollForNotifications();
    const notificationPollTimer = setInterval(pollForNotifications, 10000);

    return () => {
      clearInterval(notificationPollTimer);
      supabase.removeChannel(ordersChannel);
      supabase.removeChannel(billsChannel);
      supabase.removeChannel(reservationsChannel);
      supabase.removeChannel(restaurantChannel);
      supabase.removeChannel(orderModificationsChannel);
    };
  };

  useEffect(() => {
    if (activeSection === 'pedidos') {
      setHasNewOrders(false);
      setHasNewBills(false);
      setHasNewDeliveryOrders(false);
    }
    if (activeSection === 'pdv') {
      setHasNewLocalOrders(false);
    }
  }, [activeSection]);

  const fetchRestaurant = async (restaurantId: string) => {
    try {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name, slug, is_open, prep_time_minutes, pickup_time_minutes, auto_open_close, primary_color, show_prep_timer")
        .eq("id", restaurantId)
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("Restaurante não encontrado");

      setRestaurant(data);
      localStorage.setItem("restaurant_id", data.id);
      localStorage.setItem("restaurant_name", data.name);
      localStorage.setItem("restaurant_slug", data.slug);
      
      // Verificar horário automaticamente após carregar restaurante
      if (data.auto_open_close) {
        checkAndUpdateOpenStatus(data);
      }
    } catch (error) {
      console.error("Erro ao carregar dados do restaurante:", error);
      clearAdminSession();
      toast.error("Erro ao carregar dados do restaurante");
      navigate("/login", { replace: true });
    } finally {
      setLoading(false);
    }
  };

  // Função para verificar e atualizar status de abertura baseado no horário
  const checkAndUpdateOpenStatus = async (restaurantData: Restaurant) => {
    if (!restaurantData.auto_open_close) return;

    try {
      // Buscar horários de funcionamento
      const { data: hours, error } = await supabase
        .from('business_hours')
        .select('day_of_week, is_open, open_time, close_time')
        .eq('restaurant_id', restaurantData.id);

      if (error) throw error;

      const now = new Date();
      const currentDay = now.getDay(); // 0 = Domingo, 6 = Sábado
      const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"

      // Encontrar configuração do dia atual
      const todayConfig = hours?.find(h => h.day_of_week === currentDay);

      let shouldBeOpen = false;

      if (todayConfig && todayConfig.is_open && todayConfig.open_time && todayConfig.close_time) {
        // Verificar se está dentro do horário de funcionamento
        shouldBeOpen = currentTime >= todayConfig.open_time && currentTime < todayConfig.close_time;
      }

      // Só atualizar se o status atual for diferente do esperado
      if (restaurantData.is_open !== shouldBeOpen) {
        const { error: updateError } = await supabase
          .from('restaurants')
          .update({ is_open: shouldBeOpen })
          .eq('id', restaurantData.id);

        if (!updateError) {
          setRestaurant(prev => prev ? { ...prev, is_open: shouldBeOpen } : null);
        }
      }
    } catch (error) {
      console.error('Erro ao verificar horário:', error);
    }
  };

  // Verificar horário a cada minuto quando automação está ativa.
  // Usa restaurantRef para evitar stale closure: o intervalo lê sempre o
  // valor mais recente de restaurant sem precisar ser recriado a cada update.
  useEffect(() => {
    if (!restaurant?.auto_open_close) return;

    const interval = setInterval(() => {
      if (restaurantRef.current) checkAndUpdateOpenStatus(restaurantRef.current);
    }, 60000); // A cada 1 minuto

    return () => clearInterval(interval);
  }, [restaurant?.id, restaurant?.auto_open_close]);

  const handleLogout = () => {
    // Limpa toda a sessão admin (restaurante + funcionário + timestamp).
    // clearAdminSession cobre todas as chaves; o handler antigo esquecia várias.
    clearAdminSession();
    toast.success("Logout realizado com sucesso");
    navigate("/login/staff");
  };

  const handleToggleRestaurant = async (isOpen: boolean) => {
    
    const { error } = await supabase
      .from("restaurants")
      .update({ is_open: isOpen })
      .eq("id", restaurant!.id);

    if (error) {
      console.error('Erro ao atualizar:', error);
      toast.error("Erro ao atualizar status do restaurante");
      return;
    }

    setRestaurant({ ...restaurant!, is_open: isOpen });
    toast.success(isOpen ? "Restaurante aberto!" : "Restaurante fechado!");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  if (!restaurant) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Sem sessão ativa</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Faça login para acessar o painel do restaurante.
            </p>
            <Button onClick={() => navigate("/login")}>Ir para Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleViewOrder = async () => {
    const currentNotification = notificationQueue[0];
    if (!currentNotification) return;
    
    // Local orders go to PDV and auto-open the table
    if (currentNotification.orderType === 'local') {
      // Fetch table_id from the order
      const { data: orderData } = await supabase
        .from("orders")
        .select("table_id")
        .eq("id", currentNotification.orderId)
        .single();
      
      setActiveSection('pdv');
      if (orderData?.table_id) {
        setPendingTableToOpen(orderData.table_id);
      }
    } else {
      setActiveSection('pedidos');
      setPendingOrderToOpen(currentNotification.orderId);
    }
    setNotificationQueue(prev => prev.slice(1));
  };

  const handleViewBill = async (bill: { billId: string; tableNumber: number }) => {
    const { data: tableData } = await supabase
      .from("tables")
      .select("id")
      .eq("table_number", bill.tableNumber)
      .eq("restaurant_id", restaurant!.id)
      .single();
    
    setActiveSection('pdv');
    if (tableData?.id) {
      setPendingTableToOpen(tableData.id);
    }
    setBillNotificationQueue(prev => prev.filter(b => b.billId !== bill.billId));
  };

  const handleViewReservation = () => {
    if (!reservationNotification) return;

    // Navegar para mesas e reservas
    setActiveSection('mesas-reservas');

    // Fechar notificação
    setReservationNotification(null);
  };

  // prefetchMap movido para o escopo do módulo (acima do componente).
  const handlePrefetch = (sectionId: string) => {
    prefetchMap[sectionId]?.();
  };

  // Section wrapper that adds blur overlay for blocked sections
  const SectionWrapper = ({ sectionId, children, onNavigateToPlans: navToPlans }: { sectionId: string; restaurantId: string; staffRole: string; staffAllowedSections: string[]; children: React.ReactNode; onNavigateToPlans: () => void }) => {
    // While subscription/modules are still loading, render a neutral placeholder
    // for plan-gated sections to avoid a flash of unrestricted UI.
    if (!modulesLoaded) {
      return (
        <div className="min-h-[400px] flex items-center justify-center">
          <div className="h-8 w-8 rounded-full border-2 border-muted border-t-primary animate-spin" aria-label="Carregando" />
        </div>
      );
    }

    const access = (() => {
      const isStaffOk = (id: string) => {
        if (!staffRole || staffRole === "admin") return true;
        return staffAllowedSections?.includes(id) ?? false;
      };
      if (!isSectionAllowed(sectionId)) return { blocked: true, reason: 'plan' as const };
      if (!isStaffOk(sectionId)) return { blocked: true, reason: 'permission' as const };
      return { blocked: false, reason: null };
    })();

    if (!access.blocked) return <>{children}</>;

    return (
      <div className="relative min-h-[400px]">
        <div className="pointer-events-none select-none" style={{ filter: 'blur(8px)' }}>
          {children}
        </div>
        <BlockedOverlay reason={access.reason!} onNavigateToPlans={navToPlans} />
      </div>
    );
  };


  const renderContent = () => {
    const content = (() => {
      switch (activeSection) {
        case "visao-geral":
          return <OverviewTab restaurantId={restaurant.id} />;
        case "pedidos":
          return <UnifiedOrdersTab restaurantId={restaurant.id} pendingOrderToOpen={pendingOrderToOpen} onOrderOpened={() => setPendingOrderToOpen(null)} showPrepTimer={restaurant.show_prep_timer !== false} />;
        case "pdv":
          return <PDVTab restaurantId={restaurant.id} restaurantSlug={restaurant.slug} pendingTableToOpen={pendingTableToOpen} onTableOpened={() => setPendingTableToOpen(null)} showPrepTimer={restaurant.show_prep_timer !== false} />;
        case "mesas-reservas":
          return <TablesTab restaurantId={restaurant.id} />;
        case "cardapio":
          return <CardapioTab restaurantId={restaurant.id} isRestaurantOpen={restaurant.is_open} />;
        case "caixa":
          return <FluxoCaixaTab restaurantId={restaurant.id} />;
        case "estoque":
          return <StockTab restaurantId={restaurant.id} />;
        case "custos":
          return <CostosTab restaurantId={restaurant.id} />;
        case "margens":
          return <MargensTab restaurantId={restaurant.id} />;
        case "relatorios":
          return <ReportsTab restaurantId={restaurant.id} />;
        case "clientes":
          return <ClientesTab restaurantId={restaurant.id} />;
        case "fidelidade":
          return <FidelityTab restaurantId={restaurant.id} />;
        case "marketing":
          return <MarketingTab restaurantId={restaurant.id} onNavigateToWhatsApp={() => setActiveSection("config-whatsapp")} />;
        case "robo-menus":
          return <RoboMenusTab restaurantId={restaurant.id} />;
        case "fiscal":
          return <FiscalTab restaurantId={restaurant.id} />;
        case "integracoes":
          return <IntegrationsTab restaurantId={restaurant.id} />;
        case "modulos":
          return <ModulosTab restaurantId={restaurant.id} />;
        case "contas":
          return <ContasTab restaurantId={restaurant.id} />;
        case "equipe":
          return <EquipeTab restaurantId={restaurant.id} planName={planName} onNavigateToPlans={() => setActiveSection("modulos")} />;
        case "config-dados":
          return <CompanyDataSettings restaurantId={restaurant.id} />;
        case "config-whatsapp":
          return <WhatsAppSettings restaurantId={restaurant.id} />;
        case "config-totem":
          return isTotemUnlocked
            ? <KioskSettings restaurantId={restaurant.id} />
            : <KioskUpsellScreen />;
        default:
          return <OverviewTab restaurantId={restaurant.id} />;
      }
    })();

    return <SectionWrapper sectionId={activeSection} restaurantId={restaurant.id} staffRole={staffRole} staffAllowedSections={staffAllowedSections} onNavigateToPlans={() => setActiveSection("modulos")}>{content}</SectionWrapper>;
  };

  return (
    <ConfirmDialogProvider>
    <TourProvider>
    <TourSectionBridge onChangeSection={setActiveSection} />
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        {/* Sidebar — hidden on mobile (replaced by bottom nav) */}
        <div className="hidden md:block">
          <AppSidebar 
            activeSection={activeSection}
            onSectionChange={setActiveSection}
            hasNewOrders={hasNewOrders}
            hasNewBills={hasNewBills}
            hasNewDeliveryOrders={hasNewDeliveryOrders}
            hasNewLocalOrders={hasNewLocalOrders}
            isSectionAllowed={isSectionAllowed}
            hasActiveSubscription={hasActiveSubscription}
            staffRole={staffRole}
            staffAllowedSections={staffAllowedSections}
            primaryColor={restaurant.primary_color}
            onPrefetch={handlePrefetch}
          />
        </div>
        <SidebarInset className="flex-1 flex flex-col">
          <GracePeriodBanner
            restaurantId={restaurant.id}
            onRegularize={() => setActiveSection("modulos")}
          />
          <AdminHeader
            restaurantId={restaurant.id}
            restaurantSlug={restaurant.slug}
            prepTime={restaurant.prep_time_minutes}
            pickupTime={restaurant.pickup_time_minutes}
            isOpen={restaurant.is_open}
            autoOpenClose={restaurant.auto_open_close}
            activeSection={activeSection}
            onPrepTimeUpdate={(time) => setRestaurant({ ...restaurant, prep_time_minutes: time })}
            onPickupTimeUpdate={(time) => setRestaurant({ ...restaurant, pickup_time_minutes: time })}
            onIsOpenUpdate={(isOpen) => setRestaurant({ ...restaurant, is_open: isOpen })}
          />
          <main className="admin-panel flex-1 overflow-auto p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-4">
            {isDelinquent ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
                <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                  <span className="text-3xl">⚠️</span>
                </div>
                <h2 className="text-xl font-bold text-foreground">Assinatura Inadimplente</h2>
                <p className="text-muted-foreground max-w-md">
                  Seu pagamento não foi identificado. Por favor, regularize sua assinatura para continuar usando o sistema.
                </p>
                <p className="text-sm text-muted-foreground">
                  Caso já tenha pago, aguarde alguns minutos para a confirmação automática.
                </p>
              </div>
            ) : (
              <Suspense fallback={
                <div className="space-y-6 p-2">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-48 animate-pulse rounded-md bg-muted" />
                    <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    {[1,2,3].map(i => (
                      <div key={i} className="h-32 animate-pulse rounded-xl bg-muted" />
                    ))}
                  </div>
                  <div className="h-64 animate-pulse rounded-xl bg-muted" />
                </div>
              }>
                {renderContent()}
              </Suspense>
            )}
          </main>
        </SidebarInset>

        {/* Global Order Notifications - iPhone-style cascade */}
        {notificationQueue.length > 0 && (
          <div className="fixed top-4 right-4 z-[100]">
            {!cascadeExpanded ? (
              /* Collapsed: stacked cards behind the front one */
              <div
                className="relative cursor-pointer"
                onClick={() => setCascadeExpanded(true)}
                style={{ height: `${68 + Math.min(notificationQueue.length - 1, 2) * 8}px` }}
              >
                {notificationQueue.slice(0, 3).map((notification, index) => (
                  <div
                    key={notification.orderId}
                    className="absolute right-0 transition-all duration-200"
                    style={{
                      top: `${index * 8}px`,
                      zIndex: 100 - index,
                      transform: `scale(${1 - index * 0.03})`,
                      opacity: index === 0 ? 1 : 0.85,
                    }}
                  >
                    <NewOrderNotification
                      orderId={notification.orderId}
                      customerName={notification.customerName}
                      total={notification.total}
                      orderType={notification.orderType}
                      tableNumber={notification.tableNumber}
                      deliveryType={notification.deliveryType}
                      items={notification.items}
                      kind={notification.kind}
                      onView={() => {
                        const current = notification;
                        (async () => {
                          if (current.orderType === 'local') {
                            const { data: orderData } = await supabase
                              .from("orders")
                              .select("table_id")
                              .eq("id", current.orderId)
                              .single();
                            setActiveSection('pdv');
                            if (orderData?.table_id) setPendingTableToOpen(orderData.table_id);
                          } else {
                            setActiveSection('pedidos');
                            setPendingOrderToOpen(current.orderId);
                          }
                        })();
                        setNotificationQueue(prev => prev.filter(n => n.orderId !== notification.orderId));
                      }}
                      onDismiss={() => setNotificationQueue(prev => prev.filter(n => n.orderId !== notification.orderId))}
                      onStopSound={() => setSoundMuted(true)}
                      onReject={async (reason) => {
                        try {
                          await supabase.rpc("admin_update_order_status", { p_order_id: notification.orderId, p_new_status: "cancelled", p_restaurant_id: restaurant?.id });
                          await supabase.from("orders").update({ cancellation_reason: reason }).eq("id", notification.orderId);
                          setNotificationQueue(prev => prev.filter(n => n.orderId !== notification.orderId));
                        } catch (e) { console.error("Reject error:", e); }
                      }}
                    />
                  </div>
                ))}
                {notificationQueue.length > 3 && (
                  <div className="absolute right-2" style={{ top: `${3 * 8 + 4}px`, zIndex: 96 }}>
                    <span className="inline-block px-2 py-0.5 rounded-full bg-orange-500 text-white text-xs font-bold shadow">
                      +{notificationQueue.length - 3}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              /* Expanded: scrollable list of all notifications */
              <div className="flex flex-col gap-2 max-h-[70vh] overflow-y-auto pr-1">
                <div className="sticky top-0 z-10 bg-background py-1 flex justify-end">
                  <button
                    onClick={() => setCascadeExpanded(false)}
                    className="text-xs text-orange-600 hover:text-orange-800 font-medium"
                  >
                    Recolher
                  </button>
                </div>
                {notificationQueue.map((notification) => (
                  <NewOrderNotification
                    key={notification.orderId}
                    orderId={notification.orderId}
                    customerName={notification.customerName}
                    total={notification.total}
                    orderType={notification.orderType}
                    tableNumber={notification.tableNumber}
                    deliveryType={notification.deliveryType}
                    items={notification.items}
                    kind={notification.kind}
                    onView={() => {
                      const current = notification;
                      (async () => {
                        if (current.orderType === 'local') {
                          const { data: orderData } = await supabase
                            .from("orders")
                            .select("table_id")
                            .eq("id", current.orderId)
                            .single();
                          setActiveSection('pdv');
                          if (orderData?.table_id) setPendingTableToOpen(orderData.table_id);
                        } else {
                          setActiveSection('pedidos');
                          setPendingOrderToOpen(current.orderId);
                        }
                      })();
                      setNotificationQueue(prev => prev.filter(n => n.orderId !== notification.orderId));
                    }}
                    onDismiss={() => setNotificationQueue(prev => prev.filter(n => n.orderId !== notification.orderId))}
                    onStopSound={() => setSoundMuted(true)}
                    onReject={async (reason) => {
                      try {
                        await supabase.rpc("admin_update_order_status", { p_order_id: notification.orderId, p_new_status: "cancelled", p_restaurant_id: restaurant?.id });
                        await supabase.from("orders").update({ cancellation_reason: reason }).eq("id", notification.orderId);
                        setNotificationQueue(prev => prev.filter(n => n.orderId !== notification.orderId));
                      } catch (e) { console.error("Reject error:", e); }
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        
        {/* Global Bill Notifications - cascade like orders */}
        {billNotificationQueue.length > 0 && (
          <div className="fixed top-4 left-4 z-[100]">
            {!billCascadeExpanded ? (
              <div
                className="relative cursor-pointer"
                onClick={() => setBillCascadeExpanded(true)}
                style={{ height: `${68 + Math.min(billNotificationQueue.length - 1, 2) * 8}px` }}
              >
                {billNotificationQueue.slice(0, 3).map((notification, index) => (
                  <div
                    key={notification.billId}
                    className="absolute left-0 transition-all duration-200"
                    style={{
                      top: `${index * 8}px`,
                      zIndex: 100 - index,
                      transform: `scale(${1 - index * 0.03})`,
                      opacity: index === 0 ? 1 : 0.85,
                    }}
                  >
                    <NewBillNotification
                      billId={notification.billId}
                      tableNumber={notification.tableNumber}
                      total={notification.total}
                      customerName={notification.customerName}
                      onView={() => handleViewBill(notification)}
                      onDismiss={() => setBillNotificationQueue(prev => prev.filter(b => b.billId !== notification.billId))}
                      onStopSound={() => setSoundMuted(true)}
                    />
                  </div>
                ))}
                {billNotificationQueue.length > 3 && (
                  <div className="absolute left-2" style={{ top: `${3 * 8 + 4}px`, zIndex: 96 }}>
                    <span className="inline-block px-2 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold shadow">
                      +{billNotificationQueue.length - 3}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[70vh] overflow-y-auto pr-1">
                <div className="sticky top-0 z-10 bg-background py-1 flex justify-end">
                  <button
                    onClick={() => setBillCascadeExpanded(false)}
                    className="text-xs text-amber-600 hover:text-amber-800 font-medium"
                  >
                    Recolher
                  </button>
                </div>
                {billNotificationQueue.map((notification) => (
                  <NewBillNotification
                    key={notification.billId}
                    billId={notification.billId}
                    tableNumber={notification.tableNumber}
                    total={notification.total}
                    customerName={notification.customerName}
                    onView={() => handleViewBill(notification)}
                    onDismiss={() => setBillNotificationQueue(prev => prev.filter(b => b.billId !== notification.billId))}
                    onStopSound={() => setSoundMuted(true)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Global Reservation Notification */}
        {reservationNotification && (
          <NewReservationNotification
            reservationId={reservationNotification.reservationId}
            customerName={reservationNotification.customerName}
            tableName={reservationNotification.tableName}
            date={reservationNotification.date}
            time={reservationNotification.time}
            partySize={reservationNotification.partySize}
            onView={handleViewReservation}
            onDismiss={() => setReservationNotification(null)}
          />
        )}
        <SupportChatWidget />
        {restaurant?.id && <QzOnboardingGate restaurantId={restaurant.id} />}

        {/* Mobile bottom nav — only on screens < md */}
        <MobileBottomNav
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          hasNewDeliveryOrders={hasNewDeliveryOrders}
          hasNewBills={hasNewBills}
          hasNewLocalOrders={hasNewLocalOrders}
          primaryColor={restaurant.primary_color}
          staffRole={staffRole ?? undefined}
          staffAllowedSections={staffAllowedSections}
        />

      </div>
    </SidebarProvider>
    <TourOverlay />
    </TourProvider>
    </ConfirmDialogProvider>
  );
};

export default RestaurantAdmin;

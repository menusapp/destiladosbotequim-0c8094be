import { useState, useEffect, useMemo } from "react";
import ReservationHoursSettings from "./settings/ReservationHoursSettings";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
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
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Plus, 
  Users, 
  CheckCircle, 
  LayoutGrid, 
  TrendingUp,
  MoreVertical,
  QrCode,
  Link as LinkIcon,
  Trash2,
  XCircle,
  Edit,
  Clock,
  CalendarCheck,
  Phone,
  User,
  Check,
  X,
  Upload,
  Loader2,
  Image,
  Copy,
  Search,
  FileText,
  Calendar as CalendarIcon,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import QRCode from "qrcode";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import {
  ACTIVE_RESERVATION_STATUSES,
  buildActiveReservationByTable,
  isReservationExpired,
} from "@/lib/reservations";
import { normalizeSearch } from "@/lib/searchNormalize";
import { usePolling } from "@/hooks/usePolling";

import { copiarTexto } from "@/lib/clipboard";
interface Comanda {
  id: string;
  customer_name: string;
  customer_cpf: string;
}

interface Reservation {
  id: string;
  restaurant_id: string;
  table_id: string | null;
  reservation_table_id: string | null;
  customer_name: string;
  customer_cpf: string;
  customer_phone: string;
  reservation_date: string;
  reservation_time: string;
  party_size: number;
  status: string;
  notes: string | null;
  created_at: string;
}

interface Table {
  id: string;
  table_number: number;
  table_name: string | null;
  description: string | null;
  image_url: string | null;
  min_capacity: number;
  max_capacity: number;
  is_available_for_reservation: boolean;
  display_order: number;
  qr_code: string | null;
  is_occupied: boolean;
  occupied_by: string | null;
  occupied_at: string | null;
  comandas?: Comanda[];
  activeReservation?: Reservation | null;
}

type FilterType = "all" | "occupied" | "available" | "reserved";
type TableStatus = "available" | "occupied" | "reserved";

const TablesTab = ({ restaurantId }: { restaurantId: string }) => {
  const navigate = useNavigate();
  const confirm = useConfirmDialog();
  const [tables, setTables] = useState<Table[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [reservationsEnabled, setReservationsEnabled] = useState(false);
  const [followBusinessHours, setFollowBusinessHours] = useState(true);
  const [billRequestEnabled, setBillRequestEnabled] = useState(true);
  const [restaurantSlug, setRestaurantSlug] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editingTable, setEditingTable] = useState<Table | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [tableToEmpty, setTableToEmpty] = useState<Table | null>(null);
  const [uploading, setUploading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  
  // Form state for new/edit table
  const [tableForm, setTableForm] = useState({
    table_number: "",
    table_name: "",
    description: "",
    image_url: "",
    min_capacity: 1,
    max_capacity: 4,
    is_available_for_reservation: true,
  });

  // Reservation dialogs
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [arrivalDialogOpen, setArrivalDialogOpen] = useState(false);

  useEffect(() => {
    fetchRestaurantData();
    fetchTables();
    fetchReservations();
    cleanupExpiredReservations();

    // Consolidated realtime: 1 channel with multiple listeners + debounce
    let tablesDebounce: ReturnType<typeof setTimeout>;
    let reservationsDebounce: ReturnType<typeof setTimeout>;
    const debouncedFetchTables = () => { clearTimeout(tablesDebounce); tablesDebounce = setTimeout(fetchTables, 400); };
    const debouncedFetchReservations = () => { clearTimeout(reservationsDebounce); reservationsDebounce = setTimeout(fetchReservations, 400); };

    const channel = supabase
      .channel(`tables-tab-${restaurantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tables", filter: `restaurant_id=eq.${restaurantId}` }, debouncedFetchTables)
      .on("postgres_changes", { event: "*", schema: "public", table: "comandas", filter: `restaurant_id=eq.${restaurantId}` }, debouncedFetchTables)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, (payload) => {
        const order = payload.new as any;
        if (order.order_type === "local" && order.restaurant_id === restaurantId) debouncedFetchTables();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, (payload) => {
        const order = payload.new as any;
        if (order.order_type === "local" && order.restaurant_id === restaurantId) debouncedFetchTables();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations", filter: `restaurant_id=eq.${restaurantId}` }, debouncedFetchReservations)
      .subscribe();

    return () => {
      clearTimeout(tablesDebounce);
      clearTimeout(reservationsDebounce);
      supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  // Fallback por polling (Realtime não recebe eventos sob RLS por token).
  usePolling(() => { fetchTables(); fetchReservations(); });

  const fetchRestaurantData = async () => {
    const { data } = await supabase
      .from("restaurants")
      .select("slug, reservations_enabled, reservations_follow_business_hours, bill_request_enabled")
      .eq("id", restaurantId)
      .single();

    if (data) {
      setRestaurantSlug(data.slug);
      setReservationsEnabled(data.reservations_enabled || false);
      setFollowBusinessHours(data.reservations_follow_business_hours ?? true);
      setBillRequestEnabled(data.bill_request_enabled ?? true);
    }
  };

  const fetchTables = async () => {
    const { data: tablesData, error } = await supabase
      .from("tables")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .neq("table_number", 9999)
      .order("display_order")
      .order("table_number");

    if (error) {
      toast.error("Erro ao buscar mesas");
      return;
    }

    const tableIds = (tablesData || []).map(t => t.id);
    
    if (tableIds.length > 0) {
      const { data: comandasData } = await supabase
        .from("comandas")
        .select("id, table_id, customer_name, customer_cpf")
        .in("table_id", tableIds)
        .eq("status", "active");

      const tablesWithComandas = (tablesData || []).map(table => ({
        ...table,
        comandas: (comandasData || []).filter(c => c.table_id === table.id)
      }));

      setTables(tablesWithComandas);
    } else {
      setTables(tablesData || []);
    }
  };

  const fetchReservations = async () => {
    const { data } = await supabase
      .from("reservations")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("reservation_date")
      .order("reservation_time");

    setReservations(data || []);
  };

  const cleanupExpiredReservations = async () => {
    const { data } = await supabase
      .from("reservations")
      .select("id, table_id, reservation_date, reservation_time, status")
      .eq("restaurant_id", restaurantId)
      .in("status", Array.from(ACTIVE_RESERVATION_STATUSES));

    const expiredIds = (data || [])
      .filter((reservation) => isReservationExpired(reservation))
      .map((reservation) => reservation.id);

    if (expiredIds.length === 0) return;

    await supabase
      .from("reservations")
      .update({ status: "expired" })
      .in("id", expiredIds);

    setReservations((prev) => prev.map((reservation) =>
      expiredIds.includes(reservation.id) ? { ...reservation, status: "expired" } : reservation
    ));
  };

  const activeReservationByTable = useMemo(
    () => buildActiveReservationByTable(reservations),
    [reservations]
  );

  const getTableStatus = (table: Table): TableStatus => {
    if (table.is_occupied) return "occupied";
    const activeReservation = activeReservationByTable.get(table.id);
    if (activeReservation) return "reserved";
    return "available";
  };

  const getActiveReservation = (table: Table): Reservation | null => {
    return activeReservationByTable.get(table.id) || null;
  };

  const openTableDialog = (table?: Table) => {
    if (table) {
      setEditingTable(table);
      setTableForm({
        table_number: table.table_number.toString(),
        table_name: table.table_name || `Mesa ${table.table_number}`,
        description: table.description || "",
        image_url: table.image_url || "",
        min_capacity: table.min_capacity || 1,
        max_capacity: table.max_capacity || 4,
        is_available_for_reservation: table.is_available_for_reservation ?? true,
      });
    } else {
      setEditingTable(null);
      setTableForm({
        table_number: "",
        table_name: "",
        description: "",
        image_url: "",
        min_capacity: 1,
        max_capacity: 4,
        is_available_for_reservation: true,
      });
    }
    setShowDialog(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploading(true);
    
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${restaurantId}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('table-images')
        .upload(fileName, file);
      
      if (uploadError) throw uploadError;
      
      const { data: { publicUrl } } = supabase.storage
        .from('table-images')
        .getPublicUrl(fileName);
      
      setTableForm({ ...tableForm, image_url: publicUrl });
      toast.success("Imagem enviada!");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Erro ao fazer upload da imagem");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const tableData = {
      restaurant_id: restaurantId,
      table_number: parseInt(tableForm.table_number),
      table_name: tableForm.table_name || `Mesa ${tableForm.table_number}`,
      description: tableForm.description || null,
      image_url: tableForm.image_url || null,
      min_capacity: tableForm.min_capacity,
      max_capacity: tableForm.max_capacity,
      is_available_for_reservation: tableForm.is_available_for_reservation,
      qr_code: `table-${restaurantId}-${tableForm.table_number}`,
    };

    if (editingTable) {
      const { error } = await supabase
        .from("tables")
        .update(tableData)
        .eq("id", editingTable.id);

      if (error) {
        toast.error("Erro ao atualizar mesa");
        return;
      }
      toast.success("Mesa atualizada!");
    } else {
      const { error } = await supabase.from("tables").insert(tableData);

      if (error) {
        toast.error("Erro ao criar mesa");
        return;
      }
      toast.success("Mesa criada!");
    }

    setShowDialog(false);
    setEditingTable(null);
    setTableForm({
      table_number: "",
      table_name: "",
      description: "",
      image_url: "",
      min_capacity: 1,
      max_capacity: 4,
      is_available_for_reservation: true,
    });
    fetchTables();
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      variant: "destructive",
      title: "Excluir mesa?",
      description: "A mesa será removida permanentemente da lista.",
      consequence: "Esta ação não pode ser desfeita.",
    });
    if (!ok) return;

    const { error } = await supabase.from("tables").delete().eq("id", id);

    if (error) {
      toast.error("Erro ao excluir mesa");
      return;
    }

    toast.success("Mesa excluída!");
    fetchTables();
  };

  const copyTableLink = async (table: Table, e: React.MouseEvent) => {
    e.stopPropagation();
    const link = `${window.location.origin}/${restaurantSlug}/mesa/${table.table_number}`;
    try {
      await copiarTexto(link);
      toast.success(`Link da Mesa ${table.table_number} copiado!`);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = link;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      toast.success(`Link da Mesa ${table.table_number} copiado!`);
    }
  };

  const downloadQRCode = async (table: Table) => {
    const link = `${window.location.origin}/${restaurantSlug}/mesa/${table.table_number}`;
    const qrCode = await QRCode.toDataURL(link, { width: 512, margin: 2 });
    const downloadLink = document.createElement("a");
    downloadLink.href = qrCode;
    downloadLink.download = `mesa-${table.table_number}-qr.png`;
    downloadLink.click();
    toast.success("QR Code baixado!");
  };

  const checkCanEmptyTable = async (tableId: string): Promise<{ canEmpty: boolean; reason?: string }> => {
    const { data: activeOrders } = await supabase
      .from("orders")
      .select("id")
      .eq("table_id", tableId)
      .in("status", ["pending", "accepted", "preparing", "ready"]);

    if (activeOrders && activeOrders.length > 0) {
      return { canEmpty: false, reason: "Existem pedidos ativos nesta mesa. Finalize-os primeiro." };
    }

    return { canEmpty: true };
  };

  const handleRequestEmptyTable = async (table: Table) => {
    const { canEmpty, reason } = await checkCanEmptyTable(table.id);
    
    if (!canEmpty) {
      toast.error(reason || "Não é possível esvaziar esta mesa");
      return;
    }

    setTableToEmpty(table);
  };

  const handleEmptyTable = async (tableId: string) => {
    try {
      await supabase
        .from("comandas")
        .update({ status: "closed", closed_at: new Date().toISOString() })
        .eq("table_id", tableId)
        .eq("status", "active");

      const { error } = await supabase
        .from("tables")
        .update({
          is_occupied: false,
          occupied_by: null,
          occupied_at: null,
        })
        .eq("id", tableId);

      if (error) throw error;

      toast.success("Mesa esvaziada!");
      fetchTables();
    } catch (error) {
      console.error("Erro ao esvaziar mesa:", error);
      toast.error("Erro ao esvaziar mesa");
    } finally {
      setTableToEmpty(null);
    }
  };

  const handleToggleReservations = async (enabled: boolean) => {
    const { error } = await supabase
      .from("restaurants")
      .update({ reservations_enabled: enabled })
      .eq("id", restaurantId);

    if (error) {
      toast.error("Erro ao atualizar configuração");
      return;
    }

    setReservationsEnabled(enabled);
    toast.success(enabled ? "Reservas ativadas!" : "Reservas desativadas");
  };

  const handleToggleFollowBusinessHours = async (enabled: boolean) => {
    const { error } = await supabase
      .from("restaurants")
      .update({ reservations_follow_business_hours: enabled })
      .eq("id", restaurantId);

    if (error) {
      toast.error("Erro ao atualizar configuração");
      return;
    }

    setFollowBusinessHours(enabled);
    toast.success(enabled ? "Reservas seguirão horário de funcionamento" : "Reservas usarão horário padrão");
  };

  const handleCopyReservationLink = () => {
    const link = `${window.location.origin}/${restaurantSlug}/reservas`;
    copiarTexto(link);
    toast.success("Link copiado!");
  };

  // Helper para enviar WhatsApp de reserva
  const sendReservationWhatsApp = async (
    reservation: Reservation,
    messageType: 'confirmed' | 'cancelled'
  ) => {
    try {
      const table = tables.find(t => t.id === reservation.table_id);
      const tableName = table?.table_name || `Mesa ${table?.table_number}`;
      
      const { data: whatsappConfig } = await supabase
        .from('whatsapp_config')
        .select('enabled, instance_status, message_reservation_confirmed, message_reservation_cancelled')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (!whatsappConfig?.enabled || whatsappConfig?.instance_status !== 'connected') {
        return;
      }

      const defaultMessages = {
        confirmed: "✅ Olá {nome}! Sua reserva foi CONFIRMADA!\n\n🪑 Mesa: {mesa}\n📆 Data: {data}\n⏰ Horário: {horario}\n👥 Pessoas: {pessoas}\n\nAguardamos você! 🎉",
        cancelled: "❌ Olá {nome}, infelizmente sua reserva para {data} às {horario} foi cancelada.\n\nEntre em contato conosco para mais informações ou faça uma nova reserva."
      };

      const template = messageType === 'confirmed'
        ? (whatsappConfig.message_reservation_confirmed || defaultMessages.confirmed)
        : (whatsappConfig.message_reservation_cancelled || defaultMessages.cancelled);

      // Formatar data
      const [year, month, day] = reservation.reservation_date.split('-');
      const formattedDate = `${day}/${month}/${year}`;

      const message = template
        .replace(/{nome}/g, reservation.customer_name)
        .replace(/{mesa}/g, tableName)
        .replace(/{data}/g, formattedDate)
        .replace(/{horario}/g, reservation.reservation_time.slice(0, 5))
        .replace(/{pessoas}/g, reservation.party_size.toString());

      await supabase.functions.invoke('whatsapp-send', {
        body: {
          restaurantId,
          phone: reservation.customer_phone,
          message,
          messageType: `reservation_${messageType}`
        }
      });
    } catch (error) {
      console.error('[WhatsApp] Erro ao enviar:', error);
    }
  };

  const handleConfirmReservation = async () => {
    if (!selectedReservation) return;
    const id = selectedReservation.id;

    // Atualização otimista
    setReservations(prev => prev.map(r => r.id === id ? { ...r, status: "confirmed" } : r));

    const { error } = await supabase
      .from("reservations")
      .update({
        status: "confirmed",
        confirmed_by: "Admin",
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      // Reverte
      setReservations(prev => prev.map(r => r.id === id ? selectedReservation : r));
      toast.error("Erro ao confirmar reserva");
      return;
    }

    sendReservationWhatsApp(selectedReservation, 'confirmed');
    toast.success("Reserva confirmada!");
    setConfirmDialogOpen(false);
    setSelectedReservation(null);
  };

  const handleCancelReservation = async () => {
    if (!selectedReservation) return;
    const id = selectedReservation.id;
    const tableId = selectedReservation.table_id;
    const previous = selectedReservation;

    // Atualização otimista: marca reserva como cancelada e libera mesa visualmente
    setReservations(prev => prev.map(r => r.id === id ? { ...r, status: "cancelled" } : r));
    if (tableId) {
      setTables(prev => prev.map(t =>
        t.id === tableId && t.is_occupied && t.occupied_by === previous.customer_name
          ? { ...t, is_occupied: false, occupied_by: null, occupied_at: null }
          : t
      ));
    }

    const { error } = await supabase
      .from("reservations")
      .update({
        status: "cancelled",
        cancelled_by: "Admin",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: cancellationReason || null,
      })
      .eq("id", id);

    if (error) {
      setReservations(prev => prev.map(r => r.id === id ? previous : r));
      toast.error("Erro ao cancelar reserva");
      return;
    }

    sendReservationWhatsApp(previous, 'cancelled');
    toast.success("Reserva cancelada e mesa liberada.");
    setCancelDialogOpen(false);
    setSelectedReservation(null);
    setCancellationReason("");
  };

  const handleNoShow = async (reservation: Reservation) => {
    const ok = await confirm({
      title: "Cliente não veio?",
      description: `Marcar a reserva de ${reservation.customer_name} como "não compareceu" e liberar a mesa?`,
      confirmLabel: "Confirmar",
      cancelLabel: "Voltar",
    });
    if (!ok) return;

    const id = reservation.id;
    const tableId = reservation.table_id;

    // Otimista
    setReservations(prev => prev.map(r => r.id === id ? { ...r, status: "no_show" } : r));
    if (tableId) {
      setTables(prev => prev.map(t =>
        t.id === tableId && t.is_occupied && t.occupied_by === reservation.customer_name
          ? { ...t, is_occupied: false, occupied_by: null, occupied_at: null }
          : t
      ));
    }

    const { error } = await supabase
      .from("reservations")
      .update({
        status: "no_show",
        cancelled_by: "Admin",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: "Cliente não compareceu",
      })
      .eq("id", id);

    if (error) {
      setReservations(prev => prev.map(r => r.id === id ? reservation : r));
      toast.error("Erro ao registrar não comparecimento");
      return;
    }

    toast.success("Reserva marcada como não comparecimento. Mesa liberada.");
  };

  const handleClientArrival = async () => {
    if (!selectedReservation) return;
    const reservation = selectedReservation;

    try {
      const table = tables.find(t => t.id === reservation.table_id);
      if (!table) {
        toast.error("Mesa não encontrada");
        return;
      }

      // Atualização otimista IMEDIATA na UI
      setTables(prev => prev.map(t =>
        t.id === table.id
          ? { ...t, is_occupied: true, occupied_by: reservation.customer_name, occupied_at: new Date().toISOString() }
          : t
      ));
      setReservations(prev => prev.map(r =>
        r.id === reservation.id ? { ...r, status: "completed" } : r
      ));
      setArrivalDialogOpen(false);
      setSelectedReservation(null);
      toast.success("Cliente chegou. Mesa ocupada com sucesso.");

      // Operações em paralelo no backend
      const [comandaRes, tableRes, reservationRes] = await Promise.all([
        supabase.from("comandas").insert({
          restaurant_id: restaurantId,
          table_id: table.id,
          customer_name: reservation.customer_name,
          customer_cpf: reservation.customer_cpf,
          status: "active",
        }),
        supabase
          .from("tables")
          .update({
            is_occupied: true,
            occupied_by: reservation.customer_name,
            occupied_at: new Date().toISOString(),
          })
          .eq("id", table.id),
        supabase
          .from("reservations")
          .update({ status: "completed" })
          .eq("id", reservation.id),
      ]);

      if (comandaRes.error || tableRes.error || reservationRes.error) {
        console.error("Erro chegada:", comandaRes.error, tableRes.error, reservationRes.error);
        toast.error("Algumas operações falharam. Atualizando...");
        fetchTables();
        fetchReservations();
      }
    } catch (error) {
      console.error("Erro:", error);
      toast.error("Erro ao registrar chegada");
      fetchTables();
      fetchReservations();
    }
  };

  const maskCPF = (cpf: string) => {
    if (cpf.length === 11) {
      return `***.***${cpf.slice(6, 9)}-${cpf.slice(9)}`;
    }
    return cpf;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">Pendente</Badge>;
      case "confirmed":
        return <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">Confirmada</Badge>;
      case "cancelled":
        return <Badge variant="outline" className="bg-red-100 text-red-800 border-red-300">Cancelada</Badge>;
      case "no_show":
        return <Badge variant="outline" className="bg-red-100 text-red-800 border-red-300">Não compareceu</Badge>;
      case "completed":
      case "arrived":
      case "seated":
        return <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">Concluída</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  // Filter tables
  const filteredTables = tables.filter((table) => {
    const displayName = table.table_name || `Mesa ${table.table_number}`;
    const matchesSearch = normalizeSearch(displayName).includes(normalizeSearch(searchQuery)) ||
      table.table_number.toString().includes(searchQuery);
    if (!matchesSearch) return false;

    const status = getTableStatus(table);
    if (filter === "occupied") return status === "occupied";
    if (filter === "available") return status === "available";
    if (filter === "reserved") return status === "reserved";
    return true;
  });

  // Filter reservations
  const filteredReservations = reservations.filter((r) => {
    const matchesSearch =
      normalizeSearch(r.customer_name).includes(normalizeSearch(searchTerm)) ||
      r.customer_cpf.includes(searchTerm) ||
      r.customer_phone.includes(searchTerm);

    const matchesStatus = statusFilter === "all" || r.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Stats
  const stats = {
    total: tables.length,
    available: tables.filter(t => getTableStatus(t) === "available").length,
    occupied: tables.filter(t => getTableStatus(t) === "occupied").length,
    reserved: tables.filter(t => getTableStatus(t) === "reserved").length,
  };

  const pendingReservationsCount = reservations.filter(r => r.status === "pending").length;

  // Get today's reservations
  const todayReservations = reservations.filter(r => {
    return r.reservation_date === format(new Date(), "yyyy-MM-dd") && 
      (r.status === "confirmed" || r.status === "pending");
  });

  const handleToggleBillRequest = async (enabled: boolean) => {
    const { error } = await supabase
      .from("restaurants")
      .update({ bill_request_enabled: enabled })
      .eq("id", restaurantId);
    if (error) { toast.error("Erro ao atualizar configuração"); return; }
    setBillRequestEnabled(enabled);
    toast.success(enabled ? "Pedir conta ativado!" : "Pedir conta desativado");
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Reservas</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie as reservas do restaurante
          </p>
        </div>
      </div>

      {/* Bill Request Toggle moved to Configurações Gerais > Cardápio */}
      <Card className="hidden">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="bill-request-toggle" className="font-medium">Permitir clientes pedirem conta</Label>
              <p className="text-sm text-muted-foreground">
                Exibe o botão "Pedir Conta" no cardápio digital dos clientes nas mesas
              </p>
            </div>
            <Switch
              id="bill-request-toggle"
              checked={billRequestEnabled}
              onCheckedChange={handleToggleBillRequest}
            />
          </div>
        </CardContent>
      </Card>

      {/* Reservas content */}
      {!reservationsEnabled ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <CalendarCheck className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
            <div>
              <h3 className="text-lg font-semibold">Reservas desativadas</h3>
              <p className="text-sm text-muted-foreground mt-1">Ative as reservas para que seus clientes possam reservar mesas pelo cardápio digital</p>
            </div>
            <Button onClick={() => handleToggleReservations(true)}>Ativar Reservas</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Link Público de Reservas */}
          <Card data-tour="reservas-link">
            <CardContent className="py-4">
              <Label className="font-medium mb-2 block">Link Público de Reservas</Label>
              <p className="text-sm text-muted-foreground mb-3">Envie este link aos clientes para que façam reservas online.</p>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={`${window.location.origin}/${restaurantSlug}/reservas`}
                  className="bg-muted/50 font-mono text-sm"
                />
                <Button variant="outline" size="sm" onClick={handleCopyReservationLink} className="gap-1.5 shrink-0">
                  <Copy className="h-4 w-4" />
                  Copiar
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Configurações */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Configurações de Reserva</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="reservations-toggle" className="font-medium">Ativar Reservas Online</Label>
                  <p className="text-sm text-muted-foreground">
                    Permite que clientes façam reservas pelo cardápio digital
                  </p>
                </div>
                <Switch
                  id="reservations-toggle"
                  checked={reservationsEnabled}
                  onCheckedChange={handleToggleReservations}
                />
              </div>
              
              <div className="flex items-center justify-between pt-2 border-t">
                <div>
                  <Label htmlFor="business-hours-toggle" className="font-medium">Seguir Horário de Funcionamento</Label>
                  <p className="text-sm text-muted-foreground">
                    Mostrar apenas horários disponíveis conforme configurado em Configurações → Horário de Funcionamento
                  </p>
                </div>
                <Switch
                  id="business-hours-toggle"
                  checked={followBusinessHours}
                  onCheckedChange={handleToggleFollowBusinessHours}
                />
              </div>

              {/* Custom reservation hours when not following business hours */}
              {!followBusinessHours && (
                <ReservationHoursSettings restaurantId={restaurantId} />
              )}
            </CardContent>
          </Card>

          <Tabs defaultValue="today" className="w-full">
            <TabsList data-tour="reservas-tabs" className="grid w-full grid-cols-3 max-w-lg">
              <TabsTrigger value="today">
                Hoje ({todayReservations.length})
              </TabsTrigger>
              <TabsTrigger value="pending" className="relative">
                Pendentes
                {pendingReservationsCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs rounded-full h-5 w-5 flex items-center justify-center">
                    {pendingReservationsCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="history">Histórico</TabsTrigger>
            </TabsList>

            {/* Today's Reservations */}
            <TabsContent value="today" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Reservas de Hoje</CardTitle>
                  <CardDescription>Reservas confirmadas e pendentes para hoje</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-3 pr-4">
                      {todayReservations.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          <CalendarCheck className="h-12 w-12 mx-auto mb-4 opacity-50" />
                          <p>Nenhuma reserva para hoje</p>
                        </div>
                      ) : (
                        todayReservations
                          .sort((a, b) => a.reservation_time.localeCompare(b.reservation_time))
                          .map((reservation) => {
                            const table = tables.find(t => t.id === reservation.table_id);
                            return (
                              <Card key={reservation.id} className={reservation.status === "confirmed" ? "border-green-200" : "border-yellow-200"}>
                                <CardContent className="p-4">
                                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div className="space-y-2">
                                      <div className="flex items-center gap-2">
                                        <Clock className="h-4 w-4 text-primary" />
                                        <span className="font-medium text-lg">
                                          {reservation.reservation_time.slice(0, 5)}
                                        </span>
                                        <Badge variant="outline">{table?.table_name || `Mesa ${table?.table_number}`}</Badge>
                                        {getStatusBadge(reservation.status)}
                                      </div>
                                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                        <span className="flex items-center gap-1">
                                          <User className="h-3 w-3" />
                                          {reservation.customer_name}
                                        </span>
                                        <span className="flex items-center gap-1">
                                          <Phone className="h-3 w-3" />
                                          {reservation.customer_phone}
                                        </span>
                                        <span className="flex items-center gap-1">
                                          <Users className="h-3 w-3" />
                                          {reservation.party_size} pessoas
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex gap-2">
                                      {reservation.status === "confirmed" && (
                                        <>
                                          <Button
                                            size="sm"
                                            className="bg-orange-600 hover:bg-orange-700"
                                            onClick={() => {
                                              setSelectedReservation(reservation);
                                              setArrivalDialogOpen(true);
                                            }}
                                          >
                                            <Check className="h-4 w-4 mr-1" />
                                            Cliente Chegou
                                          </Button>
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="text-destructive border-destructive/40"
                                            onClick={() => handleNoShow(reservation)}
                                          >
                                            <X className="h-4 w-4 mr-1" />
                                            Não veio
                                          </Button>
                                        </>
                                      )}
                                      {reservation.status === "pending" && (
                                        <>
                                          <Button
                                            size="sm"
                                            className="bg-green-600 hover:bg-green-700"
                                            onClick={() => {
                                              setSelectedReservation(reservation);
                                              setConfirmDialogOpen(true);
                                            }}
                                          >
                                            <Check className="h-4 w-4 mr-1" />
                                            Confirmar
                                          </Button>
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="text-destructive"
                                            onClick={() => {
                                              setSelectedReservation(reservation);
                                              setCancelDialogOpen(true);
                                            }}
                                          >
                                            <X className="h-4 w-4 mr-1" />
                                            Recusar
                                          </Button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Pending Reservations */}
            <TabsContent value="pending" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Reservas Pendentes</CardTitle>
                  <CardDescription>Reservas aguardando confirmação</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-3 pr-4">
                      {reservations.filter(r => r.status === "pending").length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                          <p>Nenhuma reserva pendente</p>
                        </div>
                      ) : (
                        reservations
                          .filter(r => r.status === "pending")
                          .sort((a, b) => `${a.reservation_date}${a.reservation_time}`.localeCompare(`${b.reservation_date}${b.reservation_time}`))
                          .map((reservation) => {
                            const table = tables.find(t => t.id === reservation.table_id);
                            const [year, month, day] = reservation.reservation_date.split('-');
                            return (
                              <Card key={reservation.id} className="border-yellow-200">
                                <CardContent className="p-4">
                                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div className="space-y-2">
                                      <div className="flex items-center gap-2">
                                        <CalendarIcon className="h-4 w-4 text-primary" />
                                        <span className="font-medium">{`${day}/${month}/${year}`}</span>
                                        <Clock className="h-4 w-4" />
                                        <span className="font-medium">{reservation.reservation_time.slice(0, 5)}</span>
                                        <Badge variant="outline">{table?.table_name || `Mesa ${table?.table_number}`}</Badge>
                                      </div>
                                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                        <span className="flex items-center gap-1"><User className="h-3 w-3" />{reservation.customer_name}</span>
                                        <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{reservation.customer_phone}</span>
                                        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{reservation.party_size} pessoas</span>
                                      </div>
                                      {reservation.notes && <p className="text-xs text-muted-foreground italic">"{reservation.notes}"</p>}
                                    </div>
                                    <div className="flex gap-2">
                                      <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => { setSelectedReservation(reservation); setConfirmDialogOpen(true); }}>
                                        <Check className="h-4 w-4 mr-1" />Confirmar
                                      </Button>
                                      <Button variant="outline" size="sm" className="text-destructive" onClick={() => { setSelectedReservation(reservation); setCancelDialogOpen(true); }}>
                                        <X className="h-4 w-4 mr-1" />Recusar
                                      </Button>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            {/* History */}
            <TabsContent value="history" className="mt-6">
              <Card>
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <CardTitle>Histórico de Reservas</CardTitle>
                      <CardDescription>Todas as reservas registradas</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8 w-48" />
                      </div>
                      <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          <SelectItem value="pending">Pendentes</SelectItem>
                          <SelectItem value="confirmed">Confirmadas</SelectItem>
                          <SelectItem value="completed">Concluídas</SelectItem>
                          <SelectItem value="cancelled">Canceladas</SelectItem>
                          <SelectItem value="no_show">Não compareceu</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-3 pr-4">
                      {filteredReservations.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                          <p>Nenhuma reserva encontrada</p>
                        </div>
                      ) : (
                        filteredReservations.map((reservation) => {
                          const table = tables.find(t => t.id === reservation.table_id);
                          const [year, month, day] = reservation.reservation_date.split('-');
                          return (
                            <Card key={reservation.id}>
                              <CardContent className="p-4">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                      <CalendarIcon className="h-4 w-4 text-primary" />
                                      <span className="font-medium">{`${day}/${month}/${year}`}</span>
                                      <Clock className="h-4 w-4" />
                                      <span>{reservation.reservation_time.slice(0, 5)}</span>
                                      <Badge variant="outline">{table?.table_name || `Mesa ${table?.table_number}`}</Badge>
                                      {getStatusBadge(reservation.status)}
                                    </div>
                                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                      <span className="flex items-center gap-1"><User className="h-3 w-3" />{reservation.customer_name}</span>
                                      <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{reservation.customer_phone}</span>
                                      <span className="flex items-center gap-1"><Users className="h-3 w-3" />{reservation.party_size} pessoas</span>
                                    </div>
                                  </div>
                                  <div className="flex gap-2">
                                    {reservation.status === "pending" && (
                                      <>
                                        <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => { setSelectedReservation(reservation); setConfirmDialogOpen(true); }}>
                                          <Check className="h-4 w-4 mr-1" />Confirmar
                                        </Button>
                                        <Button variant="outline" size="sm" className="text-destructive" onClick={() => { setSelectedReservation(reservation); setCancelDialogOpen(true); }}>
                                          <X className="h-4 w-4 mr-1" />Recusar
                                        </Button>
                                      </>
                                    )}
                                    {reservation.status === "confirmed" && (
                                      <>
                                        <Button size="sm" className="bg-orange-600 hover:bg-orange-700" onClick={() => { setSelectedReservation(reservation); setArrivalDialogOpen(true); }}>
                                          <Check className="h-4 w-4 mr-1" />Cliente Chegou
                                        </Button>
                                        <Button variant="outline" size="sm" className="text-destructive border-destructive/40" onClick={() => handleNoShow(reservation)}>
                                          <X className="h-4 w-4 mr-1" />Não veio
                                        </Button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Confirm Dialog */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Reserva</AlertDialogTitle>
            <AlertDialogDescription>
              Confirmar a reserva de {selectedReservation?.customer_name} para{" "}
              {selectedReservation?.reservation_date && (() => { const [y,m,d] = selectedReservation.reservation_date.split('-'); return `${d}/${m}/${y}`; })()}{" "}
              às {selectedReservation?.reservation_time?.slice(0, 5)}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmReservation} className="bg-green-600 hover:bg-green-700">
              Confirmar Reserva
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar Reserva</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja cancelar a reserva de {selectedReservation?.customer_name}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 pb-2">
            <Label>Motivo (opcional)</Label>
            <Textarea
              value={cancellationReason}
              onChange={(e) => setCancellationReason(e.target.value)}
              placeholder="Informe o motivo do cancelamento..."
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelReservation} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Cancelar Reserva
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Arrival Dialog */}
      <AlertDialog open={arrivalDialogOpen} onOpenChange={setArrivalDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Registrar Chegada</AlertDialogTitle>
            <AlertDialogDescription>
              Registrar a chegada de {selectedReservation?.customer_name}? 
              Uma comanda será criada automaticamente e a mesa será marcada como ocupada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleClientArrival} className="bg-orange-600 hover:bg-orange-700">
              Confirmar Chegada
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TablesTab;

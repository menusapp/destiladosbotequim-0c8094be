import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import QRCode from "qrcode";
import {
  MessageSquare, WifiOff, QrCode, RefreshCw, Loader2,
  CheckCircle2, Smartphone, Send, ChevronDown, User, Clock,
  Bell, ShoppingCart, Star, XCircle, Truck, Phone, ChefHat, PackageCheck
} from "lucide-react";

interface WhatsAppConfig {
  id: string;
  restaurant_id: string;
  enabled: boolean;
  instance_name: string | null;
  instance_status: string | null;
  connected_phone: string | null;
  connected_at: string | null;
  message_accepted: string | null;
  message_out_for_delivery: string | null;
  message_delivered: string | null;
  message_ready_for_pickup: string | null;
  message_picked_up: string | null;
  message_cancelled: string | null;
  message_reservation_created: string | null;
  message_reservation_confirmed: string | null;
  message_reservation_cancelled: string | null;
}

interface NotificationConfig {
  id?: string;
  notification_type: string;
  is_active: boolean;
  template_message: string;
  send_delay_minutes: number;
}

interface OwnerConfig {
  owner_name: string;
  owner_phone: string;
  receive_cashier_open: boolean;
  receive_cashier_close: boolean;
  receive_daily_summary: boolean;
  daily_summary_time: string;
}

const DEFAULT_MESSAGES = {
  accepted: "✅ Olá {nome}! Seu pedido #{pedido} foi aceito e está sendo preparado. Tempo estimado: {tempo} minutos.",
  out_for_delivery: "🚗 Seu pedido #{pedido} saiu para entrega! Em breve chegará no seu endereço.",
  delivered: "🎉 Pedido #{pedido} entregue com sucesso! Obrigado pela preferência, {nome}!",
  ready_for_pickup: "📍 Seu pedido #{pedido} está pronto para retirada! Aguardamos você!",
  picked_up: "✅ Pedido #{pedido} retirado com sucesso! Obrigado pela preferência, {nome}! 🙏",
  cancelled: "❌ Olá {nome}, infelizmente seu pedido #{pedido} foi cancelado. Entre em contato conosco para mais informações.",
  reservation_created: "📅 Olá {nome}! Sua reserva foi recebida e está aguardando confirmação.\n\n🪑 Mesa: {mesa}\n📆 Data: {data}\n⏰ Horário: {horario}\n👥 Pessoas: {pessoas}\n\nEm breve você receberá a confirmação!",
  reservation_confirmed: "✅ Olá {nome}! Sua reserva foi CONFIRMADA!\n\n🪑 Mesa: {mesa}\n📆 Data: {data}\n⏰ Horário: {horario}\n👥 Pessoas: {pessoas}\n\nAguardamos você! 🎉",
  reservation_cancelled: "❌ Olá {nome}, infelizmente sua reserva para {data} às {horario} foi cancelada.\n\nEntre em contato conosco para mais informações ou faça uma nova reserva."
};

const CLIENT_NOTIFICATION_DEFAULTS: Record<string, { label: string; icon: any; template: string; variables: string; color: string }> = {
  order_accepted: {
    label: "Confirmação ao Cliente",
    icon: CheckCircle2,
    template: "✅ Olá {{nome}}! Seu pedido foi aceito e está sendo preparado.\n\n{{resumo_pedido}}\n\n⏱️ Tempo estimado: {{tempo_estimado}} minutos.",
    variables: "{{nome}}, {{numero_pedido}}, {{tempo_estimado}}, {{resumo_pedido}}, {{total_pedido}}",
    color: "text-green-600",
  },
  order_preparing: {
    label: "Em Preparo",
    icon: ChefHat,
    template: "👨‍🍳 Olá {{nome}}! Seu pedido #{{numero_pedido}} está em preparo!\n\n⏱️ Tempo estimado: {{tempo_estimado}} minutos.",
    variables: "{{nome}}, {{numero_pedido}}, {{tempo_estimado}}",
    color: "text-orange-600",
  },
  order_out_for_delivery: {
    label: "Aviso de Saída / Pronto",
    icon: Truck,
    template: "🚗 Olá {{nome}}! Seu pedido #{{numero_pedido}} saiu para entrega / está pronto para retirada!",
    variables: "{{nome}}, {{numero_pedido}}",
    color: "text-blue-600",
  },
  order_ready_pickup: {
    label: "Pronto para Retirada",
    icon: PackageCheck,
    template: "📦 Olá {{nome}}! Seu pedido #{{numero_pedido}} está pronto para retirada! Aguardamos você! 😊",
    variables: "{{nome}}, {{numero_pedido}}",
    color: "text-emerald-600",
  },
  order_cancelled: {
    label: "Aviso de Cancelamento",
    icon: XCircle,
    template: "❌ Olá {{nome}}, infelizmente seu pedido #{{numero_pedido}} foi cancelado. Motivo: {{motivo}}",
    variables: "{{nome}}, {{numero_pedido}}, {{motivo}}",
    color: "text-red-600",
  },
  order_delivered: {
    label: "Pedir Avaliação",
    icon: Star,
    template: "🎉 Pedido #{{numero_pedido}} finalizado! Obrigado, {{nome}}! Avalie sua experiência: {{link_avaliacao}}",
    variables: "{{nome}}, {{numero_pedido}}, {{link_avaliacao}}",
    color: "text-yellow-600",
  },
  cart_recovery: {
    label: "Recuperação de Carrinho",
    icon: ShoppingCart,
    template: "👋 Olá {{nome}}! Notamos que você não finalizou seu pedido. Volte e aproveite! {{link_carrinho}}",
    variables: "{{nome}}, {{link_carrinho}}, {{cupom}}",
    color: "text-purple-600",
  },
};

const OWNER_NOTIFICATION_DEFAULTS: Record<string, { label: string; icon: any; template: string; variables: string; color: string; configField: keyof OwnerConfig }> = {
  cashier_open: {
    label: "Resumo de Abertura do Caixa",
    icon: Bell,
    template: "📂 Caixa aberto!\n\n👤 Operador: {{operador}}\n⏰ Horário: {{hora_abertura}}\n💰 Valor inicial: R$ {{valor_inicial}}",
    variables: "{{operador}}, {{hora_abertura}}, {{valor_inicial}}",
    color: "text-green-600",
    configField: "receive_cashier_open",
  },
  cashier_close: {
    label: "Resumo de Fechamento do Caixa",
    icon: Bell,
    template: "📊 Caixa fechado!\n\n👤 Operador: {{operador}}\n⏰ Horário: {{hora_fechamento}}\n💰 Abertura: R$ {{valor_abertura}}\n💰 Fechamento: R$ {{valor_fechamento}}\n📈 Faturamento: R$ {{faturamento_dia}}\n🧾 Pedidos: {{numero_pedidos}}\n🎯 Ticket médio: R$ {{ticket_medio}}\n📝 Obs: {{observacoes}}",
    variables: "{{operador}}, {{hora_fechamento}}, {{valor_abertura}}, {{valor_fechamento}}, {{faturamento_dia}}, {{numero_pedidos}}, {{ticket_medio}}, {{observacoes}}",
    color: "text-red-600",
    configField: "receive_cashier_close",
  },
  daily_summary: {
    label: "Resumo Diário",
    icon: Clock,
    template: "📊 Resumo do dia!\n\n📈 Faturamento: R$ {{faturamento_dia}}\n🧾 Pedidos: {{numero_pedidos}}\n🎯 Ticket médio: R$ {{ticket_medio}}",
    variables: "{{faturamento_dia}}, {{numero_pedidos}}, {{ticket_medio}}",
    color: "text-blue-600",
    configField: "receive_daily_summary",
  },
};

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";

const WhatsAppSettings = ({ restaurantId }: { restaurantId: string }) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [statusChecked, setStatusChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectFlowActive, setConnectFlowActive] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [config, setConfig] = useState<WhatsAppConfig | null>(null);
  const [reviewLink, setReviewLink] = useState("");
  
  const [messages, setMessages] = useState({
    accepted: DEFAULT_MESSAGES.accepted,
    out_for_delivery: DEFAULT_MESSAGES.out_for_delivery,
    delivered: DEFAULT_MESSAGES.delivered,
    ready_for_pickup: DEFAULT_MESSAGES.ready_for_pickup,
    picked_up: DEFAULT_MESSAGES.picked_up,
    cancelled: DEFAULT_MESSAGES.cancelled,
    reservation_created: DEFAULT_MESSAGES.reservation_created,
    reservation_confirmed: DEFAULT_MESSAGES.reservation_confirmed,
    reservation_cancelled: DEFAULT_MESSAGES.reservation_cancelled,
  });

  // Notification configs state
  const [clientNotifs, setClientNotifs] = useState<Record<string, NotificationConfig>>({});
  const [ownerNotifs, setOwnerNotifs] = useState<Record<string, NotificationConfig>>({});
  const [ownerConfig, setOwnerConfig] = useState<OwnerConfig>({
    owner_name: "",
    owner_phone: "",
    receive_cashier_open: true,
    receive_cashier_close: true,
    receive_daily_summary: true,
    daily_summary_time: "23:00",
  });
  const [savingNotifs, setSavingNotifs] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const qrPollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const qrPollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const generateQrImage = async (qrString: string): Promise<string | null> => {
    try {
      if (qrString.startsWith('data:image')) return qrString;
      if (qrString.length > 500 && !qrString.includes(' ')) return `data:image/png;base64,${qrString}`;
      return await QRCode.toDataURL(qrString, { width: 256, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
    } catch { return null; }
  };

  const stopAllPolling = useCallback(() => {
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    if (qrPollIntervalRef.current) { clearInterval(qrPollIntervalRef.current); qrPollIntervalRef.current = null; }
    if (qrPollTimeoutRef.current) { clearTimeout(qrPollTimeoutRef.current); qrPollTimeoutRef.current = null; }
  }, []);


  const fetchConfig = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('whatsapp_config').select('*').eq('restaurant_id', restaurantId).maybeSingle();
      if (error) throw error;
      if (data) {
        setConfig(data);
        setReviewLink((data as any).review_link_url || "");

        setMessages({
          accepted: data.message_accepted || DEFAULT_MESSAGES.accepted,
          out_for_delivery: data.message_out_for_delivery || DEFAULT_MESSAGES.out_for_delivery,
          delivered: data.message_delivered || DEFAULT_MESSAGES.delivered,
          ready_for_pickup: data.message_ready_for_pickup || DEFAULT_MESSAGES.ready_for_pickup,
          picked_up: data.message_picked_up || DEFAULT_MESSAGES.picked_up,
          cancelled: data.message_cancelled || DEFAULT_MESSAGES.cancelled,
          reservation_created: data.message_reservation_created || DEFAULT_MESSAGES.reservation_created,
          reservation_confirmed: data.message_reservation_confirmed || DEFAULT_MESSAGES.reservation_confirmed,
          reservation_cancelled: data.message_reservation_cancelled || DEFAULT_MESSAGES.reservation_cancelled,
        });
      }
    } catch (error) { console.error('Error fetching config:', error); }
  }, [restaurantId]);

  const fetchNotificationConfigs = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('whatsapp_notification_configs')
        .select('*')
        .eq('restaurant_id', restaurantId);

      if (error) throw error;

      const clientMap: Record<string, NotificationConfig> = {};
      const ownerMap: Record<string, NotificationConfig> = {};

      for (const row of (data || [])) {
        const conf: NotificationConfig = {
          id: row.id,
          notification_type: row.notification_type,
          is_active: row.is_active ?? true,
          template_message: row.template_message || "",
          send_delay_minutes: row.send_delay_minutes ?? 0,
        };
        if (['cashier_open', 'cashier_close', 'daily_summary'].includes(row.notification_type)) {
          ownerMap[row.notification_type] = conf;
        } else {
          clientMap[row.notification_type] = conf;
        }
      }

      // Fill defaults for missing types
      for (const [type, def] of Object.entries(CLIENT_NOTIFICATION_DEFAULTS)) {
        if (!clientMap[type]) {
          clientMap[type] = { notification_type: type, is_active: true, template_message: def.template, send_delay_minutes: type === 'cart_recovery' ? 30 : 0 };
        }
      }
      for (const [type, def] of Object.entries(OWNER_NOTIFICATION_DEFAULTS)) {
        if (!ownerMap[type]) {
          ownerMap[type] = { notification_type: type, is_active: true, template_message: def.template, send_delay_minutes: 0 };
        }
      }

      setClientNotifs(clientMap);
      setOwnerNotifs(ownerMap);
    } catch (error) { console.error('Error fetching notification configs:', error); }
  }, [restaurantId]);

  const fetchOwnerConfig = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('owner_notification_config')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setOwnerConfig({
          owner_name: data.owner_name || "",
          owner_phone: data.owner_phone || "",
          receive_cashier_open: data.receive_cashier_open ?? true,
          receive_cashier_close: data.receive_cashier_close ?? true,
          receive_daily_summary: data.receive_daily_summary ?? true,
          daily_summary_time: data.daily_summary_time || "23:00",
        });
      }
    } catch (error) { console.error('Error fetching owner config:', error); }
  }, [restaurantId]);

  useEffect(() => {
    Promise.all([fetchConfig(), fetchNotificationConfigs(), fetchOwnerConfig()]).then(async () => {
      // Auto-check real status from Evolution API on mount - wait for it before showing UI
      await checkStatus();
      setStatusChecked(true);
    }).finally(() => setLoading(false));
    return () => { stopAllPolling(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchConfig, fetchNotificationConfigs, fetchOwnerConfig, stopAllPolling]);

  const checkStatus = async (): Promise<{ status: string } | null> => {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-instance?restaurantId=${restaurantId}`);
      const data = await response.json();
      const status = data.status; // connected | connecting | disconnected | not_created

      // Always update config status, even if config is null (create a minimal one)
      setConfig(prev => {
        const base = prev || { id: '', restaurant_id: restaurantId, enabled: false, instance_name: null, instance_status: null, connected_phone: null, connected_at: null, message_accepted: null, message_out_for_delivery: null, message_delivered: null, message_ready_for_pickup: null, message_picked_up: null, message_cancelled: null, message_reservation_created: null, message_reservation_confirmed: null, message_reservation_cancelled: null };
        return { ...base, instance_status: status, instance_name: data.instance_name || base.instance_name };
      });

      if (status === 'connected') {
        setQrCodeDataUrl(null);
        setConnectFlowActive(false);
        stopAllPolling();
        fetchConfig();
      }
      return data;
    } catch (error) { console.error('Error checking status:', error); return null; }
  };

  const pollForQrCode = useCallback(async () => {
    if (!connectFlowActive) return;
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-instance?restaurantId=${restaurantId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'qrcode' })
      });
      const data = await response.json();
      if (data.qrString) {
        const imageUrl = await generateQrImage(data.qrString);
        if (imageUrl) {
          setQrCodeDataUrl(imageUrl);
          if (qrPollIntervalRef.current) { clearInterval(qrPollIntervalRef.current); qrPollIntervalRef.current = null; }
        }
      }
    } catch (error) { console.error('Error polling for QR:', error); }
  }, [restaurantId, connectFlowActive]);

  const handleConnect = async () => {
    setConnecting(true);
    setConnectFlowActive(true);
    setQrCodeDataUrl(null);
    stopAllPolling();
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-instance?restaurantId=${restaurantId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create' })
      });
      const data = await response.json();
      if (data.qrString) {
        const imageUrl = await generateQrImage(data.qrString);
        if (imageUrl) {
          setQrCodeDataUrl(imageUrl);
          setConfig(prev => prev ? { ...prev, instance_name: data.instance_name, instance_status: 'pending' } : null);
        } else throw new Error('Falha ao gerar imagem do QR code');
      } else if (data.status === 'pending_qr') {
        setConfig(prev => prev ? { ...prev, instance_name: data.instance_name, instance_status: 'pending' } : null);
        toast({ title: "Aguardando QR Code", description: "O QR code está sendo gerado..." });
        qrPollIntervalRef.current = setInterval(pollForQrCode, 3000);
        qrPollTimeoutRef.current = setTimeout(() => {
          if (qrPollIntervalRef.current) { clearInterval(qrPollIntervalRef.current); qrPollIntervalRef.current = null; }
          if (!qrCodeDataUrl) toast({ title: "Tempo esgotado", description: "Não foi possível obter o QR Code. Clique em 'Tentar novamente'.", variant: "destructive" });
        }, 60000);
      } else if (data.error) throw new Error(data.error);
      else throw new Error('Resposta inesperada do servidor');

      pollIntervalRef.current = setInterval(async () => { await checkStatus(); }, 3000);
      setTimeout(() => { if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; } }, 300000);
    } catch (error) {
      console.error('Error connecting:', error);
      setConnectFlowActive(false);
      toast({ title: "Erro", description: error instanceof Error ? error.message : "Falha ao conectar WhatsApp", variant: "destructive" });
    } finally { setConnecting(false); }
  };

  const handleCancelConnect = () => { stopAllPolling(); setConnectFlowActive(false); setQrCodeDataUrl(null); };

  const handleDisconnect = async () => {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-instance?restaurantId=${restaurantId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }
      });
      const data = await response.json();
      if (data.success) {
        setConfig(prev => prev ? { ...prev, instance_status: 'disconnected', connected_phone: null, connected_at: null } : null);
        setQrCodeDataUrl(null); setConnectFlowActive(false); stopAllPolling();
        toast({ title: "Desconectado", description: "WhatsApp desconectado com sucesso" });
      } else {
        throw new Error(data.error || 'Falha ao desconectar');
      }
    } catch (error) {
      console.error('Error disconnecting:', error);
      toast({ title: "Erro", description: "Falha ao desconectar", variant: "destructive" });
    }
  };

  const handleSaveReservations = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from('whatsapp_config').upsert({
        restaurant_id: restaurantId, enabled: config?.enabled ?? true,
        message_accepted: messages.accepted, message_out_for_delivery: messages.out_for_delivery,
        message_delivered: messages.delivered, message_ready_for_pickup: messages.ready_for_pickup,
        message_picked_up: messages.picked_up, message_cancelled: messages.cancelled,
        message_reservation_created: messages.reservation_created,
        message_reservation_confirmed: messages.reservation_confirmed,
        message_reservation_cancelled: messages.reservation_cancelled,
        updated_at: new Date().toISOString()
      }, { onConflict: 'restaurant_id' });
      if (error) throw error;
      await fetchConfig();
      toast({ title: "Salvo", description: "Configurações de reserva salvas" });
    } catch (error) {
      console.error('Error saving:', error);
      toast({ title: "Erro", description: "Falha ao salvar configurações", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleSaveNotificationConfigs = async (configs: Record<string, NotificationConfig>) => {
    setSavingNotifs(true);
    try {
      const upserts = Object.values(configs).map(c => ({
        restaurant_id: restaurantId,
        notification_type: c.notification_type,
        is_active: c.is_active,
        template_message: c.template_message,
        send_delay_minutes: c.send_delay_minutes,
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase.from('whatsapp_notification_configs').upsert(upserts, { onConflict: 'restaurant_id,notification_type' });
      if (error) throw error;

      // Salva também o link de avaliação (usado em {{link_avaliacao}}).
      const { error: linkError } = await supabase.from('whatsapp_config').upsert({
        restaurant_id: restaurantId,
        review_link_url: reviewLink.trim() || null,
        updated_at: new Date().toISOString(),
      } as any, { onConflict: 'restaurant_id' });
      if (linkError) throw linkError;

      toast({ title: "Salvo", description: "Configurações de notificação salvas" });
    } catch (error) {
      console.error('Error saving notifs:', error);
      toast({ title: "Erro", description: "Falha ao salvar", variant: "destructive" });
    } finally { setSavingNotifs(false); }
  };

  const handleSaveOwnerConfig = async () => {
    setSavingNotifs(true);
    try {
      // Save owner config
      const { error: ownerError } = await supabase.from('owner_notification_config').upsert({
        restaurant_id: restaurantId,
        owner_name: ownerConfig.owner_name,
        owner_phone: ownerConfig.owner_phone,
        receive_cashier_open: ownerConfig.receive_cashier_open,
        receive_cashier_close: ownerConfig.receive_cashier_close,
        receive_daily_summary: ownerConfig.receive_daily_summary,
        daily_summary_time: ownerConfig.daily_summary_time,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'restaurant_id' });
      if (ownerError) throw ownerError;

      // Save owner notification templates
      await handleSaveNotificationConfigs(ownerNotifs);

      toast({ title: "Salvo", description: "Configurações do dono salvas" });
    } catch (error) {
      console.error('Error saving owner config:', error);
      toast({ title: "Erro", description: "Falha ao salvar", variant: "destructive" });
    } finally { setSavingNotifs(false); }
  };

  const handleTestMessage = async () => {
    const phone = prompt('Digite o número de telefone para teste (com DDD):');
    if (!phone) return;
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId, phone, message: '🧪 Mensagem de teste do sistema!', messageType: 'test' })
      });
      let data: any = null;
      try { data = await response.json(); } catch { /* corpo não-JSON */ }
      if (data?.success) {
        toast({ title: "Enviado", description: "Mensagem de teste enviada" });
      } else {
        // Mostra o motivo REAL devolvido pelo servidor (antes o toast era
        // genérico e escondia a causa: instância, enabled, secrets, etc).
        const reason = data?.message || data?.error || `Erro HTTP ${response.status}`;
        throw new Error(reason);
      }
    } catch (error: any) {
      console.error('Error sending test:', error);
      toast({
        title: "Falha ao enviar mensagem de teste",
        description: error?.message || "Erro desconhecido — veja o console do navegador.",
        variant: "destructive",
      });
    }
  };

  const toggleExpanded = (key: string) => setExpandedCards(prev => ({ ...prev, [key]: !prev[key] }));

  const isConnected = config?.instance_status === 'connected';
  const isPending = config?.instance_status === 'pending' || config?.instance_status === 'connecting';
  const isStatusKnown = statusChecked;

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  const renderNotificationCard = (
    type: string,
    def: { label: string; icon: any; variables: string; color: string },
    configs: Record<string, NotificationConfig>,
    setConfigs: React.Dispatch<React.SetStateAction<Record<string, NotificationConfig>>>,
    showDelay?: boolean
  ) => {
    const conf = configs[type];
    if (!conf) return null;
    const Icon = def.icon;
    const isExpanded = expandedCards[type] || false;

    return (
      <Card key={type}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon className={`h-5 w-5 ${def.color}`} />
              <span className="font-medium">{def.label}</span>
            </div>
            <Switch
              checked={conf.is_active}
              onCheckedChange={(checked) =>
                setConfigs(prev => ({ ...prev, [type]: { ...prev[type], is_active: checked } }))
              }
            />
          </div>

          <Collapsible open={isExpanded} onOpenChange={() => toggleExpanded(type)}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between">
                Editar Template
                <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">
                Variáveis: {def.variables.split(', ').map(v => (
                  <code key={v} className="bg-muted px-1 rounded mx-0.5">{v}</code>
                ))}
              </p>
              <Textarea
                value={conf.template_message}
                onChange={(e) =>
                  setConfigs(prev => ({ ...prev, [type]: { ...prev[type], template_message: e.target.value } }))
                }
                rows={4}
              />
              {showDelay && (
                <div className="flex items-center gap-2">
                  <Label className="text-sm whitespace-nowrap">Delay (min):</Label>
                  <Input
                    type="number"
                    min="0"
                    className="w-24"
                    value={conf.send_delay_minutes}
                    onChange={(e) =>
                      setConfigs(prev => ({ ...prev, [type]: { ...prev[type], send_delay_minutes: parseInt(e.target.value) || 0 } }))
                    }
                  />
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Notificações WhatsApp</h2>
        <p className="text-muted-foreground">Configure notificações automáticas via WhatsApp</p>
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Status da Conexão
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isConnected ? (
                <>
                  <div className="h-3 w-3 rounded-full bg-green-500 animate-pulse" />
                  <span className="font-medium text-green-600">Conectado</span>
                  <Badge variant="secondary" className="gap-1">
                    <Smartphone className="h-3 w-3" />
                    {config?.connected_phone || 'WhatsApp Business'}
                  </Badge>
                </>
              ) : isPending ? (
                <>
                  <div className="h-3 w-3 rounded-full bg-yellow-500 animate-pulse" />
                  <span className="font-medium text-yellow-600">Aguardando conexão...</span>
                </>
              ) : (
                <>
                  <div className="h-3 w-3 rounded-full bg-gray-400" />
                  <span className="font-medium text-muted-foreground">Desconectado</span>
                </>
              )}
            </div>
            <div className="flex gap-2">
              {isConnected ? (
                <>
                  <Button variant="outline" size="sm" onClick={handleTestMessage}>
                    <Send className="h-4 w-4 mr-2" />Testar
                  </Button>
                  <Button variant="destructive" size="sm" onClick={handleDisconnect}>
                    <WifiOff className="h-4 w-4 mr-2" />Desconectar
                  </Button>
                </>
              ) : (
                <Button onClick={handleConnect} disabled={connecting}>
                  {connecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <QrCode className="h-4 w-4 mr-2" />}
                  {connecting ? 'Gerando...' : 'Conectar WhatsApp'}
                </Button>
              )}
            </div>
          </div>

          {connectFlowActive && !isConnected && (
            <div className="flex flex-col items-center gap-4 py-6 border rounded-lg bg-white">
              {qrCodeDataUrl ? (
                <>
                  <p className="text-sm text-muted-foreground">Escaneie o QR Code com seu WhatsApp</p>
                  <img src={qrCodeDataUrl} alt="QR Code WhatsApp" className="w-64 h-64" />
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={handleConnect} disabled={connecting}>
                      <RefreshCw className={`h-4 w-4 mr-2 ${connecting ? 'animate-spin' : ''}`} />Gerar novo QR Code
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleCancelConnect}>Cancelar</Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Gerando QR Code...</p>
                  <Button variant="outline" size="sm" onClick={handleCancelConnect} className="mt-2">Cancelar</Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {isStatusKnown && !isConnected && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-orange-600">⚠️ O WhatsApp não está conectado. As notificações só serão enviadas quando a conexão estiver ativa.</p>
          </CardContent>
        </Card>
      )}

      {/* Sub-tabs: Cliente / Dono / Reservas */}
      <Tabs defaultValue="cliente" className="w-full">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="cliente">Para o Cliente</TabsTrigger>
          <TabsTrigger value="dono">Para o Dono</TabsTrigger>
          <TabsTrigger value="reservas">Reservas</TabsTrigger>
        </TabsList>

        {/* Cliente Tab */}
        <TabsContent value="cliente" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Star className="h-5 w-5 text-yellow-500" />
                Link de Avaliação
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="reviewLink">
                Usado na variável {"{{link_avaliacao}}"} da mensagem de pedido finalizado
              </Label>
              <Input
                id="reviewLink"
                placeholder="Ex: https://g.page/r/SEU_LINK_GOOGLE/review (vazio = página do pedido)"
                value={reviewLink}
                onChange={(e) => setReviewLink(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Cole aqui o link de avaliação do Google (ou qualquer link personalizado).
                Se deixar vazio, o cliente recebe o link da página do pedido no app.
              </p>
            </CardContent>
          </Card>
          {Object.entries(CLIENT_NOTIFICATION_DEFAULTS).map(([type, def]) =>
            renderNotificationCard(type, def, clientNotifs, setClientNotifs, type === 'cart_recovery')
          )}
          <Button onClick={() => handleSaveNotificationConfigs(clientNotifs)} disabled={savingNotifs} className="w-full">
            {savingNotifs && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar Notificações do Cliente
          </Button>
        </TabsContent>

        {/* Dono Tab */}
        <TabsContent value="dono" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><User className="h-5 w-5" />Dados do Dono</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome do Dono</Label>
                  <Input
                    value={ownerConfig.owner_name}
                    onChange={(e) => setOwnerConfig(prev => ({ ...prev, owner_name: e.target.value }))}
                    placeholder="Nome completo"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />WhatsApp do Dono</Label>
                  <Input
                    value={ownerConfig.owner_phone}
                    onChange={(e) => setOwnerConfig(prev => ({ ...prev, owner_phone: e.target.value.replace(/\D/g, '') }))}
                    placeholder="5514999999999"
                    maxLength={13}
                  />
                  <p className="text-xs text-muted-foreground">Com código do país: 55 + DDD + número</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {Object.entries(OWNER_NOTIFICATION_DEFAULTS).map(([type, def]) => {
            const conf = ownerNotifs[type];
            if (!conf) return null;
            const Icon = def.icon;
            const isExpanded = expandedCards[type] || false;
            const ownerToggle = ownerConfig[def.configField] as boolean;

            return (
              <Card key={type}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-5 w-5 ${def.color}`} />
                      <span className="font-medium">{def.label}</span>
                    </div>
                    <Switch
                      checked={ownerToggle && conf.is_active}
                      onCheckedChange={(checked) => {
                        setOwnerConfig(prev => ({ ...prev, [def.configField]: checked }));
                        setOwnerNotifs(prev => ({ ...prev, [type]: { ...prev[type], is_active: checked } }));
                      }}
                    />
                  </div>

                  {type === 'daily_summary' && (
                    <div className="flex items-center gap-2">
                      <Label className="text-sm whitespace-nowrap">Horário do envio:</Label>
                      <Input
                        type="time"
                        className="w-32"
                        value={ownerConfig.daily_summary_time}
                        onChange={(e) => setOwnerConfig(prev => ({ ...prev, daily_summary_time: e.target.value }))}
                      />
                    </div>
                  )}

                  <Collapsible open={isExpanded} onOpenChange={() => toggleExpanded(type)}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-full justify-between">
                        Editar Template
                        <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-2 pt-2">
                      <p className="text-xs text-muted-foreground">
                        Variáveis: {def.variables.split(', ').map(v => (
                          <code key={v} className="bg-muted px-1 rounded mx-0.5">{v}</code>
                        ))}
                      </p>
                      <Textarea
                        value={conf.template_message}
                        onChange={(e) =>
                          setOwnerNotifs(prev => ({ ...prev, [type]: { ...prev[type], template_message: e.target.value } }))
                        }
                        rows={4}
                      />
                    </CollapsibleContent>
                  </Collapsible>
                </CardContent>
              </Card>
            );
          })}

          <Button onClick={handleSaveOwnerConfig} disabled={savingNotifs} className="w-full">
            {savingNotifs && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar Configurações do Dono
          </Button>
        </TabsContent>

        {/* Reservas Tab */}
        <TabsContent value="reservas" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle>Templates de Reservas</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Variáveis: <code className="bg-muted px-1 rounded">{'{nome}'}</code>,
                <code className="bg-muted px-1 rounded ml-1">{'{mesa}'}</code>,
                <code className="bg-muted px-1 rounded ml-1">{'{data}'}</code>,
                <code className="bg-muted px-1 rounded ml-1">{'{horario}'}</code>,
                <code className="bg-muted px-1 rounded ml-1">{'{pessoas}'}</code>
              </p>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-yellow-600" />Reserva Criada (Pendente)
                </Label>
                <Textarea value={messages.reservation_created} onChange={(e) => setMessages(prev => ({ ...prev, reservation_created: e.target.value }))} rows={4} />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />Reserva Confirmada
                </Label>
                <Textarea value={messages.reservation_confirmed} onChange={(e) => setMessages(prev => ({ ...prev, reservation_confirmed: e.target.value }))} rows={4} />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-red-600" />Reserva Cancelada
                </Label>
                <Textarea value={messages.reservation_cancelled} onChange={(e) => setMessages(prev => ({ ...prev, reservation_cancelled: e.target.value }))} rows={3} />
              </div>

              <Button onClick={handleSaveReservations} disabled={saving} className="w-full">
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Salvar Configurações de Reservas
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default WhatsAppSettings;

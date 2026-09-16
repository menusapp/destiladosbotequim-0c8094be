import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { copiarTexto } from "@/lib/clipboard";
import {
  Monitor, Copy, ExternalLink, CreditCard, Banknote, QrCode,
  UtensilsCrossed, ShoppingBag, Truck, Store, Users, Gift, Tag, Percent, Timer, Loader2, Save,
  Wifi, WifiOff, RefreshCw, CheckCircle2, AlertTriangle, Zap,
} from "lucide-react";

interface Props {
  restaurantId: string;
}

interface KioskConfig {
  id: string;
  enabled: boolean;
  payment_cash: boolean;
  payment_card: boolean;
  payment_pix: boolean;
  payment_online: boolean;
  order_dine_in: boolean;
  order_takeaway: boolean;
  order_pickup: boolean;
  order_delivery: boolean;
  require_cpf: boolean;
  loyalty_enabled: boolean;
  coupons_enabled: boolean;
  promotions_enabled: boolean;
  inactivity_timeout_seconds: number;
}

interface PointTerminal {
  id: string;
  device_id: string;
  device_name: string | null;
  operating_mode: string;
  use_on_kiosk: boolean;
  mp_store_id: string | null;
  mp_pos_id: string | null;
}

export default function KioskSettings({ restaurantId }: Props) {
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [localConfig, setLocalConfig] = useState<KioskConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [slug, setSlug] = useState<string>("");
  const [hasChanges, setHasChanges] = useState(false);

  // Point terminal state
  const [mpConnected, setMpConnected] = useState(false);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null);
  const [savedTerminals, setSavedTerminals] = useState<PointTerminal[]>([]);
  const [discoveredDevices, setDiscoveredDevices] = useState<any[]>([]);
  const [loadingTerminals, setLoadingTerminals] = useState(false);
  const [savingTerminal, setSavingTerminal] = useState(false);
  const [testingPayment, setTestingPayment] = useState(false);
  const [creatingStore, setCreatingStore] = useState(false);
  const [pendingOrderBlocked, setPendingOrderBlocked] = useState(false);
  const [cancellingPending, setCancellingPending] = useState(false);
  const [switchingMode, setSwitchingMode] = useState(false);

  useEffect(() => {
    fetchConfig();
    fetchMpStatus();
    fetchSavedTerminals();
  }, [restaurantId]);

  useEffect(() => {
    if (config && localConfig) {
      setHasChanges(JSON.stringify(config) !== JSON.stringify(localConfig));
    }
  }, [config, localConfig]);

  const fetchConfig = async () => {
    try {
      const { data: rest } = await supabase
        .from("restaurants")
        .select("slug")
        .eq("id", restaurantId)
        .single();
      if (rest) setSlug(rest.slug);

      const { data, error } = await supabase
        .from("kiosk_config")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setConfig(data as any);
        setLocalConfig(data as any);
      } else {
        const { data: newConfig, error: insertErr } = await supabase
          .from("kiosk_config")
          .insert({ restaurant_id: restaurantId })
          .select()
          .single();
        if (insertErr) throw insertErr;
        setConfig(newConfig as any);
        setLocalConfig(newConfig as any);
      }
    } catch (err) {
      console.error("[KioskSettings] Error loading config:", err);
      toast.error("Erro ao carregar configurações do Totem");
    } finally {
      setLoading(false);
    }
  };

  const fetchMpStatus = async () => {
    try {
      const { data } = await supabase.rpc("check_mp_token_expiry", { p_restaurant_id: restaurantId });
      if (data && data.length > 0) {
        const row = data[0];
        setMpConnected(!!row.has_token);
        setTokenExpired(!!row.is_expired);
        setTokenExpiresAt(row.expires_at);
      }
    } catch (err) {
      console.error("[KioskSettings] Error checking MP status:", err);
    }
  };

  const fetchSavedTerminals = async () => {
    try {
      const { data } = await supabase.rpc("admin_get_point_terminals", { p_restaurant_id: restaurantId });
      if (data) setSavedTerminals(data as any[]);
    } catch (err) {
      console.error("[KioskSettings] Error loading terminals:", err);
    }
  };

  const handleListTerminals = async () => {
    setLoadingTerminals(true);
    try {
      const { data } = await supabase.functions.invoke("mercadopago-point", {
        body: { action: "list_terminals", restaurant_id: restaurantId },
      });
      if (!data?.ok) {
        toast.error(data?.error || "Erro ao buscar maquininhas");
        return;
      }
      const payload = data.data;
      const devices = payload?.devices || payload || [];
      setDiscoveredDevices(Array.isArray(devices) ? devices : []);
      if (Array.isArray(devices) && devices.length === 0) {
        toast.info("Nenhuma maquininha encontrada na conta");
      } else {
        toast.success(`${Array.isArray(devices) ? devices.length : 0} maquininha(s) encontrada(s)`);
      }
    } catch (err: any) {
      console.error("[KioskSettings] List terminals error:", err);
      toast.error(err?.message || "Erro ao buscar maquininhas");
    } finally {
      setLoadingTerminals(false);
    }
  };

  const handleSelectTerminal = async (device: any) => {
    setSavingTerminal(true);
    try {
      const deviceId = device.id || device.device_id;
      const { error } = await supabase.rpc("admin_upsert_point_terminal", {
        p_restaurant_id: restaurantId,
        p_device_id: deviceId,
        p_device_name: device.name || device.device_name || `Terminal ${deviceId}`,
        p_operating_mode: device.operating_mode || "PDV",
        p_use_on_kiosk: true,
        p_is_default_terminal: true,
        p_mp_store_id: device.store_id?.toString() || null,
        p_mp_pos_id: device.pos_id?.toString() || null,
      });
      if (error) throw error;
      toast.success("Maquininha selecionada para o Totem!");
      fetchSavedTerminals();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao salvar maquininha");
    } finally {
      setSavingTerminal(false);
    }
  };

  const handleSwitchToPDV = async (deviceId?: string) => {
    const target = deviceId || activeTerminal?.device_id;
    if (!target) return;
    setSwitchingMode(true);
    try {
      const { data } = await supabase.functions.invoke("mercadopago-point", {
        body: { action: "change_operating_mode", restaurant_id: restaurantId, device_id: target, mode: "PDV" },
      });
      if (!data?.ok) {
        toast.error(data?.error || "Erro ao trocar modo do terminal");
        return;
      }
      toast.success("Maquininha alterada para modo integrado (PDV)! Ela pode reiniciar.");
      // Update local state
      setDiscoveredDevices(prev => prev.map(d => (d.id || d.device_id) === target ? { ...d, operating_mode: "PDV" } : d));
      setSavedTerminals(prev => prev.map(t => t.device_id === target ? { ...t, operating_mode: "PDV" } : t));
    } catch (err: any) {
      toast.error(err?.message || "Erro ao trocar modo");
    } finally {
      setSwitchingMode(false);
    }
  };

  const handleCreateStoreAndPos = async () => {
    setCreatingStore(true);
    try {
      const { data: storeRes } = await supabase.functions.invoke("mercadopago-point", {
        body: {
          action: "create_store",
          restaurant_id: restaurantId,
          name: `Loja Totem - ${restaurantId.slice(0, 8)}`,
          external_id: `store-${restaurantId}`,
          location: { street_name: "Endereço do restaurante", city_name: "Cidade", state_name: "Estado" },
        },
      });
      if (!storeRes?.ok) {
        toast.error(storeRes?.error || "Erro ao criar loja");
        return;
      }
      const storeId = storeRes.data?.id;

      const externalPosId = `pos-totem-${restaurantId}`;
      const { data: posRes } = await supabase.functions.invoke("mercadopago-point", {
        body: {
          action: "create_pos",
          restaurant_id: restaurantId,
          name: `Totem POS`,
          external_id: externalPosId,
          external_store_id: `store-${restaurantId}`,
          fixed_amount: false,
        },
      });
      if (!posRes?.ok) {
        toast.error(posRes?.error || "Erro ao criar caixa");
        return;
      }

      // The edge function now auto-saves mp_external_pos_id to online_payment_config
      // The edge function now auto-saves mp_external_pos_id to online_payment_config

      const terminal = savedTerminals.find(t => t.use_on_kiosk);
      if (terminal) {
        await supabase.rpc("admin_upsert_point_terminal", {
          p_restaurant_id: restaurantId,
          p_device_id: terminal.device_id,
          p_mp_external_store_id: storeId?.toString() || null,
          p_mp_external_pos_id: posRes.data?.id?.toString() || null,
          p_use_on_kiosk: true,
        });

        // Auto-switch to PDV mode
        if (terminal.operating_mode !== "PDV") {
          await handleSwitchToPDV(terminal.device_id);
        }
      }

      toast.success("Loja e Caixa criados com sucesso! PIX QR Code direto ativado.");
      fetchSavedTerminals();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao criar loja/caixa");
    } finally {
      setCreatingStore(false);
    }
  };

  // Polling state
  const [pollingOrderId, setPollingOrderId] = useState<string | null>(null);
  const [pollingStatus, setPollingStatus] = useState<string | null>(null);

  // Polling effect
  useEffect(() => {
    if (!pollingOrderId) return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 40; // 40 * 3s = 2 min

    const poll = async () => {
      if (cancelled || attempts >= maxAttempts) {
        if (attempts >= maxAttempts) {
          setPollingStatus("timeout");
          toast.error("Timeout — verifique a maquininha manualmente");
        }
        setPollingOrderId(null);
        return;
      }
      attempts++;
      try {
        const { data } = await supabase.functions.invoke("mercadopago-point", {
          body: { action: "get_order", restaurant_id: restaurantId, mp_order_id: pollingOrderId },
        });
        const status = data?.data?.internal_status || data?.data?.status;
        setPollingStatus(status);
        if (status === "paid" || status === "approved" || status === "processed") {
          toast.success("✅ Pagamento aprovado na maquininha!");
          setPollingOrderId(null);
          return;
        }
        if (status === "failed" || status === "canceled" || status === "cancelled" || status === "expired") {
          toast.error(`Pagamento ${status === "failed" ? "recusado" : "cancelado"}`);
          setPollingOrderId(null);
          return;
        }
      } catch {
        // ignore polling errors
      }
      if (!cancelled) setTimeout(poll, 3000);
    };

    setTimeout(poll, 2000); // first check after 2s
    return () => { cancelled = true; };
  }, [pollingOrderId, restaurantId]);

  const handleTestPayment = async () => {
    const terminal = savedTerminals.find(t => t.use_on_kiosk);
    if (!terminal) {
      toast.error("Selecione uma maquininha primeiro");
      return;
    }
    setTestingPayment(true);
    setPollingStatus(null);
    try {
      const { data } = await supabase.functions.invoke("mercadopago-point", {
        body: {
          action: "test_order",
          restaurant_id: restaurantId,
          device_id: terminal.device_id,
        },
      });
      if (!data?.ok) {
        if (data?.code === "already_queued_order_on_terminal") {
          setPendingOrderBlocked(true);
        }
        toast.error(data?.error || "Erro ao criar cobrança de teste");
        return;
      }
      setPendingOrderBlocked(false);
      const mpOrderId = data.data?.id;
      if (mpOrderId) {
        toast.success("Cobrança enviada! Aguardando resposta da maquininha...");
        setPollingOrderId(mpOrderId);
        setPollingStatus("waiting_terminal");
      } else {
        toast.error("Resposta inesperada do Mercado Pago");
      }
    } catch (err: any) {
      toast.error(err?.message || "Erro no teste");
    } finally {
      setTestingPayment(false);
    }
  };

  const handleCancelPending = async () => {
    const terminal = savedTerminals.find(t => t.use_on_kiosk);
    if (!terminal) return;
    setCancellingPending(true);
    try {
      const { data: cancelRes } = await supabase.functions.invoke("mercadopago-point", {
        body: { action: "cancel_device_pending", restaurant_id: restaurantId, device_id: terminal.device_id },
      });

      if (cancelRes?.ok) {
        toast.success("Cobrança pendente cancelada! Agora pode testar novamente.");
        setPendingOrderBlocked(false);
      } else {
        toast.error(cancelRes?.error || "Erro ao cancelar cobrança pendente");
      }
    } catch (err: any) {
      toast.error(err?.message || "Erro ao cancelar");
    } finally {
      setCancellingPending(false);
    }
  };

  const updateLocal = (updates: Partial<KioskConfig>) => {
    if (!localConfig) return;
    setLocalConfig({ ...localConfig, ...updates });
  };

  const handleSave = async () => {
    if (!localConfig || !config) return;
    setSaving(true);
    try {
      const payload = { ...localConfig, updated_at: new Date().toISOString() };
      delete (payload as any).id;
      const { error } = await supabase
        .from("kiosk_config")
        .update(payload)
        .eq("id", config.id);
      if (error) throw error;
      setConfig({ ...localConfig });
      setHasChanges(false);
      toast.success("Configurações do Totem salvas!");
    } catch (err) {
      console.error("[KioskSettings] Erro ao salvar:", err);
      toast.error("Erro ao salvar configurações");
    } finally {
      setSaving(false);
    }
  };

  const kioskUrl = slug ? `${window.location.origin}/${slug}/kiosk` : "";

  const copyLink = () => {
    if (!kioskUrl) return;
    copiarTexto(kioskUrl);
    toast.success("Link copiado!");
  };

  const daysUntilExpiry = tokenExpiresAt
    ? Math.ceil((new Date(tokenExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  const activeTerminal = savedTerminals.find(t => t.use_on_kiosk);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!localConfig) return null;

  return (
    <div className="space-y-4">
      {/* Save button sticky */}
      {hasChanges && (
        <div className="sticky top-0 z-10 bg-card border rounded-xl p-3 shadow-lg flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">Você tem alterações não salvas</span>
          <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar alterações
          </Button>
        </div>
      )}

      {/* Row 1: Status + Link */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Monitor className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Status do Totem</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={localConfig.enabled ? "default" : "secondary"} className="text-xs">
                  {localConfig.enabled ? "Ativo" : "Inativo"}
                </Badge>
                <Switch
                  checked={localConfig.enabled}
                  onCheckedChange={(v) => updateLocal({ enabled: v })}
                />
              </div>
            </div>
          </CardHeader>
        </Card>

        {localConfig.enabled && kioskUrl && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ExternalLink className="h-4 w-4 text-primary" />
                Link do Totem
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex items-center gap-2">
                <Input value={kioskUrl} readOnly className="font-mono text-xs h-8" />
                <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={copyLink}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" asChild>
                  <a href={kioskUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Row 2: Order Types + Payments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tipos de Pedido</CardTitle>
            <CardDescription className="text-xs">Opções de consumo disponíveis</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <ToggleRow icon={UtensilsCrossed} label="Comer no local" checked={localConfig.order_dine_in} onChange={(v) => updateLocal({ order_dine_in: v })} />
            <ToggleRow icon={ShoppingBag} label="Para viagem" checked={localConfig.order_takeaway} onChange={(v) => updateLocal({ order_takeaway: v })} />
            <ToggleRow icon={Store} label="Retirada no balcão" checked={localConfig.order_pickup} onChange={(v) => updateLocal({ order_pickup: v })} />
            <ToggleRow icon={Truck} label="Entrega" checked={localConfig.order_delivery} onChange={(v) => updateLocal({ order_delivery: v })} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Formas de Pagamento</CardTitle>
            <CardDescription className="text-xs">Meios aceitos no totem</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <ToggleRow icon={Banknote} label="Dinheiro" checked={localConfig.payment_cash} onChange={(v) => updateLocal({ payment_cash: v })} />
            <ToggleRow icon={CreditCard} label="Cartão na maquininha" checked={localConfig.payment_card} onChange={(v) => updateLocal({ payment_card: v })} />
            <ToggleRow icon={QrCode} label="PIX na maquininha" checked={localConfig.payment_pix} onChange={(v) => updateLocal({ payment_pix: v })} />
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Maquininha do Totem (Point Terminal) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Maquininha do Totem (Mercado Pago Point)
          </CardTitle>
          <CardDescription className="text-xs">
            Conecte uma maquininha para receber pagamentos presenciais no totem
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {/* Connection status */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            {mpConnected ? (
              tokenExpired ? (
                <>
                  <WifiOff className="h-5 w-5 text-destructive" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-destructive">Token expirado</p>
                    <p className="text-xs text-muted-foreground">Reconecte a conta Mercado Pago nas configurações de Pagamentos Online</p>
                  </div>
                </>
              ) : (
                <>
                  <Wifi className="h-5 w-5 text-green-600" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-600">Conta Mercado Pago conectada</p>
                    {daysUntilExpiry !== null && daysUntilExpiry <= 30 && (
                      <p className="text-xs text-amber-600 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Token expira em {daysUntilExpiry} dia(s) — reconecte em breve
                      </p>
                    )}
                  </div>
                </>
              )
            ) : (
              <>
                <WifiOff className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-muted-foreground">Conta Mercado Pago não conectada</p>
                  <p className="text-xs text-muted-foreground">Conecte nas configurações de Pagamentos Online primeiro</p>
                </div>
              </>
            )}
          </div>

          {mpConnected && !tokenExpired && (
            <>
              <Separator />

              {/* Step 1: List terminals */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">1. Buscar Maquininhas</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleListTerminals}
                    disabled={loadingTerminals}
                    className="gap-2"
                  >
                    {loadingTerminals ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Buscar
                  </Button>
                </div>

                {discoveredDevices.length > 0 && (
                  <div className="space-y-2">
                    {discoveredDevices.map((device: any) => (
                      <div
                        key={device.id || device.device_id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card"
                      >
                        <div>
                          <p className="text-sm font-medium">{device.name || device.id || device.device_id}</p>
                          <p className="text-xs text-muted-foreground">
                            ID: {device.id || device.device_id} — Modo: {device.operating_mode || "?"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {device.operating_mode === "STANDALONE" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSwitchToPDV(device.id || device.device_id)}
                              disabled={switchingMode}
                              className="gap-1 text-xs"
                            >
                              {switchingMode ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                              Ativar PDV
                            </Button>
                          )}
                          <Button
                            variant={activeTerminal?.device_id === (device.id || device.device_id) ? "default" : "outline"}
                            size="sm"
                            onClick={() => handleSelectTerminal(device)}
                            disabled={savingTerminal}
                          >
                            {activeTerminal?.device_id === (device.id || device.device_id) ? (
                              <><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Ativo</>
                            ) : (
                              "Selecionar"
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Active terminal info */}
              {activeTerminal && (
                <>
                  <Separator />

                  <div className="p-3 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <p className="text-sm font-medium text-green-700 dark:text-green-400">
                        Terminal ativo: {activeTerminal.device_name || activeTerminal.device_id}
                      </p>
                    </div>
                   </div>

                  {/* Operating mode warning */}
                  {activeTerminal.operating_mode === "STANDALONE" && (
                    <div className="flex items-center justify-between p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700">
                      <div className="flex items-center gap-2 flex-1">
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Modo manual (STANDALONE)</p>
                          <p className="text-xs text-muted-foreground">A maquininha precisa estar em modo integrado (PDV) para receber cobranças do sistema</p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSwitchToPDV()}
                        disabled={switchingMode}
                        className="gap-2 ml-3 shrink-0"
                      >
                        {switchingMode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                        Ativar modo integrado
                      </Button>
                    </div>
                  )}

                  {activeTerminal.operating_mode === "PDV" && (
                    <div className="flex items-center gap-2 p-3 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <p className="text-sm font-medium text-green-700 dark:text-green-400">Modo integrado (PDV) ativo</p>
                    </div>
                  )}

                  {/* Step 2: Create Store & POS — skip if already exists */}
                  {activeTerminal.mp_store_id && activeTerminal.mp_pos_id ? (
                    <div className="flex items-center gap-2 p-3 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <div>
                        <p className="text-sm font-medium text-green-700 dark:text-green-400">Loja e Caixa já configurados</p>
                        <p className="text-xs text-muted-foreground">Store: {activeTerminal.mp_store_id} | POS: {activeTerminal.mp_pos_id}</p>
                        <p className="text-xs text-green-600">✅ PIX QR Code direto ativo</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700">
                        <div className="flex items-center gap-2 flex-1">
                          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">POS não configurado</p>
                            <p className="text-xs text-muted-foreground">O PIX abrirá a tela de seleção na maquininha. Configure o POS para ativar o QR Code direto.</p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCreateStoreAndPos}
                          disabled={creatingStore}
                          className="gap-2 ml-3 shrink-0"
                        >
                          {creatingStore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Store className="h-3.5 w-3.5" />}
                          Configurar POS
                        </Button>
                      </div>
                    </>
                  )}

                  {/* Step 3: Test */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{activeTerminal.mp_store_id ? "2" : "3"}. Testar Cobrança</p>
                      <p className="text-xs text-muted-foreground">Envia R$ 1,00 para a maquininha</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleTestPayment}
                      disabled={testingPayment}
                      className="gap-2"
                    >
                      {testingPayment ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                      Testar
                    </Button>
                   </div>

                  {/* Polling status */}
                  {pollingOrderId && (
                    <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/50 animate-pulse">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <div>
                        <p className="text-sm font-medium">
                          {pollingStatus === "waiting_terminal" && "Aguardando pagamento na maquininha..."}
                          {pollingStatus === "processing" && "Processando pagamento..."}
                          {pollingStatus === "timeout" && "Timeout — verifique manualmente"}
                          {!pollingStatus && "Verificando status..."}
                        </p>
                        <p className="text-xs text-muted-foreground">ID: {pollingOrderId.slice(0, 12)}...</p>
                      </div>
                    </div>
                  )}

                  {/* Cancel pending order */}
                  {pendingOrderBlocked && (
                    <div className="flex items-center justify-between bg-destructive/10 rounded-lg p-3">
                      <div>
                        <p className="text-sm font-medium text-destructive">Cobrança pendente detectada</p>
                        <p className="text-xs text-muted-foreground">Cancele a anterior para testar novamente</p>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleCancelPending}
                        disabled={cancellingPending}
                        className="gap-2"
                      >
                        {cancellingPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                        Cancelar Pendente
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Row 4: Identification + Loyalty + Timeout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Identificação
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ToggleRow icon={Users} label="Exigir CPF" checked={localConfig.require_cpf} onChange={(v) => updateLocal({ require_cpf: v })} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Gift className="h-4 w-4 text-primary" />
              Fidelidade e Promoções
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <ToggleRow icon={Gift} label="Programa de fidelidade" checked={localConfig.loyalty_enabled} onChange={(v) => updateLocal({ loyalty_enabled: v })} />
            <ToggleRow icon={Tag} label="Cupons de desconto" checked={localConfig.coupons_enabled} onChange={(v) => updateLocal({ coupons_enabled: v })} />
            <ToggleRow icon={Percent} label="Promoções automáticas" checked={localConfig.promotions_enabled} onChange={(v) => updateLocal({ promotions_enabled: v })} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Timer className="h-4 w-4 text-primary" />
              Timeout
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              <Label className="text-xs">Segundos de inatividade</Label>
              <Input
                type="number"
                value={localConfig.inactivity_timeout_seconds}
                onChange={(e) => {
                  const val = Math.max(30, parseInt(e.target.value) || 120);
                  updateLocal({ inactivity_timeout_seconds: val });
                }}
                className="h-8 text-sm"
                min={30}
                max={600}
              />
              <p className="text-xs text-muted-foreground">
                {Math.floor(localConfig.inactivity_timeout_seconds / 60)}m {localConfig.inactivity_timeout_seconds % 60}s
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving || !hasChanges} size="sm" className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar alterações
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({
  icon: Icon, label, checked, onChange,
}: {
  icon: any; label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-sm">{label}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

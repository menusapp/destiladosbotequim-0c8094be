import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Loader2, ExternalLink, Copy, CheckCircle2, XCircle, Plug, Truck, CreditCard,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";

import { copiarTexto } from "@/lib/clipboard";
const SUPABASE_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface IfoodConfig {
  id: string;
  restaurant_id: string;
  enabled: boolean;
  merchant_id: string | null;
  token_expires_at: string | null;
  access_token: string | null;
}

interface DDConfig {
  id: string;
  restaurant_id: string;
  enabled: boolean;
  store_id: string | null;
  username: string | null;
  access_token: string | null;
  token_expires_at: string | null;
}

interface MpConfig {
  id: string;
  connection_status: string;
  mp_access_token: string | null;
  connected_at: string | null;
}

interface IntegrationsTabProps {
  restaurantId: string;
}

const IntegrationsTab = ({ restaurantId }: IntegrationsTabProps) => {
  const confirm = useConfirmDialog();
  // iFood state
  const [ifoodSheetOpen, setIfoodSheetOpen] = useState(false);
  const [ifoodConfig, setIfoodConfig] = useState<IfoodConfig | null>(null);
  const [ifoodLoading, setIfoodLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const [authCode, setAuthCode] = useState("");

  // DD state
  const [ddSheetOpen, setDdSheetOpen] = useState(false);
  const [ddConfig, setDdConfig] = useState<DDConfig | null>(null);
  const [ddLoading, setDdLoading] = useState(true);
  const [ddConnecting, setDdConnecting] = useState(false);
  const [ddStoreId, setDdStoreId] = useState("");
  const [ddUsername, setDdUsername] = useState("");
  const [ddPassword, setDdPassword] = useState("");

  // Mercado Pago state
  const [mpSheetOpen, setMpSheetOpen] = useState(false);
  const [mpConfig, setMpConfig] = useState<MpConfig | null>(null);
  const [mpLoading, setMpLoading] = useState(true);
  const [startingOAuth, setStartingOAuth] = useState(false);
  const [disconnectingMp, setDisconnectingMp] = useState(false);

  // Facebook Pixel state
  const [fbPixelSheetOpen, setFbPixelSheetOpen] = useState(false);
  const [fbPixelId, setFbPixelId] = useState("");
  const [fbPixelSaved, setFbPixelSaved] = useState(false);
  const [fbPixelLoading, setFbPixelLoading] = useState(true);
  const [fbPixelSaving, setFbPixelSaving] = useState(false);

  useEffect(() => {
    fetchIfoodConfig();
    fetchDdConfig();
    fetchMpConfig();
    fetchFbPixel();
  }, [restaurantId]);

  const fetchIfoodConfig = async () => {
    setIfoodLoading(true);
    try {
      const { data } = await supabase.rpc("admin_get_ifood_config", {
        p_restaurant_id: restaurantId,
      });
      if (data) {
        const parsed = typeof data === "string" ? JSON.parse(data) : data;
        setIfoodConfig(parsed as IfoodConfig);
      } else {
        setIfoodConfig(null);
      }
    } catch {
      setIfoodConfig(null);
    }
    setIfoodLoading(false);
  };

  const fetchDdConfig = async () => {
    setDdLoading(true);
    try {
      const { data } = await supabase.rpc("admin_get_dd_config", {
        p_restaurant_id: restaurantId,
      });
      if (data) {
        const parsed = typeof data === "string" ? JSON.parse(data) : data;
        setDdConfig(parsed as DDConfig);
      } else {
        setDdConfig(null);
      }
    } catch {
      setDdConfig(null);
    }
    setDdLoading(false);
  };

  const fetchMpConfig = async () => {
    setMpLoading(true);
    try {
      const { data: rows, error } = await supabase.rpc("admin_get_payment_config", {
        p_restaurant_id: restaurantId,
      });
      if (error) throw error;
      const data = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      if (data && data.mp_access_token && data.connection_status === "connected") {
        setMpConfig(data as unknown as MpConfig);
      } else {
        setMpConfig(null);
      }
    } catch {
      setMpConfig(null);
    } finally {
      setMpLoading(false);
    }
  };

  const fetchFbPixel = async () => {
    setFbPixelLoading(true);
    try {
      const { data } = await supabase
        .from("restaurants")
        .select("facebook_pixel_id")
        .eq("id", restaurantId)
        .single();
      const pixelId = data?.facebook_pixel_id || "";
      setFbPixelId(pixelId);
      setFbPixelSaved(!!pixelId);
    } catch { /* ignore */ }
    finally { setFbPixelLoading(false); }
  };

  const handleSaveFbPixel = async () => {
    setFbPixelSaving(true);
    try {
      const value = fbPixelId.trim() || null;
      const { error } = await supabase
        .from("restaurants")
        .update({ facebook_pixel_id: value } as any)
        .eq("id", restaurantId);
      if (error) throw error;
      setFbPixelSaved(!!value);
      toast.success(value ? "Pixel do Facebook salvo!" : "Pixel do Facebook removido!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    } finally {
      setFbPixelSaving(false);
    }
  };

  const isIfoodConnected = ifoodConfig?.access_token && ifoodConfig?.merchant_id;
  const isDdConnected = ddConfig?.access_token && ddConfig?.store_id && ddConfig?.enabled;
  const isMpConnected = !!mpConfig;
  const isFbPixelConfigured = fbPixelSaved;

  // === iFood handlers ===
  const handleGenerateCode = async () => {
    setGeneratingCode(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ifood-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": ANON_KEY },
        body: JSON.stringify({ action: "generate_code", restaurant_id: restaurantId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao gerar código");
      setUserCode(data.userCode);
      setVerificationUrl(data.verificationUrlComplete || data.verificationUrl);
      toast.success("Código gerado! Siga as instruções abaixo.");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleExchangeToken = async () => {
    if (!authCode.trim()) { toast.error("Cole o código de autorização do iFood"); return; }
    setConnecting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ifood-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": ANON_KEY },
        body: JSON.stringify({ action: "exchange_token", restaurant_id: restaurantId, authorization_code: authCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao conectar");
      toast.success("iFood conectado com sucesso!");
      setUserCode(null);
      setAuthCode("");
      await fetchIfoodConfig();
    } catch (err: any) { toast.error(err.message); }
    finally { setConnecting(false); }
  };

  const handleIfoodDisconnect = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ifood-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": ANON_KEY },
        body: JSON.stringify({ action: "disconnect", restaurant_id: restaurantId }),
      });
      if (!res.ok) throw new Error("Erro ao desconectar");
      toast.success("iFood desconectado");
      await fetchIfoodConfig();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleIfoodToggle = async (enabled: boolean) => {
    try {
      await supabase.rpc("admin_toggle_ifood" as any, { p_restaurant_id: restaurantId, p_enabled: enabled });
      setIfoodConfig((prev) => (prev ? { ...prev, enabled } : null));
      toast.success(enabled ? "Recebimento de pedidos ativado" : "Recebimento de pedidos desativado");
    } catch (err: any) { toast.error(err.message); }
  };

  const maskId = (id: string) => id.length > 8 ? `${id.slice(0, 4)}****${id.slice(-4)}` : id;

  // === DD handlers ===
  const handleDdConnect = async () => {
    if (!ddStoreId.trim() || !ddUsername.trim() || !ddPassword.trim()) {
      toast.error("Preencha Store ID, Username e Password");
      return;
    }
    setDdConnecting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/dd-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": ANON_KEY },
        body: JSON.stringify({
          action: "connect",
          restaurant_id: restaurantId,
          store_id: ddStoreId.trim(),
          username: ddUsername.trim(),
          password: ddPassword.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao conectar");
      toast.success("Delivery Direto conectado com sucesso!");
      setDdStoreId("");
      setDdUsername("");
      setDdPassword("");
      await fetchDdConfig();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDdConnecting(false);
    }
  };

  const handleDdDisconnect = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/dd-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": ANON_KEY },
        body: JSON.stringify({ action: "disconnect", restaurant_id: restaurantId }),
      });
      if (!res.ok) throw new Error("Erro ao desconectar");
      toast.success("Delivery Direto desconectado");
      await fetchDdConfig();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleDdToggle = async (enabled: boolean) => {
    try {
      await supabase.rpc("admin_toggle_dd", { p_restaurant_id: restaurantId, p_enabled: enabled });
      setDdConfig((prev) => (prev ? { ...prev, enabled } : null));
      toast.success(enabled ? "Recebimento de pedidos ativado" : "Recebimento de pedidos desativado");
    } catch (err: any) { toast.error(err.message); }
  };

  // === Mercado Pago handlers ===
  const handleStartMpOAuth = async () => {
    setStartingOAuth(true);
    try {
      let configId = mpConfig?.id;
      if (!configId) {
        const { data: newId, error: ensureError } = await supabase.rpc("admin_ensure_payment_config", {
          p_restaurant_id: restaurantId,
        });
        if (ensureError) throw ensureError;
        configId = newId;
      }

      const { data, error } = await supabase.functions.invoke("mercadopago-oauth", {
        method: "GET",
      });
      if (error) throw error;
      if (!data?.client_id) throw new Error("client_id não disponível");

      const redirectUri = `${window.location.origin}/admin/mercadopago/callback`;
      const authUrl = `https://auth.mercadopago.com.br/authorization?client_id=${data.client_id}&response_type=code&platform_id=mp&state=${configId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
      window.location.href = authUrl;
    } catch (error: any) {
      console.error("Error starting MP OAuth:", error);
      toast.error(error.message || "Erro ao iniciar conexão com Mercado Pago");
      setStartingOAuth(false);
    }
  };

  const handleMpDisconnect = async () => {
    const ok = await confirm({
      variant: "destructive",
      title: "Desconectar Mercado Pago?",
      description: "Você precisará reconectar para voltar a receber pagamentos online.",
      consequence: "Pedidos online em pagamentos pendentes podem ser afetados.",
    });
    if (!ok) return;
    setDisconnectingMp(true);
    try {
      const { error } = await supabase.rpc("admin_delete_payment_config", {
        p_restaurant_id: restaurantId,
      });
      if (error) throw error;
      setMpConfig(null);
      toast.success("Mercado Pago desconectado.");
    } catch (error) {
      console.error("Error disconnecting MP:", error);
      toast.error("Erro ao desconectar");
    } finally {
      setDisconnectingMp(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Integrações</h2>
        <p className="text-sm text-muted-foreground">Conecte plataformas externas ao seu restaurante</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* iFood Card */}
        <Card className="cursor-pointer hover:shadow-md transition-shadow border" onClick={() => setIfoodSheetOpen(true)}>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-[#EA1D2C]/10 flex items-center justify-center">
                  <Truck className="h-5 w-5 text-[#EA1D2C]" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">iFood</h3>
                  <p className="text-xs text-muted-foreground">Receba pedidos do iFood</p>
                </div>
              </div>
              {isIfoodConnected ? (
                <Badge className="bg-green-100 text-green-700 border-0 text-[10px]">Conectado</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">Desconectado</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Delivery Direto Card */}
        <Card className="cursor-pointer hover:shadow-md transition-shadow border" onClick={() => setDdSheetOpen(true)}>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-[#0066CC]/10 flex items-center justify-center">
                  <Plug className="h-5 w-5 text-[#0066CC]" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Delivery Direto</h3>
                  <p className="text-xs text-muted-foreground">Plataforma de delivery própria</p>
                </div>
              </div>
              {isDdConnected ? (
                <Badge className="bg-green-100 text-green-700 border-0 text-[10px]">Conectado</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">Desconectado</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Mercado Pago Card */}
        <Card className="cursor-pointer hover:shadow-md transition-shadow border" onClick={() => setMpSheetOpen(true)}>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-[#009EE3]/10 flex items-center justify-center">
                  <CreditCard className="h-5 w-5 text-[#009EE3]" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Mercado Pago</h3>
                  <p className="text-xs text-muted-foreground">Pagamentos online e maquininha</p>
                </div>
              </div>
              {mpLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : isMpConnected ? (
                <Badge className="bg-green-100 text-green-700 border-0 text-[10px]">Conectado</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">Desconectado</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Meta Pixel Card */}
        <Card className="cursor-pointer hover:shadow-md transition-shadow border" onClick={() => setFbPixelSheetOpen(true)}>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-[#0081FB]/10 flex items-center justify-center">
                  <svg className="h-5 w-5" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6.403 5.076c-2.302 2.456-3.527 6.066-3.527 10.763v4.32c0 4.698 1.225 8.308 3.527 10.764C8.707 33.382 12.111 34.8 16.5 34.8h3c4.389 0 7.793-1.418 10.097-3.877 2.302-2.456 3.527-6.066 3.527-10.763v-4.32c0-4.698-1.225-8.308-3.527-10.764C27.293 2.618 23.889 1.2 19.5 1.2h-3c-4.389 0-7.793 1.418-10.097 3.876z" fill="url(#meta-gradient)"/>
                    <path d="M10.74 23.452c0 .982.204 1.681.546 2.126.338.44.795.622 1.35.622.705 0 1.32-.348 1.975-1.276.527-.746 1.074-1.804 1.736-3.14l.88-1.778c.873-1.763 1.88-3.285 3.09-4.338 1.01-.878 2.1-1.368 3.24-1.368 1.603 0 2.946.763 3.968 2.218 1.104 1.572 1.675 3.636 1.675 6.102 0 1.42-.224 2.525-.616 3.352-.37.782-.953 1.378-1.722 1.738l-.987-1.268c.5-.266.866-.66 1.1-1.238.244-.6.385-1.385.385-2.378 0-1.97-.376-3.648-1.12-4.876-.638-1.052-1.466-1.63-2.456-1.63-.838 0-1.614.47-2.38 1.37-.612.72-1.228 1.736-1.895 3.004l-.868 1.654c-1.056 2.012-1.88 3.3-2.65 4.192-.926 1.076-1.915 1.56-3.14 1.56-1.098 0-1.974-.42-2.604-1.22-.608-.77-.997-1.892-.997-3.442 0-1.744.345-3.504 1.003-5.188l1.352.532c-.576 1.488-.864 2.99-.864 4.578z" fill="white"/>
                    <defs><linearGradient id="meta-gradient" x1="18" y1="1.2" x2="18" y2="34.8" gradientUnits="userSpaceOnUse"><stop stopColor="#0081FB"/><stop offset="1" stopColor="#0064E0"/></linearGradient></defs>
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Meta Pixel</h3>
                  <p className="text-xs text-muted-foreground">Rastreamento e campanhas</p>
                </div>
              </div>
              {fbPixelLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : isFbPixelConfigured ? (
                <Badge className="bg-green-100 text-green-700 border-0 text-[10px]">Ativo</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">Não configurado</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* iFood Config Sheet */}
      <Sheet open={ifoodSheetOpen} onOpenChange={setIfoodSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-[#EA1D2C]" />
              Configuração iFood
            </SheetTitle>
            <SheetDescription>Conecte sua loja iFood para receber pedidos automaticamente</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            {ifoodLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : isIfoodConnected ? (
              <div className="space-y-5">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium text-green-700">Conectado ao iFood</span>
                </div>
                {ifoodConfig?.merchant_id && (
                  <div><Label className="text-xs text-muted-foreground">Merchant ID</Label><p className="text-sm font-mono">{maskId(ifoodConfig.merchant_id)}</p></div>
                )}
                <Separator />
                <div className="flex items-center justify-between">
                  <div><Label className="text-sm font-medium">Receber pedidos</Label><p className="text-xs text-muted-foreground">Ativar ou pausar o recebimento</p></div>
                  <Switch checked={ifoodConfig?.enabled ?? false} onCheckedChange={handleIfoodToggle} />
                </div>
                <Separator />
                <Button variant="destructive" className="w-full" onClick={handleIfoodDisconnect}>
                  <XCircle className="h-4 w-4 mr-2" />Desconectar iFood
                </Button>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm">Como conectar:</h4>
                  <div className="space-y-2">
                    {["Clique em \"Gerar Código\" abaixo", "Acesse o Portal do Parceiro iFood e autorize", "Cole o código de autorização retornado"].map((text, i) => (
                      <div key={i} className="flex gap-3 items-start">
                        <span className="flex-shrink-0 h-6 w-6 rounded-full bg-[#EA1D2C] text-white text-xs flex items-center justify-center font-bold">{i + 1}</span>
                        <p className="text-sm text-muted-foreground">{text}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <Separator />
                {!userCode ? (
                  <Button className="w-full bg-[#EA1D2C] hover:bg-[#c4161f]" onClick={handleGenerateCode} disabled={generatingCode}>
                    {generatingCode ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plug className="h-4 w-4 mr-2" />}Gerar Código
                  </Button>
                ) : (
                  <div className="space-y-4">
                    <div className="p-3 rounded-lg bg-muted border">
                      <Label className="text-xs text-muted-foreground">Seu código de verificação:</Label>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-lg font-bold tracking-widest">{userCode}</code>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { copiarTexto(userCode); toast.success("Código copiado!"); }}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {verificationUrl && (
                      <Button variant="outline" className="w-full" onClick={() => window.open(verificationUrl, "_blank")}>
                        <ExternalLink className="h-4 w-4 mr-2" />Abrir Portal iFood para autorizar
                      </Button>
                    )}
                    <Separator />
                    <div className="space-y-2">
                      <Label className="text-sm">Código de autorização do iFood:</Label>
                      <Input placeholder="Cole aqui o código retornado pelo iFood" value={authCode} onChange={(e) => setAuthCode(e.target.value)} />
                      <Button className="w-full bg-[#EA1D2C] hover:bg-[#c4161f]" onClick={handleExchangeToken} disabled={connecting || !authCode.trim()}>
                        {connecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}Conectar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Delivery Direto Config Sheet */}
      <Sheet open={ddSheetOpen} onOpenChange={setDdSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5 text-[#0066CC]" />
              Configuração Delivery Direto
            </SheetTitle>
            <SheetDescription>Conecte sua loja do Delivery Direto para receber pedidos automaticamente</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            {ddLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : isDdConnected ? (
              <div className="space-y-5">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium text-green-700">Conectado ao Delivery Direto</span>
                </div>
                {ddConfig?.store_id && (
                  <div><Label className="text-xs text-muted-foreground">Store ID</Label><p className="text-sm font-mono">{maskId(ddConfig.store_id)}</p></div>
                )}
                {ddConfig?.username && (
                  <div><Label className="text-xs text-muted-foreground">Usuário</Label><p className="text-sm font-mono">{ddConfig.username}</p></div>
                )}
                <Separator />
                <div className="flex items-center justify-between">
                  <div><Label className="text-sm font-medium">Receber pedidos</Label><p className="text-xs text-muted-foreground">Ativar ou pausar o recebimento</p></div>
                  <Switch checked={ddConfig?.enabled ?? false} onCheckedChange={handleDdToggle} />
                </div>
                <Separator />
                <Button variant="destructive" className="w-full" onClick={handleDdDisconnect}>
                  <XCircle className="h-4 w-4 mr-2" />Desconectar Delivery Direto
                </Button>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm">Como conectar:</h4>
                  <div className="space-y-2">
                    {[
                      "Acesse o painel do Delivery Direto e copie o Store ID da sua loja",
                      "Insira o username e password gerados no painel",
                      "Clique em Conectar"
                    ].map((text, i) => (
                      <div key={i} className="flex gap-3 items-start">
                        <span className="flex-shrink-0 h-6 w-6 rounded-full bg-[#0066CC] text-white text-xs flex items-center justify-center font-bold">{i + 1}</span>
                        <p className="text-sm text-muted-foreground">{text}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <Separator />
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-sm">Store ID</Label>
                    <Input placeholder="Ex: abc123-store-id" value={ddStoreId} onChange={(e) => setDdStoreId(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Username</Label>
                    <Input placeholder="Usuário gerado no painel DD" value={ddUsername} onChange={(e) => setDdUsername(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Password</Label>
                    <PasswordInput placeholder="Senha gerada no painel DD" value={ddPassword} onChange={(e) => setDdPassword(e.target.value)} />
                  </div>
                  <Button className="w-full bg-[#0066CC] hover:bg-[#0055AA]" onClick={handleDdConnect} disabled={ddConnecting || !ddStoreId.trim() || !ddUsername.trim() || !ddPassword.trim()}>
                    {ddConnecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}Conectar
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Mercado Pago Config Sheet */}
      <Sheet open={mpSheetOpen} onOpenChange={setMpSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-[#009EE3]" />
              Mercado Pago
            </SheetTitle>
            <SheetDescription>Conecte sua conta do Mercado Pago para pagamentos online e maquininha</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            {mpLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : isMpConnected ? (
              <div className="space-y-5">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium text-green-700">Conectado ao Mercado Pago</span>
                </div>
                {mpConfig?.connected_at && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Conectado em</Label>
                    <p className="text-sm">{new Date(mpConfig.connected_at).toLocaleDateString("pt-BR")}</p>
                  </div>
                )}
                <Separator />
                <Button variant="destructive" className="w-full" onClick={handleMpDisconnect} disabled={disconnectingMp}>
                  {disconnectingMp ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
                  Desconectar Mercado Pago
                </Button>
              </div>
            ) : (
              <div className="space-y-5">
                <p className="text-sm text-muted-foreground">
                  Ao clicar no botão abaixo, você será redirecionado para o Mercado Pago para autorizar a conexão. Nenhuma credencial manual é necessária.
                </p>
                <Button
                  onClick={handleStartMpOAuth}
                  disabled={startingOAuth}
                  className="w-full bg-[#009EE3] hover:bg-[#007BB8]"
                  size="lg"
                >
                  {startingOAuth ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Redirecionando...</>
                  ) : (
                    <><ExternalLink className="mr-2 h-4 w-4" />Conectar com Mercado Pago</>
                  )}
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Meta Pixel Config Sheet */}
      <Sheet open={fbPixelSheetOpen} onOpenChange={setFbPixelSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <svg className="h-5 w-5" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6.403 5.076c-2.302 2.456-3.527 6.066-3.527 10.763v4.32c0 4.698 1.225 8.308 3.527 10.764C8.707 33.382 12.111 34.8 16.5 34.8h3c4.389 0 7.793-1.418 10.097-3.877 2.302-2.456 3.527-6.066 3.527-10.763v-4.32c0-4.698-1.225-8.308-3.527-10.764C27.293 2.618 23.889 1.2 19.5 1.2h-3c-4.389 0-7.793 1.418-10.097 3.876z" fill="url(#meta-gradient2)"/>
                <path d="M10.74 23.452c0 .982.204 1.681.546 2.126.338.44.795.622 1.35.622.705 0 1.32-.348 1.975-1.276.527-.746 1.074-1.804 1.736-3.14l.88-1.778c.873-1.763 1.88-3.285 3.09-4.338 1.01-.878 2.1-1.368 3.24-1.368 1.603 0 2.946.763 3.968 2.218 1.104 1.572 1.675 3.636 1.675 6.102 0 1.42-.224 2.525-.616 3.352-.37.782-.953 1.378-1.722 1.738l-.987-1.268c.5-.266.866-.66 1.1-1.238.244-.6.385-1.385.385-2.378 0-1.97-.376-3.648-1.12-4.876-.638-1.052-1.466-1.63-2.456-1.63-.838 0-1.614.47-2.38 1.37-.612.72-1.228 1.736-1.895 3.004l-.868 1.654c-1.056 2.012-1.88 3.3-2.65 4.192-.926 1.076-1.915 1.56-3.14 1.56-1.098 0-1.974-.42-2.604-1.22-.608-.77-.997-1.892-.997-3.442 0-1.744.345-3.504 1.003-5.188l1.352.532c-.576 1.488-.864 2.99-.864 4.578z" fill="white"/>
                <defs><linearGradient id="meta-gradient2" x1="18" y1="1.2" x2="18" y2="34.8" gradientUnits="userSpaceOnUse"><stop stopColor="#0081FB"/><stop offset="1" stopColor="#0064E0"/></linearGradient></defs>
              </svg>
              Meta Pixel
            </SheetTitle>
            <SheetDescription>Configure o Meta Pixel para rastrear conversões e criar campanhas no Facebook, Instagram e toda a rede Meta</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            {fbPixelLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="space-y-5">
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm">Como obter o Pixel ID:</h4>
                  <div className="space-y-2">
                    {[
                      "Acesse o Gerenciador de Eventos do Facebook (Meta Business Suite)",
                      "Crie ou selecione um Pixel existente",
                      "Copie o ID do Pixel (número de 15-16 dígitos)",
                      "Cole o ID abaixo e salve"
                    ].map((text, i) => (
                      <div key={i} className="flex gap-3 items-start">
                        <span className="flex-shrink-0 h-6 w-6 rounded-full bg-[#1877F2] text-white text-xs flex items-center justify-center font-bold">{i + 1}</span>
                        <p className="text-sm text-muted-foreground">{text}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <Separator />
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-sm">Pixel ID</Label>
                    <Input
                      placeholder="Ex: 123456789012345"
                      value={fbPixelId}
                      onChange={(e) => setFbPixelId(e.target.value)}
                    />
                  </div>
                  <Button
                    className="w-full bg-[#1877F2] hover:bg-[#1565C0]"
                    onClick={handleSaveFbPixel}
                    disabled={fbPixelSaving}
                  >
                    {fbPixelSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                    {fbPixelId.trim() ? "Salvar Pixel" : "Remover Pixel"}
                  </Button>
                </div>
                {isFbPixelConfigured && (
                  <>
                    <Separator />
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium text-green-700">Pixel ativo nos cardápios</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      O Pixel será carregado automaticamente nos cardápios de Delivery e Mesa, rastreando visualizações de página. 
                      Use o Gerenciador de Eventos do Facebook para criar públicos personalizados e campanhas.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default IntegrationsTab;

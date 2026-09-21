import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { Palette, User, Phone, CreditCard, Image, Clock, Percent, Save, FileText, Timer, RotateCcw, MapPin, Printer, HardDrive, Truck, CalendarDays } from "lucide-react";
import { lazy, Suspense } from "react";

const BusinessHoursSettings = lazy(() => import("./BusinessHoursSettings"));
const DeliveryZonesSettings = lazy(() => import("./DeliveryZonesSettings"));
const PaymentMethodsSettings = lazy(() => import("./PaymentMethodsSettings"));
const OnlinePaymentsSettings = lazy(() => import("./OnlinePaymentsSettings"));
const PrintersSettings = lazy(() => import("./PrintersSettings"));
const BackupSettings = lazy(() => import("./BackupSettings"));
const ShareableLinksSection = lazy(() => import("./ShareableLinksSection"));

interface Settings {
  logo_url: string | null;
  banner_url: string | null;
  primary_color: string;
  menu_background_color: string;
  service_fee_enabled: boolean;
  service_fee_percentage: number;
  prep_time_minutes: number;
  pickup_time_minutes: number;
  login_require_cpf: boolean;
  login_require_name: boolean;
  login_require_phone: boolean;
  login_require_birth_date: boolean;
  bill_request_enabled: boolean;
  show_prep_timer: boolean;
}

const SubTabLoading = () => (
  <div className="text-center py-12">
    <p className="text-muted-foreground">Carregando...</p>
  </div>
);

const CompanyDataSettings = ({ restaurantId }: { restaurantId: string }) => {
  const [settings, setSettings] = useState<Settings>({
    logo_url: null,
    banner_url: null,
    primary_color: "#184a2d",
    menu_background_color: "#ffffff",
    service_fee_enabled: false,
    service_fee_percentage: 10,
    prep_time_minutes: 30,
    pickup_time_minutes: 15,
    login_require_cpf: true,
    login_require_name: true,
    login_require_phone: false,
    login_require_birth_date: false,
    bill_request_enabled: true,
    show_prep_timer: true,
  });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, [restaurantId]);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from("restaurants")
        .select("logo_url, banner_url, primary_color, menu_background_color, service_fee_enabled, service_fee_percentage, prep_time_minutes, pickup_time_minutes, login_require_cpf, login_require_name, login_require_phone, login_require_birth_date, bill_request_enabled, show_prep_timer")
        .eq("id", restaurantId)
        .maybeSingle();

      if (error) throw error;
      
      if (data) {
        setSettings({
          logo_url: data.logo_url,
          banner_url: data.banner_url,
          primary_color: data.primary_color || "#184a2d",
          menu_background_color: (data as any).menu_background_color || "#ffffff",
          service_fee_enabled: data.service_fee_enabled || false,
          service_fee_percentage: data.service_fee_percentage || 10,
          prep_time_minutes: data.prep_time_minutes || 30,
          pickup_time_minutes: (data as any).pickup_time_minutes ?? 15,
          login_require_cpf: data.login_require_cpf ?? true,
          login_require_name: data.login_require_name ?? true,
          login_require_phone: data.login_require_phone ?? false,
          login_require_birth_date: data.login_require_birth_date ?? false,
          bill_request_enabled: data.bill_request_enabled ?? true,
          show_prep_timer: data.show_prep_timer ?? true,
        });
      }
    } catch (error) {
      toast.error("Erro ao carregar configurações");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Por favor, selecione uma imagem"); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("A imagem deve ter no máximo 2MB"); return; }
    setUploading(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${restaurantId}-${Date.now()}.${fileExt}`;
      const filePath = `logos/${fileName}`;
      const { error: uploadError } = await supabase.storage.from("product-images").upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(filePath);
      const logoUrl = urlData.publicUrl;
      const { error: updateError } = await supabase.from("restaurants").update({ logo_url: logoUrl }).eq("id", restaurantId);
      if (updateError) throw updateError;
      setSettings({ ...settings, logo_url: logoUrl });
      toast.success("Logo atualizada!");
    } catch (error) { toast.error("Erro ao fazer upload da logo"); console.error(error); } finally { setUploading(false); }
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Por favor, selecione uma imagem"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("A imagem deve ter no máximo 5MB"); return; }
    setUploadingBanner(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${restaurantId}-banner-${Date.now()}.${fileExt}`;
      const filePath = `banners/${fileName}`;
      const { error: uploadError } = await supabase.storage.from("product-images").upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(filePath);
      const bannerUrl = urlData.publicUrl;
      const { error: updateError } = await supabase.from("restaurants").update({ banner_url: bannerUrl }).eq("id", restaurantId);
      if (updateError) throw updateError;
      setSettings({ ...settings, banner_url: bannerUrl });
      toast.success("Banner atualizado!");
    } catch (error) { toast.error("Erro ao fazer upload do banner"); console.error(error); } finally { setUploadingBanner(false); }
  };

  const handleSaveSettings = async () => {
    try {
      // Validate at least one customer field is active
      if (!settings.login_require_cpf && !settings.login_require_name && !settings.login_require_phone) {
        toast.error("É obrigatório manter pelo menos um campo de cadastro ativo (CPF, Nome ou Telefone)");
        return;
      }

      const { error } = await supabase
        .from('restaurants')
        .update({
          primary_color: settings.primary_color,
          menu_background_color: settings.menu_background_color,
          service_fee_enabled: settings.service_fee_enabled,
          service_fee_percentage: settings.service_fee_percentage,
          prep_time_minutes: settings.prep_time_minutes,
          pickup_time_minutes: settings.pickup_time_minutes,
          login_require_cpf: settings.login_require_cpf,
          login_require_name: settings.login_require_name,
          login_require_phone: settings.login_require_phone,
          login_require_birth_date: settings.login_require_birth_date,
          bill_request_enabled: settings.bill_request_enabled,
          show_prep_timer: settings.show_prep_timer,
        } as any)
        .eq('id', restaurantId);
      if (error) throw error;
      toast.success("Configurações salvas!");
      await fetchSettings();
    } catch (error) { toast.error("Erro ao salvar configurações"); console.error(error); }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Carregando configurações...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold tracking-[-0.025em]">Configurações Gerais</h2>
        <p className="text-muted-foreground font-light">Personalize a aparência e comportamento do seu cardápio digital</p>
      </div>

      <Tabs defaultValue="visual" className="space-y-6">
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
          <TabsTrigger value="visual" className="gap-2">
            <Image className="h-4 w-4" />
            Identidade Visual
          </TabsTrigger>
          <TabsTrigger value="operational" className="gap-2">
            <Clock className="h-4 w-4" />
            Operacional
          </TabsTrigger>
          <TabsTrigger value="hours" className="gap-2">
            <Clock className="h-4 w-4" />
            Horário
          </TabsTrigger>
          <TabsTrigger value="delivery" className="gap-2">
            <MapPin className="h-4 w-4" />
            Regiões de Entrega
          </TabsTrigger>
          <TabsTrigger value="payments" className="gap-2">
            <CreditCard className="h-4 w-4" />
            Pagamentos
          </TabsTrigger>
          <TabsTrigger value="printers" className="gap-2">
            <Printer className="h-4 w-4" />
            Impressoras
          </TabsTrigger>
          <TabsTrigger value="backup" className="gap-2">
            <HardDrive className="h-4 w-4" />
            Backup
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Identidade Visual */}
        <TabsContent value="visual" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Banner Card */}
            <Card>
              <CardHeader>
                <CardTitle>Banner do Cardápio</CardTitle>
                <CardDescription>Imagem de fundo exibida no topo do cardápio</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative w-full h-36 rounded-lg overflow-hidden border bg-muted flex items-center justify-center">
                  {settings.banner_url ? (
                    <img src={settings.banner_url} alt="Banner atual" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-muted-foreground text-sm flex flex-col items-center gap-1">
                      <Image className="h-8 w-8 opacity-40" />
                      <span>Nenhum banner</span>
                    </div>
                  )}
                </div>
                <div>
                  <Input
                    id="banner-upload"
                    type="file"
                    accept="image/*,image/webp,.webp,.jpg,.jpeg,.png,.gif"
                    onChange={handleBannerUpload}
                    disabled={uploadingBanner}
                    className="cursor-pointer"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">16:9, mínimo 1600×900px, máx 5MB</p>
                </div>
              </CardContent>
            </Card>

            {/* Logo + Cor Card */}
            <Card>
              <CardHeader>
                <CardTitle>Logo & Cor Principal</CardTitle>
                <CardDescription>Identidade visual exibida no cardápio</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-start gap-5">
                  <div className="shrink-0">
                    <div className="w-24 h-24 rounded-full border-4 border-border bg-muted flex items-center justify-center overflow-hidden">
                      {settings.logo_url ? (
                        <img src={settings.logo_url} alt="Logo" className="w-full h-full object-cover" />
                      ) : (
                        <Image className="h-8 w-8 text-muted-foreground opacity-40" />
                      )}
                    </div>
                  </div>
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="logo-upload" className="text-xs text-muted-foreground">Quadrada, mín 512×512px, máx 2MB</Label>
                    <Input
                      id="logo-upload"
                      type="file"
                      accept="image/*,image/webp,.webp,.jpg,.jpeg,.png,.gif"
                      onChange={handleLogoUpload}
                      disabled={uploading}
                      className="cursor-pointer"
                    />
                  </div>
                </div>

                <div className="border-t pt-4">
                  <Label className="flex items-center gap-2 mb-2">
                    <Palette className="h-4 w-4 text-muted-foreground" />
                    Cor Principal
                  </Label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="color"
                      value={settings.primary_color}
                      onChange={(e) => setSettings({ ...settings, primary_color: e.target.value })}
                      className="w-12 h-9 p-1 cursor-pointer"
                    />
                    <Input
                      type="text"
                      value={settings.primary_color}
                      onChange={(e) => setSettings({ ...settings, primary_color: e.target.value })}
                      className="w-28 font-mono text-sm"
                    />
                    <div className="h-9 flex-1 rounded-md" style={{ backgroundColor: settings.primary_color }} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Botões, preços e detalhes do cardápio.
                  </p>
                </div>

                <div className="border-t pt-4">
                  <Label className="flex items-center gap-2 mb-2">
                    <Palette className="h-4 w-4 text-muted-foreground" />
                    Cor de Fundo do Cardápio
                  </Label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="color"
                      value={settings.menu_background_color}
                      onChange={(e) => setSettings({ ...settings, menu_background_color: e.target.value })}
                      className="w-12 h-9 p-1 cursor-pointer"
                    />
                    <Input
                      type="text"
                      value={settings.menu_background_color}
                      onChange={(e) => setSettings({ ...settings, menu_background_color: e.target.value })}
                      className="w-28 font-mono text-sm"
                    />
                    <div
                      className="h-9 flex-1 rounded-md border flex items-center justify-center gap-2"
                      style={{ backgroundColor: settings.menu_background_color }}
                    >
                      <span className="text-xs" style={{ color: settings.primary_color }}>
                        Exemplo de texto
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-muted-foreground">Sugestões:</span>
                    {["#ffffff", "#f5ecdc", "#faf7f2", "#f4f4f5", "#111827"].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setSettings({ ...settings, menu_background_color: c })}
                        className="h-6 w-6 rounded border hover:scale-110 transition-transform"
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Suspense fallback={<SubTabLoading />}>
            <ShareableLinksSection restaurantId={restaurantId} />
          </Suspense>

          <Button onClick={handleSaveSettings} className="w-full sm:w-auto gap-2">
            <Save className="h-4 w-4" />
            Salvar Identidade Visual
          </Button>
        </TabsContent>

        {/* Tab 2: Operacional (merged: Operacional + Cadastro de Clientes + Cardápio) */}
        <TabsContent value="operational" className="space-y-6">
          {/* SEÇÃO 1: Cardápio Digital */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Cardápio Digital
              </CardTitle>
              <CardDescription>Funcionalidades e comportamento do cardápio para os clientes</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {/* Pedir Conta */}
                <div className="flex items-center justify-between py-3 first:pt-0">
                  <div>
                    <p className="text-sm font-medium">Permitir clientes pedirem conta</p>
                    <p className="text-xs text-muted-foreground">Exibe o botão "Pedir Conta" no cardápio de mesa</p>
                  </div>
                  <Switch
                    checked={settings.bill_request_enabled}
                    onCheckedChange={(checked) => setSettings({ ...settings, bill_request_enabled: checked })}
                  />
                </div>

                {/* Tempo de Preparo */}
                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">Tempo de preparo por produto</p>
                    <p className="text-xs text-muted-foreground">Contagem regressiva ao lado de cada item na comanda</p>
                  </div>
                  <Switch
                    checked={settings.show_prep_timer}
                    onCheckedChange={(checked) => setSettings({ ...settings, show_prep_timer: checked })}
                  />
                </div>

                {/* Taxa de Serviço */}
                <div className="py-3 last:pb-0 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Taxa de serviço</p>
                      <p className="text-xs text-muted-foreground">Cobrar taxa de serviço nos pedidos de mesa</p>
                    </div>
                    <Switch
                      checked={settings.service_fee_enabled}
                      onCheckedChange={(checked) => setSettings({ ...settings, service_fee_enabled: checked })}
                    />
                  </div>
                  {settings.service_fee_enabled && (
                    <div className="pl-0 space-y-1.5">
                      <Label htmlFor="service-fee-percentage" className="text-xs">Porcentagem (%)</Label>
                      <Input
                        id="service-fee-percentage"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={settings.service_fee_percentage}
                        onChange={(e) => setSettings({ ...settings, service_fee_percentage: parseFloat(e.target.value) || 0 })}
                        className="max-w-[120px]"
                      />
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* SEÇÃO 2: Cadastro de Clientes */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Cadastro de Clientes
              </CardTitle>
              <CardDescription>Campos solicitados no login do cardápio. Pelo menos um deve estar ativo.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                <div className="flex items-center justify-between py-3 first:pt-0">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                      <CreditCard className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">CPF</p>
                  </div>
                  <Switch
                    checked={settings.login_require_cpf}
                    onCheckedChange={(checked) => {
                      if (!checked && !settings.login_require_name && !settings.login_require_phone) {
                        toast.error("Pelo menos um campo deve estar ativo");
                        return;
                      }
                      setSettings({ ...settings, login_require_cpf: checked });
                    }}
                  />
                </div>
                <div className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">Nome</p>
                  </div>
                  <Switch
                    checked={settings.login_require_name}
                    onCheckedChange={(checked) => {
                      if (!checked && !settings.login_require_cpf && !settings.login_require_phone) {
                        toast.error("Pelo menos um campo deve estar ativo");
                        return;
                      }
                      setSettings({ ...settings, login_require_name: checked });
                    }}
                  />
                </div>
                <div className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">Telefone</p>
                  </div>
                  <Switch
                    checked={settings.login_require_phone}
                    onCheckedChange={(checked) => {
                      if (!checked && !settings.login_require_cpf && !settings.login_require_name) {
                        toast.error("Pelo menos um campo deve estar ativo");
                        return;
                      }
                      setSettings({ ...settings, login_require_phone: checked });
                    }}
                  />
                </div>
                <div className="flex items-center justify-between py-3 last:pb-0">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                      <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">Data de Nascimento</p>
                  </div>
                  <Switch
                    checked={settings.login_require_birth_date}
                    onCheckedChange={(checked) => setSettings({ ...settings, login_require_birth_date: checked })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* SEÇÃO 3: Delivery & Retirada */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5" />
                Delivery & Retirada
              </CardTitle>
              <CardDescription>Tempos estimados informados ao cliente no checkout e notificações</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="prep-time-delivery">Tempo de Delivery (min)</Label>
                  <Input
                    id="prep-time-delivery"
                    type="number"
                    min="1"
                    max="180"
                    value={settings.prep_time_minutes}
                    onChange={(e) => setSettings({ ...settings, prep_time_minutes: parseInt(e.target.value) || 30 })}
                  />
                  <p className="text-xs text-muted-foreground">Preparo + entrega</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pickup-time">Tempo de Retirada (min)</Label>
                  <Input
                    id="pickup-time"
                    type="number"
                    min="1"
                    max="180"
                    value={settings.pickup_time_minutes}
                    onChange={(e) => setSettings({ ...settings, pickup_time_minutes: parseInt(e.target.value) || 15 })}
                  />
                  <p className="text-xs text-muted-foreground">Preparo para retirada no balcão</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* SEÇÃO 4: Ferramentas */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5" />
                Ferramentas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="gap-2"
                onClick={async () => {
                  try {
                    const { error } = await supabase
                      .from('tables')
                      .update({ occupied_at: new Date().toISOString() })
                      .eq('restaurant_id', restaurantId)
                      .eq('is_occupied', true);
                    if (error) throw error;
                    toast.success("Tempo de todas as mesas zerado!");
                  } catch {
                    toast.error("Erro ao zerar tempo");
                  }
                }}
              >
                <RotateCcw className="h-4 w-4" />
                Zerar tempo de todas as mesas
              </Button>
            </CardContent>
          </Card>

          <Button onClick={handleSaveSettings} className="w-full sm:w-auto gap-2">
            <Save className="h-4 w-4" />
            Salvar Configurações Operacionais
          </Button>
        </TabsContent>

        {/* Tab 3: Horário de Funcionamento */}
        <TabsContent value="hours">
          <Suspense fallback={<SubTabLoading />}>
            <BusinessHoursSettings restaurantId={restaurantId} />
          </Suspense>
        </TabsContent>

        {/* Tab 4: Regiões de Entrega */}
        <TabsContent value="delivery">
          <Suspense fallback={<SubTabLoading />}>
            <DeliveryZonesSettings restaurantId={restaurantId} />
          </Suspense>
        </TabsContent>

        {/* Tab 5: Formas de Pagamento */}
        <TabsContent value="payments" className="space-y-8">
          <Suspense fallback={<SubTabLoading />}>
            <PaymentMethodsSettings restaurantId={restaurantId} />
            <OnlinePaymentsSettings restaurantId={restaurantId} />
          </Suspense>
        </TabsContent>

        {/* Tab 6: Impressoras */}
        <TabsContent value="printers">
          <Suspense fallback={<SubTabLoading />}>
            <PrintersSettings restaurantId={restaurantId} />
          </Suspense>
        </TabsContent>

        {/* Tab 7: Backup e Restauração */}
        <TabsContent value="backup">
          <Suspense fallback={<SubTabLoading />}>
            <BackupSettings restaurantId={restaurantId} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default CompanyDataSettings;

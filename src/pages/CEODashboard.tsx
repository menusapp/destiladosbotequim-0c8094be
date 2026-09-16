import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogOut, Plus, Store, Trash2, Edit, CreditCard, Package, BarChart3, Loader2, UserCog } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { SubscriptionPlansTab } from "@/components/ceo/SubscriptionPlansTab";
import { SubscriptionsTab } from "@/components/ceo/SubscriptionsTab";
import { CEOReportsTab } from "@/components/ceo/CEOReportsTab";
import { CEOCredentialsTab } from "@/components/ceo/CEOCredentialsTab";

interface Restaurant {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  created_at: string;
}

interface SubscriptionInfo {
  restaurant_id: string;
  status: string;
  plan_name: string | null;
  plan_price: number | null;
}

const CEODashboard = () => {
  const navigate = useNavigate();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [subscriptionMap, setSubscriptionMap] = useState<Record<string, SubscriptionInfo>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRestaurant, setEditingRestaurant] = useState<Restaurant | null>(null);
  const [mrr, setMrr] = useState(0);
  const [delinquentCount, setDelinquentCount] = useState(0);
  const [newThisMonth, setNewThisMonth] = useState(0);

  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");

  const ceoUserId = localStorage.getItem("ceo_user_id");
  const ceoDisplayName = localStorage.getItem("ceo_display_name");

  useEffect(() => {
    if (!ceoUserId) {
      navigate("/login", { replace: true });
      return;
    }
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const { data: restData } = await supabase.from("restaurants").select("*").order("created_at", { ascending: false });
      setRestaurants(restData || []);

      const { data: subs } = await supabase
        .from("restaurant_subscriptions" as any)
        .select("restaurant_id, status, plan_id, created_at") as any;

      const { data: plans } = await supabase.from("subscription_plans").select("id, name, price");

      const planMap: Record<string, { name: string; price: number }> = {};
      (plans || []).forEach((p: any) => { planMap[p.id] = { name: p.name, price: p.price }; });

      const latestByRestaurant: Record<string, any> = {};
      ((subs as any[]) || []).forEach((s: any) => {
        const existing = latestByRestaurant[s.restaurant_id];
        if (!existing || new Date(s.created_at) > new Date(existing.created_at)) {
          latestByRestaurant[s.restaurant_id] = s;
        }
      });

      const subMap: Record<string, SubscriptionInfo> = {};
      let mrrTotal = 0;
      let delinquent = 0;

      Object.values(latestByRestaurant).forEach((s: any) => {
        const plan = planMap[s.plan_id];
        subMap[s.restaurant_id] = {
          restaurant_id: s.restaurant_id,
          status: s.status,
          plan_name: plan?.name || null,
          plan_price: plan?.price || null,
        };
        if (s.status === "active" && plan) mrrTotal += plan.price;
        if (s.status === "suspended" || s.status === "expired") delinquent++;
      });

      setSubscriptionMap(subMap);
      setMrr(mrrTotal);
      setDelinquentCount(delinquent);

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const newCount = (restData || []).filter(r => new Date(r.created_at) >= startOfMonth).length;
      setNewThisMonth(newCount);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("ceo_user_id");
    localStorage.removeItem("ceo_display_name");
    localStorage.removeItem("ceo_access");
    navigate("/login");
  };

  const handleOpenDialog = (restaurant?: Restaurant) => {
    if (restaurant) {
      setEditingRestaurant(restaurant);
      setFormName(restaurant.name); setFormSlug(restaurant.slug);
      setFormUsername(""); setFormPassword("");
    } else {
      setEditingRestaurant(null);
      setFormName(""); setFormSlug("");
      setFormUsername(""); setFormPassword("");
    }
    setDialogOpen(true);
  };

  const ALL_ADMIN_SECTIONS = [
    "pedidos-online","pedidos-locais","pdv","mesas-reservas","cardapio","caixa",
    "estoque","custos","margens","relatorios","clientes","fidelidade","marketing",
    "fiscal","modulos","config-dados","config-horario","config-regioes",
    "config-pagamentos","config-pagamentos-online","config-impressoras","config-whatsapp"
  ];

  /**
   * Cria (ou redefine) o acesso de admin de um restaurante.
   *
   * Usado tanto no cadastro quanto na edição: um restaurante criado sem
   * credenciais — ou que perdeu a senha — não tinha como receber um primeiro
   * acesso pelo painel, e a única saída era apagar e recadastrar.
   *
   * O upsert usa a chave (restaurant_id, username), então repetir o mesmo
   * usuário troca a senha em vez de dar erro de duplicidade.
   */
  const salvarAcessoDoRestaurante = async (restaurantId: string) => {
    const { data: hashData, error: hashError } = await supabase.functions.invoke("hash-password", {
      body: { password: formPassword },
    });
    if (hashError || !hashData?.hash) throw new Error("Erro ao criar hash da senha");
    const hashedPassword = hashData.hash;

    const { error: credError } = await supabase.from("restaurant_credentials" as any)
      .upsert(
        { restaurant_id: restaurantId, username: formUsername, password_hash: hashedPassword } as any,
        { onConflict: "restaurant_id,username" } as any,
      );
    if (credError) throw credError;

    const { error: staffError } = await supabase.rpc("admin_create_staff", {
      p_restaurant_id: restaurantId,
      p_username: formUsername,
      p_password_hash: hashedPassword,
      p_display_name: "Administrador",
      p_role: "admin",
      p_allowed_sections: JSON.stringify(ALL_ADMIN_SECTIONS),
    });
    // Sem a conta de staff o login do painel não entra. Antes isso ia só para
    // o console e o usuário via "criado com sucesso" sem conseguir acessar.
    if (staffError) {
      console.error("Erro ao criar conta admin:", staffError);
      toast.error("Credencial salva, mas a conta de admin falhou: " + (staffError.message || "erro desconhecido"));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingRestaurant) {
        const { error } = await supabase.from("restaurants")
          .update({ name: formName, slug: formSlug })
          .eq("id", editingRestaurant.id);
        if (error) throw error;
        if (formUsername && formPassword) {
          await salvarAcessoDoRestaurante(editingRestaurant.id);
          toast.success("Restaurante atualizado e acesso definido!");
        } else {
          toast.success("Restaurante atualizado com sucesso!");
        }
      } else {
        const { data: restaurant, error } = await supabase.from("restaurants")
          .insert({ name: formName, slug: formSlug })
          .select().single();
        if (error) throw error;
        if (formUsername && formPassword) {
          await salvarAcessoDoRestaurante(restaurant.id);
        }
        toast.success("Restaurante criado com sucesso!");
      }
      setDialogOpen(false); setEditingRestaurant(null); fetchData();
    } catch (error: any) { toast.error(error.message || "Erro ao processar restaurante"); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Tem certeza que deseja excluir ${name}?`)) return;
    try {
      const { error } = await supabase.from("restaurants").delete().eq("id", id);
      if (error) throw error;
      toast.success("Restaurante excluído com sucesso"); fetchData();
    } catch { toast.error("Erro ao excluir restaurante"); }
  };

  const getStatusBadge = (status: string | undefined) => {
    if (!status) return <span className="px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground">Sem plano</span>;
    const map: Record<string, string> = {
      active: "bg-green-500/10 text-green-600",
      suspended: "bg-amber-500/10 text-amber-600",
      expired: "bg-destructive/10 text-destructive",
      cancelled: "bg-muted text-muted-foreground",
    };
    const labels: Record<string, string> = { active: "Ativo", suspended: "Suspenso", expired: "Expirado", cancelled: "Cancelado" };
    return <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${map[status] || map.cancelled}`}>{labels[status] || status}</span>;
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Painel CEO — Menu's</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Bem-vindo, {ceoDisplayName || "CEO"}</p>
          </div>
          <Button onClick={handleLogout} variant="outline" size="sm"><LogOut className="h-4 w-4 mr-2" /> Sair</Button>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Restaurantes</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-semibold">{restaurants.length}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">MRR</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-semibold text-green-600">R$ {mrr.toFixed(2)}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Inadimplentes</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-semibold text-amber-600">{delinquentCount}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Novos este Mês</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-semibold">{newThisMonth}</p></CardContent>
          </Card>
        </div>

        <Tabs defaultValue="restaurants" className="space-y-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="restaurants"><Store className="h-4 w-4 mr-2" /> Restaurantes</TabsTrigger>
            <TabsTrigger value="plans"><Package className="h-4 w-4 mr-2" /> Planos</TabsTrigger>
            <TabsTrigger value="subscriptions"><CreditCard className="h-4 w-4 mr-2" /> Assinaturas</TabsTrigger>
            <TabsTrigger value="reports"><BarChart3 className="h-4 w-4 mr-2" /> Relatórios</TabsTrigger>
            <TabsTrigger value="credentials"><UserCog className="h-4 w-4 mr-2" /> Credenciais</TabsTrigger>
          </TabsList>

          <TabsContent value="restaurants">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div><CardTitle>Restaurantes Cadastrados</CardTitle><CardDescription>Gerencie os restaurantes da plataforma</CardDescription></div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={() => handleOpenDialog()} size="sm"><Plus className="h-4 w-4 mr-2" /> Novo Restaurante</Button>
                  </DialogTrigger>
                  <DialogContent className="max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{editingRestaurant ? "Editar Restaurante" : "Cadastrar Novo Restaurante"}</DialogTitle>
                      <DialogDescription>{editingRestaurant ? "Atualize os dados e, se precisar, defina o acesso" : "Preencha os dados do restaurante e as credenciais de acesso"}</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="name">Nome do Restaurante</Label>
                        <Input id="name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Ex: Pizzaria do João" required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="slug">Slug (URL)</Label>
                        <Input id="slug" value={formSlug} onChange={(e) => setFormSlug(e.target.value)} placeholder="Ex: pizzaria-do-joao" required />
                      </div>
                      <>
                        {editingRestaurant && (
                          <p className="text-xs text-muted-foreground border-t pt-3">
                            Preencha abaixo para criar o primeiro acesso deste restaurante
                            ou redefinir a senha. Deixe em branco para não alterar.
                          </p>
                        )}
                        <div className="space-y-2">
                          <Label>Usuário do Restaurante</Label>
                          <Input value={formUsername} onChange={(e) => setFormUsername(e.target.value)} placeholder="usuario_restaurante" required={!editingRestaurant} />
                        </div>
                        <div className="space-y-2">
                          <Label>Senha do Restaurante</Label>
                          <PasswordInput value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder="Mínimo 6 caracteres" required={!editingRestaurant} minLength={6} />
                        </div>
                      </>
                      <Button type="submit" className="w-full">{editingRestaurant ? "Atualizar" : "Criar"}</Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {restaurants.length === 0 ? (
                  <div className="text-center py-12"><Store className="h-12 w-12 mx-auto text-muted-foreground mb-4" /><p className="text-muted-foreground">Nenhum restaurante cadastrado ainda</p></div>
                ) : (
                  <div className="space-y-3">
                    {restaurants.map((restaurant) => {
                      const sub = subscriptionMap[restaurant.id];
                      return (
                        <div key={restaurant.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                              <Store className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium">{restaurant.name}</p>
                              <p className="text-sm text-muted-foreground">/{restaurant.slug}</p>
                            </div>
                            <div className="hidden md:flex items-center gap-3 ml-4">
                              {getStatusBadge(sub?.status)}
                              {sub?.plan_name && <span className="text-xs text-muted-foreground">{sub.plan_name}</span>}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleOpenDialog(restaurant)}><Edit className="h-4 w-4 mr-2" /> Editar</Button>
                            <Button variant="destructive" size="sm" onClick={() => handleDelete(restaurant.id, restaurant.name)}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="plans"><SubscriptionPlansTab /></TabsContent>
          <TabsContent value="subscriptions"><SubscriptionsTab /></TabsContent>
          <TabsContent value="reports"><CEOReportsTab /></TabsContent>
          <TabsContent value="credentials"><CEOCredentialsTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default CEODashboard;

import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { resolveSlug } from "@/lib/slugResolver";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Receipt, Clock, CreditCard, Banknote, Smartphone, ShoppingCart, Utensils, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDynamicFavicon } from "@/hooks/useDynamicFavicon";

import { novoId } from "@/lib/uuid";
// Ícones por tipo de método
const METHOD_ICONS: Record<string, any> = {
  cash: Banknote,
  debit: CreditCard,
  credit: CreditCard,
  pix: Smartphone,
  meal_voucher: Utensils,
};

// Bandeiras de cartão
const CARD_BRANDS = [
  { code: "visa", name: "Visa", logo: "https://upload.wikimedia.org/wikipedia/commons/5/5e/Visa_Inc._logo.svg" },
  { code: "mastercard", name: "Mastercard", logo: "https://upload.wikimedia.org/wikipedia/commons/2/2a/Mastercard-logo.svg" },
  { code: "elo", name: "Elo", logo: "https://upload.wikimedia.org/wikipedia/commons/d/d0/Bandeira_elo_cartance.png" },
  { code: "amex", name: "American Express", logo: "https://upload.wikimedia.org/wikipedia/commons/f/fa/American_Express_logo_%282018%29.svg" },
  { code: "hipercard", name: "Hipercard", logo: "https://upload.wikimedia.org/wikipedia/commons/8/89/Hipercard_logo.svg" },
];

// Bandeiras de vale refeição
const MEAL_VOUCHER_BRANDS = [
  { code: "alelo", name: "Alelo", logo: "https://www.alelo.com.br/assets/img/logo-alelo.svg" },
  { code: "sodexo", name: "Sodexo", logo: "https://upload.wikimedia.org/wikipedia/commons/3/37/Sodexo_2008_%28Green%29.svg" },
  { code: "vr", name: "VR", logo: "https://www.vr.com.br/assets/img/logo-vr.svg" },
  { code: "ticket", name: "Ticket", logo: "https://www.ticket.com.br/portal-parceiros/assets/images/logo-ticket-red.svg" },
  { code: "ben", name: "Ben Visa Vale", logo: "https://www.ben.com.br/assets/images/logo-ben.svg" },
  { code: "flash", name: "Flash", logo: "https://flash.com.br/images/logo.svg" },
];

// Função para obter informação de uma bandeira
const getBrandInfo = (brandCode: string) => {
  return CARD_BRANDS.find(b => b.code === brandCode) || 
         MEAL_VOUCHER_BRANDS.find(b => b.code === brandCode);
};

interface PaymentMethod {
  id: string;
  name: string;
  method_type: string;
  is_active: boolean;
  accepted_brands: string[] | null;
}

interface OrderItemExtra {
  price_at_order: number;
  extra_name: string | null;
  product_extras: {
    name: string;
  } | null;
}

interface OrderItem {
  id: string;
  quantity: number;
  price_at_order: number;
  notes?: string;
  products: {
    name: string;
    prep_time_minutes?: number | null;
  } | null;
  order_item_extras: OrderItemExtra[];
}

interface Order {
  id: string;
  status: string;
  created_at: string;
  customer_name: string;
  notes?: string;
  order_items: OrderItem[];
}

interface CartItemExtra {
  id: string;
  name: string;
  price: number;
}

interface CartItem {
  id: string;
  product: {
    id: string;
    name: string;
    price: number;
    promotional_price?: number | null;
  };
  quantity: number;
  extras: CartItemExtra[];
  notes?: string;
}

const Comanda = () => {
  const { slug: pathSlug, tableNumber } = useParams();
  const restaurantSlug = resolveSlug(pathSlug);
  const navigate = useNavigate();
  
  const [orders, setOrders] = useState<Order[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [tableId, setTableId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [billRequested, setBillRequested] = useState(false);
  const [billOnTheWay, setBillOnTheWay] = useState(false);
  const [showPrepTimer, setShowPrepTimer] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [selectedPaymentMethodType, setSelectedPaymentMethodType] = useState<string>("");
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  const [changeAmount, setChangeAmount] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [serviceFeeEnabled, setServiceFeeEnabled] = useState(false);
  const [serviceFeePercentage, setServiceFeePercentage] = useState(10);
  const [currentTime, setCurrentTime] = useState(() => Math.floor(Date.now() / 1000));
  const [restaurantColor, setRestaurantColor] = useState("#FF6B35");
  const [orderNotes, setOrderNotes] = useState("");
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [restaurantLogo, setRestaurantLogo] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [billRequestEnabled, setBillRequestEnabled] = useState(true);
  const [isRestaurantOpen, setIsRestaurantOpen] = useState(true);

  useDynamicFavicon(restaurantLogo, restaurantName);

  useEffect(() => {
    fetchData();
    
    // Carregar carrinho do sessionStorage
    const loadCart = () => {
      const savedCart = sessionStorage.getItem(`cart_${tableNumber}`);
      if (savedCart) {
        setCart(JSON.parse(savedCart));
      }
    };
    loadCart();
    
    // Configurar realtime para bills (fora do fetchData para evitar múltiplas subscrições)
    let billChannel: any = null;
    let ordersChannel: any = null;
    
    const setupRealtimeChannels = async () => {
      // Buscar table_id e comanda_id primeiro
      const { data: restData } = await supabase
        .from("restaurants")
        .select("id")
        .eq("slug", restaurantSlug)
        .single();
      
      if (!restData) return;
      
      const { data: tableData } = await supabase
        .from("tables")
        .select("id")
        .eq("restaurant_id", restData.id)
        .eq("table_number", parseInt(tableNumber || "0"))
        .single();
      
      if (!tableData) return;
      
      // 🔑 CRÍTICO: Buscar comanda_id do cliente atual
      // Se não existir no sessionStorage, tentar encontrar comanda ativa pelo CPF
      let comandaId = sessionStorage.getItem(`comanda_id_${tableNumber}`);
      
      if (!comandaId) {
        const customerCPF = sessionStorage.getItem(`customer_cpf_${tableNumber}`);
        if (customerCPF) {
          // Buscar comanda ativa deste cliente nesta mesa via RPC
          const { data: comandaRows } = await (supabase as any).rpc("get_comanda_status", {
            p_table_id: tableData.id,
            p_cpf: customerCPF.replace(/\D/g, ''),
          });
          const activeComanda = (Array.isArray(comandaRows) ? comandaRows : [comandaRows]).find(
            (c: any) => c?.status === "active"
          );
          
          if (activeComanda) {
            comandaId = activeComanda.id;
            sessionStorage.setItem(`comanda_id_${tableNumber}`, comandaId);
          }
        }
      }
      
      // 🚨 Se não encontrou comanda_id, NÃO configurar realtime (evita fallback por table_id)
      if (!comandaId) {
        return;
      }
      
      // NOTE: bills/orders postgres_changes realtime removed (locked tables).
      // Replaced by 15s polling of get_comanda_status + fetchData below.
    };
    
    setupRealtimeChannels();

    // 🔁 Polling (15s) do status da comanda - substitui realtime em bills/orders
    const pollComandaStatus = async () => {
      const comandaId = sessionStorage.getItem(`comanda_id_${tableNumber}`);
      const rawCustomerCPF = sessionStorage.getItem(`customer_cpf_${tableNumber}`);
      const customerCPF = (rawCustomerCPF || '').replace(/\D/g, '');
      const savedTableId = sessionStorage.getItem(`table_id_${tableNumber}`);
      if (!comandaId || !customerCPF || !savedTableId) return;

      const { data: comandaRows } = await (supabase as any).rpc("get_comanda_status", {
        p_table_id: savedTableId,
        p_cpf: customerCPF,
      });
      const myComanda = (Array.isArray(comandaRows) ? comandaRows : [comandaRows]).find(
        (c: any) => c?.id === comandaId
      );

      if (myComanda?.status === "closed") {
        toast.success("Conta paga! Obrigado pela preferência!");

        const { data: paidBillId } = await (supabase as any).rpc('get_paid_bill_for_comanda', { p_comanda_id: comandaId });
        sessionStorage.setItem('shouldShowReview', 'true');
        if (paidBillId) sessionStorage.setItem('reviewBillId', paidBillId);

        sessionStorage.removeItem(`customer_name_${tableNumber}`);
        sessionStorage.removeItem(`customer_cpf_${tableNumber}`);
        sessionStorage.removeItem(`cart_${tableNumber}`);
        sessionStorage.removeItem(`comanda_id_${tableNumber}`);
        sessionStorage.removeItem("customerInfo");

        setTimeout(() => {
          navigate(`/${restaurantSlug}/mesa/${tableNumber}`);
        }, 2000);
        return;
      }

      // Recarregar dados de pedidos/conta
      fetchData();
    };

    // 6s: "realtime" da mesa via polling (o websocket nao autentica no modelo de token)
    const pollInterval = setInterval(pollComandaStatus, 6000);
    
    return () => {
      clearInterval(pollInterval);
      if (billChannel) {
        supabase.removeChannel(billChannel);
      }
      if (ordersChannel) {
        supabase.removeChannel(ordersChannel);
      }
    };
  }, [restaurantSlug, tableNumber]);

  // 🔒 Revalidar sessão ao voltar do background
  useEffect(() => {
    const revalidateSession = async () => {
      const comandaId = sessionStorage.getItem(`comanda_id_${tableNumber}`);
      const savedName = sessionStorage.getItem(`customer_name_${tableNumber}`);
      
      if (!comandaId || !savedName) return;
      
      try {
        const { data: comandaRow } = await (supabase as any).rpc('get_comanda_status_by_id', { p_comanda_id: comandaId });
        const comanda = Array.isArray(comandaRow) ? comandaRow[0] : comandaRow;

        if (!comanda || comanda.status === "closed") {
          const { data: paidBillId } = await (supabase as any).rpc('get_paid_bill_for_comanda', { p_comanda_id: comandaId });

          if (paidBillId) {
            sessionStorage.setItem('shouldShowReview', 'true');
            sessionStorage.setItem('reviewBillId', paidBillId);
          }
          
          sessionStorage.removeItem(`customer_name_${tableNumber}`);
          sessionStorage.removeItem(`customer_cpf_${tableNumber}`);
          sessionStorage.removeItem(`cart_${tableNumber}`);
          sessionStorage.removeItem(`comanda_id_${tableNumber}`);
          sessionStorage.removeItem("customerInfo");
          
          navigate(`/${restaurantSlug}/mesa/${tableNumber}`);
          return;
        }
      } catch (err) {
        console.error('Erro ao revalidar sessão:', err);
      }
    };
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') revalidateSession();
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', revalidateSession);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', revalidateSession);
    };
  }, [tableNumber, restaurantSlug, navigate]);

  // Tick every second for per-item prep timers
  useEffect(() => {
    if (!showPrepTimer) return;
    const hasAccepted = orders.some(o => o.status === "accepted" || o.status === "preparing");
    if (!hasAccepted) return;
    const interval = setInterval(() => {
      setCurrentTime(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [showPrepTimer, orders]);

  const fetchData = useCallback(async () => {
    if (!restaurantSlug || !tableNumber) return;
    
    try {
      // Buscar restaurante primeiro
      const rawCustomerCPF = sessionStorage.getItem(`customer_cpf_${tableNumber}`);
      const customerCPF = (rawCustomerCPF || '').replace(/\D/g, '');
      
      const restResult = await supabase
        .from("restaurants")
        .select("id, name, logo_url, service_fee_enabled, service_fee_percentage, prep_time_minutes, primary_color, bill_request_enabled, show_prep_timer, is_open")
        .eq("slug", restaurantSlug)
        .maybeSingle();

      if (restResult.error) throw restResult.error;
      const restData = restResult.data;
      
      if (!restData) {
        toast.error("Restaurante não encontrado");
        return;
      }
      
      setServiceFeeEnabled(restData.service_fee_enabled || false);
      setServiceFeePercentage(restData.service_fee_percentage || 10);
      setShowPrepTimer(restData.show_prep_timer ?? true);
      setRestaurantColor(restData.primary_color || "#FF6B35");
      setRestaurantId(restData.id);
      setRestaurantLogo(restData.logo_url);
      setRestaurantName(restData.name);
      setBillRequestEnabled(restData.bill_request_enabled ?? true);
      setIsRestaurantOpen(restData.is_open ?? true);

      // Buscar mesa DO RESTAURANTE ESPECÍFICO
      const tableResult = await supabase
        .from("tables")
        .select("id, is_hidden")
        .eq("table_number", parseInt(tableNumber))
        .eq("restaurant_id", restData.id)
        .limit(1)
        .maybeSingle();

      if (tableResult.error) throw tableResult.error;
      const tableData = tableResult.data;
      
      if (!tableData) {
        toast.error("Mesa não encontrada");
        return;
      }

      if (tableData.is_hidden) {
        toast.error("Esta mesa está indisponível no momento");
        setLoading(false);
        return;
      }
      
      setTableId(tableData.id);

      // Buscar comanda_id do cliente atual
      const comandaId = sessionStorage.getItem(`comanda_id_${tableNumber}`);
      
      // Pedidos + conta ativa da comanda via RPCs seguras (o RLS bloqueia a
      // leitura direta de orders/bills no fluxo anônimo). get_comanda_orders
      // já lida com ambos os casos (com/sem comanda_id) e com a última conta
      // paga, devolvendo a estrutura aninhada esperada pela tela.
      const { data: ordersData } = await (supabase as any).rpc("get_comanda_orders", {
        p_table_id: tableData.id,
        p_comanda_id: comandaId || null,
        p_customer_cpf: customerCPF || null,
      });

      const { data: activeBillRows } = await (supabase as any).rpc("get_active_bill", {
        p_table_id: tableData.id,
        p_comanda_id: comandaId || null,
      });

      const ordersList = Array.isArray(ordersData) ? ordersData : [];
      setOrders(ordersList);

      // Só mostrar status de bill se houver pedidos
      const activeBill = Array.isArray(activeBillRows) ? activeBillRows[0] : activeBillRows;
      if (activeBill && ordersList.length > 0) {
        setBillRequested(true);
        if (activeBill.status === "on_the_way") {
          setBillOnTheWay(true);
        }
      } else {
        // Limpar estados se não houver pedidos
        setBillRequested(false);
        setBillOnTheWay(false);
      }
    } catch (error: any) {
      toast.error("Erro ao carregar comanda");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [restaurantSlug, tableNumber]);

  // Buscar formas de pagamento quando restaurantId estiver disponível
  useEffect(() => {
    const fetchPaymentMethods = async () => {
      if (!restaurantId) return;
      
      const { data, error } = await supabase
        .from("payment_methods")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true);
      
      if (!error && data && data.length > 0) {
        setPaymentMethods(data);
        // Setar primeiro método como default
        setPaymentMethod(data[0].name);
        setSelectedPaymentMethodType(data[0].method_type);
      }
    };
    
    fetchPaymentMethods();
  }, [restaurantId]);

  // Memoizar cálculo do total
  const totals = useMemo(() => {
    const ordersSubtotal = orders.reduce((sum, order) => {
      const orderSum = order.order_items.reduce((itemSum, item) => {
        const extrasSum = (item.order_item_extras || []).reduce((s, e) => s + e.price_at_order, 0);
        return itemSum + (item.price_at_order + extrasSum) * item.quantity;
      }, 0);
      return sum + orderSum;
    }, 0);

    const cartSubtotal = cart.reduce((sum, item) => {
      const extrasTotal = item.extras.reduce((s, e) => s + e.price, 0);
      const effectivePrice = item.product.promotional_price ?? item.product.price;
      return sum + (effectivePrice + extrasTotal) * item.quantity;
    }, 0);

    const subtotal = ordersSubtotal + cartSubtotal;
    const serviceFee = serviceFeeEnabled ? subtotal * (serviceFeePercentage / 100) : 0;
    
    return {
      subtotal,
      cartSubtotal,
      ordersSubtotal,
      serviceFee,
      total: subtotal + serviceFee,
    };
  }, [orders, cart, serviceFeeEnabled, serviceFeePercentage]);

  // Verificar se há pedidos pendentes (aguardando aceitação)
  const hasPendingOrders = useMemo(() => {
    return orders.some(order => order.status === "pending");
  }, [orders]);

  const [submitting, setSubmitting] = useState(false);

  const handleSendOrder = async () => {
    if (submitting) return;
    if (!isRestaurantOpen) {
      toast.error("Restaurante fechado no momento. Não é possível enviar pedidos.");
      return;
    }
    if (cart.length === 0) {
      toast.error("Carrinho vazio");
      return;
    }

    if (!tableId) {
      toast.error("Mesa não encontrada");
      return;
    }

    setSubmitting(true);

    const customerName = sessionStorage.getItem(`customer_name_${tableNumber}`);
    const rawCustomerCPF = sessionStorage.getItem(`customer_cpf_${tableNumber}`);
    const customerCPF = (rawCustomerCPF || '').replace(/\D/g, '');

    try {
      // Get restaurant_id from the table
      const { data: tableData } = await supabase
        .from("tables")
        .select("restaurant_id")
        .eq("id", tableId)
        .single();

      if (!tableData) {
        throw new Error("Mesa não encontrada");
      }

      // Buscar comanda_id do sessionStorage ou criar uma nova (fallback)
      let comandaId = sessionStorage.getItem(`comanda_id_${tableNumber}`);
      
      // Se não existe comanda_id, criar uma nova (fallback para quando Menu.tsx não criou)
      if (!comandaId && customerName && customerCPF) {
        const cleanCpf = customerCPF.replace(/\D/g, '');
        
        // Verificar se já existe uma comanda ativa para este cliente (via RPC).
        const { data: comandaStatusRows } = await (supabase as any).rpc("get_comanda_status", {
          p_table_id: tableId,
          p_cpf: cleanCpf,
        });
        const comandaStatusRow = Array.isArray(comandaStatusRows) ? comandaStatusRows[0] : comandaStatusRows;
        const existingComanda = comandaStatusRow?.status === "active" ? { id: comandaStatusRow.id } : null;

        if (existingComanda) {
          comandaId = existingComanda.id;
        } else {
          // Criar nova comanda — id gerado no cliente (sem `.select()` de retorno).
          const newComandaId = novoId();
          const { error: comandaError } = await supabase
            .from("comandas")
            .insert({
              id: newComandaId,
              restaurant_id: tableData.restaurant_id,
              table_id: tableId,
              customer_name: customerName,
              customer_cpf: cleanCpf,
              status: "active"
            });

          if (!comandaError) {
            comandaId = newComandaId;
          }
        }
        
        // Salvar no sessionStorage para uso futuro
        if (comandaId) {
          sessionStorage.setItem(`comanda_id_${tableNumber}`, comandaId);
        }
      }

      // Criar pedido — id gerado no cliente (sem `.select()` de retorno,
      // bloqueado pelo RLS no fluxo anônimo).
      const orderId = novoId();
      const { error: orderError } = await supabase
        .from("orders")
        .insert({
          id: orderId,
          table_id: tableId,
          restaurant_id: tableData.restaurant_id,
          customer_name: customerName || "",
          customer_cpf: customerCPF || "",
          comanda_id: comandaId || null,
          status: "pending",
          order_type: "local",
          notes: orderNotes || null,
        });

      if (orderError) throw orderError;

      // Criar itens do pedido
      for (const item of cart) {
        const orderItemId = novoId();
        const { error: itemError } = await supabase
          .from("order_items")
          .insert({
            id: orderItemId,
            order_id: orderId,
            product_id: item.product.id,
            quantity: item.quantity,
            price_at_order: item.product.promotional_price ?? item.product.price,
            notes: item.notes || null,
          });

        if (itemError) throw itemError;

        // Inserir extras do item
        if (item.extras.length > 0) {
          const orderItemExtras = item.extras.map((extra: any) => ({
            order_item_id: orderItemId,
            product_extra_id: extra.is_complement ? null : extra.id,
            price_at_order: extra.price,
            extra_name: extra.name,
          }));

          const { error: extrasError } = await supabase
            .from("order_item_extras")
            .insert(orderItemExtras);

          if (extrasError) throw extrasError;
        }
      }

      // Limpar carrinho e observações
      setCart([]);
      setOrderNotes("");
      sessionStorage.removeItem(`cart_${tableNumber}`);
      
      toast.success("Pedido enviado! Aguarde a confirmação do restaurante");
      
      // Fetch data in separate try/catch to not trigger error toast
      try {
        fetchData();
      } catch (fetchErr) {
        console.error("Erro ao atualizar dados após pedido:", fetchErr);
      }
    } catch (error: any) {
      toast.error("Erro ao enviar pedido");
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestBill = async () => {
    if (!tableId) return;

    // Buscar comanda_id do cliente atual
    const comandaId = sessionStorage.getItem(`comanda_id_${tableNumber}`);
    
    if (!comandaId) {
      toast.error("Comanda não encontrada. Por favor, faça login novamente.");
      return;
    }

    // Verificar se já existe bill ativa para ESTA COMANDA (via RPC segura).
    const { data: existingBillRows } = await (supabase as any).rpc("get_active_bill", {
      p_table_id: tableId,
      p_comanda_id: comandaId,
    });
    const existingBill = Array.isArray(existingBillRows) ? existingBillRows : (existingBillRows ? [existingBillRows] : []);

    if (existingBill && existingBill.length > 0) {
      // Já existe bill para esta comanda - apenas atualizar estado local
      setBillRequested(true);
      if (existingBill[0].status === "on_the_way") {
        setBillOnTheWay(true);
      }
      setDialogOpen(false);
      toast.info("A conta já foi solicitada!");
      return;
    }

    // Validar troco em dinheiro - usar method_type para comparar
    const isCash = selectedPaymentMethodType === "cash";
    if (isCash && changeAmount) {
      const changeValue = parseFloat(changeAmount);
      if (changeValue < totals.total) {
        toast.error(`O valor para troco deve ser maior ou igual ao total da conta (R$ ${totals.total.toFixed(2)})`);
        return;
      }
    }

    try {
      // Usar method_type diretamente (cash, credit, debit, pix, meal_voucher)
      const normalizedPaymentMethod = selectedPaymentMethodType || "cash";

      // Sem `.select()` de retorno (bloqueado pelo RLS no fluxo anônimo);
      // billData não é usado adiante.
      const { error } = await supabase
        .from("bills")
        .insert({
          table_id: tableId,
          comanda_id: comandaId, // ← INCLUIR comanda_id
          subtotal: totals.subtotal,
          service_fee: totals.serviceFee,
          total_amount: totals.total,
          status: "requested",
          payment_method: normalizedPaymentMethod,
          change_amount: isCash ? parseFloat(changeAmount || "0") : null,
        });

      if (error) throw error;

      setBillRequested(true);
      setDialogOpen(false);
      toast.success("Conta solicitada! O garçom chegará em breve");
    } catch (error: any) {
      toast.error(`Erro ao solicitar conta: ${error.message || "tente novamente"}`);
      console.error(error);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };
  // Keep formatTime available for potential future use
  void formatTime;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Carregando comanda...</p>
      </div>
    );
  }

  // Check if we should show "Pedir a Conta" button in footer
  const showBillButton = billRequestEnabled && !billRequested && orders.length > 0 && cart.length === 0;
  const showSendOrderButton = cart.length > 0;

  return (
    <div className="flex flex-col overflow-hidden bg-gradient-to-br from-background via-secondary/20 to-background" style={{ height: '100dvh' }}>
      {/* Header - shrink-0 */}
      <div 
        className="shrink-0 text-white p-6 shadow-lg"
        style={{ backgroundColor: restaurantColor }}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/${restaurantSlug}/mesa/${tableNumber}`)}
          className="mb-4 text-white hover:bg-white/20"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar ao Cardápio
        </Button>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Receipt className="h-6 w-6" />
          Comanda - Mesa {tableNumber}
        </h1>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Status: Conta a caminho, Timer de preparo, Aguardando aceitação ou Conta solicitada */}
        {billOnTheWay && orders.length > 0 ? (
          <Card className="border" style={{ borderColor: restaurantColor }}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-center gap-3">
                <Receipt className="h-5 w-5" style={{ color: restaurantColor }} />
                <div className="text-center">
                  <p className="text-lg font-semibold" style={{ color: restaurantColor }}>
                    A conta está a caminho!
                  </p>
                  <p className="text-sm text-muted-foreground">
                    O garçom chegará em breve com sua conta
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : orders.some(o => o.status === "accepted" || o.status === "preparing") && !billRequested ? (
          <Card 
            className="border-2" 
            style={{ 
              borderColor: restaurantColor,
              backgroundColor: `${restaurantColor}15`
            }}
          >
            <CardContent className="pt-6">
              <div className="flex items-center justify-center gap-3">
                <Clock className="h-5 w-5" style={{ color: restaurantColor }} />
                <div className="text-center">
                  <p className="text-sm font-medium" style={{ color: restaurantColor }}>
                    Em Preparo
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : hasPendingOrders && !billRequested ? (
          <Card className="border-blue-500 bg-blue-50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-center gap-3">
                <Clock className="h-5 w-5 text-blue-600" />
                <div className="text-center">
                  <p className="text-lg font-semibold text-blue-800">
                    Pedido realizado!
                  </p>
                  <p className="text-sm text-blue-700 mt-1">
                    Aguardando aceitação da cozinha
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : billRequested && !billOnTheWay && orders.length > 0 ? (
          <Card className="border" style={{ borderColor: restaurantColor }}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-center gap-3">
                <Clock className="h-5 w-5" style={{ color: restaurantColor }} />
                <div className="text-center">
                  <p className="text-lg font-semibold" style={{ color: restaurantColor }}>
                    Conta solicitada!
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Aguardando garçom
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Carrinho (Itens não enviados) */}
        {cart.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Carrinho (Não enviado)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {cart.map((item) => {
                  const extrasTotal = item.extras.reduce((sum, e) => sum + e.price, 0);
                  const effectivePrice = item.product.promotional_price ?? item.product.price;
                  const itemTotal = (effectivePrice + extrasTotal) * item.quantity;
                  
                  return (
                    <div
                      key={item.id}
                      className="flex justify-between items-start py-2 border-b last:border-0"
                    >
                      <div className="flex-1">
                        <p className="font-medium">{item.product.name}</p>
                        <p className="text-sm text-muted-foreground">
                          Qtd: {item.quantity}
                        </p>
                        {item.extras.length > 0 && (
                          <div className="text-xs text-muted-foreground mt-1">
                            + {item.extras.map(e => e.name).join(', ')}
                          </div>
                        )}
                        {item.notes && (
                          <div className="text-xs text-muted-foreground mt-1 italic">
                            Obs: {item.notes}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <p className="font-semibold" style={{ color: restaurantColor }}>
                          R$ {itemTotal.toFixed(2)}
                        </p>
                        <button
                          onClick={() => {
                            setCart(prev => {
                              const updated = prev.filter(c => c.id !== item.id);
                              sessionStorage.setItem(`cart_${tableNumber}`, JSON.stringify(updated));
                              return updated;
                            });
                          }}
                          className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive transition-colors"
                          title="Remover item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4">
                <div className="space-y-2">
                  <Label htmlFor="order-notes">Observações do Pedido (opcional)</Label>
                  <Textarea
                    id="order-notes"
                    placeholder="Ex: Pedido urgente, alergia a amendoim..."
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Pedidos */}
        <Card>
          <CardHeader>
            <CardTitle>Itens Pedidos</CardTitle>
          </CardHeader>
          <CardContent>
            {orders.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Nenhum pedido realizado ainda
              </p>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => (
                  <div key={order.id} className="space-y-2">
                     <div className="flex items-center gap-2">
                       <Badge variant="outline" className={order.status === "pending" ? "border-blue-500 text-blue-700" : ""}>
                          {order.status === "pending" && "Aguardando"}
                          {order.status === "accepted" && "Em Preparo"}
                          {order.status === "preparing" && "Em Preparo"}
                          {order.status === "ready" && "Pronto"}
                          {order.status === "delivered" && "Entregue"}
                       </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(order.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    {order.notes && (
                      <p className="text-sm text-muted-foreground italic">
                        Obs: {order.notes}
                      </p>
                    )}
                    {order.order_items.map((item) => (
                      <div
                        key={item.id}
                        className="flex justify-between items-start py-2 border-b last:border-0"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{item.products?.name || "Produto removido"}</p>
                            {showPrepTimer && item.products?.prep_time_minutes && (order.status === "accepted" || order.status === "preparing") && (() => {
                              const orderCreatedAt = Math.floor(new Date(order.created_at).getTime() / 1000);
                              const elapsed = currentTime - orderCreatedAt;
                              const totalSecs = (item.products.prep_time_minutes || 0) * 60;
                              const remaining = Math.max(0, totalSecs - elapsed);
                              const mins = Math.floor(remaining / 60);
                              const secs = remaining % 60;
                              return (
                                <span 
                                  className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                                  style={{ 
                                    backgroundColor: remaining > 0 ? `${restaurantColor}20` : '#dcfce7',
                                    color: remaining > 0 ? restaurantColor : '#16a34a'
                                  }}
                                >
                                  {remaining > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : 'Pronto'}
                                </span>
                              );
                            })()}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Qtd: {item.quantity}
                          </p>
                          {item.order_item_extras && item.order_item_extras.length > 0 && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {item.order_item_extras
                                .filter(e => e.extra_name || e.product_extras?.name)
                                .map((e, i) => (
                                  <span key={i}>+ {e.extra_name || e.product_extras?.name}{i < item.order_item_extras.filter(ex => ex.extra_name || ex.product_extras?.name).length - 1 ? ', ' : ''}</span>
                                ))}
                            </div>
                          )}
                          {item.notes && (
                            <div className="text-xs text-muted-foreground mt-1 italic">
                              Obs: {item.notes}
                            </div>
                          )}
                        </div>
                        <p className="font-semibold" style={{ color: restaurantColor }}>
                          R$ {((item.price_at_order + (item.order_item_extras?.reduce((s, e) => s + e.price_at_order, 0) || 0)) * item.quantity).toFixed(2)}
                        </p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Totais */}
        <Card>
          <CardHeader>
            <CardTitle>Resumo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="font-semibold">R$ {totals.subtotal.toFixed(2)}</span>
            </div>
            {serviceFeeEnabled && totals.serviceFee > 0 && (
              <div className="flex justify-between">
                <span>Taxa de Serviço ({serviceFeePercentage}%)</span>
                <span className="font-semibold">R$ {totals.serviceFee.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-xl font-bold pt-3 border-t">
              <span>Total</span>
              <span style={{ color: restaurantColor }}>R$ {totals.total.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>
        </div>
      </div>

      {/* Footer fixo com botão de ação */}
      {(showSendOrderButton || showBillButton) && (
        <div className="shrink-0 border-t bg-background p-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}>
          <div className="container mx-auto">
            {showSendOrderButton && (
                <Button 
                className="w-full text-white" 
                size="lg"
                onClick={handleSendOrder}
                disabled={submitting || !isRestaurantOpen}
                style={{ backgroundColor: restaurantColor }}
              >
                <ShoppingCart className="h-4 w-4 mr-2" />
                {!isRestaurantOpen ? "Restaurante Fechado" : (submitting ? "Enviando..." : `Enviar Pedido · R$ ${totals.cartSubtotal.toFixed(2)}`)}
              </Button>
            )}
            {showBillButton && (
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button 
                    className="w-full text-white hover:opacity-90"
                    variant="ghost"
                    size="lg"
                    style={{ 
                      backgroundColor: restaurantColor,
                      borderColor: restaurantColor
                    }}
                  >
                    <Receipt className="h-5 w-5 mr-2" />
                    Pedir a Conta · R$ {totals.total.toFixed(2)}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Forma de Pagamento</DialogTitle>
                    <DialogDescription>
                      Selecione como deseja pagar a conta
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                    <RadioGroup value={paymentMethod} onValueChange={(value) => {
                      setPaymentMethod(value);
                      setSelectedBrand("");
                      const selected = paymentMethods.find(m => m.name === value);
                      if (selected) setSelectedPaymentMethodType(selected.method_type);
                    }}>
                      {paymentMethods.length > 0 ? (
                        paymentMethods.map((method) => {
                          const Icon = METHOD_ICONS[method.method_type] || CreditCard;
                          const brands = method.accepted_brands || [];
                          const isSelected = paymentMethod === method.name;
                          const maxPreviewBrands = 3;
                          
                          return (
                            <div 
                              key={method.id} 
                              className={`p-3 border rounded-lg cursor-pointer transition-all ${
                                isSelected ? "border-primary bg-primary/5" : "hover:border-primary/50"
                              }`}
                              onClick={() => {
                                setPaymentMethod(method.name);
                                setSelectedPaymentMethodType(method.method_type);
                              }}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2 min-w-0">
                                  <RadioGroupItem value={method.name} id={method.id} />
                                  <Label htmlFor={method.id} className="flex items-center gap-2 cursor-pointer">
                                    <Icon className="h-4 w-4 shrink-0" />
                                    <span className="truncate">{method.name}</span>
                                  </Label>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {!isSelected && brands.length > 0 && (
                                    <div className="flex items-center gap-1">
                                      {brands.slice(0, maxPreviewBrands).map((brandCode: string) => {
                                        const brand = getBrandInfo(brandCode);
                                        if (!brand) return null;
                                        return (
                                          <img 
                                            key={brandCode}
                                            src={brand.logo} 
                                            alt={brand.name}
                                            className="h-3 w-auto object-contain grayscale opacity-50"
                                            title={brand.name}
                                          />
                                        );
                                      })}
                                      {brands.length > maxPreviewBrands && (
                                        <span className="text-[10px] text-muted-foreground">+{brands.length - maxPreviewBrands}</span>
                                      )}
                                    </div>
                                  )}
                                  {brands.length > 0 && (
                                    isSelected ? (
                                      <ChevronUp className="w-4 h-4 text-muted-foreground" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                    )
                                  )}
                                </div>
                              </div>
                              {isSelected && brands.length > 0 && (
                                <div className="mt-3 pt-3 border-t animate-in fade-in slide-in-from-top-1 duration-200">
                                  <p className="text-xs text-muted-foreground mb-2">Selecione a bandeira:</p>
                                  <div className="grid grid-cols-3 gap-2">
                                    {brands.map((brandCode: string) => {
                                      const brand = getBrandInfo(brandCode);
                                      if (!brand) return null;
                                      const isBrandSelected = selectedBrand === brandCode;
                                      return (
                                        <button 
                                          key={brandCode}
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedBrand(brandCode);
                                          }}
                                          className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all ${
                                            isBrandSelected 
                                              ? "border-primary bg-primary/10" 
                                              : "border-transparent bg-muted hover:border-primary/30"
                                          }`}
                                        >
                                          <img 
                                            src={brand.logo} 
                                            alt={brand.name}
                                            className="h-5 w-auto object-contain"
                                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                          />
                                          <span className="text-[10px] font-medium leading-tight text-center">{brand.name}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <>
                          <div 
                            className={`p-3 border rounded-lg cursor-pointer transition-all ${paymentMethod === "PIX" ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}
                            onClick={() => { setPaymentMethod("PIX"); setSelectedPaymentMethodType("pix"); }}
                          >
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="PIX" id="pix" />
                              <Label htmlFor="pix" className="flex items-center gap-2 cursor-pointer">
                                <Smartphone className="h-4 w-4" />
                                PIX
                              </Label>
                            </div>
                          </div>
                          <div 
                            className={`p-3 border rounded-lg cursor-pointer transition-all ${paymentMethod === "Cartão" ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}
                            onClick={() => { setPaymentMethod("Cartão"); setSelectedPaymentMethodType("credit"); }}
                          >
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="Cartão" id="card" />
                              <Label htmlFor="card" className="flex items-center gap-2 cursor-pointer">
                                <CreditCard className="h-4 w-4" />
                                Cartão
                              </Label>
                            </div>
                          </div>
                          <div 
                            className={`p-3 border rounded-lg cursor-pointer transition-all ${paymentMethod === "Dinheiro" ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}
                            onClick={() => { setPaymentMethod("Dinheiro"); setSelectedPaymentMethodType("cash"); }}
                          >
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="Dinheiro" id="cash" />
                              <Label htmlFor="cash" className="flex items-center gap-2 cursor-pointer">
                                <Banknote className="h-4 w-4" />
                                Dinheiro
                              </Label>
                            </div>
                          </div>
                        </>
                      )}
                    </RadioGroup>

                    {selectedPaymentMethodType === "cash" && (
                      <div className="space-y-2">
                        <Label htmlFor="change">Troco para quanto? (Opcional)</Label>
                        <Input
                          id="change"
                          type="number"
                          step="0.01"
                          value={changeAmount}
                          onChange={(e) => setChangeAmount(e.target.value)}
                          placeholder="Ex: 100.00"
                        />
                        {changeAmount && parseFloat(changeAmount) > totals.total && (
                          <div className="flex justify-between items-center p-2 rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800">
                            <span className="text-sm text-muted-foreground">Troco:</span>
                            <span className="text-sm font-bold text-orange-600">
                              R$ {(parseFloat(changeAmount) - totals.total).toFixed(2)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    <Button 
                      onClick={handleRequestBill} 
                      className="w-full text-white"
                      style={{ backgroundColor: restaurantColor }}
                    >
                      Confirmar e Pedir Conta
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Comanda;

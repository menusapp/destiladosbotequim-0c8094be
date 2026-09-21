import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { resolveSlug } from "@/lib/slugResolver";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMenuInactivityLogout } from "@/hooks/useMenuInactivityLogout";
import { MenuHeader } from "@/components/menu/MenuHeader";
import { RestaurantInfoCard } from "@/components/menu/RestaurantInfoCard";
import { FeaturedProducts } from "@/components/menu/FeaturedProducts";
import { CategoryProducts } from "@/components/menu/CategoryProducts";
import { CategoryNav } from "@/components/menu/CategoryNav";

import { ComandaBottomBar } from "@/components/menu/ComandaBottomBar";
import { CartDrawer } from "@/components/menu/CartDrawer";
import { ProductDetailDrawer } from "@/components/menu/ProductDetailDrawer";
import CustomerInfoDialog from "@/components/menu/CustomerInfoDialog";
import { Clock } from "lucide-react";
import { ReviewModal } from "@/components/menu/ReviewModal";
import { Product, ProductExtra, Category, Restaurant, CartItem } from "@/types/menu";
import { isFeaturedVisible } from "@/lib/featuredUtils";
import { useInactiveStockItems } from "@/hooks/useInactiveStockItems";
import { useSessionTracking } from "@/hooks/useSessionTracking";
import { useFacebookPixel } from "@/hooks/useFacebookPixel";
import { useDynamicFavicon } from "@/hooks/useDynamicFavicon";
import { normalizeSearch } from "@/lib/searchNormalize";
import { novoId } from "@/lib/uuid";
const Menu = () => {
  const { slug: pathSlug, tableNumber } = useParams();
  const restaurantSlug = resolveSlug(pathSlug);
  const navigate = useNavigate();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [customerName, setCustomerName] = useState("");
  const [customerCPF, setCustomerCPF] = useState("");
  const [tableId, setTableId] = useState<string | null>(null);
  const [showCustomerDialog, setShowCustomerDialog] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productExtras, setProductExtras] = useState<ProductExtra[]>([]);
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [showCartDrawer, setShowCartDrawer] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewOrderId, setReviewOrderId] = useState<string | undefined>();
  const [reviewCounterOrderId, setReviewCounterOrderId] = useState<string | undefined>();
  const [reviewBillId, setReviewBillId] = useState<string | undefined>();
  const [blockLoginForReview, setBlockLoginForReview] = useState(false);
  const [hasOpenComanda, setHasOpenComanda] = useState(false);
  const [comandaTotal, setComandaTotal] = useState(0);
  const [comandaStatus, setComandaStatus] = useState<string>("");
  const [showComandaBar, setShowComandaBar] = useState(true);
  
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [featuredSectionTitle, setFeaturedSectionTitle] = useState("Destaques");

  const { data: inactiveData } = useInactiveStockItems(restaurant?.id || null);
  useFacebookPixel(restaurant?.facebook_pixel_id);
  useDynamicFavicon(restaurant?.logo_url, restaurant?.name);
  const disabledProductIds = inactiveData?.disabledProductIds || new Set<string>();
  const disabledExtraItemIds = inactiveData?.disabledExtraCategoryItemIds || new Set<string>();
  const disabledProductExtraIds = inactiveData?.disabledProductExtraIds || new Set<string>();
  const hiddenByRequiredChoices = inactiveData?.hiddenProductIdsByRequiredChoices || new Set<string>();

  // Session tracking for abandoned cart metrics
  const { trackCartUpdate: trackMenuCartUpdate } = useSessionTracking(restaurant?.id, restaurantSlug);

  // ⚡ Refs para manter valores atualizados nos listeners de realtime (evita stale closures)
  const tableIdRef = useRef<string | null>(null);
  const customerInfoRef = useRef<{name: string, cpf: string} | null>(null);
  const restaurantRef = useRef<Restaurant | null>(null);

  // Manter refs sincronizadas com estado
  useEffect(() => {
    tableIdRef.current = tableId;
  }, [tableId]);

  useEffect(() => {
    if (customerName && customerCPF) {
      customerInfoRef.current = { name: customerName, cpf: customerCPF };
    } else {
      customerInfoRef.current = null;
    }
  }, [customerName, customerCPF]);

  useEffect(() => {
    restaurantRef.current = restaurant;
  }, [restaurant]);

  useMenuInactivityLogout(tableId, tableNumber || "", restaurantSlug || "");

  // Track cart changes for abandoned cart metrics
  useEffect(() => {
    if (cart.length > 0) {
      trackMenuCartUpdate(cart);
    }
  }, [cart, trackMenuCartUpdate]);

  // Verificar se deve abrir modal de avaliação ao carregar
  useEffect(() => {
    const shouldShowReview = sessionStorage.getItem('shouldShowReview');
    
    if (shouldShowReview === 'true') {
      // BLOQUEAR dialog de login ANTES de tudo
      setBlockLoginForReview(true);
      
      const billId = sessionStorage.getItem('reviewBillId');
      const counterOrderId = sessionStorage.getItem('reviewCounterOrderId');
      
      
      // Limpar flags do sessionStorage
      sessionStorage.removeItem('shouldShowReview');
      sessionStorage.removeItem('reviewBillId');
      sessionStorage.removeItem('reviewCounterOrderId');
      
      // Abrir modal IMEDIATAMENTE
      if (billId) setReviewBillId(billId);
      if (counterOrderId) setReviewCounterOrderId(counterOrderId);
      setReviewModalOpen(true);
      
    }
  }, []); // Executar apenas UMA VEZ ao montar

  const fetchData = useCallback(async () => {
    if (!restaurantSlug || !tableNumber) return;
    try {
      // ⚡ Query única otimizada com TODOS os dados relacionados
      const { data: restaurantData, error: restError } = await supabase
        .from("restaurants")
        .select(`
          id, name, slug, is_open, logo_url, banner_url, primary_color, menu_background_color,
          prep_time_minutes, service_fee_enabled, service_fee_percentage,
          featured_section_enabled, featured_section_title,
          login_require_name, login_require_phone, login_require_birth_date,
          facebook_pixel_id,
          categories (
            id, name, display_order,
            products (
              id, name, description, price, promotional_price, available, image_url, 
              is_featured, prep_time_minutes, featured_display_order, featured_active, featured_schedule,
              product_extras (id, name, price)
            )
          )
        `)
        .eq("slug", restaurantSlug)
        .order("display_order", { foreignTable: "categories" })
        .single();
      
      if (restError) throw restError;
      setRestaurant(restaurantData);
      
      // Configurar título da seção de destaques
      if (restaurantData.featured_section_title) {
        setFeaturedSectionTitle(restaurantData.featured_section_title);
      }

      // ⚡ Buscar tableId - suporta AMBOS: table_number (int) OU id (UUID)
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tableNumber);
      
      let tableData;
      let tableError;
      
      if (isUUID) {
        // tableNumber é um UUID - buscar pelo id
        const result = await supabase
          .from("tables").select("id, table_number")
          .eq("restaurant_id", restaurantData.id)
          .eq("id", tableNumber)
          .single();
        tableData = result.data;
        tableError = result.error;
      } else {
        // tableNumber é um número - buscar pelo table_number
        const result = await supabase
          .from("tables").select("id, table_number")
          .eq("restaurant_id", restaurantData.id)
          .eq("table_number", parseInt(tableNumber))
          .single();
        tableData = result.data;
        tableError = result.error;
      }
      
      if (tableError) {
        console.error('❌ Erro ao buscar mesa:', tableError);
        throw tableError;
      }
      
      setTableId(tableData.id);

      // ⚡ Processar categorias dos dados JÁ CARREGADOS (sem query adicional!)
      // Filtrar produtos em destaque para não aparecerem duplicados nas categorias
      const sortedCategories = (restaurantData.categories || [])
        .filter((cat: any) => cat.is_active !== false)
        .map((cat: any) => ({ 
          ...cat, 
          products: (cat.products || [])
            .filter((p: Product) => {
              if (!p.available || p.is_featured) return false;
              const channels = (p as any).visibility_channels || ['all'];
              return channels.includes('all') || channels.includes('mesa');
            })
            .sort((a: Product, b: Product) => a.name.localeCompare(b.name)) 
        }))
        .filter((cat: Category) => cat.products.length > 0);
      setCategories(sortedCategories);

      // ⚡ Buscar destaques separadamente (inclui produtos SEM categoria)
      if (restaurantData.featured_section_enabled) {
        const { data: featuredData } = await supabase
          .from("products")
          .select("id, name, description, price, promotional_price, available, image_url, prep_time_minutes, is_featured, featured_display_order, featured_active, featured_schedule, visibility_channels")
          .eq("restaurant_id", restaurantData.id)
          .eq("is_featured", true)
          .order("featured_display_order");

        const featured = (featuredData || [])
          .filter((p: any) => {
            if (!isFeaturedVisible(p)) return false;
            const channels = p.visibility_channels || ['all'];
            return channels.includes('all') || channels.includes('mesa');
          });
        setFeaturedProducts(featured as any);
      } else {
        setFeaturedProducts([]);
      }

      // ⚡ Não chamar checkOpenComanda aqui - useEffect cuida disso
    } catch (error: any) {
      toast.error("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  }, [restaurantSlug, tableNumber]);

  const checkOpenComanda = useCallback(async (currentTableId: string, currentCart: CartItem[]) => {
    try {
      // Calcular total do carrinho SEMPRE (mesmo sem customer info)
      const cartTotal = currentCart.reduce((sum, item) => {
        const extrasSum = item.extras?.reduce((extraSum, extra) => extraSum + extra.price, 0) || 0;
        const effectivePrice = item.product.promotional_price ?? item.product.price;
        return sum + (effectivePrice + extrasSum) * item.quantity;
      }, 0);

      // Obter informações do cliente da sessão atual
      const savedCustomerInfo = sessionStorage.getItem("customerInfo");
      if (!savedCustomerInfo) {
        setHasOpenComanda(false);
        setComandaTotal(cartTotal); // Mostrar total do carrinho mesmo sem customer info
        setComandaStatus("");
        return;
      }

      const currentCustomer = JSON.parse(savedCustomerInfo);
      
      // 🔑 CRÍTICO: Obter comanda_id da sessão (isolamento por CPF)
      const comandaId = sessionStorage.getItem(`comanda_id_${tableNumber}`);

      // Verificar se a COMANDA ESPECÍFICA DO CLIENTE foi fechada (não da mesa toda!)
      // Isso evita que pagar uma comanda afete outras comandas na mesma mesa
      if (comandaId) {
        // Verificar se a comanda do cliente está fechada via RPC
        const { data: comandaRows } = await (supabase as any).rpc("get_comanda_status", {
          p_table_id: currentTableId,
          p_cpf: currentCustomer.cpf,
        });
        const clientComanda = (Array.isArray(comandaRows) ? comandaRows : [comandaRows]).find(
          (c: any) => c?.id === comandaId
        );
        
        if (clientComanda?.status === "closed") {
          setHasOpenComanda(false);
          setComandaTotal(cartTotal);
          setComandaStatus("");
          return;
        }
        
        // Verificar se existe bill paga DESTA COMANDA específica
        const { data: paidBillId } = await (supabase as any).rpc('get_paid_bill_for_comanda', { p_comanda_id: comandaId });
        if (paidBillId) {
          setHasOpenComanda(false);
          setComandaTotal(cartTotal);
          setComandaStatus("");
          return;
        }
      }

      // Buscar total agregado dos pedidos abertos do cliente atual via RPC segura
      const { data: ordersTotalRpc } = await (supabase as any).rpc('get_table_pending_orders_total', {
        p_table_id: currentTableId,
        p_comanda_id: comandaId || null,
        p_customer_cpf: currentCustomer.cpf,
        p_customer_name: currentCustomer.name,
      });
      const ordersTotal = Number(ordersTotalRpc) || 0;

      if (ordersTotal > 0) {
        setHasOpenComanda(true);
      } else {
        setHasOpenComanda(false);
        setComandaStatus("");
      }

      // Total da comanda = pedidos enviados + carrinho
      setComandaTotal(ordersTotal + cartTotal);
    } catch (error) {
      console.error("Erro ao verificar comanda:", error);
    }
  }, [tableNumber]);

  // Bottom bar always visible - no scroll hiding
  useEffect(() => {
    setShowComandaBar(true);
  }, []);

  // Atualizar total da comanda sempre que o cart ou tableId mudar
  useEffect(() => {
    if (tableId && customerName) {
      checkOpenComanda(tableId, cart);
    }
  }, [cart, tableId, customerName, checkOpenComanda]);

  // Realtime subscription para pedidos da mesa e status do restaurante
  useEffect(() => {
    if (!restaurant?.id) return;
    const channel = supabase
      .channel('menu-restaurant-status')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'restaurants',
        filter: `id=eq.${restaurant.id}`,
      }, (payload) => {
        const updated = payload.new as any;
        setRestaurant((prev: any) => prev ? { ...prev, ...updated } : null);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [restaurant?.id]);


  // Dialog de login NÃO é mais automático - usuário pode navegar livremente

  useEffect(() => {
    
    // 🚨 PRIMEIRA PRIORIDADE: Verificar se é um logout forçado
    const forceLogout = sessionStorage.getItem('forceLogout');
    
    if (forceLogout === 'true') {
      
      // Remover flag
      sessionStorage.removeItem('forceLogout');
      
      // Limpar TUDO relacionado à sessão
      sessionStorage.removeItem(`customer_name_${tableNumber}`);
      sessionStorage.removeItem(`customer_cpf_${tableNumber}`);
      sessionStorage.removeItem(`cart_${tableNumber}`);
      sessionStorage.removeItem(`table_id_${tableNumber}`);
      sessionStorage.removeItem('customerInfo');
      
      // Resetar TODOS os estados para garantir
      setCustomerName("");
      setCustomerCPF("");
      setTableId(null);
      setCart([]);
      setHasOpenComanda(false);
      setComandaTotal(0);
      
      // ⚡ NÃO mostrar dialog aqui - esperar fetchData terminar
      
      // Buscar dados do restaurante
      fetchData();
      
    }
    
    // Tentar restaurar sessão apenas se NÃO foi logout forçado
    if (!forceLogout || forceLogout !== 'true') {
      const savedName = sessionStorage.getItem(`customer_name_${tableNumber}`);
      const savedCPF = sessionStorage.getItem(`customer_cpf_${tableNumber}`);
      const savedTableId = sessionStorage.getItem(`table_id_${tableNumber}`);
      
      if (savedName && savedCPF) {
        const savedCart = sessionStorage.getItem(`cart_${tableNumber}`);
        if (savedCart) setCart(JSON.parse(savedCart));
        setCustomerName(savedName);
        setCustomerCPF(savedCPF);
        if (savedTableId) setTableId(savedTableId);
        fetchData();
      } else {
        sessionStorage.removeItem(`cart_${tableNumber}`);
        sessionStorage.removeItem(`table_id_${tableNumber}`);
        setCart([]);
        // ⚡ NÃO mostrar dialog aqui - esperar fetchData terminar
        fetchData();
      }
    }
    
    // Configurar realtime (sempre, independente de logout)
    // ⚠️ Aguarda restaurant.id para aplicar filtros server-side (isolamento entre tenants)
    const restaurantId = restaurant?.id;
    if (!restaurantId) return;

    const savedCustomerInfo = sessionStorage.getItem("customerInfo");
    const currentCustomer = savedCustomerInfo ? JSON.parse(savedCustomerInfo) : null;
    
    const channel = supabase.channel(`menu-changes-${restaurantId}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'products',
        filter: `restaurant_id=eq.${restaurantId}`
      }, () => {
        if (restaurantRef.current?.id) {
          fetchData();
        }
      })
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'categories',
        filter: `restaurant_id=eq.${restaurantId}`
      }, () => {
        if (restaurantRef.current?.id) {
          fetchData();
        }
      })
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'restaurants',
        filter: `id=eq.${restaurantId}`
      }, (payload) => {
        const updatedRestaurant = payload.new as any;
        
        setRestaurant((prev: any) => ({...prev, ...updatedRestaurant}));
        
        // Silenciado para não atrapalhar cliente
      })
      // NOTE: orders/bills postgres_changes listeners removed (locked tables).
      // Replaced by 15s polling of get_comanda_status in a dedicated useEffect below.
      // 🚪 Listener de mesa para detectar esvaziamento forçado (admin)
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'tables',
        filter: `restaurant_id=eq.${restaurantId}`
      }, (payload) => {
        const table = payload.new as any;
        const oldTable = payload.old as any;
        
        const currentTableId = tableIdRef.current;
        const currentCustomer = customerInfoRef.current;
        
        // Se a mesa atual foi esvaziada (estava ocupada e agora está livre)
        if (currentTableId && table.id === currentTableId && currentCustomer) {
          if (oldTable?.is_occupied === true && table.is_occupied === false) {
            
            // Silenciado para cliente
            
            // Limpar sessão do cliente
            sessionStorage.removeItem("customerInfo");
            sessionStorage.removeItem(`comanda_id_${tableNumber}`);
            sessionStorage.removeItem(`cart_${tableNumber}`);
            
            // Resetar estados
            setCustomerName("");
            setCustomerCPF("");
            setCart([]);
            setHasOpenComanda(false);
            setComandaTotal(0);
            
            // Mostrar dialog de login novamente
            setShowCustomerDialog(true);
          }
        }
      })
      .subscribe((status) => {
      });
      
    return () => { 
      supabase.removeChannel(channel); 
    };
  }, [fetchData, restaurantSlug, tableNumber, restaurant?.id]);

  // 🔁 Polling (15s) de status de comanda/pedidos/conta - substitui realtime em orders/bills
  useEffect(() => {
    if (!restaurant?.id) return;
    const interval = setInterval(async () => {
      const currentTableId = tableIdRef.current;
      const currentCustomer = customerInfoRef.current;
      if (!currentTableId || !currentCustomer) return;

      // Atualiza dados de comanda/pedidos
      checkOpenComanda(currentTableId, cart);

      // Verificar status da comanda para detectar fechamento (pagamento)
      const { data: comandaRows } = await (supabase as any).rpc("get_comanda_status", {
        p_table_id: currentTableId,
        p_cpf: currentCustomer.cpf,
      });
      const myComandaId = sessionStorage.getItem(`comanda_id_${tableNumber}`);
      const myComanda = (Array.isArray(comandaRows) ? comandaRows : [comandaRows]).find(
        (c: any) => c?.id === myComandaId
      );
      if (myComanda?.status === "closed" && !reviewModalOpen) {
        setReviewModalOpen(true);
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [restaurant?.id, tableNumber, cart, checkOpenComanda, reviewModalOpen]);

  // 🔒 Revalidar sessão ao voltar do background (visibilitychange + focus)
  useEffect(() => {
    const revalidateSession = async () => {
      const comandaId = sessionStorage.getItem(`comanda_id_${tableNumber}`);
      const savedName = sessionStorage.getItem(`customer_name_${tableNumber}`);
      
      if (!comandaId || !savedName) return;
      
      try {
        const { data: comandaRows } = await (supabase as any).rpc("get_comanda_status_by_id", {
          p_comanda_id: comandaId,
        });
        const comanda = Array.isArray(comandaRows) ? comandaRows[0] : comandaRows;

        if (!comanda || comanda.status === "closed") {

          const { data: paidBillId } = await (supabase as any).rpc("get_paid_bill_for_comanda", {
            p_comanda_id: comandaId,
          });

          if (paidBillId) {
            sessionStorage.setItem('shouldShowReview', 'true');
            sessionStorage.setItem('reviewBillId', paidBillId);
          }
          
          sessionStorage.removeItem(`customer_name_${tableNumber}`);
          sessionStorage.removeItem(`customer_cpf_${tableNumber}`);
          sessionStorage.removeItem(`cart_${tableNumber}`);
          sessionStorage.removeItem(`comanda_id_${tableNumber}`);
          sessionStorage.removeItem(`table_id_${tableNumber}`);
          sessionStorage.removeItem("customerInfo");
          
          window.location.reload();
          return;
        }
        
        const savedTableId = sessionStorage.getItem(`table_id_${tableNumber}`);
        if (savedTableId) {
          const { data: table } = await supabase
            .from("tables")
            .select("is_occupied")
            .eq("id", savedTableId)
            .maybeSingle();
          
          if (table && !table.is_occupied) {
            
            sessionStorage.removeItem(`customer_name_${tableNumber}`);
            sessionStorage.removeItem(`customer_cpf_${tableNumber}`);
            sessionStorage.removeItem(`cart_${tableNumber}`);
            sessionStorage.removeItem(`comanda_id_${tableNumber}`);
            sessionStorage.removeItem(`table_id_${tableNumber}`);
            sessionStorage.removeItem("customerInfo");
            
            window.location.reload();
            return;
          }
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
  }, [tableNumber]);

  useEffect(() => {
    // ✅ Só salvar se temos dados válidos (não strings vazias)
    if (customerName && customerName.trim() !== "" && 
        customerCPF && customerCPF.trim() !== "") {
      sessionStorage.setItem(`cart_${tableNumber}`, JSON.stringify(cart));
    }
  }, [cart, tableNumber, customerName, customerCPF]);

  // ⚡ Listener de beforeunload para limpar mesa
  // IMPORTANTE: Só libera mesa se NÃO houver comandas ativas, pedidos ativos OU bills não pagas
  useEffect(() => {
    const checkAndReleaseTa = async (currentTableId: string) => {
      // Verifica atividade em aberto (conta não paga, comanda ativa ou pedido
      // em andamento) via RPC segura — antes eram 3 leituras diretas.
      const { data: hasActivity } = await (supabase as any).rpc("table_has_activity", {
        p_table_id: currentTableId,
      });

      // Só liberar mesa se NÃO houver nenhuma condição ativa
      const shouldKeepOccupied = hasActivity === true;

      if (!shouldKeepOccupied) {
        await supabase.from("tables").update({
          is_occupied: false,
          occupied_at: null,
          occupied_by: null
        }).eq("id", currentTableId);
      }
    };

    const handleBeforeUnload = () => {
      if (tableId) {
        // Não podemos usar async/await aqui, então usamos navigator.sendBeacon ou ignoramos
        // O cleanup no return vai cuidar disso
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (tableId) {
        checkAndReleaseTa(tableId);
      }
    };
  }, [tableId, customerName, customerCPF]);

  const handleCompleteLogout = useCallback(async () => {
    
    // IMPORTANTE: Fechar a comanda no banco ANTES de limpar a sessão
    const comandaId = sessionStorage.getItem(`comanda_id_${tableNumber}`);
    if (comandaId) {
      try {
        const { error } = await supabase
          .from("comandas")
          .update({
            status: "closed",
            closed_at: new Date().toISOString()
          })
          .eq("id", comandaId);
        
        if (error) {
          console.error("Erro ao fechar comanda:", error);
        } else {
        }
      } catch (err) {
        console.error("Erro ao fechar comanda:", err);
      }
    }
    
    // Limpar TODOS os estados
    setCustomerName("");
    setCustomerCPF("");
    setTableId(null);
    setCart([]);
    setHasOpenComanda(false);
    setComandaTotal(0);
    setReviewModalOpen(false);
    setReviewBillId(undefined);
    setReviewOrderId(undefined);
    setReviewCounterOrderId(undefined);
    
    // Limpar sessionStorage
    sessionStorage.removeItem(`customer_name_${tableNumber}`);
    sessionStorage.removeItem(`customer_cpf_${tableNumber}`);
    sessionStorage.removeItem(`cart_${tableNumber}`);
    sessionStorage.removeItem(`table_id_${tableNumber}`);
    sessionStorage.removeItem(`comanda_id_${tableNumber}`);
    sessionStorage.removeItem('customerInfo');
    sessionStorage.removeItem('shouldShowReview');
    sessionStorage.removeItem('reviewBillId');
    sessionStorage.removeItem('reviewCounterOrderId');
    sessionStorage.removeItem('forceLogout');
    
    // Forçar dialog de login
    setShowCustomerDialog(true);
    
    // Silenciado
  }, [tableNumber]);

  const handleCustomerInfoSubmit = async (name: string, cpf: string, phone?: string) => {
    
    // Validação de CPF
    if (!cpf || cpf.trim() === '') {
      console.error('❌ CPF não recebido ou vazio!');
      toast.error("CPF é obrigatório");
      return;
    }
    
    if (!restaurant || !tableNumber) {
      console.error('❌ Dados não carregados:', { restaurant: !!restaurant, tableNumber });
      toast.error("Aguarde o carregamento dos dados...");
      return;
    }

    // Limpar CPF uma vez no início
    const cleanCpf = cpf.replace(/\D/g, '');

    try {
      // Check if customer exists in database - use saved name, ignore typed name
      const { data: customerRows } = await (supabase as any).rpc("get_customer_by_cpf", { p_cpf: cleanCpf });
      const existingCustomer = Array.isArray(customerRows) ? customerRows[0] : customerRows;
      
      const finalName = existingCustomer ? existingCustomer.name : name;
      const finalPhone = existingCustomer?.phone || phone;
      
      // Update phone if new one provided and customer exists but has no phone
      if (existingCustomer && phone && !existingCustomer.phone) {
        await (supabase as any).rpc("set_customer_phone_if_empty", {
          p_restaurant_id: restaurant.id,
          p_cpf: cleanCpf,
          p_phone: phone,
        });
      }

      

      // ⚡ Suportar AMBOS: table_number (int) OU id (UUID)
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tableNumber);
      
      let tableData;
      let tableError;
      
      if (isUUID) {
        const result = await supabase
          .from("tables")
          .select("id, is_occupied, occupied_by, table_number")
          .eq("restaurant_id", restaurant.id)
          .eq("id", tableNumber)
          .single();
        tableData = result.data;
        tableError = result.error;
      } else {
        const result = await supabase
          .from("tables")
          .select("id, is_occupied, occupied_by, table_number")
          .eq("restaurant_id", restaurant.id)
          .eq("table_number", parseInt(tableNumber))
          .single();
        tableData = result.data;
        tableError = result.error;
      }

      if (tableError || !tableData) {
        console.error('❌ Mesa não encontrada:', tableError);
        toast.error("Mesa não encontrada");
        return;
      }
      

      // Verificar se este cliente já tem comanda ativa nesta mesa via RPC
      const { data: comandaStatusRows } = await (supabase as any).rpc("get_comanda_status", {
        p_table_id: tableData.id,
        p_cpf: cleanCpf,
      });
      const comandaStatusRow = Array.isArray(comandaStatusRows) ? comandaStatusRows[0] : comandaStatusRows;
      const existingComanda = comandaStatusRow?.status === "active" ? { id: comandaStatusRow.id } : null;

      let comandaId: string | undefined;

      if (existingComanda) {
        // Cliente já tem comanda ativa - usar a existente
        comandaId = existingComanda.id;
      } else {
        // Criar nova comanda para este cliente (NÃO fechar as outras).
        // id gerado no cliente para não depender de `.select()` de retorno
        // (bloqueado pelo RLS no fluxo anônimo).
        const newComandaId = novoId();
        const { error: comandaError } = await supabase
          .from("comandas")
          .insert({
            id: newComandaId,
            restaurant_id: restaurant.id,
            table_id: tableData.id,
            customer_name: finalName,
            customer_cpf: cleanCpf,
            status: "active"
          });

        if (comandaError) {
          console.error("Erro ao criar comanda:", comandaError);
        } else {
          comandaId = newComandaId;
        }
      }

      // Contar comandas ativas na mesa para atualizar occupied_by
      const { data: activeCountRpc } = await (supabase as any).rpc('count_active_comandas_for_table', { p_table_id: tableData.id });
      const clientCount = Number(activeCountRpc) || 1;
      const occupiedByText = clientCount === 1 
        ? `${finalName}` 
        : `${clientCount} clientes`;

      // Atualizar mesa como ocupada
      const { error: updateError } = await supabase
        .from("tables")
        .update({
          is_occupied: true,
          occupied_at: tableData.is_occupied ? tableData.occupied_at : new Date().toISOString(),
          occupied_by: occupiedByText,
        })
        .eq("id", tableData.id);

      if (updateError) throw updateError;

      // Salvar dados no sessionStorage
      sessionStorage.setItem(`customer_name_${tableNumber}`, finalName);
      sessionStorage.setItem(`customer_cpf_${tableNumber}`, cleanCpf);
      sessionStorage.setItem(`table_id_${tableNumber}`, tableData.id);
      sessionStorage.setItem("customerInfo", JSON.stringify({ name: finalName, cpf: cleanCpf }));
      if (comandaId) {
        sessionStorage.setItem(`comanda_id_${tableNumber}`, comandaId);
      }
      
      // Atualizar estados
      setCustomerName(finalName);
      setCustomerCPF(cleanCpf);
      setTableId(tableData.id);
      setShowCustomerDialog(false);
      
      // Silenciado - sem toast de boas-vindas
      
      // Carregar dados
      fetchData();
    } catch (error) {
      console.error("Erro ao registrar cliente:", error);
      toast.error("Erro ao fazer login");
    }
  };

  const handleProductClick = useCallback(async (product: Product) => {
    if (!customerName || !customerCPF) {
      toast.error("Faça login para adicionar itens ao pedido");
      if (!showCustomerDialog) {
        setShowCustomerDialog(true);
      }
      return;
    }
    // Buscar extras diretos do produto
    const { data: extrasData } = await supabase.from("product_extras")
      .select("id, name, description, price, is_required, min_selection, max_selection, extra_category_id, extra_categories(name, is_active)")
      .eq("product_id", product.id)
      .neq("is_active", false);

    // Map extra_category_name from joined data, filter out extras from inactive categories
    const extrasWithCategoryName = (extrasData || [])
      .filter((e: any) => !e.extra_categories || e.extra_categories.is_active !== false)
      .map((e: any) => ({
        ...e,
        extra_category_name: e.extra_categories?.name || undefined,
        extra_categories: undefined,
      }));

    // Buscar complementos vinculados via product_complement_groups
    const { data: complementGroups } = await supabase
      .from("product_complement_groups")
      .select("*, extra_categories(id, name, is_active, extra_category_items(id, name, description, price, is_active))")
      .eq("product_id", product.id)
      .order("display_order");

    // Converter complementos para o formato de ProductExtra (filter inactive categories and items)
    const complementExtras: ProductExtra[] = (complementGroups || [])
      .filter((group: any) => group.extra_categories?.is_active !== false)
      .flatMap((group: any) => {
        const items = (group.extra_categories?.extra_category_items || []).filter((item: any) => item.is_active !== false);
        return items.map((item: any) => ({
          id: item.id,
          name: item.name,
          description: item.description || null,
          price: item.price,
          is_required: group.is_required || false,
          min_selection: group.min_selection || 0,
          max_selection: group.max_selection || undefined,
          extra_category_id: group.extra_category_id,
          extra_category_name: group.extra_categories?.name || undefined,
          is_complement: true,
        }));
      });

    const allExtras = [...extrasWithCategoryName, ...complementExtras]
      .filter((e: any) => !disabledExtraItemIds.has(e.id) && !disabledProductExtraIds.has(e.id));
    setSelectedProduct(product);
    setProductExtras(allExtras);
    setShowProductDialog(true);
  }, [customerName, customerCPF, showCustomerDialog]);

  const addToCart = useCallback((product: Product, extras: ProductExtra[], notes?: string, quantity: number = 1) => {
    setCart((prev) => {
      const existing = prev.find((item) => 
        item.product.id === product.id && 
        JSON.stringify(item.extras.map(e => e.id).sort()) === JSON.stringify(extras.map(e => e.id).sort()) &&
        item.notes === notes
      );
      if (existing) {
        return prev.map((item) => item.id === existing.id ? { ...item, quantity: item.quantity + quantity } : item);
      }
      return [...prev, { id: novoId(), product, quantity, extras, notes }];
    });
    // Silenciado - sem toast ao adicionar ao carrinho
  }, []);

  const updateQuantity = (itemId: string, delta: number) => {
    setCart((prev) => prev.map((item) => 
      item.id === itemId ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item
    ).filter((item) => item.quantity > 0));
  };

  const getCartTotal = () => cart.reduce((sum, item) => {
    const extrasTotal = item.extras.reduce((s, e) => s + e.price, 0);
    const effectivePrice = item.product.promotional_price ?? item.product.price;
    return sum + (effectivePrice + extrasTotal) * item.quantity;
  }, 0);

  const getTotalItemCount = () => cart.reduce((sum, item) => sum + item.quantity, 0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Carregando cardápio...</p>
        </div>
      </div>
    );
  }


  if (!restaurant) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Restaurante não encontrado</p>
      </div>
    );
  }

  const primaryColor = restaurant.primary_color || "#184a2d";
  const menuBackground = (restaurant as any).menu_background_color || undefined;

  // Filtrar produtos vinculados a insumos inativos
  const activeCategories = categories.map(cat => ({
    ...cat,
    products: cat.products.filter(p => !disabledProductIds.has(p.id) && !hiddenByRequiredChoices.has(p.id))
  })).filter(cat => cat.products.length > 0);

  const activeFeatured = featuredProducts.filter(p => !disabledProductIds.has(p.id) && !hiddenByRequiredChoices.has(p.id));

  const allProducts = activeCategories.flatMap((c) => c.products);

  // Filtrar produtos pela busca
  const filteredCategories = searchQuery.trim() 
    ? activeCategories.map(cat => ({
        ...cat,
        products: cat.products.filter(p => 
          normalizeSearch(p.name).includes(normalizeSearch(searchQuery))
        )
      })).filter(cat => cat.products.length > 0)
    : activeCategories;

  const filteredProducts = searchQuery.trim()
    ? allProducts.filter(p => normalizeSearch(p.name).includes(normalizeSearch(searchQuery)))
    : allProducts;

  const cartItemCount = getTotalItemCount();

  return (
    <div className="min-h-screen bg-background" style={{ backgroundColor: menuBackground }}>
      {/* Header area */}
      <div className="relative">
        <div className="h-48 overflow-hidden relative">
          {restaurant.banner_url ? (
            <div
              className="w-full h-full bg-cover bg-center"
              style={{ backgroundImage: `url(${restaurant.banner_url})` }}
            />
          ) : restaurant.logo_url ? (
            <div
              className="w-full h-full bg-cover bg-center"
              style={{ backgroundImage: `url(${restaurant.logo_url})` }}
            />
          ) : (
            <div
              className="w-full h-full"
              style={{ backgroundColor: primaryColor }}
            />
          )}
        </div>

        <MenuHeader 
          searchOpen={searchOpen}
          searchQuery={searchQuery}
          onSearchClick={() => setSearchOpen(true)}
          onSearchChange={setSearchQuery}
          onSearchClose={() => {
            setSearchOpen(false);
            setSearchQuery("");
          }}
        />

        <RestaurantInfoCard
          restaurantId={restaurant.id}
          name={restaurant.name}
          logoUrl={restaurant.logo_url}
          primaryColor={primaryColor}
          tableInfo={`Mesa ${tableNumber}`}
          deliveryTime=""
          deliveryFee={0}
        />
      </div>

      {/* Restaurant closed banner */}
      {!restaurant.is_open && (
        <div className="mx-4 mt-2 mb-1 px-4 py-3 rounded-lg bg-destructive/5 border border-destructive/20 flex items-center gap-3">
          <Clock className="w-5 h-5 text-destructive shrink-0" />
          <p className="text-sm text-destructive/80">
            Restaurante fechado no momento. Não é possível realizar pedidos.
          </p>
        </div>
      )}

      {/* Product content */}
      <div style={{ paddingBottom: customerName ? '80px' : '0px' }}>

      {searchQuery.trim() ? (
        <div className="px-4 py-6">
          <h2 className="text-lg font-semibold mb-4">Resultados da busca</h2>
          {filteredProducts.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {filteredProducts.filter(p => p.available).map((product) => (
                <div
                  key={product.id}
                  onClick={() => handleProductClick(product)}
                  className="bg-white rounded-2xl shadow-sm overflow-hidden cursor-pointer active:scale-95 transition-transform"
                >
                  <div className="aspect-square bg-muted">
                    {product.image_url ? (
                      <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        Sem imagem
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <h3 className="font-semibold text-sm mb-1">{product.name}</h3>
                    <p className="text-lg font-bold" style={{ color: primaryColor }}>
                      R$ {product.price.toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              Nenhum produto encontrado para "{searchQuery}"
            </p>
          )}
        </div>
      ) : (
        <>
          <CategoryNav
            categories={filteredCategories}
            primaryColor={primaryColor}
          />

          {activeFeatured.length > 0 && (
            <FeaturedProducts
              products={activeFeatured}
              primaryColor={primaryColor}
              onProductClick={handleProductClick}
              title={featuredSectionTitle}
            />
          )}

          {featuredProducts.length === 0 && <div className="h-6" />}

          <CategoryProducts
            categories={filteredCategories}
            primaryColor={primaryColor}
            onProductClick={handleProductClick}
            showNav={false}
          />
        </>
      )}
      </div>

      {/* Barra de comanda - sempre visível no modo consumo local quando cliente está logado */}
      {customerName && (
        <ComandaBottomBar
          total={getCartTotal()}
          primaryColor={primaryColor}
          status={comandaStatus}
          isVisible={showComandaBar && !showProductDialog}
          hasSubmittedOrders={hasOpenComanda}
          cartItemCount={cartItemCount}
          onViewComanda={() => navigate(`/${restaurantSlug}/comanda/${tableNumber}`)}
        />
      )}

      <CustomerInfoDialog
        open={showCustomerDialog}
        onClose={() => setShowCustomerDialog(false)} 
        onSubmit={handleCustomerInfoSubmit}
        restaurantColor={primaryColor}
        restaurantId={restaurant?.id}
        requireName={restaurant?.login_require_name ?? true}
        requirePhone={restaurant?.login_require_phone ?? false}
        requireBirthDate={restaurant?.login_require_birth_date ?? false}
      />

      <ProductDetailDrawer
        product={selectedProduct}
        extras={productExtras}
        open={showProductDialog}
        onClose={() => {
          setShowProductDialog(false);
          setSelectedProduct(null);
        }}
        onAddToCart={addToCart}
        restaurantName={restaurant.name}
        restaurantLogo={restaurant.logo_url}
        primaryColor={primaryColor}
        deliveryTime={`${restaurant.prep_time_minutes || 50}-${(restaurant.prep_time_minutes || 50) + 10} min`}
        deliveryFee={0}
      />

      <CartDrawer
        open={showCartDrawer}
        onClose={() => setShowCartDrawer(false)}
        items={cart}
        restaurantName={restaurant.name}
        restaurantLogo={restaurant.logo_url}
        primaryColor={primaryColor}
        onUpdateQuantity={updateQuantity}
        onClearCart={() => {
          setCart([]);
          toast.success("Comanda limpa");
        }}
        onAddMoreItems={() => setShowCartDrawer(false)}
        onContinue={() => {
          setShowCartDrawer(false);
          navigate(`/${restaurantSlug}/comanda/${tableNumber}`);
        }}
        mode="local"
        onAddItem={(item) => {
          setCart((prev) => [...prev, item]);
          toast.success(`${item.product.name} adicionado com desconto! 🎉`);
        }}
      />

      <ReviewModal
        open={reviewModalOpen}
        onClose={() => {
          setReviewModalOpen(false);
          setReviewOrderId(undefined);
          setReviewCounterOrderId(undefined);
          setReviewBillId(undefined);
          setBlockLoginForReview(false); // Liberar para mostrar login agora
          // ✅ Logout completo após fechar avaliação
          handleCompleteLogout();
        }}
        restaurantId={restaurant.id}
        restaurantName={restaurant.name}
        orderId={reviewOrderId}
        counterOrderId={reviewCounterOrderId}
        billId={reviewBillId}
      />
    </div>
  );
};

export default Menu;

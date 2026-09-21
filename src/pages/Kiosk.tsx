import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { resolveSlug } from "@/lib/slugResolver";
import { supabase } from "@/integrations/supabase/client";
import { Product, Category, CartItem, ProductExtra } from "@/types/menu";
import { toast } from "@/components/ui/sonner";
import { useKioskConfig } from "@/hooks/useKioskConfig";
import { KioskIdleScreen } from "@/components/kiosk/KioskIdleScreen";
import { KioskIdentification } from "@/components/kiosk/KioskIdentification";
import { KioskMenu } from "@/components/kiosk/KioskMenu";
import { KioskProductDetail } from "@/components/kiosk/KioskProductDetail";
import { KioskCart } from "@/components/kiosk/KioskCart";
import { KioskConsumptionType, ConsumptionMode } from "@/components/kiosk/KioskConsumptionType";
import { KioskPayment } from "@/components/kiosk/KioskPayment";
import { KioskConfirmation } from "@/components/kiosk/KioskConfirmation";
import { KioskDeliveryAddress } from "@/components/kiosk/KioskDeliveryAddress";
import { KioskPhoneCollection } from "@/components/kiosk/KioskPhoneCollection";
import { KioskLayout } from "@/components/kiosk/KioskLayout";
import { useInactiveStockItems } from "@/hooks/useInactiveStockItems";
import { useFacebookPixel } from "@/hooks/useFacebookPixel";
import { useDynamicFavicon } from "@/hooks/useDynamicFavicon";
import { isFeaturedVisible } from "@/lib/featuredUtils";

export type KioskStep = "idle" | "identification" | "menu" | "product" | "cart" | "consumption" | "phone_collection" | "delivery_address" | "payment" | "confirmation";

export interface KioskCustomer {
  name: string;
  cpf: string;
  phone?: string;
  isExisting: boolean;
}

export default function Kiosk() {
  const { slug: pathSlug } = useParams<{ slug: string }>();
  const slug = resolveSlug(pathSlug);
  const [step, setStep] = useState<KioskStep>("menu");
  const [restaurant, setRestaurant] = useState<any>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState<KioskCustomer | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productExtras, setProductExtras] = useState<ProductExtra[]>([]);
  const [consumptionMode, setConsumptionMode] = useState<ConsumptionMode>("counter");
  const [tableNumber, setTableNumber] = useState<string>("");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [kioskDisabled, setKioskDisabled] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState<string>("");
  const { data: inactiveData } = useInactiveStockItems(restaurant?.id || null);
  useFacebookPixel(restaurant?.facebook_pixel_id);
  useDynamicFavicon(restaurant?.logo_url, restaurant?.name);
  const disabledProductIds = inactiveData?.disabledProductIds || new Set<string>();
  const disabledExtraItemIds = inactiveData?.disabledExtraCategoryItemIds || new Set<string>();
  const disabledProductExtraIds = inactiveData?.disabledProductExtraIds || new Set<string>();
  const hiddenByRequiredChoices = inactiveData?.hiddenProductIdsByRequiredChoices || new Set<string>();
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Coupon & loyalty state
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [loyaltyPointsUsed, setLoyaltyPointsUsed] = useState(0);

  const { config: kioskConfig, pointTerminal, loading: configLoading } = useKioskConfig(restaurant?.id || null);
  const timeoutMs = (kioskConfig?.inactivity_timeout_seconds || 120) * 1000;

  const cartTotal = cart.reduce((sum, item) => {
    const extrasTotal = item.extras.reduce((s, e) => s + e.price, 0);
    const price = item.product.promotional_price ?? item.product.price;
    return sum + (price + extrasTotal) * item.quantity;
  }, 0);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const primaryColor = restaurant?.primary_color || "#184a2d";
  const loyaltyRealPerPoint = restaurant?.loyalty_real_per_point || 0.01;

  // Calculate coupon discount
  useEffect(() => {
    if (!appliedCoupon) { setCouponDiscount(0); return; }
    let discount = 0;
    if (appliedCoupon.discount_type === "percentage") {
      discount = cartTotal * (appliedCoupon.discount_value / 100);
      if (appliedCoupon.max_discount) discount = Math.min(discount, appliedCoupon.max_discount);
    } else {
      discount = appliedCoupon.discount_value;
    }
    setCouponDiscount(Math.min(discount, cartTotal));
  }, [appliedCoupon, cartTotal]);

  // Fetch loyalty points
  useEffect(() => {
    if (!customer?.cpf || !restaurant?.id || !restaurant?.loyalty_enabled) return;
    (supabase as any).rpc('get_loyalty_balance', { p_cpf: customer.cpf })
      .then(({ data }: { data: number | null }) => {
        setLoyaltyPoints(data || 0);
      });
  }, [customer?.cpf, restaurant?.id, restaurant?.loyalty_enabled]);

  const resetSession = useCallback(() => {
    setStep("menu");
    setCart([]);
    setCustomer(null);
    setSelectedProduct(null);
    setProductExtras([]);
    setConsumptionMode("counter");
    setTableNumber("");
    setOrderId(null);
    setAppliedCoupon(null);
    setCouponDiscount(0);
    setLoyaltyPoints(0);
    setLoyaltyPointsUsed(0);
    setDeliveryAddress("");
  }, []);

  // Inactivity timer
  const resetInactivityTimer = useCallback(() => {
    if (step === "confirmation") return;
    // No menu, só reseta se houver carrinho ou cliente identificado
    if (step === "menu" && cart.length === 0 && !customer) return;
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    inactivityTimer.current = setTimeout(() => {
      toast.info("Sessão encerrada por inatividade");
      resetSession();
    }, timeoutMs);
  }, [step, cart.length, customer, resetSession, timeoutMs]);

  useEffect(() => {
    const events = ["touchstart", "mousedown", "keydown", "scroll"];
    const handler = () => resetInactivityTimer();
    events.forEach(e => document.addEventListener(e, handler, { passive: true }));
    resetInactivityTimer();
    return () => {
      events.forEach(e => document.removeEventListener(e, handler));
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    };
  }, [resetInactivityTimer]);

  // Fetch restaurant + categories
  const fetchData = useCallback(async () => {
    if (!slug) {
      console.warn("[Kiosk] Slug ausente ou inválido — abortando bootstrap");
      setLoading(false);
      return;
    }
    try {
      const { data: r, error } = await supabase
        .from("restaurants")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      if (!r) {
        console.warn("[Kiosk] Nenhum restaurante encontrado para slug:", slug);
        toast.error("Restaurante não encontrado");
        setLoading(false);
        return;
      }
      setRestaurant(r);

      const { data: kConf } = await supabase
        .from("kiosk_config")
        .select("enabled")
        .eq("restaurant_id", r.id)
        .maybeSingle();

      if (kConf && !kConf.enabled) {
        setKioskDisabled(true);
        setLoading(false);
        return;
      }

      const [catsResult, featuredResult] = await Promise.all([
        supabase
          .from("categories")
          .select("*, products(*)")
          .eq("restaurant_id", r.id)
          .order("display_order"),
        supabase
          .from("products")
          .select("id, name, description, price, promotional_price, available, image_url, prep_time_minutes, is_featured, featured_display_order, featured_active, featured_schedule, visibility_channels")
          .eq("restaurant_id", r.id)
          .eq("is_featured", true)
          .order("featured_display_order"),
      ]);

      if (catsResult.error) console.error("[Kiosk] Erro ao carregar categorias:", catsResult.error);

      const filtered = (catsResult.data || [])
        .filter((cat: any) => cat.is_active !== false)
        .map((cat: any) => ({
        ...cat,
        products: (cat.products || []).filter((p: any) => {
          if (!p.available) return false;
          if (p.is_featured) return false;
          const channels = p.visibility_channels || ['all'];
          return channels.includes('all') || channels.includes('totem');
        }),
      })).filter((cat: any) => cat.products.length > 0);
      setCategories(filtered);

      const filteredFeatured = (featuredResult.data || []).filter((p: any) => {
        if (!isFeaturedVisible(p)) return false;
        const channels = p.visibility_channels || ['all'];
        return channels.includes('all') || channels.includes('totem');
      });
      setFeaturedProducts(filteredFeatured as Product[]);
    } catch (err) {
      console.error("[Kiosk] Erro crítico no bootstrap:", err);
      toast.error("Erro ao carregar dados do restaurante");
    } finally {
      setLoading(false);
    }
  }, [slug, pathSlug]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Track is_open + products/categories in realtime
  const isOpen = restaurant?.is_open !== false;
  useEffect(() => {
    if (!restaurant?.id) return;
    const channel = supabase
      .channel(`kiosk-realtime-${restaurant.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'restaurants',
        filter: `id=eq.${restaurant.id}`,
      }, (payload) => {
        setRestaurant((prev: any) => prev ? { ...prev, ...payload.new } : prev);
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'products',
      }, () => {
        fetchData();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'categories',
      }, () => {
        fetchData();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [restaurant?.id, fetchData]);

  const openProduct = useCallback(async (product: Product) => {
    setSelectedProduct(product);
    try {
      const { data: extrasRaw, error } = await supabase
        .from("product_extras")
        .select("id, name, description, price, is_required, min_selection, max_selection, extra_category_id, extra_categories(name, is_active)")
        .eq("product_id", product.id)
        .neq("is_active", false);
      if (error) console.error("[Kiosk] Erro ao carregar extras:", error);

      const extrasData = (extrasRaw || [])
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
            isComplementItem: true,
          }));
        });

      setProductExtras([...(extrasData || []), ...complementExtras]
        .filter((e: any) => !disabledExtraItemIds.has(e.id) && !disabledProductExtraIds.has(e.id)));
    } catch (err) {
      console.error("[Kiosk] Exceção ao carregar extras:", err);
      setProductExtras([]);
    }
    setStep("product");
  }, []);

  const addToCart = useCallback((product: Product, extras: ProductExtra[], notes?: string, quantity?: number) => {
    const newItem: CartItem = {
      id: `kiosk-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      product,
      quantity: quantity || 1,
      extras: extras.map(e => ({ id: e.id, name: e.name, price: e.price, isComplementItem: !!(e as any).isComplementItem || !!(e as any).is_complement })),
      notes,
    };
    setCart(prev => [...prev, newItem]);
    setStep("menu");
    toast.success(`${product.name} adicionado!`);
  }, []);

  const updateQuantity = useCallback((itemId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const newQty = item.quantity + delta;
      return newQty <= 0 ? null : { ...item, quantity: newQty };
    }).filter(Boolean) as CartItem[]);
  }, []);

  const removeItem = useCallback((itemId: string) => {
    setCart(prev => prev.filter(i => i.id !== itemId));
  }, []);

  // Acionado quando o usuário clica "Continuar" no carrinho.
  // Se já está identificado, segue direto. Se CPF não é exigido, cria cliente anônimo.
  // Caso contrário, abre tela de identificação.
  const handleCartContinue = () => {
    if (customer) {
      setStep("consumption");
      return;
    }
    if (kioskConfig?.require_cpf === false) {
      setCustomer({ name: "Cliente", cpf: "", isExisting: false });
      setStep("consumption");
    } else {
      setStep("identification");
    }
  };

  // After consumption type selection, route to address step if delivery, else payment
  const handleConsumptionNext = async () => {
    if (consumptionMode === "delivery") {
      setStep("delivery_address");
    } else if (consumptionMode === "counter" && customer?.cpf) {
      // Check if customer has phone for WhatsApp notification
      const { data: custData } = await (supabase as any).rpc('get_customer_by_cpf', { p_cpf: customer.cpf });
      const cust = Array.isArray(custData) ? custData[0] : custData;
      const hasPhone = !!cust?.phone?.trim();
      if (hasPhone) {
        setCustomer(prev => prev ? { ...prev, phone: cust!.phone! } : prev);
        setStep("payment");
      } else {
        setStep("phone_collection");
      }
    } else {
      setStep("payment");
    }
  };

  if (loading || configLoading) {
    return (
      <KioskLayout primaryColor={primaryColor}>
        <div className="flex items-center justify-center h-screen">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-t-transparent" style={{ borderColor: primaryColor, borderTopColor: "transparent" }} />
        </div>
      </KioskLayout>
    );
  }

  if (!restaurant) {
    const isSlugMissing = !slug;
    return (
      <KioskLayout primaryColor={primaryColor}>
        <div className="flex flex-col items-center justify-center h-screen gap-4 px-8 text-center">
          <p className="text-6xl">{isSlugMissing ? "⚠️" : "🔍"}</p>
          <h2 className="text-2xl font-bold text-foreground">
            {isSlugMissing ? "Link do totem inválido" : "Restaurante não encontrado"}
          </h2>
          <p className="text-lg text-muted-foreground">
            {isSlugMissing ? "O endereço acessado não contém a identificação do restaurante." : "Verifique o endereço e tente novamente."}
          </p>
        </div>
      </KioskLayout>
    );
  }

  if (kioskDisabled) {
    return (
      <KioskLayout primaryColor={primaryColor}>
        <div className="flex flex-col items-center justify-center h-screen gap-4 px-8 text-center">
          <p className="text-6xl">🚫</p>
          <h2 className="text-2xl font-bold text-foreground">Totem indisponível no momento</h2>
          <p className="text-lg text-muted-foreground">O autoatendimento deste estabelecimento está desativado.</p>
        </div>
      </KioskLayout>
    );
  }

  return (
    <KioskLayout primaryColor={primaryColor}>
      {step === "identification" && (
        <KioskIdentification
          restaurant={restaurant}
          onIdentified={(c) => { setCustomer(c); setStep("consumption"); }}
          onBack={() => setStep("cart")}
        />
      )}

      {step === "menu" && (
         <KioskMenu
           categories={categories.map(cat => ({
              ...cat,
              products: cat.products.filter(p => !disabledProductIds.has(p.id) && !hiddenByRequiredChoices.has(p.id))
            })).filter(cat => cat.products.length > 0)}
          featuredProducts={featuredProducts.filter(p => !disabledProductIds.has(p.id) && !hiddenByRequiredChoices.has(p.id))}
          primaryColor={primaryColor}
          onSelectProduct={openProduct}
          cartCount={cartCount}
          cartTotal={cartTotal}
          onOpenCart={() => setStep("cart")}
          customerName={customer?.name || ""}
          onCancel={resetSession}
          restaurant={restaurant}
        />
      )}

      {step === "product" && selectedProduct && (
        <KioskProductDetail
          product={selectedProduct}
          extras={productExtras}
          primaryColor={primaryColor}
          onAdd={addToCart}
          onBack={() => setStep("menu")}
        />
      )}

      {step === "cart" && (
        <KioskCart
          cart={cart}
          primaryColor={primaryColor}
          onUpdateQuantity={updateQuantity}
          onRemove={removeItem}
          cartTotal={cartTotal}
          onBack={() => setStep("menu")}
          onNext={handleCartContinue}
          customerCpf={customer?.cpf}
          restaurantId={restaurant.id}
          appliedCoupon={appliedCoupon}
          onApplyCoupon={setAppliedCoupon}
          couponDiscount={couponDiscount}
          loyaltyPoints={loyaltyPoints}
          loyaltyPointsUsed={loyaltyPointsUsed}
          loyaltyRealPerPoint={loyaltyRealPerPoint}
          onRedeemPoints={setLoyaltyPointsUsed}
          isOpen={isOpen}
        />
      )}

      {step === "consumption" && (
        <KioskConsumptionType
          primaryColor={primaryColor}
          consumptionMode={consumptionMode}
          tableNumber={tableNumber}
          onChangeMode={setConsumptionMode}
          onChangeTable={setTableNumber}
          onBack={() => setStep("cart")}
          onNext={handleConsumptionNext}
          kioskConfig={kioskConfig}
        />
      )}

      {step === "delivery_address" && (
        <KioskDeliveryAddress
          primaryColor={primaryColor}
          customerCpf={customer?.cpf || ""}
          customerName={customer?.name || ""}
          customerPhone={customer?.phone || ""}
          onBack={() => setStep("consumption")}
          onSelectAddress={(addr) => {
            setDeliveryAddress(addr);
            setStep("payment");
          }}
        />
      )}

      {step === "phone_collection" && customer?.cpf && (
        <KioskPhoneCollection
          primaryColor={primaryColor}
          customerCpf={customer.cpf}
          restaurantId={restaurant.id}
          onPhoneSaved={(savedPhone) => {
            setCustomer(prev => prev ? { ...prev, phone: savedPhone } : prev);
            setStep("payment");
          }}
          onBack={() => setStep("consumption")}
        />
      )}

      {step === "payment" && (
        <KioskPayment
          cart={cart}
          restaurant={restaurant}
          customer={customer!}
          consumptionMode={consumptionMode}
          tableNumber={tableNumber}
          primaryColor={primaryColor}
          cartTotal={cartTotal}
          onBack={() => consumptionMode === "delivery" ? setStep("delivery_address") : setStep("consumption")}
          onOrderCreated={(id) => { setOrderId(id); setStep("confirmation"); }}
          kioskConfig={kioskConfig}
          pointTerminal={pointTerminal}
          appliedCoupon={appliedCoupon}
          couponDiscount={couponDiscount}
          loyaltyPointsUsed={loyaltyPointsUsed}
          loyaltyRealPerPoint={loyaltyRealPerPoint}
          deliveryAddress={deliveryAddress}
        />
      )}

      {step === "confirmation" && (
        <KioskConfirmation
          orderId={orderId}
          primaryColor={primaryColor}
          onNewOrder={resetSession}
        />
      )}
    </KioskLayout>
  );
}

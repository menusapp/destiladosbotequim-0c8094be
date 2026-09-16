import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { resolveSlug } from "@/lib/slugResolver";
import { supabase } from "@/integrations/supabase/client";
import { MenuHeader } from "@/components/menu/MenuHeader";
import { RestaurantInfoCard } from "@/components/menu/RestaurantInfoCard";
import { FeaturedProducts } from "@/components/menu/FeaturedProducts";
import { CategoryProducts } from "@/components/menu/CategoryProducts";
import { CategoryNav } from "@/components/menu/CategoryNav";
import { CartBottomBar } from "@/components/menu/CartBottomBar";
import { ProductDetailDrawer } from "@/components/menu/ProductDetailDrawer";
import { CheckoutDrawer } from "@/components/menu/CheckoutDrawer";
import CustomerInfoDialog from "@/components/menu/CustomerInfoDialog";
import { Clock } from "lucide-react";
import { DeliveryBottomNav } from "@/components/menu/DeliveryBottomNav";
import { PedidosHistory } from "@/components/menu/PedidosHistory";
import { ProfileView } from "@/components/menu/ProfileView";
import { ReservationsView } from "@/components/menu/ReservationsView";
import { Product, Category, CartItem, ProductExtra } from "@/types/menu";
import { toast } from "@/components/ui/sonner";
import { useSessionTracking } from "@/hooks/useSessionTracking";
import { isFeaturedVisible } from "@/lib/featuredUtils";
import { useInactiveStockItems } from "@/hooks/useInactiveStockItems";
import { useFacebookPixel } from "@/hooks/useFacebookPixel";
import { useDynamicFavicon } from "@/hooks/useDynamicFavicon";
import { normalizeSearch } from "@/lib/searchNormalize";

import { novoId } from "@/lib/uuid";
export default function DeliveryMenu() {
  const { slug: pathSlug } = useParams<{ slug: string }>();
  const restaurantSlug = resolveSlug(pathSlug);
  const [restaurant, setRestaurant] = useState<any>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productExtras, setProductExtras] = useState<ProductExtra[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [customerName, setCustomerName] = useState("");
  const [customerCPF, setCustomerCPF] = useState("");
  const [showCustomerDialog, setShowCustomerDialog] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"menu" | "pedidos" | "reservas" | "perfil">("menu");
  const [pendingTab, setPendingTab] = useState<"pedidos" | "reservas" | "perfil" | null>(null);
  const { trackCartUpdate, trackCheckoutStarted, trackCheckoutStep, trackCompleted, trackCustomerInfo, trackCoupon, trackAddress } = useSessionTracking(restaurant?.id, restaurantSlug);
  const { data: inactiveData } = useInactiveStockItems(restaurant?.id || null);
  useFacebookPixel(restaurant?.facebook_pixel_id);
  useDynamicFavicon(restaurant?.logo_url, restaurant?.name);
  const disabledProductIds = inactiveData?.disabledProductIds || new Set<string>();
  const disabledExtraItemIds = inactiveData?.disabledExtraCategoryItemIds || new Set<string>();
  const disabledProductExtraIds = inactiveData?.disabledProductExtraIds || new Set<string>();
  const hiddenByRequiredChoices = inactiveData?.hiddenProductIdsByRequiredChoices || new Set<string>();

  const fetchRestaurantData = useCallback(async () => {
    try {
      const { data: restaurantData, error: restaurantError } = await supabase
        .from("restaurants")
        .select("*")
        .eq("slug", restaurantSlug)
        .single();

      if (restaurantError) throw restaurantError;
      setRestaurant(restaurantData);

      // Fetch categories+products and featured products in parallel
      const [categoriesResult, featuredResult] = await Promise.all([
        supabase
          .from("categories")
          .select("*, products(*)")
          .eq("restaurant_id", restaurantData.id)
          .order("display_order"),
        supabase
          .from("products")
          .select("id, name, description, price, promotional_price, available, image_url, prep_time_minutes, is_featured, featured_display_order, featured_active, featured_schedule, visibility_channels")
          .eq("restaurant_id", restaurantData.id)
          .eq("is_featured", true)
          .order("featured_display_order"),
      ]);

      if (categoriesResult.error) throw categoriesResult.error;
      const categoriesData = categoriesResult.data;
      
      // Filtrar produtos em destaque para não aparecerem duplicados nas categorias
      const filteredCategories = (categoriesData || [])
        .filter((cat: any) => cat.is_active !== false)
        .map((cat: any) => ({
        ...cat,
        products: (cat.products || []).filter((p: any) => {
          if (!p.available) return false;
          if (p.is_featured) return false;
          const channels = p.visibility_channels || ['all'];
          return channels.includes('all') || channels.includes('delivery');
        })
      })).filter((cat: any) => cat.products.length > 0);
      setCategories(filteredCategories);

      const featuredData = featuredResult.data;

      const filteredFeatured = (featuredData || []).filter((p: any) => {
        if (!isFeaturedVisible(p)) return false;
        const channels = p.visibility_channels || ['all'];
        return channels.includes('all') || channels.includes('delivery');
      });
      setFeaturedProducts(filteredFeatured);
    } catch (error) {
      console.error("Error fetching restaurant:", error);
      toast.error("Erro ao carregar cardápio");
    } finally {
      setLoading(false);
    }
  }, [restaurantSlug]);

  const loadCustomerInfo = useCallback(() => {
    const expiry = localStorage.getItem(`delivery-expiry-${restaurantSlug}`);
    const isExpired = expiry && Date.now() > Number(expiry);

    if (isExpired) {
      localStorage.removeItem(`delivery-customer-${restaurantSlug}`);
      localStorage.removeItem(`delivery-cpf-${restaurantSlug}`);
      localStorage.removeItem(`delivery-phone-${restaurantSlug}`);
      localStorage.removeItem(`delivery-expiry-${restaurantSlug}`);
    }

    const storedName = localStorage.getItem(`delivery-customer-${restaurantSlug}`);
    const storedCPF = localStorage.getItem(`delivery-cpf-${restaurantSlug}`);
    if (storedName && storedCPF && !isExpired) {
      setCustomerName(storedName);
      setCustomerCPF(storedCPF);
    }
  }, [restaurantSlug]);

  const loadCartFromStorage = useCallback(() => {
    const stored = localStorage.getItem(`delivery-cart-${restaurantSlug}`);
    if (stored) {
      setCart(JSON.parse(stored));
    }
  }, [restaurantSlug]);

  useEffect(() => {
    if (restaurantSlug) {
      fetchRestaurantData();
      loadCartFromStorage();
      loadCustomerInfo();
    }
  }, [restaurantSlug, fetchRestaurantData, loadCartFromStorage, loadCustomerInfo]);

  useEffect(() => {
    saveCartToStorage();
    if (cart.length > 0) trackCartUpdate(cart);
  }, [cart]);

  // Realtime subscription para mudanças no restaurante e produtos
  useEffect(() => {
    if (!restaurantSlug) return;

    const channel = supabase
      .channel('delivery-menu-realtime')
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'restaurants',
        filter: `slug=eq.${restaurantSlug}`
      }, (payload) => {
        const updatedRestaurant = payload.new as any;
        
        setRestaurant((prev: any) => ({
          ...prev,
          ...updatedRestaurant
        }));
        
        // Silenciado para cliente
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'products'
      }, () => {
        fetchRestaurantData();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'categories'
      }, () => {
        fetchRestaurantData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurantSlug, fetchRestaurantData]);

  // Realtime subscription para pedidos do cliente logado
  useEffect(() => {
    if (!customerCPF || !restaurant?.id) return;

    const ordersChannel = supabase
      .channel(`delivery-orders-${customerCPF}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `customer_cpf=eq.${customerCPF},restaurant_id=eq.${restaurant.id}`
      }, (payload) => {
        
        const order = payload.new as any;
        // Silenciado - notificações de status removidas do cardápio do cliente
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ordersChannel);
    };
  }, [customerCPF, restaurant?.id]);

  const handleCustomerInfoSubmit = async (name: string, cpf: string, phone?: string) => {
    const sanitizedCPF = cpf.replace(/\D/g, "");
    
    // Check if customer exists in database (use saved name, ignore typed name)
    if (sanitizedCPF.length === 11 && restaurant?.id) {
      const { data: existingCustomerData } = await (supabase as any).rpc('get_customer_by_cpf', { p_cpf: sanitizedCPF });
      const existingCustomer = Array.isArray(existingCustomerData) ? existingCustomerData[0] : existingCustomerData;
      
      const finalName = existingCustomer ? existingCustomer.name : name;
      const finalPhone = existingCustomer?.phone || phone;
      
      // Update phone if new one provided and customer exists
      if (existingCustomer && phone && !existingCustomer.phone) {
        await (supabase as any).rpc("set_customer_phone_if_empty", {
          p_restaurant_id: restaurant.id,
          p_cpf: sanitizedCPF,
          p_phone: phone,
        });
      }
      
      setCustomerName(finalName);
      setCustomerCPF(sanitizedCPF);
      localStorage.setItem(`delivery-customer-${restaurantSlug}`, finalName);
      localStorage.setItem(`delivery-cpf-${restaurantSlug}`, sanitizedCPF);
      if (finalPhone) localStorage.setItem(`delivery-phone-${restaurantSlug}`, finalPhone);
      localStorage.setItem(`delivery-expiry-${restaurantSlug}`, String(Date.now() + 60 * 60 * 1000));
      trackCustomerInfo(finalPhone || undefined, finalName);
    } else {
      setCustomerName(name);
      setCustomerCPF(sanitizedCPF);
      localStorage.setItem(`delivery-customer-${restaurantSlug}`, name);
      localStorage.setItem(`delivery-cpf-${restaurantSlug}`, sanitizedCPF);
      if (phone) localStorage.setItem(`delivery-phone-${restaurantSlug}`, phone);
      localStorage.setItem(`delivery-expiry-${restaurantSlug}`, String(Date.now() + 60 * 60 * 1000));
      trackCustomerInfo(phone || undefined, name);
    }
    
    setShowCustomerDialog(false);

    // Navigate to pending tab if any
    if (pendingTab) {
      setActiveTab(pendingTab);
      setPendingTab(null);
    }
  };

  const handleNameUpdate = (name: string) => {
    setCustomerName(name);
    localStorage.setItem(`delivery-customer-${restaurantSlug}`, name);
  };

  const handlePhoneUpdate = (phone: string) => {
    if (phone) localStorage.setItem(`delivery-phone-${restaurantSlug}`, phone);
  };

  const saveCartToStorage = () => {
    localStorage.setItem(`delivery-cart-${restaurantSlug}`, JSON.stringify(cart));
  };

  const handleProductClick = async (product: Product) => {
    // Buscar extras diretos do produto
    const { data: extrasData } = await supabase
      .from("product_extras")
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
    setProductExtras(allExtras);
    setSelectedProduct(product);
  };

  const handleAddToCart = (product: Product, selectedExtras: ProductExtra[], notes?: string, quantity?: number) => {
    const newItem: CartItem = {
      id: novoId(),
      product,
      quantity: quantity || 1,
      extras: selectedExtras,
      notes: notes || "",
    };

    setCart([...cart, newItem]);
    setSelectedProduct(null);
  };

  const handleUpdateQuantity = (itemId: string, delta: number) => {
    setCart((prevCart) => {
      const updatedCart = prevCart
        .map((item) => {
          if (item.id === itemId) {
            const newQuantity = item.quantity + delta;
            return newQuantity > 0 ? { ...item, quantity: newQuantity } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[];
      return updatedCart;
    });
  };

  const handleClearCart = () => {
    setCart([]);
    trackCompleted();
  };

  const handleBulkAddToCart = (items: CartItem[]) => {
    setCart(prevCart => [...prevCart, ...items]);
    setActiveTab("menu");
    setCheckoutOpen(true);
  };

  const calculateTotal = () => {
    return cart.reduce((sum, item) => {
      const extrasTotal = item.extras.reduce((s, e) => s + e.price, 0);
      const effectivePrice = item.product.promotional_price ?? item.product.price;
      return sum + (effectivePrice + extrasTotal) * item.quantity;
    }, 0);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!restaurant) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Restaurante não encontrado</h1>
          <p className="text-muted-foreground">Verifique o link e tente novamente</p>
        </div>
      </div>
    );
  }


  const primaryColor = restaurant.primary_color || "#fe9516";

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

  return (
    <div className="min-h-screen bg-background pb-14">
      {activeTab === "menu" && (
        <>
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
              tableInfo={customerName}
              deliveryTime={`${restaurant.prep_time_minutes || 50}-${(restaurant.prep_time_minutes || 50) + 10} min`}
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

              {restaurant.featured_section_enabled && activeFeatured.length > 0 && (
                <FeaturedProducts
                  products={activeFeatured}
                  primaryColor={primaryColor}
                  onProductClick={handleProductClick}
                  title={restaurant.featured_section_title || "Destaques"}
                />
              )}

              <CategoryProducts
                categories={filteredCategories}
                primaryColor={primaryColor}
                onProductClick={handleProductClick}
                showNav={false}
              />
            </>
          )}

          {cart.length > 0 && (
            <CartBottomBar
              itemCount={cart.length}
              total={calculateTotal()}
              primaryColor={primaryColor}
              onViewCart={() => { setCheckoutOpen(true); trackCheckoutStarted(); }}
              label="Ver Sacola"
            />
          )}

          {selectedProduct && (
            <ProductDetailDrawer
              product={selectedProduct}
              extras={productExtras}
              open={!!selectedProduct}
              onClose={() => {
                setSelectedProduct(null);
                setProductExtras([]);
              }}
              onAddToCart={handleAddToCart}
              primaryColor={primaryColor}
              restaurantName={restaurant.name}
              restaurantLogo={restaurant.logo_url}
              deliveryTime={`${restaurant.prep_time_minutes || 50}-${(restaurant.prep_time_minutes || 50) + 10} min`}
            />
          )}

          <CheckoutDrawer
            open={checkoutOpen}
            onClose={() => setCheckoutOpen(false)}
            cart={cart}
            restaurant={restaurant}
            onUpdateQuantity={handleUpdateQuantity}
            onClearCart={handleClearCart}
            mode="delivery"
            restaurantSlug={restaurantSlug}
            onAddRewardItem={(item) => setCart(prev => [...prev, item])}
            customerCPF={customerCPF}
            onCheckoutStep={trackCheckoutStep}
            onCouponApplied={trackCoupon}
            onAddressSelected={trackAddress}
            onSuggestionClick={(product) => {
              setCheckoutOpen(false);
              handleProductClick(product);
            }}
            onRequireLogin={() => {
              setCheckoutOpen(false);
              setShowCustomerDialog(true);
            }}
          />

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
        </>
      )}

      {activeTab === "pedidos" && customerCPF && (
        <div className="pt-4">
          <h1 className="text-2xl font-bold px-4 mb-4">Meus Pedidos</h1>
          <PedidosHistory
            customerCPF={customerCPF}
            restaurantId={restaurant.id}
            restaurantSlug={restaurantSlug || ""}
            onAddToCart={handleBulkAddToCart}
          />
        </div>
      )}

      {activeTab === "reservas" && customerCPF && restaurant.reservations_enabled && (
        <div className="pt-4">
          <h1 className="text-2xl font-bold px-4 mb-4">Reservas</h1>
          <ReservationsView
            restaurant={restaurant}
            customerCPF={customerCPF}
            customerName={customerName}
            customerPhone={localStorage.getItem(`delivery-phone-${restaurantSlug}`) || ""}
            primaryColor={primaryColor}
          />
        </div>
      )}

      {activeTab === "perfil" && customerCPF && (
        <div className="pt-4">
          <h1 className="text-2xl font-bold px-4 mb-4">Meu Perfil</h1>
          <ProfileView
            customerName={customerName}
            customerCPF={customerCPF}
            restaurantId={restaurant.id}
            onNameUpdate={handleNameUpdate}
            onPhoneUpdate={handlePhoneUpdate}
            onLogout={() => {
              localStorage.removeItem(`delivery-customer-${restaurantSlug}`);
              localStorage.removeItem(`delivery-cpf-${restaurantSlug}`);
              localStorage.removeItem(`delivery-phone-${restaurantSlug}`);
              localStorage.removeItem(`delivery-expiry-${restaurantSlug}`);
              localStorage.removeItem(`delivery-cart-${restaurantSlug}`);
              setCustomerName("");
              setCustomerCPF("");
              setCart([]);
              setActiveTab("menu");
              setShowCustomerDialog(true);
            }}
          />
        </div>
      )}

      <DeliveryBottomNav
        activeTab={activeTab}
        onTabChange={(tab) => {
          if ((tab === "pedidos" || tab === "perfil" || tab === "reservas") && !customerCPF) {
            setPendingTab(tab as "pedidos" | "perfil" | "reservas");
            setShowCustomerDialog(true);
            return;
          }
          setActiveTab(tab);
        }}
        primaryColor={primaryColor}
        showReservations={!!restaurant.reservations_enabled}
      />
    </div>
  );
}

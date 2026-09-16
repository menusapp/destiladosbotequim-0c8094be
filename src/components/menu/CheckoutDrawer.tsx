import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Progress } from "@/components/ui/progress";
import { CartStep } from "./checkout/CartStep";
import { AddressStep } from "./checkout/AddressStep";
import { PaymentStep } from "./checkout/PaymentStep";
import { SummaryStep } from "./checkout/SummaryStep";
import { OnlinePaymentStep } from "./checkout/OnlinePaymentStep";
import { DeliveryTypeStep } from "./checkout/DeliveryTypeStep";
import { CartItem } from "@/types/menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import { DiscountReward } from "./checkout/LoyaltyRewardNotification";

import { novoId } from "@/lib/uuid";
type CheckoutStep = "cart" | "delivery-type" | "address" | "payment" | "online-payment" | "summary";

interface DeliveryZone {
  id: string;
  zone_name: string;
  delivery_fee: number;
  min_order_value: number;
  estimated_time_minutes: number;
}

interface ProductExtra {
  id: string;
  name: string;
  price: number;
}

interface Reward {
  id: string;
  trigger_value: number;
  reward_type: string;
  reward_value: number | null;
  reward_product_id: string | null;
  reward_extra_id: string | null;
  description: string | null;
  product?: {
    id: string;
    name: string;
    image_url: string | null;
    price: number;
  };
  extra?: ProductExtra;
}

interface CheckoutDrawerProps {
  open: boolean;
  onClose: () => void;
  cart: CartItem[];
  restaurant: any;
  onUpdateQuantity: (itemId: string, delta: number) => void;
  onClearCart: () => void;
  mode: "delivery" | "local";
  restaurantSlug?: string;
  onAddRewardItem?: (item: CartItem) => void;
  customerCPF?: string;
  onSuggestionClick?: (product: any) => void;
  onRequireLogin?: () => void;
  onCheckoutStep?: (stepId: string) => void;
  /** Rastreio do funil: cupom aplicado/removido no checkout. */
  onCouponApplied?: (code: string | null) => void;
  /** Rastreio do funil: endereço informado + tipo de entrega. */
  onAddressSelected?: (address: string | null, deliveryType?: string) => void;
}

const primaryColorFromRestaurant = (restaurant: any) => restaurant?.primary_color || "#fe9516";

export const CheckoutDrawer = ({
  open,
  onClose,
  cart,
  restaurant,
  onUpdateQuantity,
  onClearCart,
  mode,
  restaurantSlug,
  onAddRewardItem,
  customerCPF: customerCPFProp,
  onSuggestionClick,
  onRequireLogin,
  onCheckoutStep,
  onCouponApplied,
  onAddressSelected,
}: CheckoutDrawerProps) => {
  const navigate = useNavigate();
  const [step, setStep] = useState<CheckoutStep>("cart");

  // Rastreia a etapa atual do checkout (funil de abandono).
  useEffect(() => {
    if (open && onCheckoutStep) onCheckoutStep(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, open]);
  const [deliveryType, setDeliveryType] = useState<"delivery" | "pickup">("delivery");
  const [coupon, setCoupon] = useState<any>(null);
  const [customerData, setCustomerData] = useState<any>(null);
  const [addressData, setAddressData] = useState<any>(null);
  const [paymentData, setPaymentData] = useState<any>(null);
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [loyaltyPointsUsed, setLoyaltyPointsUsed] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [deliveryZone, setDeliveryZone] = useState<DeliveryZone | null>(null);
  const [activeRewardDiscount, setActiveRewardDiscount] = useState<DiscountReward | null>(null);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  // Stores the order id pre-created BEFORE an online payment (PIX) so that the
  // order persists in the panel even if the user closes the browser tab after
  // paying. The webhook will mark it as paid; if they never pay it stays pending.
  const pendingOnlineOrderIdRef = useRef<string | null>(null);
  const creatingPendingOrderRef = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    if (open) {
      setStep("cart");
      pendingOnlineOrderIdRef.current = null;
      creatingPendingOrderRef.current = null;
    }
  }, [open]);

  const getProgressValue = () => {
    const steps: Record<CheckoutStep, number> = { 
      cart: 16, "delivery-type": 32, address: 48, payment: 64, "online-payment": 80, summary: 100 
    };
    return steps[step];
  };

  // Calcular subtotal (reward items and coupon free items don't count - they're free)
  const subtotal = cart.reduce((sum, item) => {
    if (item.isRewardItem || item.isCouponFreeItem) return sum;
    const extrasTotal = item.extras.reduce((s, e) => s + e.price, 0);
    const effectivePrice = item.product.promotional_price ?? item.product.price;
    return sum + (effectivePrice + extrasTotal) * item.quantity;
  }, 0);

  // Usar taxa de entrega da zona encontrada ou do restaurante como fallback
  const getDeliveryFee = () => {
    if (deliveryType === "pickup") return 0;
    // If free delivery reward is active, return 0
    if (activeRewardDiscount?.type === "free_delivery") return 0;
    if (deliveryZone) return deliveryZone.delivery_fee || 0;
    return restaurant.delivery_fee || 0;
  };

  // Verificar pedido mínimo
  const getMinOrderValue = () => {
    if (deliveryType === "pickup") return 0;
    if (deliveryZone) return deliveryZone.min_order_value || 0;
    return restaurant.min_order_value || 0;
  };

  // Calculate reward discount
  const calculateRewardDiscount = (subtotal: number): number => {
    if (!activeRewardDiscount) return 0;
    
    switch (activeRewardDiscount.type) {
      case "discount_percentage":
        return subtotal * (activeRewardDiscount.value / 100);
      case "discount_fixed":
        return Math.min(activeRewardDiscount.value, subtotal);
      case "free_delivery":
        return 0; // Handled in getDeliveryFee
      default:
        return 0;
    }
  };

  const handleFinishOrder = async (
    onlinePaymentId?: string,
    options?: { asPending?: boolean; existingOrderId?: string }
  ): Promise<string | null> => {
    const asPending = !!options?.asPending;
    const existingOrderId = options?.existingOrderId;

    if (submitting && !asPending) return null;

    if (!asPending) setSubmitting(true);
    try {
      const couponDiscount = Math.round((coupon ? calculateCouponDiscount(subtotal, coupon) : 0) * 100) / 100;
      const loyaltyDiscount = Math.round((loyaltyPointsUsed * (restaurant.loyalty_real_per_point || 0.01)) * 100) / 100;
      const rewardDiscount = Math.round(calculateRewardDiscount(subtotal) * 100) / 100;
      const deliveryFee = Math.round(getDeliveryFee() * 100) / 100;
      const serviceFee = Math.round((restaurant.service_fee_enabled 
        ? (subtotal * restaurant.service_fee_percentage / 100) 
        : 0) * 100) / 100;

      // PRIORIDADE: Buscar telefone do cadastro do cliente (fonte da verdade para WhatsApp)
      let phoneToUse = customerData.phone;
      const { data: customerRecordRows } = await (supabase as any).rpc("get_customer_by_cpf", {
        p_cpf: customerData.cpf,
      });
      const customerRecord = Array.isArray(customerRecordRows) ? customerRecordRows[0] : customerRecordRows;
      
      if (customerRecord?.phone) {
        phoneToUse = customerRecord.phone;
      } else {
      }

      const orderData: any = {
        table_id: null,
        restaurant_id: restaurant.id,
        customer_name: customerData.name,
        customer_cpf: customerData.cpf,
        order_type: "delivery",
        delivery_type: deliveryType,
        delivery_address: deliveryType === "delivery" ? formatAddress(addressData?.address) : null,
        delivery_phone: phoneToUse,
        delivery_neighborhood: deliveryType === "delivery" ? addressData?.address?.neighborhood : null,
        delivery_city: deliveryType === "delivery" ? addressData?.address?.city : null,
        payment_type: asPending
          ? "online"
          : (paymentData?.method || (onlinePaymentId ? "online" : "pending")),
        payment_brand: paymentData?.payment_brand || null,
        coupon_code: coupon?.code,
        coupon_discount: couponDiscount,
        delivery_fee: deliveryFee,
        loyalty_points_used: loyaltyPointsUsed,
        loyalty_points_earned: Math.floor(subtotal * (restaurant.loyalty_points_per_real || 1)),
        status: "pending",
        payment_status: asPending
          ? "pending"
          : (onlinePaymentId ? "paid" : "pending"),
        notes: paymentData?.changeFor ? `Troco para: R$ ${paymentData.changeFor}` : null,
        online_payment_id: asPending ? null : (onlinePaymentId || paymentData?.onlinePaymentId || null),
        reward_discount: rewardDiscount,
        reward_id: activeRewardDiscount?.id || null,
        dd_scheduled_for: scheduledFor ? new Date(`${scheduledFor}`).toISOString() : null,
      };

      let order: any;

      if (existingOrderId) {
        // Finaliza pedido pré-criado de pagamento online via RPC segura
        // (o fluxo anônimo não tem permissão de UPDATE direto em `orders`).
        const { error: updateError } = await (supabase as any).rpc("finalize_order_payment", {
          p_order_id: existingOrderId,
          p_payment_type: orderData.payment_type ?? null,
          p_payment_status: orderData.payment_status ?? null,
          p_online_payment_id: orderData.online_payment_id ?? null,
        });
        if (updateError) {
          console.error("Erro ao finalizar pedido online:", updateError);
          throw updateError;
        }
        order = { id: existingOrderId, ...orderData };
      } else {
        // Geramos o id no cliente (UUID) para não depender de `.select()` de
        // retorno — que o RLS bloqueia para o cliente anônimo. O INSERT
        // anônimo escopado continua permitido.
        const orderId = novoId();
        const { error: orderError } = await supabase
          .from("orders")
          .insert({ id: orderId, ...orderData });

        if (orderError) {
          console.error("Erro ao criar pedido:", orderError);
          throw orderError;
        }
        order = { id: orderId, ...orderData };
      }

      // Insert order items (skip when finalizing an existing order — items already exist)
      if (!existingOrderId) {
        for (const item of cart) {
          // For reward items or coupon free items, price_at_order should be 0
          const priceAtOrder = (item.isRewardItem || item.isCouponFreeItem) 
            ? 0 
            : (item.product.promotional_price ?? item.product.price);

          // id gerado no cliente para não depender de `.select()` de retorno
          // (bloqueado pelo RLS no fluxo anônimo).
          const orderItemId = novoId();
          const { error: itemError } = await supabase
            .from("order_items")
            .insert({
              id: orderItemId,
              order_id: order.id,
              product_id: item.product.id,
              quantity: item.quantity,
              price_at_order: priceAtOrder,
              notes: item.notes,
            });

          if (itemError) throw itemError;

          // For reward/coupon items with extras, price should also be 0
          for (const extra of item.extras) {
            await supabase.from("order_item_extras").insert({
              order_item_id: orderItemId,
              product_extra_id: (extra as any).is_complement ? null : extra.id,
              price_at_order: (item.isRewardItem || item.isCouponFreeItem) ? 0 : extra.price,
              extra_name: extra.name,
            });
          }
        }
      }

      // When pre-creating an order for an online payment, stop here — side
      // effects (loyalty/coupon/address/navigate) only run after confirmation.
      if (asPending) {
        return order.id;
      }

      // Record loyalty reward redemptions for reward items (free_item type)
      const rewardItems = cart.filter(item => item.isRewardItem && item.rewardId);
      if (rewardItems.length > 0) {
        // Get active program
        const { data: activeProgram } = await supabase
          .from("loyalty_programs")
          .select("id")
          .eq("restaurant_id", restaurant.id)
          .eq("is_active", true)
          .single();

        if (activeProgram) {
          for (const rewardItem of rewardItems) {
            // Get the reward's trigger_value (leitura pública — catálogo)
            const { data: reward } = await supabase
              .from("loyalty_program_rewards")
              .select("trigger_value")
              .eq("id", rewardItem.rewardId)
              .single();

            // Registro atômico (checa duplicidade + insere) via RPC segura.
            const { data: recorded } = await (supabase as any).rpc("record_reward_redemption", {
              p_cpf: customerData.cpf,
              p_program_id: activeProgram.id,
              p_reward_id: rewardItem.rewardId,
              p_order_id: order.id,
              p_trigger_value: reward?.trigger_value || 0,
            });
            if (recorded === false) {
              console.warn("Reward already redeemed, skipping:", rewardItem.rewardId);
            }
          }
        }
      }

      // Record redemption for discount rewards (atômico + anti-duplicidade via RPC)
      if (activeRewardDiscount) {
        await (supabase as any).rpc("record_reward_redemption", {
          p_cpf: customerData.cpf,
          p_program_id: activeRewardDiscount.programId,
          p_reward_id: activeRewardDiscount.id,
          p_order_id: order.id,
          p_trigger_value: activeRewardDiscount.triggerValue,
        });
      }

      if (coupon) {
        await (supabase as any).rpc("increment_coupon_usage", { p_coupon_id: coupon.id });
      }

      if (restaurant.loyalty_enabled && customerData.cpf) {
        if (loyaltyPointsUsed > 0) {
          await updateLoyaltyPoints(
            customerData.cpf,
            restaurant.id,
            -loyaltyPointsUsed,
            order.id,
            "redeem"
          );
        }

        const pointsToEarn = Math.floor(subtotal * (restaurant.loyalty_points_per_real || 1));
        if (pointsToEarn > 0) {
          await updateLoyaltyPoints(
            customerData.cpf,
            restaurant.id,
            pointsToEarn,
            order.id,
            "earn"
          );
        }
      }

      if (deliveryType === "delivery" && addressData?.saveForLater) {
        const a: any = addressData.address || {};
        await (supabase as any).rpc("add_customer_address", {
          p_cpf: customerData.cpf,
          p_name: customerData.name,
          p_phone: customerData.phone,
          p_street: a.street ?? "",
          p_number: a.number ?? "",
          p_neighborhood: a.neighborhood ?? "",
          p_city: a.city ?? "",
          p_state: a.state ?? "",
          p_zip_code: a.zip_code ?? "",
          p_complement: a.complement ?? null,
          p_is_default: !!addressData.isFirstAddress,
        });
      }

      localStorage.removeItem(`delivery-cart-${restaurantSlug}`);
      onClearCart();
      onClose();

      navigate(`/${restaurantSlug}/pedido/${order.id}`);
      toast.success("Pedido realizado com sucesso! 🎉");
      return order.id;
    } catch (error: any) {
      console.error("Erro ao finalizar pedido:", error);
      const errorMessage = error?.message 
        ? `Erro: ${error.message}` 
        : "Erro ao finalizar pedido. Tente novamente.";
      toast.error(errorMessage);
      // Reset to payment step so user isn't stuck on loading screen
      if (!asPending) setStep("payment");
      return null;
    } finally {
      if (!asPending) setSubmitting(false);
    }
  };

  // Ensures a pending order exists for online payment BEFORE we hit MercadoPago,
  // so that the order is never lost if the user closes the browser after paying.
  const ensurePendingOnlineOrder = async (): Promise<string | null> => {
    if (pendingOnlineOrderIdRef.current) return pendingOnlineOrderIdRef.current;
    if (creatingPendingOrderRef.current) return creatingPendingOrderRef.current;
    const p = (async () => {
      const id = await handleFinishOrder(undefined, { asPending: true });
      if (id) pendingOnlineOrderIdRef.current = id;
      return id;
    })();
    creatingPendingOrderRef.current = p;
    try {
      return await p;
    } finally {
      creatingPendingOrderRef.current = null;
    }
  };

  const updateLoyaltyPoints = async (
    cpf: string,
    restaurantId: string,
    points: number,
    orderId: string,
    type: "earn" | "redeem"
  ) => {
    // Aplica ganho/resgate de pontos de forma ATÔMICA no servidor e já
    // registra a transação. Substitui a leitura/escrita direta de
    // loyalty_points (bloqueada pelo RLS no fluxo anônimo). `apply_loyalty`
    // espera pontos positivos + o tipo.
    await (supabase as any).rpc("apply_loyalty", {
      p_cpf: cpf,
      p_points: Math.abs(points),
      p_type: type,
      p_order_id: orderId,
    });
  };

  const calculateCouponDiscount = (subtotal: number, coupon: any) => {
    // Free product coupons don't apply a monetary discount
    if (coupon.coupon_type === "free_product") {
      return 0;
    }
    if (coupon.coupon_type === "free_delivery") {
      return 0; // Handled in getDeliveryFee
    }
    if (coupon.discount_type === "percentage") {
      const discount = subtotal * (coupon.discount_value / 100);
      return coupon.max_discount ? Math.min(discount, coupon.max_discount) : discount;
    }
    return coupon.discount_value;
  };

  const formatAddress = (address: any) => {
    return `${address.street}, ${address.number}${address.complement ? `, ${address.complement}` : ""} - ${address.neighborhood}, ${address.city}/${address.state} - CEP: ${address.zip_code}`;
  };

  const handleAddRewardItem = async (reward: Reward) => {
    if (!reward.product || !onAddRewardItem) return;

    // Check if this reward is already in the cart
    const existingRewardItem = cart.find(item => item.rewardId === reward.id);
    if (existingRewardItem) {
      toast.error("Esta recompensa já está na sacola");
      return;
    }

    // Build extras array if there's a specific extra for this reward
    const extras: Array<{ id: string; name: string; price: number }> = [];
    if (reward.extra) {
      extras.push({
        id: reward.extra.id,
        name: reward.extra.name,
        price: 0, // Free because it's part of the reward
      });
    }

    const rewardCartItem: CartItem = {
      id: `reward-${reward.id}-${Date.now()}`,
      product: {
        id: reward.product.id,
        name: reward.product.name,
        description: null,
        price: 0, // FREE
        promotional_price: null,
        available: true,
        image_url: reward.product.image_url,
      },
      quantity: 1,
      extras,
      notes: "Recompensa do programa de fidelidade",
      isRewardItem: true,
      rewardId: reward.id,
    };

    onAddRewardItem(rewardCartItem);
    toast.success(`${reward.product.name} adicionado como recompensa!`);
  };

  const handleRedeemDiscount = (discount: DiscountReward) => {
    setActiveRewardDiscount(discount);
    toast.success("Desconto de fidelidade aplicado!");
  };

  const handleClearRewardDiscount = () => {
    setActiveRewardDiscount(null);
  };

  // Handle coupon application with free product logic
  const handleApplyCoupon = (couponData: any) => {
    // If removing coupon, also remove free item from cart
    if (!couponData && coupon?.coupon_type === "free_product" && onAddRewardItem) {
      // Note: We can't remove items directly, the free item stays but that's ok
      // since it's already marked as free
    }
    
    // If applying a free product coupon, add the item to cart
    if (couponData?.coupon_type === "free_product" && couponData.freeProduct && onAddRewardItem) {
      // Check if this coupon's free item is already in the cart
      const existingFreeItem = cart.find(item => item.couponId === couponData.id);
      if (!existingFreeItem) {
        // Build extras array if there's a specific extra for this coupon
        const extras: Array<{ id: string; name: string; price: number }> = [];
        if (couponData.freeProductExtra) {
          extras.push({
            id: couponData.freeProductExtra.id,
            name: couponData.freeProductExtra.name,
            price: 0, // Free because it's part of the coupon
          });
        }

        const freeCartItem: CartItem = {
          id: `coupon-free-${couponData.id}-${Date.now()}`,
          product: {
            id: couponData.freeProduct.id,
            name: couponData.freeProduct.name,
            description: null,
            price: 0, // FREE
            promotional_price: null,
            available: true,
            image_url: couponData.freeProduct.image_url,
          },
          quantity: 1,
          extras,
          notes: `Cupom ${couponData.code}`,
          isCouponFreeItem: true,
          couponId: couponData.id,
        };

        onAddRewardItem(freeCartItem);
      }
    }

    setCoupon(couponData);
    // Rastreio do funil: registra o cupom na sessão do cliente.
    onCouponApplied?.(couponData?.code ?? null);
  };

  // Get customer CPF from prop or sessionStorage
  const getCustomerCPF = () => {
    return customerCPFProp || sessionStorage.getItem("customer_cpf") || "";
  };

  const renderStep = () => {
    switch (step) {
      case "cart":
        return (
          <CartStep
            cart={cart}
            restaurant={restaurant}
            onUpdateQuantity={onUpdateQuantity}
            onClearCart={onClearCart}
            coupon={coupon}
            onApplyCoupon={handleApplyCoupon}
            loyaltyPoints={loyaltyPoints}
            loyaltyPointsUsed={loyaltyPointsUsed}
            onRedeemPoints={setLoyaltyPointsUsed}
            onContinue={() => {
              const cpf = getCustomerCPF();
              if (!cpf && onRequireLogin) {
                onRequireLogin();
                return;
              }
              setStep("delivery-type");
            }}
            minOrderValue={getMinOrderValue()}
            deliveryType={deliveryType}
            customerCPF={getCustomerCPF()}
            onAddRewardItem={onAddRewardItem ? handleAddRewardItem : undefined}
            onRedeemDiscount={handleRedeemDiscount}
            activeRewardDiscount={activeRewardDiscount}
            onClearRewardDiscount={handleClearRewardDiscount}
            onSuggestionClick={onSuggestionClick}
            onAddUpsellItem={onAddRewardItem}
          />
        );
      case "delivery-type":
        return (
          <DeliveryTypeStep
            selected={deliveryType}
            onSelect={setDeliveryType}
            onBack={() => setStep("cart")}
            onContinue={() => {
              if (deliveryType === "delivery") {
                setStep("address");
              } else {
                // Retirada: sem endereço, mas registra o tipo no funil.
                onAddressSelected?.(null, deliveryType);
                setStep("payment");
              }
            }}
            storeAddress={restaurant.store_address}
            restaurantId={restaurant.id}
          />
        );
      case "address":
        return (
          <AddressStep
            onBack={() => setStep("delivery-type")}
            onContinue={(data) => {
              setCustomerData({ name: data.customerName, cpf: data.customerCPF, phone: data.customerPhone });
              setAddressData(data);

              // Rastreio do funil: registra o endereço informado na sessão.
              onAddressSelected?.(
                data?.address ? formatAddress(data.address) : null,
                deliveryType
              );

              // Salvar zona de entrega encontrada
              if (data.deliveryZone) {
                setDeliveryZone(data.deliveryZone);
              }

              setStep("payment");
              
              if (restaurant.loyalty_enabled && data.customerCPF) {
                fetchLoyaltyPoints(data.customerCPF);
              }
            }}
            restaurantSlug={restaurantSlug}
            restaurantId={restaurant.id}
            primaryColor={primaryColorFromRestaurant(restaurant)}
          />
        );
      case "payment":
        const couponDiscount = coupon ? calculateCouponDiscount(subtotal, coupon) : 0;
        const loyaltyDiscount = loyaltyPointsUsed * (restaurant.loyalty_real_per_point || 0.01);
        const rewardDiscount = calculateRewardDiscount(subtotal);
        const deliveryFee = getDeliveryFee();
        const serviceFee = restaurant.service_fee_enabled 
          ? (subtotal * restaurant.service_fee_percentage / 100) 
          : 0;
        
        const orderTotal = Math.max(0, Math.round((subtotal + serviceFee + deliveryFee - couponDiscount - loyaltyDiscount - rewardDiscount) * 100) / 100);

        return (
          <PaymentStep
            onBack={() => deliveryType === "delivery" ? setStep("address") : setStep("delivery-type")}
            requireCustomerInfo={deliveryType === "pickup"}
            orderTotal={orderTotal}
            restaurantId={restaurant.id}
            primaryColor={primaryColorFromRestaurant(restaurant)}
            customerCPF={customerData?.cpf || getCustomerCPF() || localStorage.getItem(`delivery-cpf-${restaurantSlug}`) || ""}
            customerName={customerData?.name || sessionStorage.getItem("customer_name") || localStorage.getItem(`delivery-customer-${restaurantSlug}`) || ""}
            customerPhone={customerData?.phone || sessionStorage.getItem("customer_phone") || localStorage.getItem(`delivery-phone-${restaurantSlug}`) || ""}
            customerEmail={sessionStorage.getItem("customer_email") || ""}
            onContinue={(data) => {
              setPaymentData(data);
              
              if (deliveryType === "pickup") {
                const cpf = sessionStorage.getItem("customer_cpf") || localStorage.getItem(`delivery-cpf-${restaurantSlug}`) || "";
                const name = sessionStorage.getItem("customer_name") || localStorage.getItem(`delivery-customer-${restaurantSlug}`) || "";
                const phone = sessionStorage.getItem("customer_phone") || localStorage.getItem(`delivery-phone-${restaurantSlug}`) || "";
                setCustomerData({ name, cpf, phone });
                
                if (restaurant.loyalty_enabled && cpf) {
                  fetchLoyaltyPoints(cpf);
                }
              }
              
              // If online payment, go to online-payment step
              if (data.isOnlinePayment) {
                // Recalculate total to check if payment is actually needed
                const cd2 = coupon ? calculateCouponDiscount(subtotal, coupon) : 0;
                const ld2 = loyaltyPointsUsed * (restaurant.loyalty_real_per_point || 0.01);
                const rd2 = calculateRewardDiscount(subtotal);
                const df2 = getDeliveryFee();
                const sf2 = restaurant.service_fee_enabled ? (subtotal * restaurant.service_fee_percentage / 100) : 0;
                const finalTotal = Math.max(0, Math.round((subtotal + sf2 + df2 - cd2 - ld2 - rd2) * 100) / 100);
                
                if (finalTotal < 1) {
                  toast.success("Desconto aplicado! Pedido sem custo adicional.");
                  setStep("summary");
                } else {
                  setStep("online-payment");
                }
              } else {
                setStep("summary");
              }
            }}
          />
        );
      case "online-payment":
        const onlineTotal = (() => {
          const cd = coupon ? calculateCouponDiscount(subtotal, coupon) : 0;
          const ld = loyaltyPointsUsed * (restaurant.loyalty_real_per_point || 0.01);
          const rd = calculateRewardDiscount(subtotal);
          const df = getDeliveryFee();
          const sf = restaurant.service_fee_enabled ? (subtotal * restaurant.service_fee_percentage / 100) : 0;
          const raw = subtotal + sf + df - cd - ld - rd;
          return Math.max(0, Math.round(raw * 100) / 100);
        })();

        return (
          <OnlinePaymentStep
            onBack={() => setStep("payment")}
            onConfirm={(onlinePaymentId) => {
              // Online payment confirmed — finalize the pre-created order
              setPaymentData((prev: any) => ({ 
                ...prev, 
                onlinePaymentId,
                confirmed: true,
                isOnlinePayment: true,
              }));
              handleFinishOrder(onlinePaymentId, {
                existingOrderId: pendingOnlineOrderIdRef.current || undefined,
              });
            }}
            method={paymentData?.onlineMethod || "pix"}
            amount={onlineTotal}
            restaurantId={restaurant.id}
            orderId={undefined}
            ensureOrderId={ensurePendingOnlineOrder}
            customerName={customerData?.name || sessionStorage.getItem("customer_name") || ""}
            customerCPF={customerData?.cpf || sessionStorage.getItem("customer_cpf") || ""}
            customerPhone={customerData?.phone || sessionStorage.getItem("customer_phone") || ""}
            customerEmail={paymentData?.customerEmail || sessionStorage.getItem("customer_email") || ""}
            primaryColor={primaryColorFromRestaurant(restaurant)}
            cartItems={cart.filter(i => !i.isRewardItem && !i.isCouponFreeItem).map(i => ({
              id: i.product.id,
              name: i.product.name,
              quantity: i.quantity,
              unit_price: i.product.promotional_price ?? i.product.price,
            }))}
          />
        );
      case "summary":
        return (
          <SummaryStep
            cart={cart}
            restaurant={restaurant}
            customerData={customerData}
            addressData={addressData}
            paymentData={paymentData}
            coupon={coupon}
            loyaltyPointsUsed={loyaltyPointsUsed}
            deliveryType={deliveryType}
            onBack={() => setStep("payment")}
            onConfirm={() => handleFinishOrder()}
            submitting={submitting}
            deliveryZone={deliveryZone}
            activeRewardDiscount={activeRewardDiscount}
            isRestaurantOpen={restaurant.is_open !== false}
            scheduledFor={scheduledFor}
            onScheduledForChange={setScheduledFor}
          />
        );
    }
  };

  const fetchLoyaltyPoints = async (cpf: string) => {
    const { data } = await (supabase as any).rpc("get_loyalty_balance", {
      p_cpf: cpf,
    });

    setLoyaltyPoints((data as number) || 0);
  };

  if (mode === "local") {
    return null;
  }

  return (
    <Drawer open={open} onOpenChange={onClose}>
      <DrawerContent className="max-h-[95vh]">
        <DrawerHeader className="border-b border-border pb-4">
          <div className="flex items-center justify-between mb-4">
            <button onClick={onClose} className="text-muted-foreground">
              ✕
            </button>
            <DrawerTitle className="text-lg font-bold">
              {step === "cart" && "Sacola"}
              {step === "delivery-type" && "Tipo de Entrega"}
              {step === "address" && "Endereço de Entrega"}
              {step === "payment" && "Forma de Pagamento"}
              {step === "online-payment" && "Pagamento Online"}
              {step === "summary" && "Confirmar Pedido"}
            </DrawerTitle>
            <div className="w-6" />
          </div>
          <Progress value={getProgressValue()} className="h-1" />
        </DrawerHeader>

        <div className="overflow-y-auto flex-1" data-vaul-no-drag>
          {renderStep()}
        </div>
      </DrawerContent>
    </Drawer>
  );
};

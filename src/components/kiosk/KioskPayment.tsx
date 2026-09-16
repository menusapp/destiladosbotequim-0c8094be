import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Banknote, Loader2, Zap, XCircle, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import { CartItem } from "@/types/menu";
import { KioskCustomer } from "@/pages/Kiosk";
import { KioskConfig, KioskPointTerminal } from "@/hooks/useKioskConfig";
import { ConsumptionMode } from "./KioskConsumptionType";

import { novoId } from "@/lib/uuid";
type PointPaymentStatus = "idle" | "creating_payment" | "waiting_terminal" | "processing" | "paid" | "failed" | "canceled";

interface Props {
  cart: CartItem[];
  restaurant: any;
  customer: KioskCustomer;
  consumptionMode: ConsumptionMode;
  tableNumber: string;
  primaryColor: string;
  cartTotal: number;
  onBack: () => void;
  onOrderCreated: (orderId: string) => void;
  kioskConfig?: KioskConfig | null;
  pointTerminal?: KioskPointTerminal | null;
  appliedCoupon?: any;
  couponDiscount?: number;
  loyaltyPointsUsed?: number;
  loyaltyRealPerPoint?: number;
  deliveryAddress?: string;
}

export function KioskPayment({
  cart, restaurant, customer, consumptionMode, tableNumber, primaryColor, cartTotal, onBack, onOrderCreated, kioskConfig,
  pointTerminal, appliedCoupon, couponDiscount = 0, loyaltyPointsUsed = 0, loyaltyRealPerPoint = 0.01, deliveryAddress,
}: Props) {
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [cashPaid, setCashPaid] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Point terminal payment state
  const [pointStatus, setPointStatus] = useState<PointPaymentStatus>("idle");
  const [mpOrderId, setMpOrderId] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createdOrderIdRef = useRef<string | null>(null);
  const orderCreationInProgressRef = useRef(false);

  const pointsDiscount = loyaltyPointsUsed * loyaltyRealPerPoint;
  const finalTotal = Math.max(0, cartTotal - couponDiscount - pointsDiscount);

  const changeAmount = paymentMethod === "cash" && cashPaid
    ? Math.max(0, parseFloat(cashPaid) - finalTotal)
    : 0;

  const hasTerminal = !!pointTerminal;

  // Auto-start terminal payment when entering this screen with a terminal configured
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (hasTerminal && !autoStartedRef.current) {
      autoStartedRef.current = true;
      setPaymentMethod("point_terminal");
      // Start terminal payment automatically
      startTerminalPayment();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTerminal]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const getOrderTypeFields = () => {
    switch (consumptionMode) {
      case "counter": return { order_type: "balcao", delivery_type: "pickup" };
      case "table": return { order_type: "local", delivery_type: "local" };
      case "takeaway": return { order_type: "delivery", delivery_type: "takeaway" };
      case "delivery": return { order_type: "delivery", delivery_type: "delivery" };
      default: return { order_type: "local", delivery_type: "local" };
    }
  };

  const getConsumptionLabel = () => {
    switch (consumptionMode) {
      case "counter": return "Retirada no balcão";
      case "table": return `Mesa ${tableNumber}`;
      case "takeaway": return "Para viagem";
      case "delivery": return "Entrega";
      default: return "";
    }
  };

  const getPaymentTypeForDB = () => {
    if (paymentMethod === "cash") return "cash";
    // Pagamentos do totem via maquininha caem na conta MP — tratamos como Totem Online
    return "totem_online";
  };

  const createOrderInDB = useCallback(async (alreadyPaid = false): Promise<string | null> => {
    const { order_type, delivery_type } = getOrderTypeFields();

    const paymentLabel = paymentMethod === "point_terminal" ? "[Maquininha]" : "";
    const notes = [
      `[TOTEM] ${getConsumptionLabel()}`,
      paymentMethod === "cash" && cashPaid ? `Troco para: R$ ${parseFloat(cashPaid).toFixed(2)}` : null,
      paymentLabel || null,
    ].filter(Boolean).join(" | ");

    // Build items array for the RPC
    const itemsPayload = cart.map(item => ({
      product_id: item.product.id,
      quantity: item.quantity,
      price_at_order: item.product.promotional_price ?? item.product.price,
      notes: item.notes || null,
      extras: item.extras.map(extra => ({
        product_extra_id: extra.id,
        price_at_order: extra.price,
        extra_name: extra.name,
        is_complement: !!(extra.isComplementItem || extra.is_complement),
      })),
    }));

    // Call atomic RPC — order + items + extras in a single transaction
    const { data: orderId, error: rpcError } = await supabase.rpc("create_kiosk_order", {
      p_restaurant_id: restaurant.id,
      p_customer_name: customer.name,
      p_customer_cpf: customer.cpf,
      p_order_type: order_type,
      p_delivery_type: delivery_type,
      p_notes: notes,
      p_delivery_phone: customer.phone || null,
      p_delivery_address: consumptionMode === "delivery" && deliveryAddress ? deliveryAddress : null,
      p_coupon_code: appliedCoupon?.code || null,
      p_coupon_discount: couponDiscount,
      p_loyalty_points_used: loyaltyPointsUsed,
      p_reward_discount: pointsDiscount,
      p_table_number: consumptionMode === "table" && tableNumber ? parseInt(tableNumber) : null,
      p_items: itemsPayload,
    });

    if (rpcError) {
      console.error("[KioskPayment] RPC create_kiosk_order error:", rpcError);
      throw new Error(rpcError.message || "Erro ao salvar pedido");
    }

    if (!orderId) {
      throw new Error("Pedido não foi criado");
    }

    const isTablePaid = alreadyPaid && consumptionMode === "table";
    const finalStatus = isTablePaid ? "accepted" : alreadyPaid ? "preparing" : "pending";

    // Now that items+extras exist atomically, update to final status so triggers fire
    if (finalStatus !== "pending") {
      const { error: updateError } = await (supabase as any).rpc("finalize_order_payment", {
        p_order_id: orderId,
        p_payment_type: getPaymentTypeForDB(),
        p_payment_status: "paid",
        p_status: finalStatus,
      });

      if (updateError) {
        console.error("[KioskPayment] Status update error:", updateError);
      }
    }

    // Create comanda for table orders
    const tableId = consumptionMode === "table" && tableNumber ? true : false;
    if (consumptionMode === "table" && tableId) {
      // Get table_id from order
      const { data: orderDetails } = await (supabase as any).rpc('get_order_details', { p_order_id: orderId });
      const orderData = orderDetails?.table_id != null ? orderDetails : orderDetails?.order;

      if (orderData?.table_id) {
        // id gerado no cliente (sem `.select()` de retorno, bloqueado pelo RLS).
        const comandaId = novoId();
        const { error: comandaError } = await supabase
          .from("comandas")
          .insert({
            id: comandaId,
            restaurant_id: restaurant.id,
            table_id: orderData.table_id,
            customer_name: customer.name,
            customer_cpf: customer.cpf || "000.000.000-00",
            status: "active",
          });

        if (!comandaError) {
          await (supabase as any).rpc("finalize_order_payment", {
            p_order_id: orderId,
            p_comanda_id: comandaId,
          });
        }

        if (isTablePaid) {
          await supabase.from("tables").update({
            is_occupied: true,
            occupied_at: new Date().toISOString(),
            occupied_by: customer.name,
          }).eq("id", orderData.table_id);
        }
      }
    }

    // Update coupon usage
    if (appliedCoupon?.id) {
      await (supabase as any).rpc("increment_coupon_usage", { p_coupon_id: appliedCoupon.id });
    }

    // Update loyalty
    if (restaurant.loyalty_enabled && customer.cpf) {
      const pointsToEarn = Math.floor(finalTotal * (restaurant.loyalty_points_per_real || 1));
      if (pointsToEarn > 0) {
        // Fidelidade atômica no servidor (substitui a leitura/escrita direta
        // de loyalty_points, bloqueada pelo RLS no fluxo anônimo do totem).
        await (supabase as any).rpc("apply_loyalty", {
          p_cpf: customer.cpf, p_points: pointsToEarn, p_type: "earn", p_order_id: orderId,
        });
        if (loyaltyPointsUsed > 0) {
          await (supabase as any).rpc("apply_loyalty", {
            p_cpf: customer.cpf, p_points: loyaltyPointsUsed, p_type: "redeem", p_order_id: orderId,
          });
        }
      }
    }

    return orderId;
  }, [restaurant, customer, cart, consumptionMode, tableNumber, paymentMethod, cashPaid, finalTotal, appliedCoupon, couponDiscount, loyaltyPointsUsed, pointsDiscount, deliveryAddress]);

  const startPointPolling = useCallback((mpOrdId: string) => {
    setPointStatus("waiting_terminal");

    // Timeout after 120s
    timeoutRef.current = setTimeout(async () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      setPointStatus("canceled");

      try {
        await supabase.functions.invoke("mercadopago-point", {
          body: { action: "cancel_order", restaurant_id: restaurant.id, mp_order_id: mpOrdId },
        });
      } catch (e) {
        console.error("[KioskPayment] Cancel error:", e);
      }

      toast.error("Tempo esgotado. Tente novamente.");
    }, 120_000);

    // Poll every 3s
    pollingRef.current = setInterval(async () => {
      try {
        const { data: res } = await supabase.functions.invoke("mercadopago-point", {
          body: { action: "get_order", restaurant_id: restaurant.id, mp_order_id: mpOrdId },
        });

        if (!res?.ok) return;

        const status = res.data?.status;
        const internalStatus = res.data?.internal_status;
        const data = res.data;
        const txn = data?.transactions?.payments?.[0];

        const isPaid = internalStatus === "paid" ||
          status === "processed" || status === "finished" ||
          (txn?.status_detail === "accredited" || txn?.status === "approved");

        if (isPaid) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setPointStatus("paid");

          if (orderCreationInProgressRef.current) return;
          orderCreationInProgressRef.current = true;

          try {
            const orderId = await createOrderInDB(true);
            if (orderId) {
              createdOrderIdRef.current = orderId;
              onOrderCreated(orderId);
            } else {
              toast.error("Pagamento confirmado, mas erro ao criar pedido.");
            }
          } catch (dbErr: any) {
            console.error("[KioskPayment] DB error after payment:", dbErr);
            toast.error("Pagamento confirmado, mas erro ao salvar pedido.");
          }
          return;
        }

        const isFailed = internalStatus === "failed" ||
          (status === "processed" && txn && txn.status !== "approved");
        if (isFailed) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setPointStatus("failed");
          toast.error("Pagamento recusado na maquininha.");
          return;
        }

        const isCanceled = internalStatus === "canceled" || status === "canceled" || status === "expired";
        if (isCanceled) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setPointStatus("canceled");
          toast.error("Pagamento cancelado.");
          return;
        }

        if (internalStatus === "processing" || status === "processing") {
          setPointStatus("processing");
        }
      } catch (e) {
        console.error("[KioskPayment] Polling error:", e);
      }
    }, 3000);
  }, [restaurant.id, onOrderCreated, createOrderInDB]);

  const startTerminalPayment = useCallback(async () => {
    if (!pointTerminal) {
      toast.error("Nenhuma maquininha configurada");
      return;
    }
    setSubmitting(true);
    setPointStatus("creating_payment");

    try {
      const tempId = novoId();

      const { data: res } = await supabase.functions.invoke("mercadopago-point", {
        body: {
          action: "create_order",
          restaurant_id: restaurant.id,
          amount: finalTotal,
          description: `Pedido Totem`,
          order_id: tempId,
          device_id: pointTerminal.device_id,
          idempotency_key: tempId,
          // No payment_type — let the terminal show its default selection menu
        },
      });

      if (!res?.ok || !res.data?.id) {
        const errMsg = res?.error || "Erro ao enviar para maquininha";
        if (res?.code === "TOKEN_EXPIRED") {
          toast.error("Token expirado. Reconecte a conta Mercado Pago.");
        } else {
          toast.error(errMsg);
        }
        setPointStatus("failed");
        setSubmitting(false);
        return;
      }

      setMpOrderId(res.data.id);
      startPointPolling(res.data.id);
    } catch (err: any) {
      console.error("[KioskPayment] Point payment error:", err);
      toast.error(err?.message || "Erro ao processar pagamento");
      setPointStatus("failed");
    } finally {
      setSubmitting(false);
    }
  }, [pointTerminal, restaurant.id, finalTotal, startPointPolling]);

  const handleCancelPointPayment = async () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    if (mpOrderId) {
      try {
        await supabase.functions.invoke("mercadopago-point", {
          body: { action: "cancel_order", restaurant_id: restaurant.id, mp_order_id: mpOrderId },
        });
      } catch (e) {
        console.error("[KioskPayment] Cancel error:", e);
      }
    }

    setPointStatus("idle");
    setMpOrderId(null);
    orderCreationInProgressRef.current = false;
    onBack();
  };

  const handleRetryPointPayment = () => {
    setPointStatus("idle");
    setMpOrderId(null);
    orderCreationInProgressRef.current = false;
    startTerminalPayment();
  };

  const handleFinalizeCash = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const orderId = await createOrderInDB();
      if (!orderId) {
        setSubmitting(false);
        return;
      }
      onOrderCreated(orderId);
    } catch (err: any) {
      console.error("[Kiosk] Order error:", err);
      toast.error(err?.message || "Erro ao finalizar pedido");
    } finally {
      setSubmitting(false);
    }
  };

  // === TERMINAL PAYMENT SCREEN (auto-triggered when terminal exists) ===
  if (hasTerminal) {
    // Waiting / processing / creating screen
    if (pointStatus === "creating_payment" || pointStatus === "waiting_terminal" || pointStatus === "processing" || pointStatus === "paid") {
      const statusMessages: Record<string, string> = {
        creating_payment: "Enviando para a maquininha...",
        waiting_terminal: "Continue o pagamento na maquininha",
        processing: "Processando pagamento...",
        paid: "Pagamento aprovado!",
      };

      return (
        <div className="flex flex-col h-screen bg-background items-center justify-center relative">
          <div className="text-center space-y-8 p-8 max-w-md">
            {pointStatus === "paid" ? (
              <div className="h-24 w-24 rounded-full bg-green-100 dark:bg-green-950/30 flex items-center justify-center mx-auto">
                <Zap className="h-12 w-12 text-green-600" />
              </div>
            ) : pointStatus === "creating_payment" ? (
              <Loader2 className="h-20 w-20 animate-spin mx-auto" style={{ color: primaryColor }} />
            ) : (
              <div className="h-24 w-24 rounded-full flex items-center justify-center mx-auto" style={{ backgroundColor: `${primaryColor}15` }}>
                <div className="h-16 w-16 rounded-full flex items-center justify-center" style={{ backgroundColor: `${primaryColor}25` }}>
                  <div className="h-4 w-4 rounded-full animate-pulse" style={{ backgroundColor: primaryColor }} />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-3xl font-bold text-foreground">{statusMessages[pointStatus]}</p>
              <p className="text-5xl font-bold" style={{ color: primaryColor }}>R$ {finalTotal.toFixed(2)}</p>
            </div>

            {pointStatus !== "paid" && (
              <Button
                variant="ghost"
                onClick={handleCancelPointPayment}
                className="gap-2 mt-6 text-muted-foreground"
              >
                <XCircle className="h-4 w-4" />
                Cancelar
              </Button>
            )}
          </div>

          {/* Arrow indicator bottom-right */}
          {(pointStatus === "waiting_terminal" || pointStatus === "processing") && (
            <div className="absolute bottom-12 right-12 flex items-center gap-3 text-muted-foreground animate-pulse">
              <span className="text-lg font-medium">Maquininha</span>
              <ArrowRight className="h-8 w-8" style={{ color: primaryColor }} />
            </div>
          )}
        </div>
      );
    }

    // Failed / canceled — show retry
    if (pointStatus === "failed" || pointStatus === "canceled") {
      return (
        <div className="flex flex-col h-screen bg-background items-center justify-center">
          <div className="text-center space-y-6 p-8 max-w-md">
            <div className="h-20 w-20 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <XCircle className="h-10 w-10 text-destructive" />
            </div>
            <p className="text-2xl font-bold text-foreground">
              {pointStatus === "failed" ? "Pagamento recusado" : "Pagamento cancelado"}
            </p>
            <p className="text-4xl font-bold" style={{ color: primaryColor }}>R$ {finalTotal.toFixed(2)}</p>
            <div className="flex gap-3 justify-center mt-4">
              <Button variant="outline" onClick={onBack} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </Button>
              <Button onClick={handleRetryPointPayment} className="gap-2 text-white" style={{ backgroundColor: primaryColor }}>
                <Zap className="h-4 w-4" />
                Tentar novamente
              </Button>
            </div>
          </div>
        </div>
      );
    }

    // Idle with terminal — should not normally be visible (auto-start fires), but fallback
    return (
      <div className="flex flex-col h-screen bg-background items-center justify-center">
        <Loader2 className="h-16 w-16 animate-spin" style={{ color: primaryColor }} />
      </div>
    );
  }

  // === NO TERMINAL — CASH ONLY FALLBACK ===
  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="flex items-center gap-4 p-5 border-b bg-card shrink-0">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-12 w-12 rounded-full">
          <ArrowLeft className="h-6 w-6" />
        </Button>
        <h2 className="text-xl font-bold text-foreground">Pagamento</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 max-w-lg mx-auto w-full">
        <div className="text-center mb-8">
          <p className="text-sm text-muted-foreground">Total do pedido</p>
          <p className="text-4xl font-bold mt-1" style={{ color: primaryColor }}>R$ {finalTotal.toFixed(2)}</p>
          {(couponDiscount > 0 || pointsDiscount > 0) && (
            <p className="text-sm text-green-600 mt-1">
              Economia: R$ {(couponDiscount + pointsDiscount).toFixed(2)}
            </p>
          )}
        </div>

        {/* Cash payment option */}
        <div className="space-y-3 mb-8">
          <button
            onClick={() => setPaymentMethod("cash")}
            className={`w-full p-5 rounded-2xl border-2 flex items-center gap-4 transition-all ${
              paymentMethod === "cash" ? "shadow-lg" : "border-muted hover:border-muted-foreground/30"
            }`}
            style={paymentMethod === "cash" ? { borderColor: primaryColor, backgroundColor: `${primaryColor}10` } : {}}
          >
            <div className="h-12 w-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: paymentMethod === "cash" ? primaryColor : undefined }}>
              <Banknote className="h-6 w-6" style={{ color: paymentMethod === "cash" ? "#fff" : undefined }} />
            </div>
            <div className="text-left flex-1">
              <span className="text-lg font-bold text-foreground">Dinheiro</span>
              <p className="text-sm text-muted-foreground">Pagar no balcão</p>
            </div>
          </button>
        </div>

        {paymentMethod === "cash" && (
          <div className="space-y-3">
            <Label className="text-lg">Troco para quanto?</Label>
            <Input
              value={cashPaid}
              onChange={(e) => setCashPaid(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
              placeholder="0,00"
              className="text-2xl h-16 text-center rounded-xl"
              inputMode="decimal"
            />
            {cashPaid && parseFloat(cashPaid) >= finalTotal && (
              <div className="text-center p-4 bg-green-50 dark:bg-green-950/30 rounded-xl">
                <p className="text-sm text-muted-foreground">Troco</p>
                <p className="text-3xl font-bold text-green-600">R$ {changeAmount.toFixed(2)}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t bg-card p-5 shrink-0">
        <div className="max-w-lg mx-auto">
          <Button
            onClick={handleFinalizeCash}
            className="w-full h-14 text-lg font-bold rounded-xl text-white"
            style={{ backgroundColor: primaryColor }}
            disabled={submitting || paymentMethod !== "cash" || (cashPaid !== "" && parseFloat(cashPaid) < finalTotal)}
          >
            {submitting ? (
              <><Loader2 className="h-5 w-5 animate-spin mr-2" />Finalizando...</>
            ) : (
              "Finalizar Pedido"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

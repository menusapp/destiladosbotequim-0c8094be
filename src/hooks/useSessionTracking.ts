import { useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CartItem } from "@/types/menu";

import { novoId } from "@/lib/uuid";
const SESSION_KEY = "delivery-session-token";

function getOrCreateSessionToken(): string {
  let token = localStorage.getItem(SESSION_KEY);
  if (!token) {
    token = novoId();
    localStorage.setItem(SESSION_KEY, token);
  }
  return token;
}

function getLocalStorageCustomerData(slug?: string): { name?: string; phone?: string } {
  if (!slug) return {};
  const result: { name?: string; phone?: string } = {};
  try {
    const name = localStorage.getItem(`delivery-customer-${slug}`);
    const phone = localStorage.getItem(`delivery-phone-${slug}`);
    if (name) result.name = name;
    if (phone) result.phone = phone;
  } catch {
    // silent
  }
  return result;
}

export function useSessionTracking(restaurantId: string | undefined, restaurantSlug?: string) {
  const sessionToken = useRef(getOrCreateSessionToken());
  const lastStatus = useRef<string>("");

  const upsertSession = useCallback(
    async (fields: Record<string, any>, isBrowsing = false) => {
      if (!restaurantId) return;
      try {
        const token = sessionToken.current;
        const customerData = getLocalStorageCustomerData(restaurantSlug);

        const payload: Record<string, any> = {
          session_token: token,
          restaurant_id: restaurantId,
          last_activity: new Date().toISOString(),
          ...fields,
        };

        // Enrich with localStorage customer data if available
        if (customerData.name && !payload.name) payload.name = customerData.name;
        if (customerData.phone && !payload.phone) payload.phone = customerData.phone;

        // For browsing updates, don't overwrite cart data
        if (isBrowsing) {
          delete payload.cart_items;
          delete payload.cart_value;
        }

        const { session_token: _st, restaurant_id: _rid, last_activity: _la, ...fieldsPayload } = payload;

        await supabase.rpc("track_customer_session" as any, {
          p_restaurant_id: restaurantId,
          p_session_token: token,
          p_fields: fieldsPayload as any,
        });
      } catch {
        // Silent - never block navigation
      }
    },
    [restaurantId, restaurantSlug]
  );

  // Track page load - create/update browsing session
  useEffect(() => {
    if (!restaurantId) return;
    upsertSession({ status: "browsing" }, true);
    lastStatus.current = "browsing";
  }, [restaurantId, upsertSession]);

  const trackCartUpdate = useCallback(
    (cart: CartItem[]) => {
      if (!restaurantId || cart.length === 0) return;
      const cartValue = cart.reduce((sum, item) => {
        const extrasTotal = item.extras.reduce((s, e) => s + e.price, 0);
        const price = item.product.promotional_price ?? item.product.price;
        return sum + (price + extrasTotal) * item.quantity;
      }, 0);

      // Guarda o id (hash único) e o código PDV de cada produto além do nome,
      // para rastreabilidade e remarketing segmentado por produto específico.
      const cartSnapshot = cart.map((item) => ({
        id: item.product.id,
        pdv_code: (item.product as any).pdv_code ?? null,
        name: item.product.name,
        qty: item.quantity,
        price: item.product.promotional_price ?? item.product.price,
      }));

      const payload: Record<string, any> = {
        cart_items: cartSnapshot,
        cart_value: Math.round(cartValue * 100) / 100,
      };

      // Não regride o funil: se o cliente já iniciou o checkout (ou concluiu),
      // apenas atualiza o carrinho, sem voltar o status para "cart_added".
      const advanced =
        lastStatus.current === "checkout_started" || lastStatus.current === "completed";
      if (!advanced) {
        payload.status = "cart_added";
        lastStatus.current = "cart_added";
      }

      upsertSession(payload);
    },
    [restaurantId, upsertSession]
  );

  const trackCheckoutStarted = useCallback(() => {
    if (lastStatus.current === "checkout_started") return;
    lastStatus.current = "checkout_started";
    upsertSession({ status: "checkout_started", checkout_step: "cart" });
  }, [upsertSession]);

  // Rastreia a ETAPA do checkout em que o cliente está (funil de abandono):
  // cart → delivery-type → address → payment → online-payment → summary.
  const trackCheckoutStep = useCallback(
    (stepId: string) => {
      upsertSession({ status: "checkout_started", checkout_step: stepId }, true);
    },
    [upsertSession]
  );

  const trackCompleted = useCallback(() => {
    lastStatus.current = "completed";
    upsertSession({ status: "completed", cart_items: [], cart_value: 0 });
  }, [upsertSession]);

  const trackCustomerInfo = useCallback(
    (phone?: string, name?: string) => {
      const fields: Record<string, any> = {};
      if (phone) fields.phone = phone;
      if (name) fields.name = name;
      if (Object.keys(fields).length > 0) upsertSession(fields);
    },
    [upsertSession]
  );

  // Cupom aplicado/removido no checkout (null limpa) — visível no Rastreamento.
  const trackCoupon = useCallback(
    (code: string | null) => {
      upsertSession({ coupon_code: code }, true);
    },
    [upsertSession]
  );

  // Endereço informado + tipo de entrega — visível no Rastreamento.
  const trackAddress = useCallback(
    (address: string | null, deliveryType?: string) => {
      const fields: Record<string, any> = { delivery_address: address };
      if (deliveryType) fields.delivery_type = deliveryType;
      upsertSession(fields, true);
    },
    [upsertSession]
  );

  return {
    trackCartUpdate,
    trackCheckoutStarted,
    trackCheckoutStep,
    trackCompleted,
    trackCustomerInfo,
    trackCoupon,
    trackAddress,
  };
}

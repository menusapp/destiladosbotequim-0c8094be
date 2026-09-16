import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CartItem, Product } from "@/types/menu";

import { novoId } from "@/lib/uuid";
/**
 * Ofertas de upsell da sacola ("peça junto com desconto").
 *
 * Configuradas no painel (Produtos → Ofertas da Sacola): quando o produto
 * gatilho está na sacola, o produto oferta aparece logo abaixo dele com
 * preço riscado + preço com desconto + badge do desconto.
 */
export interface UpsellOffer {
  id: string;
  /** Chave do gatilho: id do produto na sacola sob o qual a oferta aparece. */
  trigger_product_id: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  product: Product;
}

/** Preço base, preço com desconto e texto da badge (sempre em %) de uma oferta. */
export function getUpsellPricing(offer: UpsellOffer): {
  basePrice: number;
  discountedPrice: number;
  badge: string;
} {
  const basePrice = offer.product.promotional_price ?? offer.product.price;
  let discountedPrice: number;
  if (offer.discount_type === "percentage") {
    discountedPrice = basePrice * (1 - offer.discount_value / 100);
  } else {
    discountedPrice = basePrice - offer.discount_value;
  }
  discountedPrice = Math.max(0, Math.round(discountedPrice * 100) / 100);
  // Badge sempre em % (requisito): para desconto fixo, calcula o % efetivo.
  const pct = basePrice > 0 ? Math.round((1 - discountedPrice / basePrice) * 100) : 0;
  const badge = `-${pct}%`;
  return { basePrice, discountedPrice, badge };
}

/**
 * Monta o CartItem da oferta: o preço com desconto entra como
 * promotional_price, então o restante do fluxo (subtotal, pedido,
 * price_at_order) usa o valor com desconto automaticamente.
 */
export function buildUpsellCartItem(offer: UpsellOffer): CartItem {
  const { discountedPrice } = getUpsellPricing(offer);
  return {
    id: novoId(),
    product: { ...offer.product, promotional_price: discountedPrice },
    quantity: 1,
    extras: [],
    notes: "",
  };
}

/**
 * Mapa trigger_product_id → ofertas ativas, já filtrando produtos que
 * o cliente colocou na sacola (a oferta some sozinha após adicionar).
 */
interface RawOffer {
  id: string;
  trigger_type: "product" | "category";
  trigger_product_id: string | null;
  trigger_category_id: string | null;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  product: Product;
}

export function useCartUpsells(cart: CartItem[]): Record<string, UpsellOffer[]> {
  const [rawOffers, setRawOffers] = useState<RawOffer[]>([]);
  // Mapa produto-na-sacola → categoria (para casar gatilhos por categoria).
  const [prodCategory, setProdCategory] = useState<Record<string, string>>({});

  // Ids dos produtos "normais" na sacola (gatilhos possíveis)
  const triggerIds = useMemo(
    () =>
      Array.from(
        new Set(
          cart
            .filter((i) => !i.isRewardItem && !i.isCouponFreeItem)
            .map((i) => i.product.id)
        )
      ),
    [cart]
  );
  const triggerKey = triggerIds.slice().sort().join(",");

  useEffect(() => {
    if (!triggerIds.length) {
      setRawOffers([]);
      setProdCategory({});
      return;
    }
    let active = true;
    (async () => {
      try {
        // 1) categorias dos produtos que estão na sacola (para gatilho por categoria)
        const { data: prods } = await supabase
          .from("products")
          .select("id, category_id")
          .in("id", triggerIds);
        const catMap: Record<string, string> = {};
        const categoryIds = new Set<string>();
        (prods as any[] | null)?.forEach((p) => {
          if (p.category_id) {
            catMap[p.id] = p.category_id;
            categoryIds.add(p.category_id);
          }
        });
        if (!active) return;
        setProdCategory(catMap);

        // 2) ofertas ativas cujo gatilho é um produto na sacola OU uma categoria na sacola
        const orParts: string[] = [];
        if (triggerIds.length) orParts.push(`trigger_product_id.in.(${triggerIds.join(",")})`);
        if (categoryIds.size) orParts.push(`trigger_category_id.in.(${Array.from(categoryIds).join(",")})`);

        const { data, error } = await (supabase as any)
          .from("product_upsells")
          .select(
            "id, trigger_type, trigger_product_id, trigger_category_id, discount_type, discount_value, product:products!product_upsells_upsell_product_id_fkey(id, name, description, price, promotional_price, available, image_url)"
          )
          .eq("is_active", true)
          .or(orParts.join(","));
        if (!active) return;
        if (error || !data) {
          setRawOffers([]);
          return;
        }
        setRawOffers(
          (data as any[])
            .filter((o) => o.product && o.product.available !== false)
            .map((o) => ({
              id: o.id,
              trigger_type: o.trigger_type,
              trigger_product_id: o.trigger_product_id,
              trigger_category_id: o.trigger_category_id,
              discount_type: o.discount_type,
              discount_value: Number(o.discount_value),
              product: o.product as Product,
            }))
        );
      } catch {
        if (active) setRawOffers([]);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);

  return useMemo(() => {
    const inCart = new Set(cart.map((i) => i.product.id));
    const map: Record<string, UpsellOffer[]> = {};
    const seen = new Set<string>(); // dedupe do produto ofertado (aparece 1x só)

    const push = (triggerProductId: string, o: RawOffer) => {
      if (inCart.has(o.product.id)) return; // já adicionado à sacola
      if (seen.has(o.product.id)) return; // já ofertado por outro gatilho
      seen.add(o.product.id);
      (map[triggerProductId] ??= []).push({
        id: o.id,
        trigger_product_id: triggerProductId,
        discount_type: o.discount_type,
        discount_value: o.discount_value,
        product: o.product,
      });
    };

    for (const o of rawOffers) {
      if (o.trigger_type === "category" && o.trigger_category_id) {
        // aparece sob o(s) produto(s) da sacola que pertencem à categoria gatilho
        const line = triggerIds.find((pid) => prodCategory[pid] === o.trigger_category_id);
        if (line) push(line, o);
      } else if (o.trigger_product_id) {
        push(o.trigger_product_id, o);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawOffers, cart, prodCategory, triggerKey]);
}

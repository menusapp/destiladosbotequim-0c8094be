import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import { printDocument } from "@/lib/printDispatcher";
import { getPublicMenuLink } from "@/lib/shareableLinks";

// Gera links públicos no formato path-based:
// https://menusapp.com.br/<slug>/<path>
// (Subdomínios desativados — domínio hospedado no Lovable não suporta wildcard.)
function buildPublicUrl(slug: string, path?: string): string {
  return getPublicMenuLink(slug, path);
}

interface Order {
  id: string;
  status: string;
  customer_name: string;
  delivery_type?: string;
  order_type?: string;
  delivery_phone?: string;
  customer_cpf?: string;
  table_id?: string;
  tables?: { table_number: number };
  ifood_source?: boolean;
  ifood_order_id?: string;
  dd_source?: boolean;
  dd_order_id?: string;
  payment_type?: string;
  payment_brand?: string;
  order_items?: any[];
  delivery_fee?: number;
  coupon_discount?: number;
  loyalty_points_used?: number;
  created_at?: string;
  notes?: string;
  delivery_address?: string;
  dd_scheduled_for?: string;
  cancellation_reason?: string;
}

interface NextStatusResult {
  status: string;
  label: string;
}

export function getNextStatus(order: Order): NextStatusResult | null {
  const isDelivery = order.order_type === "delivery" && order.delivery_type === "delivery";
  const isPickup = order.order_type === "delivery" && order.delivery_type === "pickup";
  const isTakeaway = order.order_type === "delivery" && order.delivery_type === "takeaway";
  const isBalcao = order.order_type === "balcao";
  const isLocal = order.order_type === "local" || (!order.order_type && !!order.table_id);
  const isIfood = !!order.ifood_source;

  switch (order.status) {
    case "pending":
      // Ao ACEITAR, o pedido já entra em "Preparando" (aceito == em preparo,
      // um único passo). O cliente recebe a mensagem de pedido confirmado.
      return { status: "preparing", label: "Aceitar" };
    case "accepted":
      if (isDelivery) return { status: "out_for_delivery", label: "Saiu p/ Entrega" };
      if (isPickup) return { status: "out_for_delivery", label: "Pronto p/ Retirada" };
      if (isTakeaway) return { status: "picked_up", label: "Retirado" };
      if (isBalcao) return { status: "ready", label: "Pronto" };
      if (isLocal) return { status: "delivered", label: "Na Mesa" };
      return { status: "preparing", label: "Em Preparo" };
    case "preparing":
      // iFood DELIVERY: Pronto = readyToPickup + dispatch → move direto p/ "Saiu p/ Entrega"
      if (isIfood && isDelivery) return { status: "out_for_delivery", label: "Pronto" };
      // iFood PICKUP/TAKEAWAY: Pronto = readyToPickup
      if (isIfood && (isPickup || isTakeaway)) return { status: "ready", label: "Pronto p/ Retirada" };
      if (isDelivery) return { status: "out_for_delivery", label: "Saiu p/ Entrega" };
      if (isPickup) return { status: "out_for_delivery", label: "Pronto p/ Retirada" };
      if (isTakeaway) return { status: "picked_up", label: "Retirado" };
      if (isBalcao) return { status: "ready", label: "Pronto" };
      if (isLocal) return { status: "delivered", label: "Na Mesa" };
      return { status: "ready", label: "Pronto" };
    case "ready":
      // iFood TAKEOUT/PICKUP: encerra em ready (sem dispatch)
      if (isIfood && (isPickup || isTakeaway)) return null;
      if (isBalcao) return { status: "picked_up", label: "Retirado" };
      if (isLocal) return { status: "delivered", label: "Na Mesa" };
      return null;
    case "out_for_delivery":
      // iFood DELIVERY: Entregue = apenas local (sem endpoint iFood)
      if (isDelivery) return { status: "delivered", label: "Entregue" };
      if (isPickup) return { status: "picked_up", label: "Retirado" };
      return null;
    default:
      return null;
  }
}

export function useOrderStatusAdvance(restaurantId: string) {
  const [loadingOrderId, setLoadingOrderId] = useState<string | null>(null);

  const getRestaurantSlug = async (): Promise<string> => {
    const { data } = await supabase
      .from("restaurants")
      .select("slug")
      .eq("id", restaurantId)
      .single();
    return data?.slug || '';
  };

  const sendWhatsAppNotification = async (order: Order, newStatus: string, reason?: string) => {
    try {
      let notificationType: string | null = null;
      // "aceito" e "preparando" são o mesmo passo (clicar em Aceitar): manda a
      // mensagem de pedido confirmado em ambos os estados.
      if (newStatus === "accepted" || newStatus === "preparing") notificationType = "order_accepted";
      else if (newStatus === "out_for_delivery") notificationType = "order_out_for_delivery";
      else if (newStatus === "ready") notificationType = "order_ready_pickup";
      else if (newStatus === "cancelled") notificationType = "order_cancelled";

      if (!notificationType) {
        console.log(`[WhatsApp][NOTIF] Status "${newStatus}" sem template mapeado — ignorando.`);
        return;
      }

      // Sempre tentar resolver telefone a partir do cadastro do cliente (CPF),
      // caindo de volta para o telefone do pedido. Isso garante notificação mesmo
      // quando delivery_phone vier vazio (pickup, balcao, etc).
      let phone: string | null = order.delivery_phone?.trim() || null;

      if (!phone && order.customer_cpf) {
        const { data: customer } = await supabase
          .from("customers")
          .select("phone")
          .eq("restaurant_id", restaurantId)
          .eq("cpf", order.customer_cpf)
          .maybeSingle();
        phone = customer?.phone?.trim() || null;
      }

      // Último fallback: buscar pelo nome do cliente neste restaurante
      if (!phone && order.customer_name) {
        const { data: customer } = await supabase
          .from("customers")
          .select("phone")
          .eq("restaurant_id", restaurantId)
          .ilike("name", order.customer_name.trim())
          .not("phone", "is", null)
          .limit(1)
          .maybeSingle();
        phone = customer?.phone?.trim() || null;
      }

      if (!phone) {
        console.warn(
          `[WhatsApp][NOTIF] Pedido ${order.id.slice(0, 8)} sem telefone — notificação "${notificationType}" não enviada.`
        );
        return;
      }

      const { data: restaurant } = await supabase
        .from("restaurants")
        .select("prep_time_minutes, slug")
        .eq("id", restaurantId)
        .maybeSingle();

      const slug = restaurant?.slug || '';

      console.log(`[WhatsApp][NOTIF] Disparando ${notificationType} para pedido ${order.id.slice(0, 8)} (phone=${phone})`);

      const invokePromise = supabase.functions.invoke("whatsapp-notifications", {
        body: {
          restaurant_id: restaurantId,
          notification_type: notificationType,
          context: {
            nome: order.customer_name || "Cliente",
            numero_pedido: order.id.slice(0, 8),
            order_id: order.id,
            tempo_estimado: restaurant?.prep_time_minutes?.toString() || "30",
            phone,
            motivo: reason || "Não informado",
            link_avaliacao: buildPublicUrl(slug, `pedido/${order.id}`),
          },
        },
      });

      // Não bloqueia o fluxo, mas garante que falhas sejam logadas (evita
      // promise rejections silenciosas que escondiam erros de notificação).
      invokePromise
        .then((res) => {
          if (res.error) {
            console.error(`[WhatsApp][NOTIF] invoke error (${notificationType}):`, res.error);
          } else {
            console.log(`[WhatsApp][NOTIF] invoke ok (${notificationType}):`, res.data);
          }
        })
        .catch((err) => {
          console.error(`[WhatsApp][NOTIF] invoke threw (${notificationType}):`, err);
        });
    } catch (error) {
      console.error("[WhatsApp][NOTIF] Erro:", error);
    }
  };


  const syncDDStatus = async (order: Order, newStatus: string, reason?: string): Promise<{ ok: boolean; errorMsg?: string }> => {
    if (!order.dd_source || !order.dd_order_id) return { ok: true };
    const statusToAction: Record<string, string> = {
      accepted: "accept", preparing: "accept", out_for_delivery: "dispatch",
      ready: "ready", delivered: "deliver", picked_up: "deliver", cancelled: "cancel",
    };
    const ddAction = statusToAction[newStatus];
    if (!ddAction) return { ok: true };
    try {
      const res = await supabase.functions.invoke("dd-order-action", {
        body: { restaurant_id: restaurantId, dd_order_id: order.dd_order_id, action: ddAction, reason: reason || undefined },
      });
      if (res.data?.error) return { ok: false, errorMsg: res.data.error };
      if (res.error) {
        const errMsg = typeof res.error === "object" ? (res.error as any)?.message || JSON.stringify(res.error) : String(res.error);
        return { ok: false, errorMsg: errMsg };
      }
      return { ok: true };
    } catch (e) { return { ok: false, errorMsg: (e as Error).message }; }
  };

  const syncIfoodStatus = async (order: Order, newStatus: string, reason?: string, cancellationCode?: string) => {
    console.log(`[IFOOD_DEBUG] syncIfoodStatus entry order_id=${order.id} current_status=${order.status} next_status=${newStatus} ifood_source=${!!order.ifood_source} ifood_order_id=${order.ifood_order_id ?? "null"} delivery_type=${order.delivery_type ?? "null"} order_type=${order.order_type ?? "null"}`);
    if (!order.ifood_source || !order.ifood_order_id) {
      console.warn(`[IFOOD_DEBUG] SKIPPED order_id=${order.id} reason=not_ifood_or_missing_order_id`);
      return;
    }

    // Compose iFood action sequence based on (current_status, new_status, delivery_type).
    // Cada clique no Kanban iFood pode disparar múltiplos endpoints sequenciais.
    const isDelivery = order.delivery_type === "delivery";
    const cur = order.status;
    let actions: string[] = [];

    if (newStatus === "cancelled") {
      actions = ["cancel"];
    } else if (cur === "pending" && newStatus === "preparing") {
      // Confirmar: confirm + startPreparation
      actions = ["confirm", "start_preparation"];
    } else if (cur === "preparing" && newStatus === "out_for_delivery" && isDelivery) {
      // Pronto (delivery): readyToPickup + dispatch
      actions = ["ready_to_pickup", "dispatch"];
    } else if (cur === "preparing" && newStatus === "ready") {
      // Pronto (pickup/takeaway): readyToPickup
      actions = ["ready_to_pickup"];
    } else if (newStatus === "delivered" || newStatus === "picked_up") {
      // Entregue / Retirado: apenas local, sem endpoint iFood
      actions = [];
    } else {
      // Fallback (transições legadas) — manter mapeamento 1:1 para compatibilidade.
      const legacy: Record<string, string> = {
        accepted: "confirm", preparing: "start_preparation",
        ready: "ready_to_pickup", out_for_delivery: "dispatch",
      };
      if (legacy[newStatus]) actions = [legacy[newStatus]];
    }

    if (actions.length === 0) {
      console.log(`[IFOOD_DEBUG] no iFood endpoint for transition order_id=${order.id} ${cur}->${newStatus}`);
      return;
    }

    for (const ifoodAction of actions) {
      console.log(`[IFOOD_DEBUG] order_id=${order.id} ${cur}->${newStatus} action=${ifoodAction} invoking_ifood_order_action=true`);
      const { data, error } = await supabase.functions.invoke("ifood-order-action", {
        body: { restaurant_id: restaurantId, ifood_order_id: order.ifood_order_id, order_id: order.id, action: ifoodAction, cancellation_code: cancellationCode, reason },
      });
      console.log(`[IFOOD_DEBUG] response order_id=${order.id} action=${ifoodAction} data=${JSON.stringify(data)} error=${error ? JSON.stringify(error) : "null"}`);
      if (error) {
        console.error(`iFood action error (${ifoodAction}):`, error);
        toast.error(`Erro ao sincronizar com iFood (${ifoodAction}), mas o status local será atualizado`);
      }
    }
  };

  const requiresPaymentForFinalization = (order: Order, newStatus: string) => {
    if (order.ifood_source && order.payment_type === "Pago pelo iFood") return false;
    if (order.dd_source && order.payment_type === "Pago Delivery Direto") return false;
    const isLocal = order.order_type === "local" || (!order.order_type && order.table_id);
    if (isLocal) return false;
    return ["delivered", "picked_up"].includes(newStatus);
  };

  const advanceStatus = async (order: Order, newStatus: string, reason?: string, cancellationCode?: string): Promise<boolean> => {
    console.log(`[IFOOD_DEBUG] advanceStatus called order_id=${order.id} current_status=${order.status} next_status=${newStatus} ifood_source=${!!order.ifood_source} ifood_order_id=${order.ifood_order_id ?? "null"} payment_type=${order.payment_type ?? "null"}`);
    if (requiresPaymentForFinalization(order, newStatus) && (!order.payment_type || order.payment_type === "pending")) {
      console.warn(`[IFOOD_DEBUG] BLOCKED order_id=${order.id} reason=requires_payment next_status=${newStatus} payment_type=${order.payment_type ?? "null"}`);
      toast.error("Defina a forma de pagamento antes de finalizar o pedido");
      return false;
    }

    setLoadingOrderId(order.id);
    try {
      await syncIfoodStatus(order, newStatus, reason, cancellationCode);

      const ddResult = await syncDDStatus(order, newStatus, reason);
      if (!ddResult.ok) {
        toast.error(`Delivery Direto: ${ddResult.errorMsg || "Erro ao sincronizar"}`);
        return false;
      }

      const { error } = await supabase.rpc("admin_update_order_status", { p_order_id: order.id, p_new_status: newStatus, p_restaurant_id: restaurantId });
      if (error) throw error;

      if (newStatus === "cancelled" && reason) {
        await supabase.from("orders").update({ cancellation_reason: reason }).eq("id", order.id);
      }

      // WhatsApp notification via unified engine (fire-and-forget)
      sendWhatsAppNotification(order, newStatus, reason);

      // ---------- Efeitos de ACEITAR o pedido ----------
      // Clicar em "Aceitar" num pedido pendente manda ele direto para
      // "preparing", não para "accepted" (ver getNextStatus: aceitar e entrar em
      // preparo são um único passo). A condição aqui olhava só "accepted", então
      // o botão Aceitar NÃO ocupava a mesa e NÃO imprimia — só o aceite
      // automático, que passa "accepted" explicitamente, funcionava.
      //
      // Exigir que o pedido ESTAVA em "pending" é o que evita repetir os efeitos
      // quando um pedido já aceito avança para "preparing" (transição que existe
      // no fallback de `case "accepted"`).
      const estaAceitandoPedido =
        order.status === "pending" &&
        (newStatus === "accepted" || newStatus === "preparing");

      if (estaAceitandoPedido) {
        if (order.order_type === "local" && order.table_id) {
          await supabase.from("tables").update({ is_occupied: true, occupied_at: new Date().toISOString(), occupied_by: order.customer_name }).eq("id", order.table_id);
        }
        try {
          const { data: printerConfig, error: printerErr } = await supabase
            .from("printer_settings")
            .select("auto_print_orders")
            .eq("restaurant_id", restaurantId)
            .maybeSingle();

          if (printerErr) {
            // Não dá para distinguir "desligado" de "não consegui ler" em
            // silêncio: se a leitura falha, o operador precisa saber, senão fica
            // esperando um cupom que nunca vem.
            console.error("[auto-print] falha ao ler auto_print_orders:", printerErr);
            toast.error("Não foi possível verificar a impressão automática", {
              description: "O pedido foi aceito, mas o cupom não saiu. Imprima manualmente.",
              duration: 8000,
            });
          } else if (printerConfig?.auto_print_orders) {
            // showToasts: true — o sucesso continua silencioso (printDocument não
            // avisa quando dá certo), mas a falha aparece. Antes era `false`, o
            // que escondia "nenhuma impressora configurada" e "QZ Tray fechado":
            // a impressão simplesmente não acontecia, sem nenhum aviso.
            await printDocument(order as any, restaurantId, { showToasts: true });
          }
        } catch (printErr) {
          console.error("[auto-print] erro inesperado:", printErr);
          toast.error("Erro na impressão automática", {
            description: printErr instanceof Error ? printErr.message : String(printErr),
            duration: 8000,
          });
        }
      }

      // Marketing trigger + review request on finalization
      if (newStatus === "delivered" || newStatus === "picked_up") {
        supabase.functions.invoke("marketing-trigger", { body: { orderId: order.id, restaurantId } });

        let phone: string | null = order.delivery_phone?.trim() || null;
        if (!phone && order.customer_cpf) {
          const { data: customer } = await supabase
            .from("customers")
            .select("phone")
            .eq("restaurant_id", restaurantId)
            .eq("cpf", order.customer_cpf)
            .maybeSingle();
          phone = customer?.phone?.trim() || null;
        }
        if (!phone && order.customer_name) {
          const { data: customer } = await supabase
            .from("customers")
            .select("phone")
            .eq("restaurant_id", restaurantId)
            .ilike("name", order.customer_name.trim())
            .not("phone", "is", null)
            .limit(1)
            .maybeSingle();
          phone = customer?.phone?.trim() || null;
        }

        if (phone) {
          const slug = await getRestaurantSlug();
          console.log(`[WhatsApp][NOTIF] Disparando order_delivered para pedido ${order.id.slice(0, 8)} (phone=${phone})`);
          supabase.functions.invoke("whatsapp-notifications", {
            body: {
              restaurant_id: restaurantId,
              notification_type: "order_delivered",
              context: {
                nome: order.customer_name || "Cliente",
                numero_pedido: order.id.slice(0, 8),
                order_id: order.id,
                phone,
                link_avaliacao: buildPublicUrl(slug, `pedido/${order.id}`),
              },
            },
          })
            .then((res) => {
              if (res.error) console.error("[WhatsApp][NOTIF] order_delivered error:", res.error);
              else console.log("[WhatsApp][NOTIF] order_delivered ok:", res.data);
            })
            .catch((err) => console.error("[WhatsApp][NOTIF] order_delivered threw:", err));
        } else {
          console.warn(
            `[WhatsApp][NOTIF] Pedido ${order.id.slice(0, 8)} finalizado sem telefone — order_delivered não enviada.`
          );
        }
      }


      toast.success("Status atualizado!");
      return true;
    } catch (error) {
      console.error("Erro ao atualizar status:", error);
      toast.error("Erro ao atualizar status");
      return false;
    } finally {
      setLoadingOrderId(null);
    }
  };

  return { advanceStatus, loadingOrderId, getNextStatus };
}

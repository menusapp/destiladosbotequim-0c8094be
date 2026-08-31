import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Canais de broadcast persistentes por restaurante.
 *
 * Antes, cada notificação criava um canal, esperava o SUBSCRIBED (até 1.5s de
 * timeout) e o destruía — atrasando toda edição de pedido. Agora o canal é
 * criado uma única vez por restaurante e reutilizado, então o envio é imediato.
 */
const channels = new Map<string, { channel: RealtimeChannel; ready: Promise<void> }>();

function getChannel(restaurantId: string) {
  const existing = channels.get(restaurantId);
  if (existing) return existing;

  const channel = supabase.channel(`order-modifications-${restaurantId}`, {
    config: { broadcast: { self: false } },
  });

  const ready = new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
      if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        // Permite recriar o canal na próxima chamada
        channels.delete(restaurantId);
        resolve();
      }
    });
    setTimeout(() => resolve(), 1500);
  });

  const entry = { channel, ready };
  channels.set(restaurantId, entry);
  return entry;
}

/**
 * Broadcasts a "order-modified" event so other admin sessions receive a
 * "Pedido alterado" notification. Used when items are added or removed
 * from an existing order via PDV/admin flows.
 */
export async function broadcastOrderModified(params: {
  restaurantId: string;
  orderId: string;
  action: "item_added" | "item_removed";
}) {
  try {
    const actorId =
      localStorage.getItem("staff_id") ||
      localStorage.getItem("restaurant_id") ||
      "unknown";

    const { channel, ready } = getChannel(params.restaurantId);
    await ready;

    await channel.send({
      type: "broadcast",
      event: "order-modified",
      payload: {
        orderId: params.orderId,
        action: params.action,
        actorId,
        at: Date.now(),
      },
    });
  } catch (e) {
    // Non-blocking — notifications are best-effort
    console.warn("broadcastOrderModified failed:", e);
  }
}

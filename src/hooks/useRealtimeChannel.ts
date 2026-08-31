import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

type PostgresEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

interface RealtimeBinding {
  table: string;
  event?: PostgresEvent;
  schema?: string;
  filter?: string;
  /**
   * Optional callback that receives the raw payload. If omitted, only the
   * shared debounced handler is invoked.
   */
  onEvent?: (payload: any) => void;
}

interface UseRealtimeChannelOptions {
  /** Unique channel identifier — must include any restaurant/entity scope to avoid collisions. */
  channelName: string;
  /** Bindings to register on the channel. */
  bindings: RealtimeBinding[];
  /**
   * Debounced handler called after `debounceMs` of silence across all bindings.
   * Use this for refetch coalescing.
   */
  onChange?: () => void;
  /** Debounce window in ms (default 300). */
  debounceMs?: number;
  /** Whether the channel should be active. Use for conditional subscriptions. */
  enabled?: boolean;
  /**
   * Intervalo do polling de fallback em ms (default 12000). Use valores
   * menores (5000-6000) apenas em telas operacionais críticas (PDV, mesas)
   * e 0 para desligar o polling quando o Realtime já basta.
   */
  pollMs?: number;
}

/**
 * Centralized realtime channel hook.
 *
 * Goals:
 *  - Ensure unique channel names (caller is responsible for scoping).
 *  - Always cleanup the channel and pending debounce timer on unmount.
 *  - Coalesce bursts of postgres_changes events into a single refetch via debouncing.
 *  - Provide a stable, typed API so all realtime usage looks the same across the app.
 *
 * Usage:
 *   useRealtimeChannel({
 *     channelName: `pdv-tables-${restaurantId}`,
 *     bindings: [
 *       { table: "tables", filter: `restaurant_id=eq.${restaurantId}` },
 *       { table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
 *     ],
 *     onChange: () => refetch(),
 *     debounceMs: 300,
 *   });
 */
export function useRealtimeChannel({
  channelName,
  bindings,
  onChange,
  debounceMs = 300,
  enabled = true,
  pollMs = 12000,
}: UseRealtimeChannelOptions) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Bindings change reference often; we serialize to detect real changes.
  const bindingsKey = JSON.stringify(
    bindings.map((b) => ({ t: b.table, e: b.event ?? "*", s: b.schema ?? "public", f: b.filter ?? null }))
  );

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const fireDebounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!cancelled) onChangeRef.current?.();
      }, debounceMs);
    };

    let channel: RealtimeChannel = supabase.channel(channelName);

    bindings.forEach((b) => {
      const filterCfg: any = {
        event: b.event ?? "*",
        schema: b.schema ?? "public",
        table: b.table,
      };
      if (b.filter) filterCfg.filter = b.filter;

      channel = channel.on("postgres_changes", filterCfg, (payload) => {
        b.onEvent?.(payload);
        fireDebounced();
      });
    });

    channel.subscribe();

    // Fallback por POLLING: no modelo de sessão no servidor, o token não vai
    // no websocket, então o Realtime não recebe eventos de tabelas protegidas
    // por RLS. Um refetch periódico garante que o painel se mantenha atualizado
    // (independente de o Realtime entregar ou não os eventos).
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    if (onChangeRef.current && pollMs > 0) {
      pollTimer = setInterval(() => {
        if (!cancelled && document.visibilityState === "visible") {
          onChangeRef.current?.();
        }
      }, pollMs);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (pollTimer) clearInterval(pollTimer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, bindingsKey, debounceMs, enabled]);
}

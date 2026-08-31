import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export type RealtimeStatus = "connected" | "reconnecting" | "disconnected";

/**
 * Monitora o estado REAL da conexão: combina o status da rede do navegador
 * com o status de um canal "sentinela" do Supabase Realtime. Antes o hook
 * só olhava `navigator.onLine`, então mostrava "Online" mesmo com o websocket
 * caído (fonte de confusão quando o painel parava de atualizar).
 */
export function useRealtimeStatus() {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [socket, setSocket] = useState<RealtimeStatus>("reconnecting");
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, []);

  useEffect(() => {
    const channel = supabase.channel(`rt-sentinel-${Math.random().toString(36).slice(2)}`);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setSocket("connected");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setSocket("reconnecting");
      } else if (status === "CLOSED") {
        setSocket("disconnected");
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (!online) return "disconnected" as RealtimeStatus;
  return socket;
}

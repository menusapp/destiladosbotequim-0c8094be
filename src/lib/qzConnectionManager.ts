/**
 * Gerenciador central de conexão com o QZ Tray.
 *
 * Objetivo: ter UM ÚNICO ponto que controla connect/disconnect/reconnect,
 * evitando que cada componente chame `qz.websocket.connect()` por conta própria
 * (o que causava popups duplicados, conexões concorrentes e leaks).
 *
 * Características:
 * - `ensureQzConnected()` é idempotente: se já está conectado, retorna na hora.
 * - Conexões concorrentes compartilham a MESMA Promise (in-flight dedup).
 * - Retry curto e controlado (3 tentativas, backoff progressivo).
 * - Reconnect invisível: ao detectar queda, apenas marca o estado; a próxima
 *   chamada de impressão reabre a conexão automaticamente.
 * - NÃO conecta automaticamente no boot — só quando alguém chama `ensure...`.
 * - Configura signing (RSA-SHA512) uma única vez antes da 1ª conexão.
 */

import qz from "qz-tray";
import { setupQzSigning } from "@/lib/qzSigning";

export type QzStatus = "disconnected" | "connecting" | "connected" | "error";

type Listener = (status: QzStatus) => void;

interface ConnectOptions {
  /** Tempo máximo (ms) por tentativa. Default 5000. */
  timeoutMs?: number;
  /** Quantidade de tentativas. Default 3. */
  retries?: number;
}

let status: QzStatus = "disconnected";
let inFlight: Promise<void> | null = null;
let listenersAttached = false;
const listeners = new Set<Listener>();

function setStatus(next: QzStatus) {
  if (status === next) return;
  status = next;
  console.log(`🔌 [QZ Manager] status → ${next}`);
  listeners.forEach((l) => {
    try {
      l(next);
    } catch {
      // ignore listener errors
    }
  });
}

/** Registra listeners do WS apenas UMA vez (evita duplicação). */
function attachWsListenersOnce() {
  if (listenersAttached) return;
  listenersAttached = true;
  try {
    qz.websocket.setClosedCallbacks(() => {
      console.warn("🔌 [QZ Manager] conexão caiu (closed callback)");
      setStatus("disconnected");
    });
    qz.websocket.setErrorCallbacks((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("🔌 [QZ Manager] erro no socket:", msg);
      setStatus("error");
    });
  } catch (e) {
    // Versões antigas do SDK podem não expor essas APIs — não é crítico.
    console.warn("[QZ Manager] não foi possível registrar callbacks de WS:", e);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Timeout: ${label} demorou mais de ${ms}ms.`)),
      ms,
    );
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function doConnect(opts: Required<ConnectOptions>): Promise<void> {
  await setupQzSigning();
  attachWsListenersOnce();

  // Já conectado? nada a fazer.
  if (qz.websocket.isActive()) {
    setStatus("connected");
    return;
  }

  setStatus("connecting");
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= opts.retries; attempt++) {
    try {
      console.log(
        `🔌 [QZ Manager] tentativa ${attempt}/${opts.retries} de conexão…`,
      );
      await withTimeout(
        qz.websocket.connect(),
        opts.timeoutMs,
        "conexão com QZ Tray",
      );
      setStatus("connected");
      console.log("✅ [QZ Manager] conectado.");
      return;
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `⚠️ [QZ Manager] tentativa ${attempt} falhou: ${msg}`,
      );
      if (attempt < opts.retries) {
        // backoff curto: 300ms, 800ms…
        await sleep(attempt === 1 ? 300 : 800);
      }
    }
  }

  setStatus("error");
  throw lastError instanceof Error
    ? lastError
    : new Error("Falha ao conectar ao QZ Tray");
}

/**
 * Garante que existe uma conexão ativa com o QZ Tray.
 * - Idempotente: chamadas concorrentes compartilham a MESMA Promise.
 * - Faz reconnect automático e invisível se a conexão caiu.
 */
export function ensureQzConnected(options: ConnectOptions = {}): Promise<void> {
  const opts: Required<ConnectOptions> = {
    timeoutMs: options.timeoutMs ?? 5000,
    retries: options.retries ?? 3,
  };

  void setupQzSigning(); // doConnect aguarda; aqui é só adiantar
  attachWsListenersOnce();

  // Se o socket já está ativo, reaproveita a conexão existente mesmo que o
  // status interno esteja desatualizado.
  if (qz.websocket.isActive()) {
    if (status !== "connected") {
      console.log("ℹ️ [QZ Manager] socket já ativo; sincronizando status sem reconectar.");
    } else {
      console.log("ℹ️ [QZ Manager] já conectado; reutilizando conexão ativa.");
    }
    setStatus("connected");
    return Promise.resolve();
  }

  // Se há uma tentativa em andamento, retorna a MESMA promise (dedup).
  if (inFlight) {
    console.log("⏳ [QZ Manager] conexão já em andamento; reutilizando promise existente.");
    return inFlight;
  }

  console.log("🔄 [QZ Manager] conexão necessária; iniciando ensureQzConnected().");
  inFlight = doConnect(opts).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Status atual sincrônico. */
export function getQzStatus(): QzStatus {
  // Se o socket caiu sem disparar o callback, normaliza aqui.
  if (status === "connected" && !qz.websocket.isActive()) {
    setStatus("disconnected");
  }
  return status;
}

/** Inscreve listener de mudança de status. Retorna função de unsubscribe. */
export function subscribeQzStatus(listener: Listener): () => void {
  listeners.add(listener);
  // Dispara estado atual imediatamente.
  try {
    listener(status);
  } catch {
    // ignore
  }
  return () => listeners.delete(listener);
}

/** Desconecta explicitamente (uso raro — testes/onboarding). */
export async function disconnectQz(): Promise<void> {
  try {
    if (qz.websocket.isActive()) {
      await qz.websocket.disconnect();
      console.log("🔌 [QZ Manager] desconectado manualmente.");
    }
  } catch (e) {
    console.warn("[QZ Manager] erro ao desconectar:", e);
  } finally {
    setStatus("disconnected");
  }
}

// Helpers para debug rápido no DevTools.
if (typeof window !== "undefined") {
  (window as any).qzManager = {
    ensure: ensureQzConnected,
    status: getQzStatus,
    disconnect: disconnectQz,
  };
}

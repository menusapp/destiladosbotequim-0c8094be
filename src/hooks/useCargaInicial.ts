import { useRef } from "react";

/**
 * Separa a PRIMEIRA carga de dados de uma tela dos refetches em segundo plano.
 *
 * PROBLEMA QUE ESTE HOOK RESOLVE
 * ------------------------------
 * As telas do painel se atualizam sozinhas de duas formas: pelo Realtime
 * (`useRealtimeChannel`) e por um polling de fallback (`usePolling`) — porque o
 * token de sessão não trafega no websocket e eventos de tabelas sob RLS não
 * chegam. Só que as funções de busca faziam `setLoading(true)` em TODA chamada,
 * e o render é `if (loading) return <Carregando…/>`. A cada ciclo de polling a
 * tela inteira era substituída pelo placeholder e remontada — o "flick" que o
 * operador vê de tempo em tempo, mesmo sem nada ter mudado.
 *
 * A atualização continua acontecendo no mesmo ritmo; o que muda é que ela passa
 * a ser silenciosa: o React apenas recalcula a lista já renderizada.
 *
 * COMO USAR
 * ---------
 *   const primeiraCarga = useCargaInicial(`${de.getTime()}-${ate.getTime()}`);
 *
 *   const fetchOrders = async () => {
 *     if (primeiraCarga.pendente()) setLoading(true);
 *     const { data } = await supabase.from("orders")…;
 *     setOrders(data ?? []);
 *     primeiraCarga.concluir();
 *     setLoading(false);
 *   };
 *
 * `chave` (opcional) descreve o filtro que justifica mostrar o placeholder de
 * novo — tipicamente o período e os filtros selecionados. Quando ela muda, a
 * próxima busca volta a ser tratada como primeira carga, porque aí o conteúdo
 * em tela realmente não corresponde mais ao que o usuário pediu.
 *
 * Use uma string (comparada por valor). Um objeto montado inline a cada render
 * nunca seria igual ao anterior e o placeholder voltaria a piscar sempre.
 */
export function useCargaInicial(chave?: string) {
  const concluida = useRef(false);
  const chaveAnterior = useRef<string | undefined>(chave);

  if (chaveAnterior.current !== chave) {
    chaveAnterior.current = chave;
    concluida.current = false;
  }

  // O objeto é criado UMA vez e reutilizado: ele entra em listas de dependências
  // de useCallback/useEffect nos chamadores, e um objeto novo por render
  // recriaria esses callbacks a cada ciclo.
  const api = useRef<{ pendente: () => boolean; concluir: () => void }>();
  if (!api.current) {
    api.current = {
      /** true enquanto a primeira carga (desta `chave`) ainda não terminou. */
      pendente: () => !concluida.current,
      /** Marca a carga como concluída: as próximas são silenciosas. */
      concluir: () => {
        concluida.current = true;
      },
    };
  }
  return api.current;
}

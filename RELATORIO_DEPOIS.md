# RELATÓRIO DEPOIS — Destilado's Botequim App

Data: 31/08/2026 (manhã, antes da abertura)

## Resumo executivo

Foco desta rodada: **Fase 0 (baseline)**, **Fase 1 (Realtime)** e itens rápidos da Fase 4.
Status geral: **pronto para abrir com ressalvas** — build limpo, zero erros de TypeScript, painel
admin validado ponta a ponta no navegador (login restaurante → login funcionário → dashboard,
sem erros de console). As Fases 2, 3 e 5 (checklist funcional completo) ficaram como
recomendação, ver "Riscos residuais".

## Comparativo objetivo

| Métrica | Antes | Depois |
|---|---|---|
| Tempo de build (vite build) | 37,2 s | 34,4 s |
| Tamanho do `dist/` | 8,6 MB | 8,6 MB |
| Maior chunk | `vendor-charts` 390 KB (gzip 100 KB) | igual |
| Erros TypeScript (`tsgo --noEmit`) | 0 | 0 |
| Canais Realtime + pollers numa sessão típica de admin (PDV + Mesas) | 2 canais + 3 timers (canal PDV + `usePolling` 12 s + canal da mesa) | 2 canais + 2 timers (um poller por canal, 6 s) |
| Intervalo do fallback de polling | fixo 12 s em todas as telas | configurável (`pollMs`); 6 s no PDV/Mesas, 12 s no resto |
| Indicador "Online" no painel | só refletia `navigator.onLine` | reflete rede **+** status real do socket Realtime |
| Latência de `broadcastOrderModified` | até 1,5 s por edição (canal criado/destruído a cada envio) | ~imediato (canal persistente por restaurante) |

Observação: o codebase tinha menos canais soltos do que o relatório inicial indicava — apenas
`PDVTab.tsx`, `TableDetailDialog.tsx` e `Menu.tsx` (cardápio público) chamavam `supabase.channel`
diretamente. Os demais arquivos citados já usavam o hook central.

## Correções aplicadas

1. **`src/hooks/useRealtimeChannel.ts`** — o polling de fallback era fixo em 12 s e não podia ser
   desligado, o que atrasava telas operacionais e sobrecarregava telas frias. Adicionado o
   parâmetro `pollMs` (default 12000, `0` desliga), incluído nas dependências do efeito.
   Validação: build + typecheck limpos; painel carrega e atualiza.
2. **`src/components/admin/PDVTab.tsx`** — havia dois mecanismos concorrentes (canal próprio +
   `usePolling` de 12 s), dobrando requisições e mantendo dois timers. Consolidado num único
   `useRealtimeChannel` com `pollMs: 6000` e handlers memoizados (`useCallback`), com pausa
   automática quando a aba não está visível. Validação: painel/PDV abrem sem erro de console.
3. **`src/components/admin/TableDetailDialog.tsx`** — canal manual com três timers próprios e
   cleanup replicado. Migrado para o hook central (canal único, cleanup garantido, `pollMs: 6000`,
   habilitado só com o dialog aberto).
4. **`src/hooks/useRealtimeStatus.ts`** — mostrava "Online" mesmo com o websocket caído, porque só
   observava `navigator.onLine`. Agora combina o status de rede com um canal sentinela
   (`SUBSCRIBED` / `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED`). Validação: indicador exibiu "Online"
   corretamente após o socket subscrever no teste de navegador.
5. **`src/lib/broadcastOrderModified.ts`** — criava e destruía um canal a cada notificação,
   esperando o `SUBSCRIBED` (timeout de 1,5 s). Agora usa canal persistente por `restaurantId`,
   recriado apenas se o canal fechar/errar.
6. **`.gitignore`** — `.env` não estava ignorado. Adicionados `.env` e `.env.local` por higiene.

## Riscos residuais / ficou para depois

- **Fase 2 (any/console/RLS runbook)**: 0 erros de TS hoje; a limpeza de `as any`, auditoria dos
  271 `console.error` e a reconferência linha a linha do `SECURITY_HARDENING_RUNBOOK.md` ficam para
  o próximo ciclo — nenhuma delas afeta o funcionamento de hoje à noite.
- **Fase 3 (split de componentes gigantes, virtualização, N+1)**: não executada — risco alto na
  véspera, exatamente como o próprio prompt recomenda. Nenhum chunk passa do limite de 600 KB.
- **Fase 5 (checklist funcional completo)**: validado apenas o login em duas etapas e o carregamento
  do painel admin. Fluxos de cliente, comanda por QR, kiosk, impressão QZ, Mercado Pago, iFood e
  WhatsApp precisam de teste manual com dados reais e dispositivos reais antes da abertura.
- **Publicação**: o publish automático continua bloqueado por findings críticos de RLS
  (`bills`, `card_fees_config`, policies `zz_temp_anon_*`). Publicar por **Publish → Update**.

## Rollback

Todas as mudanças desta rodada são **somente de frontend** — nenhuma migration foi criada ou
aplicada. Para reverter, basta reverter os commits que tocam:
`src/hooks/useRealtimeChannel.ts`, `src/hooks/useRealtimeStatus.ts`,
`src/lib/broadcastOrderModified.ts`, `src/components/admin/PDVTab.tsx`,
`src/components/admin/TableDetailDialog.tsx`, `.gitignore`.

Migrations anteriores (session auth `20260723010000`, `fix_order_items_rls_insert`,
`reschedule_crons_correct_project`, seeds de notificação) **não devem ser revertidas** — já há
dados/sessões gravados dependendo delas.

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

---

## Fase 4 + Fase 5 — Segurança e checklist funcional (execução final)

### Segurança: 18 → 7 achados (0 erros críticos de exposição de dados)

| Correção | Resultado |
|---|---|
| `card_fees`, `card_fees_config`, `operational_costs`, `remarketing_lists`, `order_item_splits`, `counter_order_item_extras` | políticas "allow all" removidas; agora escopadas por `current_restaurant_id()` |
| `bills`, `card_fees_config` (preocupação levantada) | **verificado por requisição real com a chave pública: retorna `[]`** |
| `customer_sessions` | escrita anônima removida → RPC `track_customer_session` |
| `coupons.used_count` | RPC `increment_coupon_usage` (não dá mais para editar desconto/limite pelo navegador) |
| `customers.phone` | RPC `set_customer_phone_if_empty` (só preenche quando vazio) |
| `loyalty_points` | escrita anônima removida (fraude de pontos fechada) |
| `comandas` UPDATE anônimo | removido (só a equipe altera) |
| `orders` UPDATE anônimo | removido; substituído pela RPC `finalize_order_payment` (pedido recente e não pago) + gatilho que congela CPF, nome, restaurante, desconto e motivo de cancelamento para quem não é equipe |
| `restaurant_staff` / `restaurant_credentials` | `password_hash` deixou de ser legível pela API (verificado: HTTP 401) |
| `customer_addresses` / `customer_cards` | escrita direta anônima removida (RPCs) |

**Bug real encontrado no caminho:** o `UPDATE` de pedido pelo cliente (checkout online e totem) estava falhando **silenciosamente** — sem política de leitura anônima, o `UPDATE ... WHERE id = ...` não encontrava a linha e o PostgREST devolvia 204 sem alterar nada. Ou seja, pagamento do totem/checkout online não persistia. Corrigido com a RPC `finalize_order_payment` (testado: pagamento grava, segunda tentativa retorna `false`).

### Pendências de segurança conhecidas (não bloqueiam hoje)

- `restaurants` expõe CNPJ / razão social / endereço fiscal para leitura pública. Restringir por coluna **quebra os painéis**, porque admin e CEO também usam o papel `anon` com token de sessão. Correção correta = mover os campos fiscais para tabela separada com política de equipe — refatoração pós-abertura.
- `zz_temp_anon_insert` ainda aberto em `customers`, `comandas`, `bills`, `reservations`, `online_payments`, `restaurant_reviews` — necessário para o fluxo de cliente sem login; mitigação futura = amarrar ao token de sessão do cliente.
- Avisos do linter sobre funções `SECURITY DEFINER` executáveis: são as próprias RPCs do fluxo de cliente, intencionais.

### Fase 5 — Checklist funcional (testado no navegador e via API)

| Item | Status |
|---|---|
| Cardápio `/destilado-botequim` | OK — 0 erro de console, 0 erro HTTP |
| Mesa via QR `/mesa/1` | OK (5 mesas foram cadastradas — antes não existia nenhuma) |
| Comanda `/comanda/1` | OK |
| Totem `/kiosk` | OK (só um warning cosmético de estilo) |
| Reservas | OK — exibe "indisponível" porque reservas estão desligadas |
| Criar pedido + itens como cliente anônimo | OK (201/201, item vinculado) |
| Salvar endereço de entrega | OK (RPC retorna o id) |
| Registrar pagamento (checkout/totem) | OK após a correção |
| Login restaurante + funcionário | OK — painel carrega sem erro |
| Equipe avançar status e editar pedido | OK (o gatilho novo não atrapalha a equipe) |
| Build / TypeScript | build OK, 0 erro |

### Verificado na configuração (atenção antes de abrir)

- **Horário: segunda-feira está marcada como fechada.** Enquanto isso não mudar, o cardápio mostra "Restaurante fechado" e não aceita pedido.
- Mercado Pago / pagamento online: **sem configuração** (`online_payment_config` vazio) → só pagamento presencial.
- iFood: **sem configuração** para este restaurante.
- WhatsApp: habilitado, instância `rest-destilado-botequim`.
- Impressora: 80mm, saída PDF configurada.
- Formas de pagamento ativas: Dinheiro, Crédito, Débito, Pix, Vale Refeição.
- 5 produtos disponíveis no cardápio.

### Não testável aqui
QZ Tray (impressão exige o agente instalado na máquina do caixa) e cobrança real no Mercado Pago Point (exige terminal físico).

#!/usr/bin/env bash
#
# Mede o custo real de um pedido neste sistema e projeta contra o plano
# grátis do Supabase.
#
#   SUPABASE_DB_URL='postgresql://...' ./scripts/simular-carga.sh [N] [pedidos/dia]
#   SUPABASE_DB_URL='postgresql://...' ./scripts/simular-carga.sh --limpar
#
# N            quantos pedidos simular agora (padrão 20)
# pedidos/dia  volume esperado em produção, para a projeção (padrão 20)
#
# Cria um restaurante de teste (slug zz-simulacao-carga). Nenhum dado real é
# tocado. `--limpar` apaga o restaurante de teste e tudo que veio junto.
set -euo pipefail

BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
cd "$(dirname "$0")/.."

[ -n "${SUPABASE_DB_URL:-}" ] || { echo "${RED}erro:${RESET} defina SUPABASE_DB_URL" >&2; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "${RED}erro:${RESET} psql não encontrado" >&2; exit 1; }

q() { psql "$SUPABASE_DB_URL" -tAqc "$1"; }

# ── limpeza ──────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--limpar" ]; then
  echo "Removendo o restaurante de simulação..."
  q "DELETE FROM public.restaurants WHERE slug = 'zz-simulacao-carga';" >/dev/null
  q "VACUUM FULL;" >/dev/null 2>&1 || true
  echo "${GREEN}Limpo.${RESET}"
  exit 0
fi

N="${1:-20}"
POR_DIA="${2:-20}"

# Chamadas de edge function por pedido, contadas no código do app:
# 3 avanços de status × whatsapp-notifications (useOrderStatusAdvance.ts).
# Ajuste se você desligar as notificações.
FN_POR_PEDIDO=3

# Limites do plano grátis (confira em supabase.com/pricing — mudam).
FREE_DB_MB=500
FREE_FN_MES=500000

tamanho() { q "SELECT coalesce(sum(pg_total_relation_size(c.oid)),0) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r';"; }
linhas()  { q "SELECT coalesce(sum(n_live_tup),0) FROM pg_stat_user_tables WHERE schemaname='public';"; }

echo "${BOLD}Simulando $N pedidos completos${RESET}"
echo "  (itens, complementos, baixa de estoque, caixa, numeração e ciclo de status)"
echo "  Use N >= 100 para uma média estável."
echo

# Aquecimento: numa base zerada, a primeira leva paga a alocação de páginas e
# índices de dezenas de tabelas, o que infla o custo por pedido em ~10x. Uma
# leva descartada antes da medição faz o número reportado ser o MARGINAL — que
# é o que interessa para projetar crescimento.
echo "  aquecendo (leva descartada)..."
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q \
  -c "SET sim.pedidos = '20';" -f scripts/simular-carga.sql >/dev/null

q "VACUUM ANALYZE;" >/dev/null 2>&1 || true
ANTES_B=$(tamanho); ANTES_L=$(linhas)

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q \
  -c "SET sim.pedidos = '$N';" -f scripts/simular-carga.sql

q "VACUUM ANALYZE;" >/dev/null 2>&1 || true
DEPOIS_B=$(tamanho); DEPOIS_L=$(linhas)

DELTA_B=$(( DEPOIS_B - ANTES_B ))
DELTA_L=$(( DEPOIS_L - ANTES_L ))

echo
echo "${BOLD}Onde os dados foram parar${RESET}"
psql "$SUPABASE_DB_URL" -P pager=off -c "
  SELECT relname AS tabela, n_live_tup AS linhas,
         pg_size_pretty(pg_total_relation_size(relid)) AS tamanho
  FROM pg_stat_user_tables
  WHERE schemaname='public'
    AND relname IN ('orders','order_items','order_item_extras','stock_movements',
                    'cash_movements','tables','customers','bills','comandas')
  ORDER BY pg_total_relation_size(relid) DESC;"

echo "${BOLD}Medição${RESET}"
awk -v n="$N" -v db="$DELTA_B" -v rows="$DELTA_L" -v dia="$POR_DIA" \
    -v fnp="$FN_POR_PEDIDO" -v freedb="$FREE_DB_MB" -v freefn="$FREE_FN_MES" 'BEGIN {
  por_pedido = db / n;
  linhas_por = rows / n;
  printf "  crescimento total          %.1f KB\n", db/1024;
  printf "  por pedido                 %.1f KB  (%.0f linhas)\n", por_pedido/1024, linhas_por;
  print "";
  printf "%s\n", "Projeção para " dia " pedidos/dia";
  mes_b  = por_pedido * dia * 30;
  ano_b  = por_pedido * dia * 365;
  printf "  banco por mês              %.1f MB  (%.1f%% dos %d MB do Free)\n", mes_b/1048576, (mes_b/1048576)/freedb*100, freedb;
  printf "  banco por ano              %.0f MB\n", ano_b/1048576;
  printf "  estoura os %d MB em        %.1f anos\n", freedb, (freedb*1048576)/(por_pedido*dia*365);
  print "";
  fn_mes = fnp * dia * 30;
  cron   = 138700;
  printf "  edge functions por mês     %d (pedidos) + %d (cron) = %d\n", fn_mes, cron, fn_mes+cron;
  printf "                             %.1f%% das %d mil do Free\n", (fn_mes+cron)/freefn*100, freefn/1000;
}'

echo
echo "${YELLOW}Para desfazer:${RESET} ./scripts/simular-carga.sh --limpar"

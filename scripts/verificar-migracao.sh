#!/usr/bin/env bash
#
# Confere se o projeto Supabase novo ficou igual ao esperado.
#
#   SUPABASE_DB_URL='postgresql://postgres:SENHA@db.<ref>.supabase.co:5432/postgres' \
#     ./scripts/verificar-migracao.sh
#
# A connection string está em Supabase → Settings → Database → Connection string → URI.
set -euo pipefail

BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
cd "$(dirname "$0")/.."

[ -n "${SUPABASE_DB_URL:-}" ] || { echo "${RED}erro:${RESET} defina SUPABASE_DB_URL (ver cabeçalho do script)" >&2; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "${RED}erro:${RESET} psql não encontrado (apt install postgresql-client)" >&2; exit 1; }

q() { psql "$SUPABASE_DB_URL" -tAc "$1"; }

FAILED=0
check() { # nome, valor_obtido, esperado_minimo
  printf '  %s%*s' "$1" $(( 46 - ${#1} )) ""   # ${#1} conta caracteres, não bytes (acentos)
  if [ "${2:-0}" -ge "$3" ] 2>/dev/null; then echo "${GREEN}ok${RESET} ($2)"
  else echo "${RED}FALHOU${RESET} (obtido: ${2:-nada}, esperado ≥ $3)"; FAILED=$((FAILED+1)); fi
}

echo "${BOLD}Estrutura do banco${RESET}"
check "tabelas em public"          "$(q "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"                    85
check "funções em public"          "$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'")" 130
check "policies RLS"               "$(q "SELECT count(*) FROM pg_policies WHERE schemaname='public'")"                  100
check "buckets de storage"         "$(q "SELECT count(*) FROM storage.buckets")"                                         5
check "cron jobs agendados"        "$(q "SELECT count(*) FROM cron.job")"                                                4

echo
echo "${BOLD}Tabelas que faltavam no histórico${RESET}"
check "deliverydireto_config"      "$(q "SELECT count(*) FROM information_schema.tables WHERE table_name='deliverydireto_config'")" 1

echo
echo "${BOLD}Cron jobs apontando para o projeto certo${RESET}"
BASE="$(q "SELECT coalesce(value,'') FROM public.app_runtime_config WHERE key='edge_base_url'")"
if [ -z "$BASE" ]; then
  echo "  ${RED}FALHOU${RESET}  app_runtime_config.edge_base_url está vazio."
  echo "          Rode:  SELECT public.set_app_runtime_config('https://<ref>.supabase.co', '<publishable key>');"
  echo "          Sem isso nenhum agendamento dispara."
  FAILED=$((FAILED+1))
else
  echo "  ${GREEN}ok${RESET}      $BASE"
fi

LEFTOVER="$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND prosrc ILIKE '%ksscrxwvslddfqxjxzlo%'")"
if [ "$LEFTOVER" != "0" ]; then
  echo "  ${YELLOW}!${RESET}       $LEFTOVER função(ões) ainda citam o projeto do Lovable"
fi

echo
if [ "$FAILED" -eq 0 ]; then echo "${GREEN}${BOLD}Tudo certo.${RESET}"; else echo "${RED}${BOLD}$FAILED verificação(ões) falharam.${RESET}"; exit 1; fi

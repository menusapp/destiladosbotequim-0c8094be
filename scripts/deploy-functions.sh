#!/usr/bin/env bash
#
# Deploy das edge functions.
#
#   ./scripts/deploy-functions.sh                 # todas
#   ./scripts/deploy-functions.sh whatsapp-send   # só uma (ou algumas)
#
# As configurações de verify_jwt vêm do supabase/config.toml — não passe
# --no-verify-jwt na mão, senão o que está declarado lá é ignorado.
set -euo pipefail

BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
cd "$(dirname "$0")/.."

command -v supabase >/dev/null 2>&1 || { echo "${RED}erro:${RESET} CLI do Supabase não encontrado (npm install -g supabase)" >&2; exit 1; }

if [ $# -gt 0 ]; then
  FUNCTIONS=("$@")
else
  # tudo que é pasta em supabase/functions, menos as que começam com "_"
  # (_shared é código compartilhado, não é uma function)
  mapfile -t FUNCTIONS < <(find supabase/functions -mindepth 1 -maxdepth 1 -type d ! -name '_*' -printf '%f\n' | sort)
fi

echo "${BOLD}Fazendo deploy de ${#FUNCTIONS[@]} function(s)${RESET}"
FAILED=()
for fn in "${FUNCTIONS[@]}"; do
  printf '  %-38s' "$fn"
  if supabase functions deploy "$fn" > /tmp/deploy-"$fn".log 2>&1; then
    echo "${GREEN}ok${RESET}"
  else
    echo "${RED}FALHOU${RESET} (log: /tmp/deploy-$fn.log)"
    FAILED+=("$fn")
  fi
done

if [ ${#FAILED[@]} -gt 0 ]; then
  echo
  echo "${RED}${#FAILED[@]} function(s) falharam:${RESET} ${FAILED[*]}"
  exit 1
fi
echo "${GREEN}Todas no ar.${RESET}"

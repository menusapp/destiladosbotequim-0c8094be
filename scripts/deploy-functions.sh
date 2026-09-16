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

# Resolve como chamar a CLI do Supabase. Instalar ela global via npm não é
# suportado oficialmente, então aceitamos as duas formas: binário no PATH
# (instalado pelo .deb/brew) ou `npx supabase`, que dispensa instalação.
if command -v supabase >/dev/null 2>&1; then
  SUPABASE=(supabase)
elif command -v npx >/dev/null 2>&1; then
  echo "  (usando 'npx supabase' — CLI não está no PATH)"
  SUPABASE=(npx --yes supabase@latest)
else
  echo "erro: nem a CLI do Supabase nem o npx foram encontrados." >&2
  echo "      Instale o Node 20+ e rode de novo, ou instale a CLI:" >&2
  echo "      https://supabase.com/docs/guides/local-development/cli/getting-started" >&2
  exit 1
fi

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
  if "${SUPABASE[@]}" functions deploy "$fn" > /tmp/deploy-"$fn".log 2>&1; then
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

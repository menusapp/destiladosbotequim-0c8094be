#!/usr/bin/env bash
#
# Sobe este sistema num projeto Supabase NOVO (o seu), do zero.
#
#   ./scripts/configurar-supabase.sh <project-ref>
#
# O que faz, em ordem:
#   1. liga o repo ao seu projeto          (supabase link)
#   2. aplica as 217 migrations            ("${SUPABASE[@]}" db push)
#   3. manda os secrets das functions      (supabase secrets set)
#   4. faz deploy das 45 edge functions    (supabase functions deploy)
#   5. aponta os cron jobs para o projeto  (app_runtime_config)
#
# Pode rodar de novo quantas vezes quiser: todos os passos são idempotentes.
set -euo pipefail

BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
info()  { echo "${BOLD}==>${RESET} $*"; }
ok()    { echo "  ${GREEN}✓${RESET} $*"; }
warn()  { echo "  ${YELLOW}!${RESET} $*"; }
die()   { echo "${RED}erro:${RESET} $*" >&2; exit 1; }

cd "$(dirname "$0")/.."

PROJECT_REF="${1:-}"
[ -n "$PROJECT_REF" ] || die "uso: $0 <project-ref>
      O ref está em Supabase → Settings → General → Reference ID
      (é também o pedaço do meio da URL: https://<ref>.supabase.co)"

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

# ── 1. link ──────────────────────────────────────────────────────────────────
info "Ligando o repositório ao projeto $PROJECT_REF"
"${SUPABASE[@]}" link --project-ref "$PROJECT_REF"
ok "projeto ligado"

# ── 2. migrations ────────────────────────────────────────────────────────────
info "Aplicando as migrations (cria tabelas, funções, policies e buckets)"
echo "    Isso vai pedir a senha do banco (Settings → Database → Database password)."
"${SUPABASE[@]}" db push
ok "migrations aplicadas"

# ── 3. secrets ───────────────────────────────────────────────────────────────
if [ -f .env.supabase ]; then
  info "Enviando os secrets das edge functions"
  # A plataforma recusa nomes começando com SUPABASE_ (ela mesma injeta esses).
  TMP_SECRETS="$(mktemp)"; trap 'rm -f "$TMP_SECRETS"' EXIT
  grep -vE '^\s*#' .env.supabase | grep -E '^[A-Z_0-9]+=.+' | grep -vE '^SUPABASE_' > "$TMP_SECRETS" || true
  if [ -s "$TMP_SECRETS" ]; then
    "${SUPABASE[@]}" secrets set --env-file "$TMP_SECRETS"
    ok "$(wc -l < "$TMP_SECRETS") secrets enviados"
  else
    warn ".env.supabase está sem valores preenchidos — pulando"
  fi
else
  warn "sem .env.supabase (copie de .env.supabase.example) — pulando os secrets"
  warn "sem o JWT_SECRET o login da equipe NÃO funciona"
fi

# ── 4. edge functions ────────────────────────────────────────────────────────
info "Fazendo deploy das edge functions"
./scripts/deploy-functions.sh
ok "functions no ar"

# ── 5. cron jobs apontando para este projeto ─────────────────────────────────
info "Apontando os cron jobs para este projeto"
ANON_KEY="${SUPABASE_PUBLISHABLE_KEY:-${SUPABASE_ANON_KEY:-}}"
if [ -z "$ANON_KEY" ] && [ -f .env ]; then
  ANON_KEY="$(grep -E '^VITE_SUPABASE_PUBLISHABLE_KEY=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
fi

SQL="SELECT public.set_app_runtime_config('https://${PROJECT_REF}.supabase.co', '${ANON_KEY}');"

if [ -n "${SUPABASE_DB_URL:-}" ] && command -v psql >/dev/null 2>&1; then
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c "$SQL"
  ok "cron jobs configurados"
else
  warn "não consegui falar com o banco daqui (defina SUPABASE_DB_URL para automatizar)."
  echo
  echo "  ${BOLD}Falta só isto:${RESET} abra o SQL Editor do Supabase e rode:"
  echo
  echo "      $SQL"
  echo
  echo "  Sem isso, os agendamentos (campanhas, carrinho abandonado, gatilho de"
  echo "  ausência, polling do iFood) não disparam."
fi

echo
info "Pronto. Confira tudo com:  ./scripts/verificar-migracao.sh"

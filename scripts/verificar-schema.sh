#!/usr/bin/env bash
#
# Compara o schema do banco com src/integrations/supabase/types.ts.
#
#   SUPABASE_DB_URL='postgresql://...' ./scripts/verificar-schema.sh
#
# Por que isto existe: partes do banco do Lovable foram criadas à mão no
# painel e nunca viraram migration — a tabela deliverydireto_config e as
# colunas orders.dd_source, orders.dd_order_id,
# online_payment_config.mp_pos_id e mp_pos_name. Num projeto novo elas
# faltam, e o sintoma é traiçoeiro: o PostgREST recusa a consulta inteira por
# uma coluna inexistente e a tela fica vazia sem mensagem de erro.
#
# O types.ts é gerado a partir do banco real, então serve de referência do
# que deveria existir. Rode isto depois de qualquer db push.
set -euo pipefail

BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; RESET=$'\033[0m'
cd "$(dirname "$0")/.."

[ -n "${SUPABASE_DB_URL:-}" ] || { echo "${RED}erro:${RESET} defina SUPABASE_DB_URL" >&2; exit 1; }
command -v psql   >/dev/null 2>&1 || { echo "${RED}erro:${RESET} psql não encontrado" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "${RED}erro:${RESET} python3 não encontrado" >&2; exit 1; }

echo "${BOLD}Comparando o banco com types.ts${RESET}"

psql "$SUPABASE_DB_URL" -tAc \
  "SELECT c.relname||'|'||a.attname FROM pg_class c
   JOIN pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
   WHERE n.nspname='public' AND c.relkind IN ('r','v')" > /tmp/schema-real.txt

python3 - <<'PY'
import re, sys

src = open("src/integrations/supabase/types.ts").read()
esperado = {}
for m in re.finditer(r'\n      ([a-z_0-9]+): \{\n        Row: \{\n(.*?)\n        \}\n', src, re.S):
    cols = {lm.group(1) for lm in re.finditer(r'^\s{10}([a-z_0-9]+)(\?)?:\s*(.+?)$', m.group(2), re.M)}
    if cols:
        esperado[m.group(1)] = cols

real = {}
for linha in open("/tmp/schema-real.txt"):
    linha = linha.strip()
    if "|" not in linha:
        continue
    t, c = linha.split("|", 1)
    real.setdefault(t, set()).add(c)

tabelas_faltando = sorted(t for t in esperado if t not in real)
colunas_faltando = sorted(
    (t, c) for t in esperado if t in real for c in sorted(esperado[t] - real[t])
)

if tabelas_faltando:
    print("\n  TABELAS que o types.ts espera e o banco não tem:")
    for t in tabelas_faltando:
        print(f"    \033[31m✗\033[0m {t}")

if colunas_faltando:
    print("\n  COLUNAS que o types.ts espera e o banco não tem:")
    for t, c in colunas_faltando:
        print(f"    \033[31m✗\033[0m {t}.{c}")

if not tabelas_faltando and not colunas_faltando:
    print("\n  \033[32m✓\033[0m banco e types.ts batem — nenhuma divergência")
    sys.exit(0)

print("\n  Cada item acima quebra silenciosamente a tela que o usa:")
print("  o PostgREST recusa o SELECT inteiro e a lista aparece vazia.")
sys.exit(1)
PY

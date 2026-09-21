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

psql "$SUPABASE_DB_URL" -tAc \
  "SELECT DISTINCT p.proname FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'" > /tmp/schema-funcoes.txt

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

# ── funções ──────────────────────────────────────────────────────────────
ini = src.index("    Functions: {")
fim = src.index("\n    Enums: {", ini)
fn_esperadas = set(re.findall(r'^      ([a-z_0-9]+): \{', src[ini:fim], re.M))
# Os nomes *_secured_impl_<oid> são gerados pela blindagem e carregam o OID do
# banco: mudam de projeto para projeto e nunca coincidem. Não são divergência.
fn_esperadas = {f for f in fn_esperadas if "_secured_impl_" not in f}

fn_reais = set()
for linha in open("/tmp/schema-funcoes.txt"):
    if linha.strip():
        fn_reais.add(linha.strip())

funcoes_faltando = sorted(fn_esperadas - fn_reais)
if funcoes_faltando:
    print("\n  FUNÇÕES que o types.ts espera e o banco não tem:")
    for f in funcoes_faltando:
        print(f"    \033[31m✗\033[0m {f}()")

if not tabelas_faltando and not colunas_faltando and not funcoes_faltando:
    print("\n  \033[32m✓\033[0m banco e types.ts batem — nenhuma divergência")
    sys.exit(0)

print("\n  Cada item acima quebra a tela que o usa: coluna ausente faz o")
print("  PostgREST recusar o SELECT inteiro (lista vazia, sem erro), e função")
print("  ausente vira \'Could not find the function ... in the schema cache\'.")
sys.exit(1)
PY

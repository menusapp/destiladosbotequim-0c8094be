#!/usr/bin/env bash
#
# Deploy do Destilado Botequim na VPS.
#
#   cd ~/destilados-erp && ./deploy.sh
#
# O que ele faz, nessa ordem:
#   1. git pull        — aborta se houver conflito ou alteração local pendente
#   2. npm run build   — para uma pasta NOVA (dist.new), sem tocar no que está no ar
#   3. troca as pastas — o site só muda quando o build já terminou com sucesso
#   4. reinicia o serve e CONFIRMA que a porta voltou a responder
#
# Por que buildar em pasta separada: o `vite build` apaga o conteúdo de `dist`
# antes de gerar o novo (emptyOutDir). Como o `serve` lê os arquivos do disco a
# cada requisição, buildar direto em `dist` deixa o sistema quebrado durante o
# build inteiro — e, se o build falhar no meio, quebrado para sempre. Aqui o
# `dist` antigo continua servindo até a troca, que leva milissegundos.
#
# A versão anterior fica em `dist.anterior`, para rollback:
#   rm -rf dist && mv dist.anterior dist && ./deploy.sh --so-reiniciar
#
set -euo pipefail

PORTA=8081
BRANCH=main
PASTA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PASTA"

# Cores só quando a saída é um terminal (não suja log redirecionado).
if [ -t 1 ]; then
  VERDE=$'\033[32m'; VERM=$'\033[31m'; AMAR=$'\033[33m'; ZERO=$'\033[0m'
else
  VERDE=""; VERM=""; AMAR=""; ZERO=""
fi
passo() { printf '%s==>%s %s\n' "$VERDE" "$ZERO" "$1"; }
erro()  { printf '%sERRO:%s %s\n' "$VERM" "$ZERO" "$1" >&2; }
aviso() { printf '%saviso:%s %s\n' "$AMAR" "$ZERO" "$1"; }

SO_REINICIAR=0
[ "${1:-}" = "--so-reiniciar" ] && SO_REINICIAR=1

# Devolve 0 (sucesso) quando alguém está escutando na porta.
porta_ocupada() {
  ss -ltn 2>/dev/null | grep -q ":$PORTA "
}

reiniciar_serve() {
  if ! command -v ss >/dev/null 2>&1; then
    erro "o comando 'ss' não existe nesta máquina (pacote iproute2)."
    erro "Sem ele não consigo confirmar se o servidor subiu — abortando para não"
    erro "deixar o site fora do ar sem aviso."
    exit 1
  fi

  passo "Parando o serve atual"
  # Mata pelo padrão do comando: é o único jeito confiável, já que o PID muda a
  # cada deploy e o processo que aparece no `ss` é um filho do `npx`.
  pkill -f "serve -s dist" 2>/dev/null || true

  # Espera a porta ser liberada de fato. Sem isso o serve novo sobe, encontra a
  # porta ocupada e morre — e o antigo (com o código velho) continua no ar, o
  # que faz o deploy "dar certo" sem mudar nada.
  for _ in $(seq 1 20); do
    porta_ocupada || break
    sleep 0.5
  done
  if porta_ocupada; then
    erro "a porta $PORTA continua ocupada. Veja quem está nela:"
    erro "  ss -ltnp | grep $PORTA"
    exit 1
  fi

  passo "Subindo o serve"
  # setsid desliga o processo da sessão SSH, senão ele morre quando você sai.
  setsid npx serve -s dist -l "$PORTA" > /tmp/serve.log 2>&1 < /dev/null &

  for _ in $(seq 1 30); do
    if porta_ocupada; then
      PID=$(ss -ltnp 2>/dev/null | grep ":$PORTA " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
      passo "No ar na porta $PORTA (pid ${PID:-?})"
      return 0
    fi
    sleep 0.5
  done

  erro "o serve não subiu em 15s. Últimas linhas do log:"
  tail -20 /tmp/serve.log >&2 || true
  exit 1
}

if [ "$SO_REINICIAR" = 1 ]; then
  reiniciar_serve
  exit 0
fi

# ---------------------------------------------------------------- 1. git pull
# Alteração local não commitada faria o pull falhar no meio e deixar a pasta num
# estado misto. Melhor parar antes de mexer em nada.
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  erro "há alterações locais não commitadas nesta pasta."
  erro "Rode 'git status' e resolva antes do deploy."
  exit 1
fi

passo "Baixando o código ($BRANCH)"
ANTES=$(git rev-parse HEAD)
git pull origin "$BRANCH"
DEPOIS=$(git rev-parse HEAD)

if [ "$ANTES" = "$DEPOIS" ]; then
  aviso "nenhum commit novo — vou buildar de novo mesmo assim."
else
  passo "$(git rev-list --count "$ANTES".."$DEPOIS") commit(s) novo(s):"
  git log --oneline "$ANTES".."$DEPOIS"
fi

# ---------------------------------------------------------------- 2. build
passo "Buildando em dist.new (o site continua no ar durante o build)"
rm -rf dist.new
if ! npm run build -- --outDir dist.new --emptyOutDir; then
  erro "o build falhou. NADA foi trocado — o site continua no ar com a versão anterior."
  rm -rf dist.new
  exit 1
fi

# Sanidade: build "bem-sucedido" sem index.html significa que algo saiu errado.
if [ ! -f dist.new/index.html ]; then
  erro "dist.new/index.html não existe. Build suspeito — nada foi trocado."
  rm -rf dist.new
  exit 1
fi

# ---------------------------------------------------------------- 3. troca
passo "Trocando dist (anterior vai para dist.anterior)"
rm -rf dist.anterior
[ -d dist ] && mv dist dist.anterior
mv dist.new dist

# ---------------------------------------------------------------- 4. serve
reiniciar_serve

echo
passo "Deploy concluído: $(git log --oneline -1)"
echo "   Agora dê Ctrl+Shift+R no navegador para o PC pegar os arquivos novos."
echo "   Rollback, se precisar:"
echo "     rm -rf dist && mv dist.anterior dist && ./deploy.sh --so-reiniciar"

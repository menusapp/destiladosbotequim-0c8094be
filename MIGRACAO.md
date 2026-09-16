# Sair do Lovable: rodar este sistema no seu próprio Supabase

Guia completo para tirar o projeto do Lovable e colocá-lo num Supabase seu,
num repositório seu. Nada aqui depende mais do Lovable.

> **Ordem importa.** Faça os passos na sequência. O passo 7 (migrar os dados)
> é o único que precisa do projeto do Lovable ainda vivo — não cancele a conta
> antes de terminar.

---

## 1. O que este repositório já tem pronto

Este código **já foi desacoplado do Lovable**. O que mudou:

| Antes (preso ao Lovable) | Agora |
|---|---|
| `lovable-tagger` no build | removido |
| `bun.lock` apontando para o registro npm privado do Lovable | `package-lock.json` no npm público |
| IA via `ai.gateway.lovable.dev` + `LOVABLE_API_KEY` | `supabase/functions/_shared/ai.ts`, provedor à sua escolha |
| Imagens de preview hospedadas na infra do Lovable | `public/social-preview.png` |
| Ref do projeto Supabase do Lovable escrito no código | tudo por variável de ambiente |
| Cron jobs com URL e chave fixas no SQL | tabela `app_runtime_config` |
| `deliverydireto_config` só existia no banco, sem migration | migration criada |
| `verify_jwt` das functions indefinido | declarado function por function |

As 217 migrations foram **testadas replicando do zero** num PostgreSQL limpo:
217/217 aplicam sem erro, resultando em 89 tabelas, 141 funções e 124 policies.

---

## 2. Do que você precisa antes

- Conta no [Supabase](https://supabase.com)
- **Node 20 ou mais novo**
- `pg_dump`/`psql` **versão 15 ou mais nova** (o Ubuntu 22.04 traz a 14, que não serve — ver abaixo)
- Uma chave de IA — [Google AI Studio](https://aistudio.google.com/apikey) tem cota grátis

### Numa VPS Ubuntu zerada

Não use `apt install npm`: no Ubuntu 22.04 isso instala **Node 12**, velho
demais para o Vite 5 deste projeto. Use o repositório oficial da NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
NEEDRESTART_MODE=a apt install -y nodejs
node -v    # tem que mostrar v20.x ou mais
```

**`pg_dump` precisa ser 15 ou mais novo.** O pacote `postgresql-client` do
Ubuntu 22.04 instala a versão **14**, e o `pg_dump` se recusa a dumpar de um
servidor mais novo que ele — o Supabase roda PostgreSQL 15/17. Ou seja: com a
14 o passo 7 (migrar os dados) falha com *"aborting because of server version
mismatch"*. Use o repositório oficial do PostgreSQL:

```bash
install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt update
NEEDRESTART_MODE=a apt install -y postgresql-client-17

pg_dump --version   # tem que mostrar 17.x
```

### CLI do Supabase

**Não precisa instalar.** Os scripts daqui detectam sozinhos: se o comando
`supabase` não estiver no PATH, eles usam `npx supabase`, que é a forma
oficialmente suportada (a própria Supabase não suporta `npm install -g supabase`).

Se ainda assim quiser o binário instalado — fica mais rápido, porque o `npx`
baixa a CLI toda vez:

```bash
# pega a última versão e instala o .deb
VER=$(curl -fsSL https://api.github.com/repos/supabase/cli/releases/latest \
        | grep -oP '"tag_name": "v\K[^"]+')
curl -fsSL -o /tmp/supabase.deb \
  "https://github.com/supabase/cli/releases/download/v${VER}/supabase_${VER}_linux_amd64.deb"
dpkg -i /tmp/supabase.deb
supabase --version
```

### Conexões longas não podem cair

`db push`, `pg_dump` e o deploy das functions demoram. Se o SSH cair no meio,
o comando morre junto. Rode tudo dentro do `tmux`:

```bash
tmux new -s migracao      # para sair sem matar: Ctrl+B, depois D
tmux attach -t migracao   # para voltar depois
```

## 3. Criar o projeto Supabase

1. Supabase → **New project**
2. Escolha a região **South America (São Paulo)** — o sistema e os clientes estão no Brasil, e isso corta bastante latência
3. **Guarde a senha do banco.** Ela não aparece de novo
4. Anote, em Settings → API:
   - **Project URL** → `https://<ref>.supabase.co`
   - **Reference ID** → `<ref>`
   - **Publishable key** (ou anon key)

---

## 4. Colocar o código no seu repositório

```bash
git clone https://github.com/menusapp/destiladosbotequim-0c8094be.git meu-erp
cd meu-erp
git checkout claude/funny-hamilton-vm9bbj

# aponta para o SEU repositório novo
git remote remove origin
git remote add origin https://github.com/SEU_USUARIO/SEU_REPO.git
git push -u origin claude/funny-hamilton-vm9bbj:main
```

---

## 5. Configurar as variáveis

**Frontend** (chave pública, vai no bundle):

```bash
cp .env.example .env
```

Preencha `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
`VITE_SUPABASE_PROJECT_ID`, `VITE_PUBLIC_DOMAIN` e `VITE_APP_DOMAINS`.

**Edge functions** (segredos de servidor, nunca vão para o git):

```bash
cp .env.supabase.example .env.supabase
```

Preencha só `ALLOWED_ORIGIN`, `PUBLIC_DOMAIN` e `AI_API_KEY` para começar.
As credenciais de iFood, Delivery Direto, Mercado Pago, Nuvem Fiscal e QZ
podem entrar depois, uma integração de cada vez.

**`JWT_SECRET` pode ficar em branco** — o login não usa JWT. Ele grava um
token opaco em `staff_sessions` e o RLS valida no banco (migration
20260723010000). Projetos Supabase novos nem expõem mais esse secret.

---

## 6. Subir banco e functions

A CLI precisa estar autenticada. Numa VPS não há navegador, então use um
access token — gere em
[supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens):

```bash
export SUPABASE_ACCESS_TOKEN='sbp_seu_token_aqui'
```

O token vale só para a sessão atual do terminal; para não perder ao
reconectar, coloque essa linha no `~/.bashrc`.

```bash
npm install
./scripts/configurar-supabase.sh <SEU_PROJECT_REF>
```

O script liga o repo ao projeto, aplica as migrations, manda os secrets,
faz deploy das 45 edge functions e aponta os cron jobs. Pode rodar de novo
quantas vezes precisar.

No fim, se ele não conseguir falar com o banco, vai pedir para você rodar
uma linha no SQL Editor. **Não pule.** Sem ela, nenhum agendamento dispara:

```sql
SELECT public.set_app_runtime_config(
  'https://SEU_REF.supabase.co',
  'SUA_PUBLISHABLE_KEY'
);
```

---

## 7. Migrar os dados do Supabase do Lovable

Até aqui você tem a estrutura, mas o banco está **vazio**. Pegue as duas
connection strings em Settings → Database → Connection string → URI, de cada
projeto:

```bash
ORIGEM='postgresql://postgres:SENHA@db.ksscrxwvslddfqxjxzlo.supabase.co:5432/postgres'
DESTINO='postgresql://postgres:SENHA@db.SEU_REF.supabase.co:5432/postgres'

# só os DADOS — a estrutura já veio das migrations
pg_dump "$ORIGEM" \
  --data-only \
  --schema=public \
  --disable-triggers \
  --no-owner --no-privileges \
  -f dados.sql

psql "$DESTINO" -v ON_ERROR_STOP=1 -f dados.sql
```

Depois confira algumas contagens nos dois lados:

```sql
SELECT 'restaurants' t, count(*) FROM restaurants
UNION ALL SELECT 'products',  count(*) FROM products
UNION ALL SELECT 'orders',    count(*) FROM orders
UNION ALL SELECT 'customers', count(*) FROM customers;
```

> Se der erro de chave estrangeira, é ordem de inserção. Rode o `psql` de novo:
> na segunda passada as linhas que já entraram falham por duplicidade e as que
> faltavam entram. Ou use `--disable-triggers` (já está no comando acima).

### Storage (fotos, certificados)

São 6 buckets: `product-images`, `products`, `table-images`,
`reservation-tables` (públicos), `fiscal-certificates` e `backups` (privados).

As migrations recriam os buckets vazios; os **arquivos** você copia. O caminho
mais simples é pelo painel (Storage → bucket → Download / Upload). Para muitos
arquivos, use a [Storage API](https://supabase.com/docs/reference/javascript/storage-from-list)
ou `rclone` com as duas contas S3-compatíveis.

**O certificado digital A1** (bucket `fiscal-certificates`) é o mais crítico:
sem ele a emissão de NFC-e para de funcionar.

---

## 8. Reapontar as integrações externas

Esta etapa é a mais fácil de esquecer e a que mais quebra em silêncio: os
provedores externos ainda mandam webhook para a URL **antiga**. Em cada painel,
troque `ksscrxwvslddfqxjxzlo.supabase.co` por `SEU_REF.supabase.co`:

| Integração | Onde trocar | URL nova |
|---|---|---|
| Mercado Pago | painel de aplicação → Webhooks | `https://SEU_REF.supabase.co/functions/v1/mercadopago-webhook` |
| Mercado Pago (assinaturas) | painel de aplicação → Webhooks | `.../functions/v1/mercadopago-subscription-webhook` |
| Mercado Pago (OAuth) | painel → Redirect URI | `.../functions/v1/mercadopago-oauth` |
| iFood | portal do desenvolvedor | `.../functions/v1/ifood-polling` |
| Delivery Direto | painel da loja | `.../functions/v1/dd-webhook` |
| WhatsApp (Evolution API) | configuração da instância | `.../functions/v1/whatsapp-webhook` |

Depois de trocar, **reconecte** iFood e Delivery Direto pelo app: os tokens
OAuth guardados são do projeto antigo e já vieram junto no dump.

---

## 9. Publicar o frontend

O Lovable também hospedava o site. Escolha onde hospedar:

**Vercel / Netlify** (mais simples): conecte o repositório, build `npm run build`,
diretório `dist`, e cadastre as variáveis `VITE_*` no painel.

**VPS que você já tem** (`vmi3228699`), com nginx:

```bash
npm ci && npm run build
sudo cp -r dist/* /var/www/destilado/
```

Como é uma SPA com rotas, o nginx precisa cair no `index.html`:

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

Aponte o DNS do domínio para a nova hospedagem e emita o certificado
(`certbot --nginx -d menusapp.com.br`).

---

## 10. Conferir

```bash
SUPABASE_DB_URL='postgresql://postgres:SENHA@db.SEU_REF.supabase.co:5432/postgres' \
  ./scripts/verificar-migracao.sh
```

E na mão, no app:

- [ ] Login da equipe entra (valida as RPCs de sessão e o RLS)
- [ ] Cardápio público carrega com produtos e fotos
- [ ] Criar um pedido de teste no PDV
- [ ] Emitir uma NFC-e de teste (valida o certificado A1)
- [ ] Mandar uma mensagem pelo WhatsApp
- [ ] Depois de ~2 min, `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;` mostra execuções com sucesso

---

## 11. O plano grátis do Supabase aguenta?

> ⚠️ **Confirme os números na [página de preços](https://supabase.com/pricing)
> antes de decidir.** Os valores abaixo são a referência que eu tinha e o
> Supabase mexe neles com alguma frequência. O raciocínio de capacidade,
> esse sim, continua valendo.

Ordem de grandeza do plano Free, **por projeto**: ~500 MB de banco, ~1 GB de
Storage, ~5 GB de transferência/mês, ~500 mil execuções de edge function/mês.
E dois limites que não são de tamanho:

- **O projeto pausa depois de ~7 dias sem acesso.** Um ERP de restaurante é
  usado todo dia, então na prática isso não te pega — mas pega um sistema
  secundário que fica parado.
- **Não há backup automático no Free.** Para um sistema que fatura, esse é o
  argumento mais forte para o Pro (US$ 25/mês), mais do que qualquer limite
  técnico.

**Para este ERP em particular**, o gargalo não é o banco — é a cota de edge
functions, por causa dos agendamentos:

| Job | Frequência | Chamadas/mês |
|---|---|---|
| `marketing-scheduler` | a cada 1 min | ~43.800 |
| `ifood-polling` | a cada 30s (2× por minuto) | ~87.600 |
| `process-abandoned-carts` | a cada 15 min | ~2.900 |
| `marketing-absence-scanner` | a cada 10 min | ~4.400 |
| **Total, com o sistema parado** | | **~138.700** |

Ou seja: **cerca de 28% da cota grátis some sem nenhum pedido acontecer.** Os
outros ~360 mil sobram para uso real, o que é bastante para um restaurante —
mas se o iFood ficar ligado, vale subir o intervalo do polling. É um `UPDATE`
no agendamento, não exige deploy:

```sql
SELECT cron.unschedule('ifood-polling-every-30s');
SELECT cron.schedule('ifood-polling-every-30s', '* * * * *',
  $$ SELECT public.trigger_ifood_polling_all(); $$);  -- 1×/min em vez de 2×
```

**Veredito:** para este sistema sozinho, o Free dá conta do uso — o que falta
nele é rede de proteção, não capacidade. Como o Destilado é usado todo dia, a
pausa por inatividade não te pega; o que pesa mesmo é **não ter backup
automático** num sistema que controla pedido, caixa e nota fiscal.

Caminho sugerido: **suba no Free e valide a migração inteira** (é reversível e
não custa nada). Com tudo funcionando, os US$ 25/mês do Pro compram backup
diário, e aí sim vale.

## 12. Dívida de segurança (herdada, não criada aqui)

Coisas que **já são assim hoje no Lovable** e continuam iguais depois da
migração. Não foram alteradas para não mudar o comportamento no meio de uma
migração, mas valem uma passada depois:

1. **Edge functions sem checagem de autorização.** Todas estão com
   `verify_jwt = false` (é obrigatório: o app não usa Supabase Auth, então
   nenhuma chamada carrega JWT). Só que várias não conferem nada por conta
   própria — `staff-create` e `update-restaurant-credentials` entre elas.
   Na prática, qualquer um que descubra a URL consegue chamar. O caminho é
   validar o `x-app-token` dentro da própria function.

2. **`ifood_config` com policy `USING (true)`.** A tabela guarda tokens OAuth
   e tem policy permissiva para `anon`/`authenticated`. Hoje ela se salva
   porque não há GRANT de tabela, mas é frágil. (A `deliverydireto_config`
   criada nesta migração já nasceu fechada.)

3. **`npm audit` acusa 23 vulnerabilidades** (2 críticas) nas dependências.
   Não foram mexidas aqui porque `npm audit fix --force` sobe versões maiores
   e pode quebrar a UI. Vale tratar com calma, num PR separado.

4. **`react-leaflet@5` pede React 19**, o projeto roda React 18.3. Funciona
   (é assim hoje), mas por isso existe o `legacy-peer-deps` no `.npmrc`.

---

## 13. Se algo der errado

| Sintoma | Causa provável |
|---|---|
| Login da equipe dá erro | as RPCs `create_staff_session`/`create_ceo_session` ou a tabela `staff_sessions` não vieram no dump de dados (passo 7) |
| Cardápio abre vazio | `ESTABLISHMENT.slug` (em `src/config/establishment.ts`) não bate com `restaurants.slug` no banco |
| Campanhas e carrinho abandonado não disparam | faltou o `set_app_runtime_config` do passo 6 |
| Pedido do iFood/Delivery Direto não entra | webhook ainda apontando para o projeto antigo (passo 8) |
| Function responde 401 | `verify_jwt` — confira se o `supabase/config.toml` subiu junto |
| Digitalizar cardápio falha | `AI_API_KEY` não configurada |
| NFC-e não emite | certificado A1 não foi copiado para o bucket `fiscal-certificates` |

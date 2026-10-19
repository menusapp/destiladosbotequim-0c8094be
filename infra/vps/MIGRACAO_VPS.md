# Roteiro: migrar 3 sistemas da Lovable para esta VPS

Este arquivo é a tarefa completa para o Claude Code rodando NA VPS. O dono
está ausente e autorizou execução autônoma: não pare para perguntar. Quando
uma decisão não estiver coberta aqui, escolha a opção mais segura que mantém
o sistema funcionando, anote no relatório e siga em frente.

**Tudo roda dentro desta VPS.** "Supabase self-hosted" aqui significa o
software open source do Supabase rodando em containers Docker nesta
máquina (Postgres, login, API, storage, realtime, funções). Nada fica no
supabase.com ou na Lovable: não crie conta, projeto nem chave em nenhum
serviço externo de banco/backend. As únicas chamadas para fora são as
integrações do próprio app (Gemini, Mercado Pago, WhatsApp) e o Let's
Encrypt para o HTTPS.

## 0. Regras que valem o tempo todo

1. **Cada sistema 100% isolado.** Supabase próprio, banco próprio, secrets
   próprios, rede Docker própria, volumes próprios, projeto docker compose
   próprio, subdomínio próprio, backup próprio. Nada compartilhado entre eles.
2. **Não mexa no que já existe na VPS.** Já rodam aqui o front do Destilado
   Botequim e, possivelmente, a Evolution API (WhatsApp). Não pare, não
   reinicie, não edite a configuração, não apague volumes/containers/imagens
   que você não criou. Não rode `docker system prune`, `docker volume prune`
   nem nada parecido. Se precisar recarregar o nginx, use `nginx -t` antes e
   `systemctl reload nginx` (nunca restart/stop).
3. **Firewall:** se o `ufw` já estiver ativo, só adicione regras (80/443) e
   nunca remova a regra do SSH. Se estiver inativo, NÃO ative. Proteja os
   serviços ligando as portas só em `127.0.0.1`.
4. **Repositórios:** nunca dê push na branch `main` (ela sincroniza com a
   Lovable e quebraria o sistema que está no ar). Trabalhe numa branch local
   `vps` em cada repositório e dê push só dela (`git push -u origin vps`).
5. **Secrets:** nunca commite secrets. Registre TODA secret criada ou
   alterada em `~/SECRETS-sistemas.txt` (`chmod 600`), separada por sistema,
   com data e para que serve.
6. **Relatório:** mantenha `~/RELATORIO-VPS.md` atualizado ao longo do
   trabalho (o que foi feito, o que mudou no código, problemas e soluções,
   pendências). Se a sessão cair, ele permite retomar.
7. **RAM:** antes de subir cada instância, rode `free -m`. Se a memória
   disponível ficar abaixo de 1.5 GB, não suba a próxima: anote no relatório
   e pare essa parte.
8. **Dados:** os bancos começam vazios (só a estrutura). O dono vai trazer os
   backups da Lovable depois. Não tente acessar os bancos da Lovable.
9. Entrada opcional do dono: se existir `~/entrada-secrets.txt`, use as
   chaves de lá (formato `NOME=valor`). Se uma chave faltar, deixe a
   integração sem configurar (stand-by) e liste na pendência.
10. Se existir `~/dominios.txt`, use os domínios de lá. Se não, use
    domínios temporários `sslip.io` (seção 6).

## 1. Reconhecimento (anote tudo no relatório)

```bash
uname -a; cat /etc/os-release; nproc; free -h; df -h
docker ps -a; docker network ls; docker volume ls
sudo ss -tlnp
sudo nginx -T 2>/dev/null | head -200   # ver config atual (só leitura)
sudo ufw status
curl -s https://ifconfig.me             # IP público
```

- Descubra onde está o front do Destilado (diretório e arquivo nginx) e se a
  Evolution API roda aqui (container, porta). Só para saber o que NÃO tocar.
- Se o proxy na frente for outro (Caddy, Traefik, nginx em container), adapte
  o passo 6 a ele em vez de instalar um segundo servidor nas portas 80/443.
- Se faltar Docker/compose: `curl -fsSL https://get.docker.com | sudo sh` e
  `sudo usermod -aG docker $USER` (use `sudo docker` até a sessão relogar).
- Se faltar: `sudo apt-get install -y nginx certbot python3-certbot-nginx
  postgresql-client jq git`.
- Escolha portas livres (confira com `ss -tlnp`). Sugestão:

| Sistema | Nome curto | Kong (API) | App | Postgres |
|---|---|---|---|---|
| ERP loja de roupas (`menusapp/ramoserp`) | `loja` | 127.0.0.1:18000 | 127.0.0.1:13000 | não exposto |
| Rodagem/vendas (`menusapp/meufinanceirocalebe`) | `rodagem` | 127.0.0.1:28000 | 127.0.0.1:23000 | não exposto |
| Totem/menu (`menusapp/menu-mesa-master`) | `menu` | 127.0.0.1:38000 | estático no nginx | não exposto |

## 2. Estrutura de pastas

```
/opt/sistemas/
  _fonte/supabase/        # clone do github.com/supabase/supabase (só leitura, modelo)
  loja/    supabase/  app/  backups/
  rodagem/ supabase/  app/  backups/
  menu/    supabase/  app/  backups/
```

- `sudo mkdir -p /opt/sistemas && sudo chown $USER: /opt/sistemas`
- `git clone --depth 1 https://github.com/supabase/supabase /opt/sistemas/_fonte/supabase`
- Para cada sistema: `cp -r /opt/sistemas/_fonte/supabase/docker/. /opt/sistemas/<nome>/supabase/`
- Clone o app: `gh repo clone menusapp/<repo> /opt/sistemas/<nome>/app`, depois
  `git -C /opt/sistemas/<nome>/app checkout -b vps`.

## 3. Supabase self-hosted (uma instância por sistema)

Siga a documentação/README que vem em `docker/` no clone do Supabase (ela
muda de versão para versão; ela vale mais que este roteiro nos detalhes).

Em cada `/opt/sistemas/<nome>/supabase/`:

1. **`.env` com secrets novos e exclusivos** (nunca reaproveite entre
   sistemas): `POSTGRES_PASSWORD`, `JWT_SECRET` (≥ 40 caracteres),
   `ANON_KEY` e `SERVICE_ROLE_KEY` (JWT HS256 assinados com o `JWT_SECRET`
   desse sistema, roles `anon` e `service_role`, validade longa),
   `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`, `SECRET_KEY_BASE`,
   `VAULT_ENC_KEY` (32 chars), `PG_META_CRYPTO_KEY` e as demais que o
   `.env.example` pedir. Se o repositório trouxer script de geração de
   chaves, use-o. Gere com `openssl rand`. Anote tudo em
   `~/SECRETS-sistemas.txt`.
2. `COMPOSE_PROJECT_NAME=<nome>` no `.env` (isso separa containers, rede e
   volumes de cada sistema). Confira que não há `container_name:` fixo no
   compose; se houver, prefixe com `<nome>-` para não colidir.
3. `SITE_URL` = URL pública do app do sistema; `API_EXTERNAL_URL` e
   `SUPABASE_PUBLIC_URL` = URL pública da API do sistema;
   `ADDITIONAL_REDIRECT_URLS` com a URL do app.
4. **E-mail:** não há SMTP ainda. Coloque `ENABLE_EMAIL_AUTOCONFIRM=true`
   para cadastro/login funcionarem. Pendência no relatório: configurar SMTP
   (Gmail com senha de app, Brevo ou Resend) para recuperação de senha.
5. **Emagrecer, sem afetar o funcionamento:**
   - Remova `analytics` (Logflare) e `vector` e tudo que depende deles
     (`depends_on`, `LOGFLARE_*` no studio/kong). É o maior consumidor de RAM
     e os apps não usam.
   - Remova `imgproxy` e use `ENABLE_IMAGE_TRANSFORMATION=false` no storage
     (o código não usa transformação de imagem do Supabase; confira com
     `grep -rn "transform" src | grep -i storage` antes).
   - Remova `supavisor`/pooler (os apps falam com a API REST, não direto
     com o Postgres).
   - `loja` e `rodagem` não têm edge functions: remova o serviço
     `functions` deles. `menu` mantém.
   - Mantenha: `db`, `auth`, `rest`, `realtime` (os 3 apps usam realtime),
     `storage`, `meta`, `studio`, `kong`.
   - Limite de memória por serviço (`mem_limit`/`deploy.resources`):
     comece com db 768m (rodagem 384m), realtime 256m, studio 256m,
     auth/rest/storage/meta/kong 128–192m. Ajuste se algum ficar
     reiniciando por OOM (`docker stats`, `docker inspect ... OOMKilled`).
   - Postgres pequeno: `shared_buffers=128MB`, `max_connections=60`
     (rodagem: 64MB/40).
6. Ligue as portas publicadas só em `127.0.0.1` (Kong conforme a tabela;
   Postgres sem porta publicada; para acessar use `docker exec`).
7. `docker compose up -d`, espere tudo `healthy`, anote `docker stats
   --no-stream` no relatório.

## 4. Estrutura do banco (migrações)

Para cada sistema, aplique em ordem os arquivos de
`/opt/sistemas/<nome>/app/supabase/migrations/*.sql` (ordem alfabética =
cronológica), via `docker exec -i <container-db> psql -U postgres -d postgres
-v ON_ERROR_STOP=1 < arquivo.sql`. Use uma transação por arquivo.

- Se uma migração falhar por diferença entre Supabase hospedado e
  self-hosted (extensão, role, objeto já existente), corrija o mínimo
  necessário, anote a correção e continue. Não pule tabelas, policies (RLS)
  nem funções.
- Depois, confira que existem os buckets de storage usados no código
  (`grep -rhoE "storage\.from\(['\"][^'\"]+" src`) com a mesma
  visibilidade (pública/privada) do original. Crie os que faltarem.
  Esperado: loja → `produtos`; menu → `product-images`, `products`,
  `table-images`, `backups`.
- Recarregue o cache do PostgREST: `NOTIFY pgrst, 'reload schema';`.

## 5. Adaptar o código (branch `vps`)

Em todos os 3:
- Atualize `.env` do app com a nova `SUPABASE_URL`/`VITE_SUPABASE_URL` e a
  nova chave anon (`SUPABASE_PUBLISHABLE_KEY`/`VITE_SUPABASE_PUBLISHABLE_KEY`)
  do sistema. `VITE_SUPABASE_PROJECT_ID`: use o nome curto do sistema.
  Procure URLs `*.supabase.co` hardcoded em `src/` e troque também.
  O `.env` NÃO vai para o git (adicione ao `.gitignore` da branch `vps` se
  preciso; os valores ficam no `~/SECRETS-sistemas.txt`).
- Neutralize o que só funciona dentro da Lovable sem quebrar nada:
  `src/lib/lovable-error-reporting.ts` e `previewAuthStorage.ts` (verifique
  se fora do preview da Lovable viram no-op; se tentarem falar com a
  Lovable em produção, desligue).
- `npm ci` (ou `bun install`) e `npm run build` precisam passar.

### 5a. `loja` (ramoserp) e `rodagem` (meufinanceirocalebe): TanStack Start

- O build usa `@lovable.dev/vite-tanstack-config`, que gera para Cloudflare
  por padrão. Gere para Node: tente o preset do Nitro `node-server`
  (opção `nitro: { preset: "node-server" }` no `defineConfig` ou
  `NITRO_PRESET=node-server`). Se o pacote da Lovable não permitir, troque
  por um `vite.config.ts` comum com os plugins que o comentário do arquivo
  diz que ele inclui (tanstackStart, viteReact, tailwindcss, tsConfigPaths,
  nitro). Anote o que fez.
- Rode cada app num container próprio (Dockerfile na branch `vps`, base
  `node:22-alpine`, `restart: unless-stopped`, `mem_limit: 256m`), num
  compose próprio em `/opt/sistemas/<nome>/app-compose.yml` com
  `name: <nome>-app`, porta `127.0.0.1:13000` (loja) / `127.0.0.1:23000`
  (rodagem). Variáveis de runtime: `SUPABASE_URL`,
  `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SERVICE_ROLE_KEY` (só no servidor,
  nunca no bundle do navegador).
- **rodagem:** o login com Google passa pelo serviço da Lovable
  (`@lovable.dev/cloud-auth-js`, `src/integrations/lovable/`) e não funciona
  fora dela. Esconda o botão do Google e deixe só e-mail e senha. Pendência
  no relatório: dá para voltar o Google criando uma credencial OAuth no
  Google Cloud e configurando `GOTRUE_EXTERNAL_GOOGLE_*` + trocando para
  `supabase.auth.signInWithOAuth`.

### 5b. `menu` (menu-mesa-master): Vite SPA + 45 edge functions

Front: `npm run build` → servir `dist/` pelo nginx com fallback SPA
(`try_files $uri /index.html`), copiado para `/opt/sistemas/menu/www`.

Edge functions: copie `app/supabase/functions/*` para
`supabase/volumes/functions/` mantendo a função `main` do self-hosted.
Ajustes:

1. **IA da Lovable → Gemini** em `digitize-menu`, `digitize-menu-url` e
   `fiscal-ai-suggest` (esta é usada para sugerir dados fiscais/NCM na tela
   de produtos, então fica):
   - URL `https://ai.gateway.lovable.dev/...` →
     `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
   - cabeçalho → `Authorization: Bearer ${Deno.env.get("GEMINI_API_KEY")}`
   - modelo `google/gemini-2.5-flash` → `gemini-2.5-flash` (tire o prefixo
     `google/` de qualquer modelo)
   - secret `LOVABLE_API_KEY` → `GEMINI_API_KEY` (valor de
     `~/entrada-secrets.txt`; se não houver, pendência).
2. **Nuvem Fiscal: remover.** Não suba `nuvem-fiscal-cancel`,
   `nuvem-fiscal-company`, `nuvem-fiscal-download`, `nuvem-fiscal-emit`,
   `nuvem-fiscal-sync`. No front, esconda as telas e botões de emissão de
   nota (`NotasFiscaisTab`, `FiscalSettingsTab`, `NovaEmissaoModal`,
   `FiscalNoteDetailSheet` e as ações de emitir em `PendingOrdersPanel`),
   de forma que nada na tela chame essas funções. NÃO apague tabelas nem
   colunas fiscais do banco (os dados que virão da Lovable podem tê-las).
   `parse-nfe` (importar XML de nota de fornecedor) não é Nuvem Fiscal:
   mantenha.
3. **iFood e "dd" (`dd-auth`, `dd-polling`, `dd-webhook`,
   `dd-order-action`): stand-by.** Mantenha o código e suba as funções, mas
   sem credenciais. Remova o agendamento do polling do iFood
   (`SELECT cron.unschedule('ifood-polling-every-30s');` depois das
   migrações) para não gastar CPU a cada minuto. Confira que a tela de
   integrações não quebra sem credenciais. Anote como religar.
4. **Cron e URLs antigas:** procure `net.http_post` e
   `*.supabase.co` nas migrações e funções do banco; troque pela URL
   interna/nova da API deste sistema e pela `SERVICE_ROLE_KEY` dele.
5. **verify_jwt:** o `supabase/config.toml` do app lista as funções com
   `verify_jwt = false` (públicas: webhooks, cardápio etc.). Faça o roteador
   `main` do self-hosted respeitar essa lista: essas sem verificação, todas
   as outras exigindo JWT válido. Não desligue a verificação para todas.
6. **Secrets das funções** (no `.env`/compose do serviço `functions`):
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ALLOWED_ORIGIN` = URL pública do app do menu, `GEMINI_API_KEY`, e as
   que estiverem em `~/entrada-secrets.txt`: `MERCADOPAGO_ACCESS_TOKEN`,
   `MERCADOPAGO_APP_ID`, `MERCADOPAGO_CLIENT_SECRET`,
   `MERCADOPAGO_SUBSCRIPTIONS_ACCESS_TOKEN`, `EVOLUTION_API_URL`,
   `EVOLUTION_API_KEY`, `QZ_CERTIFICATE`, `QZ_PRIVATE_KEY`. Se a Evolution
   API roda nesta VPS, use o endereço interno dela. Faltando chave → stand-by
   + pendência.
7. Pendência no relatório: as URLs novas de webhook que o dono precisa
   cadastrar no painel do Mercado Pago e na instância da Evolution API.

## 6. Domínios, nginx e HTTPS

- Domínios: de `~/dominios.txt` se existir; senão, temporários com o IP
  (pontos viram traços), por exemplo para o IP `1.2.3.4`:
  - `loja.1-2-3-4.sslip.io` (app) e `api.loja.1-2-3-4.sslip.io` (API + Studio)
  - `rodagem.1-2-3-4.sslip.io` e `api.rodagem.1-2-3-4.sslip.io`
  - `menu.1-2-3-4.sslip.io` e `api.menu.1-2-3-4.sslip.io`
- Um arquivo nginx por sistema: `/etc/nginx/sites-available/sistema-<nome>.conf`
  (+ link em `sites-enabled`). Não edite os arquivos que já existem.
  - app → `proxy_pass http://127.0.0.1:<porta app>` (loja/rodagem) ou
    `root /opt/sistemas/menu/www` com fallback SPA (menu).
  - api → `proxy_pass http://127.0.0.1:<porta kong>` com suporte a
    WebSocket (realtime: `Upgrade`/`Connection`), `client_max_body_size 50m`.
- `sudo nginx -t && sudo systemctl reload nginx`, depois
  `sudo certbot --nginx -d <app> -d <api> --non-interactive --agree-tos
  -m menusappoficial@gmail.com --redirect` por sistema.
- O Studio de cada sistema fica na URL da API, protegido pelo
  `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` daquele sistema. Anote no
  relatório.
- Se mudar domínio depois: atualizar `SITE_URL`/`API_EXTERNAL_URL`/
  `SUPABASE_PUBLIC_URL`, o `.env` do app, rebuild e certbot.

## 7. Backup (um por sistema)

- `/opt/sistemas/<nome>/backups/backup.sh`: `pg_dump -Fc` via
  `docker exec`, mais `tar` do volume de storage, nome com data, guarda 14
  dias, log em `backups/backup.log`.
- Crontab do usuário em horários diferentes (03:00 loja, 03:20 menu,
  03:40 rodagem).
- Rode uma vez e **teste a restauração** de cada dump num banco temporário
  (`pg_restore` em um container postgres descartável); depois apague só o
  temporário. Anote o resultado.
- Pendência: cópia para fora da VPS (Google Drive/S3), que depende de
  credencial do dono.

## 8. Testes antes de dar como pronto

Para cada sistema, registre o resultado no relatório:
- App abre em HTTPS (status 200, sem erro no HTML/JS; se houver Playwright
  ou Chromium disponível, abra a página e veja o console).
- Cadastro e login via API (`/auth/v1/signup`, `/auth/v1/token`) com um
  usuário de teste; consulta REST numa tabela; upload e remoção de um
  arquivo num bucket; conexão realtime (WebSocket abre).
- menu: chame algumas funções públicas (por exemplo `menu-link-preview`,
  `hash-password`) e veja `docker logs` do `functions` sem erro de import.
- Apague os usuários e arquivos de teste no fim.
- `docker stats --no-stream`: RAM de cada sistema + total livre da VPS.
- Confirme que o front do Destilado e a Evolution API continuam
  respondendo como no reconhecimento.

## 9. Preparar a importação de dados (o dono traz depois)

Crie `~/IMPORTAR-DADOS.md` explicando, em português simples:
- como o dono exporta os dados da Lovable (por tabela, CSV, a partir da
  visualização do banco do Lovable Cloud), começando pelo estoque/produtos
  da loja e o cardápio do menu, e onde colocar os arquivos na VPS
  (`/opt/sistemas/<nome>/importar/`);
- que as imagens dos buckets precisam ser baixadas também;
- que as senhas dos usuários não vêm junto (vão precisar redefinir, o que
  exige o SMTP configurado);
- o que você vai rodar para importar (ordem das tabelas por causa das
  chaves estrangeiras) quando os arquivos chegarem.

## 10. Fechamento

- `git push -u origin vps` em cada um dos 3 repositórios (nunca `main`).
- `~/RELATORIO-VPS.md` final com: URLs de cada sistema (app, API,
  Studio), como ligar/desligar cada um (`docker compose -p <nome> ...`),
  RAM usada por sistema, tudo que mudou no código, o que ficou em
  stand-by (iFood, dd, Google login), o que foi removido (Nuvem Fiscal) e
  a lista de pendências do dono (SMTP, chaves faltando, webhooks do
  Mercado Pago/Evolution, DNS definitivo, backup externo, trocar as chaves
  do Gemini e do Mercado Pago que já apareceram em conversa).
- Confirme `chmod 600 ~/SECRETS-sistemas.txt`.

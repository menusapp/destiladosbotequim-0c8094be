# BrokerBeetle — Especificação para o Claude Code (VPS)

O BrokerBeetle é um sistema **minimalista** para corretores de imóveis. Ele nasce do código do simpliaosCRM (`/opt/sistemas/simpliaoscrm`, repositório `menusapp/simpliaoscrm`), mas é um **produto separado**: outra pasta, outro repositório, outro banco, outros containers, outro endereço e outros logins. O CRM completo continua exatamente como está.

**A ideia do produto:** o corretor cadastra imóveis e leads de forma rápida, principalmente pelo **assistente de WhatsApp**, e depois envia esses dados para o CRM grande que a imobiliária dele já usa. O BrokerBeetle é um complemento que "gruda" em outros CRMs, não um substituto. O nome vem do besouro: pequeno, forte, se agarra a algo maior e carrega muito mais que o próprio peso.

Leia este arquivo inteiro antes de começar.

## 0. Como trabalhar

- Autonomia total dentro da pasta do projeto. Não peça aprovação do plano: grave `PLAN.md` e comece.
- Crie `CLAUDE.md`, `FEATURES.md` (checklist com `[ ]`, `[~]`, `[x]`, `[dev]`), `DECISIONS.md` e `RELATORIO.md`. Atualize ao fim de cada fase.
- Trabalhe por fases (seção 10). Ao fim de cada fase: typecheck, lint, testes unitários, E2E, build do Docker, deploy, teste no navegador (Playwright, desktop e celular), commit e push. Só avance com tudo verde.
- "Funcional" = a tela existe, salva no banco, valida no cliente e no servidor, respeita o isolamento entre contas e tem pelo menos um teste. Tela bonita sem persistência não conta.
- Não corte escopo. Se algo for inviável, marque `[dev]` no FEATURES.md com justificativa.
- **Não altere nada do simpliaosCRM**, nem código, nem containers, nem banco, nem a Evolution dele. Copie o código que for reaproveitar para o projeto novo.

## 1. Separação e infraestrutura

- **Pasta:** `/opt/sistemas/brokerbeetle`.
- **Repositório:** crie `menusapp/brokerbeetle` **privado** (`gh repo create menusapp/brokerbeetle --private`). Ponto de partida: cópia do código do simpliaosCRM, removendo tudo que não estiver neste escopo (financeiro, locação, jurídico, garantido, vendas, documentos, portal, site completo, roleta, funil avançado etc.). O código final deve ficar enxuto: nada de módulos mortos escondidos.
- **Docker Compose** com projeto `brokerbeetle`, rede e volumes próprios (prefixo `brokerbeetle_`): `brokerbeetle-app`, `brokerbeetle-worker`, `brokerbeetle-db` (Postgres próprio) e `brokerbeetle-evolution` (Evolution **v2.3.7** própria, sem porta publicada, banco próprio). Gotenberg só se algum PDF for realmente necessário.
- **Endereço:** `https://brokerbeetle.simpliaos.online`. O DNS `*.simpliaos.online` já aponta para a VPS. **Exceção autorizada:** criar no Nginx Proxy Manager um proxy host `brokerbeetle.simpliaos.online` → `127.0.0.1:<porta livre>` (sugestão 44000), com o certificado `*.simpliaos.online`, HTTPS forçado e WebSocket ligado, do mesmo jeito que foi feito para o CRM. Não altere outros proxy hosts.
- Porta do app só em `127.0.0.1` (e no gateway da rede do NPM, se for como o CRM faz). Nada exposto para a internet além do 443 pelo NPM.
- **Limites de memória** (a VPS é compartilhada com sistemas em produção): app 512 MB, worker 384 MB, db 512 MB, evolution 512 MB. Logs com rotação. Um build por vez. Nunca `docker system prune`; nunca mexa em containers, volumes ou redes de outros projetos.
- **Backup** diário próprio (banco + uploads + sessão da Evolution) às 04:30 via cron do usuário `deploy` (só acrescentar a linha), guardando 7 diários e 4 semanais em `/opt/sistemas/brokerbeetle/backups`. Script de restauração testado.
- **Segredos:** `.env` (chmod 600, fora do git) e uma seção "BrokerBeetle" no `~/SECRETS-sistemas.txt`.
- `COOKIE_SECURE=true`, `TRUST_PROXY=true`.

## 2. Identidade visual

- Nome: **BrokerBeetle**. Logo nova (besouro com corpo em forma de casa e fechadura nas costas), em preto e branco. Baixe os arquivos:
  ```bash
  mkdir -p /opt/sistemas/brokerbeetle/public/brand && cd /opt/sistemas/brokerbeetle/public/brand
  for f in brokerbeetle-preto.svg brokerbeetle-branco.svg brokerbeetle-app-preto.svg brokerbeetle-app-branco.svg brokerbeetle-preto-1024.png brokerbeetle-branco-1024.png brokerbeetle-app-preto-1024.png brokerbeetle-app-branco-1024.png favicon.ico; do
    gh api "repos/menusapp/destiladosbotequim-0c8094be/contents/infra/brokerbeetle/brand/$f?ref=claude/compassionate-ramanujan-lst1p3" -H "Accept: application/vnd.github.raw" > "$f"
  done
  ```
- Use a logo no cabeçalho da landing, na tela de login/cadastro, na barra lateral, no favicon, no `manifest.json` (ícones 192/512 gerados a partir do PNG de 1024), no Open Graph e nas mensagens do assistente quando fizer sentido.
- Paleta **preto e branco** com um único cinza de apoio; tema claro e escuro. Visual **minimalista e moderno**: muito espaço em branco, tipografia limpa, cantos arredondados, ícones lucide finos, animações curtas e suaves (150–250 ms, só transform/opacity, respeitando `prefers-reduced-motion`).
- Interface 100% em português do Brasil, responsiva e pensada **primeiro para o celular** (o corretor usa na rua).

## 3. Multi-conta (o ponto mais importante)

- Qualquer corretor pode criar uma conta. Cada conta é um **espaço isolado** (`Account`/tenant): imóveis, leads, agenda, fotos, configurações e vínculo de WhatsApp pertencem à conta.
- Toda tabela de dados tem `accountId`, todo acesso filtra por `accountId` **no servidor**, em toda Server Action, rota e job do worker. Esconder botão não basta.
- Primeira versão: **uma conta = um usuário** (o dono). Deixe o modelo preparado para "membros da conta" no futuro, sem implementar agora (marque `[dev]`).
- Testes automatizados obrigatórios de isolamento: a conta A nunca lê, edita, exclui, exporta ou recebe pelo WhatsApp dados da conta B (inclusive por ID adivinhado na URL e por arquivos de foto).
- Um usuário **administrador da plataforma** (criado pelo `.env`) acessa uma área `/admin` simples: lista de contas, status (teste/ativa/suspensa), data de criação, uso (quantidade de imóveis, leads, mensagens, consumo de IA) e suspender/reativar. Ele não vê os dados internos das contas sem necessidade.

## 4. Páginas públicas

### 4.1 Landing page em `/`
Página de vendas do BrokerBeetle, moderna e direta:
- Topo com logo, links "Como funciona", "Planos" e botões **Entrar** e **Criar conta**.
- Herói: frase principal (ex.: "Cadastre imóveis e leads pelo WhatsApp em segundos. Depois mande tudo para o seu CRM."), subtítulo e botões **Começar agora** (cadastro) e **Já tenho conta**.
- Seção "Como funciona" em 3 passos: conecta o WhatsApp → manda fotos e dados → o BrokerBeetle organiza e envia para o seu CRM.
- Recursos (cards curtos): cadastro de imóvel pelo WhatsApp com fotos organizadas por IA, leads em segundos, link bonito do imóvel para mandar ao cliente, exportação e envio para outros CRMs, funciona no celular.
- Seção **Planos** com os cards e botão **Assinar**. O pagamento é feito depois: por enquanto o botão leva ao cadastro com período de teste e mostra "pagamento em breve" (padrão "em desenvolvimento").
- Perguntas frequentes, rodapé com Termos de uso e Política de privacidade (incluindo o uso de IA e WhatsApp, LGPD).
- SEO básico, Open Graph com a logo, carregamento rápido.

### 4.2 Cadastro, login e senha
- **Criar conta:** nome, e-mail, celular (com máscara e validação), senha (mín. 8 caracteres), CRECI (opcional), nome da imobiliária (opcional), aceite dos termos. Cria a conta em modo **teste** e já entra no painel.
- **Entrar:** e-mail + senha. Rate limit e bloqueio temporário após várias tentativas. Sessão no banco, cookie httpOnly, argon2id (reaproveite a autenticação do CRM).
- **Esqueci a senha:** por e-mail quando houver SMTP; sem SMTP, mostre o aviso e a orientação de contato.
- **Trocar senha** dentro das configurações.

### 4.3 Página pública do imóvel
- Link compartilhável `/i/<código-curto>` com fotos, valores, características e um botão "Falar com o corretor" (WhatsApp `wa.me` do corretor dono da conta).
- Só aparece se o corretor marcar o imóvel como "publicar link". Localização aproximada, nunca o endereço exato (configurável).
- Open Graph com a foto de capa (fica bonito quando o corretor manda no WhatsApp do cliente).

## 5. Painel (logado)

Layout com **barra lateral** (recolhível; no celular vira menu inferior ou gaveta) e só estas abas:

1. **Início** — página de boas-vindas e dashboard:
   - saudação com o nome;
   - "primeiros passos" enquanto a conta é nova (conectar WhatsApp, cadastrar o primeiro imóvel, cadastrar o primeiro lead, configurar o envio para o CRM), com check em cada passo concluído;
   - indicadores: total de imóveis, imóveis por status, leads totais, leads novos na semana, próximos compromissos;
   - atalhos rápidos: "Novo imóvel", "Novo lead";
   - últimos itens cadastrados (inclusive os que vieram do WhatsApp, com o selo "via WhatsApp").
2. **Imóveis** — listar, buscar, filtrar (status, tipo, finalidade, faixa de valor), cadastrar, editar, excluir (lógica, com lixeira restaurável por 30 dias), fotos (arrastar, reordenar, capa, compressão), copiar link público, alterar status e preço rapidamente.
3. **Leads** — listar, buscar, filtrar (status, origem, data), cadastrar, editar, excluir (lógica), registrar interesse/perfil de busca, status simples (Novo → Em contato → Visita → Proposta → Fechado/Perdido, com motivo ao perder), botão de WhatsApp `wa.me` para o lead, e sugestão de imóveis compatíveis da própria conta.
4. **Agenda** — visitas e compromissos simples (dia/semana), ligados a imóvel e lead. É o que o assistente usa em "Minha agenda".
5. **WhatsApp** — status do assistente, vincular/desvincular o número do corretor, instruções de uso e o histórico das últimas ações feitas pelo WhatsApp.
6. **Enviar para meu CRM** — ver seção 7.
7. **Configurações** — perfil (nome, celular, CRECI, foto), dados da imobiliária (nome e logo opcionais, usados na página pública do imóvel), trocar senha, preferências (tema, mostrar endereço exato no link público), plano e assinatura (status do teste; pagamento "em breve"), exportar todos os meus dados e excluir minha conta (LGPD, com confirmação).

Também: busca global simples (Ctrl+K) por imóvel e lead, notificações básicas (lead novo, compromisso próximo) e uma página de **Ajuda** curta com o passo a passo.

**Remova** do BrokerBeetle tudo o que não está acima (financeiro, locação, propostas, chaves, jurídico, relatórios avançados, portal, roleta, permissões complexas). A pergunta guia é: "um corretor sozinho, no celular, precisa disso?". Se não, não entra.

## 6. Assistente de WhatsApp

Reaproveite o módulo de WhatsApp do simpliaosCRM (`SPEC-WHATSAPP.md`, `src/integrations/whatsapp`, `src/server/whatsapp`, `src/integrations/ai`, `src/domain/whatsapp`), adaptando para multi-conta:

- **Um número de assistente da plataforma** (Evolution própria do BrokerBeetle), compartilhado por todas as contas. Cada corretor vincula o **próprio** WhatsApp à **própria** conta pelo link de verificação (mesmo fluxo seguro do CRM). A partir daí, tudo que ele faz pelo WhatsApp vai para a conta dele.
- Um número de WhatsApp só pode estar vinculado a uma conta.
- Menu do assistente, só com o que existe no BrokerBeetle:
  1. 🏠 Cadastrar imóvel (fluxo completo com fotos, IA, capa e ordem, rascunho)
  2. 📸 Adicionar fotos a um imóvel
  3. 🔎 Buscar imóvel
  4. ✏️ Alterar status ou preço
  5. 👤 Novo lead
  6. 📅 Minha agenda
  7. 📤 Enviar para meu CRM (envia os itens pendentes, ver seção 7)
  8. 📊 Resumo do dia
- O link devolvido ao terminar um cadastro é a página pública do imóvel (`/i/...`) ou o link do painel.
- IA (Anthropic) igual ao CRM: `ANTHROPIC_API_KEY` opcional; sem a chave, modo passo a passo. Consumo de IA registrado **por conta**, com limite mensal configurável por plano (padrão generoso no teste) e aviso quando estiver perto do limite.
- Mesmas regras de segurança: só responde, não inicia conversas, ignora grupos, rejeita ligações, nunca manda nada para clientes.

## 7. Enviar para meu CRM (o "grudar")

O objetivo é levar imóveis e leads do BrokerBeetle para o CRM da imobiliária do corretor. Primeira versão, tudo funcional sem contratos com terceiros:

- **Exportar** imóveis e leads em CSV e Excel (todos, filtrados ou só os "ainda não enviados"), com colunas documentadas e um modelo de mapeamento simples.
- **Feed XML de imóveis no padrão VRSync** (o mesmo do CRM), em URL privada com token por conta, para CRMs e portais que importam por feed.
- **Webhook**: o corretor informa uma URL do CRM dele (e um segredo opcional). Ao criar ou alterar um imóvel ou lead, o BrokerBeetle envia um JSON documentado (POST, assinado com HMAC quando houver segredo), com retentativas pelo worker e log de entregas (sucesso/erro) na tela.
- **Marcação de envio**: cada imóvel e lead mostra "enviado ao CRM em dd/mm" ou "pendente", com o botão "marcar como enviado" e "enviar de novo".
- **Integrações diretas por API** com CRMs conhecidos do mercado (ex.: Jetimob, Vista, Kenlo/Ingaia, Imobzi, Tecimob, Arbo): crie a camada `src/integrations/crm/` com interface e mock, e mostre cada uma como **"em desenvolvimento"** (padrão de stub com aviso, como no CRM), sem chamar APIs reais.
- Documente o formato do CSV, do feed e do webhook numa página de Ajuda ("Como enviar para o seu CRM").

## 8. Planos e pagamento (preparar, não cobrar)

- Modelo de dados de **planos** (nome, preço mensal, limites: imóveis, fotos por imóvel, consumo de IA) e de **assinatura** da conta (teste, ativa, vencida, suspensa, com datas).
- Conta nova entra em **teste** (padrão 14 dias, configurável no `.env`). Ao vencer, mostra um aviso e deixa só leitura e exportação (os dados nunca são apagados por falta de pagamento).
- Camada `src/integrations/payment/` com interface e mock (padrão "em desenvolvimento"). Nenhuma cobrança real nesta etapa. O botão "Assinar" mostra o plano e "pagamento em breve".
- Os limites dos planos já são respeitados no servidor (mesmo que, por enquanto, todos os planos sejam o de teste).

## 9. Qualidade e segurança

- Testes unitários das regras reaproveitadas e novas (isolamento por conta, limites de plano, webhook com HMAC, exportação, feed).
- E2E (Playwright, desktop e celular): landing → criar conta → painel → cadastrar imóvel com fotos → link público → cadastrar lead → exportar CSV → configurar webhook (com receptor de teste) → trocar senha → sair/entrar; isolamento entre duas contas; fluxo do assistente pelo simulador do WhatsApp; conta em teste vencida fica só leitura.
- Rate limit no cadastro, no login, no link público e no webhook do WhatsApp. Headers de segurança, CSRF, upload só de imagens com limite de tamanho, nenhum segredo no front.
- `/api/health` com banco e worker.
- Seed de demonstração com 2 contas (cada uma com imóveis com fotos geradas localmente e leads) e um `reset-demo`. Liste os logins de demonstração no README.

## 10. Fases

| Fase | Escopo |
|---|---|
| 0 | Inspeção da VPS (RAM, disco, portas, containers), plano, novo repositório a partir do CRM, poda do que não entra, compose separado, banco, deploy em `brokerbeetle.simpliaos.online` com proxy no NPM, logo e identidade. |
| 1 | Multi-conta, cadastro/login/senha, área `/admin` da plataforma, layout do painel com barra lateral, Início (boas-vindas, primeiros passos, dashboard), Configurações. Testes de isolamento. |
| 2 | Imóveis completos (CRUD, fotos, status/preço rápido, lixeira, link público) e Leads completos (CRUD, status, interesse, compatíveis, wa.me). Agenda. |
| 3 | Assistente de WhatsApp multi-conta (Evolution própria, vínculo, menu, fluxos, IA por conta, limites). |
| 4 | Enviar para meu CRM: CSV/Excel, feed VRSync por conta, webhook com HMAC e log, marcação de envio, integrações diretas como "em desenvolvimento". |
| 5 | Landing page completa, planos e assinatura preparados (sem cobrança), termos e privacidade, SEO, ajuda, seed, E2E completo, revisão de segurança, README, backup/restore testados e conferência de todo o FEATURES.md. |

## 11. Entrega

Ao terminar, informe: URL, logins de demonstração e do admin da plataforma, como conectar o número do assistente (QR Code), o FEATURES.md todo `[x]` ou `[dev]` com justificativa, uso de RAM e disco do BrokerBeetle, e o que falta para ligar pagamento real e integrações diretas com CRMs.

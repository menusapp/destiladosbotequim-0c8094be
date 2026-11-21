# BrokerBeetle — Integração com o CRM da imobiliária do corretor

Complemento do `SPEC-BROKERBEETLE.md` (seção 7, "Enviar para meu CRM"). Leia o `CLAUDE.md` do projeto antes. Autonomia total dentro de `/opt/sistemas/brokerbeetle`; não mexa em nenhum outro sistema da VPS.

## 1. Objetivo
O corretor cadastra imóveis e leads no BrokerBeetle (painel ou WhatsApp) e eles vão para **o CRM que a imobiliária dele já usa**, na conta **dele** nesse CRM:
- **Manual:** clicar "Enviar para o CRM" (um item, vários ou todos os pendentes).
- **Automático:** ligado por ele, cada imóvel ou lead cadastrado já segue para o CRM sozinho.
- **Fácil:** o corretor só cola as credenciais, ou pede ao gestor que as informe, e a conexão é testada na hora.

Começamos com **um CRM, o Apresenta.me** (uma imobiliária vai testar). Vão existir vários CRMs, então a arquitetura é de **conectores**: acrescentar um CRM novo = escrever um conector, sem mexer no resto.

## 2. Regra de ouro: cada conta fala com a conta certa
- Uma `CrmConnection` pertence a **uma** conta do BrokerBeetle e guarda as credenciais **daquela pessoa** no CRM (o token do usuário dela, ou o do gestor, mas dedicado a ela).
- Tudo que a conta Gabriel envia para o CRM X sai com o token dele e deve ficar **atribuído ao usuário dele no CRM X** (responsável, captador). Nunca usar credenciais de uma conta para enviar dados de outra.
- Testes obrigatórios de isolamento: conta A nunca usa a conexão da B, nunca enxerga os itens enviados pela B, e o worker busca sempre a conexão pelo `accountId` do item.

## 3. Camada de conectores (`src/integrations/crm/`)
```ts
interface CrmConnector {
  key: string;                       // "apresenta"
  label: string;                     // "Apresenta.me"
  status: "ready" | "dev";           // dev = aparece como "em desenvolvimento"
  credentialFields: Field[];         // o que pedir ao corretor (rótulo, ajuda, tipo, secreto?)
  help: { whereToFind: Step[]; askManagerText: string; docsUrl?: string };
  hosts: string[];                   // hosts permitidos (anti-SSRF)
  testConnection(creds): Promise<{ ok: boolean; identity?: { name: string; id?: string }; permissions?: Record<string, boolean>; error?: FriendlyError }>;
  sendProperty(conn, property): Promise<{ remoteId: string; url?: string }>;   // idempotente
  sendLead(conn, lead): Promise<{ remoteId: string; url?: string }>;           // idempotente
  updateProperty?(conn, remoteId, property): Promise<void>;
  updateLead?(conn, remoteId, lead): Promise<void>;
}
```
- Registro em `src/integrations/crm/registry.ts`. Conectores **Mock** (para testes) e **Apresenta** (real). Os outros CRMs ficam listados como "em desenvolvimento" (use `<DevFeature>`): Jetimob, Vista (Loft), Kenlo, Imobzi, Tecimob, Arbo, CRM genérico por webhook.
- O envio por **webhook genérico** e o **CSV/feed** que já existem continuam, e aparecem na mesma tela como "Outras formas de enviar".
- Escreva `docs/COMO-ADICIONAR-UM-CRM.md` com o passo a passo para criar um conector novo (interface, campos, testes com servidor falso).

## 4. Dados (Prisma, migration nova)
- `CrmConnection`: `id`, `accountId`, `connector`, `status` (PENDING | CONNECTED | ERROR | DISABLED), `credentialsEnc` (JSON cifrado), `config` (JSON: ids resolvidos, mapeamentos), `identityName`, `identityRemoteId`, `autoSendProperties` (bool, padrão false), `autoSendLeads` (bool, padrão false), `sendUpdates` (bool, padrão true), `lastTestAt`, `lastError`, `createdAt`. Uma conexão ativa por conta e por conector (por enquanto uma por conta).
- `CrmSyncItem`: `id`, `accountId`, `connectionId`, `entity` (PROPERTY | LEAD), `entityId`, `remoteId`, `remoteUrl`, `status` (PENDING | SENDING | OK | FAILED | SKIPPED), `attempts`, `nextAttemptAt`, `lastError`, `payloadHash`, `sentAt`. Índice único `(connectionId, entity, entityId)`.
- `CrmInvite` (pedido ao gestor): `tokenHash`, `accountId`, `connector`, `expiresAt` (24 h), `usedAt`.
- **Credenciais cifradas** com AES-256-GCM e chave `CRM_SECRET_KEY` no `.env` (gere uma aleatória de 32 bytes, anote no `~/SECRETS-sistemas.txt`). Depois de salvas, nunca mostre de novo: só mascarado (`••••a1b2`). Nunca em log, auditoria, webhook ou resposta da API.
- Auditoria por conta: conexão criada/testada/removida, auto-envio ligado/desligado, envios em lote.

## 5. Experiência do corretor (mobile primeiro)
**Aba "Enviar para meu CRM"**, com três estados:
1. **Sem conexão:** cards dos CRMs ("Apresenta.me", e os "em breve" desabilitados) e o texto "Conecte o CRM da sua imobiliária e o que você cadastra aqui vai para lá, na sua conta". Botão **Conectar**.
2. **Assistente de conexão (3 passos curtos):**
   - Passo 1, **Credenciais:** campos do conector, cada um com "Onde encontro isso?" (instruções em passos). Dois caminhos: **Eu tenho** (cola e segue) ou **Pedir ao meu gestor** (gera uma mensagem pronta com as instruções, para copiar ou abrir no WhatsApp via `wa.me`, e opcionalmente um **link de uso único, válido por 24 h**, onde o gestor abre, vê o que precisa fazer, cola o token e pronto, sem criar conta; o token cai direto na conexão do corretor, cifrado).
   - Passo 2, **Testar:** botão que valida na hora e mostra **"Conectado como <nome do usuário no CRM>"** e quais permissões o token tem (✓ imóveis, ✓ leads). Se faltar permissão, mensagem em português dizendo exatamente o que pedir ao gestor. Erros amigáveis (token inválido, sem permissão, CRM fora do ar, limite de uso).
   - Passo 3, **Como enviar:** dois interruptores independentes, **"Enviar imóveis automaticamente"** e **"Enviar leads automaticamente"** (padrão desligados), e "Enviar também as alterações" (padrão ligado). Texto claro do que acontece em cada um.
3. **Conectado:** status da conexão, botões **Testar de novo**, **Trocar credenciais**, **Desconectar** (com confirmação; não apaga nada no CRM), os interruptores, o contador "X enviados · Y pendentes · Z com erro" e **"Enviar pendentes agora"**.

**Nas listas de Imóveis e Leads:**
- Selo por item: "Enviado ao CRM" (com link para abrir lá), "Pendente", "Erro: <motivo curto>" com **Tentar de novo**.
- Ação **Enviar para o CRM** no item e em seleção múltipla.
- Imóvel só pode ser enviado quando estiver "pronto" (campos mínimos do CRM, ver seção 6); se faltar algo, mostre exatamente o que falta.
- Lead enviado antes do imóvel de interesse: envie o imóvel primeiro, automaticamente.

**No WhatsApp:** a opção do menu "Enviar para meu CRM" envia os pendentes e responde com o resumo ("3 imóveis e 5 leads enviados; 1 com erro: motivo"). Se o corretor ainda não conectou, o assistente manda o link da tela de conexão. Quando o auto-envio estiver ligado, o assistente confirma no fim do cadastro: "✅ AP… cadastrado e enviado ao CRM".

## 6. Conector Apresenta.me (real)
Fonte: `https://apresenta.me/integracao-por-api/`, `https://ajuda.apresenta.me/books/integracoes/page/como-funcionam-e-como-configurar-os-webhooks` e a especificação OpenAPI completa em **`https://api.apresenta.me/docs.openapi`** (YAML, ~3 MB, 189 rotas; documentação visual em `https://api.apresenta.me/docs`). **Baixe a especificação e use-a como referência; não invente campos.** Resumo do que já foi levantado:

**Acesso**
- Base `https://api.apresenta.me`, autenticação `Authorization: Bearer <token>`. O token é de um **usuário** do Apresenta (inclusive "usuário de API"), com **permissões do grupo desse usuário**. Quem gera o token é a imobiliária (ou o suporte do Apresenta). **A API é contratada à parte**: se a imobiliária não tiver o módulo, a conexão falha com mensagem amigável pedindo para falar com o suporte do Apresenta.
- Limite: **300 requisições por minuto por token** (1.000 por empresa). Respeite `X-RateLimit-Remaining`; em **HTTP 429** espere o `Retry-After`. Mantenha-se bem abaixo (ex.: 120 req/min por conexão).
- Credencial a pedir ao corretor: **só o Token de API** (campo secreto). Ajuda na tela: "No Apresenta.me, peça ao administrador para criar um usuário do tipo API (grupo com permissão de cadastro de Imóveis e de Leads) e gerar o token. O gestor também pode pedir o token ao suporte do Apresenta."
- `testConnection`: descubra na especificação uma chamada leve para validar o token e identificar o usuário dono dele (por exemplo `GET /users` filtrado, ou o próprio retorno de `GET /buildings?...` com poucos campos) e como saber as permissões (as rotas dizem "🔒 permissão de cadastro de Imóveis/Leads"). Se não houver endpoint de "quem sou eu", use a melhor alternativa documentada e registre em DECISIONS.md.

**Lead** — `POST /persons/leads` (multipart/form-data; obrigatório `name`): `email`, `phone` (inteiro, só dígitos com DDD), `purpose` (change | rent | sale | season), `building_id` (imóvel de interesse no Apresenta), `origin` (texto) ou `origin_id`, `message`, `notes`, `notifyUsers`.
- Use `origin = "BrokerBeetle"` (o Apresenta cria a origem se não existir). Interesse do lead vai em `message` (texto legível) e `notes`; finalidade mapeada do perfil de busca do lead.
- **Atenção, ponto crítico:** cada lead "já gera um negócio no funil pela distribuição de leads da empresa (o id volta em `deal_id`)". Ou seja, o Apresenta pode distribuir o negócio para **outro** corretor. O requisito é que fique com o usuário da conta, então: após criar o lead, use **`PUT /deals/{deal_id}` com `responsible`** = id do usuário dono do token para atribuir o negócio a ele (confira o formato exato do campo `responsible` e as permissões na especificação). Se a API não permitir (permissão ou regra da empresa), **não esconda**: marque o item como enviado com aviso "enviado, mas o Apresenta distribuiu para outro responsável" e mostre isso no painel. Teste esse comportamento com o servidor falso e documente.
- Idempotência: guarde `remoteId` e `deal_id` em `CrmSyncItem`; um lead já enviado não é criado de novo (use `PUT /persons/leads/{id}` para alterações, se `sendUpdates`). Evite duplicar por nome + telefone/e-mail: pesquise antes com `GET /persons/leads?filter[phone]=...` / `filter[email]=...`.
- Para anexos, `files[]` é opcional; não envie nada que não seja necessário.

**Imóvel** — `POST /buildings` (multipart/form-data; obrigatórios `type_id` e `title`):
- `import_id` = a referência do BrokerBeetle (`BB-n`): é a chave de sincronismo. Se já existir, a API responde **422 com o id do imóvel existente**: nesse caso grave o `remoteId` e atualize com `PUT /buildings/{id}`.
- `pickup` (usuário que captou) e `responsible` (array de usuários responsáveis) = o usuário dono do token, para o imóvel ficar **na conta do corretor**.
- `type_id`: mapeie o tipo do BrokerBeetle (apartamento, casa, terreno…) para os tipos do Apresenta via `GET /buildings/types` (guarde o mapeamento em `config`; se faltar, tente casar por nome; se não casar, peça ao corretor para escolher uma vez numa lista e lembre a escolha).
- Localização: `country_id`, `state_id`, `city_id`, `district_id` vêm de `GET /dependency/locale/country|state|city|district` (busque pelo nome/UF do CEP do imóvel; se não existir, crie com `POST` desses mesmos recursos, se o token tiver permissão; senão, erro amigável). Endereço: `street`, `number`, `complement`, `zip_code`, `show_address` etc. (respeite a preferência de mostrar o endereço exato do BrokerBeetle).
- Características: `bedroom`, `suite`, `bathroom`, `garage`, `area_total`, `area_private`/`area_useful`, `furnishing`, `content` (HTML da descrição), `title`, `status` e demais campos que a especificação aceitar; mapeie só o que existe nos dois lados.
- **Valores** vão em outra rota: `POST /buildings/{building_id}/purposes` (JSON): `type` (venda/aluguel conforme a especificação), `amount`, `condominium`, `iptu_amount`, `currency` "BRL"… Crie uma finalidade por tipo (venda e/ou aluguel). Em alteração de preço use `PUT /buildings/{id}/purposes/{purposeId}`.
- **Fotos:** campo `images` (array de arquivos, multipart) e `principal` (foto principal = a capa do BrokerBeetle, já na ordem certa). Envie as fotos **sem marca d'água do BrokerBeetle** e respeitando o limite de tamanho; foto que falhar não derruba o imóvel (reenvio dedicado).
- Campos mínimos para considerar o imóvel "pronto para enviar": tipo, título, finalidade com valor, cidade/bairro (ou CEP resolvível) e ao menos 1 foto (configurável).
- Não envie dados do proprietário nem documentos internos.

**Webhooks do Apresenta** (a página de ajuda trata do webhook de **entrada** do Apresenta, que recebe leads de landing pages): não é necessário para esta integração, que usa a API. Mencione na tela de ajuda que o envio é feito pela API.

## 7. Envio, fila e confiabilidade
- Todo envio passa pelo **worker** (pg-boss), nunca na requisição do usuário nem no webhook do WhatsApp.
- Auto-envio: ao criar um imóvel ou lead (e ao concluir as fotos do imóvel), crie o `CrmSyncItem` PENDING se a conexão estiver CONNECTED e o interruptor ligado. Alterações posteriores (preço, status, dados) geram novo envio quando `sendUpdates` estiver ligado (compare `payloadHash`).
- Manual: botão cria/reativa os itens e dispara o processamento.
- Retentativas com espera crescente (1, 5, 15, 60 min, até 6 vezes) para erros temporários (5xx, 429, rede); erros definitivos (401, 403, 422 de validação) viram FAILED na hora com o **motivo traduzido** e o que o corretor deve fazer. 401/403 repetidos marcam a conexão como ERROR e avisam o corretor ("seu token do CRM parou de funcionar").
- Respeite o limite de requisições do CRM (fila por conexão, intervalo mínimo entre chamadas).
- Exclusão no BrokerBeetle **não apaga** nada no CRM; só marque o item. Aviso na tela de desconexão: "o que já foi enviado continua no CRM".
- Segurança: hosts permitidos fixos por conector (para o Apresenta, só `api.apresenta.me`), HTTPS obrigatório, timeouts, tamanho máximo de resposta, sem seguir redirecionamentos para outros hosts (anti-SSRF), sem credenciais em logs.

## 8. Admin da plataforma (`/admin`)
Nova seção "CRMs conectados": por conta, conector, status, último teste, itens enviados/pendentes/com erro e último erro (sem credenciais). Totais por conector.

## 9. Testes
- **Servidor falso do Apresenta** (HTTP local construído a partir da especificação OpenAPI): token válido/inválido, sem permissão, 429 com `Retry-After`, 422 de `import_id` repetido, criação de lead com `deal_id`, `PUT /deals/{id}` com `responsible`, finalidades, locais, upload de fotos.
- Unitários: cifra/decifra de credenciais, mapeamento de tipos e finalidades, formatação de telefone (só dígitos), `payloadHash`, retentativas, convite do gestor (uso único, expiração).
- Integração: auto-envio, manual, lote, alteração, falha temporária e definitiva, desconexão, dois corretores com conexões diferentes (isolamento), item de uma conta nunca usa conexão de outra.
- E2E (desktop e celular, contra o servidor falso): conectar com token, ver "Conectado como…", ligar auto-envio, cadastrar imóvel e lead, ver "Enviado", forçar erro e ver o motivo, "Pedir ao gestor" (gerar link, abrir em janela anônima, colar token), WhatsApp pelo simulador.
- Não use tokens reais em testes automatizados.

## 10. Entrega
- Fases: (1) modelo + cifra + camada de conectores + Mock + tela e assistente de conexão; (2) conector Apresenta + servidor falso + fila/worker + selos + manual + auto-envio; (3) pedido ao gestor + WhatsApp + admin + docs; (4) testes completos, revisão de segurança, README (seção "Integração com CRM" e "Como adicionar um CRM"), commit e push.
- Ao terminar, me diga exatamente: o que o corretor/gestor precisa fazer no Apresenta (passo a passo com os nomes certos das telas), como testar com um token real sem sujar o CRM (criar um imóvel e um lead de teste e como apagá-los lá, lembrando que apagar o lead não apaga o negócio), e o que ainda depende do Apresenta (por exemplo, se existe ambiente de testes).
- Atualize FEATURES.md, DECISIONS.md e RELATORIO.md.

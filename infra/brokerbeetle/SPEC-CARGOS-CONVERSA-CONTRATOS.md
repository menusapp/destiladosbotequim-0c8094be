# BrokerBeetle — Cargos, modo conversa, processos de locação e aprovação por WhatsApp

Complemento do `SPEC-BROKERBEETLE.md` e do `SPEC-CRM-INTEGRACOES.md`. Leia o `CLAUDE.md` do projeto antes. Autonomia total dentro de `/opt/sistemas/brokerbeetle`; backup antes de cada migration; nada fora dessa pasta (exceto o que o proxy já usa). Mantenha o número de WhatsApp fixo do Beetle (uma única Evolution, uma única instância): nada aqui exige outro número.

Trabalhe em fases (seção 9). Ao fim de cada fase: typecheck, lint, testes unitários, integração e E2E (nunca tocando na instância real do WhatsApp: use a Evolution falsa), build, deploy, teste no navegador no celular e no desktop, atualização de FEATURES.md, DECISIONS.md e RELATORIO.md, commit e push.

## 1. Tipos de conta e cargos

**Tipos de conta (`Account.type`):**
- `SOLO`, corretor autônomo: um único usuário com cargo `OWNER` e **todas as funcionalidades**, inclusive contratos e processos. Pode virar `AGENCY` ao contratar o plano de imobiliária (migração sem perda de dados).
- `AGENCY`, imobiliária: vários usuários com cargos.

**Cargos (`User.role`) na imobiliária:** `OWNER` (dono), `MANAGER` (gerente), `BROKER` (corretor). Deve existir sempre pelo menos um dono; mais de um dono é permitido. O código de hoje tem `OWNER`/`MEMBER`: migre `MEMBER` para `BROKER`.

**Equipe (nova aba, só para quem tem permissão):**
- Convidar membro: nome, e-mail, celular e cargo. O convite sai por link (copiar ou abrir no WhatsApp via `wa.me`), de uso único e válido por 7 dias; o convidado cria a própria senha. Alternativa: o dono cria o usuário com senha provisória (troca obrigatória no 1º acesso).
- Alterar cargo, desativar e reativar (sem apagar dados; desativar encerra sessões e desvincula o WhatsApp), remover.
- Limite de usuários vem do plano (seção 2). Ao passar do limite, mostre o preço do usuário extra e bloqueie o convite até ajustar o plano.
- Cada membro vincula o **próprio** WhatsApp (mesmo fluxo de verificação que já existe). O assistente age em nome daquele usuário, com as permissões do cargo dele.

## 2. Permissões (matriz editável pelo dono)

- **Módulos:** Imóveis, Leads, Agenda, Assistente de WhatsApp, Enviar para o CRM, Processos de locação e contratos, Aprovações, Relatórios/exportação, Equipe, Configurações da imobiliária, Plano e cobrança.
- **Ações:** ver, criar, editar, excluir, exportar, aprovar (onde fizer sentido).
- **Escopo (para ver/editar/excluir):** `só os meus` ou `todos da imobiliária`.
- **Padrão: tudo liberado para dono, gerente e corretor**, com escopo "todos da imobiliária". Exceções fixas, que só o dono tem e não são editáveis: Plano e cobrança, Equipe, excluir a conta e apagar definitivamente dados.
- O dono edita a matriz numa tela simples (cargos nas colunas, módulos e ações nas linhas, interruptores) e escolhe o escopo por cargo. Botão "restaurar padrão".
- **Regras no servidor, sempre:** toda Server Action, rota, job e ação do WhatsApp checa a permissão do usuário e aplica o escopo ("só os meus" filtra por `createdByUserId`/responsável). Esconder botão não basta. O `accountId` continua vindo da sessão ou do vínculo de WhatsApp, nunca do navegador.
- Imóveis e leads passam a ter `createdByUserId` (e `responsibleUserId` opcional) para o escopo funcionar; migre os existentes para o dono da conta.
- Testes: matriz de permissões por cargo e escopo (cada módulo e ação), tentativa de acesso cruzado entre contas e entre usuários com "só os meus", e o assistente de WhatsApp respeitando o cargo (opção do menu some ou é recusada com mensagem clara).

## 3. Planos, preços e limites
Atualize os planos (Mercado Pago em teste continua; produção só quando eu mandar) e a landing, o cadastro, termos, ajuda e e-mails:

| Plano | Mensal | Anual | Inclui |
|---|---|---|---|
| Autônomo (`SOLO`) | R$ 39,90 | R$ 479,90 | 1 usuário, todas as funções, até 20 processos de locação/contratos por mês |
| Imobiliária (`AGENCY`) | R$ 289,90 | R$ 3.480,00 | até 10 usuários, até 100 processos/contratos por mês |

- Usuário extra na imobiliária e contrato extra: **valores configuráveis no admin** (sugestão inicial: R$ 24,90 por usuário extra por mês; R$ 0,50 por processo extra). Deixe isso fácil de mudar e sinalize na entrega que eu preciso confirmar esses dois valores.
- Mostre sempre o valor por dia do autônomo no anual (R$ 1,31 por dia) e "menos de R$ 1,50 por dia" onde já existe. Remova qualquer menção ao plano antigo de R$ 59,90 / R$ 499,90 nas telas novas (planos já contratados continuam valendo).
- Limites de IA por conta, editáveis no admin por conta e por plano: fotos (já existe), conversa (turnos/mês), contratos e documentos (R$/mês). Valores iniciais: autônomo R$ 8 de IA de contratos/documentos e 600 turnos de conversa; imobiliária R$ 60 de contratos/documentos e 6.000 turnos de conversa por mês. Aviso em 80% e, no limite, a função de IA cai para o modo manual (menu e checklist sem leitura por IA), sem bloquear o resto.

## 4. Modo do assistente: Menu ou Conversa

- Cada usuário escolhe o modo: **Menu** (como hoje, com números) ou **Conversa** (agente). Padrão: Menu; a imobiliária define o padrão dos novos membros. Trocar a qualquer momento por mensagem ("modo conversa", "modo menu", "menu") ou em `/app/whatsapp`.
- **Conversa:** o corretor escreve normalmente ("oi, quais as opções?", "tem apê até 300 mil com 3 quartos no centro?", "muda o preço do AP12 para 2.800", "novo lead Carla 11 9...") e o assistente responde como numa conversa, sem menu.
- **Arquitetura híbrida (barata e segura), obrigatória:**
  1. Uma única chamada ao `claude-haiku-5-5` por mensagem devolve JSON `{intent, args}` de um **conjunto fechado de ferramentas**: `ajuda`, `buscar_imoveis` (filtros: finalidade, tipo, bairro/cidade, faixa de preço, quartos, vagas, área, aceita pet, texto livre), `ver_imovel`, `buscar_leads`, `criar_lead`, `cadastrar_imovel` (inicia o fluxo existente), `alterar_status_preco`, `agenda`, `resumo_dia`, `enviar_crm`, `processos` (listar/consultar status), `iniciar_processo`, `conversa_livre`.
  2. O **código** executa a ferramenta com o contexto e as permissões do usuário (os mesmos serviços do painel e do menu) e monta a resposta por **template** (até 5 resultados com código, título, valor e link; foto de capa do primeiro). Sem segunda chamada de IA para formatar.
  3. Segunda chamada curta só para pergunta livre, pedido ambíguo ou quando faltar dado ("em qual bairro?").
  4. **Ações que gravam** (criar, alterar, enviar, iniciar processo) sempre pedem confirmação com o resumo ("Vou mudar o AP12 para R$ 2.800. Confirma? sim/não").
- **Contexto curto:** últimas 6 mensagens e os últimos resultados, para entender "o segundo", "esse aí", "e com 2 vagas?".
- **Segurança:** o texto do usuário e o conteúdo de documentos são dados, nunca instruções; as ferramentas são fixas e filtradas pelo cargo (sem permissão = recusa educada, sem executar); nada fora da conta/escopo; limite de turnos por conta (seção 3) e antiabuso por usuário (ex.: 30 mensagens por 10 minutos); se a IA estiver desligada ou no limite, volta sozinho para o Menu com aviso curto.
- **Qualidade:** crie um conjunto de **60 frases reais em português** (informais, com erros de digitação, gírias, valores como "300 mil", "3q", "até 2k") com a intenção e os filtros esperados, rode contra o Haiku e me mostre a taxa de acerto por ferramenta, incluindo 10 tentativas de injeção de prompt. Só considere pronto com acerto alto; onde falhar, ajuste o prompt ou a validação sem trocar de modelo.
- Registre cada turno em `AiUsage` (feature `chat`) para o custo por conta aparecer no `/admin`.

## 5. Processos de locação e documentos
- Entidade **Processo de locação**: conta, criado por, imóvel (opcional), tipo do locatário (**PF** ou **PJ**), locatário, **fiador** (0 ou mais, PF), status (`RASCUNHO`, `DOCUMENTOS`, `EM_APROVACAO`, `APROVADO`, `REPROVADO`, `CONTRATO`, `CONCLUIDO`, `CANCELADO`), valores (aluguel, condomínio, IPTU, seguro incêndio, quem paga o quê), prazos, garantia, corretor responsável e histórico.
- **Checklist de documentos por tipo**, com os itens do Apêndice A como padrão. A imobiliária (dono ou quem tiver permissão) pode editar os modelos de checklist; autônomo usa o padrão. Cada item tem estado `PENDENTE`, `RECEBIDO` e `CONFERIDO`.
- **Envio dos documentos** pelo painel (arrastar) e pelo **WhatsApp** (foto ou PDF; o assistente pergunta de qual processo, ou usa o último aberto). Para cada arquivo, o Haiku (tarefa `classificar_documento`) devolve tipo, titular, período/data e legibilidade; o sistema associa ao item do checklist e **valida por código**: holerite e extrato dos 3 últimos meses, comprovante de residência com no máximo 3 meses, matrícula atualizada (data da certidão informada e dentro do prazo definido pela imobiliária), titular compatível com o locatário/fiador. Dúvida ou ilegível: o item fica `RECEBIDO` (a conferir) e o corretor é avisado do que fazer. **A IA nunca marca `CONFERIDO` sozinha**: quem confere é uma pessoa (botão), a não ser que a imobiliária ligue a conferência automática por regra para os itens de data.
- **Regra do checklist:** todos os documentos obrigatórios devem estar recebidos **antes** de iniciar a consulta de crédito (SPC, Serasa, Dossiê Total) e antes de pedir aprovação. O botão "Iniciar consulta de crédito" só libera com o checklist completo; a consulta automática continua `[dev]` (registro manual do resultado e anexo).
- Taxas cobradas junto ao aluguel (seguro incêndio obrigatório e IPTU) são campos do processo e do resumo.
- Privacidade (LGPD): arquivos em `uploads/accounts/<accountId>/processos/…`, acesso só por quem tem permissão, nunca públicos; CPF mascarado em listas, resumos e logs; retenção configurável pela imobiliária; **a imobiliária pode desligar a leitura por IA dos documentos** (checklist manual). Atualize a política de privacidade explicando que imagens e textos de documentos são enviados à Anthropic para classificação.
- **Minutas de contrato:** modelos-base (locação residencial, locação comercial, aditivo, recibo) como templates com campos, marcados "revisar com advogado", editáveis pela imobiliária. O contrato é montado **por código**; a IA só faz as tarefas do prompt-base (seção 7). Aviso fixo: "minuta gerada automaticamente, revise antes de assinar". Valor por extenso e validações (CPF/CNPJ, datas, valores) por funções próprias.
- WhatsApp: opções do menu "Processos" e as ferramentas `processos`/`iniciar_processo` na conversa: criar, ver status e pendências ("faltam 2 holerites e a matrícula"), mandar documento, pedir aprovação.

## 6. Aprovação por WhatsApp (por imobiliária)
- **Configuração por conta de imobiliária:** exigir aprovação (padrão ligado) e **aprovador** (nome e celular; opcionalmente um segundo, em ordem). Eu defino o aprovador padrão de cada imobiliária na implantação pelo `/admin` (campo na conta); o dono também pode alterar, com confirmação por código enviado ao número novo.
- **Opt-in do aprovador (importante para não derrubar o número):** o assistente **não inicia conversa com número que nunca falou com ele**. Ao cadastrar o aprovador, o sistema gera um link `wa.me` e uma mensagem ("Para receber aprovações da Imobiliária X, envie ATIVAR para o BrokerBeetle"); só depois que o aprovador mandar `ATIVAR` o número fica `VERIFICADO` e passa a receber pedidos. Esse envio é transacional, de baixo volume, só para aprovadores verificados; registre essa decisão em DECISIONS.md e mantenha os limites de ritmo.
- **Fluxo:**
  1. O corretor pede aprovação (painel, menu ou conversa). O sistema valida (checklist completo, campos obrigatórios sem `[PREENCHER]`, sem conflitos).
  2. O Haiku gera o resumo (tarefa `resumo_aprovacao`), com CPF e telefone mascarados.
  3. O resumo vai ao WhatsApp do aprovador com um **código curto** (ex.: `#A7K2`), terminando com "Responda SIM ou NÃO (pode acrescentar o motivo)".
  4. **A resposta é interpretada por código**, não por IA: sim/aprovado/aprovo/ok/pode → aprovado; não/reprovado/nego → reprovado, com o resto do texto como motivo. Com mais de um pedido pendente, a resposta precisa do código (`SIM A7K2`); sem código, o assistente pergunta qual. Resposta ambígua: pergunta de novo, nunca decide.
  5. O assistente confirma ao aprovador ("Registrei: APROVADO — processo #A7K2") e permite `DESFAZER` por 2 minutos.
  6. O corretor solicitante é avisado por WhatsApp e no painel ("✅ Aprovado" ou "❌ Não aprovado: motivo"), e o status do processo muda.
  7. Sem resposta: lembretes em 12 h e 24 h; expira em 48 h e avisa o corretor, com opção de reenviar.
- **Segurança:** só aprovadores `VERIFICADOS` da própria conta valem (normalizando JID/LID e nono dígito); o aprovador não pode ser o solicitante; a resposta de uma conta nunca afeta outra; tudo auditado (quem, número, hora, texto, resultado); conteúdo de documentos nunca é tratado como instrução; aprovar também é possível pelo painel por quem tiver a permissão "aprovar".
- Testes: fluxo completo com Evolution falsa (opt-in, pedido, SIM, NÃO com motivo, código com 2 pendentes, ambígua, desfazer, expiração, número não verificado ignorado, aprovador de outra conta, solicitante tentando aprovar).

## 7. IA de contratos e documentos (Haiku, prompt-base fixo)
- Modelo `claude-haiku-5-5` (`AI_MODEL_CONTRACTS`), sem mudar para Sonnet sem eu pedir.
- Prompt de sistema fixo e cacheado: use o arquivo `infra/brokerbeetle/prompts/contratos-base.md` do repositório de documentação (baixe com o `gh api` abaixo) e guarde versionado em `src/integrations/ai/prompts/`. Tarefas: A extrair dados, B escolher cláusulas, C resumir contrato, D conferir minuta, E classificar documento, F resumo para aprovação. Saída sempre em JSON validado com zod; falhou a validação, uma retentativa e depois pergunta ao usuário.
- Limites e custo por conta como na seção 3, tudo registrado em `AiUsage` (features `contract`, `document`, `approval`, `chat`) e visível no `/admin`.
- Conjunto de testes com 40 casos (extração, cláusulas, resumo, conferência, classificação de documentos com fotos de exemplo geradas localmente, tentativas de injeção dentro de documentos) e taxa de acerto por tarefa antes de liberar.

## 8. Apêndice A — checklists padrão de documentos (editáveis)

**Locatário pessoa física**
- RG e CPF
- 3 últimos holerites
- Carteira de trabalho ou documentos que comprovem o vínculo empregatício
- 3 últimos meses do extrato bancário (se não houver holerite)
- Imposto de renda do ano atual
- Certidão de nascimento ou casamento

**Locatário pessoa jurídica**
- Contrato social e todas as alterações
- Cartão CNPJ
- Relação de faturamento dos últimos 6 meses (assinada pelo contador)
- Documentos pessoais dos sócios: CPF, RG, certidão de casamento ou nascimento e comprovante de renda (declaração de IR do ano atual, 3 holerites ou 3 meses de extrato)
- Imposto de renda da empresa

**Fiador (pessoa física)**
- RG e CPF, também do cônjuge
- Certidão de casamento (ou de nascimento, se solteiro)
- 3 últimos holerites, ou 3 últimos extratos bancários se não houver holerite
- Imposto de renda do ano atual
- Carteira de trabalho ou documentos que comprovem o vínculo empregatício
- Matrícula atualizada do imóvel próprio, quitado e registrado em cartório
- Comprovante de residência atualizado (no máximo 3 meses)

**Regra:** providenciar todos os documentos antes de iniciar a consulta de crédito (SPC, Serasa e Dossiê Total).
**Cobrado junto com o aluguel:** seguro incêndio obrigatório e IPTU.

(O texto veio de um modelo de uma imobiliária parceira. Use só o conteúdo, sem o nome, a marca, o telefone ou o endereço dela.)

## 9. Fases
1. Contas `SOLO`/`AGENCY`, cargos, aba Equipe (convites), matriz de permissões editável e escopo "só os meus", migração de `MEMBER`, testes de permissão e isolamento.
2. Planos, preços, limites (usuários, processos e IA por conta), landing, cadastro, termos, ajuda, admin com tipo de conta e consumo.
3. Modo Conversa híbrido + preferência de modo + 60 frases de teste e taxa de acerto.
4. Processos de locação, checklists, upload (painel e WhatsApp), classificação de documentos pelo Haiku e validações em código.
5. Minutas, resumo e conferência de contratos, prompt-base e conjunto de 40 testes.
6. Aprovação por WhatsApp (opt-in, resumo, SIM/NÃO, notificação ao corretor, expiração) e aprovação no painel.
7. Testes completos (unitários, integração, E2E celular e desktop), revisão de segurança e isolamento, README, FEATURES.md, DECISIONS.md e RELATORIO.md.

## 10. Entrega
Ao terminar me diga: o que mudou para o dono, o gerente e o corretor; como cadastrar a imobiliária e o aprovador padrão no `/admin`; o custo medido por turno de conversa, por documento e por processo completo, com a estimativa mensal (dólar a R$ 6,00); as taxas de acerto dos testes; os valores que eu preciso confirmar (usuário extra e processo extra); e o que depende de mim ou de um advogado.

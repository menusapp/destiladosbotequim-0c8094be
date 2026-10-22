# simpliaosCRM — Especificação completa para o Claude Code

Este documento é a especificação do simpliaosCRM, um sistema completo de gestão para imobiliárias brasileiras. Leia tudo antes de escrever qualquer código.

> **Ajustes para a VPS atual (valem por cima do texto abaixo):** leia também a seção "AJUSTES DA VPS" no fim deste arquivo. Onde houver conflito, os ajustes vencem.

## 0. Como você (Claude Code) deve trabalhar

- Leia este arquivo inteiro primeiro. Depois inspecione o ambiente (seção 2), monte o plano de fases (seção 12) e registre-o em `PLAN.md`.
- Crie `FEATURES.md` na raiz com um checklist de TODAS as funcionalidades das seções 7 e 8. Cada item recebe um status:
  - `[ ]` pendente
  - `[~]` parcial
  - `[x]` pronto e testado
  - `[dev]` em desenvolvimento (stub com aviso, ver seção 5)
- Atualize ao fim de cada fase. Esse arquivo é a fonte da verdade para retomar o trabalho em outra sessão.
- Crie `CLAUDE.md` com a stack, os comandos (dev, test, build, seed, deploy, backup), as convenções e o mapa de pastas.
- Registre em `DECISIONS.md` toda decisão técnica relevante que você tomar sozinho.
- Trabalhe por fases. Ao fim de cada fase:
  - rode typecheck, lint, testes e build do Docker;
  - faça commit no git com mensagem descritiva;
  - só avance com tudo verde.
- Não corte escopo por conta própria. Não remova nem simplifique funcionalidades para "caber". Se algo for inviável, marque no FEATURES.md com justificativa e avise.
- Não mexa em nada fora da pasta do projeto na VPS sem autorização (ver exceções em "AJUSTES DA VPS"). Isso inclui outros containers, nginx/apache, firewall, usuários do sistema, cron do host e pacotes do sistema.
- Pergunte só quando estiver realmente bloqueado. Nas demais decisões, escolha o padrão sensato e registre.

**Definição de "funcional":**
- a tela existe e salva no banco;
- valida os dados no cliente e no servidor;
- permite listar, filtrar, editar e excluir (exclusão lógica);
- respeita as permissões;
- gera o documento ou relatório correspondente;
- tem pelo menos um teste.

Tela bonita sem persistência não conta como pronta.

## 1. Contexto e objetivo

O simpliaosCRM cobre:
- CRM de atendimento e vendas
- Gestão de imóveis
- Administração de locação: cobrança, repasses, reajustes e rescisões
- Aluguel garantido
- Financeiro da imobiliária
- Jurídico
- Site público
- Portal do cliente (proprietário, inquilino e investidor)

É um protótipo para testes internos, mas deve ser construído com qualidade de produção (arquitetura, segurança, integridade dos dados), porque vai evoluir para produto. Tudo que for possível fazer sem serviços pagos de terceiros deve ficar 100% funcional. O que depende de API ou contrato com terceiros segue o padrão "em desenvolvimento" da seção 5.

## 2. Ambiente de execução (VPS, isolado)

**Isolamento.** O sistema roda numa VPS Linux que já tem outros serviços, e deve ficar totalmente isolado deles:
- Tudo em Docker Compose, com projeto nomeado `simpliaoscrm`, rede própria e volumes próprios (prefixo `simpliaoscrm_`).
- Pasta: ver "AJUSTES DA VPS".

**Inspeção inicial, antes de qualquer coisa:**
- sistema operacional;
- Docker e Compose;
- RAM, CPU e disco livres;
- portas em uso (`ss -tulpn`);
- containers existentes (`docker ps`).

**Rede e recursos:**
- Só a porta do app fica publicada (em 127.0.0.1, ver ajustes). Postgres e serviços internos ficam sem porta exposta.
- Defina limites de memória nos containers compatíveis com a VPS.
- Logs do Docker com rotação (max-size / max-file).

**Cookies e proxy:**
- Variável `COOKIE_SECURE` (true quando atrás de HTTPS).
- Variável `TRUST_PROXY` para respeitar os cabeçalhos `X-Forwarded-*`.
- Se algum dia rodar sem HTTPS, mostrar aviso discreto aos administradores: "Conexão sem HTTPS — use apenas dados de teste".

**Configuração:**
- Tudo via `.env`, com um `.env.example` documentado. Nunca commite o `.env`.

## 3. Stack

Use as versões estáveis atuais de cada ferramenta.

**Aplicação**
- Next.js (App Router) + TypeScript estrito, com front e back no mesmo app (Server Actions e Route Handlers).
- PostgreSQL + Prisma, com migrations versionadas.
- UI: Tailwind CSS + shadcn/ui, ícones lucide, gráficos com Recharts e tabelas com TanStack Table.
- Formulários: react-hook-form + zod. O mesmo schema valida no cliente e no servidor.

**Autenticação (implementação própria)**
- Sessões guardadas no banco.
- Cookie httpOnly com SameSite=Lax.
- Senhas com argon2id.
- Rate limit no login e bloqueio temporário após várias tentativas.
- Troca obrigatória da senha inicial.
- O portal do cliente usa a mesma base, com papéis externos.

**Serviços de apoio**
- Worker em container separado (mesmo código) para tarefas agendadas e filas, com pg-boss (fila no próprio Postgres, sem Redis).
- Arquivos (fotos e documentos) em volume local `/data/uploads`:
  - servidos por rota autenticada, exceto as fotos públicas de imóveis publicados;
  - sharp para miniaturas, compressão e marca d'água.
- PDFs: HTML/CSS de impressão convertido por um container Gotenberg (Chromium headless). Assim o PDF fica igual à tela.

**Qualidade e operação**
- Testes: Vitest para regras de negócio e cálculos, Playwright para os fluxos ponta a ponta (headless).
- Logs estruturados com pino.
- Healthcheck em `/api/health`.
- Tempo real (chat e notificações) com Server-Sent Events ou WebSocket.

## 4. Regras gerais de produto

**Idioma e formatos**
- Interface 100% em português do Brasil. Código, tabelas e variáveis em inglês.
- Moeda: R$ 1.234,56. Datas: dd/mm/aaaa. Fuso: America/Sao_Paulo.
- Valores monetários em centavos (inteiro) ou Decimal. Nunca float.
- Máscaras e validação com dígito verificador: CPF, CNPJ, CEP, telefone, celular, e-mail e CRECI.
- Valor por extenso automático (reais e centavos) disponível nos documentos.

**Listagens**
- Toda listagem tem busca, filtros, ordenação e paginação no servidor.
- Toda listagem permite exportar para CSV e Excel, e imprimir.

**Exclusão e auditoria**
- Exclusão sempre lógica, com lixeira restaurável pelo administrador.
- Toda criação, alteração e exclusão grava quem fez, quando e o diff antes/depois.
- Cada registro tem uma aba "Histórico". Existe também uma tela global de auditoria.

**Multiunidade**
- Matriz e filiais. Todo registro pertence a uma unidade, e a visibilidade segue as permissões.

**Interface**
- Responsiva: o corretor usa no celular.
- Tema claro e escuro, sidebar por módulo.
- Busca global (Ctrl+K) por imóvel, pessoa, contrato e código.
- Notificações internas (sino) para tarefas, vencimentos, leads novos, reajustes, chaves atrasadas e exclusividades vencendo.

**WhatsApp sem API (funcional, não é stub)**
- Botões que abrem `https://wa.me/55DDDNUMERO?text=...` com mensagem pronta e editável por modelo.
- Usos: confirmação de visita, cobrança, 2ª via, envio de seleção de imóveis, pesquisa de satisfação, convite ao portal.

**E-mail**
- Envio via SMTP configurável no `.env`. Funciona quando configurado.
- Sem configuração, os botões de e-mail mostram aviso e oferecem a alternativa por WhatsApp.

**LGPD básica**
- Consentimento registrado no cadastro de pessoas.
- Exportar e anonimizar os dados de uma pessoa.
- Log de acesso a dados sensíveis.

## 5. Padrão para funcionalidades que dependem de terceiros ("em desenvolvimento")

As funções da seção 8 precisam existir no sistema — telas, campos, fluxo e dados — mas com a integração simulada:

**Camada de integração**
- Pasta `src/integrations/<nome>/` com uma interface (ex.: PaymentProvider, InvoiceProvider, SmsProvider, CreditCheckProvider, SignatureProvider).
- Cada uma tem uma implementação Mock e espaço para a implementação real.
- A implementação usada é escolhida por variável de ambiente.

**Painel de controle**
- Tela Administração → Integrações com o status de cada uma (desativada, simulada ou ativa) e o que falta para ativar.

**Na interface**
- Selo amarelo "Em desenvolvimento" ao lado do botão ou item de menu.
- Ao clicar, abre um modal: "Esta funcionalidade está em desenvolvimento e depende de integração com [serviço]. Nada será enviado ou cobrado de verdade. Deseja simular?"
- Ao confirmar, roda o mock, gerando dados fictícios plausíveis para testar o fluxo inteiro.

**Marcação do que é simulado**
- Tudo gerado por mock recebe `isSimulated = true`.
- Aparece com a tarja SIMULADO em telas, documentos e PDFs.
- Nunca entra em relatórios fiscais (DIMOB, informes de rendimento).

## 6. Perfis e permissões

**Papéis internos padrão (editáveis):** Administrador, Gerente, Corretor, Atendente/Balcão, Captador, Financeiro, Jurídico.

**Papéis externos (portal):** Proprietário, Beneficiário, Inquilino, Investidor.

**Regras de permissão:**
- Permissões granulares por módulo e ação: ver, criar, editar, excluir, exportar e aprovar.
- Cada permissão tem um escopo: "só os meus", "minha unidade" ou "todas".
- Tela de matriz de permissões para editar papéis.
- Proteção de carteira: o corretor só vê os contatos completos dos próprios clientes (configurável).
- A permissão é checada no servidor em toda Server Action e rota. Esconder botão não basta.

## 7. Funcionalidades (todas devem ficar funcionais)

### 7.1 Painel

Indicadores do dia: leads novos; visitas agendadas; propostas abertas; contratos vencendo; cobranças vencidas; repasses a fazer; reajustes do mês; chaves fora; exclusividades vencendo.

Gráficos: funil de conversão; captações por mês; locações x rescisões; inadimplência 30/60/90; receita da imobiliária.

O painel se adapta ao papel do usuário.

### 7.2 Imóveis

**Cadastro completo**
- Finalidade: venda, locação ou ambos.
- Tipo: casa, apartamento, sala, loja, terreno, galpão, rural etc.
- Endereço:
  - preenchido automaticamente pelo CEP via ViaCEP, com fallback na BrasilAPI;
  - coordenadas por geocodificação no Nominatim/OpenStreetMap, respeitando a política de uso (1 requisição/s, User-Agent próprio, cache);
  - pino ajustável manualmente no mapa.
- Características: quartos, suítes, banheiros, vagas, área útil e total, andar, mobiliado, aceita pet, posição solar etc.
- Comodidades: lista configurável.
- Valores: venda, aluguel, condomínio, IPTU e outras taxas, com histórico de alterações de preço.
- Proprietários: um ou mais, com percentual de cada um.
- Documentação: matrícula, cartório, inscrição de IPTU e documentos anexos.
- Código de referência automático e configurável (ex.: AP0001, CA0001).
- Captador e cadastrador registrados.
- Proteção de captação: o captador mantém a captação vinculada a ele (para a comissão) por um prazo configurável.

**Status do imóvel:** disponível; reservado; em negociação; suspenso; alugado; vendido; indisponível; a vagar (com data prevista de desocupação); captação pendente.

**Fotos**
- Ilimitadas, com upload múltiplo por arrastar.
- Reordenação por arrastar, legenda e escolha da foto de capa.
- Compressão automática e miniaturas.
- Marca d'água automática com o logo da imobiliária (posição e opacidade configuráveis). O original fica guardado sem marca.

**Mídia e descrição**
- Campo para link de vídeo (YouTube) e tour 360.
- Gerador de descrição a partir das características, por modelo de texto (sem IA), editável.

**Publicação e exclusividade**
- Bloquear para o site: o imóvel não aparece no site público nem no feed XML.
- Exclusividade: com ou sem, datas de início e fim, documento anexo, alerta antes do vencimento.

**Placas e faixas**
- Tipo, data de instalação e retirada, foto e responsável.
- Relatório de placas ativas.

**Selo de qualidade da captação**
- Nota de 0 a 100 calculada automaticamente com base em: fotos mínimas, descrição, documentos, valores completos, coordenadas e exclusividade.
- Mostra dicas do que falta para melhorar a nota.

**Prevenção de duplicidade**
- Alerta ao cadastrar um imóvel com mesmo CEP + número + complemento, ou com a mesma matrícula.

**Atualização de captações**
- Imóveis sem atualização há X dias (configurável) geram uma tarefa para o captador confirmar com o proprietário a disponibilidade e o valor.
- Relatório de captações desatualizadas.

**Controle de lançamentos (empreendimentos na planta)**
- Cadastro do empreendimento com torres e blocos.
- Tabela de unidades com status (disponível, reservada, vendida).
- Tabela de preços e espelho de vendas visual.

**Busca inteligente**
- Filtros combinados: tipo, bairro, faixa de valor, quartos, vagas, área e características.
- Busca por texto livre e busca por área no mapa.
- Buscas salvas.
- Match imóvel x cliente nos dois sentidos: ao cadastrar um imóvel, avisa os corretores dos clientes cujo perfil combina; no cliente, lista os imóveis compatíveis.

**Mapas**
- Mapa de imóveis com Leaflet + OpenStreetMap.
- Em cada imóvel, botões "Abrir no Google Maps" e "Street View" (links, sem API).

**Material impresso**
- Listagem para o balcão: selecionar imóveis e gerar um PDF em formato de vitrine (foto, código, valores e características).
- Etiquetas: impressão em folhas de etiqueta padrão (modelos Pimaco configuráveis) para pastas, chaves e mala direta.

**Anúncios**
- Por imóvel: onde está anunciado (site, portais, jornal, redes, placa), período e custo.
- Esses dados alimentam o relatório de mídias.

### 7.3 Pessoas (cadastro único)

**Cadastro**
- Pessoa física ou jurídica, com um ou mais papéis: cliente interessado, proprietário, inquilino, fiador, beneficiário, investidor, fornecedor, advogado ou corretor parceiro.
- Dados completos:
  - documentos (CPF, RG/CNH ou CNPJ/IE);
  - estado civil e regime de bens;
  - cônjuge (pessoa vinculada);
  - profissão, empregador e renda;
  - vários endereços (com CEP automático), telefones e e-mails;
  - dados bancários e chave PIX (para repasse);
  - referências pessoais e comerciais;
  - documentos digitalizados.
- Perfil de busca do cliente (o que ele procura), usado no match com imóveis.
- Origem do contato obrigatória (jornal, TV, internet, portal, indicação, placa etc.).

**Controles**
- Duplicidade: bloqueia CPF/CNPJ repetido e alerta quando nome + telefone forem parecidos com um cadastro existente.
- Lista negra: marca a pessoa com motivo, data e responsável. Um alerta vermelho aparece sempre que ela surgir em atendimento, proposta ou contrato.
- Proteção de cadastros: o cliente fica vinculado ao corretor por um prazo configurável. Passado o prazo sem interação, ele volta para a roleta.
- Atualização de cadastros: pessoas com contrato ativo e cadastro antigo geram uma tarefa de atualização.
- Consentimento LGPD.

### 7.4 Edifícios, condomínios e administradoras
- Edifícios e condomínios: endereço, síndico, portaria, infraestrutura e fotos.
- Administradoras de condomínio: contatos e dados bancários.
- Um imóvel vinculado a um condomínio herda o endereço e a infraestrutura dele.

### 7.5 Atendimento e CRM

**Atendimentos**
- Cada atendimento registra: canal (presencial, telefone, WhatsApp, site, portal, e-mail); cliente e interesse; imóveis apresentados; corretor responsável; status e próximo passo.
- Tela de acompanhamento com tudo em aberto.

**Roleta de corretores**
- Distribuição automática de leads em rodízio.
- Regras:
  - só entram corretores presentes, com check-in e check-out de plantão;
  - por especialidade (venda ou locação), por unidade e por peso.
- Prazo para aceitar o lead: se estourar, o lead passa para o próximo corretor.
- Histórico completo da roleta.

**Funil de conversão**
- Etapas configuráveis. Padrão: Novo → Contato → Visita → Proposta → Negociação → Fechado/Perdido.
- Visualização em Kanban com arrastar.
- Motivo obrigatório quando o lead é perdido.

**Follow-up**
- Tarefas com data e hora, lembretes e destaque para as atrasadas.
- Régua automática configurável: ex.: lead sem contato em 24h gera uma tarefa.

**Ordens de atendimento**
- Solicitações internas (vistoria, manutenção, avaliação, cópia de chave) com responsável, prazo, status e acompanhamento.

**Ocorrências**
- Registro por contrato, imóvel ou pessoa: reclamação, manutenção, aviso.
- Linha do tempo das ocorrências.

**Agenda**
- Individual e da equipe, com visões de dia, semana e mês.
- Visitas, compromissos e vistorias.
- Alerta de conflito de horário.
- Botão de confirmação de visita por WhatsApp.

**Agenda de visita pelo site**
- O visitante escolhe um horário disponível no site público, o que cria um pré-agendamento para aprovação da equipe.

**Controle de atendimento telefônico e relatório de ligações**
- Botão flutuante para registro rápido: quem ligou, para quem, duração, assunto e resultado.

**Chat online**
- Widget no site público: o visitante conversa com a equipe em tempo real e a conversa vira um lead automaticamente.
- Chat interno entre os usuários.

**Ações comerciais**
- Campanhas com público, período, custo, meta e resultado (leads e negócios gerados).

**Pesquisa de avaliação de atendimento**
- Após um atendimento ou fechamento, o sistema gera um link público de pesquisa, enviado por WhatsApp.
- Critérios de 1 a 5: tempo, solução e cordialidade, mais um comentário livre.
- Relatório por colaborador.

**Melhor rota para visita**
- Selecionar as visitas do dia.
- O sistema ordena as paradas pela menor distância (vizinho mais próximo, usando as coordenadas).
- Abre o Google Maps com as paradas em sequência, por link de direções, sem API.

### 7.6 Propostas, reservas, visitas e chaves

**Declaração de visita**
- PDF com cliente, imóveis visitados, data e corretor, para assinatura. Serve para proteger a comissão.

**Proposta de venda**
- Valor e forma de pagamento: à vista, financiamento, FGTS, permuta ou parcelas.
- Condições e validade.
- Contrapropostas, com histórico de versões e status.
- PDF.

**Proposta de locação**
- Valor, garantia pretendida, data de entrada e condições.
- Checklist de documentos.
- Análise, com aprovação ou reprovação.
- PDF.
- Ao aprovar, cria o contrato de locação pré-preenchido.

**Reserva de imóvel**
- Reserva por X dias (configurável) para um cliente.
- Impede outras reservas no período.
- Expira automaticamente.

**Saída de chave**
- Retirada: quem, documento, imóvel e horário.
- Devolução: prazo e registro da entrega.
- Alerta de chaves atrasadas.
- Quadro de chaves com a posição no claviculário.
- Termo de retirada em PDF.

### 7.7 Documentos e modelos

**Editor de modelos**
- Editor rich text com variáveis (`{{locatario.nome}}`, `{{imovel.endereco}}`, `{{contrato.valor_extenso}}` etc.).
- Painel lateral com as variáveis disponíveis, inseridas por clique.

**Modelos padrão já incluídos** (todos marcados como "revisar com advogado"):
- Contratos de locação residencial e comercial
- Contrato de administração
- Procuração
- Termo de vistoria (entrada e saída)
- Termo de entrega de chaves
- Termo de rescisão
- Contrato de acordo de dívida
- Aditivos
- Contrato de intermediação de venda
- Contrato e distrato de corretor parceiro
- Cartas de cobrança (locatário e fiador)
- Notificação de reajuste
- Declaração de visita
- Recibo

**Geração e arquivo**
- Gerar um documento produz um PDF que fica salvo automaticamente nos documentos do registro.

**Documentos em nuvem (arquivo digital)**
- Repositório por pessoa, imóvel e contrato, com pastas e tipos.
- Validade de documentos, com alerta (ex.: certidões vencendo).
- Pré-visualização.

### 7.8 Administração de locação

**Contrato de locação**
- Partes: imóvel, locador(es) com percentual, beneficiário(s) de repasse (podem ser diferentes do proprietário), locatário(s) e fiador(es).
- Prazos e valores: valor, dia de vencimento, início, fim e prazo.
- Reajuste: índice e mês de reajuste.
- Taxas da imobiliária: taxa de administração (%); taxa de intermediação (primeiro aluguel).
- Atraso: multa, juros e correção configuráveis por contrato. Padrão sugerido: multa de 10% e juros de 1% ao mês pró-rata dia.
- Outras condições: desconto de pontualidade; quem paga IPTU, condomínio e seguro incêndio.

**Modalidades de garantia**
- fiador
- caução em dinheiro (com aviso do limite legal de 3 aluguéis, art. 38 §2º da Lei 8.245/91)
- seguro fiança
- título de capitalização
- sem garantia
- aluguel garantido (seção 7.10)

**Complemento de caução**
- Quando o aluguel é reajustado, o sistema calcula a diferença da caução e gera a cobrança do complemento.

**Geração mensal das cobranças** (feita pelo worker), incluindo:
- aluguel, com proporcional de dias no primeiro e no último mês;
- condomínio;
- IPTU parcelado;
- consumo, quando repassado pela imobiliária;
- seguro;
- descontos e créditos/débitos avulsos.

**Contas de consumo**
- Água, energia, condomínio e IPTU por imóvel.
- Vencimento, valor, quem paga e comprovante.
- Alerta de conta não paga.

**Recebimento (funcional, sem API)**
- PIX estático:
  - QR Code e "copia e cola" no padrão BR Code do Banco Central (EMV, CRC16-CCITT);
  - gerado no próprio servidor com a chave PIX da unidade.
- Recibo em PDF.
- Baixas: manual com comprovante; em lote; por conciliação OFX (seção 7.9).
- Na baixa: recálculo automático de multa e juros na data do pagamento; pagamento parcial; estorno.

**Lançamentos automáticos**
- Multa e juros por atraso.
- IRRF: quando o locatário é PJ e o locador é PF. A tabela progressiva é configurável em Configurações, com data de vigência. Não fixe valores no código.
- Taxa de administração descontada no repasse.
- Taxa de intermediação no primeiro repasse.

**Repasse ao proprietário/beneficiário**
- Cálculo:
  - Fórmula: recebido − taxa de administração − IRRF − despesas do imóvel pagas pela imobiliária.
  - Regra de repasse, uma de duas: repassa só após o recebimento; ou repasse garantido (seção 7.10).
  - Divisão entre vários beneficiários por percentual.
- Forma de pagamento:
  - Opções: PIX, TED, cheque ou retirada na imobiliária. A forma é alterável por beneficiário.
  - O antigo DOC foi extinto; use TED/PIX no lugar dele.
  - Dia de repasse configurável.
- Registro: demonstrativo de repasse em PDF; registro do pagamento com comprovante.

**Prestação de contas mensal ao proprietário**
- Extrato do período: recebido, descontado, repassado e despesas, com os comprovantes anexos.

**Reajuste de aluguel**
- Identificação: o worker encontra os contratos no mês de aniversário.
- Índice acumulado de 12 meses via API pública SGS do Banco Central:
  - IGP-M, IPCA e INPC (confirme os códigos das séries, ex.: 189, 433 e 188);
  - cache local;
  - permite digitar o índice manualmente;
  - regra configurável para índice negativo (ex.: não reduzir o aluguel).
- Aplicação: simulação antes de aplicar; aprovação em lote; carta de notificação gerada; aplicação a partir da competência correta; histórico de reajustes.

**Correção monetária**
- Calculadora de atualização de débitos por índice entre duas datas. Usada na planilha de débitos e no jurídico.

**Reajuste de IPTU**
- Atualização anual dos valores e das parcelas por imóvel, em lote.

**Aditamentos**
- Troca de locador, locatário, beneficiário, fiador, modalidade de garantia, valor, prazo ou vencimento.
- Histórico e aditivo gerado em documento.

**Rescisão**
- Cálculos: multa rescisória proporcional ao prazo restante (art. 4º da Lei 8.245/91); aluguel proporcional; débitos pendentes; devolução da caução corrigida.
- Saída do imóvel: vistoria de saída; termo de rescisão; imóvel muda para o status "a vagar" com data prevista.

**Planilha de débitos do locatário**
- Todos os débitos em aberto, atualizados com multa, juros e correção, em PDF.

**Cartas**
- Cobrança do locatário, cobrança do fiador, aviso de reajuste, termo de rescisão e notificação de desocupação.
- Geradas individualmente ou em lote a partir dos modelos.

**Movimento de locação**
- Visão mensal de tudo que entrou, saiu e foi repassado.

**Carteira de locação**
- Recebidos e não recebidos por competência.
- Inadimplência 30/60/90/+90.

**Informe de rendimentos**
- Versões:
  - Para declarar na Receita: regime de caixa (só o recebido), com o IRRF retido.
  - Gerencial: recebido e não recebido, por competência.
- Emissão: individual ou em lote, em PDF.

**DIMOB**
- Relatório anual com todos os dados exigidos: locações, intermediações de venda, valores, comissões e CPF/CNPJ.

**Seguro imobiliário**
- Controle de apólices (incêndio, fiança, conteúdo) por contrato: seguradora, número, vigência e valor.
- Alerta de vencimento.
- Cobrança embutida no aluguel.

**Relatórios específicos da locação**
- Rescisões x novas locações: comparativo mensal com gráfico.
- Comparação de resultados na locação, mês a mês e ano a ano: carteira, receita de taxa de administração, inadimplência e ocupação.

### 7.9 Financeiro da imobiliária

**Contas a pagar e a receber**
- Plano de contas configurável.
- Centros de custo por unidade.
- Recorrências, anexos e baixas.

**Separação do dinheiro**
- Separação clara entre o dinheiro da imobiliária e o dinheiro de terceiros, com uma conta transitória de locação.

**Bancos e caixa**
- Caixa e contas bancárias, transferências e saldos.

**Conciliação bancária**
- Importar extrato OFX (e CSV).
- O sistema sugere a correspondência com cobranças, repasses e contas por valor, data e nome.
- Confirmação em lote.
- Isso substitui a "conciliação de cheques por arquivo retorno".

**Cheques**
- Emitidos e recebidos: número, banco, valor, "bom para" e status (compensado ou devolvido).
- Impressão de cópia e recibo do cheque.

**Créditos e débitos avulsos**
- Por contrato ou pessoa, com relatório próprio.

**Lucro ou prejuízo (DRE gerencial)**
- Por mês e por unidade.
- Receitas: taxa de administração, intermediação, comissões de venda e honorários.
- Despesas: por categoria.
- Comparativos e gráfico.

**Relatório financeiro virtual**
- Painel financeiro interativo com filtros e exportação.

**Metas e comissões**
- Metas por corretor, atendente de balcão e unidade: captações, locações, vendas e atendimentos.
- Comissões: regras configuráveis por tipo de negócio e papel (captador, vendedor, gerente, imobiliária); cálculo automático no fechamento do negócio; extrato de comissões a pagar.
- Ranking.

**Folha de pagamento**
- Cadastro de colaboradores, salários, vales e adiantamentos.
- Lançamento dos pagamentos no contas a pagar.

**Nota fiscal de serviço**
- Cadastro dos dados fiscais da unidade.
- "Espelho" da NFS-e por comissão ou taxa de administração.

### 7.10 Aluguel garantido

**Cadastro completo do pretendente**
- Dados pessoais e cônjuge.
- Renda, com comprovantes anexos.
- Referências e histórico.
- Consulta de crédito: campo para anexar a consulta feita por fora, com o resultado registrado manualmente. A consulta automática é stub (seção 8).

**Viabilidade do contrato**
- Análise automática:
  - comprometimento de renda: (aluguel + encargos) ÷ renda, com limite configurável (padrão 30%);
  - score interno por critérios configuráveis.
- Parecer: aprovado, reprovado ou condicionado.
- Parecer impresso.

**Controle das locações garantidas**
- Contratos nessa modalidade, taxa da garantia e vigência.

**Controle de modalidades de garantia**
- Cadastro de planos com taxa, cobertura e carência.

**Repasse garantido**
- O proprietário recebe mesmo sem pagamento do inquilino.

**Controle de inadimplência da garantia**
- Quanto a imobiliária adiantou e não recebeu, por contrato e por idade da dívida.

**Suspensão de pagamentos / bloqueio de repasses**
- Bloqueio por contrato ou beneficiário, com motivo e responsável.
- Liberação com aprovação.

**Lançamento automático de honorários**
- Aplicado quando a dívida vai para a cobrança jurídica (percentual configurável).

**Visualização das parcelas**
- Grade ou linha do tempo com todas as parcelas do contrato, uma cor por situação: paga; aberta; atrasada; garantida; em acordo.

**Relatórios completos da carteira garantida**
- Exposição total, inadimplência e recuperação.

### 7.11 Jurídico

**Cobrança jurídica**
- Encaminhar um contrato para cobrança jurídica, interna ou com escritório externo, registrando quem cuida.

**Processos**
- Número, vara, tipo (despejo, cobrança, execução), partes e advogado.
- Andamentos lançados manualmente.
- Prazos com alerta, custas e documentos.

**Acordos**
- Contrato de acordo com parcelamento da dívida.
- Cobrança das parcelas.
- Controle de quebra de acordo.

**Assessoria jurídica interna**
- Canal de solicitação de parecer: o usuário envia a dúvida e o advogado responsável responde.
- Base de modelos jurídicos.

**Relatórios**
- Jurídico, por status do processo.
- Inadimplência 30/60/90/total.
- Carteira total.

### 7.12 Vendas

**Negociações de venda**
- Ligadas ao funil e às propostas.
- Checklist de documentação (certidões).
- Comissão e divisão entre os envolvidos.

**Corretores parceiros**
- Cadastro com CRECI e vigência.
- Contrato e distrato de corretor.

**Crédito imobiliário / financiamento**
- Simulador SAC e Price: valor, entrada, prazo e taxa, com tabela de parcelas e PDF.
- Acompanhamento do processo de financiamento do cliente por etapas.

**Relatórios**
- Ligações e atendimentos de vendas.

### 7.13 Site público e marketing

**Site público na raiz `/` (sem login)**
- Páginas: home com destaques; busca com filtros; página do imóvel (fotos, mapa aproximado sem o endereço exato — configurável — e vídeo); página "Anuncie seu imóvel" (vira captação); páginas institucionais.
- Formulários: formulário de contato, que vira lead; agendamento de visita.
- Contato direto: chat; botão de WhatsApp.
- Personalização em Configurações: logo, cores, textos e contatos.

**Ofertas de imóveis**
- Vitrine de destaques no site.
- Envio de uma seleção de imóveis para um cliente, por link público, registrando quais imóveis ele abriu.

**SEO técnico**
- URLs amigáveis e meta tags.
- Open Graph: pré-visualização bonita no WhatsApp e Facebook.
- sitemap.xml, robots.txt e dados estruturados.

**Feed XML para portais**
- Feed de imóveis no formato VRSync (aceito pelo Grupo OLX: ZAP, VivaReal e OLX). Confirme a especificação atual.
- Publicado em URL pública com token.
- Imóveis bloqueados ficam fora do feed.
- README com instruções de cadastro do feed no portal.

**Integração com Facebook e redes sociais**
- Botões de compartilhar o imóvel: Facebook, X, LinkedIn e WhatsApp.
- Gerador de arte para post: imagem quadrada com foto, valor, código e logo, gerada no servidor com sharp, pronta para baixar.

**Relatórios de marketing**
- Mídias: leads e negócios por origem, com custo por lead quando houver custo cadastrado nos anúncios.
- Baixa ação comercial: imóveis sem visita, atendimento ou lead há X dias, e imóveis com muitas visitas e nenhuma proposta.

### 7.14 Portal do cliente (área externa com login)

**Acesso**
- Login separado para proprietário, beneficiário, inquilino e investidor.
- Convite por link (enviável por WhatsApp), com senha própria.

**Proprietário e beneficiário**
- Imóveis e contratos.
- Prestação de contas e repasses.
- Informe de rendimentos.
- Documentos e ocorrências.
- Solicitar alteração de dados bancários (com aprovação interna).

**Inquilino**
- Cobranças e 2ª via (PIX e recibo).
- Comprovantes.
- Contrato e documentos.
- Abrir ocorrência ou pedido de manutenção.
- Informe de pagamentos.

**Área de investidores**
- Visão consolidada para quem tem vários imóveis: rentabilidade, ocupação, vacância e receita por imóvel, com gráficos.

**Envio de documentos**
- Contrato, vistoria e procuração enviados pelo portal, com aviso interno à equipe.

**Isolamento**
- Um usuário externo jamais vê dados de outro.
- Testes automatizados obrigatórios para isso.

### 7.15 Relatórios

Todos com filtros por período, unidade e usuário, gráfico quando fizer sentido, e exportação em PDF e Excel.

- **Comercial:** Atendimento (desempenho por corretor e atendente); Imóveis por captador e cadastrador; Mídias; Baixa ação comercial; Funil; Ligações; Pesquisa de satisfação; Metas e comissões.
- **Imóveis:** Placas ativas; Chaves fora; Exclusividades vencendo; Captações desatualizadas.
- **Locação:** Movimento de locação; Carteira recebidos e não recebidos; Inadimplência 30/60/90/total; Créditos e débitos; Comparação de resultados na locação; Rescisões x novas locações; Reajustes; Repasses.
- **Gestão:** Carteira garantida; Jurídico; DRE (lucro ou prejuízo); Dados da DIMOB.

### 7.16 Administração

**Usuários e unidades**
- Usuários, papéis e matriz de permissões.
- Unidades (matriz e filiais), cada uma com CNPJ, endereço, conta bancária, chave PIX e logo próprios.

**Configurações**
- Dados da imobiliária.
- Taxas padrão, multa e juros.
- Tabela de IRRF com vigência.
- Índices de reajuste.
- Prazos de proteção de carteira e de captação.
- Regras da roleta e prazo de reserva.
- Modelos de documento e de mensagem.
- Marca d'água e site.

**Integrações**
- Tela de status descrita na seção 5.

**Auditoria**
- Histórico global com filtros e lixeira.

**Backup (cópia de segurança)**
- Automático: pg_dump diário mais os uploads compactados.
- Retenção configurável. Padrão: 7 diários e 4 semanais.
- Manual: botão "Fazer backup agora" e download do backup.
- Restauração: script testado e documentado.

**Importação e exportação**
- Importação de imóveis e pessoas por planilha, com modelo pronto e validação linha a linha (essencial para migrar de outro sistema).
- Exportação geral por entidade.

**Central de ajuda e treinamentos em vídeo**
- Cadastro de vídeos (links do YouTube) e artigos por módulo.
- Botão "?" contextual em cada tela.
- Trilha de treinamento por papel.

**Novidades do sistema (novas implementações)**
- Página de changelog com versão, data e mudanças.
- Aviso de novidade no login.

## 8. Funcionalidades "em desenvolvimento" (padrão da seção 5)

Estas funcionalidades devem ter telas e fluxo completos, mas com a integração simulada. A coluna da direita mostra o que já deve funcionar de verdade.

| Funcionalidade | Depende de | O que já funciona de verdade |
|---|---|---|
| Gerar boleto registrado e baixa automática | Banco ou gateway (ex.: Asaas, Banco Inter, Iugu) | Cobrança completa, PIX estático, baixa manual e por OFX |
| PIX dinâmico com baixa automática | Gateway de pagamento | PIX estático |
| Repasse automático (PIX/TED por API) | Banco com API | Cálculo, demonstrativo e registro manual |
| Importação de arquivo retorno CNAB | Layout do banco | Conciliação por OFX |
| Emissão de NFS-e | API emissora, certificado A1 e cadastro na prefeitura | Espelho da nota |
| SMS imobiliário | Provedor de SMS | Mensagem via wa.me |
| WhatsApp automático (API oficial) | Meta ou provedor homologado | Mensagem via wa.me |
| Consulta Serasa / Boa Vista | Contrato com o birô de crédito | Anexo manual da consulta |
| Assinatura eletrônica de contratos | Serviço de assinatura (ex.: Clicksign, D4Sign, ZapSign) | PDF para assinatura física |
| Publicação automática em redes sociais | API da Meta | Botões de compartilhar e arte para post |
| Integração direta com portais por API | Portais | Feed XML VRSync |
| Consulta processual automática | Tribunais ou serviço de consulta | Andamentos manuais |
| Cotação e contratação de seguro | Seguradoras | Controle de apólices |
| Envio de proposta de financiamento a bancos | Bancos | Simulador SAC/Price e acompanhamento |
| Integração com PABX/VoIP | Telefonia VoIP | Registro manual de ligações |
| Cálculo completo de folha (INSS, FGTS, IRRF e eSocial) | Contador ou sistema de folha | Cadastro e pagamentos. Aviso: "use o seu contador" |
| Arquivo DIMOB no layout oficial da Receita | Validação contábil | Relatório com todos os dados. Rascunho do arquivo com aviso "conferir com o contador" |

## 9. Dados de demonstração

**Comando `seed`** — gera uma base brasileira realista, com endereços em cidade fictícia:
- 2 unidades
- 1 usuário de cada papel, interno e externo
- ~120 imóveis com fotos de exemplo geradas localmente (placeholders com sharp, sem baixar imagens da internet)
- ~300 pessoas com CPF/CNPJ válidos, mas fictícios
- ~60 contratos de locação ativos com 12 meses de histórico de cobranças: pagas, atrasadas e em acordo
- 5 contratos garantidos
- 3 processos jurídicos
- leads em todas as etapas do funil
- agenda da semana
- chaves fora
- exclusividades vencendo
- reajustes no mês corrente

**Comando `reset-demo`** — zera e recria a base de demonstração.

**README** — lista os logins de demonstração de cada papel.

## 10. Deploy e operação

**Subida**
- `docker compose up -d --build` sobe tudo: app, worker, postgres e gotenberg.

**Comportamento dos containers**
- Migrations automáticas no start.
- Healthchecks.
- `restart: unless-stopped`.
- Rotação de logs.

**Admin inicial**
- Criado pelas variáveis de ambiente, com troca de senha obrigatória no primeiro login.

**Scripts**
- `scripts/backup.sh`
- `scripts/restore.sh`
- `scripts/update.sh`: git pull, build e migrate sem perder dados.
- `scripts/uninstall.sh`: remove tudo do projeto sem afetar o resto da VPS. Deve pedir confirmação e oferecer um backup antes.

**README em português**
- Requisitos e instalação.
- Endereço de acesso e logins de demonstração.
- Como atualizar.
- Backup e restauração.
- Como desligar e remover.
- Como o domínio e o HTTPS foram configurados.
- O que contratar para ativar cada item "em desenvolvimento".

## 11. Qualidade e critérios de aceite

**Testes unitários obrigatórios para todos os cálculos financeiros:**
- multa e juros pró-rata dia
- proporcional de dias
- reajuste por índice acumulado, incluindo índice negativo
- IRRF por tabela com vigência
- taxa de administração e taxa de intermediação
- repasse com vários beneficiários
- rescisão proporcional
- caução e complemento de caução
- correção monetária
- SAC e Price
- comissões
- geração do BR Code do PIX (validar o CRC16 contra exemplos conhecidos)
- valor por extenso

**Testes E2E (Playwright) dos fluxos:**
- login e troca de senha;
- cadastrar imóvel com fotos, que passa a aparecer no site;
- o fluxo completo de locação: lead pelo site → roleta → funil → proposta de locação → contrato → cobrança → baixa → repasse → informe de rendimentos;
- reajuste em lote;
- rescisão;
- portal do proprietário vê só os próprios dados;
- uma funcionalidade "em desenvolvimento" mostra o aviso e simula.

**Performance**
- Listagens com 10 mil registros respondem rápido: índices no banco e paginação no servidor.

**Segurança**
- Validação no servidor de toda entrada.
- Permissão checada em toda ação.
- Proteção CSRF.
- Upload só de tipos permitidos e com limite de tamanho.
- Headers de segurança.
- Nenhum segredo no front-end.
- Rate limit nas rotas públicas: contato, chat e pesquisa.

**Fechamento de fase**
- Antes de declarar uma fase concluída, percorra o FEATURES.md item a item e confirme cada um.

## 12. Ordem de execução (fases)

| Fase | Escopo |
|---|---|
| 0 | Inspeção da VPS e plano. Esqueleto: Docker, Next.js, Prisma, autenticação, layout, permissões, auditoria, unidades, padrão de integrações "em desenvolvimento" e notificações. Criar CLAUDE.md, FEATURES.md e DECISIONS.md. |
| 1 | Pessoas, condomínios e administradoras. Imóveis completos: fotos, marca d'água, CEP, mapa, busca, match, duplicidade, selo, exclusividade, placas, lançamentos e anúncios. |
| 2 | Atendimento e CRM: atendimentos, roleta, funil, follow-up, agenda, ordens, ocorrências, ligações, chat interno, ações comerciais, pesquisa de satisfação e rota de visitas. |
| 3 | Propostas, reservas, chaves e declaração de visita. Editor de modelos, modelos padrão, PDFs (Gotenberg), documentos em nuvem e etiquetas. |
| 4 | Locação, parte 1: contratos, garantias, cobranças, PIX estático, baixas, multa e juros, IRRF, repasses, prestação de contas e contas de consumo. |
| 5 | Locação, parte 2: reajustes (SGS), correção monetária, IPTU, aditamentos, rescisão, planilha de débitos, cartas, informes de rendimento, dados da DIMOB e seguros. |
| 6 | Financeiro da imobiliária, conciliação OFX, cheques, DRE, metas e comissões, folha (parte funcional) e espelho de NFS-e. |
| 7 | Aluguel garantido e jurídico. |
| 8 | Vendas, crédito imobiliário, site público, chat do site, agenda de visita pelo site, ofertas, feed XML, compartilhamento, arte para post e SEO. |
| 9 | Portal do cliente e área de investidores. |
| 10 | Todos os relatórios, painel, importação e exportação, backup e restauração, central de ajuda e changelog. |
| 11 | Seed completo, testes E2E, revisão de segurança, README, deploy final na VPS e conferência de cada item do FEATURES.md. |

## 13. Entrega final

Ao terminar, entregue:
- a URL de acesso;
- os logins de demonstração;
- o FEATURES.md 100% marcado com [x], ou [dev] com justificativa;
- os comandos de operação;
- a lista do que é preciso contratar ou configurar para tirar cada item de "em desenvolvimento".

---

## AJUSTES DA VPS (prevalecem sobre o texto acima)

Esta VPS já roda outros sistemas em produção (loja, rodagem, menu/Rods, Destilado, Evolution API, n8n, Nginx Proxy Manager, Portainer). O CRM não pode afetar nenhum deles.

1. **Pasta:** `/opt/sistemas/simpliaoscrm` (o usuário `deploy` tem permissão em `/opt/sistemas`). Todo o código, `.env`, scripts e backups do CRM ficam aqui.
2. **Domínio com HTTPS em vez de IP:porta.** A porta 8080 já é da Evolution API, e a VPS só expõe 22/80/443 para a internet (portas publicadas pelo Docker são bloqueadas para fora na chain DOCKER-USER). Portanto:
   - publique o app só em `127.0.0.1:<porta livre>` (sugestão: 43000; confira com `ss -tulpn`);
   - **exceção autorizada:** crie no Nginx Proxy Manager UM proxy host `crm.simpliaos.online` → `127.0.0.1:<porta>`, com o certificado wildcard `*.simpliaos.online` que já existe, HTTPS forçado e WebSocket ligado. O DNS `*.simpliaos.online` já aponta para a VPS. Não altere nenhum outro proxy host;
   - `COOKIE_SECURE=true` e `TRUST_PROXY=true`.
3. **Recursos:** a VPS tem ~7 GB de RAM disponíveis e 4 GB de swap, compartilhados com produção. Limites de memória sugeridos: app 768 MB, worker 512 MB, postgres 768 MB, gotenberg 768 MB. O build do Next.js pode ser pesado: faça um build por vez e, se precisar, limite com `NODE_OPTIONS=--max-old-space-size=2048`. Nunca rode `docker system prune` nem remova imagens, volumes ou redes que não sejam `simpliaoscrm_*`.
4. **Postgres próprio** do CRM (container `simpliaoscrm-db`), sem porta publicada. Não use nem toque nos bancos Supabase dos outros sistemas.
5. **Testes E2E com Playwright:** rode em container próprio do projeto ou instalado só dentro da pasta do projeto. Ao terminar, remova as imagens de teste que você criou, para não ocupar disco.
6. **Git:** inicialize o repositório na pasta e crie um repositório PRIVADO no GitHub com `gh repo create menusapp/simpliaoscrm --private --source=. --push`. Faça push ao fim de cada fase. Nunca commite `.env`, uploads ou backups.
7. **Backup:** use os scripts do próprio projeto, com cron do usuário `deploy` (`crontab -e`, só a linha do CRM) às 04:00, guardando em `/opt/sistemas/simpliaoscrm/backups`. Não altere os crons dos outros sistemas.
8. **Segredos:** registre todas as senhas e chaves criadas no arquivo `~/SECRETS-sistemas.txt`, numa seção nova "simpliaosCRM", e no `.env` do projeto. Nada de segredo no git.
9. **Relatório:** mantenha `RELATORIO-CRM.md` na pasta do projeto com o progresso de cada fase (o que foi feito, testes, pendências), além do FEATURES.md.
10. **Autonomia:** o dono autorizou execução autônoma. Não espere aprovação do plano: grave o `PLAN.md` e comece. Só pare para perguntar se estiver realmente bloqueado, ou antes de qualquer ação fora da pasta do projeto que não esteja listada como exceção acima.

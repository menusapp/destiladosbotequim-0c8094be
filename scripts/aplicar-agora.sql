-- =====================================================================
-- COLE ESTE ARQUIVO INTEIRO NO SQL EDITOR DO SUPABASE E RODE.
--
--   https://supabase.com/dashboard/project/bucehnrbrwdkioktajqw/sql/new
--
-- Faz tudo o que falta, de uma vez. É idempotente: se parte já tiver sido
-- aplicada, roda de novo sem estragar nada.
--
-- Depois de rodar, o acesso é:
--   /login       destilado / destilado123     (restaurante)
--   painel       admin     / admin123         (conta de admin)
--   /login/ceo   ceo       / Ceo@2026         (CEO)
--
-- Troque as três assim que entrar.
-- =====================================================================



-- ─────────────────────────────────────────────────────────────────
-- 20260916140000_ceo_write_restaurant_credentials
-- ─────────────────────────────────────────────────────────────────
-- =====================================================================
-- CEO pode escrever em restaurant_credentials
-- ---------------------------------------------------------------------
-- A blindagem de segurança (20260722100100) deu a restaurant_credentials
-- apenas uma policy de SELECT. Só que o painel do CEO cria as credenciais
-- do restaurante com um INSERT direto (CEODashboard.tsx), e o RLS barra:
--
--   new row violates row-level security policy for table
--   "restaurant_credentials"
--
-- No projeto antigo isso passou despercebido porque o restaurante já
-- existia desde antes da blindagem — ninguém cadastrou outro depois. Numa
-- instalação nova é a primeira coisa que se faz, e ela trava ali.
--
-- Mesmo padrão já usado em `restaurants` (ceo_insert / ceo_delete): quem
-- escreve é apenas quem tem sessão de CEO válida, verificada por is_ceo()
-- contra a tabela staff_sessions.
-- =====================================================================

DROP POLICY IF EXISTS "ceo_insert" ON public.restaurant_credentials;
DROP POLICY IF EXISTS "ceo_update" ON public.restaurant_credentials;
DROP POLICY IF EXISTS "ceo_delete" ON public.restaurant_credentials;

CREATE POLICY "ceo_insert" ON public.restaurant_credentials
  FOR INSERT WITH CHECK (public.is_ceo());

CREATE POLICY "ceo_update" ON public.restaurant_credentials
  FOR UPDATE USING (public.is_ceo()) WITH CHECK (public.is_ceo());

CREATE POLICY "ceo_delete" ON public.restaurant_credentials
  FOR DELETE USING (public.is_ceo());

-- ---------------------------------------------------------------------
-- Mesmo buraco em ceo_users: só havia SELECT, mas a aba de credenciais do
-- painel (CEOCredentialsTab.tsx) cria e edita usuários CEO direto da tela —
-- inclusive para trocar a senha padrão. Sem isto, trocar a senha do CEO
-- falha com o mesmo erro de RLS.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "ceo_insert" ON public.ceo_users;
DROP POLICY IF EXISTS "ceo_update" ON public.ceo_users;
DROP POLICY IF EXISTS "ceo_delete" ON public.ceo_users;

CREATE POLICY "ceo_insert" ON public.ceo_users
  FOR INSERT WITH CHECK (public.is_ceo());

CREATE POLICY "ceo_update" ON public.ceo_users
  FOR UPDATE USING (public.is_ceo()) WITH CHECK (public.is_ceo());

CREATE POLICY "ceo_delete" ON public.ceo_users
  FOR DELETE USING (public.is_ceo());

-- ─────────────────────────────────────────────────────────────────
-- 20260916170000_grants_ceo_write
-- ─────────────────────────────────────────────────────────────────
-- =====================================================================
-- GRANT que faltava em restaurant_credentials e ceo_users
-- ---------------------------------------------------------------------
-- A migration 20260916140000 criou as policies de escrita, mas policy sem
-- GRANT não basta: o Postgres checa a permissão de tabela ANTES do RLS. Por
-- isso o painel do CEO passou de "violates row-level security policy" para
-- "permission denied for table restaurant_credentials".
--
-- Isto NÃO afrouxa nada: é exatamente o arranjo que `restaurants` já usa —
-- o GRANT deixa a requisição chegar ao RLS, e é o RLS que decide, exigindo
-- sessão de CEO válida (is_ceo() contra staff_sessions). Sem sessão, a
-- escrita continua barrada, agora no ponto certo.
-- =====================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_credentials TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ceo_users             TO anon, authenticated;
GRANT ALL ON public.restaurant_credentials TO service_role;
GRANT ALL ON public.ceo_users             TO service_role;

-- ─────────────────────────────────────────────────────────────────
-- 20260916160000_seed_destilado_botequim
-- ─────────────────────────────────────────────────────────────────
-- =====================================================================
-- Cria o estabelecimento e os acessos iniciais
-- ---------------------------------------------------------------------
-- O sistema deixou de ser SaaS e atende UM estabelecimento (ver
-- src/config/establishment.ts). Mesmo assim, o primeiro acesso dependia de
-- cadastrar o restaurante pelo painel do CEO — caminho que numa instalação
-- nova esbarra em RLS e GRANT, porque o painel escreve como `anon`.
--
-- Uma migration roda como dono do banco: sem RLS, sem grant, sem painel.
-- É o lugar certo para o bootstrap.
--
-- Cria, de forma idempotente:
--   restaurants             Destilado Botequim / destilado-botequim
--   restaurant_credentials  destilado / destilado123   (login em /login)
--   restaurant_staff        admin     / admin123       (conta de admin)
--
-- ⚠️  Senhas de primeiro acesso, e este repositório tem histórico público.
--     Troque as duas assim que entrar.
-- =====================================================================

DO $seed$
DECLARE
  v_rest uuid;
  v_sections jsonb := '[
    "pedidos-online","pedidos-locais","pdv","mesas-reservas","cardapio","caixa",
    "estoque","custos","margens","relatorios","clientes","fidelidade","marketing",
    "fiscal","modulos","config-dados","config-horario","config-regioes",
    "config-pagamentos","config-pagamentos-online","config-impressoras","config-whatsapp"
  ]'::jsonb;
BEGIN
  -- ── o estabelecimento ───────────────────────────────────────────────
  SELECT id INTO v_rest FROM public.restaurants WHERE slug = 'destilado-botequim';
  IF v_rest IS NULL THEN
    INSERT INTO public.restaurants (name, slug)
    VALUES ('Destilado Botequim', 'destilado-botequim')
    RETURNING id INTO v_rest;
    RAISE NOTICE 'Restaurante criado: %', v_rest;
  ELSE
    RAISE NOTICE 'Restaurante já existia: %', v_rest;
  END IF;

  -- ── credencial do restaurante (tela /login) ─────────────────────────
  IF EXISTS (
    SELECT 1 FROM public.restaurant_credentials
    WHERE restaurant_id = v_rest AND lower(trim(username)) = 'destilado'
  ) THEN
    UPDATE public.restaurant_credentials
       SET password_hash = extensions.crypt('destilado123', extensions.gen_salt('bf'))
     WHERE restaurant_id = v_rest AND lower(trim(username)) = 'destilado';
  ELSE
    INSERT INTO public.restaurant_credentials (restaurant_id, username, password_hash)
    VALUES (v_rest, 'destilado', extensions.crypt('destilado123', extensions.gen_salt('bf')));
  END IF;

  -- ── conta de admin (é ela que autentica no painel) ──────────────────
  IF EXISTS (
    SELECT 1 FROM public.restaurant_staff
    WHERE restaurant_id = v_rest AND lower(trim(username)) = 'admin'
  ) THEN
    UPDATE public.restaurant_staff
       SET password_hash = extensions.crypt('admin123', extensions.gen_salt('bf')),
           role = 'admin',
           allowed_sections = v_sections,
           is_active = true,
           can_manage_orders = true,
           receives_order_notifications = true
     WHERE restaurant_id = v_rest AND lower(trim(username)) = 'admin';
  ELSE
    INSERT INTO public.restaurant_staff (
      restaurant_id, username, password_hash, display_name, role,
      allowed_sections, is_active, can_manage_orders, receives_order_notifications
    ) VALUES (
      v_rest, 'admin', extensions.crypt('admin123', extensions.gen_salt('bf')),
      'Administrador', 'admin', v_sections, true, true, true
    );
  END IF;

  RAISE NOTICE 'Acessos prontos: /login -> destilado/destilado123 | staff -> admin/admin123';
END
$seed$;

-- ─────────────────────────────────────────────────────────────────
-- 20260916180000_plano_unico_tudo_liberado
-- ─────────────────────────────────────────────────────────────────
-- =====================================================================
-- Estabelecimento único com todos os módulos liberados
-- ---------------------------------------------------------------------
-- O sistema nasceu SaaS: os módulos do painel são liberados conforme
-- `subscription_plans.features` da assinatura ativa do restaurante, e há
-- ainda trial com data de expiração (ver src/hooks/useRestaurantModules.ts).
-- Como agora existe um só estabelecimento, e ele é o dono do sistema, essa
-- cobrança não faz sentido — mas o gate está no DADO, não no código.
--
-- Em vez de arrancar a lógica (o que espalharia mudanças por várias telas e
-- ficaria difícil de reverter), semeamos o dado que a destrava:
--
--   * um plano interno com os 13 módulos e preço zero;
--   * assinatura ativa, sem trial e sem data de vencimento;
--   * marcas de trial do restaurante zeradas.
--
-- O nome do plano precisa conter "Avançado": é assim que src/config/plans.ts
-- resolve o limite de usuários da equipe como ilimitado.
--
-- Idempotente — pode rodar de novo sem duplicar.
-- =====================================================================

DO $plano$
DECLARE
  v_rest uuid;
  v_plan uuid;
  v_features jsonb := '[
    "cardapio","pdv","mesas","estoque","financeiro","fidelidade","delivery",
    "marketing","whatsapp","fiscal","pagamentos_online","reservas","totem"
  ]'::jsonb;
  v_futuro timestamptz := '2099-12-31 00:00:00+00';
BEGIN
  SELECT id INTO v_rest FROM public.restaurants WHERE slug = 'destilado-botequim';
  IF v_rest IS NULL THEN
    RAISE NOTICE 'Restaurante destilado-botequim não encontrado — nada a fazer.';
    RETURN;
  END IF;

  -- ── plano interno com tudo ──────────────────────────────────────────
  SELECT id INTO v_plan FROM public.subscription_plans WHERE name = 'Avançado (uso próprio)';
  IF v_plan IS NULL THEN
    INSERT INTO public.subscription_plans (name, description, price, features, is_active)
    VALUES ('Avançado (uso próprio)',
            'Plano interno do estabelecimento — todos os módulos, sem cobrança.',
            0, v_features, true)
    RETURNING id INTO v_plan;
  ELSE
    UPDATE public.subscription_plans
       SET features = v_features, price = 0, is_active = true
     WHERE id = v_plan;
  END IF;

  -- ── assinatura ativa e permanente ───────────────────────────────────
  -- Derruba assinaturas anteriores para não deixar duas ativas: o hook pega
  -- a mais recente, e duas ativas já causaram inconsistência neste código.
  UPDATE public.restaurant_subscriptions
     SET status = 'cancelled'
   WHERE restaurant_id = v_rest AND status = 'active';

  INSERT INTO public.restaurant_subscriptions (
    restaurant_id, plan_id, status, started_at, expires_at,
    next_payment_at, is_trial, failed_payments, in_grace_period,
    current_period_start, current_period_end
  ) VALUES (
    v_rest, v_plan, 'active', now(), v_futuro,
    v_futuro, false, 0, false,
    current_date, v_futuro::date
  );

  -- ── zera as marcas de trial do restaurante ──────────────────────────
  UPDATE public.restaurants
     SET trial_expired  = false,
         trial_ends_at  = v_futuro,
         trial_started_at = coalesce(trial_started_at, now())
   WHERE id = v_rest;

  RAISE NOTICE 'Plano liberado: 13 módulos, sem trial, sem vencimento.';
END
$plano$;

-- ─────────────────────────────────────────────────────────────────
-- 20260917020000_colunas_ausentes_do_historico
-- ─────────────────────────────────────────────────────────────────
-- =====================================================================
-- Colunas que existiam no banco do Lovable e nunca viraram migration
-- ---------------------------------------------------------------------
-- Mesmo caso da tabela deliverydireto_config: criadas à mão no painel, então
-- o histórico de migrations não as reproduz. Num projeto novo elas faltam, e
-- o sintoma é péssimo de diagnosticar — a aba Pedidos pedia `dd_source` e
-- `dd_order_id` no SELECT, o PostgREST recusava a consulta inteira por coluna
-- inexistente, e o código fazia `if (!error) setOrders(...)`: a lista ficava
-- vazia sem nenhuma mensagem. Um pedido real entrava no banco, a notificação
-- aparecia, e a tela de pedidos mostrava nada.
--
-- Levantadas comparando src/integrations/supabase/types.ts — que o Lovable
-- gerou a partir do banco real — com o schema que as migrations produzem.
-- A varredura completa apontou estas 4 e nenhuma outra.
-- =====================================================================

-- Delivery Direto: marca a origem do pedido e guarda o id externo.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS dd_source   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS dd_order_id text;

CREATE INDEX IF NOT EXISTS orders_dd_order_id_idx
  ON public.orders (dd_order_id) WHERE dd_order_id IS NOT NULL;

-- Mercado Pago Point: terminal selecionado para pagamento presencial.
ALTER TABLE public.online_payment_config
  ADD COLUMN IF NOT EXISTS mp_pos_id   text,
  ADD COLUMN IF NOT EXISTS mp_pos_name text;

COMMENT ON COLUMN public.orders.dd_source IS
  'Pedido originado no Delivery Direto.';
COMMENT ON COLUMN public.orders.dd_order_id IS
  'Identificador do pedido no Delivery Direto.';

-- ─────────────────────────────────────────────────────────────────
-- 20260917030000_corrige_historico_do_cliente
-- ─────────────────────────────────────────────────────────────────
-- =====================================================================
-- Histórico e endereços do cliente voltam a aparecer
-- ---------------------------------------------------------------------
-- get_customer_orders nunca devolvia nada. A guarda era:
--
--   AND (p_phone IS NOT NULL AND <telefone do cliente> = <p_phone>)
--
-- Com p_phone nulo a condição inteira é falsa, o NOT EXISTS dá verdadeiro e
-- a função faz RETURN vazio. E o app chama justamente com p_phone: null
-- (PedidosHistory.tsx e LoyaltyRewardNotification.tsx). Ou seja: o cliente
-- pedia, o pedido entrava, e "Meus Pedidos" ficava sempre vazio. O de
-- fidelidade também não contava pedidos anteriores, pelo mesmo motivo.
--
-- list_customer_addresses tinha a variante do mesmo erro: comparava o
-- telefone salvo com COALESCE(p_phone,''), então com p_phone nulo só
-- retornava endereços cujo telefone fosse vazio.
--
-- Correção: o telefone continua sendo conferido QUANDO é informado. Quando
-- não é, o CPF basta.
--
-- Nota de segurança, para constar: exigir o telefone como segundo fator já
-- não protegia nada aqui, porque `get_customer_by_cpf(p_cpf)` devolve o
-- telefone de qualquer CPF sem verificação alguma. Quem tivesse o CPF
-- obteria o telefone e passaria na guarda. Proteger de verdade o histórico
-- do cliente pede autenticação real (código por SMS/WhatsApp, por exemplo),
-- que é uma decisão de produto — não uma guarda que só quebra a tela.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_customer_orders(p_cpf text, p_phone text)
RETURNS SETOF public.orders
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rid uuid := public.default_restaurant_id();
BEGIN
  IF p_cpf IS NULL OR btrim(p_cpf) = '' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.restaurant_id = v_rid
      AND c.cpf = p_cpf
      AND (
        -- telefone não informado: o CPF basta
        p_phone IS NULL OR btrim(p_phone) = ''
        -- cliente sem telefone cadastrado: não há o que conferir
        OR regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') = ''
        -- informado e cadastrado: tem de bater
        OR regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g')
             = regexp_replace(p_phone, '\D', '', 'g')
      )
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT * FROM public.orders o
    WHERE o.restaurant_id = v_rid
      AND o.customer_cpf = p_cpf
    ORDER BY o.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_customer_addresses(p_cpf text, p_phone text)
RETURNS SETOF public.customer_addresses
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.customer_addresses ca
  WHERE ca.restaurant_id = public.default_restaurant_id()
    AND ca.customer_cpf = p_cpf
    AND (
      p_phone IS NULL OR btrim(p_phone) = ''
      OR regexp_replace(COALESCE(ca.customer_phone, ''), '\D', '', 'g') = ''
      OR regexp_replace(COALESCE(ca.customer_phone, ''), '\D', '', 'g')
           = regexp_replace(p_phone, '\D', '', 'g')
    )
  ORDER BY ca.is_default DESC, ca.created_at DESC
$$;

-- Mantém as permissões que a blindagem havia definido para estas RPCs.
REVOKE ALL ON FUNCTION public.get_customer_orders(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_customer_addresses(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_orders(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_customer_addresses(text, text) TO anon, authenticated;

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

-- ─────────────────────────────────────────────────────────────────
-- 20260921120000_rpcs_admin_ausentes
-- ─────────────────────────────────────────────────────────────────
-- =====================================================================
-- RPCs de administração que existiam no banco do Lovable e nunca viraram
-- migration
-- ---------------------------------------------------------------------
-- Mesma origem da tabela deliverydireto_config e das colunas dd_source /
-- dd_order_id: criadas à mão no painel. Num projeto novo elas faltam, e o
-- painel repete "Could not find the function public.admin_get_... in the
-- schema cache" ao abrir Integrações e Pagamentos.
--
-- Levantadas comparando a seção Functions de src/integrations/supabase/
-- types.ts — gerada a partir do banco real — com o que as migrations criam.
-- Ficaram de fora do levantamento os nomes `*_secured_impl_<número>`: são
-- gerados pela própria blindagem de segurança e carregam o OID do banco no
-- nome, então nunca coincidem entre projetos.
--
-- Guarda: mesmo idioma das admin_* existentes — exige sessão de staff ou de
-- CEO. As de CEO exigem sessão de CEO. get_public_payment_config é a única
-- pública, e devolve só campos não sensíveis (sem token de acesso).
-- =====================================================================

-- ── helper de guarda ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._exigir_staff()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (public.is_staff() OR public.is_ceo()) THEN
    RAISE EXCEPTION 'Acesso negado: sessao de staff necessaria' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._exigir_ceo()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_ceo() THEN
    RAISE EXCEPTION 'Acesso negado: sessao de CEO necessaria' USING ERRCODE = '42501';
  END IF;
END $$;

-- ── pagamentos online ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_payment_config(p_restaurant_id uuid)
RETURNS TABLE (
  id uuid, restaurant_id uuid, provider text, enabled boolean,
  accept_pix boolean, accept_card boolean, enable_for_delivery boolean,
  connection_status text, connected_at timestamptz,
  mp_access_token text, mp_public_key text, mp_refresh_token text,
  mp_sandbox_payer_email text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._exigir_staff();
  RETURN QUERY
    SELECT c.id, c.restaurant_id, c.provider, c.enabled,
           c.accept_pix, c.accept_card, c.enable_for_delivery,
           c.connection_status, c.connected_at,
           c.mp_access_token, c.mp_public_key, c.mp_refresh_token,
           c.mp_sandbox_payer_email
    FROM public.online_payment_config c
    WHERE c.restaurant_id = p_restaurant_id;
END $$;

-- Pública: usada pelo cardápio para saber se aceita pagamento online.
-- Devolve apenas o que o cliente pode ver — nunca token de acesso.
CREATE OR REPLACE FUNCTION public.get_public_payment_config(p_restaurant_id uuid)
RETURNS TABLE (
  id uuid, restaurant_id uuid, enabled boolean, accept_pix boolean,
  accept_card boolean, enable_for_delivery boolean,
  connection_status text, mp_public_key text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.restaurant_id, c.enabled, c.accept_pix,
         c.accept_card, c.enable_for_delivery,
         c.connection_status, c.mp_public_key
  FROM public.online_payment_config c
  WHERE c.restaurant_id = p_restaurant_id;
$$;

CREATE OR REPLACE FUNCTION public.admin_ensure_payment_config(p_restaurant_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public._exigir_staff();
  SELECT id INTO v_id FROM public.online_payment_config WHERE restaurant_id = p_restaurant_id;
  IF v_id IS NULL THEN
    INSERT INTO public.online_payment_config (restaurant_id, provider, enabled)
    VALUES (p_restaurant_id, 'mercadopago', false)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

-- p_field vem do cliente e vira nome de coluna. Sem lista branca isso seria
-- injeção de SQL — e permitiria escrever em qualquer coluna da tabela.
CREATE OR REPLACE FUNCTION public.admin_upsert_payment_config(
  p_restaurant_id uuid, p_field text, p_value text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_permitidos constant text[] := ARRAY[
    'enabled','provider','require_prepayment','accept_pix','accept_card',
    'enable_for_delivery','connection_status','connected_at',
    'mp_access_token','mp_public_key','mp_refresh_token','mp_user_id',
    'mp_sandbox_payer_email','token_expires_at','mp_external_pos_id',
    'mp_pos_id','mp_pos_name'
  ];
  v_tipo text;
BEGIN
  PERFORM public._exigir_staff();

  IF NOT (p_field = ANY(v_permitidos)) THEN
    RAISE EXCEPTION 'Campo nao permitido: %', p_field USING ERRCODE = '22023';
  END IF;

  PERFORM public.admin_ensure_payment_config(p_restaurant_id);

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo
  FROM pg_attribute a
  WHERE a.attrelid = 'public.online_payment_config'::regclass AND a.attname = p_field;

  -- p_field já validado contra a lista branca; o valor vai por parâmetro.
  EXECUTE format(
    'UPDATE public.online_payment_config SET %I = $1::%s, updated_at = now() WHERE restaurant_id = $2',
    p_field, v_tipo
  ) USING p_value, p_restaurant_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_delete_payment_config(p_restaurant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._exigir_staff();
  DELETE FROM public.online_payment_config WHERE restaurant_id = p_restaurant_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_pix_pos_config(p_restaurant_id uuid)
RETURNS TABLE (mp_pos_id text, mp_pos_name text, mp_user_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._exigir_staff();
  RETURN QUERY
    SELECT c.mp_pos_id, c.mp_pos_name, c.mp_user_id
    FROM public.online_payment_config c
    WHERE c.restaurant_id = p_restaurant_id;
END $$;

-- ── fiscal ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_fiscal_config(p_restaurant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public._exigir_staff();
  SELECT to_jsonb(f) - 'certificate_password' INTO v
  FROM public.fiscal_configs f WHERE f.restaurant_id = p_restaurant_id;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_fiscal_config(p_restaurant_id uuid, p_data jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_permitidos constant text[] := ARRAY[
    'cnpj','razao_social','nome_fantasia','inscricao_estadual','inscricao_municipal',
    'email','telefone','cep','logradouro','numero','complemento','bairro',
    'municipio_codigo','municipio_nome','uf','csc_id','csc_code',
    'certificate_password','certificate_file_path','nuvem_fiscal_status',
    'nfce_serie','nfce_numero'
  ];
  v_limpo jsonb;
BEGIN
  PERFORM public._exigir_staff();
  SELECT coalesce(jsonb_object_agg(k, val), '{}'::jsonb) INTO v_limpo
  FROM jsonb_each(p_data) AS e(k, val)
  WHERE k = ANY(v_permitidos);

  INSERT INTO public.fiscal_configs (restaurant_id) VALUES (p_restaurant_id)
  ON CONFLICT DO NOTHING;

  UPDATE public.fiscal_configs f
     SET (cnpj, razao_social, nome_fantasia, inscricao_estadual, inscricao_municipal,
          email, telefone, cep, logradouro, numero, complemento, bairro,
          municipio_codigo, municipio_nome, uf, csc_id, csc_code,
          certificate_password, certificate_file_path, nuvem_fiscal_status,
          nfce_serie, nfce_numero, updated_at)
       = (
          coalesce(v_limpo->>'cnpj', f.cnpj),
          coalesce(v_limpo->>'razao_social', f.razao_social),
          coalesce(v_limpo->>'nome_fantasia', f.nome_fantasia),
          coalesce(v_limpo->>'inscricao_estadual', f.inscricao_estadual),
          coalesce(v_limpo->>'inscricao_municipal', f.inscricao_municipal),
          coalesce(v_limpo->>'email', f.email),
          coalesce(v_limpo->>'telefone', f.telefone),
          coalesce(v_limpo->>'cep', f.cep),
          coalesce(v_limpo->>'logradouro', f.logradouro),
          coalesce(v_limpo->>'numero', f.numero),
          coalesce(v_limpo->>'complemento', f.complemento),
          coalesce(v_limpo->>'bairro', f.bairro),
          coalesce(v_limpo->>'municipio_codigo', f.municipio_codigo),
          coalesce(v_limpo->>'municipio_nome', f.municipio_nome),
          coalesce(v_limpo->>'uf', f.uf),
          coalesce(v_limpo->>'csc_id', f.csc_id),
          coalesce(v_limpo->>'csc_code', f.csc_code),
          coalesce(v_limpo->>'certificate_password', f.certificate_password),
          coalesce(v_limpo->>'certificate_file_path', f.certificate_file_path),
          coalesce(v_limpo->>'nuvem_fiscal_status', f.nuvem_fiscal_status),
          coalesce((v_limpo->>'nfce_serie')::int, f.nfce_serie),
          coalesce((v_limpo->>'nfce_numero')::int, f.nfce_numero),
          now())
   WHERE f.restaurant_id = p_restaurant_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_update_fiscal_config(p_restaurant_id uuid, p_updates jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.admin_upsert_fiscal_config(p_restaurant_id, p_updates);
$$;

-- ── iFood ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_ifood_config(p_restaurant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public._exigir_staff();
  SELECT jsonb_build_object(
           'id', c.id, 'restaurant_id', c.restaurant_id, 'enabled', c.enabled,
           'merchant_id', c.merchant_id, 'token_expires_at', c.token_expires_at,
           'access_token', c.access_token)
    INTO v
  FROM public.ifood_config c WHERE c.restaurant_id = p_restaurant_id;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.admin_toggle_ifood(p_restaurant_id uuid, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._exigir_staff();
  INSERT INTO public.ifood_config (restaurant_id, enabled)
  VALUES (p_restaurant_id, p_enabled)
  ON CONFLICT (restaurant_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
END $$;

-- ── Delivery Direto ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_dd_config(p_restaurant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public._exigir_staff();
  SELECT jsonb_build_object(
           'id', c.id, 'restaurant_id', c.restaurant_id, 'enabled', c.enabled,
           'store_id', c.store_id, 'username', c.username,
           'access_token', c.access_token, 'token_expires_at', c.token_expires_at)
    INTO v
  FROM public.deliverydireto_config c WHERE c.restaurant_id = p_restaurant_id;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.admin_toggle_dd(p_restaurant_id uuid, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._exigir_staff();
  INSERT INTO public.deliverydireto_config (restaurant_id, enabled)
  VALUES (p_restaurant_id, p_enabled)
  ON CONFLICT (restaurant_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
END $$;

-- ── usuários CEO ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_ceo_users()
RETURNS TABLE (id uuid, username text, display_name text, is_active boolean, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._exigir_ceo();
  RETURN QUERY
    SELECT u.id, u.username, u.display_name, u.is_active, u.created_at
    FROM public.ceo_users u ORDER BY u.username;
END $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_ceo_user(
  p_id uuid DEFAULT NULL, p_username text DEFAULT NULL,
  p_password_hash text DEFAULT NULL, p_display_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._exigir_ceo();
  IF p_id IS NULL THEN
    INSERT INTO public.ceo_users (username, password_hash, display_name, is_active)
    VALUES (p_username, p_password_hash, coalesce(p_display_name, p_username), true);
  ELSE
    UPDATE public.ceo_users
       SET username      = coalesce(p_username, username),
           password_hash = coalesce(p_password_hash, password_hash),
           display_name  = coalesce(p_display_name, display_name)
     WHERE id = p_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_delete_ceo_user(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._exigir_ceo();
  -- não deixa remover o último CEO: ninguém mais entraria no painel
  IF (SELECT count(*) FROM public.ceo_users WHERE is_active) <= 1 THEN
    RAISE EXCEPTION 'Nao e possivel remover o ultimo usuario CEO ativo' USING ERRCODE = '23514';
  END IF;
  DELETE FROM public.ceo_users WHERE id = p_id;
END $$;

-- ── permissões ──────────────────────────────────────────────────────────
DO $g$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'admin_get_payment_config','get_public_payment_config','admin_ensure_payment_config',
      'admin_upsert_payment_config','admin_delete_payment_config','admin_get_pix_pos_config',
      'admin_get_fiscal_config','admin_upsert_fiscal_config','admin_update_fiscal_config',
      'admin_get_ifood_config','admin_toggle_ifood','admin_get_dd_config','admin_toggle_dd',
      'admin_list_ceo_users','admin_upsert_ceo_user','admin_delete_ceo_user')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
  END LOOP;
END $g$;

REVOKE ALL ON FUNCTION public._exigir_staff() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._exigir_ceo()   FROM PUBLIC, anon, authenticated;

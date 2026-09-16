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

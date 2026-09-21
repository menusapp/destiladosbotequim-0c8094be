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

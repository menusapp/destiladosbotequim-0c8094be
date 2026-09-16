-- Batch: pending migrations from repo (customer/qr RPCs, storage+admin RPC session fixes, upsell category, cron schedules)
SET search_path = public;

CREATE OR REPLACE FUNCTION public.record_reward_redemption(
  p_cpf text, p_program_id uuid, p_reward_id uuid,
  p_order_id uuid DEFAULT NULL, p_trigger_value numeric DEFAULT 0
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rid uuid := public.default_restaurant_id();
BEGIN
  IF EXISTS (SELECT 1 FROM public.loyalty_reward_redemptions r
    WHERE r.restaurant_id = v_rid AND r.customer_cpf = p_cpf AND r.reward_id = p_reward_id
      AND (p_program_id IS NULL OR r.program_id = p_program_id)) THEN RETURN false; END IF;
  INSERT INTO public.loyalty_reward_redemptions
    (restaurant_id, customer_cpf, program_id, reward_id, order_id, trigger_value, redeemed_at)
  VALUES (v_rid, p_cpf, p_program_id, p_reward_id, p_order_id, p_trigger_value, now());
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.list_reward_redemptions(p_cpf text, p_program_id uuid)
RETURNS TABLE(reward_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.reward_id FROM public.loyalty_reward_redemptions r
  WHERE r.restaurant_id = public.default_restaurant_id()
    AND r.customer_cpf = p_cpf AND r.program_id = p_program_id
$$;

CREATE OR REPLACE FUNCTION public.customer_phone_taken(p_phone text, p_exclude_cpf text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.customers c
    WHERE c.restaurant_id = public.default_restaurant_id()
      AND regexp_replace(COALESCE(c.phone,''), '\D', '', 'g') = regexp_replace(COALESCE(p_phone,''), '\D', '', 'g')
      AND p_phone IS NOT NULL AND p_phone <> ''
      AND (p_exclude_cpf IS NULL OR c.cpf <> p_exclude_cpf))
$$;

DO $$
DECLARE r record; fns text[] := ARRAY['record_reward_redemption','list_reward_redemptions','customer_phone_taken'];
BEGIN
  FOR r IN SELECT p.oid::regprocedure::text AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(fns) LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
  END LOOP;
END $$;

-- ============ QR / comanda RPCs ============
CREATE OR REPLACE FUNCTION public.get_comanda_orders(
  p_table_id uuid, p_comanda_id uuid DEFAULT NULL, p_customer_cpf text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH last_paid AS (
    SELECT max(b.paid_at) AS paid_at FROM public.bills b
    WHERE b.status = 'paid'
      AND ((p_comanda_id IS NOT NULL AND b.comanda_id = p_comanda_id)
           OR (p_comanda_id IS NULL AND b.table_id = p_table_id))
  ),
  sel AS (
    SELECT o.* FROM public.orders o
    WHERE o.restaurant_id = public.default_restaurant_id()
      AND ((p_comanda_id IS NOT NULL AND o.comanda_id = p_comanda_id)
           OR (p_comanda_id IS NULL AND o.table_id = p_table_id
               AND o.customer_cpf = p_customer_cpf
               AND o.status IN ('pending','accepted','preparing','ready')
               AND ((SELECT paid_at FROM last_paid) IS NULL OR o.created_at > (SELECT paid_at FROM last_paid))))
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', o.id, 'status', o.status, 'created_at', o.created_at,
      'customer_name', o.customer_name, 'notes', o.notes,
      'order_items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', oi.id, 'quantity', oi.quantity, 'price_at_order', oi.price_at_order, 'notes', oi.notes,
          'products', (SELECT jsonb_build_object('name', p.name, 'prep_time_minutes', p.prep_time_minutes)
                       FROM public.products p WHERE p.id = oi.product_id),
          'order_item_extras', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'price_at_order', oie.price_at_order, 'extra_name', oie.extra_name,
              'product_extras', (SELECT jsonb_build_object('name', pe.name)
                                 FROM public.product_extras pe WHERE pe.id = oie.product_extra_id)))
            FROM public.order_item_extras oie WHERE oie.order_item_id = oi.id), '[]'::jsonb)))
        FROM public.order_items oi WHERE oi.order_id = o.id), '[]'::jsonb)
    ) ORDER BY o.created_at DESC), '[]'::jsonb)
  FROM sel o
$$;

CREATE OR REPLACE FUNCTION public.get_active_bill(p_table_id uuid, p_comanda_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, status text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT b.id, b.status FROM public.bills b
  WHERE b.status IN ('requested','on_the_way')
    AND ((p_comanda_id IS NOT NULL AND b.comanda_id = p_comanda_id)
         OR (p_comanda_id IS NULL AND b.table_id = p_table_id))
  ORDER BY b.created_at DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.table_has_activity(p_table_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.bills b
      WHERE b.table_id = p_table_id AND b.status IN ('requested','on_the_way','pending'))
    OR EXISTS (SELECT 1 FROM public.comandas c
      WHERE c.table_id = p_table_id AND c.status = 'active'
        AND c.restaurant_id = public.default_restaurant_id())
    OR EXISTS (SELECT 1 FROM public.orders o
      WHERE o.table_id = p_table_id AND o.status IN ('pending','accepted','preparing','ready')
        AND o.restaurant_id = public.default_restaurant_id())
$$;

DO $$
DECLARE r record; fns text[] := ARRAY['get_comanda_orders','get_active_bill','table_has_activity'];
BEGIN
  FOR r IN SELECT p.oid::regprocedure::text AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(fns) LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
  END LOOP;
END $$;

-- ============ Storage policies for staff-token session ============
DROP POLICY IF EXISTS "auth_write_product_images"  ON storage.objects;
DROP POLICY IF EXISTS "auth_update_product_images" ON storage.objects;
DROP POLICY IF EXISTS "auth_delete_product_images" ON storage.objects;
DROP POLICY IF EXISTS "auth_write_table_images"    ON storage.objects;
DROP POLICY IF EXISTS "auth_update_table_images"   ON storage.objects;
DROP POLICY IF EXISTS "auth_delete_table_images"   ON storage.objects;

-- [migração p/ Supabase próprio] estas policies já podem existir de uma
-- migration anterior; ao reproduzir o histórico num projeto novo o
-- CREATE POLICY falhava com "already exists".
DROP POLICY IF EXISTS "staff_write_product_images"  ON storage.objects;
DROP POLICY IF EXISTS "staff_update_product_images" ON storage.objects;
DROP POLICY IF EXISTS "staff_delete_product_images" ON storage.objects;
DROP POLICY IF EXISTS "staff_write_table_images"    ON storage.objects;
DROP POLICY IF EXISTS "staff_update_table_images"   ON storage.objects;
DROP POLICY IF EXISTS "staff_delete_table_images"   ON storage.objects;

CREATE POLICY "staff_write_product_images" ON storage.objects
  FOR INSERT TO public WITH CHECK (bucket_id = 'product-images' AND public.is_staff());
CREATE POLICY "staff_update_product_images" ON storage.objects
  FOR UPDATE TO public USING (bucket_id = 'product-images' AND public.is_staff())
  WITH CHECK (bucket_id = 'product-images' AND public.is_staff());
CREATE POLICY "staff_delete_product_images" ON storage.objects
  FOR DELETE TO public USING (bucket_id = 'product-images' AND public.is_staff());
CREATE POLICY "staff_write_table_images" ON storage.objects
  FOR INSERT TO public WITH CHECK (bucket_id = 'table-images' AND public.is_staff());
CREATE POLICY "staff_update_table_images" ON storage.objects
  FOR UPDATE TO public USING (bucket_id = 'table-images' AND public.is_staff())
  WITH CHECK (bucket_id = 'table-images' AND public.is_staff());
CREATE POLICY "staff_delete_table_images" ON storage.objects
  FOR DELETE TO public USING (bucket_id = 'table-images' AND public.is_staff());

-- ============ Guard admin_* RPCs with is_staff()/is_ceo() ============
DO $outer$
DECLARE
  r record; v_impl text; v_callargs text; v_body text;
  fns text[] := ARRAY[
    'admin_update_order_status','admin_cancel_order_item','admin_delete_order',
    'admin_delete_category','admin_delete_product','admin_delete_stock_item',
    'admin_list_staff','admin_upsert_staff','admin_create_staff','admin_delete_staff',
    'admin_toggle_staff_active','admin_get_whatsapp_status','admin_get_point_terminals',
    'admin_upsert_point_terminal','admin_delete_point_terminal','check_mp_token_expiry',
    'restore_stock_for_order_item','admin_delete_bill','admin_delete_bill_and_orders',
    'admin_delete_order_and_bill','admin_delete_product_extra','admin_mark_bill_on_the_way',
    'admin_mark_bill_paid','admin_update_restaurant_settings','admin_delete_payment_config',
    'admin_get_payment_config','admin_upsert_payment_config','admin_ensure_payment_config',
    'admin_get_ifood_config','admin_toggle_ifood','admin_toggle_dd','admin_get_dd_config'
  ];
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, p.pronargs, p.proretset,
           (p.prorettype = 'void'::regtype) AS is_void,
           pg_get_function_arguments(p.oid) AS args,
           pg_get_function_identity_arguments(p.oid) AS idargs,
           pg_get_function_result(p.oid) AS result,
           pg_get_functiondef(p.oid) AS def,
           COALESCE(p.proargmodes, '{}') AS argmodes
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(fns)
  LOOP
    BEGIN
      IF r.argmodes && ARRAY['o','b','v']::"char"[] THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', r.proname, r.idargs);
        CONTINUE;
      END IF;
      IF r.def ILIKE '%is_staff()%' OR r.def ILIKE '%is_ceo()%' THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon, authenticated', r.proname, r.idargs);
        CONTINUE;
      END IF;
      v_impl := r.proname || '_secured_impl_' || r.oid::text;
      SELECT string_agg('$' || g, ', ') INTO v_callargs FROM generate_series(1, GREATEST(r.pronargs, 0)) g;
      v_callargs := COALESCE(v_callargs, '');
      EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I', r.proname, r.idargs, v_impl);
      IF r.is_void THEN
        v_body := format('BEGIN IF NOT (public.is_staff() OR public.is_ceo()) THEN RAISE EXCEPTION %L USING ERRCODE = %L; END IF; PERFORM public.%I(%s); END;',
          'Acesso negado: sessao de staff necessaria', '42501', v_impl, v_callargs);
      ELSIF r.proretset THEN
        v_body := format('BEGIN IF NOT (public.is_staff() OR public.is_ceo()) THEN RAISE EXCEPTION %L USING ERRCODE = %L; END IF; RETURN QUERY SELECT * FROM public.%I(%s); END;',
          'Acesso negado: sessao de staff necessaria', '42501', v_impl, v_callargs);
      ELSE
        v_body := format('BEGIN IF NOT (public.is_staff() OR public.is_ceo()) THEN RAISE EXCEPTION %L USING ERRCODE = %L; END IF; RETURN public.%I(%s); END;',
          'Acesso negado: sessao de staff necessaria', '42501', v_impl, v_callargs);
      END IF;
      EXECUTE format('CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $w$ %s $w$',
        r.proname, r.args, r.result, v_body);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon, authenticated', r.proname, r.idargs);
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon, public', v_impl, r.idargs);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'guard_admin_rpcs: falhou em % (%): %', r.proname, r.idargs, SQLERRM;
    END;
  END LOOP;
END $outer$;

-- ============ Upsell by category ============
ALTER TABLE public.product_upsells
  ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'product',
  ADD COLUMN IF NOT EXISTS trigger_category_id uuid REFERENCES public.categories(id) ON DELETE CASCADE;

ALTER TABLE public.product_upsells ALTER COLUMN trigger_product_id DROP NOT NULL;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE conrelid = 'public.product_upsells'::regclass
  LOOP
    IF r.def ILIKE '%trigger_product_id%' AND (upper(r.def) LIKE 'UNIQUE%' OR r.def LIKE '%<>%') THEN
      EXECUTE format('ALTER TABLE public.product_upsells DROP CONSTRAINT %I', r.conname);
    END IF;
  END LOOP;
END $$;

-- [migração p/ Supabase próprio] estes constraints já são criados pela
-- migration 20260723080000; ao reproduzir o histórico num projeto novo o
-- ADD CONSTRAINT falhava com "already exists".
ALTER TABLE public.product_upsells
  DROP CONSTRAINT IF EXISTS product_upsells_trigger_type_chk,
  DROP CONSTRAINT IF EXISTS product_upsells_trigger_oneof_chk,
  DROP CONSTRAINT IF EXISTS product_upsells_not_self_chk;

ALTER TABLE public.product_upsells
  ADD CONSTRAINT product_upsells_trigger_type_chk CHECK (trigger_type IN ('product','category')),
  ADD CONSTRAINT product_upsells_trigger_oneof_chk CHECK (
    (trigger_type = 'product'  AND trigger_product_id IS NOT NULL AND trigger_category_id IS NULL)
    OR (trigger_type = 'category' AND trigger_category_id IS NOT NULL AND trigger_product_id IS NULL)),
  ADD CONSTRAINT product_upsells_not_self_chk CHECK (trigger_product_id IS NULL OR trigger_product_id <> upsell_product_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_upsell_product_trigger
  ON public.product_upsells (trigger_product_id, upsell_product_id) WHERE trigger_type = 'product';
CREATE UNIQUE INDEX IF NOT EXISTS uniq_upsell_category_trigger
  ON public.product_upsells (trigger_category_id, upsell_product_id) WHERE trigger_type = 'category';
CREATE INDEX IF NOT EXISTS idx_product_upsells_trigger_cat
  ON public.product_upsells (trigger_category_id) WHERE is_active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_upsells TO anon, authenticated;

-- ============ Cron: marketing-scheduler + abandoned-carts + absence-scanner ============
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job
    WHERE jobname IN ('marketing-scheduler-every-min','process-abandoned-carts-15m','marketing-absence-scanner-10m')
  LOOP PERFORM cron.unschedule(j.jobid); END LOOP;
END $$;

SELECT cron.schedule('marketing-scheduler-every-min', '* * * * *', $cron$
  SELECT net.http_post(
    url := 'https://ksscrxwvslddfqxjxzlo.supabase.co/functions/v1/marketing-scheduler',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer sb_publishable_Ur3NJvcsw2G8F65DniEXBw_tfEc2ypP'),
    body := '{}'::jsonb);
$cron$);

SELECT cron.schedule('process-abandoned-carts-15m', '*/15 * * * *', $cron$
  SELECT net.http_post(
    url := 'https://ksscrxwvslddfqxjxzlo.supabase.co/functions/v1/process-abandoned-carts',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer sb_publishable_Ur3NJvcsw2G8F65DniEXBw_tfEc2ypP'),
    body := '{}'::jsonb);
$cron$);

SELECT cron.schedule('marketing-absence-scanner-10m', '*/10 * * * *', $cron$
  SELECT net.http_post(
    url := 'https://ksscrxwvslddfqxjxzlo.supabase.co/functions/v1/marketing-absence-scanner',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer sb_publishable_Ur3NJvcsw2G8F65DniEXBw_tfEc2ypP'),
    body := '{}'::jsonb);
$cron$);
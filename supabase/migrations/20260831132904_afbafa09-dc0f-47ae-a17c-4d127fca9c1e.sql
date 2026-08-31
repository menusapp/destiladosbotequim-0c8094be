-- 1) Coupon usage via controlled function
CREATE OR REPLACE FUNCTION public.increment_coupon_usage(p_coupon_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.coupons
     SET used_count = COALESCE(used_count, 0) + 1
   WHERE id = p_coupon_id
     AND is_active = true
     AND (usage_limit IS NULL OR COALESCE(used_count,0) < usage_limit);
END;
$$;
REVOKE ALL ON FUNCTION public.increment_coupon_usage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_coupon_usage(uuid) TO anon, authenticated, service_role;
DROP POLICY IF EXISTS zz_temp_anon_update ON public.coupons;

-- 2) Customer phone backfill via controlled function
CREATE OR REPLACE FUNCTION public.set_customer_phone_if_empty(p_restaurant_id uuid, p_cpf text, p_phone text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_phone IS NULL OR btrim(p_phone) = '' THEN RETURN; END IF;
  UPDATE public.customers
     SET phone = p_phone
   WHERE restaurant_id = p_restaurant_id
     AND cpf = p_cpf
     AND (phone IS NULL OR btrim(phone) = '');
END;
$$;
REVOKE ALL ON FUNCTION public.set_customer_phone_if_empty(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_customer_phone_if_empty(uuid, text, text) TO anon, authenticated, service_role;
DROP POLICY IF EXISTS zz_temp_anon_update ON public.customers;

-- 3) Addresses / cards: no direct anon writes (RPCs cover these paths)
DROP POLICY IF EXISTS zz_temp_anon_insert ON public.customer_addresses;
DROP POLICY IF EXISTS zz_temp_anon_delete ON public.customer_addresses;
DROP POLICY IF EXISTS zz_temp_anon_insert ON public.customer_cards;
DROP POLICY IF EXISTS zz_temp_anon_delete ON public.customer_cards;

-- 4) Bills: anon cannot update
DROP POLICY IF EXISTS zz_temp_anon_update ON public.bills;

-- 5) Orders: narrow anon update window to the customer's own checkout window
DROP POLICY IF EXISTS zz_temp_anon_update ON public.orders;
CREATE POLICY zz_temp_anon_update ON public.orders FOR UPDATE TO public
  USING (restaurant_id = public.default_restaurant_id() AND created_at > now() - interval '3 hours')
  WITH CHECK (restaurant_id = public.default_restaurant_id() AND created_at > now() - interval '3 hours');
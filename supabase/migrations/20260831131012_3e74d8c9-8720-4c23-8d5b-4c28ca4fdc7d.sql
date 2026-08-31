CREATE OR REPLACE FUNCTION public.track_customer_session(
  p_restaurant_id uuid,
  p_session_token text,
  p_fields jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists uuid;
BEGIN
  IF p_restaurant_id IS NULL OR p_session_token IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_exists
  FROM public.customer_sessions
  WHERE session_token = p_session_token AND restaurant_id = p_restaurant_id;

  IF v_exists IS NULL THEN
    INSERT INTO public.customer_sessions (
      restaurant_id, session_token, status, name, phone, cart_items, cart_value,
      checkout_step, coupon_code, delivery_address, delivery_type, last_activity
    ) VALUES (
      p_restaurant_id,
      p_session_token,
      COALESCE(p_fields->>'status', 'browsing'),
      NULLIF(p_fields->>'name',''),
      NULLIF(p_fields->>'phone',''),
      COALESCE(p_fields->'cart_items', '[]'::jsonb),
      COALESCE((p_fields->>'cart_value')::numeric, 0),
      NULLIF(p_fields->>'checkout_step',''),
      NULLIF(p_fields->>'coupon_code',''),
      NULLIF(p_fields->>'delivery_address',''),
      NULLIF(p_fields->>'delivery_type',''),
      now()
    )
    ON CONFLICT (session_token, restaurant_id) DO NOTHING;
  ELSE
    UPDATE public.customer_sessions SET
      status           = COALESCE(NULLIF(p_fields->>'status',''), status),
      name             = COALESCE(NULLIF(p_fields->>'name',''), name),
      phone            = COALESCE(NULLIF(p_fields->>'phone',''), phone),
      cart_items       = COALESCE(p_fields->'cart_items', cart_items),
      cart_value       = COALESCE((p_fields->>'cart_value')::numeric, cart_value),
      checkout_step    = COALESCE(NULLIF(p_fields->>'checkout_step',''), checkout_step),
      coupon_code      = CASE WHEN p_fields ? 'coupon_code' THEN NULLIF(p_fields->>'coupon_code','') ELSE coupon_code END,
      delivery_address = CASE WHEN p_fields ? 'delivery_address' THEN NULLIF(p_fields->>'delivery_address','') ELSE delivery_address END,
      delivery_type    = COALESCE(NULLIF(p_fields->>'delivery_type',''), delivery_type),
      last_activity    = now()
    WHERE id = v_exists;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.track_customer_session(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_customer_session(uuid, text, jsonb) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS zz_temp_anon_insert ON public.customer_sessions;
DROP POLICY IF EXISTS zz_temp_anon_update ON public.customer_sessions;
CREATE OR REPLACE FUNCTION public.finalize_order_payment(
  p_order_id uuid,
  p_payment_type text DEFAULT NULL,
  p_payment_status text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_online_payment_id text DEFAULT NULL,
  p_comanda_id uuid DEFAULT NULL,
  p_payment_brand text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ok boolean := false;
BEGIN
  UPDATE public.orders o
     SET payment_type      = COALESCE(p_payment_type, o.payment_type),
         payment_status    = COALESCE(p_payment_status, o.payment_status),
         status            = COALESCE(p_status, o.status),
         online_payment_id = COALESCE(p_online_payment_id, o.online_payment_id),
         comanda_id        = COALESCE(p_comanda_id, o.comanda_id),
         payment_brand     = COALESCE(p_payment_brand, o.payment_brand),
         paid_at           = CASE WHEN p_payment_status = 'paid' THEN now() ELSE o.paid_at END
   WHERE o.id = p_order_id
     AND o.created_at > now() - interval '6 hours'
     AND COALESCE(o.payment_status, 'pending') <> 'paid';
  v_ok := FOUND;
  RETURN v_ok;
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_order_payment(uuid, text, text, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_order_payment(uuid, text, text, text, text, uuid, text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS zz_temp_anon_update ON public.orders;
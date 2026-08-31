-- Loyalty: no anon writes (staff/panel and SECURITY DEFINER functions still work)
DROP POLICY IF EXISTS zz_temp_anon_insert ON public.loyalty_points;
DROP POLICY IF EXISTS zz_temp_anon_update ON public.loyalty_points;

-- Comandas: no anon updates (only staff closes/edits comandas)
DROP POLICY IF EXISTS zz_temp_anon_update ON public.comandas;

-- Orders: narrow anon update window + protect sensitive columns via trigger
DROP POLICY IF EXISTS zz_temp_anon_update ON public.orders;
CREATE POLICY zz_temp_anon_update ON public.orders FOR UPDATE TO public
  USING (
    restaurant_id = public.default_restaurant_id()
    AND created_at > now() - interval '3 hours'
    AND COALESCE(payment_status, 'pending') <> 'paid'
    AND COALESCE(status, 'pending') IN ('pending', 'preparing')
  )
  WITH CHECK (
    restaurant_id = public.default_restaurant_id()
    AND created_at > now() - interval '3 hours'
  );

CREATE OR REPLACE FUNCTION public.guard_anon_order_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Staff / service_role keep full control
  IF public.is_staff() OR current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Anonymous customer path: only payment/checkout fields may change
  NEW.restaurant_id       := OLD.restaurant_id;
  NEW.created_at          := OLD.created_at;
  NEW.customer_cpf        := OLD.customer_cpf;
  NEW.customer_name       := OLD.customer_name;
  NEW.coupon_discount     := OLD.coupon_discount;
  NEW.manual_discount     := OLD.manual_discount;
  NEW.cancellation_reason := OLD.cancellation_reason;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_anon_order_update ON public.orders;
CREATE TRIGGER trg_guard_anon_order_update
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_anon_order_update();
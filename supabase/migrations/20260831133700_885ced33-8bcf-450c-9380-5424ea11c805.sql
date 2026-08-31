CREATE OR REPLACE FUNCTION public.guard_anon_order_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_staff() OR current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  NEW.restaurant_id       := OLD.restaurant_id;
  NEW.created_at          := OLD.created_at;
  NEW.customer_cpf        := OLD.customer_cpf;
  NEW.customer_name       := OLD.customer_name;
  NEW.coupon_discount     := OLD.coupon_discount;
  NEW.cancellation_reason := OLD.cancellation_reason;
  RETURN NEW;
END;
$$;
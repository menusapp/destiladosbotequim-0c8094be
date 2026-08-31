-- restaurant_staff: hide password_hash from Data API roles
REVOKE SELECT ON public.restaurant_staff FROM anon, authenticated;
GRANT SELECT (id, restaurant_id, username, display_name, role, allowed_sections, is_active,
              created_at, updated_at, can_manage_orders, receives_order_notifications)
  ON public.restaurant_staff TO anon, authenticated;

-- restaurant_credentials: hide password_hash from Data API roles
REVOKE SELECT ON public.restaurant_credentials FROM anon, authenticated;
GRANT SELECT (id, restaurant_id, username, created_at)
  ON public.restaurant_credentials TO anon, authenticated;
REVOKE SELECT ON public.restaurants FROM anon;
GRANT SELECT (
  id, name, slug, logo_url, primary_color, secondary_color, created_at, updated_at,
  is_open, service_fee_enabled, service_fee_percentage, prep_time_minutes, banner_url,
  rating, review_count, featured_section_enabled, featured_section_title,
  loyalty_enabled, loyalty_points_per_real, loyalty_real_per_point, pickup_time_minutes,
  login_require_name, login_require_phone, auto_open_close, reservations_enabled,
  reservations_follow_business_hours, bill_request_enabled, show_prep_timer,
  trial_started_at, trial_ends_at, trial_expired, pending_plan_slug,
  login_require_birth_date, facebook_pixel_id, auto_accept_orders, login_require_cpf,
  target_cmv_percentage, uf, municipio_codigo
) ON public.restaurants TO anon;
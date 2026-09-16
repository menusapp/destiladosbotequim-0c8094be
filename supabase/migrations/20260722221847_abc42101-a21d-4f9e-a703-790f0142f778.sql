
-- 1) product_upsells
CREATE TABLE IF NOT EXISTS public.product_upsells (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  trigger_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  upsell_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  discount_type text NOT NULL DEFAULT 'percentage' CHECK (discount_type IN ('percentage','fixed')),
  discount_value numeric NOT NULL CHECK (discount_value > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trigger_product_id, upsell_product_id),
  CHECK (trigger_product_id <> upsell_product_id)
);

GRANT SELECT ON public.product_upsells TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_upsells TO authenticated;
GRANT ALL ON public.product_upsells TO service_role;

ALTER TABLE public.product_upsells ENABLE ROW LEVEL SECURITY;

-- [migração p/ Supabase próprio] as policies abaixo já são criadas pela
-- migration 20260722220000; ao reproduzir o histórico num projeto novo o
-- CREATE POLICY falhava com "already exists". DROP IF EXISTS torna idempotente.
DROP POLICY IF EXISTS "public_read" ON public.product_upsells;
DROP POLICY IF EXISTS "staff_all" ON public.product_upsells;

CREATE POLICY "public_read" ON public.product_upsells
  FOR SELECT USING (is_active = true);
CREATE POLICY "staff_all" ON public.product_upsells
  FOR ALL TO authenticated
  USING (restaurant_id = public.current_restaurant_id())
  WITH CHECK (restaurant_id = public.current_restaurant_id());

CREATE INDEX IF NOT EXISTS idx_product_upsells_trigger
  ON public.product_upsells (trigger_product_id) WHERE is_active;

-- 2) WhatsApp review link + seed notification types
ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS review_link_url text;

INSERT INTO public.whatsapp_notification_configs
  (restaurant_id, notification_type, is_active, template_message, send_delay_minutes)
SELECT r.id, t.type, true, t.template, 0
FROM public.restaurants r
CROSS JOIN (VALUES
  ('order_preparing',
   '👨‍🍳 Olá {{nome}}! Seu pedido #{{numero_pedido}} está em preparo!' || E'\n\n' || '⏱️ Tempo estimado: {{tempo_estimado}} minutos.'),
  ('order_ready_pickup',
   '📦 Olá {{nome}}! Seu pedido #{{numero_pedido}} está pronto para retirada! Aguardamos você! 😊')
) AS t(type, template)
WHERE NOT EXISTS (
  SELECT 1 FROM public.whatsapp_notification_configs w
  WHERE w.restaurant_id = r.id AND w.notification_type = t.type
);

-- 3) checkout_step no customer_sessions
ALTER TABLE public.customer_sessions
  ADD COLUMN IF NOT EXISTS checkout_step text;

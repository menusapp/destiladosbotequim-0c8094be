-- =====================================================================
-- Estabelecimento único com todos os módulos liberados
-- ---------------------------------------------------------------------
-- O sistema nasceu SaaS: os módulos do painel são liberados conforme
-- `subscription_plans.features` da assinatura ativa do restaurante, e há
-- ainda trial com data de expiração (ver src/hooks/useRestaurantModules.ts).
-- Como agora existe um só estabelecimento, e ele é o dono do sistema, essa
-- cobrança não faz sentido — mas o gate está no DADO, não no código.
--
-- Em vez de arrancar a lógica (o que espalharia mudanças por várias telas e
-- ficaria difícil de reverter), semeamos o dado que a destrava:
--
--   * um plano interno com os 13 módulos e preço zero;
--   * assinatura ativa, sem trial e sem data de vencimento;
--   * marcas de trial do restaurante zeradas.
--
-- O nome do plano precisa conter "Avançado": é assim que src/config/plans.ts
-- resolve o limite de usuários da equipe como ilimitado.
--
-- Idempotente — pode rodar de novo sem duplicar.
-- =====================================================================

DO $plano$
DECLARE
  v_rest uuid;
  v_plan uuid;
  v_features jsonb := '[
    "cardapio","pdv","mesas","estoque","financeiro","fidelidade","delivery",
    "marketing","whatsapp","fiscal","pagamentos_online","reservas","totem"
  ]'::jsonb;
  v_futuro timestamptz := '2099-12-31 00:00:00+00';
BEGIN
  SELECT id INTO v_rest FROM public.restaurants WHERE slug = 'destilado-botequim';
  IF v_rest IS NULL THEN
    RAISE NOTICE 'Restaurante destilado-botequim não encontrado — nada a fazer.';
    RETURN;
  END IF;

  -- ── plano interno com tudo ──────────────────────────────────────────
  SELECT id INTO v_plan FROM public.subscription_plans WHERE name = 'Avançado (uso próprio)';
  IF v_plan IS NULL THEN
    INSERT INTO public.subscription_plans (name, description, price, features, is_active)
    VALUES ('Avançado (uso próprio)',
            'Plano interno do estabelecimento — todos os módulos, sem cobrança.',
            0, v_features, true)
    RETURNING id INTO v_plan;
  ELSE
    UPDATE public.subscription_plans
       SET features = v_features, price = 0, is_active = true
     WHERE id = v_plan;
  END IF;

  -- ── assinatura ativa e permanente ───────────────────────────────────
  -- Derruba assinaturas anteriores para não deixar duas ativas: o hook pega
  -- a mais recente, e duas ativas já causaram inconsistência neste código.
  UPDATE public.restaurant_subscriptions
     SET status = 'cancelled'
   WHERE restaurant_id = v_rest AND status = 'active';

  INSERT INTO public.restaurant_subscriptions (
    restaurant_id, plan_id, status, started_at, expires_at,
    next_payment_at, is_trial, failed_payments, in_grace_period,
    current_period_start, current_period_end
  ) VALUES (
    v_rest, v_plan, 'active', now(), v_futuro,
    v_futuro, false, 0, false,
    current_date, v_futuro::date
  );

  -- ── zera as marcas de trial do restaurante ──────────────────────────
  UPDATE public.restaurants
     SET trial_expired  = false,
         trial_ends_at  = v_futuro,
         trial_started_at = coalesce(trial_started_at, now())
   WHERE id = v_rest;

  RAISE NOTICE 'Plano liberado: 13 módulos, sem trial, sem vencimento.';
END
$plano$;

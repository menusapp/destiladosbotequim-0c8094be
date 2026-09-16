-- =====================================================================
-- Tira a URL do projeto e a API key de dentro do código dos cron jobs
-- ---------------------------------------------------------------------
-- Os agendamentos chamavam as edge functions com a URL e a chave do projeto
-- ESCRITAS À MÃO dentro do comando do cron e dentro da função
-- trigger_ifood_polling_all(). Já deu problema uma vez: a migration
-- 20260728210000 existe justamente porque os jobs tinham ficado apontados
-- para um projeto antigo e, por meses, NADA rodou (campanha agendada,
-- carrinho abandonado, gatilho de ausência, polling do iFood).
--
-- Ao trocar de projeto Supabase isso aconteceria de novo: os jobs seriam
-- criados apontando para o projeto do Lovable.
--
-- Aqui a URL e a chave passam a ser DADO, não código: ficam em
-- public.app_runtime_config e são lidas a cada execução. Trocar de projeto
-- vira um UPDATE — nenhuma migration nova, nenhum deploy.
--
-- Depois de criar o projeto novo, rode (ou use scripts/configurar-supabase.sh):
--
--   SELECT public.set_app_runtime_config(
--     'https://SEU_REF.supabase.co',
--     'SUA_PUBLISHABLE_OU_ANON_KEY'
--   );
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.app_runtime_config (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_runtime_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_runtime_config FROM anon, authenticated;
GRANT ALL ON public.app_runtime_config TO service_role;

COMMENT ON TABLE public.app_runtime_config IS
  'Configuração de runtime do projeto (URL base das edge functions, API key usada pelos cron jobs). Sem acesso anon/authenticated.';

INSERT INTO public.app_runtime_config (key, value) VALUES
  ('edge_base_url', NULL),
  ('edge_api_key',  NULL)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- Helper único usado por todos os agendamentos.
-- Se a configuração ainda não foi preenchida, apenas avisa e sai — melhor
-- do que disparar POST para uma URL nula a cada minuto.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.call_edge_function(
  p_function_name text,
  p_body jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base text;
  v_key  text;
BEGIN
  SELECT value INTO v_base FROM public.app_runtime_config WHERE key = 'edge_base_url';
  SELECT value INTO v_key  FROM public.app_runtime_config WHERE key = 'edge_api_key';

  IF v_base IS NULL OR btrim(v_base) = '' THEN
    RAISE WARNING 'app_runtime_config.edge_base_url não configurado — chamada a % ignorada', p_function_name;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_base, '/') || '/functions/v1/' || p_function_name,
    headers := jsonb_build_object('Content-Type', 'application/json')
               || CASE
                    WHEN v_key IS NULL OR btrim(v_key) = '' THEN '{}'::jsonb
                    ELSE jsonb_build_object('apikey', v_key)
                  END,
    body := p_body
  );
END;
$$;

REVOKE ALL ON FUNCTION public.call_edge_function(text, jsonb) FROM PUBLIC, anon, authenticated;

-- Atalho para configurar (ou reconfigurar) o projeto numa linha só.
CREATE OR REPLACE FUNCTION public.set_app_runtime_config(
  p_base_url text,
  p_api_key text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.app_runtime_config (key, value, updated_at) VALUES
    ('edge_base_url', rtrim(p_base_url, '/'), now()),
    ('edge_api_key',  p_api_key,              now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = now();
$$;

REVOKE ALL ON FUNCTION public.set_app_runtime_config(text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- iFood: mesma lógica de antes, sem a URL/chave embutidas.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_ifood_polling_all()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg record;
BEGIN
  FOR cfg IN
    SELECT restaurant_id
    FROM public.ifood_config
    WHERE enabled = true
      AND merchant_id IS NOT NULL
      AND access_token IS NOT NULL
  LOOP
    PERFORM public.call_edge_function(
      'ifood-polling',
      jsonb_build_object('restaurant_id', cfg.restaurant_id)
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_ifood_polling_all() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- Reagenda os jobs que ainda tinham URL/chave fixas no comando.
-- (ifood-polling-every-30s já chama uma função, então não muda.)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN
    SELECT jobid FROM cron.job
    WHERE jobname IN (
      'marketing-scheduler-every-min',
      'process-abandoned-carts-15m',
      'marketing-absence-scanner-10m'
    )
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'marketing-scheduler-every-min',
  '* * * * *',
  $cron$ SELECT public.call_edge_function('marketing-scheduler'); $cron$
);

SELECT cron.schedule(
  'process-abandoned-carts-15m',
  '*/15 * * * *',
  $cron$ SELECT public.call_edge_function('process-abandoned-carts'); $cron$
);

SELECT cron.schedule(
  'marketing-absence-scanner-10m',
  '*/10 * * * *',
  $cron$ SELECT public.call_edge_function('marketing-absence-scanner'); $cron$
);

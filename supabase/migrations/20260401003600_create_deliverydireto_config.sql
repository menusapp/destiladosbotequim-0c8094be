-- =====================================================================
-- Cria public.deliverydireto_config
-- ---------------------------------------------------------------------
-- Esta tabela existia no banco do Lovable mas NUNCA foi criada por uma
-- migration — foi feita à mão no painel. Resultado: replicar o histórico
-- num projeto Supabase novo quebrava aqui, porque a migration seguinte
-- (20260401003652) faz `ALTER TABLE public.deliverydireto_config ...`.
--
-- O formato abaixo veio de duas fontes que concordam entre si:
--   * src/integrations/supabase/types.ts (gerado a partir do banco real);
--   * as colunas lidas/escritas pelas edge functions dd-auth, dd-polling,
--     dd-order-action e dd-webhook.
--
-- `last_sync_at` de propósito NÃO entra aqui: quem adiciona é a migration
-- 20260401003652, preservando o histórico como estava.
--
-- Acesso: só as edge functions (service_role) usam esta tabela — ela guarda
-- tokens OAuth do Delivery Direto. RLS ligada e sem policy: nem anon nem
-- authenticated leem, mesmo via PostgREST.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.deliverydireto_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  store_id text,
  username text,
  password_hash text,
  client_id text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  webhook_url text,
  enabled boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT deliverydireto_config_restaurant_id_key UNIQUE (restaurant_id)
);

-- dd-webhook procura a config pelo store_id que vem no payload.
CREATE INDEX IF NOT EXISTS deliverydireto_config_store_id_idx
  ON public.deliverydireto_config (store_id);

ALTER TABLE public.deliverydireto_config ENABLE ROW LEVEL SECURITY;

-- O Supabase aplica DEFAULT PRIVILEGES concedendo acesso a anon/authenticated
-- em tabelas novas do schema public. Como aqui há token OAuth, revogamos.
REVOKE ALL ON public.deliverydireto_config FROM anon, authenticated;
GRANT ALL ON public.deliverydireto_config TO service_role;

COMMENT ON TABLE public.deliverydireto_config IS
  'Credenciais e tokens da integração Delivery Direto, por restaurante. Acesso só via edge functions (service_role).';

-- =====================================================================
-- CEO pode escrever em restaurant_credentials
-- ---------------------------------------------------------------------
-- A blindagem de segurança (20260722100100) deu a restaurant_credentials
-- apenas uma policy de SELECT. Só que o painel do CEO cria as credenciais
-- do restaurante com um INSERT direto (CEODashboard.tsx), e o RLS barra:
--
--   new row violates row-level security policy for table
--   "restaurant_credentials"
--
-- No projeto antigo isso passou despercebido porque o restaurante já
-- existia desde antes da blindagem — ninguém cadastrou outro depois. Numa
-- instalação nova é a primeira coisa que se faz, e ela trava ali.
--
-- Mesmo padrão já usado em `restaurants` (ceo_insert / ceo_delete): quem
-- escreve é apenas quem tem sessão de CEO válida, verificada por is_ceo()
-- contra a tabela staff_sessions.
-- =====================================================================

DROP POLICY IF EXISTS "ceo_insert" ON public.restaurant_credentials;
DROP POLICY IF EXISTS "ceo_update" ON public.restaurant_credentials;
DROP POLICY IF EXISTS "ceo_delete" ON public.restaurant_credentials;

CREATE POLICY "ceo_insert" ON public.restaurant_credentials
  FOR INSERT WITH CHECK (public.is_ceo());

CREATE POLICY "ceo_update" ON public.restaurant_credentials
  FOR UPDATE USING (public.is_ceo()) WITH CHECK (public.is_ceo());

CREATE POLICY "ceo_delete" ON public.restaurant_credentials
  FOR DELETE USING (public.is_ceo());

-- ---------------------------------------------------------------------
-- Mesmo buraco em ceo_users: só havia SELECT, mas a aba de credenciais do
-- painel (CEOCredentialsTab.tsx) cria e edita usuários CEO direto da tela —
-- inclusive para trocar a senha padrão. Sem isto, trocar a senha do CEO
-- falha com o mesmo erro de RLS.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "ceo_insert" ON public.ceo_users;
DROP POLICY IF EXISTS "ceo_update" ON public.ceo_users;
DROP POLICY IF EXISTS "ceo_delete" ON public.ceo_users;

CREATE POLICY "ceo_insert" ON public.ceo_users
  FOR INSERT WITH CHECK (public.is_ceo());

CREATE POLICY "ceo_update" ON public.ceo_users
  FOR UPDATE USING (public.is_ceo()) WITH CHECK (public.is_ceo());

CREATE POLICY "ceo_delete" ON public.ceo_users
  FOR DELETE USING (public.is_ceo());

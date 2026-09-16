-- =====================================================================
-- GRANT que faltava em restaurant_credentials e ceo_users
-- ---------------------------------------------------------------------
-- A migration 20260916140000 criou as policies de escrita, mas policy sem
-- GRANT não basta: o Postgres checa a permissão de tabela ANTES do RLS. Por
-- isso o painel do CEO passou de "violates row-level security policy" para
-- "permission denied for table restaurant_credentials".
--
-- Isto NÃO afrouxa nada: é exatamente o arranjo que `restaurants` já usa —
-- o GRANT deixa a requisição chegar ao RLS, e é o RLS que decide, exigindo
-- sessão de CEO válida (is_ceo() contra staff_sessions). Sem sessão, a
-- escrita continua barrada, agora no ponto certo.
-- =====================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_credentials TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ceo_users             TO anon, authenticated;
GRANT ALL ON public.restaurant_credentials TO service_role;
GRANT ALL ON public.ceo_users             TO service_role;

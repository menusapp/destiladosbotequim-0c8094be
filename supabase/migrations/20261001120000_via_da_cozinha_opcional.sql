-- =====================================================================
-- Via da cozinha opcional na impressão térmica (QZ Tray)
-- =====================================================================
-- A coluna `printer_settings.print_kitchen_copy` já existia (criada em
-- 20260423014511) mas NUNCA era lida pelo código: a impressão via QZ Tray
-- mandava sempre as duas vias. Agora ela passa a controlar isso de fato.
--
-- Como o DEFAULT original era `false` e o comportamento real era "sempre
-- imprimir as duas vias", honrar a coluna sem ajustar os dados faria a via da
-- cozinha desaparecer de surpresa. Esta migration alinha o banco ao
-- comportamento atual: default `true` e backfill dos registros existentes.
-- A partir daí o operador decide em Configurações → Impressoras.
-- Idempotente: pode rodar novamente sem efeito colateral.
-- =====================================================================

ALTER TABLE public.printer_settings
  ADD COLUMN IF NOT EXISTS print_kitchen_copy boolean NOT NULL DEFAULT true;

ALTER TABLE public.printer_settings
  ALTER COLUMN print_kitchen_copy SET DEFAULT true;

-- Registros criados sob o default antigo (false) passam a refletir o que o
-- sistema realmente fazia até aqui: duas vias.
UPDATE public.printer_settings
SET print_kitchen_copy = true
WHERE print_kitchen_copy IS DISTINCT FROM true;

COMMENT ON COLUMN public.printer_settings.print_kitchen_copy IS
  'Quando true, a impressão de pedido via QZ Tray emite a via do cliente E a via da cozinha. Quando false, apenas a via do cliente. Configurável em Configurações Gerais → Impressoras.';

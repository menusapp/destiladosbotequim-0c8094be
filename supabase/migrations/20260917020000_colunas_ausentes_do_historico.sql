-- =====================================================================
-- Colunas que existiam no banco do Lovable e nunca viraram migration
-- ---------------------------------------------------------------------
-- Mesmo caso da tabela deliverydireto_config: criadas à mão no painel, então
-- o histórico de migrations não as reproduz. Num projeto novo elas faltam, e
-- o sintoma é péssimo de diagnosticar — a aba Pedidos pedia `dd_source` e
-- `dd_order_id` no SELECT, o PostgREST recusava a consulta inteira por coluna
-- inexistente, e o código fazia `if (!error) setOrders(...)`: a lista ficava
-- vazia sem nenhuma mensagem. Um pedido real entrava no banco, a notificação
-- aparecia, e a tela de pedidos mostrava nada.
--
-- Levantadas comparando src/integrations/supabase/types.ts — que o Lovable
-- gerou a partir do banco real — com o schema que as migrations produzem.
-- A varredura completa apontou estas 4 e nenhuma outra.
-- =====================================================================

-- Delivery Direto: marca a origem do pedido e guarda o id externo.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS dd_source   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS dd_order_id text;

CREATE INDEX IF NOT EXISTS orders_dd_order_id_idx
  ON public.orders (dd_order_id) WHERE dd_order_id IS NOT NULL;

-- Mercado Pago Point: terminal selecionado para pagamento presencial.
ALTER TABLE public.online_payment_config
  ADD COLUMN IF NOT EXISTS mp_pos_id   text,
  ADD COLUMN IF NOT EXISTS mp_pos_name text;

COMMENT ON COLUMN public.orders.dd_source IS
  'Pedido originado no Delivery Direto.';
COMMENT ON COLUMN public.orders.dd_order_id IS
  'Identificador do pedido no Delivery Direto.';

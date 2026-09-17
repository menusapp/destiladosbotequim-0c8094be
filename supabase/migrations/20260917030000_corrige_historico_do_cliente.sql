-- =====================================================================
-- Histórico e endereços do cliente voltam a aparecer
-- ---------------------------------------------------------------------
-- get_customer_orders nunca devolvia nada. A guarda era:
--
--   AND (p_phone IS NOT NULL AND <telefone do cliente> = <p_phone>)
--
-- Com p_phone nulo a condição inteira é falsa, o NOT EXISTS dá verdadeiro e
-- a função faz RETURN vazio. E o app chama justamente com p_phone: null
-- (PedidosHistory.tsx e LoyaltyRewardNotification.tsx). Ou seja: o cliente
-- pedia, o pedido entrava, e "Meus Pedidos" ficava sempre vazio. O de
-- fidelidade também não contava pedidos anteriores, pelo mesmo motivo.
--
-- list_customer_addresses tinha a variante do mesmo erro: comparava o
-- telefone salvo com COALESCE(p_phone,''), então com p_phone nulo só
-- retornava endereços cujo telefone fosse vazio.
--
-- Correção: o telefone continua sendo conferido QUANDO é informado. Quando
-- não é, o CPF basta.
--
-- Nota de segurança, para constar: exigir o telefone como segundo fator já
-- não protegia nada aqui, porque `get_customer_by_cpf(p_cpf)` devolve o
-- telefone de qualquer CPF sem verificação alguma. Quem tivesse o CPF
-- obteria o telefone e passaria na guarda. Proteger de verdade o histórico
-- do cliente pede autenticação real (código por SMS/WhatsApp, por exemplo),
-- que é uma decisão de produto — não uma guarda que só quebra a tela.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_customer_orders(p_cpf text, p_phone text)
RETURNS SETOF public.orders
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rid uuid := public.default_restaurant_id();
BEGIN
  IF p_cpf IS NULL OR btrim(p_cpf) = '' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.restaurant_id = v_rid
      AND c.cpf = p_cpf
      AND (
        -- telefone não informado: o CPF basta
        p_phone IS NULL OR btrim(p_phone) = ''
        -- cliente sem telefone cadastrado: não há o que conferir
        OR regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') = ''
        -- informado e cadastrado: tem de bater
        OR regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g')
             = regexp_replace(p_phone, '\D', '', 'g')
      )
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT * FROM public.orders o
    WHERE o.restaurant_id = v_rid
      AND o.customer_cpf = p_cpf
    ORDER BY o.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_customer_addresses(p_cpf text, p_phone text)
RETURNS SETOF public.customer_addresses
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.customer_addresses ca
  WHERE ca.restaurant_id = public.default_restaurant_id()
    AND ca.customer_cpf = p_cpf
    AND (
      p_phone IS NULL OR btrim(p_phone) = ''
      OR regexp_replace(COALESCE(ca.customer_phone, ''), '\D', '', 'g') = ''
      OR regexp_replace(COALESCE(ca.customer_phone, ''), '\D', '', 'g')
           = regexp_replace(p_phone, '\D', '', 'g')
    )
  ORDER BY ca.is_default DESC, ca.created_at DESC
$$;

-- Mantém as permissões que a blindagem havia definido para estas RPCs.
REVOKE ALL ON FUNCTION public.get_customer_orders(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_customer_addresses(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_orders(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_customer_addresses(text, text) TO anon, authenticated;

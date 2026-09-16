-- =====================================================================
-- Simulação de carga — mede quanto um pedido real custa em banco.
--
-- Cria um restaurante de teste (slug zz-simulacao-carga) e roda N pedidos
-- completos pelo mesmo caminho do app: itens, complementos, baixa de
-- estoque, lançamento no caixa, numeração diária, ocupação de mesa e o
-- ciclo de status até entregue/pago. Tudo por trigger, como em produção.
--
-- Não toca em nenhum dado real: só no restaurante de teste, que o
-- --limpar remove por completo.
--
-- Uso: via scripts/simular-carga.sh (ele mede antes e depois).
-- =====================================================================

SET client_min_messages TO WARNING;

DO $sim$
DECLARE
  v_n            int := current_setting('sim.pedidos')::int;
  v_rest         uuid;
  v_cat          uuid;
  v_stock_cat    uuid;
  v_prod         uuid[] := '{}';
  v_stock        uuid[] := '{}';
  v_table        uuid[] := '{}';
  v_extra        uuid;
  v_session      uuid;
  v_order        uuid;
  v_item         uuid;
  v_id           uuid;
  i              int;
  j              int;
  v_itens        int;
  v_tipo         text;
BEGIN
  -- ── restaurante de teste ────────────────────────────────────────────
  SELECT id INTO v_rest FROM public.restaurants WHERE slug = 'zz-simulacao-carga';
  IF v_rest IS NULL THEN
    INSERT INTO public.restaurants (name, slug)
    VALUES ('ZZ Simulação de Carga', 'zz-simulacao-carga')
    RETURNING id INTO v_rest;
  END IF;

  -- ── cardápio mínimo ─────────────────────────────────────────────────
  SELECT id INTO v_cat FROM public.categories WHERE restaurant_id = v_rest LIMIT 1;
  IF v_cat IS NULL THEN
    INSERT INTO public.categories (restaurant_id, name) VALUES (v_rest, 'Simulação')
    RETURNING id INTO v_cat;
  END IF;

  SELECT id INTO v_stock_cat FROM public.stock_categories WHERE restaurant_id = v_rest LIMIT 1;
  IF v_stock_cat IS NULL THEN
    INSERT INTO public.stock_categories (restaurant_id, name) VALUES (v_rest, 'Insumos')
    RETURNING id INTO v_stock_cat;
  END IF;

  -- insumos (para a baixa de estoque disparar de verdade)
  FOR i IN 1..3 LOOP
    SELECT id INTO v_id FROM public.stock_items
      WHERE restaurant_id = v_rest AND name = 'Insumo ' || i;
    IF v_id IS NULL THEN
      INSERT INTO public.stock_items (restaurant_id, name, unit, category_id, current_quantity)
      VALUES (v_rest, 'Insumo ' || i, 'un', v_stock_cat, 100000) RETURNING id INTO v_id;
    END IF;
    v_stock := v_stock || v_id;
  END LOOP;

  -- produtos, cada um consumindo um insumo
  FOR i IN 1..5 LOOP
    SELECT id INTO v_id FROM public.products
      WHERE restaurant_id = v_rest AND name = 'Produto ' || i;
    IF v_id IS NULL THEN
      INSERT INTO public.products (restaurant_id, category_id, name, price, description)
      VALUES (v_rest, v_cat, 'Produto ' || i, 20 + i * 5,
              'Item de simulação com descrição de tamanho parecido com o de um cardápio real')
      RETURNING id INTO v_id;
      INSERT INTO public.product_ingredients (product_id, stock_item_id, quantity)
      VALUES (v_id, v_stock[1 + (i % 3)], 1);
    END IF;
    v_prod := v_prod || v_id;
  END LOOP;

  -- um complemento pago
  SELECT id INTO v_extra FROM public.product_extras WHERE product_id = v_prod[1] LIMIT 1;
  IF v_extra IS NULL THEN
    INSERT INTO public.product_extras (product_id, name, price)
    VALUES (v_prod[1], 'Adicional simulado', 4.50) RETURNING id INTO v_extra;
  END IF;

  -- mesas
  FOR i IN 1..10 LOOP
    SELECT id INTO v_id FROM public.tables WHERE restaurant_id = v_rest AND table_number = i;
    IF v_id IS NULL THEN
      INSERT INTO public.tables (restaurant_id, table_number) VALUES (v_rest, i) RETURNING id INTO v_id;
    END IF;
    v_table := v_table || v_id;
  END LOOP;

  -- caixa aberto (senão o lançamento financeiro não acontece)
  SELECT id INTO v_session FROM public.cash_register_sessions
    WHERE restaurant_id = v_rest AND status = 'open' LIMIT 1;
  IF v_session IS NULL THEN
    INSERT INTO public.cash_register_sessions (restaurant_id, opened_by, status)
    VALUES (v_rest, 'simulacao', 'open') RETURNING id INTO v_session;
  END IF;

  -- ── os pedidos ──────────────────────────────────────────────────────
  FOR i IN 1..v_n LOOP
    -- 60% mesa, 40% delivery — proporção típica de um bar/restaurante
    v_tipo := CASE WHEN i % 5 < 3 THEN 'local' ELSE 'delivery' END;

    INSERT INTO public.orders (
      restaurant_id, customer_name, customer_cpf, status, order_type,
      table_id, delivery_address, delivery_phone, delivery_neighborhood,
      delivery_city, delivery_fee, notes, payment_type, payment_status,
      order_channel, pdv_source
    ) VALUES (
      v_rest,
      'Cliente Simulado ' || i,
      lpad((i * 37 % 100000000000)::text, 11, '0'),
      'pending',
      v_tipo,
      CASE WHEN v_tipo = 'local' THEN v_table[1 + (i % 10)] END,
      CASE WHEN v_tipo = 'delivery' THEN 'Rua da Simulação, ' || i || ' - apto ' || i END,
      CASE WHEN v_tipo = 'delivery' THEN '119' || lpad((i * 13 % 100000000)::text, 8, '0') END,
      CASE WHEN v_tipo = 'delivery' THEN 'Centro' END,
      CASE WHEN v_tipo = 'delivery' THEN 'São Paulo' END,
      CASE WHEN v_tipo = 'delivery' THEN 8.00 ELSE 0 END,
      'Observação do cliente, sem cebola por favor',
      'pending', 'pending',
      CASE WHEN v_tipo = 'delivery' THEN 'delivery' ELSE 'mesa' END,
      v_tipo = 'local'
    ) RETURNING id INTO v_order;

    -- 2 a 4 itens por pedido
    v_itens := 2 + (i % 3);
    FOR j IN 1..v_itens LOOP
      INSERT INTO public.order_items (order_id, product_id, quantity, price_at_order, notes)
      VALUES (v_order, v_prod[1 + ((i + j) % 5)], 1 + (j % 2), 25.00, 'sem pimenta')
      RETURNING id INTO v_item;

      -- um complemento no primeiro item
      IF j = 1 THEN
        INSERT INTO public.order_item_extras (order_item_id, product_extra_id, price_at_order, extra_name)
        VALUES (v_item, v_extra, 4.50, 'Adicional simulado');
      END IF;
    END LOOP;

    -- ciclo de vida do pedido (cada UPDATE é uma troca de status real)
    UPDATE public.orders SET status = 'preparing' WHERE id = v_order;
    UPDATE public.orders SET status = 'ready'     WHERE id = v_order;
    UPDATE public.orders
       SET status = CASE WHEN v_tipo = 'delivery' THEN 'delivered' ELSE 'picked_up' END,
           payment_type = CASE WHEN i % 3 = 0 THEN 'pix' WHEN i % 3 = 1 THEN 'credit' ELSE 'cash' END,
           payment_status = 'paid',
           paid_at = now()
     WHERE id = v_order;
  END LOOP;

  RAISE NOTICE 'Simulados % pedidos no restaurante %', v_n, v_rest;
END
$sim$;

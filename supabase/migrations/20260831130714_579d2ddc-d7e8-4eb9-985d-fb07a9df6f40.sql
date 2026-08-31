-- card_fees
DROP POLICY IF EXISTS "Allow all operations on card fees" ON public.card_fees;
CREATE POLICY staff_all ON public.card_fees FOR ALL TO public
  USING (restaurant_id = public.current_restaurant_id())
  WITH CHECK (restaurant_id = public.current_restaurant_id());

-- card_fees_config
DROP POLICY IF EXISTS "Allow all operations on card fees config" ON public.card_fees_config;
CREATE POLICY staff_all ON public.card_fees_config FOR ALL TO public
  USING (restaurant_id = public.current_restaurant_id())
  WITH CHECK (restaurant_id = public.current_restaurant_id());

-- operational_costs
DROP POLICY IF EXISTS "Allow all operations on operational costs" ON public.operational_costs;
CREATE POLICY staff_all ON public.operational_costs FOR ALL TO public
  USING (restaurant_id = public.current_restaurant_id())
  WITH CHECK (restaurant_id = public.current_restaurant_id());

-- remarketing_lists
DROP POLICY IF EXISTS "Allow all operations on remarketing_lists" ON public.remarketing_lists;
CREATE POLICY staff_all ON public.remarketing_lists FOR ALL TO public
  USING (restaurant_id = public.current_restaurant_id())
  WITH CHECK (restaurant_id = public.current_restaurant_id());

-- order_item_splits
DROP POLICY IF EXISTS "Allow all operations on order_item_splits" ON public.order_item_splits;
CREATE POLICY staff_all ON public.order_item_splits FOR ALL TO public
  USING (restaurant_id = public.current_restaurant_id())
  WITH CHECK (restaurant_id = public.current_restaurant_id());

-- counter_order_item_extras
DROP POLICY IF EXISTS "Allow all operations on counter order item extras" ON public.counter_order_item_extras;
CREATE POLICY staff_all ON public.counter_order_item_extras FOR ALL TO public
  USING (EXISTS (
    SELECT 1 FROM public.counter_order_items coi
    JOIN public.counter_orders co ON co.id = coi.counter_order_id
    WHERE coi.id = counter_order_item_extras.counter_order_item_id
      AND co.restaurant_id = public.current_restaurant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.counter_order_items coi
    JOIN public.counter_orders co ON co.id = coi.counter_order_id
    WHERE coi.id = counter_order_item_extras.counter_order_item_id
      AND co.restaurant_id = public.current_restaurant_id()
  ));
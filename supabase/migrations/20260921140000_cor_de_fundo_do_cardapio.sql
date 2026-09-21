-- =====================================================================
-- Cor de fundo do cardápio, configurável pelo painel
-- ---------------------------------------------------------------------
-- O cardápio só permitia escolher a cor principal (detalhes, botões,
-- preços); o fundo era branco fixo. Agora é configurável em
-- Configurações → Logo & Cor Principal.
--
-- Coluna nova em vez de reaproveitar `secondary_color`: aquela existe no
-- banco, não é usada em lugar nenhum do código e o nome não diz o que faz.
-- Um nome explícito evita que a próxima pessoa tenha de adivinhar.
--
-- Também troca o laranja padrão (#FF6B35, herdado do SaaS) pelo verde da
-- marca, e aplica ao estabelecimento já cadastrado.
-- =====================================================================

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS menu_background_color text DEFAULT '#ffffff';

COMMENT ON COLUMN public.restaurants.menu_background_color IS
  'Cor de fundo do cardápio digital (hex). Padrão branco.';

-- Novo padrão para quem for cadastrado daqui em diante.
ALTER TABLE public.restaurants
  ALTER COLUMN primary_color SET DEFAULT '#184a2d';

-- Estabelecimento atual: sai do laranja herdado.
UPDATE public.restaurants
   SET primary_color = '#184a2d'
 WHERE slug = 'destilado-botequim'
   AND (primary_color IS NULL OR lower(primary_color) IN ('#ff6b35', '#fe9516'));

UPDATE public.restaurants
   SET menu_background_color = '#ffffff'
 WHERE menu_background_color IS NULL;

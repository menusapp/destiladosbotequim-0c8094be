import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Trash2, Package, DollarSign, Image, Clock, Tag, Barcode, Settings2, Layers, Copy, Pencil, ArrowUp, ArrowDown, AlertCircle, Camera } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { generateNextPdvCode, getAllUsedPdvCodes } from "@/lib/pdvCodeGenerator";
import { useDebounce } from "@/hooks/useDebounce";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import ProductCard from "./ProductCard";
import BulkDeleteProductsDialog from "./BulkDeleteProductsDialog";
import { normalizeSearch } from "@/lib/searchNormalize";

import { novoId } from "@/lib/uuid";
interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  promotional_price?: number | null;
  category_id: string | null;
  available: boolean;
  image_url: string | null;
  cost?: number;
  margin?: number;
  prep_time?: number;
  sku?: string;
  variableCosts?: VariableCostInfo[];
  extraPdvCodes?: string[];
}

interface VariableCostInfo {
  name: string;
  price: number;
  cost: number;
  margin: number;
}

interface Category {
  id: string;
  name: string;
}

interface StockItem {
  id: string;
  name: string;
  unit: string;
  price_per_unit: number;
}

interface ProductIngredient {
  id: string;
  stock_item_id: string;
  quantity: number;
  stock_item_name?: string;
  stock_item_unit?: string;
  stock_item_price?: number;
}

interface ProductExtra {
  id: string;
  name: string;
  description?: string;
  price: number;
  ingredients?: ProductIngredient[];
  is_required?: boolean;
  min_selection?: number;
  max_selection?: number | null;
}

interface ComplementCategory {
  id: string;
  name: string;
}

interface LinkedComplementGroup {
  id: string;
  extra_category_id: string;
  category_name: string;
  is_required: boolean;
  min_selection: number;
  max_selection: number | null;
  display_order: number;
  items: {
    id: string;
    name: string;
    price: number;
  }[];
}

interface IngredientVariation {
  id: string;
  name: string;
  description?: string;
  price: number;
  pdv_code?: string;
  ingredients: ProductIngredient[];
}

interface ProductsGridProps {
  restaurantId: string;
  isRestaurantOpen: boolean;
  onOpenDigitizer?: () => void;
  onOpenIfoodImport?: () => void;
  ifoodConnected?: boolean;
}

const ProductsGrid = ({ restaurantId, isRestaurantOpen, onOpenDigitizer, onOpenIfoodImport, ifoodConnected }: ProductsGridProps) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [visibilityChannels, setVisibilityChannels] = useState<string[]>(["all"]);
  const [kioskEnabled, setKioskEnabled] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Form states
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productPromotionalPrice, setProductPromotionalPrice] = useState("");
  const [productCategoryId, setProductCategoryId] = useState("");
  const [productImage, setProductImage] = useState<File | null>(null);
  const [productImageUrl, setProductImageUrl] = useState<string | null>(null);
  const [productPrepTime, setProductPrepTime] = useState("");
  const [pdvCode, setPdvCode] = useState("");
  
  const [ingredientType, setIngredientType] = useState<"fixed" | "variable">("fixed");
  
  const [ingredients, setIngredients] = useState<ProductIngredient[]>([]);
  const [selectedStockItem, setSelectedStockItem] = useState("");
  const [ingredientQuantity, setIngredientQuantity] = useState("");
  
  const [variations, setVariations] = useState<IngredientVariation[]>([]);
  const [variationName, setVariationName] = useState("");
  const [variationDescription, setVariationDescription] = useState("");
  const [variationPrice, setVariationPrice] = useState("");
  const [variationIngredients, setVariationIngredients] = useState<ProductIngredient[]>([]);
  const [selectedVariationStockItem, setSelectedVariationStockItem] = useState("");
  const [variationIngredientQuantity, setVariationIngredientQuantity] = useState("");
  const [variationIsRequired, setVariationIsRequired] = useState(true);
  const [variationMinSelection, setVariationMinSelection] = useState("1");
  const [variationMaxSelection, setVariationMaxSelection] = useState("1");
  
  const [extras, setExtras] = useState<ProductExtra[]>([]);
  const [extraName, setExtraName] = useState("");
  const [extraDescription, setExtraDescription] = useState("");
  const [extraPrice, setExtraPrice] = useState("");
  const [extraIngredients, setExtraIngredients] = useState<ProductIngredient[]>([]);
  const [selectedExtraStockItem, setSelectedExtraStockItem] = useState("");
  const [extraIngredientQuantity, setExtraIngredientQuantity] = useState("");
  const [extraIsRequired, setExtraIsRequired] = useState(false);
  
  const [complementCategories, setComplementCategories] = useState<ComplementCategory[]>([]);
  const [linkedGroups, setLinkedGroups] = useState<LinkedComplementGroup[]>([]);
  const [selectedComplementCategory, setSelectedComplementCategory] = useState("");
  const [groupIsRequired, setGroupIsRequired] = useState(false);
  const [groupMinSelection, setGroupMinSelection] = useState("0");
  const [groupMaxSelection, setGroupMaxSelection] = useState("");

  // Fiscal fields
  const [fiscalNcm, setFiscalNcm] = useState("");
  const [fiscalException, setFiscalException] = useState("");
  const [fiscalCest, setFiscalCest] = useState("");
  const [fiscalCfop, setFiscalCfop] = useState("");
  const [fiscalIcmsCsosn, setFiscalIcmsCsosn] = useState("");
  const [fiscalIcmsOrigin, setFiscalIcmsOrigin] = useState("0");
  const [fiscalPisCst, setFiscalPisCst] = useState("");
  const [fiscalPisAliquota, setFiscalPisAliquota] = useState("");
  const [fiscalCofinsCst, setFiscalCofinsCst] = useState("");
  const [fiscalCofinsAliquota, setFiscalCofinsAliquota] = useState("");
  const [fiscalIbsAliquota, setFiscalIbsAliquota] = useState("");
  const [fiscalCbsAliquota, setFiscalCbsAliquota] = useState("");
  const [fiscalBeneficioCode, setFiscalBeneficioCode] = useState("");
  const [fiscalIndiceProducao, setFiscalIndiceProducao] = useState("");
  const [fiscalAliquotaTransparencia, setFiscalAliquotaTransparencia] = useState("");
  const [fiscalAiLoading, setFiscalAiLoading] = useState(false);

  const handleFiscalAiSuggest = async () => {
    if (!productName) { toast.error("Informe o nome do produto primeiro"); return; }
    setFiscalAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fiscal-ai-suggest", {
        body: { product_name: productName, product_description: productDescription, restaurant_id: restaurantId },
      });
      if (error) throw error;
      if (data?.error) { toast.error(data.error); return; }
      const s = data.suggestion;
      if (s) {
        setFiscalNcm(s.ncm || "");
        setFiscalCest(s.cest || "");
        setFiscalCfop(s.cfop || "");
        setFiscalIcmsCsosn(s.csosn || "");
        setFiscalIcmsOrigin(s.origin || "0");
        setFiscalPisCst(s.pis_cst || "");
        setFiscalPisAliquota(s.pis_aliquota || "");
        setFiscalCofinsCst(s.cofins_cst || "");
        setFiscalCofinsAliquota(s.cofins_aliquota || "");
        setFiscalIbsAliquota(s.ibs_aliquota || "");
        setFiscalCbsAliquota(s.cbs_aliquota || "");
        toast.success("Tributação sugerida pela IA! Revise antes de salvar.", { description: s.explanation });
      }
    } catch (e: any) {
      console.error("Fiscal AI error:", e);
      toast.error("Erro ao consultar IA fiscal");
    } finally {
      setFiscalAiLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
    fetchProducts();
    fetchStockItems();
    fetchComplementCategories();
    // Check if kiosk module is enabled
    supabase.from("kiosk_config").select("enabled").eq("restaurant_id", restaurantId).maybeSingle()
      .then(({ data }) => setKioskEnabled(data?.enabled || false));

    let debounceTimer: ReturnType<typeof setTimeout>;
    const channel = supabase
      .channel(`products-grid-${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `restaurant_id=eq.${restaurantId}` }, () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(fetchProducts, 500);
      })
      .subscribe();

    return () => { clearTimeout(debounceTimer); supabase.removeChannel(channel); };
  }, [restaurantId]);

  const fetchStockItems = async () => {
    const { data } = await supabase.from("stock_items").select("id, name, unit, price_per_unit").eq("restaurant_id", restaurantId).order("name");
    setStockItems((data || []).sort((a, b) => (a.name || "").localeCompare(b.name || "", "pt-BR")));
  };

  const fetchComplementCategories = async () => {
    const { data } = await supabase.from("extra_categories").select("id, name").eq("restaurant_id", restaurantId).order("name");
    setComplementCategories(data || []);
  };

  const fetchCategories = async () => {
    const { data } = await supabase.from("categories").select("*").eq("restaurant_id", restaurantId);
    setCategories(data || []);
  };

  const fetchProducts = async () => {
    const { data } = await supabase.from("products").select("*").eq("restaurant_id", restaurantId);
    if (!data || data.length === 0) { setProducts([]); return; }
    if (!data || data.length === 0) { setProducts([]); return; }

    const productIds = data.map(p => p.id);

    // Batch: fetch ALL ingredients and extras in 2 queries instead of N*2
    const [{ data: allIngredients }, { data: allExtras }] = await Promise.all([
      supabase.from("product_ingredients").select("product_id, quantity, stock_items(price_per_unit)").in("product_id", productIds),
      supabase.from("product_extras").select("id, product_id, name, price, is_required, pdv_code, product_extra_ingredients(quantity, stock_items(price_per_unit))").in("product_id", productIds),
    ]);

    // Group by product_id client-side
    const ingredientsByProduct = new Map<string, any[]>();
    (allIngredients || []).forEach(ing => {
      const list = ingredientsByProduct.get(ing.product_id) || [];
      list.push(ing);
      ingredientsByProduct.set(ing.product_id, list);
    });

    const extrasByProduct = new Map<string, any[]>();
    (allExtras || []).forEach(ext => {
      const list = extrasByProduct.get(ext.product_id) || [];
      list.push(ext);
      extrasByProduct.set(ext.product_id, list);
    });

    const productsWithMetrics = data.map((product) => {
      const productIngredients = ingredientsByProduct.get(product.id) || [];
      const fixedCost = productIngredients.reduce((sum: number, ing: any) => sum + (ing.quantity * (ing.stock_items?.price_per_unit || 0)), 0);

      const productExtras = extrasByProduct.get(product.id) || [];
      const variableCosts: VariableCostInfo[] = productExtras
        .filter((e: any) => e.is_required)
        .map((extra: any) => {
          const extraCost = extra.product_extra_ingredients?.reduce((sum: number, ing: any) => sum + (ing.quantity * (ing.stock_items?.price_per_unit || 0)), 0) || 0;
          const effectiveBasePrice = product.promotional_price || product.price;
          const totalPrice = effectiveBasePrice + extra.price;
          const margin = totalPrice > 0 ? ((totalPrice - extraCost) / totalPrice) * 100 : 0;
          return { name: extra.name, price: extra.price, cost: extraCost, margin };
        });

      const cost = fixedCost;
      const effectivePrice = product.promotional_price || product.price;
      const margin = effectivePrice > 0 ? ((effectivePrice - cost) / effectivePrice) * 100 : 0;

      const extraPdvCodes = productExtras.map((e: any) => e.pdv_code).filter(Boolean) as string[];

      return {
        ...product,
        promotional_price: product.promotional_price,
        cost, margin,
        prep_time: product.prep_time_minutes || 30,
        sku: product.name.substring(0, 3).toUpperCase() + String(product.id).substring(0, 4).toUpperCase(),
        variableCosts: variableCosts.length > 0 ? variableCosts : undefined,
        extraPdvCodes,
      };
    });
    setProducts(productsWithMetrics);
  };

  const handleToggleAvailable = async (id: string, available: boolean) => {
    const { error } = await supabase.from("products").update({ available }).eq("id", id);
    if (error) { toast.error("Erro ao atualizar disponibilidade"); return; }
    toast.success(`Produto ${available ? "disponibilizado" : "indisponibilizado"}`);
    fetchProducts();
  };

  const handleDuplicateProduct = async (product: Product) => {
    if (isRestaurantOpen) { toast.error("Feche o restaurante para duplicar produtos"); return; }
    setProductName(`${product.name} (cópia)`);
    setProductDescription(product.description || "");
    setProductPrice(product.price.toString());
    setProductPromotionalPrice(product.promotional_price?.toString() || "");
    setProductCategoryId(product.category_id || "__none");
    setProductImageUrl(product.image_url);
    setProductPrepTime(product.prep_time?.toString() || "");
    setPdvCode("");

    const { data: ingredientsData } = await supabase.from("product_ingredients").select("*, stock_items(name, unit, price_per_unit)").eq("product_id", product.id);
    const formattedIngredients = ingredientsData?.map((ing: any) => ({
      id: novoId(), stock_item_id: ing.stock_item_id, quantity: ing.quantity,
      stock_item_name: ing.stock_items?.name, stock_item_unit: ing.stock_items?.unit, stock_item_price: ing.stock_items?.price_per_unit
    })) || [];

    const { data: extrasData } = await supabase.from("product_extras").select("*, product_extra_ingredients(*, stock_items(name, unit, price_per_unit))").eq("product_id", product.id);
    const variationsFromDB: IngredientVariation[] = [];
    const extrasFromDB: ProductExtra[] = [];

    extrasData?.forEach((extra: any) => {
      const ings = extra.product_extra_ingredients?.map((ing: any) => ({
        id: novoId(), stock_item_id: ing.stock_item_id, quantity: ing.quantity,
        stock_item_name: ing.stock_items?.name, stock_item_unit: ing.stock_items?.unit, stock_item_price: ing.stock_items?.price_per_unit
      })) || [];
      if (extra.is_required) {
        variationsFromDB.push({ id: novoId(), name: extra.name, description: extra.description || undefined, price: extra.price, pdv_code: extra.pdv_code || undefined, ingredients: ings });
        if (variationsFromDB.length === 1) { setVariationMinSelection(extra.min_selection?.toString() || "1"); setVariationMaxSelection(extra.max_selection?.toString() || "1"); setVariationIsRequired(true); }
      } else {
        extrasFromDB.push({ id: novoId(), name: extra.name, description: extra.description || undefined, price: extra.price, ingredients: ings, is_required: extra.is_required });
      }
    });

    if (variationsFromDB.length > 0) { setIngredientType("variable"); setVariations(variationsFromDB); setIngredients([]); }
    else { setIngredientType("fixed"); setIngredients(formattedIngredients); setVariations([]); }
    setExtras(extrasFromDB);

    const { data: groupsData } = await supabase.from("product_complement_groups").select("*, extra_categories(id, name, extra_category_items(id, name, price))").eq("product_id", product.id).order("display_order");
    const formattedGroups: LinkedComplementGroup[] = (groupsData || []).map((g: any, idx: number) => ({
      id: novoId(), extra_category_id: g.extra_category_id, category_name: g.extra_categories?.name || "",
      is_required: g.is_required || false, min_selection: g.min_selection || 0, max_selection: g.max_selection,
      display_order: g.display_order ?? idx,
      items: g.extra_categories?.extra_category_items || []
    }));
    setLinkedGroups(formattedGroups);
    setEditingProduct(null);
    setDialogOpen(true);
    toast.info("Produto duplicado! Altere o que precisar e salve.");
  };

  const handleDeleteProduct = async (productId: string) => {
    if (isRestaurantOpen) { toast.error("Feche o restaurante para excluir produtos"); return; }
    try {
      const { error } = await supabase.rpc('admin_delete_product', { p_product_id: productId, p_restaurant_id: restaurantId });
      if (error) throw error;
      toast.success("Produto excluído com sucesso!");
      fetchProducts();
    } catch (error) { console.error("Erro ao excluir produto:", error); toast.error("Erro ao excluir produto"); }
  };

  const handleAddIngredient = () => {
    if (!selectedStockItem || !ingredientQuantity) return;
    const stockItem = stockItems.find(s => s.id === selectedStockItem);
    if (!stockItem) return;
    setIngredients([...ingredients, { id: novoId(), stock_item_id: selectedStockItem, quantity: parseFloat(ingredientQuantity), stock_item_name: stockItem.name, stock_item_unit: stockItem.unit, stock_item_price: stockItem.price_per_unit }]);
    setSelectedStockItem(""); setIngredientQuantity("");
  };

  const handleRemoveIngredient = (id: string) => { setIngredients(ingredients.filter(i => i.id !== id)); };

  const handleAddVariationIngredient = () => {
    if (!selectedVariationStockItem || !variationIngredientQuantity) return;
    const stockItem = stockItems.find(s => s.id === selectedVariationStockItem);
    if (!stockItem) return;
    setVariationIngredients([...variationIngredients, { id: novoId(), stock_item_id: selectedVariationStockItem, quantity: parseFloat(variationIngredientQuantity), stock_item_name: stockItem.name, stock_item_unit: stockItem.unit, stock_item_price: stockItem.price_per_unit }]);
    setSelectedVariationStockItem(""); setVariationIngredientQuantity("");
  };

  const handleRemoveVariationIngredient = (id: string) => { setVariationIngredients(variationIngredients.filter(i => i.id !== id)); };

  const handleAddVariation = async () => {
    if (!variationName) { toast.error("Informe o nome da variação"); return; }
    const localCodes = variations.map(v => v.pdv_code).filter(Boolean) as string[];
    const newPdvCode = await generateNextPdvCode(restaurantId, localCodes);
    setVariations([...variations, { id: novoId(), name: variationName, description: variationDescription || undefined, price: parseFloat(variationPrice) || 0, pdv_code: newPdvCode, ingredients: [...variationIngredients] }]);
    setVariationName(""); setVariationDescription(""); setVariationPrice(""); setVariationIngredients([]);
  };

  const handleRemoveVariation = (id: string) => { setVariations(variations.filter(v => v.id !== id)); };

  const handleDuplicateVariation = async (id: string) => {
    const original = variations.find(v => v.id === id);
    if (!original) return;
    const localCodes = variations.map(v => v.pdv_code).filter(Boolean) as string[];
    const newPdvCode = await generateNextPdvCode(restaurantId, localCodes);
    const copy = { ...original, id: novoId(), name: `${original.name} (cópia)`, pdv_code: newPdvCode, ingredients: original.ingredients.map(i => ({ ...i, id: novoId() })) };
    setVariations([...variations, copy]);
    toast.success("Variação duplicada");
  };

  const handleEditVariation = (id: string) => {
    const v = variations.find(v => v.id === id);
    if (!v) return;
    setVariationName(v.name);
    setVariationDescription(v.description || "");
    setVariationPrice(v.price > 0 ? String(v.price) : "");
    setVariationIngredients(v.ingredients.map(i => ({ ...i })));
    setVariations(variations.filter(vr => vr.id !== id));
  };

  const handleAddExtra = () => {
    if (!extraName || !extraPrice) { toast.error("Preencha nome e preço do complemento"); return; }
    if (extras.some(e => e.name.toLowerCase() === extraName.toLowerCase())) { toast.error("Já existe um complemento com este nome"); return; }
    setExtras([...extras, { id: novoId(), name: extraName, description: extraDescription || undefined, price: parseFloat(extraPrice), ingredients: [...extraIngredients], is_required: extraIsRequired }]);
    setExtraName(""); setExtraDescription(""); setExtraPrice(""); setExtraIngredients([]); setExtraIsRequired(false);
  };

  const handleLinkComplementCategory = async () => {
    if (!selectedComplementCategory) { toast.error("Selecione uma categoria de complementos"); return; }
    if (linkedGroups.some(g => g.extra_category_id === selectedComplementCategory)) { toast.error("Esta categoria já está vinculada"); return; }
    const category = complementCategories.find(c => c.id === selectedComplementCategory);
    if (!category) return;
    const { data: itemsData, error } = await supabase.from("extra_category_items").select("id, name, price").eq("category_id", selectedComplementCategory);
    if (error) { toast.error("Erro ao buscar itens da categoria"); return; }
    setLinkedGroups([...linkedGroups, {
      id: novoId(), extra_category_id: selectedComplementCategory, category_name: category.name,
      is_required: groupIsRequired, min_selection: parseInt(groupMinSelection) || 0, max_selection: groupMaxSelection ? parseInt(groupMaxSelection) : null,
      display_order: linkedGroups.length,
      items: itemsData || [],
    }]);
    setSelectedComplementCategory(""); setGroupIsRequired(false); setGroupMinSelection("0"); setGroupMaxSelection("");
  };

  const handleMoveLinkedGroup = (index: number, direction: 'up' | 'down') => {
    const newGroups = [...linkedGroups];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newGroups.length) return;
    [newGroups[index], newGroups[targetIndex]] = [newGroups[targetIndex], newGroups[index]];
    setLinkedGroups(newGroups.map((g, i) => ({ ...g, display_order: i })));
  };

  const handleRemoveLinkedGroup = (id: string) => { setLinkedGroups(linkedGroups.filter(g => g.id !== id)); };
  const handleRemoveExtra = (id: string) => { setExtras(extras.filter(e => e.id !== id)); };

  const handleAddExtraIngredient = () => {
    if (!selectedExtraStockItem || !extraIngredientQuantity) return;
    const stockItem = stockItems.find(s => s.id === selectedExtraStockItem);
    if (!stockItem) return;
    setExtraIngredients([...extraIngredients, { id: novoId(), stock_item_id: selectedExtraStockItem, quantity: parseFloat(extraIngredientQuantity), stock_item_name: stockItem.name, stock_item_unit: stockItem.unit, stock_item_price: stockItem.price_per_unit }]);
    setSelectedExtraStockItem(""); setExtraIngredientQuantity("");
  };

  const handleRemoveExtraIngredient = (id: string) => { setExtraIngredients(extraIngredients.filter(i => i.id !== id)); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRestaurantOpen) { toast.error("Feche o restaurante para modificar produtos"); return; }
    // category is now optional

    let imageUrl = productImageUrl;
    if (productImage) {
      const fileExt = productImage.name.split('.').pop();
      const fileName = `${novoId()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('product-images').upload(fileName, productImage);
      if (uploadError) { toast.error("Erro ao fazer upload da imagem"); return; }
      const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(fileName);
      imageUrl = publicUrl;
    }

    // Auto-generate PDV code for new products if not manually set
    let finalPdvCode = pdvCode || null;
    if (!editingProduct && !pdvCode) {
      finalPdvCode = await generateNextPdvCode(restaurantId);
    }

    // Validate PDV code uniqueness — só consulta quando código mudou (evita query pesada desnecessária)
    if (finalPdvCode && (!editingProduct || (editingProduct as any).pdv_code !== finalPdvCode)) {
      const usedCodes = await getAllUsedPdvCodes(restaurantId);
      const codeNum = parseInt(finalPdvCode, 10);
      if (!isNaN(codeNum) && usedCodes.has(codeNum)) {
        toast.error(`Código PDV '${finalPdvCode}' já está em uso por outro item`);
        return;
      }
    }

    if (visibilityChannels.length === 0) {
      toast.error("Selecione pelo menos um canal de visibilidade");
      return;
    }

    const productData: any = {
      name: productName, description: productDescription, price: parseFloat(productPrice),
      promotional_price: productPromotionalPrice ? parseFloat(productPromotionalPrice) : null,
      category_id: (productCategoryId && productCategoryId !== "__none") ? productCategoryId : null, image_url: imageUrl, restaurant_id: restaurantId,
      prep_time_minutes: productPrepTime ? parseInt(productPrepTime) : null,
      pdv_code: finalPdvCode,
      visibility_channels: visibilityChannels,
      fiscal_ncm: fiscalNcm || null, fiscal_exception: fiscalException || null, fiscal_cest: fiscalCest || null,
      fiscal_cfop: fiscalCfop || null, fiscal_icms_csosn: fiscalIcmsCsosn || null, fiscal_icms_origin: fiscalIcmsOrigin || "0",
      fiscal_pis_cst: fiscalPisCst || null, fiscal_pis_aliquota: fiscalPisAliquota ? parseFloat(fiscalPisAliquota) : null,
      fiscal_cofins_cst: fiscalCofinsCst || null, fiscal_cofins_aliquota: fiscalCofinsAliquota ? parseFloat(fiscalCofinsAliquota) : null,
      fiscal_ibs_aliquota: fiscalIbsAliquota ? parseFloat(fiscalIbsAliquota) : null,
      fiscal_cbs_aliquota: fiscalCbsAliquota ? parseFloat(fiscalCbsAliquota) : null,
      fiscal_beneficio_code: fiscalBeneficioCode || null,
      fiscal_indice_producao: fiscalIndiceProducao ? parseFloat(fiscalIndiceProducao) : null,
      fiscal_aliquota_transparencia: fiscalAliquotaTransparencia ? parseFloat(fiscalAliquotaTransparencia) : null,
    };

    let productId: string;
    if (editingProduct) {
      const { error } = await supabase.from("products").update(productData).eq("id", editingProduct.id);
      if (error) { toast.error("Erro ao atualizar produto"); return; }
      productId = editingProduct.id;
    } else {
      const { data: newProduct, error } = await supabase.from("products").insert(productData).select("id").single();
      if (error) { toast.error("Erro ao criar produto"); return; }
      productId = newProduct.id;
    }

    // Limpa antigos em paralelo (ingredientes do produto, ingredientes dos extras antigos, grupos vinculados)
    const { data: oldExtras } = await supabase.from("product_extras").select("id").eq("product_id", productId);
    const oldExtraIds = (oldExtras || []).map(e => e.id);

    await Promise.all([
      supabase.from("product_ingredients").delete().eq("product_id", productId),
      oldExtraIds.length > 0
        ? supabase.from("product_extra_ingredients").delete().in("product_extra_id", oldExtraIds)
        : Promise.resolve(),
      supabase.from("product_complement_groups").delete().eq("product_id", productId),
    ]);
    if (oldExtraIds.length > 0) {
      await supabase.from("product_extras").delete().eq("product_id", productId);
    }

    // Cria tudo em PARALELO (ingredientes fixos + variações + complementos avulsos + grupos vinculados)
    const insertOps: Promise<unknown>[] = [];

    if (ingredientType === "fixed" && ingredients.length > 0) {
      insertOps.push(
        Promise.resolve(supabase.from("product_ingredients").insert(ingredients.map(ing => ({ product_id: productId, stock_item_id: ing.stock_item_id, quantity: ing.quantity }))))
      );
    }

    const createExtraWithIngredients = async (payload: any, ings: ProductIngredient[]) => {
      const { data: newExtra } = await supabase.from("product_extras").insert(payload).select("id").single();
      if (newExtra && ings.length > 0) {
        await supabase.from("product_extra_ingredients").insert(ings.map(ing => ({ product_extra_id: newExtra.id, stock_item_id: ing.stock_item_id, quantity: ing.quantity })));
      }
    };

    if (ingredientType === "variable" && variations.length > 0) {
      for (const variation of variations) {
        insertOps.push(createExtraWithIngredients(
          { product_id: productId, name: variation.name, description: variation.description || null, price: variation.price, pdv_code: variation.pdv_code || null, is_required: true, min_selection: parseInt(variationMinSelection) || 1, max_selection: parseInt(variationMaxSelection) || 1 },
          variation.ingredients
        ));
      }
    }

    for (const extra of extras) {
      insertOps.push(createExtraWithIngredients(
        { product_id: productId, name: extra.name, description: extra.description || null, price: extra.price, is_required: extra.is_required || false },
        extra.ingredients || []
      ));
    }

    if (linkedGroups.length > 0) {
      const groupsData = linkedGroups.map((group, index) => ({
        product_id: productId, extra_category_id: group.extra_category_id,
        is_required: group.is_required, min_selection: group.min_selection, max_selection: group.max_selection,
        display_order: index,
      }));
      insertOps.push(
        Promise.resolve(supabase.from("product_complement_groups").insert(groupsData)).then(({ error: groupError }) => {
          if (groupError) {
            console.error("Erro ao salvar complementos:", groupError);
            toast.error("Erro ao salvar complementos vinculados");
          }
        })
      );
    }

    await Promise.all(insertOps);

    toast.success(editingProduct ? "Produto atualizado!" : "Produto criado!");
    resetForm();
    // realtime channel já dispara refetch — não bloqueia UI esperando
    fetchProducts();
  };

  const openEditDialog = async (product: Product) => {
    if (isRestaurantOpen) { toast.error("Feche o restaurante para editar produtos"); return; }

    setEditingProduct(product);
    setProductName(product.name);
    setProductDescription(product.description || "");
    setProductPrice(product.price.toString());
    setProductPromotionalPrice(product.promotional_price?.toString() || "");
    setProductCategoryId(product.category_id || "__none");
    setProductImageUrl(product.image_url);
    setProductPrepTime(product.prep_time?.toString() || "");
    setPdvCode((product as any).pdv_code || "");
    const channels = (product as any).visibility_channels || ["all"];
    if (channels.includes("all")) {
      const expanded = ["delivery", "mesa"];
      if (kioskEnabled) expanded.push("totem");
      setVisibilityChannels(expanded);
    } else {
      setVisibilityChannels(channels);
    }

    // Load fiscal fields
    setFiscalNcm((product as any).fiscal_ncm || "");
    setFiscalException((product as any).fiscal_exception || "");
    setFiscalCest((product as any).fiscal_cest || "");
    setFiscalCfop((product as any).fiscal_cfop || "");
    setFiscalIcmsCsosn((product as any).fiscal_icms_csosn || "");
    setFiscalIcmsOrigin((product as any).fiscal_icms_origin || "0");
    setFiscalPisCst((product as any).fiscal_pis_cst || "");
    setFiscalPisAliquota((product as any).fiscal_pis_aliquota?.toString() || "");
    setFiscalCofinsCst((product as any).fiscal_cofins_cst || "");
    setFiscalCofinsAliquota((product as any).fiscal_cofins_aliquota?.toString() || "");
    setFiscalIbsAliquota((product as any).fiscal_ibs_aliquota?.toString() || "");
    setFiscalCbsAliquota((product as any).fiscal_cbs_aliquota?.toString() || "");
    setFiscalBeneficioCode((product as any).fiscal_beneficio_code || "");
    setFiscalIndiceProducao((product as any).fiscal_indice_producao?.toString() || "");
    setFiscalAliquotaTransparencia((product as any).fiscal_aliquota_transparencia?.toString() || "");

    // Carrega ingredientes, extras e grupos vinculados em PARALELO
    const [
      { data: ingredientsData },
      { data: extrasData },
      { data: groupsData, error: groupsError },
    ] = await Promise.all([
      supabase.from("product_ingredients").select("*, stock_items(name, unit, price_per_unit)").eq("product_id", product.id),
      supabase.from("product_extras").select("*, product_extra_ingredients(*, stock_items(name, unit, price_per_unit))").eq("product_id", product.id),
      supabase.from("product_complement_groups").select("*, extra_categories(id, name, extra_category_items(id, name, price))").eq("product_id", product.id).order("display_order"),
    ]);

    const formattedIngredients = ingredientsData?.map((ing: any) => ({
      id: ing.id, stock_item_id: ing.stock_item_id, quantity: ing.quantity,
      stock_item_name: ing.stock_items?.name, stock_item_unit: ing.stock_items?.unit, stock_item_price: ing.stock_items?.price_per_unit
    })) || [];

    const variationsFromDB: IngredientVariation[] = [];
    const extrasFromDB: ProductExtra[] = [];

    extrasData?.forEach((extra: any) => {
      const ings = extra.product_extra_ingredients?.map((ing: any) => ({
        id: ing.id, stock_item_id: ing.stock_item_id, quantity: ing.quantity,
        stock_item_name: ing.stock_items?.name, stock_item_unit: ing.stock_items?.unit, stock_item_price: ing.stock_items?.price_per_unit
      })) || [];
      if (extra.is_required && ings.length > 0) {
        variationsFromDB.push({ id: extra.id, name: extra.name, description: extra.description || undefined, price: extra.price, pdv_code: extra.pdv_code || undefined, ingredients: ings });
        if (variationsFromDB.length === 1) { setVariationMinSelection(extra.min_selection?.toString() || "1"); setVariationMaxSelection(extra.max_selection?.toString() || "1"); setVariationIsRequired(true); }
      } else {
        extrasFromDB.push({ id: extra.id, name: extra.name, description: extra.description || undefined, price: extra.price, ingredients: ings, is_required: extra.is_required });
      }
    });

    if (variationsFromDB.length > 0) { setIngredientType("variable"); setVariations(variationsFromDB); setIngredients([]); }
    else { setIngredientType("fixed"); setIngredients(formattedIngredients); setVariations([]); }
    setExtras(extrasFromDB);

    if (groupsError) {
      console.error("Erro ao buscar complementos vinculados:", groupsError);
      toast.error("Erro ao carregar complementos do produto");
    }

    const formattedGroups: LinkedComplementGroup[] = (groupsData || []).map((g: any, idx: number) => ({
      id: g.id, extra_category_id: g.extra_category_id, category_name: g.extra_categories?.name || "",
      is_required: g.is_required || false, min_selection: g.min_selection || 0, max_selection: g.max_selection,
      display_order: g.display_order ?? idx,
      items: g.extra_categories?.extra_category_items || []
    }));

    setLinkedGroups(formattedGroups);
    setDialogOpen(true);
  };

  const resetForm = () => {
    setDialogOpen(false); setProductName(""); setProductDescription(""); setProductPrice(""); setProductPromotionalPrice("");
    setProductCategoryId(""); setProductImage(null); setProductImageUrl(null); setProductPrepTime(""); setPdvCode("");
    setIngredientType("fixed"); setIngredients([]); setVariations([]);
    setVariationName(""); setVariationDescription(""); setVariationPrice(""); setVariationIngredients([]);
    setVariationIsRequired(true); setVariationMinSelection("1"); setVariationMaxSelection("1");
    setExtras([]); setExtraName(""); setExtraDescription(""); setExtraPrice(""); setExtraIngredients([]);
    setSelectedStockItem(""); setIngredientQuantity("");
    setSelectedExtraStockItem(""); setExtraIngredientQuantity("");
    setEditingProduct(null); setLinkedGroups([]); setSelectedComplementCategory("");
    setGroupIsRequired(false); setGroupMinSelection("0"); setGroupMaxSelection(""); setExtraIsRequired(false);
    setVisibilityChannels(["delivery", "mesa", ...(kioskEnabled ? ["totem"] : [])]);
    setFiscalNcm(""); setFiscalException(""); setFiscalCest(""); setFiscalCfop("");
    setFiscalIcmsCsosn(""); setFiscalIcmsOrigin("0"); setFiscalPisCst(""); setFiscalPisAliquota("");
    setFiscalCofinsCst(""); setFiscalCofinsAliquota(""); setFiscalIbsAliquota(""); setFiscalCbsAliquota("");
    setFiscalBeneficioCode(""); setFiscalIndiceProducao(""); setFiscalAliquotaTransparencia("");
  };

  const fixedCost = useMemo(() => ingredients.reduce((sum, ing) => sum + (ing.quantity * (ing.stock_item_price || 0)), 0), [ingredients]);

  const variationCosts = useMemo(() => {
    const basePrice = parseFloat(productPrice) || 0;
    const promoPrice = parseFloat(productPromotionalPrice) || 0;
    const effectiveBasePrice = promoPrice > 0 ? promoPrice : basePrice;
    return variations.map(v => {
      const cost = v.ingredients.reduce((sum, ing) => sum + (ing.quantity * (ing.stock_item_price || 0)), 0);
      const totalPrice = effectiveBasePrice + v.price;
      const margin = totalPrice > 0 ? ((totalPrice - cost) / totalPrice) * 100 : 0;
      const cmv = totalPrice > 0 ? (cost / totalPrice) * 100 : 0;
      return { name: v.name, price: v.price, cost, margin, cmv, totalPrice };
    });
  }, [variations, productPrice, productPromotionalPrice]);

  const parsedProductPrice = parseFloat(productPrice) || 0;
  const parsedPromoPrice = parseFloat(productPromotionalPrice) || 0;
  const effectivePriceForCMV = parsedPromoPrice > 0 ? parsedPromoPrice : parsedProductPrice;
  const cmvPercentage = effectivePriceForCMV > 0 ? (fixedCost / effectivePriceForCMV) * 100 : 0;

  const filteredProducts = products.filter(product => {
    const q = normalizeSearch(searchQuery).trim();
    if (!q) return true;
    if (normalizeSearch(product.name).includes(q)) return true;
    if ((product as any).pdv_code && normalizeSearch((product as any).pdv_code).includes(q)) return true;
    if (product.extraPdvCodes?.some(code => normalizeSearch(code).includes(q))) return true;
    return false;
  });

  const groupedByCategory = useMemo(() => {
    const categoryMap = new Map<string, { name: string; products: Product[] }>();
    const uncategorized: Product[] = [];

    for (const product of filteredProducts) {
      if (!product.category_id) {
        uncategorized.push(product);
        continue;
      }
      if (!categoryMap.has(product.category_id)) {
        const cat = categories.find(c => c.id === product.category_id);
        categoryMap.set(product.category_id, { name: cat?.name || "Categoria desconhecida", products: [] });
      }
      categoryMap.get(product.category_id)!.products.push(product);
    }

    const sortedGroups = Array.from(categoryMap.values())
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    sortedGroups.forEach(g => g.products.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
    uncategorized.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    if (uncategorized.length > 0) {
      sortedGroups.push({ name: "Sem categoria", products: uncategorized });
    }

    return sortedGroups;
  }, [filteredProducts, categories]);

  return (
    <div className="space-y-6">
      {/* Search and Add Button */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome ou código PDV..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
        </div>
        <div className="flex items-center gap-2">
          {ifoodConnected && onOpenIfoodImport && (
            <Button
              onClick={() => { if (isRestaurantOpen) { toast.error("Feche o restaurante para importar"); return; } onOpenIfoodImport(); }}
              variant="outline"
              className="gap-2 border-orange-500/50 text-orange-600 hover:bg-orange-500/10 hover:text-orange-600"
              disabled={isRestaurantOpen}
              title={isRestaurantOpen ? "Feche o restaurante para importar do iFood" : undefined}
            >
              <Package className="h-4 w-4" />
              Importar do iFood
            </Button>
          )}
          {onOpenDigitizer && (
            <Button
              onClick={() => { if (isRestaurantOpen) { toast.error("Feche o restaurante para importar"); return; } onOpenDigitizer(); }}
              variant="outline"
              className="gap-2 border-primary/50 text-primary hover:bg-primary/10 hover:text-primary"
              disabled={isRestaurantOpen}
              title={isRestaurantOpen ? "Feche o restaurante para importar por AI" : undefined}
            >
              <Camera className="h-4 w-4" />
              🪄 Importar por AI
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={() => setBulkDeleteOpen(true)}
            title="Edição em massa"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button data-tour="cardapio-new-product" onClick={() => { if (isRestaurantOpen) { toast.error("Feche o restaurante para adicionar produtos"); return; } resetForm(); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Novo Produto
          </Button>
        </div>
      </div>

      {/* Products Grid grouped by category */}
      {filteredProducts.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-xl bg-muted/20">
          <p className="text-muted-foreground">{searchQuery ? "Nenhum produto encontrado" : "Nenhum produto cadastrado ainda"}</p>
        </div>
      ) : (
        <div className="space-y-8">
          {groupedByCategory.map((group) => (
            <div key={group.name}>
              <div className="flex items-center gap-3 mb-4">
                <h3 className="text-lg font-semibold text-foreground whitespace-nowrap">{group.name}</h3>
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground whitespace-nowrap">{group.products.length} {group.products.length === 1 ? "produto" : "produtos"}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.products.map((product) => (
                  <ProductCard key={product.id} product={product} onEdit={openEditDialog} onToggleAvailable={handleToggleAvailable} onDuplicate={handleDuplicateProduct} onDelete={handleDeleteProduct} onImageUpdated={fetchProducts} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog — Redesigned */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-0">
          <div className="sticky top-0 z-10 bg-background border-b px-6 py-4">
            <DialogHeader>
              <DialogTitle className="text-xl flex items-center gap-2">
                <Package className="w-5 h-5 text-primary" />
                {editingProduct ? "Editar Produto" : "Novo Produto"}
              </DialogTitle>
              <DialogDescription className="text-sm">
                {editingProduct ? "Altere os dados e salve" : "Preencha as informações do produto"}
              </DialogDescription>
            </DialogHeader>
          </div>

          <form onSubmit={handleSubmit} className="px-6 pb-6">
            <Tabs defaultValue="produto" className="mt-4">
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="produto" className="gap-2">
                  <Package className="w-4 h-4" /> Produto
                </TabsTrigger>
                <TabsTrigger value="fiscal" className="gap-2">
                  <Settings2 className="w-4 h-4" /> Fiscal
                </TabsTrigger>
              </TabsList>

              <TabsContent value="produto" className="space-y-6 mt-0">
                {/* Basic Info — 2 column layout */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Left Column */}
                  <div className="space-y-5">
                    <Card className="border-border/50">
                      <CardContent className="pt-5 space-y-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                          <Tag className="w-4 h-4" /> Informações
                        </div>
                        <div>
                          <Label htmlFor="product-name">Nome *</Label>
                          <Input id="product-name" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Ex: Pizza Margherita" required className="mt-1" />
                        </div>
                        <div>
                          <Label htmlFor="product-description">Descrição</Label>
                          <Textarea id="product-description" value={productDescription} onChange={(e) => setProductDescription(e.target.value)} placeholder="Descreva o produto..." rows={3} className="mt-1 resize-none" />
                        </div>
                        <div>
                          <Label htmlFor="product-category">Categoria</Label>
                          <Select value={productCategoryId} onValueChange={setProductCategoryId}>
                            <SelectTrigger className="mt-1"><SelectValue placeholder="Sem categoria" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none">Sem categoria</SelectItem>
                              {categories.map((cat) => (<SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                            ⚠️ Se não colocar em nenhuma categoria, o produto não aparecerá em nenhum cardápio (digital, totem ou mesa). Só aparecerá se estiver marcado como Destaque.
                          </p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Image */}
                    <Card className="border-border/50">
                      <CardContent className="pt-5 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                          <Image className="w-4 h-4" /> Foto
                        </div>
                        {productImageUrl && !productImage && (
                          <img src={productImageUrl} alt="Preview" className="w-full h-40 object-cover rounded-lg border" />
                        )}
                        <Input id="product-image" type="file" accept="image/*,image/webp,.webp,.jpg,.jpeg,.png,.gif" onChange={(e) => setProductImage(e.target.files?.[0] || null)} />
                      </CardContent>
                    </Card>
                  </div>

                  {/* Right Column */}
                  <div className="space-y-5">
                    <Card className="border-border/50">
                      <CardContent className="pt-5 space-y-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                          <DollarSign className="w-4 h-4" /> Preços e Detalhes
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label htmlFor="product-price">Preço Base (R$) *</Label>
                            <Input id="product-price" type="number" step="0.01" value={productPrice} onChange={(e) => setProductPrice(e.target.value)} placeholder="0.00" required className="mt-1" />
                          </div>
                          <div>
                            <Label htmlFor="product-promotional-price">Preço Promo (R$)</Label>
                            <Input id="product-promotional-price" type="number" step="0.01" min="0" value={productPromotionalPrice} onChange={(e) => setProductPromotionalPrice(e.target.value)} placeholder="Opcional" className="mt-1" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label htmlFor="product-prep-time">Tempo Preparo (min)</Label>
                            <Input id="product-prep-time" type="number" min="0" step="1" value={productPrepTime} onChange={(e) => setProductPrepTime(e.target.value)} placeholder="30" className="mt-1" />
                          </div>
                          <div>
                            <Label htmlFor="product-pdv-code">Código PDV</Label>
                            <Input id="product-pdv-code" value={pdvCode} onChange={(e) => setPdvCode(e.target.value)} placeholder="Ex: 001" className="mt-1" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Visibility Channels */}
                    <Card className="border-border/50">
                      <CardContent className="pt-5 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                          Visibilidade por Canal
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Selecione em quais canais este produto ficará disponível
                        </p>

                        <div className="space-y-2 mt-2">
                          {[
                            { key: "delivery", label: "Delivery", desc: "Aparece no cardápio digital de delivery" },
                            { key: "mesa", label: "Mesas", desc: "Aparece no cardápio digital das mesas" },
                            ...(kioskEnabled ? [{ key: "totem", label: "Totem", desc: "Aparece no cardápio do totem de autoatendimento" }] : []),
                          ].map(ch => (
                            <div key={ch.key} className="flex items-center gap-3 p-3 border rounded-lg">
                              <Checkbox
                                id={`visible_${ch.key}`}
                                checked={visibilityChannels.includes(ch.key)}
                                onCheckedChange={(checked) => {
                                  setVisibilityChannels(prev =>
                                    checked
                                      ? [...prev.filter(c => c !== "all"), ch.key]
                                      : prev.filter(c => c !== ch.key)
                                  );
                                }}
                              />
                              <div>
                                <Label htmlFor={`visible_${ch.key}`} className="cursor-pointer font-medium">
                                  {ch.label}
                                </Label>
                                <p className="text-xs text-muted-foreground">{ch.desc}</p>
                              </div>
                            </div>
                          ))}
                        </div>

                        {visibilityChannels.filter(c => c !== "all").length === 0 && (
                          <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                            <AlertCircle className="w-3 h-3" />
                            Produto não aparecerá em nenhum canal
                          </p>
                        )}
                      </CardContent>
                    </Card>

                    {(fixedCost > 0 || variationCosts.length > 0) && (
                      <Card className="border-primary/20 bg-primary/5">
                        <CardContent className="pt-5">
                          <div className="flex items-center gap-2 text-sm font-semibold text-primary mb-2">
                            <DollarSign className="w-4 h-4" /> Análise de Custos
                          </div>
                          {ingredientType === "fixed" && fixedCost > 0 && (
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <p>Custo: <span className="font-bold">R$ {fixedCost.toFixed(2)}</span></p>
                              {parsedProductPrice > 0 && (
                                <p>CMV: <span className={`font-bold ${cmvPercentage > 35 ? 'text-destructive' : 'text-green-600'}`}>{cmvPercentage.toFixed(1)}%</span></p>
                              )}
                            </div>
                          )}
                          {ingredientType === "variable" && variationCosts.length > 0 && (
                            <div className="space-y-1 text-sm">
                              {variationCosts.map(vc => (
                                <div key={vc.name} className="flex justify-between">
                                  <span>{vc.name}</span>
                                  <span>R$ {vc.cost.toFixed(2)} • CMV: <span className={vc.cmv > 35 ? 'text-destructive font-bold' : 'text-green-600 font-bold'}>{vc.cmv.toFixed(1)}%</span></span>
                                </div>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Ingredients Section */}
                <Card className="border-border/50">
                  <CardContent className="pt-5 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      <Layers className="w-4 h-4" /> Insumos <span className="text-xs font-normal normal-case">(Opcional)</span>
                    </div>
                    <RadioGroup value={ingredientType} onValueChange={(v) => setIngredientType(v as "fixed" | "variable")} className="flex gap-6">
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="fixed" id="fixed" />
                        <Label htmlFor="fixed" className="cursor-pointer">Fixos <span className="text-xs text-muted-foreground block">Mesmos insumos em todos pedidos</span></Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="variable" id="variable" />
                        <Label htmlFor="variable" className="cursor-pointer">Variáveis <span className="text-xs text-muted-foreground block">Cliente escolhe (tamanhos, etc.)</span></Label>
                      </div>
                    </RadioGroup>

                    {ingredientType === "fixed" && (
                      <div className="space-y-3">
                        <div className="flex gap-2">
                          <Select value={selectedStockItem} onValueChange={setSelectedStockItem}>
                            <SelectTrigger className="flex-1"><SelectValue placeholder="Selecione um insumo" /></SelectTrigger>
                            <SelectContent>{stockItems.map((item) => (<SelectItem key={item.id} value={item.id}>{item.name} ({item.unit}) - R$ {item.price_per_unit.toFixed(2)}/{item.unit}</SelectItem>))}</SelectContent>
                          </Select>
                          <Input className="w-28" type="number" step="0.001" placeholder="Qtd" value={ingredientQuantity} onChange={(e) => setIngredientQuantity(e.target.value)} />
                          <Button type="button" variant="outline" size="icon" onClick={handleAddIngredient}><Plus className="h-4 w-4" /></Button>
                        </div>
                        {ingredients.length > 0 && (
                          <div className="space-y-1.5">
                            {ingredients.map((ing) => (
                              <div key={ing.id} className="flex items-center justify-between p-2.5 bg-muted/50 rounded-lg text-sm">
                                <span>{ing.stock_item_name} — {ing.quantity} {ing.stock_item_unit}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground text-xs">R$ {((ing.stock_item_price || 0) * ing.quantity).toFixed(2)}</span>
                                  <Button type="button" variant="ghost" size="sm" onClick={() => handleRemoveIngredient(ing.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {ingredientType === "variable" && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-2 p-3 bg-muted/30 rounded-lg border">
                          <div className="flex items-center gap-2">
                            <input type="checkbox" id="variation-required" checked={variationIsRequired} onChange={(e) => setVariationIsRequired(e.target.checked)} className="rounded border-input" />
                            <Label htmlFor="variation-required" className="text-xs">Obrigatório</Label>
                          </div>
                          <div><Label className="text-xs">Mín</Label><Input type="number" min="0" value={variationMinSelection} onChange={(e) => setVariationMinSelection(e.target.value)} className="h-8" /></div>
                          <div><Label className="text-xs">Máx</Label><Input type="number" min="1" value={variationMaxSelection} onChange={(e) => setVariationMaxSelection(e.target.value)} className="h-8" /></div>
                        </div>
                        <div className="space-y-2 p-3 bg-muted/20 rounded-lg border">
                          <p className="text-sm font-medium">Nova Variação</p>
                          <div className="grid grid-cols-2 gap-2">
                            <Input placeholder="Nome (ex: Batata P)" value={variationName} onChange={(e) => setVariationName(e.target.value)} />
                            <Input type="number" step="0.01" placeholder="Preço adicional" value={variationPrice} onChange={(e) => setVariationPrice(e.target.value)} />
                          </div>
                          <Input placeholder="Descrição (opcional)" value={variationDescription} onChange={(e) => setVariationDescription(e.target.value)} className="text-xs h-8" />
                          <div className="flex gap-2">
                            <Select value={selectedVariationStockItem} onValueChange={setSelectedVariationStockItem}>
                              <SelectTrigger className="flex-1"><SelectValue placeholder="Insumo" /></SelectTrigger>
                              <SelectContent>{stockItems.map((item) => (<SelectItem key={item.id} value={item.id}>{item.name} - R$ {item.price_per_unit.toFixed(2)}/{item.unit}</SelectItem>))}</SelectContent>
                            </Select>
                            <Input className="w-24" type="number" step="0.001" placeholder="Qtd" value={variationIngredientQuantity} onChange={(e) => setVariationIngredientQuantity(e.target.value)} />
                            <Button type="button" variant="outline" size="icon" onClick={handleAddVariationIngredient}><Plus className="h-4 w-4" /></Button>
                          </div>
                          {variationIngredients.length > 0 && (
                            <div className="space-y-1">{[...variationIngredients].sort((a, b) => (a.stock_item_name || "").localeCompare(b.stock_item_name || "", "pt-BR")).map((ing) => (
                              <div key={ing.id} className="flex items-center justify-between p-2 bg-background rounded text-xs">
                                <span>{ing.stock_item_name} — {ing.quantity} {ing.stock_item_unit} — <b>R$ {((ing.stock_item_price || 0) * ing.quantity).toFixed(2)}</b></span>
                                <Button type="button" variant="ghost" size="sm" onClick={() => handleRemoveVariationIngredient(ing.id)}><Trash2 className="h-3 w-3" /></Button>
                              </div>
                            ))}</div>
                          )}
                          <Button type="button" variant="secondary" onClick={handleAddVariation} className="w-full">Adicionar Variação</Button>
                        </div>
                        {variations.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Variações:</p>
                            {variations.map((v, vIdx) => {
                              const vc = variationCosts.find(c => c.name === v.name);
                              const moveVariation = (dir: 'up' | 'down') => {
                                const newArr = [...variations];
                                const target = dir === 'up' ? vIdx - 1 : vIdx + 1;
                                if (target < 0 || target >= newArr.length) return;
                                [newArr[vIdx], newArr[target]] = [newArr[target], newArr[vIdx]];
                                setVariations(newArr);
                              };
                              return (
                                <div key={v.id} className="p-3 bg-muted/30 rounded-lg border">
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2"><span className="font-medium">{v.name}</span>{v.pdv_code && <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">PDV: {v.pdv_code}</span>}<span className="text-sm text-muted-foreground ml-2">{v.price > 0 ? `+R$ ${v.price.toFixed(2)}` : "Incluído"}</span></div>
                                    <div className="flex items-center gap-0.5">
                                      <Button type="button" variant="ghost" size="sm" onClick={() => moveVariation('up')} disabled={vIdx === 0} title="Mover para cima" className="h-6 w-6 p-0"><ArrowUp className="h-3 w-3" /></Button>
                                      <Button type="button" variant="ghost" size="sm" onClick={() => moveVariation('down')} disabled={vIdx === variations.length - 1} title="Mover para baixo" className="h-6 w-6 p-0"><ArrowDown className="h-3 w-3" /></Button>
                                      <Button type="button" variant="ghost" size="sm" onClick={() => handleDuplicateVariation(v.id)} title="Duplicar variação" className="h-6 w-6 p-0"><Copy className="h-3 w-3" /></Button>
                                      <Button type="button" variant="ghost" size="sm" onClick={() => handleEditVariation(v.id)} title="Editar variação" className="h-6 w-6 p-0"><Pencil className="h-3 w-3" /></Button>
                                      <Button type="button" variant="ghost" size="sm" onClick={() => handleRemoveVariation(v.id)} title="Excluir variação" className="h-6 w-6 p-0"><Trash2 className="h-3 w-3" /></Button>
                                    </div>
                                  </div>
                                  <div className="text-xs text-muted-foreground">{v.ingredients.map(i => `${i.stock_item_name} — ${i.quantity}${i.stock_item_unit} (R$ ${((i.stock_item_price || 0) * i.quantity).toFixed(2)})`).join(", ")}</div>
                                  {v.description && <p className="text-xs text-muted-foreground/70 italic mt-0.5">{v.description}</p>}
                                  {vc && (
                                    <div className="mt-2 pt-2 border-t text-xs grid grid-cols-3 gap-2">
                                      <span>Custo: <b>R$ {vc.cost.toFixed(2)}</b></span>
                                      <span>CMV: <b className={vc.cmv > 35 ? 'text-destructive' : ''}>{vc.cmv.toFixed(1)}%</b></span>
                                      <span>Margem: <b className={vc.margin < 50 ? 'text-destructive' : ''}>{vc.margin.toFixed(1)}%</b></span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Complements Section */}
                <Card className="border-border/50">
                  <CardContent className="pt-5 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      <Layers className="w-4 h-4" /> Complementos <span className="text-xs font-normal normal-case">(Opcional)</span>
                    </div>

                    {/* Link Complement Category */}
                    <div className="space-y-3 p-4 bg-muted/20 rounded-lg border">
                      <p className="text-sm font-medium">Vincular Categoria de Complementos</p>
                      <div className="flex gap-2">
                        <Select value={selectedComplementCategory} onValueChange={setSelectedComplementCategory}>
                          <SelectTrigger className="flex-1"><SelectValue placeholder="Selecione uma categoria" /></SelectTrigger>
                          <SelectContent>{complementCategories.map((cat) => (<SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>))}</SelectContent>
                        </Select>
                      </div>
                      {selectedComplementCategory && (
                        <div className="grid grid-cols-3 gap-2">
                          <div className="flex items-center gap-2">
                            <input type="checkbox" id="group-required" checked={groupIsRequired} onChange={(e) => setGroupIsRequired(e.target.checked)} className="rounded border-input" />
                            <Label htmlFor="group-required" className="text-xs">Obrigatório</Label>
                          </div>
                          <div><Label className="text-xs">Mín</Label><Input type="number" min="0" value={groupMinSelection} onChange={(e) => setGroupMinSelection(e.target.value)} className="h-8" /></div>
                          <div><Label className="text-xs">Máx</Label><Input type="number" min="0" value={groupMaxSelection} onChange={(e) => setGroupMaxSelection(e.target.value)} placeholder="∞" className="h-8" /></div>
                        </div>
                      )}
                      <Button type="button" variant="outline" onClick={handleLinkComplementCategory} className="w-full">Vincular Categoria</Button>
                    </div>

                    {/* Linked Groups */}
                    {linkedGroups.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Categorias Vinculadas:</p>
                        {linkedGroups.map((group, index) => (
                          <div key={group.id} className="p-3 bg-primary/5 rounded-lg border border-primary/20">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{group.category_name}</span>
                                {group.is_required && <Badge variant="default" className="text-[10px] h-5">Obrigatório</Badge>}
                              </div>
                              <div className="flex items-center gap-1">
                                <Button type="button" variant="ghost" size="sm" onClick={() => handleMoveLinkedGroup(index, 'up')} disabled={index === 0} className="h-7 w-7 p-0"><ArrowUp className="h-3.5 w-3.5" /></Button>
                                <Button type="button" variant="ghost" size="sm" onClick={() => handleMoveLinkedGroup(index, 'down')} disabled={index === linkedGroups.length - 1} className="h-7 w-7 p-0"><ArrowDown className="h-3.5 w-3.5" /></Button>
                                <Button type="button" variant="ghost" size="sm" onClick={() => handleRemoveLinkedGroup(group.id)}>Remover</Button>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">{
                              group.items.length} itens • Min: {group.min_selection} • Max: {group.max_selection ?? "∞"}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{group.items.map(i => i.name).join(", ")}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Individual Complement */}
                    <div className="space-y-3 p-4 bg-muted/20 rounded-lg border">
                      <p className="text-sm font-medium">Criar Complemento Avulso</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Input placeholder="Nome do complemento" value={extraName} onChange={(e) => setExtraName(e.target.value)} />
                        <Input type="number" step="0.01" placeholder="Preço" value={extraPrice} onChange={(e) => setExtraPrice(e.target.value)} />
                      </div>
                      <Input placeholder="Descrição (opcional)" value={extraDescription} onChange={(e) => setExtraDescription(e.target.value)} className="text-xs h-8" />
                      <div className="flex items-center gap-2">
                        <input type="checkbox" id="extra-required" checked={extraIsRequired} onChange={(e) => setExtraIsRequired(e.target.checked)} className="rounded border-input" />
                        <Label htmlFor="extra-required" className="text-xs">Obrigatório</Label>
                      </div>
                      <div className="flex gap-2">
                        <Select value={selectedExtraStockItem} onValueChange={setSelectedExtraStockItem}>
                          <SelectTrigger className="flex-1"><SelectValue placeholder="Insumo (opcional)" /></SelectTrigger>
                          <SelectContent>{stockItems.map((item) => (<SelectItem key={item.id} value={item.id}>{item.name} - R$ {item.price_per_unit.toFixed(2)}/{item.unit}</SelectItem>))}</SelectContent>
                        </Select>
                        <Input className="w-28" type="number" step="0.001" placeholder="Qtd" value={extraIngredientQuantity} onChange={(e) => setExtraIngredientQuantity(e.target.value)} />
                        <Button type="button" variant="outline" size="icon" onClick={handleAddExtraIngredient}><Plus className="h-4 w-4" /></Button>
                      </div>
                      {extraIngredients.length > 0 && (
                        <div className="space-y-1">{extraIngredients.map((ing) => (
                          <div key={ing.id} className="flex items-center justify-between p-2 bg-background rounded text-xs">
                            <span>{ing.stock_item_name} — {ing.quantity} {ing.stock_item_unit}</span>
                            <Button type="button" variant="ghost" size="sm" onClick={() => handleRemoveExtraIngredient(ing.id)}>Remover</Button>
                          </div>
                        ))}</div>
                      )}
                      <Button type="button" variant="secondary" onClick={handleAddExtra} className="w-full">Adicionar Complemento</Button>
                    </div>

                    {extras.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Complementos Avulsos:</p>
                        {extras.map((extra) => (
                          <div key={extra.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border">
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-medium">{extra.name} — R$ {extra.price.toFixed(2)}</p>
                                {extra.is_required && <Badge variant="default" className="text-[10px] h-5">Obrigatório</Badge>}
                              </div>
                              {extra.description && <p className="text-xs text-muted-foreground/70 italic">{extra.description}</p>}
                              <p className="text-xs text-muted-foreground">{extra.ingredients?.length || 0} insumo(s)</p>
                            </div>
                            <Button type="button" variant="destructive" size="sm" onClick={() => handleRemoveExtra(extra.id)}>Remover</Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="fiscal" className="space-y-4 mt-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 mb-2"
                  disabled={fiscalAiLoading || !productName}
                  onClick={handleFiscalAiSuggest}
                >
                  {fiscalAiLoading ? (
                    <span className="animate-spin">⏳</span>
                  ) : (
                    <span>✨</span>
                  )}
                  {fiscalAiLoading ? "Analisando..." : "Sugerir Tributação com IA"}
                </Button>
                <Card className="border-border/50">
                  <CardContent className="pt-5 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>NCM</Label><Input value={fiscalNcm} onChange={(e) => setFiscalNcm(e.target.value)} placeholder="Ex: 21069090" /></div>
                      <div className="space-y-2"><Label>Exceção TIPI</Label><Input value={fiscalException} onChange={(e) => setFiscalException(e.target.value)} placeholder="Ex: 01" /></div>
                      <div className="space-y-2"><Label>CEST</Label><Input value={fiscalCest} onChange={(e) => setFiscalCest(e.target.value)} placeholder="Ex: 0300100" /></div>
                      <div className="space-y-2"><Label>CFOP</Label><Input value={fiscalCfop} onChange={(e) => setFiscalCfop(e.target.value)} placeholder="Ex: 5102" /></div>
                      <div className="space-y-2"><Label>Alíquota Transparência (%)</Label><Input type="number" step="0.01" value={fiscalAliquotaTransparencia} onChange={(e) => setFiscalAliquotaTransparencia(e.target.value)} placeholder="0.00" /></div>
                      <div className="space-y-2"><Label>Código Benefício Fiscal</Label><Input value={fiscalBeneficioCode} onChange={(e) => setFiscalBeneficioCode(e.target.value)} /></div>
                      <div className="space-y-2"><Label>Índice de Produção</Label><Input type="number" step="0.01" value={fiscalIndiceProducao} onChange={(e) => setFiscalIndiceProducao(e.target.value)} placeholder="0.00" /></div>
                    </div>
                    <Separator />
                    <h4 className="font-semibold text-sm">ICMS</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Situação Tributária (CSOSN)</Label><Input value={fiscalIcmsCsosn} onChange={(e) => setFiscalIcmsCsosn(e.target.value)} placeholder="Ex: 102" /></div>
                      <div className="space-y-2"><Label>Origem</Label><Input value={fiscalIcmsOrigin} onChange={(e) => setFiscalIcmsOrigin(e.target.value)} placeholder="0" /></div>
                    </div>
                    <Separator />
                    <h4 className="font-semibold text-sm">IBS / CBS</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Alíquota IBS (%)</Label><Input type="number" step="0.01" value={fiscalIbsAliquota} onChange={(e) => setFiscalIbsAliquota(e.target.value)} placeholder="0.00" /></div>
                      <div className="space-y-2"><Label>Alíquota CBS (%)</Label><Input type="number" step="0.01" value={fiscalCbsAliquota} onChange={(e) => setFiscalCbsAliquota(e.target.value)} placeholder="0.00" /></div>
                    </div>
                    <Separator />
                    <h4 className="font-semibold text-sm">PIS / COFINS</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Situação Tributária PIS</Label><Input value={fiscalPisCst} onChange={(e) => setFiscalPisCst(e.target.value)} placeholder="Ex: 49" /></div>
                      <div className="space-y-2"><Label>Alíquota PIS (%)</Label><Input type="number" step="0.01" value={fiscalPisAliquota} onChange={(e) => setFiscalPisAliquota(e.target.value)} placeholder="0.00" /></div>
                      <div className="space-y-2"><Label>Situação Tributária COFINS</Label><Input value={fiscalCofinsCst} onChange={(e) => setFiscalCofinsCst(e.target.value)} placeholder="Ex: 49" /></div>
                      <div className="space-y-2"><Label>Alíquota COFINS (%)</Label><Input type="number" step="0.01" value={fiscalCofinsAliquota} onChange={(e) => setFiscalCofinsAliquota(e.target.value)} placeholder="0.00" /></div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <div className="sticky bottom-0 bg-background pt-4 pb-2 border-t mt-6 -mx-6 px-6">
              <Button type="submit" className="w-full h-11 text-base font-semibold">
                {editingProduct ? "Atualizar Produto" : "Criar Produto"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <BulkDeleteProductsDialog
        restaurantId={restaurantId}
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        onDeleted={fetchProducts}
        isRestaurantOpen={isRestaurantOpen}
      />
    </div>
  );
};

export default ProductsGrid;

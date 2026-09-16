import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Plus, Pencil, Trash2, Search, ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { getAllUsedPdvCodes } from "@/lib/pdvCodeGenerator";
import { UpsellManagerCard } from "./UpsellManagerCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { checkProductInActiveOrders } from "@/lib/dangerChecks";
import { normalizeSearch } from "@/lib/searchNormalize";

import { novoId } from "@/lib/uuid";
interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category_id: string;
  available: boolean;
  image_url: string | null;
  pdv_code?: string | null;
  fiscal_ncm?: string | null;
  fiscal_exception?: string | null;
  fiscal_cest?: string | null;
  fiscal_cfop?: string | null;
  fiscal_icms_csosn?: string | null;
  fiscal_icms_origin?: string | null;
  fiscal_pis_cst?: string | null;
  fiscal_pis_aliquota?: number | null;
  fiscal_cofins_cst?: string | null;
  fiscal_cofins_aliquota?: number | null;
  fiscal_ibs_aliquota?: number | null;
  fiscal_cbs_aliquota?: number | null;
  fiscal_beneficio_code?: string | null;
  fiscal_indice_producao?: number | null;
  fiscal_aliquota_transparencia?: number | null;
}

interface Category {
  id: string;
  name: string;
}

interface ProductExtra {
  id: string;
  name: string;
  price: number;
  ingredients?: ProductIngredient[];
  cost?: number;
}

interface ProductIngredient {
  id: string;
  stock_item_id: string;
  quantity: number;
  stock_item_name?: string;
  stock_item_unit?: string;
  stock_item_price?: number;
}

interface StockItem {
  id: string;
  name: string;
  unit: string;
  price_per_unit: number;
}

interface ExtraCategory {
  id: string;
  name: string;
  restaurant_id: string;
}

interface ExtraCategoryItem {
  id: string;
  category_id: string;
  name: string;
  price: number;
  ingredients?: ProductIngredient[];
  cost?: number;
}

const ProductsTab = ({ restaurantId, isRestaurantOpen }: { restaurantId: string; isRestaurantOpen: boolean }) => {
  const confirm = useConfirmDialog();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [ingredients, setIngredients] = useState<ProductIngredient[]>([]);
  const [selectedStockItem, setSelectedStockItem] = useState("");
  const [ingredientQuantity, setIngredientQuantity] = useState("");
  
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productCategoryId, setProductCategoryId] = useState("");
  const [productPrepTime, setProductPrepTime] = useState("");
  const [productImage, setProductImage] = useState<File | null>(null);
  const [productImageUrl, setProductImageUrl] = useState<string | null>(null);
  const [extras, setExtras] = useState<ProductExtra[]>([]);
  const [extraName, setExtraName] = useState("");
  const [extraPrice, setExtraPrice] = useState("");
  const [extraIngredients, setExtraIngredients] = useState<ProductIngredient[]>([]);
  const [selectedExtraStockItem, setSelectedExtraStockItem] = useState("");
  const [extraIngredientQuantity, setExtraIngredientQuantity] = useState("");
  const [editingExtraIndex, setEditingExtraIndex] = useState<number | null>(null);

  // Estados para categorias de adicionais
  const [extraCategories, setExtraCategories] = useState<ExtraCategory[]>([]);
  const [extraCategoryDialogOpen, setExtraCategoryDialogOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryItems, setCategoryItems] = useState<ExtraCategoryItem[]>([]);
  const [categoryItemName, setCategoryItemName] = useState("");
  const [categoryItemPrice, setCategoryItemPrice] = useState("");
  const [categoryItemIngredients, setCategoryItemIngredients] = useState<ProductIngredient[]>([]);
  const [selectedCategoryItemStockItem, setSelectedCategoryItemStockItem] = useState("");
  const [categoryItemIngredientQuantity, setCategoryItemIngredientQuantity] = useState("");
  const [editingCategoryItemIndex, setEditingCategoryItemIndex] = useState<number | null>(null);

  const [extraCategoriesOpen, setExtraCategoriesOpen] = useState(false);
  const [productCategoriesOpen, setProductCategoriesOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);

  // Fiscal fields
  const [pdvCode, setPdvCode] = useState("");
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
    fetchExtraCategories();
    fetchStockItems();

    // Debounced realtime for products
    let debounceTimer: ReturnType<typeof setTimeout>;
    const channel = supabase
      .channel(`products-tab-${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `restaurant_id=eq.${restaurantId}` }, () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(fetchProducts, 500);
      })
      .subscribe();

    return () => {
      clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  const fetchStockItems = async () => {
    const { data } = await supabase
      .from("stock_items")
      .select("id, name, unit, price_per_unit")
      .eq("restaurant_id", restaurantId)
      .order("name");
    setStockItems(data || []);
  };

  const fetchCategories = async () => {
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .eq("restaurant_id", restaurantId);

    if (!error) {
      setCategories(data || []);
    }
  };

  const fetchProducts = async () => {
    // Use already-fetched categories instead of duplicating the query
    const catIds = categories.length > 0 ? categories.map(c => c.id) : null;
    if (!catIds) {
      const { data: restaurantCategories } = await supabase
        .from("categories").select("id").eq("restaurant_id", restaurantId);
      if (!restaurantCategories || restaurantCategories.length === 0) { setProducts([]); return; }
      const { data, error } = await supabase.from("products").select("*").in("category_id", restaurantCategories.map(c => c.id)).order("name");
      if (error) { toast.error("Erro ao carregar produtos"); return; }
      setProducts(data || []);
      return;
    }
    const { data, error } = await supabase.from("products").select("*").in("category_id", catIds).order("name");
    if (error) { toast.error("Erro ao carregar produtos"); return; }
    setProducts(data || []);
  };

  const fetchExtraCategories = async () => {
    const { data, error } = await supabase
      .from("extra_categories")
      .select("*")
      .eq("restaurant_id", restaurantId);

    if (!error) {
      setExtraCategories(data || []);
    }
  };

  const handleAddExtra = () => {
    if (!extraName || !extraPrice) {
      toast.error("Preencha nome e preço do adicional");
      return;
    }
    
    if (extraIngredients.length === 0) {
      toast.error("Adicione pelo menos 1 insumo ao adicional");
      return;
    }
    
    const extraCost = extraIngredients.reduce((sum, ing) => {
      return sum + (ing.quantity * (ing.stock_item_price || 0));
    }, 0);
    
    if (editingExtraIndex !== null) {
      // Atualizar adicional existente
      const updatedExtras = [...extras];
      updatedExtras[editingExtraIndex] = {
        id: updatedExtras[editingExtraIndex].id,
        name: extraName,
        price: parseFloat(extraPrice),
        ingredients: [...extraIngredients],
        cost: extraCost
      };
      setExtras(updatedExtras);
      setEditingExtraIndex(null);
    } else {
      // Adicionar novo adicional
      setExtras([...extras, {
        id: novoId(),
        name: extraName,
        price: parseFloat(extraPrice),
        ingredients: [...extraIngredients],
        cost: extraCost
      }]);
    }
    
    setExtraName("");
    setExtraPrice("");
    setExtraIngredients([]);
  };

  const handleEditExtra = (index: number) => {
    const extra = extras[index];
    setExtraName(extra.name);
    setExtraPrice(extra.price.toString());
    setExtraIngredients(extra.ingredients || []);
    setEditingExtraIndex(index);
  };

  const handleRemoveExtra = (id: string) => {
    setExtras(extras.filter(e => e.id !== id));
    if (editingExtraIndex !== null) {
      setEditingExtraIndex(null);
      setExtraName("");
      setExtraPrice("");
      setExtraIngredients([]);
    }
  };

  const handleAddExtraIngredient = () => {
    if (!selectedExtraStockItem || !extraIngredientQuantity) return;
    const stockItem = stockItems.find(s => s.id === selectedExtraStockItem);
    if (!stockItem) return;
    
    setExtraIngredients([...extraIngredients, {
      id: novoId(),
      stock_item_id: selectedExtraStockItem,
      quantity: parseFloat(extraIngredientQuantity),
      stock_item_name: stockItem.name,
      stock_item_unit: stockItem.unit,
      stock_item_price: stockItem.price_per_unit
    }]);
    setSelectedExtraStockItem("");
    setExtraIngredientQuantity("");
  };

  const handleRemoveExtraIngredient = (id: string) => {
    setExtraIngredients(extraIngredients.filter(i => i.id !== id));
  };

  const handleAddIngredient = () => {
    if (!selectedStockItem || !ingredientQuantity) return;
    const stockItem = stockItems.find(s => s.id === selectedStockItem);
    if (!stockItem) return;
    
    setIngredients([...ingredients, {
      id: novoId(),
      stock_item_id: selectedStockItem,
      quantity: parseFloat(ingredientQuantity),
      stock_item_name: stockItem.name,
      stock_item_unit: stockItem.unit,
      stock_item_price: stockItem.price_per_unit
    }]);
    setSelectedStockItem("");
    setIngredientQuantity("");
  };

  const handleRemoveIngredient = (id: string) => {
    setIngredients(ingredients.filter(i => i.id !== id));
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    const { error } = await supabase
      .from("categories")
      .insert({ name: newCategoryName, restaurant_id: restaurantId });
    if (!error) {
      toast.success("Categoria criada!");
      setNewCategoryName("");
      setCategoryDialogOpen(false);
      fetchCategories();
    }
  };

  const handleAddCategoryItem = () => {
    if (!categoryItemName || !categoryItemPrice) {
      toast.error("Preencha nome e preço do adicional");
      return;
    }
    
    if (categoryItemIngredients.length === 0) {
      toast.error("Adicione pelo menos 1 insumo ao adicional");
      return;
    }
    
    const itemCost = categoryItemIngredients.reduce((sum, ing) => {
      return sum + (ing.quantity * (ing.stock_item_price || 0));
    }, 0);
    
    if (editingCategoryItemIndex !== null) {
      const updatedItems = [...categoryItems];
      updatedItems[editingCategoryItemIndex] = {
        id: updatedItems[editingCategoryItemIndex].id,
        category_id: "",
        name: categoryItemName,
        price: parseFloat(categoryItemPrice),
        ingredients: [...categoryItemIngredients],
        cost: itemCost
      };
      setCategoryItems(updatedItems);
      setEditingCategoryItemIndex(null);
    } else {
      setCategoryItems([...categoryItems, {
        id: novoId(),
        category_id: "",
        name: categoryItemName,
        price: parseFloat(categoryItemPrice),
        ingredients: [...categoryItemIngredients],
        cost: itemCost
      }]);
    }
    
    setCategoryItemName("");
    setCategoryItemPrice("");
    setCategoryItemIngredients([]);
  };

  const handleEditCategoryItem = (index: number) => {
    const item = categoryItems[index];
    setCategoryItemName(item.name);
    setCategoryItemPrice(item.price.toString());
    setCategoryItemIngredients(item.ingredients || []);
    setEditingCategoryItemIndex(index);
  };

  const handleRemoveCategoryItem = (id: string) => {
    setCategoryItems(categoryItems.filter(i => i.id !== id));
    if (editingCategoryItemIndex !== null) {
      setEditingCategoryItemIndex(null);
      setCategoryItemName("");
      setCategoryItemPrice("");
      setCategoryItemIngredients([]);
    }
  };

  const handleAddCategoryItemIngredient = () => {
    if (!selectedCategoryItemStockItem || !categoryItemIngredientQuantity) return;
    const stockItem = stockItems.find(s => s.id === selectedCategoryItemStockItem);
    if (!stockItem) return;
    
    setCategoryItemIngredients([...categoryItemIngredients, {
      id: novoId(),
      stock_item_id: selectedCategoryItemStockItem,
      quantity: parseFloat(categoryItemIngredientQuantity),
      stock_item_name: stockItem.name,
      stock_item_unit: stockItem.unit,
      stock_item_price: stockItem.price_per_unit
    }]);
    setSelectedCategoryItemStockItem("");
    setCategoryItemIngredientQuantity("");
  };

  const handleRemoveCategoryItemIngredient = (id: string) => {
    setCategoryItemIngredients(categoryItemIngredients.filter(i => i.id !== id));
  };

  const handleSaveExtraCategory = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!categoryName || categoryItems.length === 0) {
      toast.error("Preencha o nome da categoria e adicione pelo menos um item");
      return;
    }

    // Criar a categoria
    const { data: newCategory, error: categoryError } = await supabase
      .from("extra_categories")
      .insert({ name: categoryName, restaurant_id: restaurantId })
      .select()
      .single();

    if (categoryError) {
      toast.error("Erro ao criar categoria de adicionais");
      return;
    }

    // Inserir os itens da categoria
    const itemsData = categoryItems.map(item => ({
      category_id: newCategory.id,
      name: item.name,
      price: item.price
    }));

    const { data: insertedItems, error: itemsError } = await supabase
      .from("extra_category_items")
      .insert(itemsData)
      .select();

    if (itemsError) {
      toast.error("Erro ao adicionar itens da categoria");
      return;
    }

    // Inserir ingredientes dos itens
    if (insertedItems) {
      for (let i = 0; i < insertedItems.length; i++) {
        const item = categoryItems[i];
        if (item.ingredients && item.ingredients.length > 0) {
          const ingredientsData = item.ingredients.map(ing => ({
            category_item_id: insertedItems[i].id,
            stock_item_id: ing.stock_item_id,
            quantity: ing.quantity
          }));
          await supabase.from("extra_category_item_ingredients").insert(ingredientsData);
        }
      }
    }

    toast.success("Categoria de adicionais criada!");
    setCategoryName("");
    setCategoryItems([]);
    setCategoryItemIngredients([]);
    setEditingCategoryItemIndex(null);
    setExtraCategoryDialogOpen(false);
    fetchExtraCategories();
  };

  const handleLoadExtrasFromCategory = async (categoryId: string) => {
    const { data, error } = await supabase
      .from("extra_category_items")
      .select("*, extra_category_item_ingredients(*, stock_items(name, unit, price_per_unit))")
      .eq("category_id", categoryId);

    if (error) {
      toast.error("Erro ao carregar adicionais da categoria");
      return;
    }

    // Adicionar os itens da categoria aos extras do produto
    const newExtras = data.map(item => {
      const ingredients = item.extra_category_item_ingredients?.map((ing: any) => ({
        id: novoId(),
        stock_item_id: ing.stock_item_id,
        quantity: ing.quantity,
        stock_item_name: ing.stock_items?.name,
        stock_item_unit: ing.stock_items?.unit,
        stock_item_price: ing.stock_items?.price_per_unit
      })) || [];
      
      const cost = ingredients.reduce((sum: number, ing: any) => {
        return sum + (ing.quantity * (ing.stock_item_price || 0));
      }, 0);
      
      return {
        id: novoId(),
        name: item.name,
        price: item.price,
        ingredients,
        cost
      };
    });

    setExtras([...extras, ...newExtras]);
    toast.success("Adicionais adicionados!");
  };

  const handleDeleteExtraCategory = async (categoryId: string) => {
    const ok = await confirm({
      variant: "destructive",
      title: "Excluir categoria de complementos?",
      description: "Os complementos desta categoria serão removidos dos produtos.",
      consequence: "Esta ação não pode ser desfeita.",
    });
    if (!ok) return;

    const { error } = await supabase
      .from("extra_categories")
      .delete()
      .eq("id", categoryId);

    if (error) {
      toast.error("Erro ao excluir categoria");
      return;
    }

    toast.success("Categoria excluída!");
    fetchExtraCategories();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isRestaurantOpen) {
      toast.error("Feche o restaurante para modificar produtos");
      return;
    }

    if (!productCategoryId) {
      toast.error("Selecione uma categoria");
      return;
    }

    if (ingredients.length === 0) {
      toast.error("Adicione pelo menos 1 insumo ao produto");
      return;
    }

    // Validate PDV code uniqueness
    if (pdvCode) {
      const usedCodes = await getAllUsedPdvCodes(restaurantId);
      const codeNum = parseInt(pdvCode, 10);
      if (!isNaN(codeNum) && usedCodes.has(codeNum)) {
        if (!editingProduct || (editingProduct as any).pdv_code !== pdvCode) {
          toast.error(`Código PDV '${pdvCode}' já está em uso por outro item`);
          return;
        }
      }
    }

    let imageUrl = productImageUrl;

    // Upload da imagem se houver
    if (productImage) {
      const fileExt = productImage.name.split('.').pop();
      const fileName = `${novoId()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(fileName, productImage);

      if (uploadError) {
        toast.error("Erro ao fazer upload da imagem");
        return;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('product-images')
        .getPublicUrl(fileName);
      
      imageUrl = publicUrl;
    }

    const productData: any = {
      name: productName,
      description: productDescription,
      price: parseFloat(productPrice),
      category_id: productCategoryId,
      prep_time_minutes: productPrepTime ? parseInt(productPrepTime) : 30,
      image_url: imageUrl,
      pdv_code: pdvCode || null,
      fiscal_ncm: fiscalNcm || null,
      fiscal_exception: fiscalException || null,
      fiscal_cest: fiscalCest || null,
      fiscal_cfop: fiscalCfop || null,
      fiscal_icms_csosn: fiscalIcmsCsosn || null,
      fiscal_icms_origin: fiscalIcmsOrigin || "0",
      fiscal_pis_cst: fiscalPisCst || null,
      fiscal_pis_aliquota: fiscalPisAliquota ? parseFloat(fiscalPisAliquota) : null,
      fiscal_cofins_cst: fiscalCofinsCst || null,
      fiscal_cofins_aliquota: fiscalCofinsAliquota ? parseFloat(fiscalCofinsAliquota) : null,
      fiscal_ibs_aliquota: fiscalIbsAliquota ? parseFloat(fiscalIbsAliquota) : null,
      fiscal_cbs_aliquota: fiscalCbsAliquota ? parseFloat(fiscalCbsAliquota) : null,
      fiscal_beneficio_code: fiscalBeneficioCode || null,
      fiscal_indice_producao: fiscalIndiceProducao ? parseFloat(fiscalIndiceProducao) : null,
      fiscal_aliquota_transparencia: fiscalAliquotaTransparencia ? parseFloat(fiscalAliquotaTransparencia) : null,
    };

    if (editingProduct) {
      const { error } = await supabase
        .from("products")
        .update(productData)
        .eq("id", editingProduct.id);

      if (error) {
        toast.error("Erro ao atualizar produto");
        return;
      }

      // Deletar extras antigos e inserir novos
      await supabase.from("product_extras").delete().eq("product_id", editingProduct.id);
      
      if (extras.length > 0) {
        const extrasData = extras.map(extra => ({
          product_id: editingProduct.id,
          name: extra.name,
          price: extra.price
        }));
        const { data: insertedExtras } = await supabase
          .from("product_extras")
          .insert(extrasData)
          .select();
        
        // Inserir ingredientes dos extras
        if (insertedExtras) {
          for (let i = 0; i < insertedExtras.length; i++) {
            const extra = extras[i];
            if (extra.ingredients && extra.ingredients.length > 0) {
              const extraIngredientsData = extra.ingredients.map(ing => ({
                product_extra_id: insertedExtras[i].id,
                stock_item_id: ing.stock_item_id,
                quantity: ing.quantity
              }));
              await supabase.from("product_extra_ingredients").insert(extraIngredientsData);
            }
          }
        }
      }

      // Deletar ingredientes antigos e inserir novos
      await supabase.from("product_ingredients").delete().eq("product_id", editingProduct.id);
      
      if (ingredients.length > 0) {
        const ingredientsData = ingredients.map(ing => ({
          product_id: editingProduct.id,
          stock_item_id: ing.stock_item_id,
          quantity: ing.quantity
        }));
        await supabase.from("product_ingredients").insert(ingredientsData);
      }

      toast.success("Produto atualizado!");
    } else {
      const { data: newProduct, error } = await supabase
        .from("products")
        .insert(productData)
        .select()
        .single();

      if (error) {
        toast.error("Erro ao criar produto");
        return;
      }

      // Inserir extras
      if (extras.length > 0 && newProduct) {
        const extrasData = extras.map(extra => ({
          product_id: newProduct.id,
          name: extra.name,
          price: extra.price
        }));
        const { data: insertedExtras } = await supabase
          .from("product_extras")
          .insert(extrasData)
          .select();
        
        // Inserir ingredientes dos extras
        if (insertedExtras) {
          for (let i = 0; i < insertedExtras.length; i++) {
            const extra = extras[i];
            if (extra.ingredients && extra.ingredients.length > 0) {
              const extraIngredientsData = extra.ingredients.map(ing => ({
                product_extra_id: insertedExtras[i].id,
                stock_item_id: ing.stock_item_id,
                quantity: ing.quantity
              }));
              await supabase.from("product_extra_ingredients").insert(extraIngredientsData);
            }
          }
        }
      }

      // Inserir ingredientes
      if (ingredients.length > 0 && newProduct) {
        const ingredientsData = ingredients.map(ing => ({
          product_id: newProduct.id,
          stock_item_id: ing.stock_item_id,
          quantity: ing.quantity
        }));
        await supabase.from("product_ingredients").insert(ingredientsData);
      }

      toast.success("Produto criado!");
    }

    resetForm();
    fetchProducts();
  };

const handleDelete = async (id: string) => {
  if (isRestaurantOpen) {
    toast.error("Feche o restaurante para excluir produtos");
    return;
  }

  // Bloqueia exclusão se o produto está em pedidos ainda em andamento.
  // Diferente das outras confirmações, esta é uma trava dura: não dá pra
  // permitir mesmo que o usuário insista, pois apagar quebraria os pedidos.
  const check = await checkProductInActiveOrders(id);
  if (check.blocked) {
    toast.error(check.reason || "Produto está em pedidos ativos.");
    return;
  }

  const ok = await confirm({
    variant: "destructive",
    title: "Excluir produto permanentemente?",
    description: "O produto será removido do cardápio e do PDV.",
    consequence: "Esta ação não pode ser desfeita.",
  });
  if (!ok) return;

  try {
    const { error } = await supabase.rpc('admin_delete_product', {
      p_product_id: id,
      p_restaurant_id: restaurantId,
    });

    if (error) {
      console.error("Erro ao excluir produto:", error);
      toast.error(`Erro ao excluir produto: ${error.message}`);
      return;
    }

    setProducts((prev) => prev.filter((p) => p.id !== id));
    toast.success("Produto excluído permanentemente!");
  } catch (error) {
    console.error("Erro ao excluir produto:", error);
    toast.error("Erro ao excluir produto");
  }
};

  const openEditDialog = async (product: Product) => {
    if (isRestaurantOpen) {
      toast.error("Feche o restaurante para editar produtos");
      return;
    }
    setEditingProduct(product);
    setProductName(product.name);
    setProductDescription(product.description || "");
    setProductPrice(product.price.toString());
    setProductCategoryId(product.category_id);
    setProductPrepTime((product as any).prep_time_minutes?.toString() || "30");
    setProductImageUrl(product.image_url);
    
    // Load fiscal fields
    setPdvCode(product.pdv_code || "");
    setFiscalNcm(product.fiscal_ncm || "");
    setFiscalException(product.fiscal_exception || "");
    setFiscalCest(product.fiscal_cest || "");
    setFiscalCfop(product.fiscal_cfop || "");
    setFiscalIcmsCsosn(product.fiscal_icms_csosn || "");
    setFiscalIcmsOrigin(product.fiscal_icms_origin || "0");
    setFiscalPisCst(product.fiscal_pis_cst || "");
    setFiscalPisAliquota(product.fiscal_pis_aliquota?.toString() || "");
    setFiscalCofinsCst(product.fiscal_cofins_cst || "");
    setFiscalCofinsAliquota(product.fiscal_cofins_aliquota?.toString() || "");
    setFiscalIbsAliquota(product.fiscal_ibs_aliquota?.toString() || "");
    setFiscalCbsAliquota(product.fiscal_cbs_aliquota?.toString() || "");
    setFiscalBeneficioCode(product.fiscal_beneficio_code || "");
    setFiscalIndiceProducao(product.fiscal_indice_producao?.toString() || "");
    setFiscalAliquotaTransparencia(product.fiscal_aliquota_transparencia?.toString() || "");
    
    // Buscar extras do produto com ingredientes
    const { data: extrasData } = await supabase
      .from("product_extras")
      .select("*, product_extra_ingredients(*, stock_items(name, unit, price_per_unit))")
      .eq("product_id", product.id);
    
    const formattedExtras = extrasData?.map((extra: any) => {
      const ingredients = extra.product_extra_ingredients?.map((ing: any) => ({
        id: ing.id,
        stock_item_id: ing.stock_item_id,
        quantity: ing.quantity,
        stock_item_name: ing.stock_items?.name,
        stock_item_unit: ing.stock_items?.unit,
        stock_item_price: ing.stock_items?.price_per_unit
      })) || [];
      
      const cost = ingredients.reduce((sum: number, ing: any) => {
        return sum + (ing.quantity * (ing.stock_item_price || 0));
      }, 0);
      
      return {
        id: extra.id,
        name: extra.name,
        price: extra.price,
        ingredients,
        cost
      };
    }) || [];
    
    setExtras(formattedExtras);

    // Buscar ingredientes
    const { data: ingredientsData } = await supabase
      .from("product_ingredients")
      .select("*, stock_items(name, unit, price_per_unit)")
      .eq("product_id", product.id);
    
    const formattedIngredients = ingredientsData?.map((ing: any) => ({
      id: ing.id,
      stock_item_id: ing.stock_item_id,
      quantity: ing.quantity,
      stock_item_name: ing.stock_items?.name,
      stock_item_unit: ing.stock_items?.unit,
      stock_item_price: ing.stock_items?.price_per_unit
    })) || [];
    
    setIngredients(formattedIngredients);
    setDialogOpen(true);
  };

  const resetForm = () => {
    setDialogOpen(false);
    setProductName("");
    setProductDescription("");
    setProductPrice("");
    setProductCategoryId("");
    setProductPrepTime("");
    setProductImage(null);
    setProductImageUrl(null);
    setExtras([]);
    setExtraName("");
    setExtraPrice("");
    setExtraIngredients([]);
    setEditingExtraIndex(null);
    setIngredients([]);
    setSelectedStockItem("");
    setIngredientQuantity("");
    setEditingProduct(null);
    // Reset fiscal
    setPdvCode("");
    setFiscalNcm("");
    setFiscalException("");
    setFiscalCest("");
    setFiscalCfop("");
    setFiscalIcmsCsosn("");
    setFiscalIcmsOrigin("0");
    setFiscalPisCst("");
    setFiscalPisAliquota("");
    setFiscalCofinsCst("");
    setFiscalCofinsAliquota("");
    setFiscalIbsAliquota("");
    setFiscalCbsAliquota("");
    setFiscalBeneficioCode("");
    setFiscalIndiceProducao("");
    setFiscalAliquotaTransparencia("");
  };

  const calculateProductCost = () => {
    return ingredients.reduce((sum, ing) => {
      return sum + (ing.quantity * (ing.stock_item_price || 0));
    }, 0);
  };

  const productCost = calculateProductCost();
  const parsedProductPrice = parseFloat(productPrice) || 0;
  const cmvPercentage = parsedProductPrice > 0 ? (productCost / parsedProductPrice) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Seção de Categorias de Adicionais */}
      <Collapsible open={extraCategoriesOpen} onOpenChange={setExtraCategoriesOpen}>
        <Card>
          <CollapsibleTrigger className="w-full">
            <div className="flex items-center justify-between p-6 cursor-pointer hover:bg-muted/50 transition-colors">
              <h3 className="text-lg font-semibold">Categorias de Adicionais</h3>
              <ChevronDown className={`h-5 w-5 transition-transform ${extraCategoriesOpen ? 'rotate-180' : ''}`} />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-6 pb-6">
              <div className="flex justify-end items-center mb-4">
                <Dialog open={extraCategoryDialogOpen} onOpenChange={setExtraCategoryDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Nova Categoria
                  </Button>
                </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Nova Categoria de Adicionais</DialogTitle>
                <DialogDescription>
                  Crie uma categoria com adicionais que podem ser reutilizados em vários produtos
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSaveExtraCategory} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="category-name">Nome da Categoria</Label>
                  <Input
                    id="category-name"
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                    placeholder="Ex: Tamanhos, Sabores, Bebidas"
                    required
                  />
                </div>

                <div className="space-y-3 p-4 border rounded-lg bg-secondary/20">
                  <h4 className="font-semibold text-sm">Itens da Categoria</h4>
                  <p className="text-xs text-muted-foreground">Cada adicional deve ter pelo menos 1 insumo configurado</p>
                  
                  <div className="space-y-3 p-3 border rounded bg-primary/5">
                    <div className="flex items-center justify-between">
                      <h5 className="font-medium text-sm">{editingCategoryItemIndex !== null ? 'Editar Adicional' : 'Novo Adicional'}</h5>
                      {categoryItemIngredients.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Custo: <span className="font-semibold text-foreground">R$ {categoryItemIngredients.reduce((sum, ing) => sum + (ing.quantity * (ing.stock_item_price || 0)), 0).toFixed(2)}</span>
                        </p>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Input
                          placeholder="Nome do adicional"
                          value={categoryItemName}
                          onChange={(e) => setCategoryItemName(e.target.value)}
                        />
                      </div>
                      <div className="w-32">
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="Preço"
                          value={categoryItemPrice}
                          onChange={(e) => setCategoryItemPrice(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">Insumos do Adicional *</Label>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Select value={selectedCategoryItemStockItem} onValueChange={setSelectedCategoryItemStockItem}>
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Selecione um insumo" />
                            </SelectTrigger>
                            <SelectContent>
                              {stockItems.map((item) => (
                                <SelectItem key={item.id} value={item.id}>
                                  {item.name} ({item.unit}) - R$ {item.price_per_unit.toFixed(2)}/{item.unit}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Input
                          className="w-24 h-9"
                          type="number"
                          step="0.001"
                          placeholder="Qtd"
                          value={categoryItemIngredientQuantity}
                          onChange={(e) => setCategoryItemIngredientQuantity(e.target.value)}
                        />
                        <Button type="button" variant="outline" size="sm" onClick={handleAddCategoryItemIngredient}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>

                      {categoryItemIngredients.length > 0 && (
                        <div className="space-y-1 mt-2">
                          {[...categoryItemIngredients].sort((a, b) => (a.stock_item_name || "").localeCompare(b.stock_item_name || "", "pt-BR")).map((ing) => (
                            <div key={ing.id} className="flex items-center justify-between p-1.5 bg-background rounded text-xs">
                              <div className="flex-1">
                                <span className="font-medium">{ing.stock_item_name}</span>
                                <span className="text-muted-foreground ml-1">
                                  {ing.quantity} {ing.stock_item_unit} × R$ {ing.stock_item_price?.toFixed(2)} = R$ {(ing.quantity * (ing.stock_item_price || 0)).toFixed(2)}
                                </span>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => handleRemoveCategoryItemIngredient(ing.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <Button 
                      type="button" 
                      variant="secondary" 
                      size="sm" 
                      onClick={handleAddCategoryItem}
                      className="w-full"
                    >
                      {editingCategoryItemIndex !== null ? 'Atualizar Adicional' : 'Adicionar Adicional'}
                    </Button>
                  </div>

                  {categoryItems.length > 0 && (
                    <div className="space-y-2 mt-3">
                      <Label className="text-xs">Adicionais da Categoria:</Label>
                      {categoryItems.map((item, index) => (
                        <div key={item.id} className="flex items-center justify-between p-2 bg-background rounded border">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{item.name}</span>
                              <span className="text-xs text-muted-foreground">+ R$ {item.price.toFixed(2)}</span>
                            </div>
                            {item.cost !== undefined && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Custo: R$ {item.cost.toFixed(2)} | {item.ingredients?.length || 0} insumo(s)
                              </p>
                            )}
                            {(!item.ingredients || item.ingredients.length === 0) && (
                              <p className="text-xs text-amber-600 mt-0.5">⚠️ Configurar custo</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditCategoryItem(index)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveCategoryItem(item.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Button type="submit" className="w-full">
                  Salvar Categoria
                </Button>
              </form>
              </DialogContent>
            </Dialog>
          </div>

          {extraCategories.length > 0 && (
            <div className="space-y-2">
            {extraCategories.map((category) => (
              <div
                key={category.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-secondary/50 transition-colors"
              >
                <p className="font-medium">{category.name}</p>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDeleteExtraCategory(category.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              ))}
            </div>
          )}
        </div>
        </CollapsibleContent>
      </Card>
      </Collapsible>

      {/* Seção de Categorias de Produtos */}
      <Collapsible open={productCategoriesOpen} onOpenChange={setProductCategoriesOpen}>
        <Card>
          <CollapsibleTrigger className="w-full">
            <div className="flex items-center justify-between p-6 cursor-pointer hover:bg-muted/50 transition-colors">
              <h3 className="text-lg font-semibold">Categorias de Produtos</h3>
              <ChevronDown className={`h-5 w-5 transition-transform ${productCategoriesOpen ? 'rotate-180' : ''}`} />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-6 pb-6">
              <div className="flex justify-end items-center mb-4">
                <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Nova Categoria
                  </Button>
                </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova Categoria de Produto</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <Input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Nome da categoria"
                />
                <Button onClick={handleCreateCategory} className="w-full">Criar</Button>
              </div>
              </DialogContent>
            </Dialog>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {categories.map(cat => (
              <Card key={cat.id} className="p-2 text-center text-sm">{cat.name}</Card>
            ))}
          </div>
        </div>
        </CollapsibleContent>
      </Card>
      </Collapsible>

      {/* Seção de Produtos */}
      <Collapsible open={productsOpen} onOpenChange={setProductsOpen}>
        <Card>
          <CollapsibleTrigger className="w-full">
            <div className="flex items-center justify-between p-6 cursor-pointer hover:bg-muted/50 transition-colors">
              <h3 className="text-lg font-semibold">Produtos</h3>
              <ChevronDown className={`h-5 w-5 transition-transform ${productsOpen ? 'rotate-180' : ''}`} />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-6 pb-6">
              <div className="flex justify-end items-center mb-4 gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar produto..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 w-64"
              />
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => {
                if (isRestaurantOpen) {
                  toast.error("Feche o restaurante para adicionar produtos");
                  return;
                }
                resetForm();
              }}>
                <Plus className="h-4 w-4 mr-2" />
                Novo Produto
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingProduct ? "Editar Produto" : "Novo Produto"}
              </DialogTitle>
              <DialogDescription>
                {editingProduct
                  ? "Altere os dados do produto"
                  : "Adicione um novo produto ao cardápio"}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
            <Tabs defaultValue="produto">
              <TabsList className="mb-4">
                <TabsTrigger value="produto">Produto</TabsTrigger>
                <TabsTrigger value="fiscal">Fiscal</TabsTrigger>
              </TabsList>
              <TabsContent value="produto" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="product-name">Nome</Label>
                <Input
                  id="product-name"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="Ex: Pizza Margherita"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-description">Descrição</Label>
                <Textarea
                  id="product-description"
                  value={productDescription}
                  onChange={(e) => setProductDescription(e.target.value)}
                  placeholder="Descreva o produto..."
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-price">Preço (R$)</Label>
                <Input
                  id="product-price"
                  type="number"
                  step="0.01"
                  value={productPrice}
                  onChange={(e) => setProductPrice(e.target.value)}
                  placeholder="0.00"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-category">Categoria</Label>
                <Select value={productCategoryId} onValueChange={setProductCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-prep-time">Tempo de Preparo (minutos)</Label>
                <Input
                  id="product-prep-time"
                  type="number"
                  min="1"
                  value={productPrepTime}
                  onChange={(e) => setProductPrepTime(e.target.value)}
                  placeholder="30"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-image">Foto do Produto</Label>
                {productImageUrl && !productImage && (
                  <img src={productImageUrl} alt="Preview" className="w-32 h-32 object-cover rounded" />
                )}
                <Input
                  id="product-image"
                  type="file"
                  accept="image/*,image/webp,.webp,.jpg,.jpeg,.png,.gif"
                  onChange={(e) => setProductImage(e.target.files?.[0] || null)}
                />
              </div>

              {/* Seção de Insumos (Obrigatório) */}
              <div className="space-y-3 p-4 border rounded-lg bg-primary/10">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-sm">Insumos * (Obrigatório)</h4>
                  {productCost > 0 && (
                    <div className="text-sm space-y-1">
                      <p className="text-muted-foreground">Custo total: <span className="font-semibold text-foreground">R$ {productCost.toFixed(2)}</span></p>
                      {parsedProductPrice > 0 && (
                        <p className="text-muted-foreground">CMV: <span className={`font-semibold ${cmvPercentage > 35 ? 'text-destructive' : 'text-green-600'}`}>{cmvPercentage.toFixed(1)}%</span></p>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Select value={selectedStockItem} onValueChange={setSelectedStockItem}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um insumo" />
                      </SelectTrigger>
                      <SelectContent>
                        {stockItems.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name} ({item.unit}) - R$ {item.price_per_unit.toFixed(2)}/{item.unit}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-32">
                    <Input
                      type="number"
                      step="0.001"
                      placeholder="Qtd"
                      value={ingredientQuantity}
                      onChange={(e) => setIngredientQuantity(e.target.value)}
                    />
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={handleAddIngredient}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                
                {ingredients.length > 0 && (
                  <div className="space-y-2 mt-3">
                    {[...ingredients].sort((a, b) => (a.stock_item_name || "").localeCompare(b.stock_item_name || "", "pt-BR")).map((ing) => (
                      <div key={ing.id} className="flex items-center justify-between p-2 bg-background rounded">
                        <div className="flex-1">
                          <span className="text-sm font-medium">{ing.stock_item_name}</span>
                          <p className="text-xs text-muted-foreground">
                            {ing.quantity} {ing.stock_item_unit} × R$ {ing.stock_item_price?.toFixed(2)} = R$ {(ing.quantity * (ing.stock_item_price || 0)).toFixed(2)}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveIngredient(ing.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="space-y-3 p-4 border rounded-lg bg-secondary/20">
                <h4 className="font-semibold text-sm">Adicionais</h4>
                <p className="text-xs text-muted-foreground">Cada adicional deve ter pelo menos 1 insumo configurado</p>
                
                {extraCategories.length > 0 && (
                  <div className="space-y-2">
                    <Label>Ou selecione uma categoria de adicionais:</Label>
                    <Select onValueChange={handleLoadExtrasFromCategory}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione uma categoria" />
                      </SelectTrigger>
                      <SelectContent>
                        {extraCategories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-3 p-3 border rounded bg-primary/5">
                  <div className="flex items-center justify-between">
                    <h5 className="font-medium text-sm">{editingExtraIndex !== null ? 'Editar Adicional' : 'Novo Adicional'}</h5>
                    {extraIngredients.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Custo: <span className="font-semibold text-foreground">R$ {extraIngredients.reduce((sum, ing) => sum + (ing.quantity * (ing.stock_item_price || 0)), 0).toFixed(2)}</span>
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Input
                        placeholder="Nome do adicional"
                        value={extraName}
                        onChange={(e) => setExtraName(e.target.value)}
                      />
                    </div>
                    <div className="w-32">
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Preço"
                        value={extraPrice}
                        onChange={(e) => setExtraPrice(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Insumos do Adicional *</Label>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Select value={selectedExtraStockItem} onValueChange={setSelectedExtraStockItem}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Selecione um insumo" />
                          </SelectTrigger>
                          <SelectContent>
                            {stockItems.map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {item.name} ({item.unit}) - R$ {item.price_per_unit.toFixed(2)}/{item.unit}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Input
                        className="w-24 h-9"
                        type="number"
                        step="0.001"
                        placeholder="Qtd"
                        value={extraIngredientQuantity}
                        onChange={(e) => setExtraIngredientQuantity(e.target.value)}
                      />
                      <Button type="button" variant="outline" size="sm" onClick={handleAddExtraIngredient}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>

                    {extraIngredients.length > 0 && (
                      <div className="space-y-1 mt-2">
                        {[...extraIngredients].sort((a, b) => (a.stock_item_name || "").localeCompare(b.stock_item_name || "", "pt-BR")).map((ing) => (
                          <div key={ing.id} className="flex items-center justify-between p-1.5 bg-background rounded text-xs">
                            <div className="flex-1">
                              <span className="font-medium">{ing.stock_item_name}</span>
                              <span className="text-muted-foreground ml-1">
                                {ing.quantity} {ing.stock_item_unit} × R$ {ing.stock_item_price?.toFixed(2)} = R$ {(ing.quantity * (ing.stock_item_price || 0)).toFixed(2)}
                              </span>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => handleRemoveExtraIngredient(ing.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <Button 
                    type="button" 
                    variant="secondary" 
                    size="sm" 
                    onClick={handleAddExtra}
                    className="w-full"
                  >
                    {editingExtraIndex !== null ? 'Atualizar Adicional' : 'Adicionar Adicional'}
                  </Button>
                </div>
                
                {extras.length > 0 && (
                  <div className="space-y-2 mt-3">
                    <Label className="text-xs">Adicionais do Produto:</Label>
                    {extras.map((extra, index) => (
                      <div key={extra.id} className="flex items-center justify-between p-2 bg-background rounded border">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{extra.name}</span>
                            <span className="text-xs text-muted-foreground">+ R$ {extra.price.toFixed(2)}</span>
                          </div>
                          {extra.cost !== undefined && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Custo: R$ {extra.cost.toFixed(2)} | {extra.ingredients?.length || 0} insumo(s)
                            </p>
                          )}
                          {(!extra.ingredients || extra.ingredients.length === 0) && (
                            <p className="text-xs text-amber-600 mt-0.5">⚠️ Configurar custo</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditExtra(index)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveExtra(extra.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </TabsContent>
              <TabsContent value="fiscal" className="space-y-4">
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
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Código PDV</Label>
                    <Input value={pdvCode} onChange={(e) => setPdvCode(e.target.value)} placeholder="Ex: 001" />
                  </div>
                  <div className="space-y-2">
                    <Label>NCM</Label>
                    <Input value={fiscalNcm} onChange={(e) => setFiscalNcm(e.target.value)} placeholder="Ex: 21069090" />
                  </div>
                  <div className="space-y-2">
                    <Label>Exceção TIPI</Label>
                    <Input value={fiscalException} onChange={(e) => setFiscalException(e.target.value)} placeholder="Ex: 01" />
                  </div>
                  <div className="space-y-2">
                    <Label>CEST</Label>
                    <Input value={fiscalCest} onChange={(e) => setFiscalCest(e.target.value)} placeholder="Ex: 0300100" />
                  </div>
                  <div className="space-y-2">
                    <Label>CFOP</Label>
                    <Input value={fiscalCfop} onChange={(e) => setFiscalCfop(e.target.value)} placeholder="Ex: 5102" />
                  </div>
                  <div className="space-y-2">
                    <Label>Alíquota Transparência (%)</Label>
                    <Input type="number" step="0.01" value={fiscalAliquotaTransparencia} onChange={(e) => setFiscalAliquotaTransparencia(e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="space-y-2">
                    <Label>Código Benefício Fiscal</Label>
                    <Input value={fiscalBeneficioCode} onChange={(e) => setFiscalBeneficioCode(e.target.value)} placeholder="" />
                  </div>
                  <div className="space-y-2">
                    <Label>Índice de Produção</Label>
                    <Input type="number" step="0.01" value={fiscalIndiceProducao} onChange={(e) => setFiscalIndiceProducao(e.target.value)} placeholder="0.00" />
                  </div>
                </div>
                <h4 className="font-semibold text-sm mt-4">ICMS</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Situação Tributária (CSOSN)</Label>
                    <Input value={fiscalIcmsCsosn} onChange={(e) => setFiscalIcmsCsosn(e.target.value)} placeholder="Ex: 102" />
                  </div>
                  <div className="space-y-2">
                    <Label>Origem</Label>
                    <Input value={fiscalIcmsOrigin} onChange={(e) => setFiscalIcmsOrigin(e.target.value)} placeholder="0" />
                  </div>
                </div>
                <h4 className="font-semibold text-sm mt-4">IBS / CBS</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Alíquota IBS (%)</Label>
                    <Input type="number" step="0.01" value={fiscalIbsAliquota} onChange={(e) => setFiscalIbsAliquota(e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="space-y-2">
                    <Label>Alíquota CBS (%)</Label>
                    <Input type="number" step="0.01" value={fiscalCbsAliquota} onChange={(e) => setFiscalCbsAliquota(e.target.value)} placeholder="0.00" />
                  </div>
                </div>
                <h4 className="font-semibold text-sm mt-4">PIS / COFINS</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Situação Tributária PIS</Label>
                    <Input value={fiscalPisCst} onChange={(e) => setFiscalPisCst(e.target.value)} placeholder="Ex: 49" />
                  </div>
                  <div className="space-y-2">
                    <Label>Alíquota PIS (%)</Label>
                    <Input type="number" step="0.01" value={fiscalPisAliquota} onChange={(e) => setFiscalPisAliquota(e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="space-y-2">
                    <Label>Situação Tributária COFINS</Label>
                    <Input value={fiscalCofinsCst} onChange={(e) => setFiscalCofinsCst(e.target.value)} placeholder="Ex: 49" />
                  </div>
                  <div className="space-y-2">
                    <Label>Alíquota COFINS (%)</Label>
                    <Input type="number" step="0.01" value={fiscalCofinsAliquota} onChange={(e) => setFiscalCofinsAliquota(e.target.value)} placeholder="0.00" />
                  </div>
                </div>
              </TabsContent>
              </Tabs>

              <Button type="submit" className="w-full">
                {editingProduct ? "Atualizar" : "Criar"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
          </div>

          {categories.length === 0 ? (
            <div className="text-center py-12 border rounded-lg bg-secondary/20">
              <p className="text-muted-foreground">
                Crie categorias primeiro antes de adicionar produtos
              </p>
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-12 border rounded-lg bg-secondary/20">
              <p className="text-muted-foreground">Nenhum produto criado ainda</p>
            </div>
          ) : (
            <div className="max-h-[500px] overflow-y-auto space-y-2 pr-2">
          {products
              .filter((product) =>
                normalizeSearch(product.name).includes(normalizeSearch(searchQuery))
              )
              .map((product) => (
                <div
                  key={product.id}
                  className={`flex items-center justify-between p-4 border rounded-lg hover:bg-secondary/50 transition-colors ${!product.available ? "opacity-50" : ""}`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{product.name}</p>
                      {!product.available && <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">Esgotado</span>}
                    </div>
                    <p className="text-sm text-muted-foreground">{product.description}</p>
                    <p className="text-sm font-semibold text-primary mt-1">
                      R$ {product.price.toFixed(2)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      className="h-4 w-8 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-4"
                      checked={product.available}
                      onCheckedChange={async (checked) => {
                        await supabase.from("products").update({ available: checked }).eq("id", product.id);
                      }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditDialog(product)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(product.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </CollapsibleContent>
      </Card>
      </Collapsible>

      {/* Ofertas da Sacola (upsell por produto) */}
      <UpsellManagerCard restaurantId={restaurantId} />
    </div>
  );
};

export default ProductsTab;

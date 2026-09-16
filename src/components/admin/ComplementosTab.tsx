import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Search, Edit2, Trash2, Package, ChevronDown, ChevronUp, Camera, Copy } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { generateNextPdvCode, getAllUsedPdvCodes } from "@/lib/pdvCodeGenerator";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { normalizeSearch } from "@/lib/searchNormalize";

import { novoId } from "@/lib/uuid";
interface StockItem { id: string; name: string; unit: string; price_per_unit: number; }
interface CategoryItemIngredient { id: string; stock_item_id: string; quantity: number; stock_item_name?: string; stock_item_unit?: string; stock_item_price?: number; }
interface CategoryItem { id: string; name: string; price: number; pdv_code?: string; ingredients: CategoryItemIngredient[]; is_active?: boolean | null; }
interface ComplementCategory { id: string; name: string; items: CategoryItem[]; is_active?: boolean | null; is_required?: boolean; min_quantity?: number; max_quantity?: number; }
interface SimpleProduct { id: string; name: string; category_id?: string; }
interface SimpleCategory { id: string; name: string; product_count: number; }
interface ComplementosTabProps { restaurantId: string; isRestaurantOpen: boolean; onOpenDigitizer?: () => void; }

const ComplementosTab = ({ restaurantId, isRestaurantOpen, onOpenDigitizer }: ComplementosTabProps) => {
  const [categories, setCategories] = useState<ComplementCategory[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ComplementCategory | null>(null);
  const [editingItem, setEditingItem] = useState<CategoryItem | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<ComplementCategory | null>(null);

  const [categoryName, setCategoryName] = useState("");
  const [categoryIsRequired, setCategoryIsRequired] = useState(false);
  const [categoryMinQty, setCategoryMinQty] = useState("0");
  const [categoryMaxQty, setCategoryMaxQty] = useState("0");
  const [allProducts, setAllProducts] = useState<SimpleProduct[]>([]);
  const [menuCategories, setMenuCategories] = useState<SimpleCategory[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [originalProductIds, setOriginalProductIds] = useState<Set<string>>(new Set());
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [linkMode, setLinkMode] = useState<'products' | 'category'>('products');
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set());
  const [itemName, setItemName] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [itemPdvCode, setItemPdvCode] = useState("");
  const [itemIngredients, setItemIngredients] = useState<CategoryItemIngredient[]>([]);
  const [selectedStockItem, setSelectedStockItem] = useState("");
  const [ingredientQuantity, setIngredientQuantity] = useState("");

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  useEffect(() => { fetchCategories(); fetchStockItems(); fetchAllProducts(); }, [restaurantId]);

  const fetchAllProducts = async () => {
    const { data } = await supabase.from("products").select("id, name, category_id, categories!inner(restaurant_id)").eq("categories.restaurant_id", restaurantId).order("name");
    setAllProducts((data || []).map((p: any) => ({ id: p.id, name: p.name, category_id: p.category_id })));
    // Build menu categories with product counts
    const catMap = new Map<string, { name: string; count: number }>();
    const { data: cats } = await supabase.from("categories").select("id, name").eq("restaurant_id", restaurantId).eq("is_active", true).order("display_order");
    (cats || []).forEach((c: any) => catMap.set(c.id, { name: c.name, count: 0 }));
    (data || []).forEach((p: any) => {
      if (p.category_id && catMap.has(p.category_id)) {
        catMap.get(p.category_id)!.count++;
      }
    });
    setMenuCategories(Array.from(catMap.entries()).map(([id, v]) => ({ id, name: v.name, product_count: v.count })));
  };

  const fetchStockItems = async () => {
    const { data } = await supabase.from("stock_items").select("id, name, unit, price_per_unit").eq("restaurant_id", restaurantId).order("name");
    setStockItems((data || []).sort((a, b) => (a.name || "").localeCompare(b.name || "", "pt-BR")));
  };

  const fetchCategories = async () => {
    setLoading(true);
    const { data: categoriesData } = await supabase.from("extra_categories").select("*").eq("restaurant_id", restaurantId).order("name");
    if (!categoriesData) { setCategories([]); setLoading(false); return; }

    const categoriesWithItems = await Promise.all(
      categoriesData.map(async (cat) => {
        const { data: itemsData } = await supabase.from("extra_category_items").select("*, extra_category_item_ingredients(*, stock_items(name, unit, price_per_unit))").eq("category_id", cat.id);
        const items = (itemsData || []).map((item: any) => ({
          id: item.id, name: item.name, price: item.price, pdv_code: item.pdv_code || "", is_active: (item as any).is_active,
          ingredients: (item.extra_category_item_ingredients || []).map((ing: any) => ({
            id: ing.id, stock_item_id: ing.stock_item_id, quantity: ing.quantity,
            stock_item_name: ing.stock_items?.name, stock_item_unit: ing.stock_items?.unit, stock_item_price: ing.stock_items?.price_per_unit,
          })),
        }));
        return { id: cat.id, name: cat.name, is_active: (cat as any).is_active, is_required: (cat as any).is_required, min_quantity: (cat as any).min_quantity, max_quantity: (cat as any).max_quantity, items };
      })
    );
    setCategories(categoriesWithItems);
    setLoading(false);
  };

  // (syncCategoryToProducts removed — linking now uses product_complement_groups)

  const handleSaveCategory = async () => {
    if (!categoryName.trim()) { toast.error("Digite o nome da categoria"); return; }
    const minQ = parseInt(categoryMinQty) || 0;
    const maxQ = parseInt(categoryMaxQty) || 0;
    let categoryId = editingCategory?.id;
    if (editingCategory) {
      const { error } = await supabase.from("extra_categories").update({ name: categoryName, is_required: categoryIsRequired, min_quantity: minQ, max_quantity: maxQ } as any).eq("id", editingCategory.id);
      if (error) { toast.error("Erro ao atualizar categoria"); return; }
      // Propagate to all linked product_complement_groups
      await supabase.from("product_complement_groups").update({ is_required: categoryIsRequired, min_selection: minQ, max_selection: maxQ || null } as any).eq("extra_category_id", editingCategory.id);
    } else {
      const { data, error } = await supabase.from("extra_categories").insert({ name: categoryName, restaurant_id: restaurantId, is_required: categoryIsRequired, min_quantity: minQ, max_quantity: maxQ } as any).select().single();
      if (error || !data) { toast.error("Erro ao criar categoria"); return; }
      categoryId = data.id;
    }

    // Sync product links via product_complement_groups
    if (categoryId) {
      const productsToAdd = [...selectedProductIds].filter(id => !originalProductIds.has(id));
      const productsToRemove = [...originalProductIds].filter(id => !selectedProductIds.has(id));

      // Remove deselected products from product_complement_groups
      if (productsToRemove.length > 0) {
        await supabase.from("product_complement_groups").delete()
          .eq("extra_category_id", categoryId)
          .in("product_id", productsToRemove);
      }

      // Add newly selected products to product_complement_groups
      if (productsToAdd.length > 0) {
        // Get max display_order for each product to append at the end
        const groupsInserts = productsToAdd.map(productId => ({
          product_id: productId,
          extra_category_id: categoryId!,
          is_required: categoryIsRequired,
          min_selection: minQ,
          max_selection: maxQ || null,
          display_order: 999,
        }));
        await supabase.from("product_complement_groups").insert(groupsInserts);
      }
    }

    toast.success(editingCategory ? "Categoria atualizada!" : "Categoria criada!");
    resetCategoryForm(); fetchCategories();
  };

  const handleDeleteCategory = async () => {
    if (!deletingCategory) return;
    // Delete product_complement_groups for this category
    await supabase.from("product_complement_groups").delete().eq("extra_category_id", deletingCategory.id);
    // Delete legacy product_extras if any
    const { data: extrasToClean } = await supabase
      .from("product_extras")
      .select("id")
      .eq("extra_category_id", deletingCategory.id);
    if (extrasToClean && extrasToClean.length > 0) {
      await supabase.from("product_extra_ingredients").delete().in("product_extra_id", extrasToClean.map((e: any) => e.id));
    }
    await supabase.from("product_extras").delete().eq("extra_category_id", deletingCategory.id);
    for (const item of deletingCategory.items) { await supabase.from("extra_category_item_ingredients").delete().eq("category_item_id", item.id); }
    await supabase.from("extra_category_items").delete().eq("category_id", deletingCategory.id);
    const { error } = await supabase.from("extra_categories").delete().eq("id", deletingCategory.id);
    if (error) { toast.error("Erro ao excluir categoria"); return; }
    toast.success("Categoria excluída!");
    setDeleteDialogOpen(false); setDeletingCategory(null); fetchCategories();
  };

  const handleDuplicateCategory = async (category: ComplementCategory) => {
    if (isRestaurantOpen) { toast.error("Feche o restaurante para duplicar"); return; }
    try {
      const { data: newCat, error: catErr } = await supabase.from("extra_categories").insert({
        name: `${category.name} (cópia)`,
        restaurant_id: restaurantId,
        is_required: category.is_required,
        min_quantity: category.min_quantity || 0,
        max_quantity: category.max_quantity || 0,
        is_active: category.is_active,
      } as any).select().single();
      if (catErr || !newCat) { toast.error("Erro ao duplicar categoria"); return; }

      const usedCodes = await getAllUsedPdvCodes(restaurantId);
      let nextCode = 1;
      const getNextCode = () => {
        while (usedCodes.has(nextCode)) nextCode++;
        const code = String(nextCode).padStart(3, "0");
        usedCodes.add(nextCode);
        nextCode++;
        return code;
      };

      for (const item of category.items) {
        const newPdvCode = getNextCode();
        const { data: newItem } = await supabase.from("extra_category_items").insert({
          category_id: newCat.id,
          name: item.name,
          price: item.price,
          pdv_code: newPdvCode,
          is_active: item.is_active,
        } as any).select().single();

        if (newItem && item.ingredients.length > 0) {
          await supabase.from("extra_category_item_ingredients").insert(
            item.ingredients.map(ing => ({
              category_item_id: newItem.id,
              stock_item_id: ing.stock_item_id,
              quantity: ing.quantity,
            }))
          );
        }
      }

      const { data: linkedGroups } = await supabase
        .from("product_complement_groups")
        .select("product_id, is_required, min_selection, max_selection, display_order")
        .eq("extra_category_id", category.id);
      if (linkedGroups && linkedGroups.length > 0) {
        await supabase.from("product_complement_groups").insert(
          linkedGroups.map((g: any) => ({
            product_id: g.product_id,
            extra_category_id: newCat.id,
            is_required: g.is_required,
            min_selection: g.min_selection,
            max_selection: g.max_selection,
            display_order: g.display_order,
          }))
        );
      }

      toast.success("Categoria duplicada com sucesso!");
      fetchCategories();
    } catch (err) {
      toast.error("Erro ao duplicar categoria");
    }
  };

  const handleAddIngredient = () => {
    if (!selectedStockItem || !ingredientQuantity) return;
    const stockItem = stockItems.find(s => s.id === selectedStockItem);
    if (!stockItem) return;
    setItemIngredients([...itemIngredients, {
      id: novoId(), stock_item_id: selectedStockItem, quantity: parseFloat(ingredientQuantity),
      stock_item_name: stockItem.name, stock_item_unit: stockItem.unit, stock_item_price: stockItem.price_per_unit,
    }]);
    setSelectedStockItem(""); setIngredientQuantity("");
  };

  const handleRemoveIngredient = (id: string) => { setItemIngredients(itemIngredients.filter(i => i.id !== id)); };

  const handleSaveItem = async () => {
    if (!itemName.trim() || !selectedCategoryId) { toast.error("Preencha o nome do item"); return; }

    // Validate PDV code uniqueness before saving
    const codeToCheck = editingItem ? (itemPdvCode || null) : (itemPdvCode || await generateNextPdvCode(restaurantId));
    if (codeToCheck) {
      const usedCodes = await getAllUsedPdvCodes(restaurantId);
      const codeNum = parseInt(codeToCheck, 10);
      if (!isNaN(codeNum) && usedCodes.has(codeNum)) {
        if (!editingItem || editingItem.pdv_code !== codeToCheck) {
          toast.error(`Código PDV '${codeToCheck}' já está em uso por outro item`);
          return;
        }
      }
    }

    if (editingItem) {
      const { error } = await supabase.from("extra_category_items").update({ name: itemName, price: parseFloat(itemPrice) || 0, pdv_code: itemPdvCode || null } as any).eq("id", editingItem.id);
      if (error) { toast.error("Erro ao atualizar item"); return; }
      await supabase.from("extra_category_item_ingredients").delete().eq("category_item_id", editingItem.id);
      if (itemIngredients.length > 0) {
        await supabase.from("extra_category_item_ingredients").insert(itemIngredients.map(ing => ({ category_item_id: editingItem.id, stock_item_id: ing.stock_item_id, quantity: ing.quantity })));
      }
      toast.success("Item atualizado!");
    } else {
      const finalPdvCode = codeToCheck;
      const { data: newItem, error } = await supabase.from("extra_category_items").insert({ category_id: selectedCategoryId, name: itemName, price: parseFloat(itemPrice) || 0, pdv_code: finalPdvCode } as any).select().single();
      if (error) { toast.error("Erro ao criar item"); return; }
      if (newItem && itemIngredients.length > 0) {
        await supabase.from("extra_category_item_ingredients").insert(itemIngredients.map(ing => ({ category_item_id: newItem.id, stock_item_id: ing.stock_item_id, quantity: ing.quantity })));
      }
      toast.success("Item criado!");
    }
    resetItemForm(); fetchCategories();
  };

  const handleDeleteItem = async (item: CategoryItem, categoryId: string) => {
    await supabase.from("extra_category_item_ingredients").delete().eq("category_item_id", item.id);
    const { error } = await supabase.from("extra_category_items").delete().eq("id", item.id);
    if (error) { toast.error("Erro ao excluir item"); return; }
    toast.success("Item excluído!"); fetchCategories();
  };

  const openEditCategory = async (category: ComplementCategory) => {
    if (isRestaurantOpen) { toast.error("Feche o restaurante para editar"); return; }
    setEditingCategory(category); setCategoryName(category.name);
    setCategoryIsRequired(category.is_required || false);
    setCategoryMinQty(String(category.min_quantity || 0));
    setCategoryMaxQty(String(category.max_quantity || 0));
    // Load linked products from product_complement_groups
    const { data: linkedGroups } = await supabase.from("product_complement_groups").select("product_id").eq("extra_category_id", category.id);
    const linkedIds = new Set((linkedGroups || []).map((g: any) => g.product_id as string));
    setSelectedProductIds(linkedIds);
    setOriginalProductIds(new Set(linkedIds));
    setProductSearchQuery("");
    setLinkMode('products');
    // Detect which menu categories are fully selected
    const catIds = new Set<string>();
    menuCategories.forEach(cat => {
      const prodsInCat = allProducts.filter(p => p.category_id === cat.id);
      if (prodsInCat.length > 0 && prodsInCat.every(p => linkedIds.has(p.id))) {
        catIds.add(cat.id);
      }
    });
    setSelectedCategoryIds(catIds);
    setCategoryDialogOpen(true);
  };

  const openNewCategory = () => {
    if (isRestaurantOpen) { toast.error("Feche o restaurante para adicionar"); return; }
    resetCategoryForm(); setCategoryDialogOpen(true);
  };

  const openEditItem = (item: CategoryItem, categoryId: string) => {
    if (isRestaurantOpen) { toast.error("Feche o restaurante para editar"); return; }
    setEditingItem(item); setSelectedCategoryId(categoryId);
    setItemName(item.name); setItemPrice(item.price.toString()); setItemPdvCode(item.pdv_code || "");
    setItemIngredients([...item.ingredients]); setItemDialogOpen(true);
  };

  const openNewItem = (categoryId: string) => {
    if (isRestaurantOpen) { toast.error("Feche o restaurante para adicionar"); return; }
    resetItemForm(); setSelectedCategoryId(categoryId); setItemDialogOpen(true);
  };

  const resetCategoryForm = () => {
    setCategoryDialogOpen(false); setEditingCategory(null); setCategoryName("");
    setCategoryIsRequired(false); setCategoryMinQty("0"); setCategoryMaxQty("0");
    setSelectedProductIds(new Set()); setOriginalProductIds(new Set()); setProductSearchQuery("");
    setLinkMode('products'); setSelectedCategoryIds(new Set());
  };

  const toggleProductSelection = (productId: string) => {
    const newSet = new Set(selectedProductIds);
    if (newSet.has(productId)) newSet.delete(productId); else newSet.add(productId);
    setSelectedProductIds(newSet);
  };

  const toggleMenuCategory = (categoryId: string, checked: boolean) => {
    const newSet = new Set(selectedCategoryIds);
    const newProducts = new Set(selectedProductIds);
    const productsInCat = allProducts.filter(p => p.category_id === categoryId);
    if (checked) {
      newSet.add(categoryId);
      productsInCat.forEach(p => newProducts.add(p.id));
    } else {
      newSet.delete(categoryId);
      productsInCat.forEach(p => newProducts.delete(p.id));
    }
    setSelectedCategoryIds(newSet);
    setSelectedProductIds(newProducts);
  };
  const resetItemForm = () => {
    setItemDialogOpen(false); setEditingItem(null); setSelectedCategoryId(null);
    setItemName(""); setItemPrice(""); setItemPdvCode(""); setItemIngredients([]);
    setSelectedStockItem(""); setIngredientQuantity("");
  };

  const toggleCategory = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) newExpanded.delete(categoryId); else newExpanded.add(categoryId);
    setExpandedCategories(newExpanded);
  };

  const filteredCategories = categories.filter(cat =>
    normalizeSearch(cat.name).includes(normalizeSearch(searchQuery)) ||
    cat.items.some(item => normalizeSearch(item.name).includes(normalizeSearch(searchQuery)))
  );

  const calculateItemCost = (ingredients: CategoryItemIngredient[]) => ingredients.reduce((sum, ing) => sum + (ing.quantity * (ing.stock_item_price || 0)), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar categorias ou itens..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
        </div>
        <div className="flex items-center gap-2">
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
          <Button onClick={openNewCategory}><Plus className="h-4 w-4 mr-2" />Nova Categoria</Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16"><p className="text-muted-foreground">Carregando...</p></div>
      ) : filteredCategories.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-xl bg-muted/20">
          <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-2">{searchQuery ? "Nenhuma categoria encontrada" : "Nenhuma categoria de complementos"}</p>
          <p className="text-sm text-muted-foreground">Crie categorias como "Tamanhos", "Molhos" ou "Acompanhamentos"</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredCategories.map((category) => (
            <Card key={category.id} className={`overflow-hidden ${category.is_active === false ? "opacity-50" : ""}`}>
              <Collapsible open={expandedCategories.has(category.id)} onOpenChange={() => toggleCategory(category.id)}>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {expandedCategories.has(category.id) ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
                        <CardTitle className="text-lg">{category.name}</CardTitle>
                        <span className="text-sm text-muted-foreground">({category.items.length} {category.items.length === 1 ? "item" : "itens"})</span>
                        {category.is_required && (
                          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Obrigatório</span>
                        )}
                        {(category.min_quantity || category.max_quantity) ? (
                          <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                            {category.min_quantity ? `Mín: ${category.min_quantity}` : ""}{category.min_quantity && category.max_quantity ? " · " : ""}{category.max_quantity ? `Máx: ${category.max_quantity}` : ""}
                          </span>
                        ) : null}
                        {category.is_active === false && (
                          <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">Inativo</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          className="h-4 w-8 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-4"
                          checked={category.is_active !== false}
                          onCheckedChange={async (checked) => {
                            await supabase.from("extra_categories").update({ is_active: checked } as any).eq("id", category.id);
                            fetchCategories();
                          }}
                        />
                        <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); openEditCategory(category); }} title="Editar"><Edit2 className="h-4 w-4" /></Button>
                        <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleDuplicateCategory(category); }} title="Duplicar"><Copy className="h-4 w-4" /></Button>
                        <Button variant="destructive" size="sm" onClick={(e) => { e.stopPropagation(); if (isRestaurantOpen) { toast.error("Feche o restaurante para excluir"); return; } setDeletingCategory(category); setDeleteDialogOpen(true); }} title="Excluir"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <div className="space-y-2">
                      {category.items.map((item) => {
                        const cost = calculateItemCost(item.ingredients);
                        return (
                          <div key={item.id} className={`flex items-center justify-between p-3 bg-muted/30 rounded-lg ${item.is_active === false ? "opacity-50" : ""}`}>
                             <div className="flex-1">
                               <div className="flex items-center gap-3">
                                 <span className="font-medium">{item.name}</span>
                                 <span className="text-primary font-semibold">R$ {item.price.toFixed(2)}</span>
                                 {item.pdv_code && <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">PDV: {item.pdv_code}</span>}
                                 {item.is_active === false && <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">Inativo</span>}
                               </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {item.ingredients.length > 0 ? (
                                  <>{[...item.ingredients].sort((a, b) => (a.stock_item_name || "").localeCompare(b.stock_item_name || "", "pt-BR")).map(ing => `${ing.stock_item_name} (${ing.quantity} ${ing.stock_item_unit})`).join(", ")}<span className="ml-2">• Custo: R$ {cost.toFixed(2)}</span></>
                                ) : ("Sem insumos vinculados")}
                              </div>
                            </div>
                             <div className="flex items-center gap-2">
                               <Switch
                                 className="h-4 w-8 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-4"
                                 checked={item.is_active !== false}
                                 onCheckedChange={async (checked) => {
                                   await supabase.from("extra_category_items").update({ is_active: checked } as any).eq("id", item.id);
                                   fetchCategories();
                                 }}
                               />
                               <Button variant="ghost" size="sm" onClick={() => openEditItem(item, category.id)}><Edit2 className="h-4 w-4" /></Button>
                               <Button variant="ghost" size="sm" onClick={() => { if (isRestaurantOpen) { toast.error("Feche o restaurante para excluir"); return; } handleDeleteItem(item, category.id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                             </div>
                          </div>
                        );
                      })}
                      <Button variant="outline" className="w-full mt-2" onClick={() => openNewItem(category.id)}><Plus className="h-4 w-4 mr-2" />Adicionar Item</Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          ))}
        </div>
      )}

      {/* Category Dialog */}
      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingCategory ? "Editar Categoria" : "Nova Categoria de Complementos"}</DialogTitle>
            <DialogDescription>Categorias agrupam complementos similares (ex: Tamanhos, Molhos)</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label htmlFor="category-name">Nome da Categoria *</Label><Input id="category-name" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="Ex: Tamanhos, Molhos, Acompanhamentos" /></div>

            <div className="p-4 border rounded-xl bg-muted/20 space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="cat-required" className="cursor-pointer">Obrigatório</Label>
                <Switch id="cat-required" checked={categoryIsRequired} onCheckedChange={setCategoryIsRequired} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="cat-min">Mínimo de seleções</Label>
                  <Input id="cat-min" type="number" min="0" value={categoryMinQty} onChange={(e) => setCategoryMinQty(e.target.value)} placeholder="0" />
                </div>
                <div>
                  <Label htmlFor="cat-max">Máximo de seleções</Label>
                  <Input id="cat-max" type="number" min="0" value={categoryMaxQty} onChange={(e) => setCategoryMaxQty(e.target.value)} placeholder="0 = ilimitado" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Máximo 0 = ilimitado. Essas regras serão aplicadas a todos os produtos vinculados.</p>
            </div>

            <div className="space-y-3">
              <Label>Vincular produtos por</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={linkMode === 'products' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setLinkMode('products')}
                >
                  Produtos avulsos
                </Button>
                <Button
                  type="button"
                  variant={linkMode === 'category' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setLinkMode('category')}
                >
                  Por categoria
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedProductIds.size} produto{selectedProductIds.size !== 1 ? 's' : ''} vinculado{selectedProductIds.size !== 1 ? 's' : ''}
              </p>

              {linkMode === 'products' && (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Buscar produtos..." value={productSearchQuery} onChange={(e) => setProductSearchQuery(e.target.value)} className="pl-9" />
                  </div>
                  <ScrollArea className="h-48 border rounded-lg">
                    <div className="p-2 space-y-1">
                      {allProducts
                        .filter(p => normalizeSearch(p.name).includes(normalizeSearch(productSearchQuery)))
                        .map(product => (
                          <label key={product.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer text-sm">
                            <Checkbox
                              checked={selectedProductIds.has(product.id)}
                              onCheckedChange={() => toggleProductSelection(product.id)}
                            />
                            <span>{product.name}</span>
                          </label>
                        ))}
                    </div>
                  </ScrollArea>
                </>
              )}

              {linkMode === 'category' && (
                <div className="space-y-2 max-h-48 overflow-y-auto border rounded-lg p-3">
                  {menuCategories.map(cat => (
                    <div key={cat.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`menucat-${cat.id}`}
                        checked={selectedCategoryIds.has(cat.id)}
                        onCheckedChange={(checked) => toggleMenuCategory(cat.id, !!checked)}
                      />
                      <Label htmlFor={`menucat-${cat.id}`} className="cursor-pointer text-sm">
                        {cat.name}
                        <span className="text-xs text-muted-foreground ml-2">
                          ({cat.product_count} produtos)
                        </span>
                      </Label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Button onClick={handleSaveCategory} className="w-full">{editingCategory ? "Atualizar" : "Criar Categoria"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Item Dialog */}
      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingItem ? "Editar Item" : "Novo Item"}</DialogTitle>
            <DialogDescription>Adicione um item ao grupo de complementos</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="item-name">Nome *</Label>
                <Input id="item-name" value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Ex: Pequeno" />
              </div>
              <div>
                <Label htmlFor="item-price">Preço (R$)</Label>
                <Input id="item-price" type="number" step="0.01" value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="item-pdv-code">Código PDV</Label>
                <Input id="item-pdv-code" value={itemPdvCode} onChange={(e) => setItemPdvCode(e.target.value)} placeholder="Ex: C01" />
              </div>
            </div>

            <div className="space-y-3 p-4 border rounded-xl bg-muted/20">
              <Label>Insumos (opcional)</Label>
              <div className="flex gap-2">
                <Select value={selectedStockItem} onValueChange={setSelectedStockItem}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Selecione um insumo" /></SelectTrigger>
                  <SelectContent>{stockItems.map((item) => (<SelectItem key={item.id} value={item.id}>{item.name} ({item.unit})</SelectItem>))}</SelectContent>
                </Select>
                <Input className="w-24" type="number" step="0.001" placeholder="Qtd" value={ingredientQuantity} onChange={(e) => setIngredientQuantity(e.target.value)} />
                <Button type="button" variant="outline" size="icon" onClick={handleAddIngredient}><Plus className="h-4 w-4" /></Button>
              </div>
              {itemIngredients.length > 0 && (
                <div className="space-y-2">
                  {[...itemIngredients].sort((a, b) => (a.stock_item_name || "").localeCompare(b.stock_item_name || "", "pt-BR")).map((ing) => (
                    <div key={ing.id} className="flex items-center justify-between p-2 bg-background rounded text-sm">
                      <span>{ing.stock_item_name} - {ing.quantity} {ing.stock_item_unit}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => handleRemoveIngredient(ing.id)}>Remover</Button>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground text-right">Custo total: R$ {calculateItemCost(itemIngredients).toFixed(2)}</p>
                </div>
              )}
            </div>

            <Button onClick={handleSaveItem} className="w-full">{editingItem ? "Atualizar Item" : "Adicionar Item"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir categoria?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação irá excluir a categoria "{deletingCategory?.name}" e todos os seus {deletingCategory?.items.length || 0} itens. Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteCategory} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ComplementosTab;
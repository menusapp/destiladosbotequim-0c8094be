import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
// O supabase-js não expõe um módulo "/cors" — este import quebrava a function
// em tempo de execução. CORS definido localmente, igual às demais.
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-app-token",
};

const IFOOD_API = "https://merchant-api.ifood.com.br";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { restaurant_id } = await req.json();
    if (!restaurant_id) {
      return new Response(JSON.stringify({ error: "restaurant_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: config, error: cfgErr } = await supabase
      .from("ifood_config")
      .select("access_token, merchant_id")
      .eq("restaurant_id", restaurant_id)
      .single();

    if (cfgErr || !config?.access_token || !config?.merchant_id) {
      return new Response(
        JSON.stringify({ error: "iFood não configurado ou sem token. Conecte o iFood nas Integrações primeiro." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const headers = {
      Authorization: `Bearer ${config.access_token}`,
      "Content-Type": "application/json",
    };

    // 1. List catalogs
    const catalogsRes = await fetch(
      `${IFOOD_API}/catalog/v2.0/merchants/${config.merchant_id}/catalogs`,
      { headers }
    );

    if (!catalogsRes.ok) {
      const errText = await catalogsRes.text();
      console.error("Catalogs error:", catalogsRes.status, errText);
      
      if (catalogsRes.status === 401 || catalogsRes.status === 403) {
        return new Response(
          JSON.stringify({ error: "Token do iFood expirado. Reconecte o iFood nas Integrações." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Erro ao buscar catálogos do iFood" }),
        { status: catalogsRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const catalogs = await catalogsRes.json();
    console.log("Catalogs found:", catalogs.length || 0);

    const allCategories: any[] = [];

    // 2. For each catalog, get sellable items
    for (const catalog of catalogs) {
      const catalogId = catalog.catalogId || catalog.groupId || catalog.id;
      if (!catalogId) continue;

      // Try sellable items endpoint first (returns all items on sale)
      const sellableRes = await fetch(
        `${IFOOD_API}/catalog/v2.0/merchants/${config.merchant_id}/catalogs/${catalogId}/sellableItems`,
        { headers }
      );

      if (sellableRes.ok) {
        const sellableItems = await sellableRes.json();
        console.log("Sellable items for catalog", catalogId, ":", Array.isArray(sellableItems) ? sellableItems.length : 0);
        
        // Group by category
        const catMap = new Map<string, any[]>();
        for (const item of (Array.isArray(sellableItems) ? sellableItems : [])) {
          const catName = item.categoryName || item.category || "Sem Categoria";
          if (!catMap.has(catName)) catMap.set(catName, []);
          catMap.get(catName)!.push({
            name: item.name || item.description || "",
            description: item.description || item.details || item.additionalInfo || "",
            price: item.price?.value ?? item.unitPrice?.value ?? item.price ?? 0,
            image_url: item.imagePath || item.image || item.logoUrl || null,
          });
        }

        for (const [name, items] of catMap) {
          allCategories.push({ name, items });
        }
        continue;
      }

      // Fallback: get categories with items
      const catRes = await fetch(
        `${IFOOD_API}/catalog/v2.0/merchants/${config.merchant_id}/catalogs/${catalogId}/categories`,
        { headers }
      );

      if (!catRes.ok) {
        console.error("Category fetch error for catalog", catalogId, await catRes.text());
        continue;
      }

      const categories = await catRes.json();

      for (const cat of categories) {
        const categoryName = cat.name || cat.friendlyName || "Sem Categoria";
        const items: any[] = [];

        if (cat.items && Array.isArray(cat.items)) {
          for (const item of cat.items) {
            items.push({
              name: item.name || item.description || "",
              description: item.description || item.additionalInfo || "",
              price: item.price?.value ?? item.unitPrice?.value ?? 0,
              image_url: item.imagePath || item.image || null,
            });
          }
        }

        if (items.length === 0 && (cat.id || cat.categoryId)) {
          const itemsRes = await fetch(
            `${IFOOD_API}/catalog/v2.0/merchants/${config.merchant_id}/catalogs/${catalogId}/categories/${cat.id || cat.categoryId}/items`,
            { headers }
          );
          if (itemsRes.ok) {
            const fetchedItems = await itemsRes.json();
            for (const item of (Array.isArray(fetchedItems) ? fetchedItems : [])) {
              items.push({
                name: item.name || item.description || "",
                description: item.description || item.additionalInfo || "",
                price: item.price?.value ?? item.unitPrice?.value ?? 0,
                image_url: item.imagePath || item.image || null,
              });
            }
          }
        }

        if (items.length > 0) {
          allCategories.push({ name: categoryName, items });
        }
      }
    }

    console.log("Total categories with items:", allCategories.length);

    return new Response(JSON.stringify({ categories: allCategories }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ifood-catalog error:", err);
    return new Response(
      JSON.stringify({ error: "Erro interno ao buscar catálogo" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

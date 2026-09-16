import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { aiChatCompletion, extractToolArguments, textModel, visionModel } from "../_shared/ai.ts";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const cuisinePrompts: Record<string, string> = {
  pizzaria:
    "Este é um cardápio de PIZZARIA. Preste atenção especial a tamanhos (broto, pequena, média, grande, família/gigante), sabores e bordas. Cada sabor com seus tamanhos e preços deve virar um produto separado ou variações do mesmo produto.",
  hamburgueria:
    "Este é um cardápio de HAMBURGUERIA. Preste atenção a combos, acompanhamentos, tipos de hambúrguer, adicionais e tamanhos (simples, duplo, triplo).",
  acai:
    "Este é um cardápio de AÇAÍ/SORVETERIA. Preste atenção a tamanhos (em ml ou oz), coberturas, complementos e sabores.",
  sushi:
    "Este é um cardápio de SUSHI/COMIDA JAPONESA. Preste atenção a combos, quantidade de peças, tipos de sushi, temakis, pratos quentes e porções.",
  cafeteria:
    "Este é um cardápio de CAFETERIA. Preste atenção a bebidas quentes e frias, tamanhos, tipos de café, doces, salgados e combos.",
  outros:
    "Este é um cardápio de restaurante. Extraia todas as categorias, produtos, descrições e preços que conseguir identificar.",
};

const complementCuisinePrompts: Record<string, string> = {
  pizzaria:
    "Este é um cardápio de PIZZARIA. Foque em itens ADICIONAIS/COMPLEMENTARES como bordas recheadas, ingredientes extras, molhos adicionais, bebidas extras para combos.",
  hamburgueria:
    "Este é um cardápio de HAMBURGUERIA. Foque em itens ADICIONAIS/COMPLEMENTARES como bacon extra, queijo extra, molhos especiais, acompanhamentos extras, adicionais de hambúrguer.",
  acai:
    "Este é um cardápio de AÇAÍ/SORVETERIA. Foque em itens ADICIONAIS/COMPLEMENTARES como coberturas, frutas extras, granola, leite condensado, caldas.",
  sushi:
    "Este é um cardápio de SUSHI/COMIDA JAPONESA. Foque em itens ADICIONAIS/COMPLEMENTARES como molhos, wasabi extra, gengibre, complementos de pratos.",
  cafeteria:
    "Este é um cardápio de CAFETERIA. Foque em itens ADICIONAIS/COMPLEMENTARES como leite extra, chantilly, shots de café, coberturas.",
  outros:
    "Foque em itens ADICIONAIS/COMPLEMENTARES como ingredientes extras, molhos, acompanhamentos adicionais, complementos pagos.",
};

function getProductsTool() {
  return {
    type: "function",
    function: {
      name: "extract_menu",
      description: "Extrai categorias e produtos de um cardápio fotografado",
      parameters: {
        type: "object",
        properties: {
          categories: {
            type: "array",
            description: "Lista de categorias do cardápio",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Nome da categoria (ex: Pizzas, Bebidas, Sobremesas)" },
                products: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string", description: "Nome do produto" },
                      description: { type: "string", description: "Descrição ou ingredientes do produto" },
                      price: { type: "number", description: "Preço do produto em reais (0 se não visível)" },
                    },
                    required: ["name", "price"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["name", "products"],
              additionalProperties: false,
            },
          },
        },
        required: ["categories"],
        additionalProperties: false,
      },
    },
  };
}

function getComplementsTool() {
  return {
    type: "function",
    function: {
      name: "extract_menu",
      description: "Extrai categorias de complementos/adicionais de um cardápio fotografado",
      parameters: {
        type: "object",
        properties: {
          categories: {
            type: "array",
            description: "Lista de categorias de complementos/adicionais",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Nome da categoria de complemento (ex: Adicionais, Molhos, Bordas)" },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string", description: "Nome do item complementar" },
                      description: { type: "string", description: "Descrição do item" },
                      price: { type: "number", description: "Preço do complemento em reais (0 se não visível)" },
                    },
                    required: ["name", "price"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["name", "items"],
              additionalProperties: false,
            },
          },
        },
        required: ["categories"],
        additionalProperties: false,
      },
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_base64, cuisine_type, custom_cuisine, mode } = await req.json();

    if (!image_base64) {
      return new Response(
        JSON.stringify({ error: "image_base64 é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }


    const isComplements = mode === "complements";

    const cuisineContext = isComplements
      ? (complementCuisinePrompts[cuisine_type] || `Foque em itens ADICIONAIS/COMPLEMENTARES de ${custom_cuisine || "restaurante"}.`)
      : (cuisinePrompts[cuisine_type] || `Este é um cardápio de ${custom_cuisine || "restaurante"}. Extraia todas as categorias, produtos, descrições e preços.`);

    const systemPrompt = isComplements
      ? `Você é um especialista em digitalização de cardápios de restaurantes. Analise a foto e extraia APENAS os itens que são COMPLEMENTOS/ADICIONAIS (extras pagos que acompanham um produto principal).

${cuisineContext}

Regras:
- Extraia APENAS itens complementares/adicionais, NÃO produtos principais
- Exemplos de complementos: bacon extra, queijo adicional, molho especial, borda recheada, cobertura extra
- Organize por categorias lógicas (ex: "Adicionais de Proteína", "Molhos", "Coberturas")
- Extraia preços em formato numérico (ex: 3.50)
- Se o preço não estiver visível ou legível, use 0
- NÃO invente itens que não estão na imagem`
      : `Você é um especialista em digitalização de cardápios de restaurantes. Analise a foto do cardápio e extraia TODOS os produtos organizados por categoria.

${cuisineContext}

Regras:
- Extraia o nome exato dos produtos como estão no cardápio
- Extraia preços em formato numérico (ex: 25.90)
- Se houver descrição/ingredientes do produto, inclua
- Se um produto tem variações de tamanho com preços diferentes, liste como produtos separados (ex: "Pizza Calabresa - Grande" e "Pizza Calabresa - Média")
- Organize por categorias lógicas como aparecem no cardápio
- Se o preço não estiver visível ou legível, use 0
- NÃO invente produtos que não estão na imagem`;

    let mimeType = "image/jpeg";
    let cleanBase64 = image_base64;
    if (image_base64.startsWith("data:")) {
      const match = image_base64.match(/^data:(image\/\w+);base64,/);
      if (match) {
        mimeType = match[1];
        cleanBase64 = image_base64.split(",")[1];
      }
    }

    const tool = isComplements ? getComplementsTool() : getProductsTool();

    const aiResult = await aiChatCompletion({
      model: visionModel(),
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${cleanBase64}` },
            },
            {
              type: "text",
              text: isComplements
                ? "Analise este cardápio e extraia os complementos/adicionais usando a função extract_menu."
                : "Analise este cardápio e extraia todos os produtos usando a função extract_menu.",
            },
          ],
        },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "extract_menu" } },
    });

    if (!aiResult.ok) {
      return new Response(
        JSON.stringify({ error: aiResult.error }),
        { status: aiResult.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const toolArguments = extractToolArguments(aiResult.data);

    if (!toolArguments) {
      console.error("No tool call in response:", JSON.stringify(aiResult.data));
      return new Response(
        JSON.stringify({ error: "IA não retornou dados estruturados" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const menuData = JSON.parse(toolArguments);

    return new Response(JSON.stringify(menuData), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("digitize-menu error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

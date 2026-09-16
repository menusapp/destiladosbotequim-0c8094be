import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { aiChatCompletion, extractToolArguments, textModel, visionModel } from "../_shared/ai.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { product_name, product_description, restaurant_id } = await req.json();

    if (!product_name || !restaurant_id) {
      return new Response(JSON.stringify({ error: "product_name e restaurant_id são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Buscar UF do restaurante
    const { data: fiscalConfig } = await supabase
      .from("fiscal_configs")
      .select("uf")
      .eq("restaurant_id", restaurant_id)
      .single();

    const uf = fiscalConfig?.uf || "SP";

    const systemPrompt = `Você é um especialista em tributação brasileira para NFC-e (Nota Fiscal de Consumidor Eletrônica) focado em estabelecimentos de alimentação (restaurantes, lanchonetes, bares, padarias, etc.) que operam no Simples Nacional (CRT 1).

Sua tarefa é classificar produtos alimentícios com os códigos fiscais corretos baseando-se no nome e descrição do produto.

Regras importantes:
- UF do estabelecimento: ${uf}
- Regime tributário: Simples Nacional (CRT 1)
- Tipo de operação: Venda de mercadoria ao consumidor final (NFC-e)
- CFOP padrão para venda interna: 5102 (revenda) ou 5101 (produção própria). Para restaurantes/bares que produzem o alimento, use 5101.
- CSOSN mais comum para Simples Nacional: 102 (tributado sem permissão de crédito) ou 500 (ICMS cobrado anteriormente por ST)
- Origem: 0 (Nacional)
- PIS CST: 49 (outras operações de saída) para Simples Nacional
- COFINS CST: 49 (outras operações de saída) para Simples Nacional
- NCM deve ser o código de 8 dígitos mais específico possível
- CEST quando aplicável (produtos sujeitos a substituição tributária)

Exemplos de NCM comuns para alimentação:
- Refeições prontas: 21069090
- Hambúrguer/sanduíche: 21069090
- Pizza: 19059090
- Salgados/empanados: 19059090
- Sucos naturais: 20098990
- Refrigerantes: 22021000
- Água mineral: 22011000
- Cerveja: 22030000
- Sorvete: 21050000
- Açaí: 20089900
- Café preparado: 09012100
- Pão/bolo: 19059090
- Doces/sobremesas: 17049090
- Carnes preparadas: 16025000
- Porções/petiscos: 16025000`;

    const aiResult = await aiChatCompletion({
      model: textModel(),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Classifique fiscalmente este produto:\n\nNome: ${product_name}\nDescrição: ${product_description || "Sem descrição"}\n\nRetorne os códigos fiscais corretos.` },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "suggest_fiscal_codes",
            description: "Retorna os códigos fiscais sugeridos para o produto",
            parameters: {
              type: "object",
              properties: {
                ncm: { type: "string", description: "Código NCM de 8 dígitos" },
                cest: { type: "string", description: "Código CEST (7 dígitos) ou vazio se não aplicável" },
                cfop: { type: "string", description: "CFOP (ex: 5101 ou 5102)" },
                csosn: { type: "string", description: "CSOSN para Simples Nacional (ex: 102, 500)" },
                origin: { type: "string", description: "Origem da mercadoria (0 = Nacional)" },
                pis_cst: { type: "string", description: "CST do PIS (ex: 49)" },
                pis_aliquota: { type: "string", description: "Alíquota do PIS em % (ex: 0.00 para Simples Nacional)" },
                cofins_cst: { type: "string", description: "CST do COFINS (ex: 49)" },
                cofins_aliquota: { type: "string", description: "Alíquota do COFINS em % (ex: 0.00 para Simples Nacional)" },
                ibs_aliquota: { type: "string", description: "Alíquota do IBS em % conforme reforma tributária (ex: 0.00 se não aplicável)" },
                cbs_aliquota: { type: "string", description: "Alíquota do CBS em % conforme reforma tributária (ex: 0.00 se não aplicável)" },
                explanation: { type: "string", description: "Breve explicação da classificação" },
              },
              required: ["ncm", "cfop", "csosn", "origin", "pis_cst", "pis_aliquota", "cofins_cst", "cofins_aliquota", "ibs_aliquota", "cbs_aliquota"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "suggest_fiscal_codes" } },
    });

    if (!aiResult.ok) {
      return new Response(JSON.stringify({ error: aiResult.error }), {
        status: aiResult.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const toolArguments = extractToolArguments(aiResult.data);

    if (!toolArguments) {
      throw new Error("IA não retornou dados estruturados");
    }

    const suggestion = JSON.parse(toolArguments);

    return new Response(JSON.stringify({ suggestion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("fiscal-ai-suggest error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

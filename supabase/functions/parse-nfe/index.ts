const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-app-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { xml_content } = await req.json();

    if (!xml_content || typeof xml_content !== "string") {
      return new Response(
        JSON.stringify({ error: "xml_content é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract supplier info from <emit>
    const emitBlock = xml_content.match(/<emit>([\s\S]*?)<\/emit>/)?.[1] || "";
    const cnpj_fornecedor = emitBlock.match(/<CNPJ>([^<]+)<\/CNPJ>/)?.[1] || "";
    const nome_fornecedor = emitBlock.match(/<xNome>([^<]+)<\/xNome>/)?.[1] || "";

    // Extract invoice metadata
    const numero_nota = xml_content.match(/<nNF>([^<]+)<\/nNF>/)?.[1] || "";
    const data_emissao = xml_content.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1] || "";

    // Extract all <det> blocks (each is an item)
    const detBlocks = xml_content.match(/<det\b[^>]*>([\s\S]*?)<\/det>/g) || [];

    const unitMap: Record<string, string> = {
      UN: "un",
      UNID: "un",
      UND: "un",
      KG: "kg",
      G: "g",
      GR: "g",
      L: "l",
      LT: "l",
      ML: "ml",
      CX: "caixa",
      PC: "pacote",
      PCT: "pacote",
      PAR: "un",
      DZ: "un",
      M: "un",
      MT: "un",
    };

    const items = detBlocks.map((block) => {
      const prod = block.match(/<prod>([\s\S]*?)<\/prod>/)?.[1] || "";

      const xProd = prod.match(/<xProd>([^<]+)<\/xProd>/)?.[1] || "";
      const cProd = prod.match(/<cProd>([^<]+)<\/cProd>/)?.[1] || "";
      const qCom = parseFloat(prod.match(/<qCom>([^<]+)<\/qCom>/)?.[1] || "0");
      const uCom = (prod.match(/<uCom>([^<]+)<\/uCom>/)?.[1] || "UN").toUpperCase().trim();
      const vUnCom = parseFloat(prod.match(/<vUnCom>([^<]+)<\/vUnCom>/)?.[1] || "0");
      const vProd = parseFloat(prod.match(/<vProd>([^<]+)<\/vProd>/)?.[1] || "0");

      const unit = unitMap[uCom] || "un";

      return {
        nome: xProd,
        codigo: cProd,
        quantidade: qCom,
        unidade: unit,
        unidade_original: uCom,
        valor_unitario: vUnCom,
        valor_total: vProd,
      };
    });

    const valor_total = items.reduce((sum, item) => sum + item.valor_total, 0);

    return new Response(
      JSON.stringify({
        numero_nota,
        cnpj_fornecedor,
        nome_fornecedor,
        data_emissao,
        valor_total,
        items,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Erro ao processar NF-e:", error);
    return new Response(
      JSON.stringify({ error: "Erro ao processar XML da NF-e" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

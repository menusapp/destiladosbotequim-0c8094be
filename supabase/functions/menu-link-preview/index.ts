// Public edge function that renders an HTML page with restaurant-specific
// Open Graph meta tags (logo, name, description). WhatsApp/Facebook/Twitter
// crawlers fetch this page and use the og:image for the link preview.
// Browsers are immediately redirected to the actual SPA menu.
//
// URL format: /functions/v1/menu-link-preview/<slug>
// Optional path passthrough: /functions/v1/menu-link-preview/<slug>/qualquer/coisa
import { createClient } from "npm:@supabase/supabase-js@2";

// Domínio público do cardápio. Configurável pelo secret PUBLIC_DOMAIN.
const PUBLIC_DOMAIN = Deno.env.get("PUBLIC_DOMAIN") || "menusapp.com.br";

// Build the canonical public URL using the path-based format.
// Ex.: buildPublicUrl("rods") → "https://menusapp.com.br/rods"
// (Subdomínios desativados — Lovable não suporta wildcard em domínios customizados.)
function buildPublicUrl(slug: string, extraPath?: string): string {
  const base = `https://${PUBLIC_DOMAIN}/${slug}`;
  return extraPath ? `${base}/${extraPath.replace(/^\/+/, "")}` : base;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
};

function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    // Path comes as /menu-link-preview/<slug>/...optional
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("menu-link-preview");
    const slug = idx >= 0 ? parts[idx + 1] : parts[parts.length - 1];
    const extraPath = idx >= 0 ? parts.slice(idx + 2).join("/") : "";

    if (!slug) {
      return new Response("Missing slug", { status: 400, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("name, logo_url, slug")
      .eq("slug", slug)
      .maybeSingle();

    const finalUrl = buildPublicUrl(slug, extraPath);

    const name = restaurant?.name || "Cardápio Digital";
    const logo = restaurant?.logo_url || `https://${PUBLIC_DOMAIN}/placeholder.svg`;
    const description = `Acesse o cardápio digital de ${name} e faça seu pedido online.`;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(name)} - Cardápio Digital</title>
  <meta name="description" content="${escapeHtml(description)}" />

  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(name)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(logo)}" />
  <meta property="og:image:secure_url" content="${escapeHtml(logo)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${escapeHtml(finalUrl)}" />
  <meta property="og:site_name" content="${escapeHtml(name)}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(name)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(logo)}" />

  <link rel="canonical" href="${escapeHtml(finalUrl)}" />
  <meta http-equiv="refresh" content="0; url=${escapeHtml(finalUrl)}" />
  <script>window.location.replace(${JSON.stringify(finalUrl)});</script>
</head>
<body style="font-family: system-ui, sans-serif; text-align: center; padding: 40px;">
  <img src="${escapeHtml(logo)}" alt="${escapeHtml(name)}" style="max-width:200px;border-radius:12px;margin-bottom:20px;" />
  <h1>${escapeHtml(name)}</h1>
  <p>Redirecionando para o cardápio...</p>
  <p><a href="${escapeHtml(finalUrl)}">Clique aqui caso não seja redirecionado</a></p>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    console.error("[menu-link-preview]", err);
    return new Response("Internal error", { status: 500, headers: corsHeaders });
  }
});

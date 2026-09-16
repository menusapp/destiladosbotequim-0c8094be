/**
 * Helpers centralizados para gerar links públicos do restaurante.
 *
 * Formato atual: path-based (`menusapp.com.br/{slug}/...`)
 *
 * Os subdomínios (`{slug}.dominio`) foram desativados: a hospedagem usada não
 * suportava wildcard em domínio customizado. Todas as funções abaixo retornam
 * URLs no formato path-based.
 *
 * - `getPublicMenuLink(slug, extraPath?)` → URL pública do cardápio.
 * - `getDirectMenuLink(slug, extraPath?)` → alias de retrocompatibilidade.
 * - `getSubdomainMenuLink(slug)`          → alias de retrocompatibilidade.
 * - `getLegacyMenuLink(slug, extraPath?)` → mesmo formato (mantido por compat).
 * - `getShareableMenuLink(slug, extraPath?)` → URL com prévia rica para
 *   WhatsApp/redes sociais (passa pela edge function `menu-link-preview`).
 * - `getTableMenuLink(slug, tableNumber)`  → link de QR Code para mesa.
 */

/** Domínio público do cardápio. Configurável por `VITE_PUBLIC_DOMAIN`. */
const PUBLIC_DOMAIN = (import.meta.env.VITE_PUBLIC_DOMAIN as string | undefined) || "menusapp.com.br";

/**
 * Base das edge functions, derivada de `VITE_SUPABASE_URL`.
 *
 * NÃO existe mais fallback com o ref do projeto antigo: se a env não estiver
 * configurada, é melhor quebrar de forma visível do que gerar links apontando
 * silenciosamente para o Supabase de outra pessoa.
 */
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const PREVIEW_FN_BASE = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/menu-link-preview`;

function joinPath(base: string, extraPath?: string): string {
  if (!extraPath) return base;
  const cleaned = extraPath.replace(/^\/+/, "");
  return `${base}/${cleaned}`;
}

/**
 * URL pública canônica do cardápio — formato path-based.
 * Ex.: getPublicMenuLink("rods") → "https://menusapp.com.br/rods"
 *      getPublicMenuLink("rods", "mesa/3") → "https://menusapp.com.br/rods/mesa/3"
 */
export function getPublicMenuLink(slug: string, extraPath?: string): string {
  return joinPath(`https://${PUBLIC_DOMAIN}/${slug}`, extraPath);
}

/**
 * Alias mantido para retrocompatibilidade.
 */
export function getDirectMenuLink(slug: string, extraPath?: string): string {
  return getPublicMenuLink(slug, extraPath);
}

/**
 * Alias mantido para retrocompatibilidade — agora retorna o mesmo formato
 * path-based (subdomínios desativados).
 */
export function getSubdomainMenuLink(slug: string): string {
  return getPublicMenuLink(slug);
}

/**
 * Formato legado (mantido como alias do formato atual).
 */
export function getLegacyMenuLink(slug: string, extraPath?: string): string {
  return getPublicMenuLink(slug, extraPath);
}

/**
 * URL com prévia rica (Open Graph) para WhatsApp / redes sociais.
 * Roteia pela edge function `menu-link-preview`, que devolve HTML com og:image
 * e redireciona o navegador para a URL canônica.
 */
export function getShareableMenuLink(slug: string, extraPath?: string): string {
  return joinPath(`${PREVIEW_FN_BASE}/${slug}`, extraPath);
}

/**
 * Link para a mesa (QR code).
 * Usa a URL pública path-based do cardápio local da mesa,
 * para que o cliente abra diretamente o cardápio com a comanda da mesa.
 */
export function getTableMenuLink(slug: string, tableNumber: number): string {
  return getPublicMenuLink(slug, `mesa/${tableNumber}`);
}

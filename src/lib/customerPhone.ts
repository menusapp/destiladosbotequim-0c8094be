/**
 * Telefone do cliente guardado no navegador pelo cardápio.
 *
 * A chave é gravada em DeliveryMenu quando o cliente se identifica. Centraliza
 * aqui para não repetir o formato da chave em cada tela — e para que as RPCs
 * de cliente (get_customer_orders, list_customer_addresses) recebam o telefone
 * quando ele existe, aplicando a verificação mais forte de CPF + telefone.
 */
export function chaveTelefoneCliente(restaurantSlug: string): string {
  return `delivery-phone-${restaurantSlug}`;
}

export function telefoneClienteSalvo(restaurantSlug: string): string | null {
  if (!restaurantSlug) return null;
  try {
    const v = localStorage.getItem(chaveTelefoneCliente(restaurantSlug));
    return v && v.trim() ? v : null;
  } catch {
    return null; // localStorage bloqueado (navegação privada, etc.)
  }
}

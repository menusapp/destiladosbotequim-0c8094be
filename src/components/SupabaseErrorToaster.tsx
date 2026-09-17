import { useEffect } from "react";
import { toast } from "@/components/ui/sonner";
import { EVENTO_ERRO_SUPABASE, type ErroSupabase } from "@/lib/supabaseErrorBus";

/**
 * Mostra na tela qualquer falha de requisição ao Supabase.
 *
 * Antes disso, uma escrita rejeitada (RLS, permissão, coluna inválida) era
 * silenciosa: a tela seguia como se tivesse dado certo e o dado simplesmente
 * não existia. Agora toda falha aparece, com a tabela e o motivo.
 *
 * Fica montado na raiz do app e não renderiza nada.
 */
export function SupabaseErrorToaster() {
  useEffect(() => {
    const aoFalhar = (e: Event) => {
      const d = (e as CustomEvent<ErroSupabase & { recurso: string }>).detail;
      if (!d) return;

      const ehPermissao =
        d.status === 401 || d.status === 403 ||
        /permission denied|row-level security/i.test(d.mensagem);

      toast.error(
        ehPermissao
          ? `Sem permissão para gravar em "${d.recurso}"`
          : `Falha em "${d.recurso}"`,
        {
          description: d.detalhe ? `${d.mensagem} — ${d.detalhe}` : d.mensagem,
          duration: 12000,
        },
      );
    };

    window.addEventListener(EVENTO_ERRO_SUPABASE, aoFalhar);
    return () => window.removeEventListener(EVENTO_ERRO_SUPABASE, aoFalhar);
  }, []);

  return null;
}

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link2, Copy, Check, Sparkles, Globe } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { copiarTexto } from "@/lib/clipboard";
import {
  getShareableMenuLink,
  getDirectMenuLink,
  getSubdomainMenuLink,
} from "@/lib/shareableLinks";

interface ShareableLinksSectionProps {
  restaurantId: string;
}

const ShareableLinksSection = ({ restaurantId }: ShareableLinksSectionProps) => {
  const [slug, setSlug] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("restaurants")
        .select("slug")
        .eq("id", restaurantId)
        .maybeSingle();
      if (data?.slug) setSlug(data.slug);
    })();
  }, [restaurantId]);

  const copyToClipboard = async (key: string, value: string) => {
    try {
      await copiarTexto(value);
      setCopiedKey(key);
      toast.success("Link copiado!");
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  if (!slug) return null;

  const subdomainLink = getSubdomainMenuLink(slug);
  const directLink = getDirectMenuLink(slug);
  const shareableLink = getShareableMenuLink(slug);

  const links = [
    {
      key: "subdomain",
      label: "Subdomínio (recomendado)",
      description: "Mais curto e profissional. Use no Instagram, cartão de visita, etc.",
      url: subdomainLink,
      icon: Sparkles,
      highlight: true,
    },
    {
      key: "direct",
      label: "Link padrão",
      description: "Caminho tradicional do cardápio.",
      url: directLink,
      icon: Globe,
      highlight: false,
    },
    {
      key: "shareable",
      label: "Link com prévia (WhatsApp / redes sociais)",
      description: "Mostra sua logo e nome quando enviado em conversas e posts.",
      url: shareableLink,
      icon: Link2,
      highlight: false,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          Link do seu cardápio
        </CardTitle>
        <CardDescription>
          Compartilhe esses links com seus clientes. Cada um tem um propósito específico.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {links.map(({ key, label, description, url, icon: Icon, highlight }) => (
          <div
            key={key}
            className={`rounded-lg border p-4 transition-colors ${
              highlight ? "border-primary/40 bg-primary/5" : "bg-muted/30"
            }`}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-sm font-medium truncate">{label}</p>
                {highlight && (
                  <Badge variant="secondary" className="text-[10px] uppercase">
                    Top
                  </Badge>
                )}
              </div>
              <Button
                size="sm"
                variant={highlight ? "default" : "outline"}
                onClick={() => copyToClipboard(key, url)}
                className="shrink-0 gap-1.5"
              >
                {copiedKey === key ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copiar
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mb-2">{description}</p>
            <code className="block text-xs bg-background border rounded px-2 py-1.5 font-mono break-all">
              {url}
            </code>
          </div>
        ))}

        <p className="text-xs text-muted-foreground pt-2 border-t">
          💡 <strong>Dica:</strong> divulgue o subdomínio nas suas redes sociais e use o link com prévia
          ao enviar pelo WhatsApp para que sua logo apareça automaticamente.
        </p>
      </CardContent>
    </Card>
  );
};

export default ShareableLinksSection;

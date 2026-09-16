import { memo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Copy, Trash2, Camera, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { novoId } from "@/lib/uuid";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface VariableCostInfo {
  name: string;
  price: number;
  cost: number;
  margin: number;
}

interface ProductCardProps {
  product: {
    id: string;
    name: string;
    description: string | null;
    price: number;
    promotional_price?: number | null;
    available: boolean;
    cost?: number;
    margin?: number;
    prep_time?: number;
    sku?: string;
    image_url?: string | null;
    variableCosts?: VariableCostInfo[];
  };
  onEdit: (product: any) => void;
  onToggleAvailable: (id: string, available: boolean) => void;
  onDuplicate?: (product: any) => void;
  onDelete?: (productId: string) => void;
  onImageUpdated?: () => void;
}

const ProductCard = memo(({ product, onEdit, onToggleAvailable, onDuplicate, onDelete, onImageUpdated }: ProductCardProps) => {
  const hasVariableCosts = product.variableCosts && product.variableCosts.length > 0;
  const margin = product.margin || 0;
  const marginColor = margin >= 70 ? "text-success" : margin >= 50 ? "text-warning" : "text-foreground";
  const hasPromoPrice = product.promotional_price !== null && product.promotional_price !== undefined;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem");
      return;
    }
    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${novoId()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('product-images').upload(fileName, file);
      if (uploadError) { toast.error("Erro ao fazer upload da imagem"); return; }
      const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(fileName);
      const { error: updateError } = await supabase.from("products").update({ image_url: publicUrl }).eq("id", product.id);
      if (updateError) { toast.error("Erro ao salvar imagem"); return; }
      toast.success("Foto adicionada com sucesso");
      onImageUpdated?.();
    } catch {
      toast.error("Erro ao enviar foto");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <Card className="p-3 hover:shadow-md transition-shadow">
      <div className="space-y-2">
        {/* Thumbnail */}
        {product.image_url && (
          <img src={product.image_url} alt={product.name} className="w-full h-20 object-cover rounded" />
        )}

        {/* Header */}
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-foreground truncate">
              {product.name}
            </h3>
            {product.description && (
              <p className="text-[11px] text-muted-foreground line-clamp-2">
                {product.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge 
              variant={product.available ? "default" : "secondary"}
              className={`text-[10px] px-1.5 py-0 ${product.available ? "bg-foreground text-background" : ""}`}
            >
              {product.available ? "Ativo" : "Inativo"}
            </Badge>
            <Switch
              checked={product.available}
              onCheckedChange={(checked) => onToggleAvailable(product.id, checked)}
              className="h-4 w-8 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-4"
            />
          </div>
        </div>

        {/* Preço */}
        <div className="flex items-center gap-2">
          {hasPromoPrice ? (
            <>
              <span className="text-sm text-muted-foreground line-through">
                R$ {product.price.toFixed(2)}
              </span>
              <span className="text-xl font-bold text-primary leading-none">
                R$ {product.promotional_price!.toFixed(2)}
              </span>
            </>
          ) : (
            <span className="text-xl font-bold text-primary leading-none">
              R$ {product.price.toFixed(2)}
            </span>
          )}
        </div>

        {/* Custos */}
        {hasVariableCosts ? (
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground">Custos por Variação:</p>
            <div className="space-y-1">
              {product.variableCosts!.map((vc, idx) => {
                const vcMarginColor = vc.margin >= 70 ? "text-success" : vc.margin >= 50 ? "text-warning" : "text-foreground";
                return (
                  <div key={idx} className="flex items-center justify-between text-xs bg-muted/50 p-1.5 rounded">
                    <span className="font-medium">{vc.name}</span>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-muted-foreground">R$ {vc.cost.toFixed(2)}</span>
                      <span className={`font-medium ${vcMarginColor}`}>{vc.margin.toFixed(0)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Custo:</span>
              <p className="font-medium text-foreground">R$ {(product.cost || 0).toFixed(2)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Margem:</span>
              <p className={`font-medium ${marginColor}`}>{margin.toFixed(1)}%</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-muted-foreground">Preparo:</span>
            <p className="font-medium text-foreground">{product.prep_time || 0} min</p>
          </div>
          <div>
            <span className="text-muted-foreground">SKU:</span>
            <p className="font-medium text-foreground">{product.sku || "-"}</p>
          </div>
        </div>

        {/* Botões */}
        <div className="flex gap-1.5 pt-1">
          {onDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8">
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir produto?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação não pode ser desfeita. O produto "{product.name}" será removido permanentemente.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(product.id)}>
                    Excluir
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,image/webp,.webp,.jpg,.jpeg,.png,.gif"
            className="hidden"
            onChange={handlePhotoUpload}
          />
          {onDuplicate && (
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onDuplicate(product)}>
              <Copy className="h-3 w-3" />
            </Button>
          )}
          <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => onEdit(product)}>
            <Pencil className="h-3 w-3 mr-1" />
            Editar
          </Button>
        </div>
      </div>
    </Card>
  );
});

ProductCard.displayName = "ProductCard";

export default ProductCard;

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";

interface ProductExtra {
  id: string;
  name: string;
  price: number;
  extra_category_name?: string;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
}

interface ProductDetailDialogProps {
  product: Product | null;
  extras: ProductExtra[];
  open: boolean;
  onClose: () => void;
  onAddToCart: (product: Product, selectedExtras: ProductExtra[], notes?: string) => void;
  restaurantColor?: string;
}

const ProductDetailDialog = ({
  product,
  extras,
  open,
  onClose,
  onAddToCart,
  restaurantColor = "#184a2d"
}: ProductDetailDialogProps) => {
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  // Group extras by category
  const groupedExtras = useMemo(() => {
    const groups: { categoryName: string; items: ProductExtra[] }[] = [];
    const map = new Map<string, ProductExtra[]>();

    for (const extra of extras) {
      const catName = extra.extra_category_name || "Variações";
      if (!map.has(catName)) map.set(catName, []);
      map.get(catName)!.push(extra);
    }

    for (const [categoryName, items] of map) {
      groups.push({ categoryName, items });
    }

    groups.sort((a, b) => {
      const aIsPao = a.categoryName.toLowerCase().includes("qual pão");
      const bIsPao = b.categoryName.toLowerCase().includes("qual pão");
      if (aIsPao && !bIsPao) return -1;
      if (!aIsPao && bIsPao) return 1;
      return 0;
    });

    return groups;
  }, [extras]);

  if (!product) return null;

  const handleExtraToggle = (extraId: string) => {
    setSelectedExtras((prev) =>
      prev.includes(extraId)
        ? prev.filter((id) => id !== extraId)
        : [...prev, extraId]
    );
  };

  const handleAddToCart = () => {
    const extrasToAdd = extras.filter((e) => selectedExtras.includes(e.id));
    onAddToCart(product, extrasToAdd, notes || undefined);
    setSelectedExtras([]);
    setNotes("");
    onClose();
  };

  const getTotalPrice = () => {
    const extrasTotal = extras
      .filter((e) => selectedExtras.includes(e.id))
      .reduce((sum, e) => sum + e.price, 0);
    return product.price + extrasTotal;
  };

  return (
    <>
      <style>{`
        .custom-checkbox-${product.id.replace(/[^a-zA-Z0-9]/g, '')} {
          border-color: ${restaurantColor} !important;
        }
        .custom-checkbox-${product.id.replace(/[^a-zA-Z0-9]/g, '')}[data-state="checked"] {
          background-color: ${restaurantColor} !important;
          border-color: ${restaurantColor} !important;
        }
      `}</style>
      <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-xl">{product.name}</DialogTitle>
          {product.description && (
            <DialogDescription className="text-sm">{product.description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-3">
          {product.image_url && (
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full h-40 object-cover rounded-lg"
            />
          )}

          <div className="space-y-3">
            <div 
              className="p-3 rounded-lg flex items-center justify-between"
              style={{ backgroundColor: `${restaurantColor}15` }}
            >
              <span className="text-sm font-medium">Preço base</span>
              <p className="text-2xl font-bold" style={{ color: restaurantColor }}>
                R$ {product.price.toFixed(2)}
              </p>
            </div>

            {groupedExtras.length > 0 && groupedExtras.map((group) => (
              <div key={group.categoryName} className="space-y-2">
                <h4 className="text-sm font-semibold text-foreground">{group.categoryName}</h4>
                <div className="space-y-2">
                  {group.items.map((extra) => {
                    const isSelected = selectedExtras.includes(extra.id);
                    return (
                      <label
                        key={extra.id}
                        className="flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors"
                        style={
                          isSelected
                            ? { backgroundColor: `${restaurantColor}10`, borderColor: restaurantColor }
                            : { borderColor: `${restaurantColor}55` }
                        }
                      >
                        <Checkbox
                          id={extra.id}
                          checked={isSelected}
                          onCheckedChange={() => handleExtraToggle(extra.id)}
                          className={`custom-checkbox-${product.id.replace(/[^a-zA-Z0-9]/g, '')}`}
                        />
                        <span className="flex-1 text-sm">{extra.name}</span>
                        <span className="text-sm font-semibold" style={{ color: restaurantColor }}>
                          + R$ {extra.price.toFixed(2)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}

            {selectedExtras.length > 0 && (
              <div 
                className="flex justify-between items-center p-3 rounded-lg" 
                style={{ backgroundColor: restaurantColor, color: 'white' }}
              >
                <span className="font-semibold">Total</span>
                <span className="text-2xl font-bold">
                  R$ {getTotalPrice().toFixed(2)}
                </span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes" className="text-sm">Observações (opcional)</Label>
              <Textarea
                id="notes"
                placeholder="Ex: Sem cebola, bem passado..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="text-sm"
              />
            </div>
          </div>

          <Button 
            className="w-full text-white" 
            size="lg" 
            onClick={handleAddToCart}
            style={{ backgroundColor: restaurantColor }}
          >
            <Plus className="h-5 w-5 mr-2" />
            Adicionar ao Carrinho
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
};

export default ProductDetailDialog;

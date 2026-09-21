import { Button } from "@/components/ui/button";
import { Hand } from "lucide-react";

interface KioskIdleScreenProps {
  restaurant: any;
  onStart: () => void;
}

export function KioskIdleScreen({ restaurant, onStart }: KioskIdleScreenProps) {
  const color = restaurant?.primary_color || "#184a2d";

  return (
    <div
      className="flex flex-col items-center justify-center h-screen gap-8 px-8 text-center"
      onClick={onStart}
      onTouchStart={onStart}
    >
      {restaurant?.logo_url && (
        <img src={restaurant.logo_url} alt={restaurant.name} className="h-32 w-32 object-contain rounded-2xl" />
      )}
      
      <p className="text-xl md:text-2xl text-muted-foreground">Faça seu pedido aqui!</p>

      <Button
        className="text-2xl md:text-3xl px-12 py-8 rounded-2xl font-bold text-white shadow-lg animate-pulse"
        style={{ backgroundColor: color }}
        onClick={onStart}
      >
        <Hand className="mr-3 h-8 w-8" />
        Iniciar Pedido
      </Button>

      <p className="text-muted-foreground text-lg">Toque em qualquer lugar para começar</p>
    </div>
  );
}

import { Star, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ReviewsDrawer } from "./ReviewsDrawer";

interface RestaurantInfoCardProps {
  restaurantId: string;
  name: string;
  logoUrl: string | null;
  distance?: string;
  minOrder?: number;
  deliveryTime?: string;
  deliveryFee?: number;
  primaryColor?: string;
  tableInfo?: string; // "Mesa 12" ou null para delivery
}

export const RestaurantInfoCard = ({
  restaurantId,
  name,
  logoUrl,
  distance = "0.7 km",
  minOrder,
  deliveryTime = "50-60 min",
  deliveryFee = 3.0,
  primaryColor = "#184a2d",
  tableInfo,
}: RestaurantInfoCardProps) => {
  const [rating, setRating] = useState<number>(0);
  const [reviewCount, setReviewCount] = useState<number>(0);
  const [reviewsOpen, setReviewsOpen] = useState(false);

  useEffect(() => {
    const fetchRatingStats = async () => {
      const { data, error } = await supabase.rpc("get_restaurant_rating_stats", {
        p_restaurant_id: restaurantId,
      });

      if (error) {
        console.error("Erro ao buscar avaliações:", error);
        return;
      }

      if (data && data.length > 0) {
        setRating(Number(data[0].average_rating) || 0);
        setReviewCount(Number(data[0].total_reviews) || 0);
      }
    };

    fetchRatingStats();
  }, [restaurantId]);
  return (
    <Card className="bg-white rounded-3xl shadow-lg overflow-visible -mt-8 mx-4 relative z-20">
      <div className="p-4">
        {/* Logo */}
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 z-30 my-0 py-0">
          {logoUrl ? (
            <div className="w-24 h-24 rounded-full bg-white shadow-lg overflow-hidden border-4 border-white p-1">
              <img src={logoUrl} alt={name} className="w-full h-full rounded-full object-fill" />
            </div>
          ) : (
            <div 
              className="w-24 h-24 rounded-full shadow-lg border-4 border-white flex items-center justify-center text-white text-2xl font-bold"
              style={{ backgroundColor: primaryColor }}
            >
              {name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Nome do Restaurante */}
        <div className="flex items-center justify-between mt-8">
          <h1 className="text-2xl font-bold text-foreground">{name}</h1>
        </div>

        {/* Informações */}
        {!tableInfo && (
          <p className="text-sm text-muted-foreground mt-1">
            {distance} • Min R$ {minOrder?.toFixed(2) || "17,00"}
          </p>
        )}

        {tableInfo && (
          <p className="text-sm font-medium mt-1" style={{ color: primaryColor }}>
            {tableInfo}
          </p>
        )}

        {/* Avaliação - Clicável */}
        <button
          onClick={() => setReviewsOpen(true)}
          className="flex items-center gap-2 mt-3 cursor-pointer hover:opacity-80 transition-opacity w-full text-left"
        >
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={`w-4 h-4 ${
                  rating > 0 && star <= Math.round(rating)
                    ? "fill-yellow-400 text-yellow-400"
                    : "text-gray-300"
                }`}
              />
            ))}
          </div>
          <span className="font-semibold text-foreground">
            {rating > 0 ? rating.toFixed(1) : "0,0"}
          </span>
          <span className="text-sm text-muted-foreground underline">
            ({reviewCount} {reviewCount === 1 ? 'avaliação' : 'avaliações'})
          </span>
        </button>

        <ReviewsDrawer
          open={reviewsOpen}
          onOpenChange={setReviewsOpen}
          restaurantId={restaurantId}
          rating={rating}
          reviewCount={reviewCount}
        />

        {/* Tempo e Taxa */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
          {!tableInfo ? (
            <>
              <span className="text-sm font-medium text-foreground">Padrão</span>
              <span className="text-xs text-muted-foreground">
                {deliveryTime} • R$ {deliveryFee.toFixed(2)}
              </span>
            </>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground mt-2">
          {tableInfo ? "Faça seu pedido pelo cardápio" : "Mais opções disponíveis na sacola"}
        </p>
      </div>
    </Card>
  );
};

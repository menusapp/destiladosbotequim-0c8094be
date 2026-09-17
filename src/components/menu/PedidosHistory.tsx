import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Clock, MapPin, Package, Star, ShoppingCart } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ReviewModal } from "./ReviewModal";
import { toast } from "@/components/ui/sonner";

import { novoId } from "@/lib/uuid";
import { telefoneClienteSalvo } from "@/lib/customerPhone";
interface PedidosHistoryProps {
  customerCPF: string;
  restaurantId: string;
  restaurantSlug: string;
  onAddToCart: (items: any[]) => void;
}

export const PedidosHistory = ({
  customerCPF,
  restaurantId,
  restaurantSlug,
  onAddToCart,
}: PedidosHistoryProps) => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<Record<string, any>>({});
  const [selectedOrderForReview, setSelectedOrderForReview] = useState<any>(null);
  const [restaurantName, setRestaurantName] = useState("");

  useEffect(() => {
    fetchOrders();

    // Poll for updates instead of realtime subscription
    const interval = setInterval(() => {
      fetchOrders();
    }, 15000);

    return () => {
      clearInterval(interval);
    };
  }, [customerCPF, restaurantId]);

  const fetchOrders = async () => {
    try {
      // Passa o telefone quando o cardápio já o conhece: a RPC então confere
      // CPF + telefone em vez de só o CPF.
      const { data: rpcData, error } = await (supabase as any).rpc("get_customer_orders", {
        p_cpf: customerCPF,
        p_phone: telefoneClienteSalvo(restaurantSlug),
      });

      if (error) throw error;

      // Filter for this restaurant + delivery orders, then fetch full details
      // (with nested items/extras) per order via get_order_details.
      const filteredOrders = (rpcData || []).filter(
        (o: any) => o.restaurant_id === restaurantId && o.order_type === "delivery"
      );
      filteredOrders.sort(
        (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      const data = await Promise.all(
        filteredOrders.map(async (o: any) => {
          const { data: details } = await (supabase as any).rpc("get_order_details", {
            p_order_id: o.id,
          });
          return details || o;
        })
      );
      
      // Buscar nome do restaurante
      if (data && data.length > 0) {
        const { data: restaurantData } = await supabase
          .from("restaurants")
          .select("name")
          .eq("id", restaurantId)
          .single();
        
        if (restaurantData) {
          setRestaurantName(restaurantData.name);
        }
        
        // Buscar reviews para todos os pedidos
        const orderIds = data.map(o => o.id);
        const { data: reviewsData } = await supabase
          .from("restaurant_reviews")
          .select("*")
          .in("order_id", orderIds);
        
        // Criar mapa de reviews por order_id
        const reviewsMap: Record<string, any> = {};
        reviewsData?.forEach(r => {
          if (r.order_id) reviewsMap[r.order_id] = r;
        });
        setReviews(reviewsMap);
      }
      
      setOrders(data || []);
    } catch (error) {
      console.error("Error fetching orders:", error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusLabel = (status: string, deliveryType?: string) => {
    const labels: Record<string, string> = {
      pending: "Pedido Recebido",
      accepted: "Em Preparo",
      ready: deliveryType === "pickup" ? "Pronto para Retirada" : "Saiu para Entrega",
      delivered: "Entregue",
      picked_up: "Retirado",
      cancelled: "Cancelado",
    };
    return labels[status] || status;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: "bg-yellow-500",
      accepted: "bg-blue-500",
      ready: "bg-orange-500",
      delivered: "bg-green-500",
      picked_up: "bg-purple-500",
      cancelled: "bg-red-500",
    };
    return colors[status] || "bg-gray-500";
  };

  const calculateTotal = (order: any) => {
    return order.order_items?.reduce((sum: number, item: any) => {
      const itemTotal = item.price_at_order * item.quantity;
      const extrasTotal = item.order_item_extras?.reduce(
        (s: number, e: any) => s + e.price_at_order,
        0
      ) || 0;
      return sum + itemTotal + extrasTotal;
    }, 0) || 0;
  };

  const handleReorder = (order: any) => {
    const items = order.order_items.map((item: any) => ({
      id: novoId(),
      product: {
        id: item.products.id,
        name: item.products.name,
        price: item.products.price,
        category_id: item.products.category_id,
        available: true,
      },
      quantity: item.quantity,
      extras: item.order_item_extras?.map((extra: any) => ({
        id: extra.product_extras?.id,
        name: extra.product_extras?.name,
        price: extra.product_extras?.price,
      })) || [],
      notes: item.notes || ""
    }));
    
    onAddToCart(items);
    toast.success(`${items.length} ${items.length === 1 ? 'item adicionado' : 'itens adicionados'} à sacola!`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center px-4">
        <Package className="w-16 h-16 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">Nenhum pedido ainda</h3>
        <p className="text-sm text-muted-foreground">
          Seus pedidos aparecerão aqui após a primeira compra
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-180px)]">
      <div className="space-y-4 p-4 pb-20">
        {orders.map((order) => (
          <Card 
            key={order.id}
            className="cursor-pointer hover:bg-accent transition-colors"
            onClick={() => navigate(`/${restaurantSlug}/pedido/${order.id}`)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-base">
                    Pedido #{order.id.slice(0, 8)}
                  </CardTitle>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    {format(new Date(order.created_at), "dd/MM/yyyy 'às' HH:mm", {
                      locale: ptBR,
                    })}
                  </div>
                </div>
                <Badge className={getStatusColor(order.status)}>
                  {getStatusLabel(order.status, order.delivery_type)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {order.delivery_address && (
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <span className="text-muted-foreground">
                    {order.delivery_address}
                  </span>
                </div>
              )}
              
              <Separator />
              
              <div className="space-y-2">
                {order.order_items?.map((item: any) => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <span>
                      {item.quantity}x {item.products?.name}
                      {item.order_item_extras?.length > 0 && (
                        <span className="text-muted-foreground text-xs block ml-4">
                          {item.order_item_extras
                            .map((e: any) => e.product_extras?.name)
                            .join(", ")}
                        </span>
                      )}
                    </span>
                    <span className="font-medium">
                      R$ {((item.price_at_order * item.quantity) + 
                        (item.order_item_extras?.reduce((s: number, e: any) => s + e.price_at_order, 0) || 0)
                      ).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
              
              <Separator />
              
              <div className="flex justify-between font-semibold">
                <span>Total</span>
                <span>R$ {calculateTotal(order).toFixed(2)}</span>
              </div>

              {/* Review Section */}
              {(order.status === "delivered" || order.status === "picked_up") && (
                <>
                  <Separator className="my-3" />
                  <div className="space-y-3">
                    {/* Estrelas */}
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!reviews[order.id]) {
                              setSelectedOrderForReview(order);
                            }
                          }}
                          disabled={!!reviews[order.id]}
                          className={`transition-all ${!reviews[order.id] ? 'hover:scale-110' : ''}`}
                        >
                          <Star
                            className={`w-5 h-5 ${
                              reviews[order.id] && star <= reviews[order.id].rating
                                ? "fill-yellow-400 text-yellow-400"
                                : "text-gray-300"
                            }`}
                          />
                        </button>
                      ))}
                      {reviews[order.id] && (
                        <span className="text-xs text-muted-foreground ml-2">
                          Avaliado
                        </span>
                      )}
                    </div>
                    
                    {/* Botão Reordenar */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReorder(order);
                      }}
                      className="w-full"
                    >
                      <ShoppingCart className="w-4 h-4 mr-2" />
                      Adicione à sacola
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Review Modal */}
      {selectedOrderForReview && (
        <ReviewModal
          open={!!selectedOrderForReview}
          onClose={() => {
            setSelectedOrderForReview(null);
            fetchOrders();
          }}
          restaurantId={restaurantId}
          restaurantName={restaurantName}
          orderId={selectedOrderForReview.id}
        />
      )}
    </ScrollArea>
  );
};

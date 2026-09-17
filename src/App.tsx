import { lazy, Suspense } from "react";

// Auto-recover from stale chunk errors after a redeploy.
// When index.html references a JS hash that no longer exists, force one reload.
const lazyWithRetry = <T,>(factory: () => Promise<{ default: T }>) =>
  lazy(() =>
    factory().catch((err) => {
      const msg = String(err?.message || err);
      if (
        /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(
          msg
        )
      ) {
        const key = "__chunk_reloaded__";
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, "1");
          window.location.reload();
          return new Promise(() => {}) as any;
        }
      }
      throw err;
    })
  );
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ESTABLISHMENT } from "@/config/establishment";
import { MetaPixelRouteTracker } from "@/components/MetaPixelRouteTracker";

import { SupabaseErrorToaster } from "@/components/SupabaseErrorToaster";
const LandingDestilado = lazyWithRetry(() => import("./pages/LandingDestilado"));
const LandingPage = lazyWithRetry(() => import("./pages/LandingPage"));
const LandingPageV2 = lazyWithRetry(() => import("./pages/LandingPageV2"));
const LandingPageV3 = lazyWithRetry(() => import("./pages/LandingPageV3"));
const LandingHamburgueria = lazyWithRetry(() => import("./pages/LandingHamburgueria"));
const LandingPizzaria = lazyWithRetry(() => import("./pages/LandingPizzaria"));
const LandingBar = lazyWithRetry(() => import("./pages/LandingBar"));
const LandingSushi = lazyWithRetry(() => import("./pages/LandingSushi"));
const LandingMarmitaria = lazyWithRetry(() => import("./pages/LandingMarmitaria"));
const LandingSorveteria = lazyWithRetry(() => import("./pages/LandingSorveteria"));
const RestaurantLogin = lazyWithRetry(() => import("./pages/RestaurantLogin"));
const CEOLogin = lazyWithRetry(() => import("./pages/CEOLogin"));
const CEODashboard = lazyWithRetry(() => import("./pages/CEODashboard"));
const RestaurantAdmin = lazyWithRetry(() => import("./pages/RestaurantAdmin"));
const Menu = lazyWithRetry(() => import("./pages/Menu"));
const Comanda = lazyWithRetry(() => import("./pages/Comanda"));
const DeliveryMenu = lazyWithRetry(() => import("./pages/DeliveryMenu"));
const OrderConfirmation = lazyWithRetry(() => import("./pages/OrderConfirmation"));
const Reservations = lazyWithRetry(() => import("./pages/Reservations"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));
const StaffLogin = lazyWithRetry(() => import("./pages/StaffLogin"));
const TableDetailView = lazyWithRetry(() =>
  import("./components/admin/TableDetailView").then((m) => ({ default: m.TableDetailView }))
);
const MercadoPagoCallback = lazyWithRetry(() => import("./pages/MercadoPagoCallback"));
const RestaurantRegistration = lazyWithRetry(() => import("./pages/RestaurantRegistration"));
const PaymentPending = lazyWithRetry(() => import("./pages/PaymentPending"));
const PaymentConfirmed = lazyWithRetry(() => import("./pages/PaymentConfirmed"));
const Kiosk = lazyWithRetry(() => import("./pages/Kiosk"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-3">
      <div className="h-10 w-10 rounded-full border-2 border-muted border-t-primary animate-spin" />
      <p className="text-sm text-muted-foreground">Carregando...</p>
    </div>
  </div>
);

const App = () => (
  <BrowserRouter>
    <SupabaseErrorToaster />
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <MetaPixelRouteTracker />

          <Suspense fallback={<RouteFallback />}>
            <Routes>
              {/* Rotas estáticas globais — devem vir ANTES de qualquer rota dinâmica e da raiz "/" */}
              <Route path="/pagamento-confirmado" element={<PaymentConfirmed />} />
              <Route path="/v1" element={<LandingPage />} />
              <Route path="/v2" element={<LandingPageV2 />} />
              <Route path="/v3" element={<LandingPageV3 />} />
              <Route path="/hamburgueria" element={<LandingHamburgueria />} />
              <Route path="/pizzaria" element={<LandingPizzaria />} />
              <Route path="/bar" element={<LandingBar />} />
              <Route path="/sushi" element={<LandingSushi />} />
              <Route path="/marmitaria" element={<LandingMarmitaria />} />
              <Route path="/sorveteria" element={<LandingSorveteria />} />

              {/*
                Quando acessado via subdomínio do restaurante (ex.: rods.menusapp.com.br/),
                a raiz "/" carrega o cardápio delivery; caso contrário mostra a landing.
              */}
              {/*
                App de estabelecimento único: a raiz "/" é a landing
                cinematográfica do Destilado Botequim. O cardápio fica em
                /cardapio (e também no slug). A equipe entra pelo /login.
              */}
              <Route path="/" element={<LandingDestilado />} />
              <Route path="/cardapio" element={<Navigate to={`/${ESTABLISHMENT.slug}`} replace />} />

              {/* Auth routes */}
              <Route path="/login" element={<RestaurantLogin />} />
              <Route path="/login/staff" element={<StaffLogin />} />
              <Route path="/login/ceo" element={<CEOLogin />} />

              {/* CEO Dashboard */}
              <Route path="/ceo" element={<CEODashboard />} />

              {/* MercadoPago callback */}
              <Route path="/admin/mercadopago/callback" element={<MercadoPagoCallback />} />

              {/* Registration routes (post-payment redirect) */}
              <Route path="/registro/:planSlug" element={<RestaurantRegistration />} />
              <Route path="/pagamento-pendente/:slug" element={<PaymentPending />} />

              {/* Restaurant-scoped routes (slug-based) */}
              <Route path="/:slug/kiosk" element={<Kiosk />} />
              <Route path="/:slug" element={<DeliveryMenu />} />
              {/* Pretty alias for subdomain links: rods.menusapp.com.br/menus */}
              <Route path="/:slug/menus" element={<DeliveryMenu />} />
              <Route path="/:slug/mesa/:tableNumber" element={<Menu />} />
              <Route path="/:slug/comanda/:tableNumber" element={<Comanda />} />
              <Route path="/:slug/pedido/:orderId" element={<OrderConfirmation />} />
              <Route path="/:slug/reservas" element={<Reservations />} />
              <Route
                path="/:slug/admin"
                element={
                  <ProtectedRoute>
                    <RestaurantAdmin />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/:slug/admin/mesa/:tableId"
                element={
                  <ProtectedRoute>
                    <TableDetailView />
                  </ProtectedRoute>
                }
              />

              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </BrowserRouter>
);

export default App;

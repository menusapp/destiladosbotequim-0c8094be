import { ShoppingBag, CreditCard, Users2, MoreHorizontal, BarChart3, Utensils, Warehouse, CircleDollarSign, TrendingUp, Users, Gift, Megaphone, Bot, Plug, FileText, Construction, Settings, Building2, Monitor, MessageSquare } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useState } from "react";

interface MobileBottomNavProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  hasNewDeliveryOrders?: boolean;
  hasNewBills?: boolean;
  hasNewLocalOrders?: boolean;
  primaryColor?: string;
  staffRole?: string;
  staffAllowedSections?: string[];
}

const PRIMARY_TABS = [
  { id: "pedidos", label: "Pedidos", icon: ShoppingBag },
  { id: "pdv", label: "PDV", icon: CreditCard },
  { id: "mesas-reservas", label: "Reservas", icon: Users2 },
];

const MORE_TABS = [
  { id: "visao-geral", label: "Visão Geral", icon: BarChart3 },
  { id: "cardapio", label: "Cardápio", icon: Utensils },
  { id: "estoque", label: "Estoque", icon: Warehouse },
  { id: "caixa", label: "Caixa", icon: CircleDollarSign },
  { id: "custos", label: "Custos", icon: CircleDollarSign },
  { id: "margens", label: "Margens", icon: TrendingUp },
  { id: "relatorios", label: "Relatório DRE", icon: BarChart3 },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "fidelidade", label: "Fidelidade", icon: Gift },
  { id: "marketing", label: "Marketing", icon: Megaphone },
  { id: "robo-menus", label: "Robô Menu's", icon: Bot },
  { id: "integracoes", label: "Integrações", icon: Plug },
  { id: "fiscal", label: "Fiscal", icon: FileText },
  { id: "contas", label: "Contas", icon: Users },
  { id: "modulos", label: "Planos", icon: Construction },
  { id: "config-dados", label: "Configurações Gerais", icon: Building2 },
  { id: "config-totem", label: "Totem", icon: Monitor },
  { id: "config-whatsapp", label: "WhatsApp", icon: MessageSquare },
];

export function MobileBottomNav({
  activeSection,
  onSectionChange,
  hasNewDeliveryOrders,
  hasNewBills,
  hasNewLocalOrders,
  primaryColor = "#184a2d",
  staffRole,
  staffAllowedSections,
}: MobileBottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  const isStaffAllowed = (id: string) => {
    if (!staffRole || staffRole === "admin") return true;
    return staffAllowedSections?.includes(id) ?? false;
  };

  const primaryTabs = PRIMARY_TABS.filter((t) => isStaffAllowed(t.id));
  const moreTabs = MORE_TABS.filter((t) => isStaffAllowed(t.id));

  const isPrimaryActive = primaryTabs.some((t) => t.id === activeSection);

  const handleSelect = (id: string) => {
    onSectionChange(id);
    setMoreOpen(false);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden border-t border-border bg-background"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navegação principal"
    >
      <div className="grid h-16" style={{ gridTemplateColumns: `repeat(${primaryTabs.length + 1}, minmax(0, 1fr))` }}>
        {primaryTabs.map((tab) => {
          const isActive = activeSection === tab.id;
          let hasDot = false;
          if (tab.id === "pedidos") hasDot = !!(hasNewDeliveryOrders || hasNewBills);
          if (tab.id === "pdv") hasDot = !!hasNewLocalOrders;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSectionChange(tab.id)}
              className="relative flex flex-col items-center justify-center gap-0.5 min-h-[44px] active:opacity-70 transition-opacity"
              style={isActive ? { color: primaryColor } : undefined}
              aria-current={isActive ? "page" : undefined}
              aria-label={tab.label}
            >
              <tab.icon
                className="h-5 w-5"
                style={isActive ? { color: primaryColor } : { color: "hsl(var(--muted-foreground))" }}
              />
              <span
                className={`text-[11px] leading-tight ${isActive ? "font-semibold" : "text-muted-foreground"}`}
              >
                {tab.label}
              </span>
              {hasDot && (
                <span className="absolute top-1.5 right-1/2 translate-x-3 h-2 w-2 bg-primary rounded-full" />
              )}
            </button>
          );
        })}

        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className="relative flex flex-col items-center justify-center gap-0.5 min-h-[44px] active:opacity-70 transition-opacity"
              style={!isPrimaryActive ? { color: primaryColor } : undefined}
              aria-label="Mais opções"
            >
              <MoreHorizontal
                className="h-5 w-5"
                style={
                  !isPrimaryActive
                    ? { color: primaryColor }
                    : { color: "hsl(var(--muted-foreground))" }
                }
              />
              <span
                className={`text-[11px] leading-tight ${!isPrimaryActive ? "font-semibold" : "text-muted-foreground"}`}
              >
                Mais
              </span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[80vh] rounded-t-2xl p-0 overflow-hidden flex flex-col">
            <SheetHeader className="p-4 border-b">
              <SheetTitle className="text-left">Mais opções</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-3">
              <div className="grid grid-cols-3 gap-2">
                {moreTabs.map((tab) => {
                  const isActive = activeSection === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => handleSelect(tab.id)}
                      className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border min-h-[80px] text-center transition-colors ${
                        isActive ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted"
                      }`}
                      style={isActive ? { borderColor: primaryColor, color: primaryColor } : undefined}
                    >
                      <tab.icon className="h-6 w-6" />
                      <span className="text-xs leading-tight font-medium">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}

import { useState, Fragment } from "react";
import {
  ShoppingBag,
  CreditCard,
  Users2,
  Utensils,
  Warehouse,
  BarChart3,
  TrendingUp,
  Users,
  Settings,
  CircleDollarSign,
  Construction,
  ChevronDown,
  ChevronRight,
  Building2,
  MessageSquare,
  Megaphone,
  Gift,
  FileText,
  Plug,
  Monitor,
  Bot,
  Lock,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface AppSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  hasNewOrders?: boolean;
  hasNewBills?: boolean;
  hasNewDeliveryOrders?: boolean;
  hasNewLocalOrders?: boolean;
  isSectionAllowed?: (sectionId: string) => boolean;
  hasActiveSubscription?: boolean | null;
  staffRole?: string;
  staffAllowedSections?: string[];
  primaryColor?: string;
  onPrefetch?: (sectionId: string) => void;
}

export function AppSidebar({ activeSection, onSectionChange, hasNewOrders, hasNewBills, hasNewDeliveryOrders, hasNewLocalOrders, isSectionAllowed, hasActiveSubscription, staffRole, staffAllowedSections, primaryColor = "#184a2d", onPrefetch }: AppSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const [configOpen, setConfigOpen] = useState(activeSection.startsWith("config-"));

  const menuGroups = [
    [
      { id: "visao-geral", label: "Visão Geral", icon: BarChart3 },
    ],
    [
      { id: "pedidos", label: "Pedidos", icon: ShoppingBag, hasNotification: (hasNewDeliveryOrders || hasNewOrders || hasNewBills) },
      { id: "pdv", label: "PDV", icon: CreditCard, hasNotification: !!hasNewLocalOrders },
      { id: "mesas-reservas", label: "Reservas", icon: Users2 },
    ],
    [
      { id: "cardapio", label: "Cardápio", icon: Utensils },
      { id: "estoque", label: "Estoque", icon: Warehouse },
    ],
    [
      { id: "caixa", label: "Caixa", icon: CircleDollarSign },
      { id: "custos", label: "Custos", icon: CircleDollarSign },
      { id: "margens", label: "Margens", icon: TrendingUp },
      { id: "relatorios", label: "Relatório DRE", icon: BarChart3 },
    ],
    [
      { id: "clientes", label: "Clientes", icon: Users },
      { id: "fidelidade", label: "Fidelidade", icon: Gift },
      { id: "marketing", label: "Marketing", icon: Megaphone },
      { id: "robo-menus", label: "Robô Menu's", icon: Bot },
    ],
    [
      { id: "integracoes", label: "Integrações", icon: Plug },
      { id: "fiscal", label: "Fiscal", icon: FileText },
      { id: "contas", label: "Contas", icon: Users },
      { id: "modulos", label: "Planos", icon: Construction },
    ],
  ];

  const menuStructure = {
    configSubItems: [
      { id: "config-dados", label: "Geral", icon: Building2 },
      { id: "config-totem", label: "Totem", icon: Monitor },
      { id: "config-whatsapp", label: "Notificações WhatsApp", icon: MessageSquare },
    ],
  };

  const isConfigActive = activeSection.startsWith("config-");
  const checkAllowed = (id: string) => !isSectionAllowed || isSectionAllowed(id);
  
  const isStaffAllowed = (id: string) => {
    if (!staffRole || staffRole === "admin") return true;
    return staffAllowedSections?.includes(id) ?? false;
  };

  const isBlocked = (id: string) => !checkAllowed(id) || !isStaffAllowed(id);

  // Hide items the staff has no permission for; plan-blocked items still show with lock
  const allGroups = menuGroups
    .map((group) => group.filter((item) => isStaffAllowed(item.id)))
    .filter((group) => group.length > 0);
  const allConfig = menuStructure.configSubItems.filter((item) => isStaffAllowed(item.id));

  return (
    <Sidebar collapsible="offcanvas" className="border-r border-sidebar-border bg-sidebar-background w-[260px]">
      <SidebarContent className="bg-sidebar-background">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5 px-2 pt-3">
              {allGroups.map((group, groupIndex) => (
                <Fragment key={groupIndex}>
                  {groupIndex > 0 && (
                    <div className="py-1.5 px-3">
                      <div className="h-px bg-sidebar-border" />
                    </div>
                  )}
                  {group.map((item) => {
                    const blocked = isBlocked(item.id);
                    return (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          onClick={() => onSectionChange(item.id)}
                          onMouseEnter={() => onPrefetch?.(item.id)}
                          isActive={activeSection === item.id}
                          tooltip={item.label}
                          className={`relative h-10 px-3 rounded-button text-[15px] transition-colors ${
                            activeSection === item.id 
                              ? "font-medium" 
                              : blocked
                                ? "text-sidebar-foreground/50 hover:bg-muted"
                                : "text-sidebar-foreground hover:bg-muted"
                          }`}
                          style={activeSection === item.id ? { backgroundColor: '#e8f0ea', color: '#184a2d' } : undefined}
                        >
                          <item.icon className="h-5 w-5" />
                          {!collapsed && <span>{item.label}</span>}
                          {blocked && !collapsed && (
                            <Lock className="absolute right-2 h-3 w-3 text-muted-foreground/60" />
                          )}
                          {item.hasNotification && !blocked && !collapsed && (
                            <span className="absolute right-2 h-1.5 w-1.5 bg-primary rounded-full"></span>
                          )}
                          {item.hasNotification && !blocked && collapsed && (
                            <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 bg-primary rounded-full"></span>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </Fragment>
              ))}
              
              {/* Configurações — always visible */}
              <SidebarMenuItem>
                <Collapsible open={configOpen} onOpenChange={setConfigOpen}>
                  <CollapsibleTrigger asChild>
                     <SidebarMenuButton
                      tooltip="Configurações"
                      className={`w-full h-10 px-3 rounded-button text-[15px] ${isConfigActive ? "font-medium" : "text-sidebar-foreground hover:bg-muted"}`}
                      style={isConfigActive ? { backgroundColor: '#e8f0ea', color: '#184a2d' } : undefined}
                    >
                      <Settings className="h-5 w-5" />
                      {!collapsed && (
                        <>
                          <span className="flex-1 text-left">Configurações</span>
                          {configOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </>
                      )}
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  {!collapsed && (
                    <CollapsibleContent className="pl-4 space-y-0.5 mt-0.5">
                      {allConfig.map((subItem) => {
                        const subBlocked = isBlocked(subItem.id);
                        return (
                          <SidebarMenuButton
                            key={subItem.id}
                            onClick={() => onSectionChange(subItem.id)}
                            onMouseEnter={() => onPrefetch?.(subItem.id)}
                            isActive={activeSection === subItem.id}
                           className={`w-full h-9 px-3 rounded-button text-[14px] ${
                              activeSection === subItem.id
                                ? "font-medium"
                                : subBlocked
                                  ? "text-sidebar-foreground/50 hover:bg-muted"
                                  : "text-sidebar-foreground hover:bg-muted"
                            }`}
                            style={activeSection === subItem.id ? { backgroundColor: '#e8f0ea', color: '#184a2d' } : undefined}
                          >
                            <subItem.icon className="h-4 w-4" />
                            <span>{subItem.label}</span>
                            {subBlocked && (
                              <Lock className="ml-auto h-3 w-3 text-muted-foreground/60" />
                            )}
                          </SidebarMenuButton>
                        );
                      })}
                    </CollapsibleContent>
                  )}
                </Collapsible>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>
    </Sidebar>
  );
}

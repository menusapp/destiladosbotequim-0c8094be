import { useState } from "react";
import { Copy, Store, Settings, Menu } from "lucide-react";
import { AccountSettingsDialog } from "./AccountSettingsDialog";
import { Button } from "@/components/ui/button";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { clearSessionTimestamp } from "@/lib/sessionExpiry";

import { RealtimeStatusIndicator } from "./RealtimeStatusIndicator";
import { TourButton } from "./tour/TourButton";

import { copiarTexto } from "@/lib/clipboard";
interface AdminHeaderProps {
  restaurantId: string;
  restaurantSlug: string;
  prepTime: number;
  pickupTime: number;
  isOpen: boolean;
  autoOpenClose?: boolean;
  /** Seção ativa do painel — usada pelo botão Tour para iniciar o tour correto. */
  activeSection?: string;
  onPrepTimeUpdate: (time: number) => void;
  onPickupTimeUpdate: (time: number) => void;
  onIsOpenUpdate: (isOpen: boolean) => void;
}

export const AdminHeader = ({
  restaurantId,
  restaurantSlug,
  prepTime,
  pickupTime,
  isOpen,
  autoOpenClose = false,
  activeSection,
  onPrepTimeUpdate,
  onPickupTimeUpdate,
  onIsOpenUpdate,
}: AdminHeaderProps) => {
  const navigate = useNavigate();
  const { state: sidebarState, toggleSidebar } = useSidebar();
  const sidebarOpen = sidebarState === "expanded";
  
  const [updatingOpen, setUpdatingOpen] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);

  const handleToggleOpen = async () => {
    setUpdatingOpen(true);
    const newIsOpen = !isOpen;
    
    const { error } = await supabase
      .from("restaurants")
      .update({ is_open: newIsOpen })
      .eq("id", restaurantId);

    if (error) {
      toast.error("Erro ao atualizar status do restaurante");
      setUpdatingOpen(false);
      return;
    }

    onIsOpenUpdate(newIsOpen);
    toast.success(newIsOpen ? "Restaurante aberto!" : "Restaurante fechado!");
    setUpdatingOpen(false);
  };

  const menuUrl = `${window.location.origin}/${restaurantSlug}`;

  const handleCopyUrl = () => {
    copiarTexto(menuUrl);
    toast.success("Link copiado!");
  };

  const handleLogout = () => {
    // Clear staff session, keep restaurant session
    localStorage.removeItem('staff_id');
    localStorage.removeItem('staff_name');
    localStorage.removeItem('staff_role');
    localStorage.removeItem('staff_allowed_sections');
    localStorage.removeItem('staff_can_manage_orders');
    localStorage.removeItem('staff_receives_order_notifications');
    toast.success("Logout realizado com sucesso");
    navigate("/login/staff");
  };

  const handleFullLogout = () => {
    localStorage.removeItem('restaurant_id');
    localStorage.removeItem('restaurant_name');
    localStorage.removeItem('staff_id');
    localStorage.removeItem('staff_name');
    localStorage.removeItem('staff_role');
    localStorage.removeItem('restaurant_slug');
    localStorage.removeItem('staff_allowed_sections');
    localStorage.removeItem('staff_can_manage_orders');
    localStorage.removeItem('staff_receives_order_notifications');
    clearSessionTimestamp();
    toast.success("Logout realizado com sucesso");
    navigate("/login");
  };

  const userName = localStorage.getItem('staff_name') || localStorage.getItem('restaurant_name') || 'Usuário';
  const staffRole = localStorage.getItem('staff_role');

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 sm:gap-3 border-b border-border bg-card px-2 sm:px-4">
      {/* Sidebar trigger — desktop only (mobile uses bottom nav) — animated burger */}
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={sidebarOpen ? "Fechar menu" : "Abrir menu"}
        aria-expanded={sidebarOpen}
        className="hidden md:flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-muted transition-colors group"
      >
        <span className="relative block w-5 h-5">
          <span
            className="absolute left-0 block h-[2px] w-5 bg-foreground rounded-full transition-all duration-300 ease-out"
            style={{
              top: sidebarOpen ? "9px" : "4px",
              transform: sidebarOpen ? "rotate(45deg)" : "rotate(0deg)",
            }}
          />
          <span
            className="absolute left-0 top-[9px] block h-[2px] w-5 bg-foreground rounded-full transition-all duration-200 ease-out"
            style={{
              opacity: sidebarOpen ? 0 : 1,
              transform: sidebarOpen ? "scaleX(0)" : "scaleX(1)",
            }}
          />
          <span
            className="absolute left-0 block h-[2px] w-5 bg-foreground rounded-full transition-all duration-300 ease-out"
            style={{
              top: sidebarOpen ? "9px" : "14px",
              transform: sidebarOpen ? "rotate(-45deg)" : "rotate(0deg)",
            }}
          />
        </span>
      </button>

      {/* Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <img src="/logo-menus.png" alt="Menus" className="h-7 w-7" />
        <span className="font-semibold text-sm text-foreground hidden sm:inline">Menus</span>
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-border" />

      {/* Link do Cardápio — hidden on mobile to save space */}
      <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-muted rounded-button">
        <a
          href={menuUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-label text-primary hover:underline font-medium"
        >
          {restaurantSlug}
        </a>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleCopyUrl}
        >
          <Copy className="h-3 w-3" />
        </Button>
      </div>

      {/* Prep/Pickup times compact */}
      <div className="hidden lg:flex items-center gap-2 text-label text-muted-foreground">
        <span>Espera: {prepTime}min</span>
        <span className="text-border">·</span>
        <span>Retirada: {pickupTime}min</span>
      </div>

      <div className="flex-1" />

      {/* Realtime connection status */}
      <RealtimeStatusIndicator />

      {/* Tour guiado da seção ativa — desktop only */}
      {activeSection && (
        <div className="hidden md:flex">
          <TourButton sectionId={activeSection} />
        </div>
      )}

      {/* Toggle Abrir/Fechar — desktop only */}
      <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-button border border-border">
        <Store className={`h-3.5 w-3.5 ${isOpen ? 'text-green-500' : 'text-destructive'}`} />
        <span className={`text-label font-medium ${isOpen ? 'text-green-500' : 'text-destructive'}`}>
          {isOpen ? 'Aberto' : 'Fechado'}
        </span>
        {autoOpenClose && (
          <span className="text-small text-muted-foreground">(Auto)</span>
        )}
        <Switch
          checked={isOpen}
          onCheckedChange={handleToggleOpen}
          disabled={updatingOpen || autoOpenClose}
          className="data-[state=checked]:bg-green-500 h-4 w-8"
        />
      </div>


      {/* User */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="flex items-center gap-2 h-8 px-2">
            <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-small font-medium text-primary">
                {userName.charAt(0).toUpperCase()}
              </span>
            </div>
            <span className="text-label font-medium hidden sm:inline">{userName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {staffRole && <DropdownMenuItem className="text-xs text-muted-foreground" disabled>{staffRole === 'admin' ? 'Administrador' : staffRole.charAt(0).toUpperCase() + staffRole.slice(1)}</DropdownMenuItem>}
          <DropdownMenuItem onClick={() => setAccountDialogOpen(true)}>
            <Settings className="h-4 w-4 mr-2" />
            Dados da Conta
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleLogout}>Trocar Conta</DropdownMenuItem>
          <DropdownMenuItem onClick={handleFullLogout}>Sair do Restaurante</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AccountSettingsDialog
        open={accountDialogOpen}
        onOpenChange={setAccountDialogOpen}
        restaurantId={restaurantId}
      />
    </header>
  );
};

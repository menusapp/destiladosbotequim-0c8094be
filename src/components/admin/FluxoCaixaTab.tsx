import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel";
import { useCargaInicial } from "@/hooks/useCargaInicial";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "@/components/ui/sonner";
import { DollarSign, TrendingUp, TrendingDown, Wallet, FileText, PlusCircle, MinusCircle, ChevronDown, Receipt, Coins, Search, Calendar as CalendarIcon, Printer } from "lucide-react";
import { formatPaymentMethod } from "@/lib/utils";
import { format, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import CashMovementDetailSheet from "./CashMovementDetailSheet";
import type { DateRange } from "react-day-picker";

interface FluxoCaixaTabProps {
  restaurantId: string;
}

interface CashSession {
  id: string;
  opened_by: string;
  closed_by: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_balance: number;
  closing_balance: number | null;
  expected_balance: number | null;
  difference: number | null;
  status: string;
  notes: string | null;
}

interface CashMovement {
  id: string;
  cash_session_id: string;
  movement_type: string;
  amount: number;
  description: string;
  category: string | null;
  payment_method: string | null;
  created_by: string;
  created_at: string;
  bill_id: string | null;
  order_id: string | null;
}

const BILL_DENOMINATIONS = [200, 100, 50, 20, 10, 5, 2];
const COIN_DENOMINATIONS = [1, 0.5, 0.25, 0.1, 0.05];

export default function FluxoCaixaTab({ restaurantId }: FluxoCaixaTabProps) {
  const [currentSession, setCurrentSession] = useState<CashSession | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [lastClosedSession, setLastClosedSession] = useState<CashSession | null>(null);
  const [loading, setLoading] = useState(true);

  // Estados para histórico de caixa
  const [closedSessions, setClosedSessions] = useState<CashSession[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [historyDateRange, setHistoryDateRange] = useState<{ from: Date; to: Date }>({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  });
  const [pendingHistoryDateRange, setPendingHistoryDateRange] = useState<DateRange | undefined>();
  const [historyDatePopoverOpen, setHistoryDatePopoverOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<CashSession | null>(null);
  const [selectedSessionMovements, setSelectedSessionMovements] = useState<CashMovement[]>([]);

  const [openedBy, setOpenedBy] = useState("");
  const [openingMode, setOpeningMode] = useState<"full" | "detailed">("full");
  const [fullOpeningBalance, setFullOpeningBalance] = useState("");
  const [billCounts, setBillCounts] = useState<Record<number, number>>(() => 
    Object.fromEntries(BILL_DENOMINATIONS.map(d => [d, 0]))
  );
  const [coinCounts, setCoinCounts] = useState<Record<number, number>>(() => 
    Object.fromEntries(COIN_DENOMINATIONS.map(d => [d, 0]))
  );
  
  const [closingBalance, setClosingBalance] = useState("");
  const [closedBy, setClosedBy] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [movementType, setMovementType] = useState("entrada");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementDescription, setMovementDescription] = useState("");
  const [movementCategory, setMovementCategory] = useState("");
  const [movementPaymentMethod, setMovementPaymentMethod] = useState("dinheiro");
  const [movementCreatedBy, setMovementCreatedBy] = useState("");
  const [movementDrawerOpen, setMovementDrawerOpen] = useState(false);
  const [selectedMovement, setSelectedMovement] = useState<CashMovement | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [historyMovementSearch, setHistoryMovementSearch] = useState("");

  const calculateOpeningBalance = () => {
    const billTotal = BILL_DENOMINATIONS.reduce((sum, d) => sum + d * (billCounts[d] || 0), 0);
    const coinTotal = COIN_DENOMINATIONS.reduce((sum, d) => sum + d * (coinCounts[d] || 0), 0);
    return billTotal + coinTotal;
  };

  useEffect(() => {
    fetchCurrentSession();
    fetchClosedSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  // Centralized realtime: cash_movements + sessions, debounced (300ms)
  useRealtimeChannel({
    channelName: `cash-rt-${restaurantId}`,
    bindings: [
      { table: "cash_movements", filter: `restaurant_id=eq.${restaurantId}` },
      { table: "cash_register_sessions", filter: `restaurant_id=eq.${restaurantId}` },
    ],
    onChange: () => {
      // Always refresh sessions; refresh movements only if there is an open session
      fetchCurrentSession();
      fetchClosedSessions();
      if (currentSession) fetchMovements();
    },
    debounceMs: 300,
  });

  useEffect(() => {
    if (currentSession) {
      fetchMovements();
    }
  }, [currentSession]);

  // O caixa é a tela mais atualizada do painel (Realtime + polling). Mostrar o
  // placeholder a cada ciclo remontava tudo — daí o flick. Agora só na entrada.
  const primeiraCarga = useCargaInicial(restaurantId);

  const fetchCurrentSession = async () => {
    if (primeiraCarga.pendente()) setLoading(true);
    try {
      const { data, error } = await supabase
        .from("cash_register_sessions")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      setCurrentSession(data);

      if (!data) {
        const { data: lastClosed, error: lastError } = await supabase
          .from("cash_register_sessions")
          .select("*")
          .eq("restaurant_id", restaurantId)
          .eq("status", "closed")
          .order("closed_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastError) throw lastError;
        setLastClosedSession(lastClosed);

        if (lastClosed) {
          const { data: lastMovements, error: movError } = await supabase
            .from("cash_movements")
            .select("*")
            .eq("cash_session_id", lastClosed.id)
            .order("created_at", { ascending: false });

          if (movError) throw movError;
          setMovements(lastMovements || []);
        }
      } else {
        setLastClosedSession(null);
      }
    } catch (error: any) {
      toast.error("Erro ao buscar sessão de caixa: " + error.message);
    } finally {
      primeiraCarga.concluir();
      setLoading(false);
    }
  };

  const fetchClosedSessions = async () => {
    try {
      const { data, error } = await supabase
        .from("cash_register_sessions")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("status", "closed")
        .order("closed_at", { ascending: false });

      if (error) throw error;
      setClosedSessions(data || []);
    } catch (error: any) {
      toast.error("Erro ao buscar histórico de caixas: " + error.message);
    }
  };

  const fetchMovements = async () => {
    if (!currentSession) return;
    
    try {
      const { data, error } = await supabase
        .from("cash_movements")
        .select("*")
        .eq("cash_session_id", currentSession.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setMovements(data || []);
    } catch (error: any) {
      toast.error("Erro ao buscar movimentações: " + error.message);
    }
  };

  const fetchSessionMovements = async (sessionId: string) => {
    try {
      const { data, error } = await supabase
        .from("cash_movements")
        .select("*")
        .eq("cash_session_id", sessionId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setSelectedSessionMovements(data || []);
    } catch (error: any) {
      toast.error("Erro ao buscar movimentações: " + error.message);
    }
  };

  const handleSelectSession = (session: CashSession) => {
    setSelectedSession(session);
    fetchSessionMovements(session.id);
  };

  const handlePrintSession = async (session: CashSession, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const { data: movs, error } = await supabase
        .from("cash_movements")
        .select("*")
        .eq("cash_session_id", session.id)
        .order("created_at", { ascending: true });

      if (error) throw error;
      const sessionMovements = (movs || []) as CashMovement[];

      const paymentTotals: Record<string, { total: number; count: number }> = {};
      let totalEntradas = 0;
      let totalSaidas = 0;

      sessionMovements.forEach((mov) => {
        if (mov.movement_type === "entrada") {
          totalEntradas += Number(mov.amount);
          const method = mov.payment_method || "outros";
          if (!paymentTotals[method]) paymentTotals[method] = { total: 0, count: 0 };
          paymentTotals[method].total += Number(mov.amount);
          paymentTotals[method].count += 1;
        } else if (mov.movement_type === "saida") {
          totalSaidas += Number(mov.amount);
        }
      });

      const fmt = (v: number) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;
      const fmtDate = (d: string | null) => d ? format(new Date(d), "dd/MM/yyyy 'às' HH:mm") : "—";
      const diff = Number(session.difference || 0);

      const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Relatório de Caixa - ${fmtDate(session.opened_at)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 0 auto; padding: 32px 40px; color: #111; max-width: 600px; font-size: 16px; }
    h1 { font-size: 28px; margin: 0 0 8px; text-align: center; }
    h2 { font-size: 18px; margin: 32px 0 16px; padding-bottom: 6px; border-bottom: 2px solid #111; text-transform: uppercase; letter-spacing: 0.5px; }
    .subtitle { text-align: center; font-size: 14px; color: #666; margin-bottom: 24px; }
    .section { margin-bottom: 24px; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dotted #ccc; }
    .row.label { font-weight: 600; color: #333; }
    .row.value { font-family: monospace; font-size: 18px; }
    .row.total { font-weight: 700; font-size: 20px; padding-top: 12px; border-top: 2px solid #111; border-bottom: none; }
    .method-row { display: flex; justify-content: space-between; padding: 6px 0 6px 20px; border-bottom: 1px dotted #ddd; }
    .method-name { flex: 1; }
    .method-count { width: 60px; text-align: center; color: #666; }
    .method-value { width: 120px; text-align: right; font-family: monospace; }
    .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 16px; }
    @media print { body { padding: 24px 32px; } .no-print { display: none !important; } }
  </style>
</head>
<body>
  <h1>Relatório de Fechamento de Caixa</h1>
  <div class="subtitle">Emitido em ${format(new Date(), "dd/MM/yyyy 'às' HH:mm")}</div>

  <h2>Informações da Sessão</h2>
  <div class="section">
    <div class="row"><span>Aberto por:</span><strong>${session.opened_by}</strong></div>
    <div class="row"><span>Data/hora de abertura:</span><span>${fmtDate(session.opened_at)}</span></div>
    <div class="row"><span>Fechado por:</span><strong>${session.closed_by || "—"}</strong></div>
    <div class="row"><span>Data/hora de fechamento:</span><span>${fmtDate(session.closed_at)}</span></div>
    <div class="row"><span>Status:</span><span>${session.status === "closed" ? "Fechado" : session.status}</span></div>
    <div class="row"><span>Total de movimentações:</span><span>${sessionMovements.length}</span></div>
  </div>
  ${session.notes ? `<div style="margin-top:16px;font-size:14px;font-style:italic;color:#555;"><strong>Observações:</strong> ${session.notes}</div>` : ""}

  <h2>Saldos</h2>
  <div class="section">
    <div class="row"><span>Saldo Inicial:</span><span class="row value">${fmt(session.opening_balance)}</span></div>
    <div class="row"><span>Saldo Esperado:</span><span class="row value">${fmt(session.expected_balance || 0)}</span></div>
    <div class="row"><span>Saldo Final (contado):</span><span class="row value">${fmt(session.closing_balance || 0)}</span></div>
    <div class="row total" style="color:${diff >= 0 ? '#16a34a' : '#dc2626'};"><span>Diferença:</span><span class="row value">${fmt(diff)}</span></div>
  </div>

  <h2>Vendas por Método de Pagamento</h2>
  <div class="section">
    ${Object.keys(paymentTotals).length === 0 ? `
      <p style="text-align:center;color:#666;font-size:14px;padding:12px 0;">Nenhuma entrada registrada nesta sessão.</p>
    ` : Object.entries(paymentTotals)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([method, info]) => `
          <div class="method-row">
            <span class="method-name">${formatPaymentMethod(method)}</span>
            <span class="method-count">${info.count}x</span>
            <span class="method-value">${fmt(info.total)}</span>
          </div>
        `).join("")
    }
  </div>

  <h2>Resumo Financeiro</h2>
  <div class="section">
    <div class="row"><span>Total de Entradas:</span><span class="row value" style="color:#16a34a;">+ ${fmt(totalEntradas)}</span></div>
    <div class="row"><span>Total de Saídas:</span><span class="row value" style="color:#dc2626;">- ${fmt(totalSaidas)}</span></div>
    <div class="row total"><span>Resultado Líquido:</span><span class="row value">${fmt(totalEntradas - totalSaidas)}</span></div>
  </div>

  <div class="footer">Relatório gerado pelo sistema Menu's</div>

  <script>window.onload = function() { setTimeout(function() { window.print(); }, 200); };</script>
</body>
</html>`;

      const printWindow = window.open("", "_blank", "width=820,height=900");
      if (!printWindow) {
        toast.error("Permita pop-ups para imprimir o relatório");
        return;
      }
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
    } catch (error: any) {
      toast.error("Erro ao gerar relatório: " + error.message);
    }
  };

  const handleOpenCashRegister = async () => {
    const openingBalance = openingMode === "full"
      ? parseFloat(fullOpeningBalance) || 0
      : calculateOpeningBalance();
    
    if (!openedBy) {
      toast.error("Preencha o nome do responsável");
      return;
    }

    if (openingMode === "full" && !fullOpeningBalance) {
      toast.error("Informe o valor de abertura");
      return;
    }

    try {
      const { error } = await supabase.from("cash_register_sessions").insert({
        restaurant_id: restaurantId,
        opened_by: openedBy,
        opening_balance: openingBalance,
        status: "open"
      });

      if (error) throw error;
      
      toast.success("Caixa aberto com sucesso!");

      // Fire-and-forget: notify owner
      supabase.functions.invoke("whatsapp-notifications", {
        body: {
          restaurant_id: restaurantId,
          notification_type: "cashier_open",
          context: {
            operador: openedBy,
            hora_abertura: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
            valor_inicial: openingBalance.toFixed(2),
          },
        },
      }).catch(() => {});

      setOpenedBy("");
      setFullOpeningBalance("");
      setOpeningMode("full");
      setBillCounts(Object.fromEntries(BILL_DENOMINATIONS.map(d => [d, 0])));
      setCoinCounts(Object.fromEntries(COIN_DENOMINATIONS.map(d => [d, 0])));
      fetchCurrentSession();
    } catch (error: any) {
      toast.error("Erro ao abrir caixa: " + error.message);
    }
  };

  const handleCloseCashRegister = async () => {
    if (!currentSession || !closedBy || !closingBalance) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    const expectedBalance = calculateExpectedBalance();
    const difference = parseFloat(closingBalance) - expectedBalance;

    try {
      const { error } = await supabase
        .from("cash_register_sessions")
        .update({
          closed_by: closedBy,
          closed_at: new Date().toISOString(),
          closing_balance: parseFloat(closingBalance),
          expected_balance: expectedBalance,
          difference: difference,
          status: "closed",
          notes: closeNotes
        })
        .eq("id", currentSession.id);

      if (error) throw error;
      
      toast.success("Caixa fechado com sucesso!");

      // Fire-and-forget: notify owner with cash summary
      const totalSales = movements.filter(m => m.movement_type === "entrada").reduce((s, m) => s + m.amount, 0);
      const totalOrders = movements.filter(m => m.movement_type === "entrada").length;
      const ticketMedio = totalOrders > 0 ? (totalSales / totalOrders) : 0;

      supabase.functions.invoke("whatsapp-notifications", {
        body: {
          restaurant_id: restaurantId,
          notification_type: "cashier_close",
          context: {
            operador: closedBy,
            hora_fechamento: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
            valor_abertura: currentSession.opening_balance.toFixed(2),
            valor_fechamento: parseFloat(closingBalance).toFixed(2),
            faturamento_dia: totalSales.toFixed(2),
            numero_pedidos: totalOrders.toString(),
            ticket_medio: ticketMedio.toFixed(2),
            observacoes: closeNotes || "Nenhuma",
          },
        },
      }).catch(() => {});

      setClosedBy("");
      setClosingBalance("");
      setCloseNotes("");
      setCurrentSession(null);
      fetchCurrentSession();
      fetchClosedSessions();
    } catch (error: any) {
      toast.error("Erro ao fechar caixa: " + error.message);
    }
  };

  const handleAddMovement = async () => {
    if (!currentSession || !movementAmount || !movementDescription || !movementCreatedBy) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    try {
      const { error } = await supabase.from("cash_movements").insert({
        cash_session_id: currentSession.id,
        restaurant_id: restaurantId,
        movement_type: movementType,
        amount: parseFloat(movementAmount),
        description: movementDescription,
        category: movementCategory || null,
        payment_method: movementPaymentMethod,
        created_by: movementCreatedBy
      });

      if (error) throw error;
      
      toast.success("Movimentação registrada!");
      setMovementAmount("");
      setMovementDescription("");
      setMovementCategory("");
      setMovementCreatedBy("");
      fetchMovements();
    } catch (error: any) {
      toast.error("Erro ao registrar movimentação: " + error.message);
    }
  };

  const calculateExpectedBalance = () => {
    if (!currentSession) return 0;
    
    let balance = currentSession.opening_balance;
    
    movements.forEach(mov => {
      if (mov.movement_type === "entrada") {
        balance += mov.amount;
      } else {
        balance -= mov.amount;
      }
    });

    return balance;
  };

  const calculateTotalSales = () => {
    return movements
      .filter(m => m.movement_type === "entrada")
      .reduce((sum, m) => sum + m.amount, 0);
  };

  const calculateTotalExpenses = () => {
    return movements
      .filter(m => m.movement_type === "saida")
      .reduce((sum, m) => sum + m.amount, 0);
  };

  const formatDenomination = (value: number) => {
    return value >= 1 ? `R$${value}` : `R$${value.toFixed(2).replace('.', ',')}`;
  };

  const filteredSessions = closedSessions.filter(session => {
    const matchesSearch = 
      session.opened_by.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (session.closed_by || "").toLowerCase().includes(searchTerm.toLowerCase());
    
    if (!session.closed_at) return false;
    const closedDate = new Date(session.closed_at);
    const matchesDate = closedDate >= historyDateRange.from && closedDate <= historyDateRange.to;
    
    return matchesSearch && matchesDate;
  });

  if (loading) {
    return <div className="p-4">Carregando...</div>;
  }

  return (
    <div className="space-y-4 sm:space-y-6 p-3 sm:p-6">
      <Tabs defaultValue="fluxo" className="w-full">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6">
          <div>
            <h2 className="text-xl sm:text-3xl font-bold">Caixa</h2>
            <p className="text-xs sm:text-base text-muted-foreground">Controle completo do fluxo de caixa</p>
          </div>
          
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 w-full sm:w-auto">
            <TabsList data-tour="caixa-tabs" className="grid grid-cols-2 w-full sm:w-auto h-9">
              <TabsTrigger value="fluxo" className="text-xs sm:text-sm px-2">Fluxo de Caixa</TabsTrigger>
              <TabsTrigger value="historico" className="text-xs sm:text-sm px-2">Histórico</TabsTrigger>
            </TabsList>
            
            {!currentSession ? (
              <Dialog>
                <DialogTrigger asChild>
                  <Button data-tour="caixa-open" size="lg" className="gap-2">
                    <Wallet className="h-5 w-5" />
                    Abrir Caixa
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Abrir Caixa</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div>
                      <Label>Responsável pela abertura</Label>
                      <Input
                        value={openedBy}
                        onChange={(e) => setOpenedBy(e.target.value)}
                        placeholder="Nome do responsável"
                      />
                    </div>

                    {/* Mode toggle */}
                    <div className="space-y-2">
                      <Label className="text-sm">Modo de abertura</Label>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant={openingMode === "full" ? "default" : "outline"}
                          size="sm"
                          className="w-full"
                          onClick={() => setOpeningMode("full")}
                        >
                          <DollarSign className="h-3.5 w-3.5 mr-1.5" />
                          Valor cheio
                        </Button>
                        <Button
                          type="button"
                          variant={openingMode === "detailed" ? "default" : "outline"}
                          size="sm"
                          className="w-full"
                          onClick={() => setOpeningMode("detailed")}
                        >
                          <Coins className="h-3.5 w-3.5 mr-1.5" />
                          Cédulas e moedas
                        </Button>
                      </div>
                    </div>

                    {openingMode === "full" ? (
                      <div className="space-y-2">
                        <Label>Valor de abertura (R$)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={fullOpeningBalance}
                          onChange={(e) => setFullOpeningBalance(e.target.value)}
                          placeholder="0,00"
                          className="text-lg font-mono"
                        />
                      </div>
                    ) : (
                      <>
                        {/* Cédulas */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <DollarSign className="h-4 w-4" />
                            <Label className="text-base font-semibold">Cédulas</Label>
                          </div>
                          <div className="grid grid-cols-7 gap-2">
                            {BILL_DENOMINATIONS.map((denom) => (
                              <div key={denom} className="text-center">
                                <Label className="text-xs text-muted-foreground">{formatDenomination(denom)}</Label>
                                <Input
                                  type="number"
                                  min="0"
                                  className="text-center h-10"
                                  value={billCounts[denom] || 0}
                                  onChange={(e) => setBillCounts(prev => ({
                                    ...prev,
                                    [denom]: parseInt(e.target.value) || 0
                                  }))}
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                  R${(denom * (billCounts[denom] || 0)).toFixed(2)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Moedas */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Coins className="h-4 w-4" />
                            <Label className="text-base font-semibold">Moedas</Label>
                          </div>
                          <div className="grid grid-cols-5 gap-2">
                            {COIN_DENOMINATIONS.map((denom) => (
                              <div key={denom} className="text-center">
                                <Label className="text-xs text-muted-foreground">{formatDenomination(denom)}</Label>
                                <Input
                                  type="number"
                                  min="0"
                                  className="text-center h-10"
                                  value={coinCounts[denom] || 0}
                                  onChange={(e) => setCoinCounts(prev => ({
                                    ...prev,
                                    [denom]: parseInt(e.target.value) || 0
                                  }))}
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                  R${(denom * (coinCounts[denom] || 0)).toFixed(2)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}

                    {/* Total */}
                    <div className="bg-muted/50 p-4 rounded-lg border">
                      <div className="flex justify-between items-center">
                        <span className="text-lg font-semibold">Valor de Abertura:</span>
                        <span className="text-2xl font-bold font-mono">
                          R$ {(openingMode === "full" ? (parseFloat(fullOpeningBalance) || 0) : calculateOpeningBalance()).toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <Button onClick={handleOpenCashRegister} className="w-full">
                      <Wallet className="h-4 w-4 mr-2" />
                      Abrir Caixa
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            ) : (
              <Dialog>
                <DialogTrigger asChild>
                  <Button data-tour="caixa-open" variant="destructive" size="lg" className="gap-2">
                    <Wallet className="h-5 w-5" />
                    Fechar Caixa
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Fechar Caixa</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                     <div className="bg-muted/30 p-4 rounded-lg space-y-2 border">
                       <div className="flex justify-between">
                         <span>Saldo inicial:</span>
                         <span className="font-bold font-mono">R$ {currentSession.opening_balance.toFixed(2)}</span>
                       </div>
                       <div className="flex justify-between">
                         <span>Saldo esperado:</span>
                         <span className="font-bold font-mono">R$ {calculateExpectedBalance().toFixed(2)}</span>
                       </div>
                       {(() => {
                         const empCreditTotal = movements
                           .filter(m => m.movement_type === "entrada" && m.payment_method?.includes("employee_credit"))
                           .reduce((sum, m) => sum + m.amount, 0);
                         return empCreditTotal > 0 ? (
                           <div className="flex justify-between text-amber-700">
                             <span className="text-sm">Crédito de Funcionário:</span>
                             <span className="font-bold font-mono text-sm">R$ {empCreditTotal.toFixed(2)} <span className="text-xs font-normal">(não está no caixa físico)</span></span>
                           </div>
                         ) : null;
                       })()}
                     </div>
                    <div>
                      <Label>Responsável pelo fechamento</Label>
                      <Input
                        value={closedBy}
                        onChange={(e) => setClosedBy(e.target.value)}
                        placeholder="Nome do responsável"
                      />
                    </div>
                    <div>
                      <Label>Saldo real no caixa (R$)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={closingBalance}
                        onChange={(e) => setClosingBalance(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    {closingBalance && (
                      <div className={`p-3 rounded-lg ${
                        parseFloat(closingBalance) - calculateExpectedBalance() >= 0 
                          ? "bg-green-100 text-green-800" 
                          : "bg-red-100 text-red-800"
                      }`}>
                        Diferença: R$ {(parseFloat(closingBalance) - calculateExpectedBalance()).toFixed(2)}
                      </div>
                    )}
                    <div>
                      <Label>Observações</Label>
                      <Textarea
                        value={closeNotes}
                        onChange={(e) => setCloseNotes(e.target.value)}
                        placeholder="Observações sobre o fechamento..."
                      />
                    </div>
                    <Button onClick={handleCloseCashRegister} className="w-full">
                      Confirmar Fechamento
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {/* Tab: Fluxo de Caixa */}
        <TabsContent value="fluxo" className="space-y-6 mt-0">
          {currentSession && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Caixa Atual
                </CardTitle>
                <CardDescription>
                  Aberto por {currentSession.opened_by} em {format(new Date(currentSession.opened_at), "dd/MM/yyyy 'às' HH:mm")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-muted/30 p-4 rounded-lg border">
                    <p className="text-sm text-muted-foreground">Saldo Inicial</p>
                    <p className="text-2xl font-bold font-mono">R$ {currentSession.opening_balance.toFixed(2)}</p>
                  </div>
                  <div className="bg-muted/20 p-4 rounded-lg border">
                    <p className="text-sm text-muted-foreground">Entradas</p>
                    <p className="text-2xl font-bold text-green-600 font-mono">R$ {calculateTotalSales().toFixed(2)}</p>
                  </div>
                  <div className="bg-muted/20 p-4 rounded-lg border">
                    <p className="text-sm text-muted-foreground">Saídas</p>
                    <p className="text-2xl font-bold text-red-600 font-mono">R$ {calculateTotalExpenses().toFixed(2)}</p>
                  </div>
                  <div className="bg-muted/30 p-4 rounded-lg border">
                    <p className="text-sm text-muted-foreground">Saldo Esperado</p>
                    <p className="text-2xl font-bold font-mono">R$ {calculateExpectedBalance().toFixed(2)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {!currentSession && lastClosedSession && (
            <Card className="bg-secondary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Último Caixa Fechado
                </CardTitle>
                <CardDescription>
                  Fechado em {format(new Date(lastClosedSession.closed_at!), "dd/MM/yyyy 'às' HH:mm")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-muted/30 p-4 rounded-lg border">
                    <p className="text-sm text-muted-foreground">Saldo Inicial</p>
                    <p className="text-2xl font-bold font-mono">R$ {lastClosedSession.opening_balance.toFixed(2)}</p>
                  </div>
                  <div className="bg-muted/20 p-4 rounded-lg border">
                    <p className="text-sm text-muted-foreground">Saldo Esperado</p>
                    <p className="text-2xl font-bold font-mono">R$ {(lastClosedSession.expected_balance || 0).toFixed(2)}</p>
                  </div>
                  <div className="bg-muted/20 p-4 rounded-lg border">
                    <p className="text-sm text-muted-foreground">Saldo Final</p>
                    <p className="text-2xl font-bold font-mono">R$ {(lastClosedSession.closing_balance || 0).toFixed(2)}</p>
                  </div>
                  <div className={`p-4 rounded-lg border ${(lastClosedSession.difference || 0) >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                    <p className="text-sm text-muted-foreground">Diferença</p>
                    <p className={`text-2xl font-bold font-mono ${(lastClosedSession.difference || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      R$ {(lastClosedSession.difference || 0).toFixed(2)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {!currentSession && !lastClosedSession && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Nenhum caixa aberto. Abra um caixa para registrar movimentações.
              </CardContent>
            </Card>
          )}
          
          {currentSession && (
            <Collapsible open={movementDrawerOpen} onOpenChange={setMovementDrawerOpen}>
               <Card>
                 <CollapsibleTrigger asChild>
                   <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                     <div className="flex items-center justify-between">
                       <CardTitle className="flex items-center gap-2">
                         <Receipt className="h-5 w-5" />
                         Registrar Movimentação
                       </CardTitle>
                       <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${movementDrawerOpen ? 'rotate-180' : ''}`} />
                     </div>
                   </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label>Tipo de Movimentação</Label>
                        <Select value={movementType} onValueChange={setMovementType}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="entrada">Entrada</SelectItem>
                            <SelectItem value="saida">Saída</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Valor (R$)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={movementAmount}
                          onChange={(e) => setMovementAmount(e.target.value)}
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <Label>Descrição</Label>
                        <Input
                          value={movementDescription}
                          onChange={(e) => setMovementDescription(e.target.value)}
                          placeholder="Descrição da movimentação"
                        />
                      </div>
                      <div>
                        <Label>Categoria (opcional)</Label>
                        <Input
                          value={movementCategory}
                          onChange={(e) => setMovementCategory(e.target.value)}
                          placeholder="Ex: Alimentação, Limpeza..."
                        />
                      </div>
                      <div>
                        <Label>Forma de Pagamento</Label>
                        <Select value={movementPaymentMethod} onValueChange={setMovementPaymentMethod}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="dinheiro">Dinheiro</SelectItem>
                            <SelectItem value="pix">PIX</SelectItem>
                            <SelectItem value="credito">Crédito</SelectItem>
                            <SelectItem value="debito">Débito</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Responsável</Label>
                        <Input
                          value={movementCreatedBy}
                          onChange={(e) => setMovementCreatedBy(e.target.value)}
                          placeholder="Nome do responsável"
                        />
                      </div>
                    </div>
                    <Button onClick={handleAddMovement} className="w-full mt-4">
                      {movementType === "entrada" ? (
                        <PlusCircle className="h-4 w-4 mr-2" />
                      ) : (
                        <MinusCircle className="h-4 w-4 mr-2" />
                      )}
                      Registrar Movimentação
                    </Button>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Histórico de Movimentações
              </CardTitle>
              <CardDescription>
                {currentSession 
                  ? `${movements.length} movimentações registradas nesta sessão`
                  : lastClosedSession
                    ? `${movements.length} movimentações do último caixa fechado`
                    : "Abra o caixa para ver as movimentações"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-2 pr-4">
                  {movements.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      Nenhuma movimentação registrada
                    </p>
                  ) : (
                    movements.map((mov) => (
                      <div
                        key={mov.id}
                        onClick={() => { setSelectedMovement(mov); setDetailSheetOpen(true); }}
                        className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-4">
                          {mov.movement_type === "entrada" ? (
                            <TrendingUp className="h-5 w-5 text-green-600" />
                          ) : (
                            <TrendingDown className="h-5 w-5 text-red-600" />
                          )}
                          <div>
                            <p className="font-medium">{mov.description}</p>
                            <p className="text-sm text-muted-foreground">
                              {mov.movement_type === "entrada" ? "Entrada" : "Saída"} • {formatPaymentMethod(mov.payment_method)} • {mov.created_by}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(mov.created_at), "dd/MM/yyyy 'às' HH:mm")}
                            </p>
                          </div>
                        </div>
                        <div className={`text-lg font-bold font-mono ${
                          mov.movement_type === "entrada"
                            ? "text-green-600"
                            : "text-red-600"
                        }`}>
                          {mov.movement_type === "entrada" ? "+" : "-"}
                          R$ {mov.amount.toFixed(2)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Histórico de Caixa */}
        <TabsContent value="historico" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Histórico de Caixa
              </CardTitle>
              <CardDescription>
                Todos os caixas fechados
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Filtros */}
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Pesquisar por nome..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div>
                    <Popover
                      open={historyDatePopoverOpen}
                      onOpenChange={(open) => {
                        setHistoryDatePopoverOpen(open);
                        if (open) setPendingHistoryDateRange(undefined);
                      }}
                    >
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2">
                        <CalendarIcon className="h-4 w-4" />
                        {format(historyDateRange.from, "dd/MM/yyyy")} - {format(historyDateRange.to, "dd/MM/yyyy")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                      <Calendar
                        mode="range"
                          selected={pendingHistoryDateRange}
                        onSelect={(range) => {
                            setPendingHistoryDateRange(range);
                          if (range?.from && range?.to) {
                              const isForward = range.from <= range.to;
                              const from = isForward ? range.from : range.to;
                              const to = isForward ? range.to : range.from;
                              setHistoryDateRange({ from: startOfDay(from), to: endOfDay(to) });
                            setHistoryDatePopoverOpen(false);
                          }
                        }}
                        locale={ptBR}
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              
              {/* Lista de Caixas com Scroll */}
              <ScrollArea className="h-[500px]">
                <div className="space-y-3 pr-4">
                  {filteredSessions.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      Nenhum caixa encontrado
                    </p>
                  ) : (
                    filteredSessions.map((session) => (
                      <div
                        key={session.id}
                        onClick={() => handleSelectSession(session)}
                        className="p-4 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors relative"
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute top-2 right-2 h-8 w-8"
                          onClick={(e) => handlePrintSession(session, e)}
                          title="Imprimir relatório do caixa"
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        <div className="flex items-center gap-2 text-sm pr-10">
                          <Wallet className="h-4 w-4 text-green-600" />
                          <span className="font-medium">{session.opened_by}</span>
                          <span className="text-muted-foreground">abriu</span>
                          <span>{format(new Date(session.opened_at), "dd/MM/yyyy 'às' HH:mm")}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm mt-1">
                          <Wallet className="h-4 w-4 text-red-600" />
                          <span className="font-medium">{session.closed_by || "—"}</span>
                          <span className="text-muted-foreground">fechou</span>
                          <span>{session.closed_at ? format(new Date(session.closed_at), "dd/MM/yyyy 'às' HH:mm") : "—"}</span>
                        </div>
                        <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
                          <span>Saldo: <strong className="text-foreground font-mono">R$ {(session.closing_balance || 0).toFixed(2)}</strong></span>
                          <span>Diferença: <strong className={`font-mono ${(session.difference || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>R$ {(session.difference || 0).toFixed(2)}</strong></span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog de Detalhes do Caixa */}
      <Dialog open={!!selectedSession} onOpenChange={() => setSelectedSession(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 pr-8">
              <span className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                Caixa - {selectedSession && format(new Date(selectedSession.opened_at), "dd/MM/yyyy")}
              </span>
              {selectedSession && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => handlePrintSession(selectedSession)}
                >
                  <Printer className="h-4 w-4" />
                  Imprimir
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          
          {selectedSession && (
            <div className="space-y-4">
              {/* Resumo */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-muted/30 p-3 rounded-lg border">
                  <p className="text-xs text-muted-foreground">Saldo Inicial</p>
                  <p className="text-lg font-bold font-mono">R$ {selectedSession.opening_balance.toFixed(2)}</p>
                </div>
                <div className="bg-muted/20 p-3 rounded-lg border">
                  <p className="text-xs text-muted-foreground">Saldo Esperado</p>
                  <p className="text-lg font-bold font-mono">R$ {(selectedSession.expected_balance || 0).toFixed(2)}</p>
                </div>
                <div className="bg-muted/20 p-3 rounded-lg border">
                  <p className="text-xs text-muted-foreground">Saldo Final</p>
                  <p className="text-lg font-bold font-mono">R$ {(selectedSession.closing_balance || 0).toFixed(2)}</p>
                </div>
                <div className={`p-3 rounded-lg border ${(selectedSession.difference || 0) >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                  <p className="text-xs text-muted-foreground">Diferença</p>
                  <p className={`text-lg font-bold font-mono ${(selectedSession.difference || 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    R$ {(selectedSession.difference || 0).toFixed(2)}
                  </p>
                </div>
              </div>
              
              {/* Quem abriu/fechou */}
              <div className="text-sm text-muted-foreground border-t pt-3">
                <p>Aberto por <strong>{selectedSession.opened_by}</strong> em {format(new Date(selectedSession.opened_at), "dd/MM/yyyy 'às' HH:mm")}</p>
                {selectedSession.closed_at && (
                  <p>Fechado por <strong>{selectedSession.closed_by}</strong> em {format(new Date(selectedSession.closed_at), "dd/MM/yyyy 'às' HH:mm")}</p>
                )}
                {selectedSession.notes && (
                  <p className="mt-2 italic">Obs: {selectedSession.notes}</p>
                )}
              </div>
              
              {/* Movimentações */}
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <Receipt className="h-4 w-4" />
                  Movimentações ({selectedSessionMovements.length})
                </h4>
                {/* Searchbar no historico */}
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por cliente ou descricao..."
                    value={historyMovementSearch}
                    onChange={(e) => setHistoryMovementSearch(e.target.value)}
                    className="pl-9 h-8 text-sm"
                  />
                </div>
                <ScrollArea className="h-[300px] border rounded-lg">
                  <div className="p-3 space-y-2">
                    {selectedSessionMovements.length === 0 ? (
                      <p className="text-center text-muted-foreground py-4">
                        Nenhuma movimentação registrada
                      </p>
                    ) : (
                      selectedSessionMovements
                        .filter(mov => {
                          if (!historyMovementSearch) return true;
                          const q = historyMovementSearch.toLowerCase();
                          return mov.description.toLowerCase().includes(q) || mov.created_by.toLowerCase().includes(q);
                        })
                        .map((mov) => (
                        <div
                          key={mov.id}
                          onClick={() => { setSelectedMovement(mov); setDetailSheetOpen(true); }}
                          className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            {mov.movement_type === "entrada" ? (
                              <TrendingUp className="h-4 w-4 text-green-600" />
                            ) : (
                              <TrendingDown className="h-4 w-4 text-red-600" />
                            )}
                            <div>
                              <p className="font-medium text-sm">{mov.description}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatPaymentMethod(mov.payment_method)} • {mov.created_by} • {format(new Date(mov.created_at), "HH:mm")}
                              </p>
                            </div>
                          </div>
                          <span className={`font-bold ${mov.movement_type === "entrada" ? 'text-green-600' : 'text-red-600'}`}>
                            {mov.movement_type === "entrada" ? "+" : "-"}R$ {mov.amount.toFixed(2)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Detail Sheet for movement drill-down */}
      <CashMovementDetailSheet
        movement={selectedMovement}
        open={detailSheetOpen}
        onOpenChange={(open) => { setDetailSheetOpen(open); if (!open) setSelectedMovement(null); }}
      />
    </div>
  );
}

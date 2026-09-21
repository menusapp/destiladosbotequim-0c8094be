import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { validateCPF, validatePhone } from "@/lib/cpfValidator";
import { toast } from "@/components/ui/sonner";
import { ArrowLeft, Loader2, UserCheck } from "lucide-react";
import { KioskCustomer } from "@/pages/Kiosk";

interface Props {
  restaurant: any;
  onIdentified: (customer: KioskCustomer) => void;
  onBack: () => void;
}

export function KioskIdentification({ restaurant, onIdentified, onBack }: Props) {
  const [cpf, setCpf] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [checking, setChecking] = useState(false);
  const [existing, setExisting] = useState<{ name: string; phone?: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const color = restaurant?.primary_color || "#184a2d";

  const formatCPF = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  };

  const formatPhone = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };

  // Auto-check CPF
  useEffect(() => {
    const raw = cpf.replace(/\D/g, "");
    if (raw.length !== 11 || !validateCPF(raw) || !restaurant?.id) {
      setExisting(null);
      setShowForm(false);
      setChecking(false);
      return;
    }
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const { data: rpcData, error } = await (supabase as any).rpc('get_customer_by_cpf', { p_cpf: raw });
        const data = Array.isArray(rpcData) ? rpcData[0] : rpcData;
        if (error) {
          console.error("[Kiosk CPF] Erro na busca:", error);
          setExisting(null);
          setShowForm(true);
        } else if (data) {
          setExisting(data);
          setShowForm(false);
        } else {
          setExisting(null);
          setShowForm(true);
        }
      } catch (err) {
        console.error("[Kiosk CPF] Exceção:", err);
        setExisting(null);
        setShowForm(true);
      } finally {
        setChecking(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [cpf, restaurant?.id]);

  const handleSubmit = async () => {
    const raw = cpf.replace(/\D/g, "");
    if (!validateCPF(raw)) { toast.error("CPF inválido"); return; }

    if (existing) {
      onIdentified({ name: existing.name, cpf: raw, phone: existing.phone, isExisting: true });
      return;
    }

    if (!name.trim()) { toast.error("Informe seu nome"); return; }
    if (name.trim().length > 35) { toast.error("Nome deve ter no máximo 35 caracteres"); return; }

    const phoneRaw = phone.replace(/\D/g, "") || undefined;
    if (phoneRaw && !validatePhone(phoneRaw)) {
      setPhoneError("Número de telefone inválido");
      toast.error("Número de telefone inválido");
      return;
    }
    // Save new customer
    if (restaurant?.id) {
      await supabase.from("customers").insert({
        restaurant_id: restaurant.id,
        cpf: raw,
        name: name.trim(),
        phone: phoneRaw,
      });
    }

    onIdentified({ name: name.trim(), cpf: raw, phone: phoneRaw, isExisting: false });
  };

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center gap-4 p-6">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-14 w-14 rounded-full">
          <ArrowLeft className="h-8 w-8" />
        </Button>
        <h2 className="text-2xl md:text-3xl font-bold text-foreground">Identificação</h2>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-8 max-w-lg mx-auto w-full gap-6">
        <p className="text-xl text-muted-foreground text-center">Informe seu CPF para começar</p>

        <div className="w-full space-y-2">
          <Label className="text-lg">CPF</Label>
          <Input
            value={cpf}
            onChange={(e) => setCpf(formatCPF(e.target.value))}
            placeholder="000.000.000-00"
            className="text-2xl h-16 text-center tracking-widest"
            maxLength={14}
            inputMode="numeric"
          />
          {checking && <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />}
        </div>

        {existing && (
          <div className="w-full flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950/30 rounded-xl border border-green-200 dark:border-green-800">
            <UserCheck className="h-8 w-8 text-green-600" />
            <div>
              <p className="text-xl font-semibold text-green-800 dark:text-green-200">{existing.name}</p>
              <p className="text-green-600 dark:text-green-400">Bem-vindo de volta!</p>
            </div>
          </div>
        )}

        {showForm && (
          <>
            <div className="w-full space-y-2">
              <Label className="text-lg">Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value.slice(0, 35))} placeholder="Seu nome" className="text-xl h-14" maxLength={35} />
            </div>
            <div className="w-full space-y-2">
              <Label className="text-lg">Telefone (opcional)</Label>
              <Input value={phone} onChange={(e) => { setPhone(formatPhone(e.target.value)); setPhoneError(""); }} placeholder="(00) 00000-0000" className={`text-xl h-14 ${phoneError ? "border-destructive" : ""}`} maxLength={15} inputMode="tel" />
              {phoneError && <p className="text-sm text-destructive">{phoneError}</p>}
            </div>
          </>
        )}

        {(existing || showForm) && (
          <Button onClick={handleSubmit} className="w-full h-16 text-xl font-bold rounded-xl text-white" style={{ backgroundColor: color }}>
            {existing ? "Continuar" : "Começar Pedido"}
          </Button>
        )}
      </div>
    </div>
  );
}

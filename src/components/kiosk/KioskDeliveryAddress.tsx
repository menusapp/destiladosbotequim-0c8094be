import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, MapPin, Plus, Check, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";

interface SavedAddress {
  id: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
}

interface Props {
  primaryColor: string;
  customerCpf: string;
  customerName: string;
  customerPhone: string;
  onBack: () => void;
  onSelectAddress: (address: string) => void;
}

export function KioskDeliveryAddress({ primaryColor, customerCpf, customerName, customerPhone, onBack, onSelectAddress }: Props) {
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAddresses();
  }, [customerCpf]);

  const fetchAddresses = async () => {
    if (!customerCpf) { setLoading(false); return; }
    const { data } = await (supabase as any).rpc('list_customer_addresses', { p_cpf: customerCpf, p_phone: customerPhone || null });
    setSavedAddresses(data || []);
    setLoading(false);
  };

  const formatAddress = (a: SavedAddress) => {
    const parts = [`${a.street}, ${a.number}`];
    if (a.complement) parts.push(a.complement);
    parts.push(`${a.neighborhood} - ${a.city}`);
    return parts.join(", ");
  };

  const handleSelectSaved = (a: SavedAddress) => {
    setSelectedId(a.id);
    setShowForm(false);
  };

  const handleConfirm = () => {
    if (selectedId) {
      const addr = savedAddresses.find(a => a.id === selectedId);
      if (addr) onSelectAddress(formatAddress(addr));
    }
  };

  const handleSaveNew = async () => {
    if (!street || !number || !neighborhood || !city) {
      toast.error("Preencha os campos obrigatórios");
      return;
    }
    setSaving(true);
    try {
      const newAddr = {
        customer_cpf: customerCpf,
        customer_name: customerName,
        customer_phone: customerPhone || "0",
        street, number, complement: complement || null,
        neighborhood, city, state: "SP", zip_code: "00000-000",
      };
      // Persistido via RPC segura (SECURITY DEFINER) — sem escrita direta anônima.
      const { data: newId, error } = await (supabase as any).rpc("add_customer_address", {
        p_cpf: customerCpf,
        p_name: customerName,
        p_phone: customerPhone || "0",
        p_street: street,
        p_number: number,
        p_neighborhood: neighborhood,
        p_city: city,
        p_state: "SP",
        p_zip_code: "00000-000",
        p_complement: complement || null,
        p_is_default: false,
      });
      if (error) throw error;
      const id = (typeof newId === "string" ? newId : crypto.randomUUID());
      const addr = { id, ...newAddr } as SavedAddress;
      onSelectAddress(formatAddress(addr));
    } catch (err: any) {
      toast.error(err?.message || "Erro ao salvar endereço");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="flex items-center gap-4 p-5 border-b bg-card shrink-0">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-12 w-12 rounded-full">
          <ArrowLeft className="h-6 w-6" />
        </Button>
        <h2 className="text-xl font-bold text-foreground">Endereço de Entrega</h2>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 max-w-lg mx-auto w-full space-y-6">
          {/* Saved addresses */}
          {savedAddresses.length > 0 && !showForm && (
            <div className="space-y-3">
              <h3 className="text-base font-semibold text-foreground">Endereços salvos</h3>
              {savedAddresses.map(a => (
                <button
                  key={a.id}
                  onClick={() => handleSelectSaved(a)}
                  className={`w-full p-4 rounded-2xl border-2 flex items-start gap-3 text-left transition-all ${
                    selectedId === a.id ? "shadow-lg" : "border-muted hover:border-muted-foreground/30"
                  }`}
                  style={selectedId === a.id ? { borderColor: primaryColor, backgroundColor: `${primaryColor}10` } : {}}
                >
                  <MapPin className="h-5 w-5 mt-0.5 shrink-0" style={{ color: selectedId === a.id ? primaryColor : undefined }} />
                  <span className="text-sm text-foreground">{formatAddress(a)}</span>
                  {selectedId === a.id && <Check className="h-5 w-5 ml-auto shrink-0" style={{ color: primaryColor }} />}
                </button>
              ))}
            </div>
          )}

          {/* New address toggle */}
          {!showForm && (
            <Button variant="outline" className="w-full h-14 rounded-2xl gap-2 text-base" onClick={() => { setShowForm(true); setSelectedId(null); }}>
              <Plus className="h-5 w-5" />
              Novo endereço
            </Button>
          )}

          {/* New address form */}
          {showForm && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-foreground">Novo endereço</h3>
              <div className="space-y-2">
                <Label>Rua *</Label>
                <Input value={street} onChange={e => setStreet(e.target.value)} placeholder="Nome da rua" className="h-12 rounded-xl" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Número *</Label>
                  <Input value={number} onChange={e => setNumber(e.target.value)} placeholder="Nº" className="h-12 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <Label>Complemento (opcional)</Label>
                  <Input value={complement} onChange={e => setComplement(e.target.value)} placeholder="Ex: Casa, Apartamento, Bloco B" className="h-12 rounded-xl" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Bairro *</Label>
                <Input value={neighborhood} onChange={e => setNeighborhood(e.target.value)} placeholder="Bairro" className="h-12 rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label>Cidade *</Label>
                <Input value={city} onChange={e => setCity(e.target.value)} placeholder="Cidade" className="h-12 rounded-xl" />
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-12 rounded-xl" onClick={() => setShowForm(false)}>Cancelar</Button>
                <Button className="flex-1 h-12 rounded-xl text-white" style={{ backgroundColor: primaryColor }} onClick={handleSaveNew} disabled={saving}>
                  {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Confirmar endereço"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Confirm saved address */}
      {selectedId && !showForm && (
        <div className="border-t bg-card p-5 shrink-0">
          <div className="max-w-lg mx-auto">
            <Button onClick={handleConfirm} className="w-full h-14 text-lg font-bold rounded-xl text-white" style={{ backgroundColor: primaryColor }}>
              Confirmar endereço
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

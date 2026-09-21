import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { validateCPF, validatePhone } from "@/lib/cpfValidator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import { Loader2, UserCheck, CalendarIcon } from "lucide-react";

interface CustomerInfoDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string, cpf: string, phone?: string) => void;
  restaurantColor?: string;
  restaurantId?: string;
  requireName?: boolean;
  requirePhone?: boolean;
  requireBirthDate?: boolean;
}

const CustomerInfoDialog = ({ 
  open,
  onClose, 
  onSubmit, 
  restaurantColor = "#184a2d",
  restaurantId,
  requireName = true,
  requirePhone = false,
  requireBirthDate = false
}: CustomerInfoDialogProps) => {
  const [name, setName] = useState("");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  
  const [cpfError, setCpfError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [isCheckingCpf, setIsCheckingCpf] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingCustomer, setExistingCustomer] = useState<{name: string; phone?: string; birth_date?: string | null} | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setName("");
      setCpf("");
      setPhone("");
      setBirthDate("");
      setCpfError("");
      setPhoneError("");
      setExistingCustomer(null);
      setIsCheckingCpf(false);
      setIsSubmitting(false);
    }
  }, [open]);

  // Check for existing customer when CPF is valid
  useEffect(() => {
    const sanitizedCPF = cpf.replace(/\D/g, "");
    
    if (sanitizedCPF.length !== 11 || !validateCPF(sanitizedCPF) || !restaurantId) {
      setExistingCustomer(null);
      setIsCheckingCpf(false);
      return;
    }

    setIsCheckingCpf(true);

    const checkExistingCustomer = async () => {
      try {
        const { data: rows, error } = await (supabase as any).rpc("get_customer_by_cpf", {
          p_cpf: sanitizedCPF,
        });
        const data = Array.isArray(rows) ? rows[0] : rows;

        if (!error && data) {
          setExistingCustomer(data);
          setName(data.name);
          if (data.phone) setPhone(data.phone);
          if (data.birth_date) {
            setBirthDate(formatBirthDateForInput(data.birth_date));
            
          }
        } else {
          setExistingCustomer(null);
        }
      } catch (err) {
        console.error("Error checking customer:", err);
        setExistingCustomer(null);
      } finally {
        setIsCheckingCpf(false);
      }
    };

    const debounceTimer = setTimeout(checkExistingCustomer, 300);
    return () => clearTimeout(debounceTimer);
  }, [cpf, restaurantId]);

  const formatCPFInput = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
    if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  };

  const formatPhoneInput = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const formatBirthDateInput = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  };

  const getBirthDateParts = (value: string) => {
    const normalizedValue = value.trim();

    const formattedMatch = normalizedValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (formattedMatch) {
      const [, day, month, year] = formattedMatch;
      return {
        day: Number(day),
        month: Number(month),
        year: Number(year),
      };
    }

    const isoMatch = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      return {
        day: Number(day),
        month: Number(month),
        year: Number(year),
      };
    }

    return null;
  };

  const formatBirthDateForInput = (value: string) => {
    const parts = getBirthDateParts(value);

    if (!parts) return formatBirthDateInput(value);

    return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${String(parts.year)}`;
  };

  const formatBirthDateForDisplay = (value: string) => {
    const parts = getBirthDateParts(value);

    if (!parts) return value;

    return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${String(parts.year)}`;
  };

  const parseBirthDate = (value: string): string | null => {
    const parts = getBirthDateParts(value);

    if (!parts) return null;

    const { day, month, year } = parts;

    if (!day || !month || !year) return null;
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;

    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    if (date.getTime() > today) return null;

    if (year < 1900) return null;

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  const handleCPFChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCPFInput(e.target.value);
    setCpf(formatted);
    setCpfError("");
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneInput(e.target.value);
    setPhone(formatted);
    setPhoneError("");
  };

  const handleBirthDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatBirthDateInput(e.target.value);
    setBirthDate(formatted);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const sanitizedCPF = cpf.replace(/\D/g, "");
    
    if (!sanitizedCPF || sanitizedCPF.length !== 11) {
      toast.error("Por favor, informe seu CPF completo");
      return;
    }

    if (!validateCPF(sanitizedCPF)) {
      setCpfError("CPF inválido");
      toast.error("CPF inválido. Por favor, verifique o número digitado.");
      return;
    }

    const finalName = existingCustomer ? existingCustomer.name : name.trim();

    if (requireName && !finalName) {
      toast.error("Por favor, informe seu nome");
      return;
    }

    const typedPhone = phone.replace(/\D/g, "");
    if (typedPhone && !validatePhone(typedPhone)) {
      setPhoneError("Número de telefone inválido");
      toast.error("Número de telefone inválido. Verifique o DDD e o número.");
      return;
    }

    const finalPhone = existingCustomer?.phone || typedPhone || undefined;
    if (requirePhone && !finalPhone) {
      toast.error("Por favor, informe seu telefone");
      return;
    }

    const trimmedBirthDate = birthDate.trim();

    // Validar data de nascimento se preenchida
    let finalBirthDate: string | null = null;
    if (trimmedBirthDate) {
      finalBirthDate = parseBirthDate(trimmedBirthDate);
      if (!finalBirthDate) {
        toast.error("Data de nascimento inválida. Use o formato DD/MM/AAAA.");
        return;
      }
    }

    setIsSubmitting(true);
    
    try {
      if (existingCustomer && restaurantId) {
        const updateData: { phone?: string; birth_date?: string } = {};
        
        // Atualizar telefone se necessário
        if (!existingCustomer.phone && typedPhone) {
          const { data: phoneExists } = await (supabase as any).rpc("customer_phone_taken", {
            p_phone: typedPhone,
            p_exclude_cpf: sanitizedCPF,
          });

          if (phoneExists) {
            setPhoneError("Este telefone já está cadastrado para outro cliente");
            toast.error("Este telefone já está cadastrado para outro cliente");
            setIsSubmitting(false);
            return;
          }
          updateData.phone = typedPhone;
        }

        // Atualizar data de nascimento se fornecida e não existia
        if (finalBirthDate && !existingCustomer.birth_date) {
          updateData.birth_date = finalBirthDate;
        }

        if (Object.keys(updateData).length > 0) {
          await supabase
            .from("customers")
            .update(updateData)
            .eq("restaurant_id", restaurantId)
            .eq("cpf", sanitizedCPF);
        }
      }

      // If new customer, create record in database
      if (!existingCustomer && restaurantId) {
        if (finalPhone) {
          const { data: phoneExists } = await (supabase as any).rpc("customer_phone_taken", {
            p_phone: finalPhone,
            p_exclude_cpf: sanitizedCPF,
          });

          if (phoneExists) {
            setPhoneError("Este telefone já está cadastrado para outro cliente");
            toast.error("Este telefone já está cadastrado para outro cliente");
            setIsSubmitting(false);
            return;
          }
        }

        const insertData: { restaurant_id: string; cpf: string; name: string; phone?: string; birth_date?: string } = {
          restaurant_id: restaurantId,
          cpf: sanitizedCPF,
          name: finalName || "Cliente",
        };
        if (finalPhone) insertData.phone = finalPhone;
        if (finalBirthDate) insertData.birth_date = finalBirthDate;

        await supabase
          .from("customers")
          .insert(insertData);
      }
    } catch (err) {
      console.error("Error saving customer:", err);
    } finally {
      setIsSubmitting(false);
    }

    onSubmit(finalName || "Cliente", sanitizedCPF, finalPhone);
  };

  const showBirthDateField = requireBirthDate && (!existingCustomer || !existingCustomer.birth_date);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {existingCustomer ? "Bem-vindo de volta!" : "Bem-vindo!"}
          </DialogTitle>
          <DialogDescription>
            {existingCustomer 
              ? `Olá, ${existingCustomer.name}! Bom te ver novamente.`
              : "Para começar seu pedido, precisamos de algumas informações"
            }
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customer-cpf">CPF</Label>
            <div className="relative">
              <Input
                id="customer-cpf"
                value={cpf}
                onChange={handleCPFChange}
                placeholder="000.000.000-00"
                required
                maxLength={14}
                className={cpfError ? "border-destructive" : ""}
              />
              {isCheckingCpf && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            {cpfError && (
              <p className="text-sm text-destructive">{cpfError}</p>
            )}
          </div>

          {existingCustomer && (
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-800">
              <UserCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
              <div>
                <p className="font-medium text-green-800 dark:text-green-200">{existingCustomer.name}</p>
                {existingCustomer.phone && (
                  <p className="text-sm text-green-600 dark:text-green-400">📞 {formatPhoneInput(existingCustomer.phone)}</p>
                )}
                {existingCustomer.birth_date && (
                  <p className="text-sm text-green-600 dark:text-green-400">🎂 {formatBirthDateForDisplay(existingCustomer.birth_date)}</p>
                )}
                <p className="text-sm text-green-600 dark:text-green-400">Cliente cadastrado</p>
              </div>
            </div>
          )}

          {/* Campo de nome - só para novos clientes */}
          {!existingCustomer && requireName && (
            <div className="space-y-2">
              <Label htmlFor="customer-name">Nome</Label>
              <Input
                id="customer-name"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 35))}
                placeholder="Digite seu nome"
                required={requireName}
                disabled={isCheckingCpf}
                maxLength={35}
              />
            </div>
          )}

          {/* Campo de telefone */}
          {((!existingCustomer && requirePhone) || (existingCustomer && !existingCustomer.phone && requirePhone)) && (
            <div className="space-y-2">
              <Label htmlFor="customer-phone">Telefone</Label>
              <Input
                id="customer-phone"
                value={phone}
                onChange={handlePhoneChange}
                placeholder="(00) 00000-0000"
                required={requirePhone}
                disabled={isCheckingCpf}
                maxLength={15}
                className={phoneError ? "border-destructive" : ""}
              />
              {phoneError && (
                <p className="text-sm text-destructive">{phoneError}</p>
              )}
              {existingCustomer && (
                <p className="text-xs text-muted-foreground">
                  Complete seu cadastro informando seu telefone
                </p>
              )}
            </div>
          )}

          {/* Campo de data de nascimento */}
          {showBirthDateField && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="customer-birth-date" className="flex items-center gap-1.5">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  Data de Nascimento
                  <span className="text-xs text-muted-foreground font-normal">(opcional)</span>
                </Label>
                <Input
                  id="customer-birth-date"
                  value={birthDate}
                  onChange={handleBirthDateChange}
                  placeholder="DD/MM/AAAA"
                  disabled={isCheckingCpf}
                  maxLength={10}
                  inputMode="numeric"
                />
              </div>
              <p className="text-[11px] text-muted-foreground leading-tight">
                Ao informar sua data de nascimento, você concorda com o uso dessa informação para campanhas de aniversário e benefícios exclusivos.
              </p>
            </div>
          )}

          <Button 
            type="submit" 
            className="w-full text-white"
            style={{ backgroundColor: restaurantColor }}
            disabled={isCheckingCpf || isSubmitting}
          >
            {isSubmitting ? "Verificando..." : existingCustomer ? "Continuar" : "Começar Pedido"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CustomerInfoDialog;

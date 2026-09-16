import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Copy, CheckCircle2, AlertCircle, CreditCard, Smartphone, Clock, Trash2 } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";

import { copiarTexto } from "@/lib/clipboard";
interface CartItemForPayment {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
}

interface OnlinePaymentStepProps {
  onBack: () => void;
  onConfirm: (onlinePaymentId: string) => void;
  method: "pix" | "credit_card";
  amount: number;
  restaurantId: string;
  orderId?: string;
  /**
   * Optional resolver invoked just before contacting the payment gateway, so
   * the parent can pre-create the order in the DB and return its id. This
   * guarantees the order is never lost if the user closes the browser after
   * paying (the webhook will still find the order via order_id).
   */
  ensureOrderId?: () => Promise<string | null>;
  customerName: string;
  customerCPF: string;
  customerPhone: string;
  customerEmail?: string;
  primaryColor?: string;
  cartItems?: CartItemForPayment[];
}

export const OnlinePaymentStep = ({
  onBack,
  onConfirm,
  method,
  amount,
  restaurantId,
  orderId,
  ensureOrderId,
  customerName,
  customerCPF,
  customerPhone,
  customerEmail,
  primaryColor,
  cartItems,
}: OnlinePaymentStepProps) => {
  // PIX state
  const [pixQrCode, setPixQrCode] = useState<string | null>(null);
  const [pixQrCodeBase64, setPixQrCodeBase64] = useState<string | null>(null);
  const [pixExpiration, setPixExpiration] = useState<string | null>(null);
  const [onlinePaymentId, setOnlinePaymentId] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"loading" | "waiting" | "confirmed" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Credit card state
  const [cardHolderName, setCardHolderName] = useState("");
  const [processing, setProcessing] = useState(false);
  const [mpReady, setMpReady] = useState(false);

  // Saved cards state
  const [savedCards, setSavedCards] = useState<any[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string>("new");
  const [isLoadingCards, setIsLoadingCards] = useState(false);
  const [saveNewCard, setSaveNewCard] = useState(false);
  const [savedCardCvv, setSavedCardCvv] = useState("");

  // Secure Fields refs
  const mpInstanceRef = useRef<any>(null);
  const secureFieldsRef = useRef<any[]>([]);

  // Timer for PIX expiration
  const [timeLeft, setTimeLeft] = useState(30 * 60);

  useEffect(() => {
    if (method === "pix") {
      createPixCharge();
    } else {
      setPaymentStatus("waiting");
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // Fetch saved cards
  useEffect(() => {
    if (method !== "credit_card" || !customerCPF) return;

    const fetchSavedCards = async () => {
      setIsLoadingCards(true);
      try {
        const { data, error } = await (supabase as any).rpc("get_saved_cards", {
          p_cpf: customerCPF.replace(/\D/g, ""),
          p_phone: null,
        });

        if (!error && data && data.length > 0) {
          setSavedCards(data);
          setSelectedCardId(data[0].id);
        }
      } catch (err) {
        console.error("Error fetching saved cards:", err);
      } finally {
        setIsLoadingCards(false);
      }
    };

    fetchSavedCards();
  }, [method, customerCPF, restaurantId]);

  // Initialize Mercado Pago Secure Fields for credit card
  useEffect(() => {
    if (method !== "credit_card") return;
    let isCancelled = false;

    const initMP = async () => {
      await new Promise((r) => setTimeout(r, 800));
      if (isCancelled) return;

      const checkContainer = () => document.getElementById("mp-card-number");
      if (!checkContainer()) {
        setTimeout(initMP, 200);
        return;
      }

      try {
        const { data: configArr } = await supabase.rpc("get_public_payment_config", { p_restaurant_id: restaurantId });
        const config = Array.isArray(configArr) && configArr.length > 0 ? configArr[0] : null;
        if (!config?.mp_public_key || isCancelled) return;

        secureFieldsRef.current.forEach((f) => {
          try {
            f.unmount();
          } catch (e) {}
        });
        secureFieldsRef.current = [];

        const mp = new (window as any).MercadoPago(config.mp_public_key);
        mpInstanceRef.current = mp;

        const style = {
          fontSize: "16px",
          color: "#333333",
          placeholderColor: "#999999",
          width: "100%",
          height: "100%",
        };

        const cardNumber = mp.fields.create("cardNumber", { placeholder: "0000 0000 0000 0000", style });
        const expirationDate = mp.fields.create("expirationDate", { placeholder: "MM/AA", style });
        const securityCode = mp.fields.create("securityCode", { placeholder: "CVV", style });

        cardNumber.mount("mp-card-number");
        expirationDate.mount("mp-expiration-date");
        securityCode.mount("mp-security-code");

        secureFieldsRef.current = [cardNumber, expirationDate, securityCode];
        setMpReady(true);
      } catch (err) {
        console.error("Erro MP:", err);
      }
    };

    initMP();

    return () => {
      isCancelled = true;
      secureFieldsRef.current.forEach((f) => {
        try {
          f.unmount();
        } catch (e) {}
      });
      secureFieldsRef.current = [];
      setMpReady(false);
    };
  }, [method, restaurantId]);

  const createPixCharge = async () => {
    try {
      if (amount < 1) {
        setPaymentStatus("error");
        setErrorMessage("O valor mínimo para pagamento online é de R$ 1,00.");
        return;
      }
      setPaymentStatus("loading");
      const safeAmount = Number(Math.max(0.1, Math.round(amount * 100) / 100).toFixed(2));
      const safeEmail = customerEmail && customerEmail.trim() ? customerEmail.trim() : `cliente-${Date.now()}@pedido.com`;
      const resolvedOrderId = orderId ?? (ensureOrderId ? await ensureOrderId() : undefined) ?? undefined;
      const { data, error } = await supabase.functions.invoke("mercadopago-charge", {
        body: {
          restaurant_id: restaurantId,
          order_id: resolvedOrderId,
          amount: safeAmount,
          billing_type: "PIX",
          customer_name: customerName,
          customer_cpf: customerCPF,
          customer_email: safeEmail,
          customer_phone: customerPhone,
          items: cartItems,
        },
      });

      if (error) throw error;

      if (data?.error) {
        setPaymentStatus("error");
        setErrorMessage(data.error);
        return;
      }

      setPixQrCode(data.pix_qr_code);
      setPixQrCodeBase64(data.pix_qr_code_base64);
      setPixExpiration(data.pix_expiration);
      setOnlinePaymentId(data.online_payment_id);
      setPaymentStatus("waiting");

      if (data.online_payment_id) {
        startPolling(data.online_payment_id);
      }
    } catch (error: any) {
      console.error("[OnlinePayment] Error creating PIX charge:", error);
      setPaymentStatus("error");
      setErrorMessage(error.message || "Erro ao gerar QR Code Pix");
    }
  };

  const startPolling = (paymentId: string) => {
    pollingRef.current = setInterval(async () => {
      const { data: statusRows, error } = await (supabase as any).rpc("get_payment_status", {
        p_payment_id: paymentId,
      });
      const data = Array.isArray(statusRows) ? statusRows[0] : statusRows;

      if (!error && data?.status === "confirmed") {
        if (pollingRef.current) clearInterval(pollingRef.current);
        setPaymentStatus("confirmed");
        toast.success("Pagamento confirmado! ✅");
        setTimeout(() => onConfirm(paymentId), 1500);
      }
    }, 5000);
  };

  const handleCopyPixCode = () => {
    if (pixQrCode) {
      copiarTexto(pixQrCode);
      toast.success("Código Pix copiado!");
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    try {
      await (supabase as any).rpc("delete_saved_card", { p_id: cardId, p_cpf: customerCPF.replace(/\D/g, "") });
      setSavedCards((prev) => prev.filter((c) => c.id !== cardId));
      if (selectedCardId === cardId) {
        setSelectedCardId("new");
      }
      toast.success("Cartão removido");
    } catch (err) {
      toast.error("Erro ao remover cartão");
    }
  };

  const handleCreditCardPayment = async () => {
    // Paying with saved card
    if (selectedCardId !== "new") {
      if (amount < 1) {
        toast.error("O valor mínimo para pagamento online é de R$ 1,00.");
        return;
      }

      if (!savedCardCvv || savedCardCvv.length < 3) {
        toast.error("Digite o CVV do cartão");
        return;
      }

      setProcessing(true);
      setErrorMessage("");

      try {
        const safeAmount = Number(Math.max(0.1, Math.round(amount * 100) / 100).toFixed(2));
        const safeEmail = customerEmail && customerEmail.trim() ? customerEmail.trim() : `cliente-${Date.now()}@pedido.com`;
        const resolvedOrderId = orderId ?? (ensureOrderId ? await ensureOrderId() : undefined) ?? undefined;
        const { data, error } = await supabase.functions.invoke("mercadopago-charge", {
          body: {
            restaurant_id: restaurantId,
            order_id: resolvedOrderId,
            amount: safeAmount,
            billing_type: "CREDIT_CARD",
            action: "pay_with_saved_card",
            saved_card_id: selectedCardId,
            security_code: savedCardCvv,
            customer_name: customerName,
            customer_cpf: customerCPF,
            customer_email: safeEmail,
            customer_phone: customerPhone,
            installments: 1,
            items: cartItems,
          },
        });

        if (error) throw error;

        if (data?.error) {
          setErrorMessage(data.error);
          toast.error(data.error);
          return;
        }

        if (data?.confirmed) {
          setOnlinePaymentId(data.online_payment_id);
          setPaymentStatus("confirmed");
          toast.success("Pagamento aprovado! ✅");
          setTimeout(() => onConfirm(data.online_payment_id), 1500);
        } else {
          setErrorMessage("Pagamento não aprovado. Tente novamente.");
          toast.error("Pagamento não aprovado");
        }
      } catch (error: any) {
        console.error("[OnlinePayment] Saved card error:", error);
        const msg = error?.context?.body ? (typeof error.context.body === 'string' ? error.context.body : JSON.stringify(error.context.body)) : (error.message || "Erro ao processar pagamento");
        setErrorMessage(msg);
        toast.error(msg);
      } finally {
        setProcessing(false);
      }
      return;
    }

    // Paying with new card
    if (!cardHolderName) {
      toast.error("Preencha o nome no cartão");
      return;
    }

    if (!mpInstanceRef.current || !mpReady) {
      toast.error("Campos do cartão ainda carregando. Aguarde.");
      return;
    }

    if (amount < 1) {
      toast.error("O valor mínimo para pagamento online é de R$ 1,00.");
      return;
    }

    setProcessing(true);
    setErrorMessage("");

    try {
      const tokenResult = await mpInstanceRef.current.fields.createCardToken({
        cardholderName: cardHolderName,
        identificationType: "CPF",
        identificationNumber: customerCPF.replace(/\D/g, ""),
      });

      if (!tokenResult?.id) {
        throw new Error("Erro ao tokenizar cartão. Verifique os dados e tente novamente.");
      }

      // Get correct payment_method_id and issuer_id from BIN
      let detectedPaymentMethodId = tokenResult.payment_method_id;
      let detectedIssuerId: string | undefined;
      const bin = tokenResult.first_six_digits;
      if (bin && mpInstanceRef.current) {
        try {
          const pmResponse = await fetch(`https://api.mercadopago.com/v1/payment_methods/search?bins=${bin}&site_id=MLB`, {
            headers: { "Content-Type": "application/json" },
          });
          // Alternative: use the public key endpoint
          const { data: configArr2 } = await supabase.rpc("get_public_payment_config", { p_restaurant_id: restaurantId });
          const cfgItem = Array.isArray(configArr2) && configArr2.length > 0 ? configArr2[0] : null;
          if (cfgItem?.mp_public_key) {
            const binResponse = await fetch(`https://api.mercadopago.com/v1/payment_methods/search?public_key=${cfgItem.mp_public_key}&bins=${bin}`);
            const binData = await binResponse.json();
            if (binData?.results?.[0]) {
              detectedPaymentMethodId = binData.results[0].id;
              detectedIssuerId = binData.results[0].issuer?.id?.toString();
            }
          }
        } catch (binErr) {
          console.warn("[OnlinePayment] BIN lookup failed, using token data:", binErr);
        }
      }

      const safeAmount = Number(Math.max(0.1, Math.round(amount * 100) / 100).toFixed(2));
      const safeEmail = customerEmail && customerEmail.trim() ? customerEmail.trim() : `cliente-${Date.now()}@pedido.com`;
      const resolvedOrderId = orderId ?? (ensureOrderId ? await ensureOrderId() : undefined) ?? undefined;
      const { data, error } = await supabase.functions.invoke("mercadopago-charge", {
        body: {
          restaurant_id: restaurantId,
          order_id: resolvedOrderId,
          amount: safeAmount,
          billing_type: "CREDIT_CARD",
          customer_name: customerName,
          customer_cpf: customerCPF,
          customer_email: safeEmail,
          customer_phone: customerPhone,
          card_token: tokenResult.id,
          payment_method_id: detectedPaymentMethodId,
          issuer_id: detectedIssuerId,
          installments: 1,
          save_card: saveNewCard,
          items: cartItems,
        },
      });

      if (error) throw error;

      if (data?.error) {
        setErrorMessage(data.error);
        toast.error(data.error);
        return;
      }

      if (data?.confirmed) {
        setOnlinePaymentId(data.online_payment_id);
        setPaymentStatus("confirmed");
        toast.success("Pagamento aprovado! ✅");
        setTimeout(() => onConfirm(data.online_payment_id), 1500);
      } else {
        setErrorMessage("Pagamento não aprovado. Verifique os dados do cartão e tente novamente.");
        toast.error("Pagamento não aprovado");
      }
    } catch (error: any) {
      console.error("[OnlinePayment] Credit card error:", error);
      const msg = error?.context?.body ? (typeof error.context.body === 'string' ? error.context.body : JSON.stringify(error.context.body)) : (error.message || "Erro ao processar pagamento");
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setProcessing(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const getCardBrandLabel = (paymentMethodId: string) => {
    const brands: Record<string, string> = {
      visa: "Visa",
      master: "Mastercard",
      amex: "Amex",
      elo: "Elo",
      hipercard: "Hipercard",
    };
    return brands[paymentMethodId] || paymentMethodId;
  };

  // ─── CONFIRMED STATE ───
  if (paymentStatus === "confirmed") {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-4 min-h-[300px]">
        <CheckCircle2 className="h-16 w-16 text-green-500" />
        <h2 className="text-xl font-bold text-green-600">Pagamento Confirmado!</h2>
        <p className="text-muted-foreground text-center">
          Seu pagamento foi aprovado com sucesso. Finalizando pedido...
        </p>
      </div>
    );
  }

  // ─── LOADING STATE ───
  if (paymentStatus === "loading") {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-4 min-h-[300px]">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground">
          {method === "pix" ? "Gerando QR Code Pix..." : "Processando pagamento..."}
        </p>
      </div>
    );
  }

  // ─── PIX MODE ───
  if (method === "pix") {
    return (
      <div className="p-4 space-y-4">
        <div className="text-center">
          <h2 className="text-xl font-bold flex items-center justify-center gap-2">
            <Smartphone className="h-5 w-5" />
            Pague via Pix
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Escaneie o QR Code ou copie o código para pagar</p>
        </div>

        <div className="text-center">
          <p className="text-3xl font-bold" style={{ color: primaryColor }}>
            R$ {amount.toFixed(2).replace(".", ",")}
          </p>
        </div>

        {paymentStatus === "error" && (
          <Card className="border-destructive bg-destructive/5">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
              <div>
                <p className="font-medium text-sm text-destructive">{errorMessage}</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={createPixCharge}>
                  Tentar novamente
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {paymentStatus === "waiting" && pixQrCodeBase64 && (
          <>
            <div className="flex justify-center">
              <div className="bg-white p-4 rounded-lg border">
                <img src={`data:image/png;base64,${pixQrCodeBase64}`} alt="QR Code Pix" className="w-56 h-56" />
              </div>
            </div>

            {pixQrCode && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Código Pix (Copia e Cola)</Label>
                <div className="flex gap-2">
                  <Input value={pixQrCode} readOnly className="text-xs font-mono" />
                  <Button variant="outline" size="icon" onClick={handleCopyPixCode}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Expira em: {formatTime(timeLeft)}</span>
            </div>

            <div className="flex items-center justify-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-muted-foreground">Aguardando pagamento...</span>
            </div>
          </>
        )}

        <div className="pt-2">
          <Button variant="outline" className="w-full" onClick={onBack}>
            Voltar
          </Button>
        </div>
      </div>
    );
  }

  // ─── CREDIT CARD MODE ───
  return (
    <div className="p-4 space-y-4">
      <style>{`
        #mp-card-number iframe,
        #mp-expiration-date iframe,
        #mp-security-code iframe {
          height: 100% !important;
          width: 100% !important;
          border: none !important;
          outline: none !important;
          margin: 0 !important;
          padding: 0 !important;
        }
      `}</style>

      <div className="text-center">
        <h2 className="text-xl font-bold flex items-center justify-center gap-2">
          <CreditCard className="h-5 w-5" />
          Pagamento com Cartão
        </h2>
        <p className="text-3xl font-bold mt-2" style={{ color: primaryColor }}>
          R$ {amount.toFixed(2).replace(".", ",")}
        </p>
      </div>

      {errorMessage && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="p-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{errorMessage}</p>
          </CardContent>
        </Card>
      )}

      {/* Saved Cards List */}
      {isLoadingCards ? (
        <div className="flex items-center justify-center gap-2 py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Carregando cartões...</span>
        </div>
      ) : savedCards.length > 0 ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Seus Cartões</h3>
          <RadioGroup value={selectedCardId} onValueChange={setSelectedCardId} className="space-y-2">
            {savedCards.map((card) => (
              <div
                key={card.id}
                className={`flex items-center justify-between border rounded-lg p-3 cursor-pointer transition-colors ${
                  selectedCardId === card.id ? "border-primary bg-primary/5" : "border-input"
                }`}
                onClick={() => setSelectedCardId(card.id)}
              >
                <div className="flex items-center gap-3">
                  <RadioGroupItem value={card.id} id={`card-${card.id}`} />
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">
                      {getCardBrandLabel(card.payment_method_id)} •••• {card.last_four_digits}
                    </p>
                    {card.expiration_month && card.expiration_year && (
                      <p className="text-xs text-muted-foreground">
                        {String(card.expiration_month).padStart(2, "0")}/{card.expiration_year}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteCard(card.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            {/* CVV input for saved card */}
            {selectedCardId !== "new" && (
              <div className="mt-2 max-w-[140px]">
                <Label className="text-sm font-medium">CVV *</Label>
                <Input
                  type="tel"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="CVV"
                  value={savedCardCvv}
                  onChange={(e) => setSavedCardCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="h-[44px] text-center tracking-widest text-lg"
                />
              </div>
            )}

            {/* New card option */}
            <div
              className={`flex items-center border rounded-lg p-3 cursor-pointer transition-colors ${
                selectedCardId === "new" ? "border-primary bg-primary/5" : "border-input"
              }`}
              onClick={() => setSelectedCardId("new")}
            >
              <div className="flex items-center gap-3">
                <RadioGroupItem value="new" id="card-new" />
                <CreditCard className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-medium">Adicionar Novo Cartão</p>
              </div>
            </div>
          </RadioGroup>
        </div>
      ) : null}

      {/* New Card Form — only when "new" is selected */}
      {selectedCardId === "new" && (
        <div className="space-y-4">
          <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Dados do Cartão</h3>

          <div className="space-y-1 relative">
            <Label className="w-fit pointer-events-none block z-40 relative">Número do Cartão *</Label>
            <div
              id="mp-card-number"
              className="h-[48px] w-full border border-input rounded-md bg-background relative overflow-hidden cursor-text flex items-center"
            ></div>
          </div>

          <div className="space-y-1 relative">
            <Label className="w-fit pointer-events-none block z-40 relative">Nome Impresso no Cartão *</Label>
            <Input
              value={cardHolderName}
              onChange={(e) => setCardHolderName(e.target.value.toUpperCase())}
              placeholder="NOME COMO NO CARTÃO"
              className="h-[48px] relative z-30"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1 relative">
              <Label className="w-fit pointer-events-none block z-40 relative">Validade *</Label>
              <div
                id="mp-expiration-date"
                className="h-[48px] w-full border border-input rounded-md bg-background relative overflow-hidden cursor-text flex items-center"
              ></div>
            </div>
            <div className="space-y-1 relative">
              <Label className="w-fit pointer-events-none block z-40 relative">CVV *</Label>
              <div
                id="mp-security-code"
                className="h-[48px] w-full border border-input rounded-md bg-background relative overflow-hidden cursor-text flex items-center"
              ></div>
            </div>
          </div>

          {/* Save card checkbox */}
          <div className="flex items-center space-x-2 pt-1">
            <Checkbox
              id="save-card"
              checked={saveNewCard}
              onCheckedChange={(checked) => setSaveNewCard(checked === true)}
            />
            <label
              htmlFor="save-card"
              className="text-sm text-muted-foreground cursor-pointer leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Salvar este cartão para compras futuras
            </label>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2 relative z-50 pointer-events-auto pb-safe">
        <Button variant="outline" className="flex-1" onClick={onBack} disabled={processing}>
          Voltar
        </Button>
        <Button
          className="flex-1"
          onClick={handleCreditCardPayment}
          disabled={processing}
          style={primaryColor ? { backgroundColor: primaryColor, color: "white" } : undefined}
        >
          {processing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processando...
            </>
          ) : (
            `Pagar R$ ${amount.toFixed(2).replace(".", ",")}`
          )}
        </Button>
      </div>
    </div>
  );
};

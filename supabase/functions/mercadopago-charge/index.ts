import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-app-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      restaurant_id,
      order_id,
      amount,
      billing_type,
      customer_name,
      customer_cpf,
      customer_email,
      customer_phone,
      card_token,
      payment_method_id,
      issuer_id,
      installments,
      items,
      action,
      saved_card_id,
      save_card,
      security_code,
    } = await req.json();

    // Round amount to 2 decimal places and validate
    const roundedAmount = Math.round(Number(amount) * 100) / 100;

    if (!restaurant_id || !roundedAmount || roundedAmount <= 0 || !billing_type) {
      return new Response(
        JSON.stringify({ success: false, error: "Valor inválido ou dados obrigatórios ausentes" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build additional_info.items for MP anti-fraud, filtering out zero-price items
    const mpItems = Array.isArray(items) && items.length > 0
      ? items
          .filter((item: any) => Number(item.unit_price) > 0)
          .map((item: any) => ({
            id: item.id || "unknown",
            title: item.name || "Produto",
            description: item.name || "Produto",
            quantity: item.quantity || 1,
            unit_price: Math.round(Number(item.unit_price) * 100) / 100,
            category_id: "food",
          }))
      : [];

    // Fallback if all items were filtered out
    if (mpItems.length === 0) {
      mpItems.push({
        id: "order",
        title: `Pedido ${order_id || "delivery"}`,
        description: "Pedido delivery",
        quantity: 1,
        unit_price: roundedAmount,
        category_id: "food",
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch restaurant's MP access token
    const { data: config, error: configError } = await supabase
      .from("online_payment_config")
      .select("mp_access_token, mp_public_key, mp_sandbox_payer_email")
      .eq("restaurant_id", restaurant_id)
      .maybeSingle();

    if (configError || !config?.mp_access_token) {
      return new Response(
        JSON.stringify({ success: false, error: "Mercado Pago não configurado para este restaurante" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const mpAccessToken = config.mp_access_token;
    const webhookUrl = `${supabaseUrl}/functions/v1/mercadopago-webhook`;

    // Sandbox detection + safe email
    const isSandbox = mpAccessToken.startsWith("TEST-");
    let safePayerEmail: string;
    if (isSandbox) {
      if (config.mp_sandbox_payer_email && config.mp_sandbox_payer_email.trim()) {
        safePayerEmail = config.mp_sandbox_payer_email.trim();
      } else {
        return new Response(
          JSON.stringify({ success: false, error: "Email de teste (sandbox) não configurado. Vá em Configurações > Pagamentos Online e preencha o campo 'Email de teste'." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      safePayerEmail = (customer_email && customer_email.trim()) ? customer_email.trim() : `cliente-${Date.now()}@pedido.com`;
    }

    console.log("[MP Charge] Token prefix:", mpAccessToken.substring(0, 10), "isSandbox:", isSandbox);
    console.log("[MP Charge] billing_type:", billing_type, "amount:", roundedAmount);

    let mpResponse: Response;
    let mpData: any;

    if (billing_type === "PIX") {
      mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mpAccessToken}`,
          "X-Idempotency-Key": `${restaurant_id}-${order_id || Date.now()}`,
        },
        body: JSON.stringify({
          transaction_amount: roundedAmount,
          payment_method_id: "pix",
          notification_url: webhookUrl,
          external_reference: order_id || `ref-${restaurant_id}-${Date.now()}`,
          payer: {
            email: safePayerEmail,
            first_name: customer_name || "Cliente",
            identification: customer_cpf
              ? { type: "CPF", number: customer_cpf.replace(/\D/g, "") }
              : undefined,
          },
          description: `Pedido ${order_id || "delivery"}`,
          additional_info: { items: mpItems },
        }),
      });

      mpData = await mpResponse.json();

      if (!mpResponse.ok) {
        console.error("[MP Charge] PIX error:", JSON.stringify(mpData));
        return new Response(
          JSON.stringify({ success: false, error: mpData.message || "Erro ao gerar Pix no Mercado Pago" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const pixData = mpData.point_of_interaction?.transaction_data;

      const { data: payment, error: paymentError } = await supabase
        .from("online_payments")
        .insert({
          restaurant_id,
          order_id: order_id || null,
          amount: roundedAmount,
          provider: "mercadopago",
          provider_payment_id: String(mpData.id),
          status: "pending",
          payment_method: "pix",
          customer_name,
          customer_cpf,
          customer_email,
          customer_phone,
          pix_qr_code: pixData?.qr_code || null,
          pix_qr_code_base64: pixData?.qr_code_base64 || null,
          pix_expiration: mpData.date_of_expiration || null,
        })
        .select("id")
        .single();

      if (paymentError) {
        console.error("[MP Charge] DB error:", paymentError);
        return new Response(
          JSON.stringify({ success: false, error: "Erro ao salvar pagamento" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          online_payment_id: payment.id,
          pix_qr_code: pixData?.qr_code,
          pix_qr_code_base64: pixData?.qr_code_base64,
          pix_expiration: mpData.date_of_expiration,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else if (billing_type === "CREDIT_CARD") {
      const safeEmail = safePayerEmail;

      // Handle saved card payment
      if (action === "pay_with_saved_card" && saved_card_id) {
        // Fetch saved card details
        const { data: savedCard, error: cardError } = await supabase
          .from("customer_cards")
          .select("*")
          .eq("id", saved_card_id)
          .single();

        if (cardError || !savedCard) {
          return new Response(
            JSON.stringify({ success: false, error: "Cartão salvo não encontrado" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Fetch actual card details from MP to get correct payment_method_id and issuer
        let resolvedPaymentMethodId = savedCard.payment_method_id;
        let resolvedIssuerId: string | undefined;
        try {
          const cardDetailRes = await fetch(
            `https://api.mercadopago.com/v1/customers/${savedCard.mp_customer_id}/cards/${savedCard.card_id}`,
            { headers: { Authorization: `Bearer ${mpAccessToken}` } }
          );
          if (cardDetailRes.ok) {
            const cardDetail = await cardDetailRes.json();
            console.log("[MP Charge] Saved card detail:", JSON.stringify({
              payment_method: cardDetail.payment_method,
              issuer: cardDetail.issuer,
              id: cardDetail.id,
            }));
            if (cardDetail.payment_method?.id) {
              resolvedPaymentMethodId = cardDetail.payment_method.id;
            }
            if (cardDetail.issuer?.id) {
              resolvedIssuerId = String(cardDetail.issuer.id);
            }
          } else {
            const errBody = await cardDetailRes.text();
            console.error("[MP Charge] Card detail fetch error:", cardDetailRes.status, errBody);
          }
        } catch (e) {
          console.warn("[MP Charge] Card detail fetch failed, using stored payment_method_id:", e);
        }

        if (!resolvedPaymentMethodId) {
          return new Response(
            JSON.stringify({ success: false, error: "Não foi possível identificar a bandeira do cartão salvo" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Generate a card_token from the saved card_id (required by MP for all card payments)
        let generatedTokenId: string | null = null;
        try {
          const tokenRes = await fetch("https://api.mercadopago.com/v1/card_tokens", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${mpAccessToken}`,
            },
            body: JSON.stringify({
              card_id: savedCard.card_id,
              customer_id: savedCard.mp_customer_id,
              security_code: security_code || undefined,
            }),
          });
          const tokenData = await tokenRes.json();
          console.log("[MP Charge] Card token response:", JSON.stringify({ status: tokenRes.status, id: tokenData.id, error: tokenData.message }));
          if (tokenRes.ok && tokenData.id) {
            generatedTokenId = tokenData.id;
          } else {
            console.error("[MP Charge] Failed to generate card token:", JSON.stringify(tokenData));
            return new Response(
              JSON.stringify({ success: false, error: "Não foi possível gerar token do cartão salvo" }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        } catch (e) {
          console.error("[MP Charge] Card token generation error:", e);
          return new Response(
            JSON.stringify({ success: false, error: "Erro ao gerar token do cartão salvo" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log("[MP Charge] Saved card payment payload:", JSON.stringify({
          payment_method_id: resolvedPaymentMethodId,
          issuer_id: resolvedIssuerId,
          payer_id: savedCard.mp_customer_id,
          token: generatedTokenId,
          amount: roundedAmount,
        }));

        const savedCardPayload: any = {
          transaction_amount: roundedAmount,
          token: generatedTokenId,
          payment_method_id: resolvedPaymentMethodId,
          installments: installments || 1,
          notification_url: webhookUrl,
          external_reference: order_id || `ref-${restaurant_id}-${Date.now()}`,
          payer: {
            type: "customer",
            id: savedCard.mp_customer_id,
            email: safeEmail,
            first_name: customer_name || "Cliente",
            identification: customer_cpf
              ? { type: "CPF", number: customer_cpf.replace(/\D/g, "") }
              : undefined,
          },
          description: `Pedido ${order_id || "delivery"}`,
          additional_info: { items: mpItems },
        };

        if (resolvedIssuerId) {
          savedCardPayload.issuer_id = Number(resolvedIssuerId);
        }

        mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${mpAccessToken}`,
            "X-Idempotency-Key": `${restaurant_id}-${order_id || Date.now()}-saved-${saved_card_id}`,
          },
          body: JSON.stringify(savedCardPayload),
        });
      } else {
        // New card payment
        // Log new card payment payload for diagnostics
        const newCardPayload = {
          transaction_amount: roundedAmount,
          token: card_token,
          payment_method_id: payment_method_id,
          issuer_id: issuer_id ? Number(issuer_id) : undefined,
          installments: installments || 1,
          notification_url: webhookUrl,
          external_reference: order_id || `ref-${restaurant_id}-${Date.now()}`,
          payer: {
            email: safeEmail,
            first_name: customer_name || "Cliente",
            identification: customer_cpf
              ? { type: "CPF", number: customer_cpf.replace(/\D/g, "") }
              : undefined,
          },
          description: `Pedido ${order_id || "delivery"}`,
          additional_info: { items: mpItems },
        };
        console.log("[MP Charge] New card payload:", JSON.stringify(newCardPayload));

        mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${mpAccessToken}`,
            "X-Idempotency-Key": `${restaurant_id}-${order_id || Date.now()}-cc`,
          },
          body: JSON.stringify({
            transaction_amount: roundedAmount,
            token: card_token,
            payment_method_id: payment_method_id,
            issuer_id: issuer_id ? Number(issuer_id) : undefined,
            installments: installments || 1,
            notification_url: webhookUrl,
            external_reference: order_id || `ref-${restaurant_id}-${Date.now()}`,
            payer: {
              email: safeEmail,
              first_name: customer_name || "Cliente",
              identification: customer_cpf
                ? { type: "CPF", number: customer_cpf.replace(/\D/g, "") }
                : undefined,
            },
            description: `Pedido ${order_id || "delivery"}`,
            additional_info: { items: mpItems },
          }),
        });

        // Save card if requested and payment succeeds
        if (save_card && card_token) {
          // Will save after checking payment status below
        }
      }

      mpData = await mpResponse.json();

      if (!mpResponse.ok) {
        console.error("[MP Charge] Card error:", JSON.stringify(mpData));
        console.error("[MP Charge] Card error status:", mpResponse.status);
        const detail = mpData.cause?.[0]?.description || mpData.message || "Erro ao processar cartão";
        const friendlyMsg = detail === "internal_error" 
          ? "Erro temporário no gateway de pagamento. Tente novamente em alguns instantes."
          : detail;
        return new Response(
          JSON.stringify({ success: false, error: friendlyMsg, mp_status_detail: mpData.cause?.[0]?.code }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const isApproved = mpData.status === "approved";

      // Save card if requested and payment was approved
      if (save_card && isApproved && card_token && mpData.card && customer_cpf) {
        try {
          // Create or find MP customer
          const cleanCpf = customer_cpf.replace(/\D/g, "");
          const safeEmail = safePayerEmail;
          
          // Search existing customer
          let mpCustomerId: string | null = null;
          const searchRes = await fetch(`https://api.mercadopago.com/v1/customers/search?email=${encodeURIComponent(safeEmail)}`, {
            headers: { Authorization: `Bearer ${mpAccessToken}` },
          });
          const searchData = await searchRes.json();
          
          if (searchData.results && searchData.results.length > 0) {
            mpCustomerId = searchData.results[0].id;
          } else {
            // Create customer
            const createRes = await fetch("https://api.mercadopago.com/v1/customers", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${mpAccessToken}`,
              },
              body: JSON.stringify({
                email: safeEmail,
                first_name: customer_name || "Cliente",
                identification: { type: "CPF", number: cleanCpf },
              }),
            });
            const createData = await createRes.json();
            mpCustomerId = createData.id;
          }

          if (mpCustomerId) {
            // Save card to MP customer
            const cardRes = await fetch(`https://api.mercadopago.com/v1/customers/${mpCustomerId}/cards`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${mpAccessToken}`,
              },
              body: JSON.stringify({ token: card_token }),
            });
            const savedCardData = await cardRes.json();

            if (savedCardData.id) {
              await supabase.from("customer_cards").insert({
                restaurant_id,
                customer_cpf: cleanCpf,
                customer_phone: customer_phone || "",
                mp_customer_id: mpCustomerId,
                card_id: savedCardData.id,
                last_four_digits: savedCardData.last_four_digits || mpData.card?.last_four_digits || "****",
                first_six_digits: savedCardData.first_six_digits || mpData.card?.first_six_digits || null,
                payment_method_id: savedCardData.payment_method?.id || payment_method_id || "unknown",
                expiration_month: savedCardData.expiration_month || null,
                expiration_year: savedCardData.expiration_year || null,
              });
              console.log("[MP Charge] Card saved successfully");
            }
          }
        } catch (saveErr) {
          console.error("[MP Charge] Error saving card (non-fatal):", saveErr);
        }
      }

      const { data: payment, error: paymentError } = await supabase
        .from("online_payments")
        .insert({
          restaurant_id,
          order_id: order_id || null,
          amount: roundedAmount,
          provider: "mercadopago",
          provider_payment_id: String(mpData.id),
          status: isApproved ? "confirmed" : "pending",
          payment_method: "credit_card",
          customer_name,
          customer_cpf,
          customer_email,
          customer_phone,
          paid_at: isApproved ? new Date().toISOString() : null,
        })
        .select("id")
        .single();

      if (paymentError) {
        console.error("[MP Charge] DB error:", paymentError);
        return new Response(
          JSON.stringify({ success: false, error: "Erro ao salvar pagamento" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          online_payment_id: payment.id,
          confirmed: isApproved,
          mp_status: mpData.status,
          mp_status_detail: mpData.status_detail,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "billing_type inválido. Use PIX ou CREDIT_CARD" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[MP Charge] Unexpected error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro interno" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

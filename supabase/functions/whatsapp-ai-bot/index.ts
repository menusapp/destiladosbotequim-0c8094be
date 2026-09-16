import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-token',
};

// Domínio público do cardápio. Configurável pelo secret PUBLIC_DOMAIN.
const PUBLIC_DOMAIN = Deno.env.get("PUBLIC_DOMAIN") || "menusapp.com.br";
const SUPABASE_URL_ENV = Deno.env.get('SUPABASE_URL') || '';

// Build the public menu URL using the path-based format:
// https://menusapp.com.br/<slug>/<path>
// (Subdomínios desativados — Lovable não suporta wildcard em domínios customizados.)
function buildPublicUrl(slug: string, path?: string): string {
  const base = `https://${PUBLIC_DOMAIN}/${slug}`;
  return path ? `${base}/${path.replace(/^\/+/, '')}` : base;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { restaurant_id, customer_phone, message_text, simulate, customer_name } = body;

    if (!restaurant_id || !customer_phone || message_text === undefined) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check if AI is active
    const { data: aiConfig } = await supabase
      .from('whatsapp_ai_config')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .maybeSingle();

    if (!aiConfig?.is_active && !simulate) {
      return new Response(JSON.stringify({ skipped: true, reason: 'AI not active' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // For simulator, fall back to defaults if no config exists
    const effectiveConfig = aiConfig || { welcome_message_type: 'numeric_menu', is_active: true };

    // Get restaurant info
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('name, slug, prep_time_minutes')
      .eq('id', restaurant_id)
      .single();

    if (!restaurant) {
      return new Response(JSON.stringify({ error: 'Restaurant not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get or create conversation
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    let { data: conversation } = await supabase
      .from('whatsapp_conversations')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .eq('customer_phone', customer_phone)
      .maybeSingle();

    // ── Bot pause check ──
    if (!simulate && conversation?.bot_paused && conversation?.bot_paused_until) {
      const pausedUntil = new Date(conversation.bot_paused_until);
      if (pausedUntil > new Date()) {
        console.log(`[AI-BOT] Bot paused for ${customer_phone} until ${pausedUntil.toISOString()}`);
        return new Response(JSON.stringify({ skipped: true, reason: 'bot_paused' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else {
        // Pause expired — reactivate bot
        await supabase
          .from('whatsapp_conversations')
          .update({
            bot_paused: false,
            bot_paused_until: null,
            paused_reason: null,
            current_step: 'welcome',
          })
          .eq('id', conversation.id);
        conversation.current_step = 'welcome';
        conversation.bot_paused = false;
      }
    }

    if (conversation && conversation.last_message_at < fourHoursAgo) {
      await supabase
        .from('whatsapp_conversations')
        .update({ current_step: 'welcome', order_draft: {}, last_message_at: new Date().toISOString() })
        .eq('id', conversation.id);
      conversation.current_step = 'welcome';
      conversation.order_draft = {};
    }

    if (!conversation) {
      const { data: newConv } = await supabase
        .from('whatsapp_conversations')
        .upsert({
          restaurant_id,
          customer_phone,
          current_step: 'welcome',
          order_draft: {},
          last_message_at: new Date().toISOString()
        }, { onConflict: 'restaurant_id,customer_phone' })
        .select()
        .single();
      conversation = newConv;
    }

    // Get menu options
    const { data: menuOptions } = await supabase
      .from('whatsapp_menu_options')
      .select('*')
      .eq('restaurant_id', restaurant_id)
      .eq('is_active', true)
      .order('position');

    const menuLink = buildPublicUrl(restaurant.slug);
    const welcomeType = effectiveConfig.welcome_message_type || 'numeric_menu';

    // ── Link-only cooldown: only send the menu link once every 2 hours ──
    if (welcomeType === 'link_only' && !simulate) {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const lastSentAt = conversation?.last_message_at ? new Date(conversation.last_message_at) : null;
      const alreadyGreeted = conversation?.current_step === 'menu';
      if (alreadyGreeted && lastSentAt && lastSentAt > twoHoursAgo) {
        console.log(`[AI-BOT] link_only cooldown active for ${customer_phone}, skipping`);
        return new Response(JSON.stringify({ skipped: true, reason: 'link_only_cooldown' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    let responseText = '';
    let newStep = conversation.current_step;

    // Process by step
    if (conversation.current_step === 'welcome') {
      responseText = buildWelcomeMessage(welcomeType, restaurant.name, menuLink, menuOptions || [], customer_name || '');
      newStep = 'menu';
    } else if (conversation.current_step === 'menu') {
      if (welcomeType === 'link_only') {
        responseText = `📱 Acesse nosso cardápio digital:\n${menuLink}`;
        newStep = 'menu';
      } else {
        const result = await processMenuChoice(
          message_text, menuOptions || [], restaurant, effectiveConfig, supabase, restaurant_id, menuLink, customer_phone
        );
        responseText = result.response;
        newStep = result.newStep;

        // ── If human_attendant was selected, pause the bot for 6h ──
        if (newStep === 'human') {
          const pauseUntil = new Date(Date.now() + 6 * 60 * 60 * 1000);
          await supabase
            .from('whatsapp_conversations')
            .update({
              current_step: 'human',
              bot_paused: true,
              bot_paused_until: pauseUntil.toISOString(),
              paused_reason: 'human_requested',
              last_message_at: new Date().toISOString(),
            })
            .eq('id', conversation.id);

          // Send the transfer message and return immediately
          if (!simulate && responseText) {
            await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                restaurantId: restaurant_id,
                phone: customer_phone,
                message: responseText,
                messageType: 'ai_bot',
              }),
            });
          }

          return new Response(JSON.stringify({
            response: responseText,
            step: newStep,
            simulated: !!simulate
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }
    } else if (conversation.current_step === 'human') {
      return new Response(JSON.stringify({ skipped: true, reason: 'human_mode' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Update conversation state
    await supabase
      .from('whatsapp_conversations')
      .update({ current_step: newStep, last_message_at: new Date().toISOString() })
      .eq('id', conversation.id);

    // Send via WhatsApp (unless simulating)
    if (!simulate && responseText) {
      await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId: restaurant_id,
          phone: customer_phone,
          message: responseText,
          messageType: 'ai_bot',
        }),
      });
    }

    return new Response(JSON.stringify({ 
      response: responseText, 
      step: newStep,
      simulated: !!simulate 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('[AI-BOT ERROR]', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function buildWelcomeMessage(
  type: string, restaurantName: string, menuLink: string, menuOptions: any[], customerName: string
): string {
  const greeting = customerName
    ? `👋 Olá, *${customerName}*! Tudo bem?`
    : `👋 Olá! Tudo bem?`;

  if (type === 'link_only') {
    return `${greeting}\n\nBem-vindo(a) ao *${restaurantName}*! 🍽️\n\nAcesse nosso cardápio digital:\n${menuLink}`;
  }

  let msg = `${greeting}\n\nBem-vindo(a) ao *${restaurantName}*! 🍽️\n\n📱 Cardápio: ${menuLink}\n\nDigite o número da opção desejada:\n`;
  for (const opt of menuOptions) {
    msg += `\n*${opt.position}* - ${opt.label}`;
  }
  return msg;
}

async function processMenuChoice(
  messageText: string,
  menuOptions: any[],
  restaurant: any,
  aiConfig: any,
  supabase: any,
  restaurantId: string,
  menuLink: string,
  customerPhone: string
): Promise<{ response: string; newStep: string }> {
  const trimmed = messageText.trim();
  const chosenNumber = parseInt(trimmed);
  const matched = menuOptions.find((o: any) => o.position === chosenNumber);

  if (!matched) {
    let msg = `Não entendi. Digite o número da opção desejada:\n`;
    for (const opt of menuOptions) {
      msg += `\n*${opt.position}* - ${opt.label}`;
    }
    return { response: msg, newStep: 'menu' };
  }

  switch (matched.action_type) {
    case 'send_menu':
      return {
        response: `📱 Acesse nosso cardápio digital:\n${menuLink}`,
        newStep: 'menu'
      };

    case 'order_status': {
      const { data: orders } = await supabase
        .from('orders')
        .select('id, status, created_at')
        .eq('restaurant_id', restaurantId)
        .eq('delivery_phone', customerPhone)
        .order('created_at', { ascending: false })
        .limit(1);

      if (orders && orders.length > 0) {
        const order = orders[0];
        const statusMap: Record<string, string> = {
          pending: '⏳ Pendente',
          accepted: '✅ Aceito',
          preparing: '👨‍🍳 Em preparo',
          ready: '🔔 Pronto',
          out_for_delivery: '🛵 Saiu para entrega',
          delivered: '✅ Entregue',
          cancelled: '❌ Cancelado'
        };
        const statusText = statusMap[order.status] || order.status;
        return {
          response: `📦 Seu pedido mais recente:\n\nPedido: #${order.id.slice(0, 8)}\nStatus: ${statusText}`,
          newStep: 'menu'
        };
      }
      return {
        response: `Não encontrei pedidos recentes para o seu número. Faça seu pedido pelo cardápio:\n${menuLink}`,
        newStep: 'menu'
      };
    }

    case 'business_hours': {
      const { data: hours } = await supabase
        .from('business_hours')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('day_of_week');

      const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
      let msg = `🕐 *Horário de Funcionamento*\n`;
      if (hours) {
        for (const h of hours) {
          const day = dayNames[h.day_of_week] || `Dia ${h.day_of_week}`;
          if (h.is_open) {
            msg += `\n${day}: ${h.open_time?.slice(0, 5)} às ${h.close_time?.slice(0, 5)}`;
          } else {
            msg += `\n${day}: Fechado`;
          }
        }
      }
      return { response: msg, newStep: 'menu' };
    }

    case 'human_attendant':
      return {
        response: `👤 Transferindo para um atendente humano. Em breve alguém entrará em contato! 😊`,
        newStep: 'human'
      };

    case 'start_order':
      if (aiConfig.accept_orders_via_whatsapp) {
        return {
          response: `🛒 Acesse nosso cardápio e monte seu pedido:\n${menuLink}\n\nApós finalizar, confirmaremos aqui!`,
          newStep: 'menu'
        };
      }
      return {
        response: `📱 Faça seu pedido pelo cardápio digital:\n${menuLink}`,
        newStep: 'menu'
      };

    case 'custom_message':
      return {
        response: matched.custom_message || 'Mensagem não configurada.',
        newStep: 'menu'
      };

    default:
      return { response: `Opção não configurada.`, newStep: 'menu' };
  }
}

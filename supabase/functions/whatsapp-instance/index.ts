import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-token',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

const EVOLUTION_API_URL = Deno.env.get('EVOLUTION_API_URL');
const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY');

// Helper to extract QR string from various response formats
function extractQrData(data: any): { qrString: string | null; pairingCode: string | null } {
  let qrString = null;
  let pairingCode = null;

  if (typeof data.code === 'string' && data.code.length > 20) {
    qrString = data.code;
  } else if (typeof data.qrcode === 'string' && data.qrcode.length > 20) {
    qrString = data.qrcode;
  } else if (typeof data.qr === 'string' && data.qr.length > 20) {
    qrString = data.qr;
  } else if (data.qrcode?.code) {
    qrString = data.qrcode.code;
  } else if (data.base64 && data.base64.length > 100) {
    qrString = data.base64;
  } else if (data.qrcode?.base64 && data.qrcode.base64.length > 100) {
    qrString = data.qrcode.base64;
  }

  pairingCode = data.pairingCode || data.pairing_code || data.qrcode?.pairingCode || null;

  return { qrString, pairingCode };
}

// Try multiple endpoints to get QR code
async function tryGetQrCode(instanceName: string): Promise<{ qrString: string | null; pairingCode: string | null; rawResponse: any }> {
  const endpoints = [
    { method: 'GET', path: `/instance/connect/${instanceName}` },
    { method: 'POST', path: `/instance/connect/${instanceName}` },
    { method: 'GET', path: `/instance/qrcode/${instanceName}` },
    { method: 'GET', path: `/instance/qr/${instanceName}` },
  ];

  for (const endpoint of endpoints) {
    try {
      console.log(`[QR] Trying ${endpoint.method} ${endpoint.path}`);
      
      const response = await fetch(`${EVOLUTION_API_URL}${endpoint.path}`, {
        method: endpoint.method,
        headers: { 
          'apikey': EVOLUTION_API_KEY!,
          'Content-Type': 'application/json'
        }
      });

      const rawText = await response.text();
      console.log(`[QR] ${endpoint.method} ${endpoint.path} - Status: ${response.status}, Body: ${rawText.substring(0, 500)}`);

      if (!response.ok) continue;

      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        continue;
      }

      if (data.count === 0 || (typeof data === 'object' && Object.keys(data).length === 0)) {
        continue;
      }

      const extracted = extractQrData(data);
      if (extracted.qrString) {
        console.log(`[QR] Success with ${endpoint.method} ${endpoint.path}, QR length: ${extracted.qrString.length}`);
        return { ...extracted, rawResponse: data };
      }
    } catch (error) {
      console.log(`[QR] Error on ${endpoint.method} ${endpoint.path}:`, error);
    }
  }

  return { qrString: null, pairingCode: null, rawResponse: null };
}

// Configure webhook for instance so messages flow to our system automatically
async function configureWebhook(instanceName: string): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) {
    console.log('[WEBHOOK] SUPABASE_URL not set, skipping webhook config');
    return;
  }
  const webhookUrl = `${supabaseUrl}/functions/v1/whatsapp-webhook`;
  const webhookData = {
    url: webhookUrl,
    webhook_by_events: false,
    webhook_base64: false,
    events: ['CONNECTION_UPDATE', 'QRCODE_UPDATED', 'MESSAGES_UPSERT', 'LOGOUT_INSTANCE'],
    enabled: true,
  };

  // Try with "webhook" wrapper first (Evolution API v2 format), then flat
  const payloads = [
    { label: 'wrapped', data: { webhook: webhookData } },
    { label: 'flat', data: webhookData },
  ];

  for (const pl of payloads) {
    try {
      const ep = `/webhook/set/${instanceName}`;
      console.log(`[WEBHOOK] Trying POST ${ep} (${pl.label}) for ${instanceName}`);
      const res = await fetch(`${EVOLUTION_API_URL}${ep}`, {
        method: 'POST',
        headers: {
          'apikey': EVOLUTION_API_KEY!,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(pl.data)
      });
      const body = await res.text();
      console.log(`[WEBHOOK] POST ${ep} (${pl.label}) response: ${res.status} - ${body.substring(0, 300)}`);
      if (res.ok) {
        console.log(`[WEBHOOK] Successfully configured webhook for ${instanceName}`);
        return;
      }
    } catch (error) {
      console.log(`[WEBHOOK] Error (${pl.label}):`, error);
    }
  }
  console.log(`[WEBHOOK] All attempts failed for ${instanceName} (non-blocking)`);
}

// Restart instance to force new QR generation
async function restartInstance(instanceName: string): Promise<boolean> {
  try {
    console.log(`[RESTART] Restarting instance: ${instanceName}`);
    const restartResponse = await fetch(`${EVOLUTION_API_URL}/instance/restart/${instanceName}`, {
      method: 'PUT',
      headers: { 'apikey': EVOLUTION_API_KEY! }
    });
    console.log(`[RESTART] Restart status: ${restartResponse.status}`);
    if (restartResponse.ok) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return true;
    }
    return false;
  } catch (error) {
    console.log(`[RESTART] Error:`, error);
    return false;
  }
}

// Try checking connection state, with fallback to old instance name and DB-saved name
async function tryCheckState(instanceName: string, fallbackName: string | null, dbInstanceName: string | null = null): Promise<{ stateData: any; resolvedName: string } | null> {
  const namesToTry = [instanceName, fallbackName, dbInstanceName].filter(Boolean) as string[];
  // Deduplicate
  const unique = [...new Set(namesToTry)];
  for (const name of unique) {
    try {
      const res = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${name}`, {
        headers: { 'apikey': EVOLUTION_API_KEY! }
      });
      if (res.ok) {
        const data = await res.json();
        return { stateData: data, resolvedName: name };
      }
    } catch {}
  }
  return null;
}

// Resolve instance name: prefer slug-based, fallback to uuid-based
async function resolveInstanceName(supabase: any, restaurantId: string): Promise<{ instanceName: string; fallbackName: string }> {
  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('slug')
    .eq('id', restaurantId)
    .single();

  const slug = restaurant?.slug;
  const instanceName = slug ? `rest-${slug}` : `rest-${restaurantId.slice(0, 8)}`;
  const fallbackName = `rest-${restaurantId.slice(0, 8)}`;

  return { instanceName, fallbackName };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const restaurantId = url.searchParams.get('restaurantId');

    if (!restaurantId) {
      return new Response(
        JSON.stringify({ error: 'restaurantId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { instanceName, fallbackName } = await resolveInstanceName(supabase, restaurantId);

    // GET - Fetch instance status
    if (req.method === 'GET') {
      console.log(`[GET] Fetching status for instance: ${instanceName}`);

      const { data: config } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      const dbInstanceName = config?.instance_name || null;
      const stateResult = await tryCheckState(instanceName, fallbackName, dbInstanceName);

      if (stateResult) {
        const { stateData, resolvedName } = stateResult;
        console.log(`[GET] Connection state (${resolvedName}):`, stateData);

        const instanceState = stateData.instance?.state || stateData.state || 'unknown';

        // Normalize state mapping
        const stateMap: Record<string, string> = {
          'open': 'connected',
          'connecting': 'connecting',
          'close': 'disconnected',
          'closed': 'disconnected',
        };
        const normalizedStatus = stateMap[instanceState] || 'disconnected';

        const updateData: Record<string, any> = {
          restaurant_id: restaurantId,
          instance_name: resolvedName,
          instance_status: normalizedStatus,
          updated_at: new Date().toISOString()
        };
        if (normalizedStatus === 'connected') {
          updateData.connected_at = new Date().toISOString();
          // Auto-enable on first successful connection so test/AI bot work immediately
          updateData.enabled = true;
        }

        // Persistir o estado é essencial: o envio e as notificações leem daqui.
        // Antes o erro era engolido em silêncio — o painel mostrava "Conectado"
        // (estado ao vivo) enquanto o banco ficava sem a linha.
        const { error: upsertError } = await supabase
          .from('whatsapp_config')
          .upsert(updateData, { onConflict: 'restaurant_id' });
        if (upsertError) {
          console.error('[GET] Falha ao salvar whatsapp_config:', upsertError);
        }

        return new Response(
          JSON.stringify({
            instance_name: resolvedName,
            status: normalizedStatus,
            state: instanceState,
            config,
            persist_error: upsertError?.message ?? null
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          instance_name: instanceName,
          status: 'not_created',
          config
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // POST - Create instance or get QR code
    if (req.method === 'POST') {
      const body = await req.json();
      const action = body.action || 'create';

      if (action === 'create') {
        console.log(`[POST] Creating instance: ${instanceName}`);

        const createResponse = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': EVOLUTION_API_KEY!
          },
          body: JSON.stringify({
            instanceName: instanceName,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS'
          })
        });

        const createText = await createResponse.text();
        console.log(`[POST] Create response status: ${createResponse.status}, body: ${createText}`);

        let createData;
        try {
          createData = JSON.parse(createText);
        } catch {
          createData = { raw: createText };
        }

        const instanceExists = !createResponse.ok && 
          (createData.message?.includes('already') || createData.error?.includes('already') || createResponse.status === 403);

        if (!createResponse.ok && !instanceExists) {
          throw new Error(createData.message || createData.error || 'Failed to create instance');
        }

        if (instanceExists) {
          console.log(`[POST] Instance exists, trying to restart and get QR...`);
          await restartInstance(instanceName);
        }

        // Save to database
        await supabase
          .from('whatsapp_config')
          .upsert({
            restaurant_id: restaurantId,
            instance_name: instanceName,
            instance_status: 'pending',
            updated_at: new Date().toISOString()
          }, { onConflict: 'restaurant_id' });

        // Configure webhook automatically (non-blocking)
        await configureWebhook(instanceName);

        // Wait for instance to initialize (reduced from 3s to 1s)
        console.log(`[POST] Waiting 1s for instance to initialize...`);
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Get QR code with faster retry
        let qrString = null;
        let pairingCode = null;
        let attempts = 0;
        const maxAttempts = 6;
        const retryDelay = 1500;

        while (!qrString && attempts < maxAttempts) {
          attempts++;
          console.log(`[POST] QR attempt ${attempts}/${maxAttempts}...`);

          const result = await tryGetQrCode(instanceName);
          qrString = result.qrString;
          pairingCode = result.pairingCode;

          if (!qrString && attempts < maxAttempts) {
            console.log(`[POST] QR not available, waiting ${retryDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }

        if (!qrString) {
          console.log(`[POST] Failed to get QR after ${maxAttempts} attempts`);
          return new Response(
            JSON.stringify({
              success: false,
              status: 'pending_qr',
              instance_name: instanceName,
              message: 'QR code ainda não disponível. Use action:qrcode para tentar novamente.'
            }),
            { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log(`[POST] QR code obtained successfully, length: ${qrString.length}`);
        return new Response(
          JSON.stringify({
            success: true,
            status: 'qr_ready',
            instance_name: instanceName,
            qrString: qrString,
            pairingCode: pairingCode
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (action === 'qrcode') {
        console.log(`[POST] Getting QR code for: ${instanceName}`);

        const result = await tryGetQrCode(instanceName);

        return new Response(
          JSON.stringify({
            success: !!result.qrString,
            status: result.qrString ? 'qr_ready' : 'pending_qr',
            qrString: result.qrString,
            pairingCode: result.pairingCode
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (action === 'restart') {
        console.log(`[POST] Restart requested for: ${instanceName}`);
        
        const success = await restartInstance(instanceName);
        if (success) await configureWebhook(instanceName);
        
        if (success) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const result = await tryGetQrCode(instanceName);
          
          return new Response(
            JSON.stringify({
              success: !!result.qrString,
              status: result.qrString ? 'qr_ready' : 'pending_qr',
              qrString: result.qrString,
              pairingCode: result.pairingCode,
              message: 'Instance restarted'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        return new Response(
          JSON.stringify({ success: false, message: 'Failed to restart instance' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // DELETE - Disconnect/logout instance
    if (req.method === 'DELETE') {
      console.log(`[DELETE] Disconnecting instance: ${instanceName}`);

      // Try both names for disconnect
      for (const name of [instanceName, fallbackName]) {
        try {
          await fetch(`${EVOLUTION_API_URL}/instance/logout/${name}`, {
            method: 'DELETE',
            headers: { 'apikey': EVOLUTION_API_KEY! }
          });
        } catch {}
      }

      await supabase
        .from('whatsapp_config')
        .update({
          instance_status: 'disconnected',
          connected_phone: null,
          connected_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('restaurant_id', restaurantId);

      return new Response(
        JSON.stringify({ success: true, message: 'Instance disconnected' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[ERROR]', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

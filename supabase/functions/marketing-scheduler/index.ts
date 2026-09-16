import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("[marketing-scheduler] Starting scheduler run...");

    // Fetch pending messages that are due
    const { data: pendingMessages, error: fetchError } = await supabase
      .from("marketing_scheduled_messages")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(50); // Process in batches

    if (fetchError) {
      console.error("[marketing-scheduler] Error fetching messages:", fetchError);
      throw fetchError;
    }

    if (!pendingMessages || pendingMessages.length === 0) {
      console.log("[marketing-scheduler] No pending messages to process");
      return new Response(
        JSON.stringify({ processed: 0 }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[marketing-scheduler] Processing ${pendingMessages.length} messages`);

    let successCount = 0;
    let failCount = 0;

    for (const message of pendingMessages) {
      try {
        // Check if WhatsApp is enabled for this restaurant
        const { data: whatsappConfig } = await supabase
          .from("whatsapp_config")
          .select("enabled, instance_status, instance_name, api_token")
          .eq("restaurant_id", message.restaurant_id)
          .single();

        if (!whatsappConfig?.enabled || whatsappConfig?.instance_status !== "connected") {
          console.log(`[marketing-scheduler] WhatsApp not enabled/connected for restaurant ${message.restaurant_id}`);
          
          // Mark as failed
          await supabase
            .from("marketing_scheduled_messages")
            .update({
              status: "failed",
              error_message: "WhatsApp não está conectado",
              sent_at: new Date().toISOString(),
            })
            .eq("id", message.id);
          
          failCount++;
          continue;
        }

        // Call whatsapp-send function
        const { data: sendResult, error: sendError } = await supabase.functions.invoke(
          "whatsapp-send",
          {
            body: {
              restaurantId: message.restaurant_id,
              phone: message.customer_phone,
              message: message.message_text,
              messageType: "marketing",
            },
          }
        );

        if (sendError) {
          throw new Error(sendError.message);
        }

        if (sendResult?.success) {
          // Mark as sent
          await supabase
            .from("marketing_scheduled_messages")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
            })
            .eq("id", message.id);

          successCount++;
          console.log(`[marketing-scheduler] Message ${message.id} sent successfully`);
        } else {
          throw new Error(sendResult?.error || "Unknown error");
        }
      } catch (error: any) {
        console.error(`[marketing-scheduler] Error sending message ${message.id}:`, error);

        // Mark as failed
        await supabase
          .from("marketing_scheduled_messages")
          .update({
            status: "failed",
            error_message: error.message || "Erro ao enviar mensagem",
            sent_at: new Date().toISOString(),
          })
          .eq("id", message.id);

        failCount++;
      }
    }

    console.log(`[marketing-scheduler] Completed: ${successCount} sent, ${failCount} failed`);

    return new Response(
      JSON.stringify({
        processed: pendingMessages.length,
        success: successCount,
        failed: failCount,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("[marketing-scheduler] Error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

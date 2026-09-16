import { compare, hash } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
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
    const { password, storedHash, table, idColumn, idValue } = await req.json();

    if (!password || !storedHash) {
      return new Response(
        JSON.stringify({ valid: false, error: "Password and storedHash are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isBcrypt = storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$") || storedHash.startsWith("$2y$");

    let valid = false;

    if (isBcrypt) {
      // Compare with bcrypt
      valid = await compare(password, storedHash);
    } else {
      // Fallback: plaintext comparison (legacy)
      valid = password === storedHash;

      // If valid and plaintext, auto-upgrade to bcrypt
      if (valid && table && idColumn && idValue) {
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          const supabase = createClient(supabaseUrl, supabaseKey);

          const newHash = await hash(password);
          await supabase
            .from(table)
            .update({ password_hash: newHash })
            .eq(idColumn, idValue);

          console.log(`[verify-password] Auto-upgraded plaintext password in ${table} for ${idColumn}=${idValue}`);
        } catch (upgradeError) {
          console.error("[verify-password] Failed to auto-upgrade password:", upgradeError);
          // Don't fail the login for upgrade errors
        }
      }
    }

    return new Response(
      JSON.stringify({ valid }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ valid: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

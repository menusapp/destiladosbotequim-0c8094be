import { compareSync, hashSync } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
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
      // Restaurant side
      restaurant_current_password,
      new_restaurant_username,
      new_restaurant_name,
      new_restaurant_slug,
      new_restaurant_password,
      // Staff side
      staff_id,
      staff_current_password,
      new_staff_username,
      new_staff_password,
    } = await req.json();

    if (!restaurant_id) {
      return new Response(
        JSON.stringify({ success: false, error: "restaurant_id é obrigatório" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const results: Record<string, boolean> = {};

    // ── RESTAURANT SIDE ──
    if (restaurant_current_password) {
      const { data: creds, error: fetchError } = await supabase
        .from("restaurant_credentials")
        .select("id, password_hash, username")
        .eq("restaurant_id", restaurant_id)
        .limit(1)
        .single();

      if (fetchError || !creds) {
        return new Response(
          JSON.stringify({ success: false, error: "Credenciais do restaurante não encontradas" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const isBcrypt = creds.password_hash.startsWith("$2a$") || creds.password_hash.startsWith("$2b$") || creds.password_hash.startsWith("$2y$");
      const valid = isBcrypt ? compareSync(restaurant_current_password, creds.password_hash) : restaurant_current_password === creds.password_hash;

      if (!valid) {
        return new Response(
          JSON.stringify({ success: false, error: "Senha atual do restaurante incorreta", section: "restaurant" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const credUpdate: Record<string, string> = {};
      if (new_restaurant_username && new_restaurant_username !== creds.username) {
        const { data: existing } = await supabase
          .from("restaurant_credentials")
          .select("id")
          .eq("username", new_restaurant_username)
          .neq("restaurant_id", restaurant_id)
          .limit(1);
        if (existing && existing.length > 0) {
          return new Response(
            JSON.stringify({ success: false, error: "Este usuário de restaurante já está em uso", section: "restaurant" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        credUpdate.username = new_restaurant_username;
      }

      if (new_restaurant_password) {
        credUpdate.password_hash = hashSync(new_restaurant_password);
      }

      if (Object.keys(credUpdate).length > 0) {
        const { error: updateCredError } = await supabase
          .from("restaurant_credentials")
          .update(credUpdate)
          .eq("restaurant_id", restaurant_id);
        if (updateCredError) throw updateCredError;
      }

      // Update restaurant name
      const restUpdate: Record<string, string> = {};
      if (new_restaurant_name) restUpdate.name = new_restaurant_name;
      if (new_restaurant_slug) {
        // Check slug uniqueness
        const { data: slugExisting } = await supabase
          .from("restaurants")
          .select("id")
          .eq("slug", new_restaurant_slug)
          .neq("id", restaurant_id)
          .limit(1);
        if (slugExisting && slugExisting.length > 0) {
          return new Response(
            JSON.stringify({ success: false, error: "Este slug já está em uso", section: "restaurant" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        restUpdate.slug = new_restaurant_slug;
      }

      if (Object.keys(restUpdate).length > 0) {
        const { error: updateRestError } = await supabase
          .from("restaurants")
          .update(restUpdate)
          .eq("id", restaurant_id);
        if (updateRestError) throw updateRestError;
      }

      results.restaurant = true;
    }

    // ── STAFF SIDE ──
    if (staff_id && staff_current_password) {
      const { data: staff, error: staffFetchError } = await supabase
        .from("restaurant_staff")
        .select("id, password_hash, username")
        .eq("id", staff_id)
        .eq("restaurant_id", restaurant_id)
        .limit(1)
        .single();

      if (staffFetchError || !staff) {
        return new Response(
          JSON.stringify({ success: false, error: "Conta de staff não encontrada", section: "staff" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const isBcrypt = staff.password_hash.startsWith("$2a$") || staff.password_hash.startsWith("$2b$") || staff.password_hash.startsWith("$2y$");
      const validStaff = isBcrypt ? compareSync(staff_current_password, staff.password_hash) : staff_current_password === staff.password_hash;

      if (!validStaff) {
        return new Response(
          JSON.stringify({ success: false, error: "Senha atual da conta incorreta", section: "staff" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const staffUpdate: Record<string, string> = {};
      if (new_staff_username && new_staff_username !== staff.username) {
        // Check uniqueness within same restaurant
        const { data: existingStaff } = await supabase
          .from("restaurant_staff")
          .select("id")
          .eq("restaurant_id", restaurant_id)
          .eq("username", new_staff_username)
          .neq("id", staff_id)
          .limit(1);
        if (existingStaff && existingStaff.length > 0) {
          return new Response(
            JSON.stringify({ success: false, error: "Este usuário de conta já está em uso", section: "staff" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        staffUpdate.username = new_staff_username;
      }

      if (new_staff_password) {
        staffUpdate.password_hash = hashSync(new_staff_password);
      }

      if (Object.keys(staffUpdate).length > 0) {
        const { error: updateStaffError } = await supabase
          .from("restaurant_staff")
          .update(staffUpdate)
          .eq("id", staff_id);
        if (updateStaffError) throw updateStaffError;
      }

      results.staff = true;
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Edge Function: restaurant-storage-ops
//
// Centraliza acesso aos buckets PRIVADOS `backups` e `fiscal-certificates`.
// Substitui chamadas diretas `supabase.storage.from('backups'|'fiscal-certificates')`
// no frontend, que antes funcionavam como `anon` com policies abertas.
//
// Auth: o frontend admin usa autenticação custom em localStorage
// (`restaurant_id` + `staff_id`). Esta função valida que o staff_id pertence
// ao restaurant_id informado antes de operar no storage com service_role.
//
// Ops suportadas:
//   - list    { bucket, restaurant_id, staff_id, prefix?, limit? }
//   - upload  { bucket, restaurant_id, staff_id, path, content_base64, content_type? }
//   - download{ bucket, restaurant_id, staff_id, path }   -> { content_base64 }
//   - delete  { bucket, restaurant_id, staff_id, paths: string[] }
//
// Regra de path: todo caminho DEVE começar com `${restaurant_id}/`. Tentativas
// de path-traversal (`..`, `//`) são rejeitadas.

import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-app-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_BUCKETS = new Set(["backups", "fiscal-certificates"]);

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function bad(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function ok(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function validatePath(restaurantId: string, path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path.includes("..") || path.startsWith("/") || path.includes("//")) return false;
  if (!path.startsWith(`${restaurantId}/`) && path !== restaurantId) return false;
  return true;
}

async function validateStaff(restaurantId: string, staffId: string): Promise<boolean> {
  if (!restaurantId || !staffId) return false;
  const { data, error } = await admin
    .from("restaurant_staff")
    .select("id")
    .eq("id", staffId)
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    console.error("[restaurant-storage-ops] staff validation error:", error);
    return false;
  }
  return !!data;
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return bad(405, "Method not allowed");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad(400, "Invalid JSON body");
  }

  const { op, bucket, restaurant_id, staff_id } = body || {};
  if (typeof op !== "string") return bad(400, "Missing op");
  if (typeof bucket !== "string" || !ALLOWED_BUCKETS.has(bucket)) {
    return bad(400, "Invalid bucket");
  }
  if (typeof restaurant_id !== "string" || !restaurant_id) {
    return bad(400, "Missing restaurant_id");
  }
  if (typeof staff_id !== "string" || !staff_id) {
    return bad(401, "Missing staff_id");
  }

  const authorized = await validateStaff(restaurant_id, staff_id);
  if (!authorized) return bad(403, "Forbidden");

  try {
    if (op === "list") {
      const prefix = typeof body.prefix === "string" && body.prefix.length
        ? body.prefix
        : restaurant_id;
      if (!validatePath(restaurant_id, prefix)) return bad(400, "Invalid prefix");
      const limit = Math.min(Number(body.limit) || 100, 1000);
      const { data, error } = await admin.storage
        .from(bucket)
        .list(prefix, { limit, sortBy: { column: "created_at", order: "desc" } });
      if (error) return bad(500, error.message);
      return ok({ items: data });
    }

    if (op === "upload") {
      const { path, content_base64, content_type } = body;
      if (!validatePath(restaurant_id, path)) return bad(400, "Invalid path");
      if (typeof content_base64 !== "string") return bad(400, "Missing content_base64");
      const bytes = decodeBase64(content_base64);
      const { error } = await admin.storage
        .from(bucket)
        .upload(path, bytes, {
          upsert: true,
          contentType: typeof content_type === "string" ? content_type : undefined,
        });
      if (error) return bad(500, error.message);
      return ok({ success: true });
    }

    if (op === "download") {
      const { path } = body;
      if (!validatePath(restaurant_id, path)) return bad(400, "Invalid path");
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error) return bad(404, error.message);
      const buf = new Uint8Array(await data.arrayBuffer());
      return ok({
        content_base64: encodeBase64(buf),
        content_type: data.type,
      });
    }

    if (op === "delete") {
      const paths = Array.isArray(body.paths) ? body.paths : [];
      if (!paths.length) return bad(400, "Missing paths");
      for (const p of paths) {
        if (!validatePath(restaurant_id, p)) return bad(400, `Invalid path: ${p}`);
      }
      const { error } = await admin.storage.from(bucket).remove(paths);
      if (error) return bad(500, error.message);
      return ok({ success: true });
    }

    return bad(400, `Unknown op: ${op}`);
  } catch (e: any) {
    console.error("[restaurant-storage-ops] error:", e);
    return bad(500, e?.message ?? "Internal error");
  }
});

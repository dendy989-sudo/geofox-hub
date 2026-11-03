import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sameOrigin, apiError, json } from "@/lib/security/http";
export async function POST(request: Request) {
  try { sameOrigin(request); const client = await createSupabaseServerClient(); if (client) await client.auth.signOut(); return json({ signedOut: true }); }
  catch (e) { return apiError(e); }
}

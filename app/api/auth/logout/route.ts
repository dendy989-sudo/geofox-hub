import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sameOrigin, apiError, json, RequestError } from "@/lib/security/http";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const client = await createSupabaseServerClient();
    if (!client) throw new RequestError(503, "AUTH_UNAVAILABLE", "Sign-out is temporarily unavailable. Please try again.");
    const { error } = await client.auth.signOut();
    if (error) throw new RequestError(503, "SIGN_OUT_FAILED", "Sign-out could not be completed. Please try again.");
    return json({ signedOut: true });
  }
  catch (e) { return apiError(e); }
}

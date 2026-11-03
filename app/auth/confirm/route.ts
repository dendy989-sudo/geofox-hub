import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const client = await createSupabaseServerClient();
  if (client && hash && type && ["invite", "recovery", "magiclink", "email"].includes(type)) {
    const { error } = await client.auth.verifyOtp({ token_hash: hash, type: type as EmailOtpType });
    if (!error) return NextResponse.redirect(new URL(type === "invite" || type === "recovery" ? "/admin/password" : "/admin", url.origin));
  }
  return NextResponse.redirect(new URL("/admin/login?error=link_expired", url.origin));
}

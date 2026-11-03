import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") === "/admin/password" ? "/admin/password" : "/admin";
  const code = url.searchParams.get("code");
  const client = await createSupabaseServerClient();
  if (client && code && code.length < 2048) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL("/admin/login?error=link_expired", url.origin));
}

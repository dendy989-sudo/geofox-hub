import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "./config";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  const config = getSupabaseConfig();
  if (!config || request.nextUrl.pathname === "/admin/preview") return response;
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        response.headers.set("Cache-Control", "private, no-store, max-age=0");
      },
    },
  });
  try { await supabase.auth.getClaims(); } catch { /* Authenticated routes verify again and fail closed. */ }
  return response;
}

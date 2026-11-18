import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) { return updateSession(request); }
export const config = { matcher: ["/admin/:path*", "/api/admin/:path*", "/apps/:path*", "/finance/:path*", "/api/finance/:path*", "/taxes/:path*", "/api/taxes/:path*", "/auth/:path*"] };

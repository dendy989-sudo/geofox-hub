import type { Metadata } from "next";
import { AuthPanel } from "@/components/auth/auth-panel";
import { getSupabaseConfig } from "@/lib/supabase/config";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Staff sign-in", robots: { index: false, follow: false } };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams;
  return <AuthPanel configured={Boolean(getSupabaseConfig())} nextPath={query.next === "/finance" ? "/finance" : "/admin"} />;
}

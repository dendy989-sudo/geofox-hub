import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FinanceWorkspace } from "@/components/finance/finance-workspace";
import { HubError } from "@/lib/hub/server";
import { loadFinanceData, requireFinanceContext } from "@/lib/finance/server";
import "@/components/auth/auth.css";

export const metadata: Metadata = { title: "Private finance", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

export default async function FinancePage() {
  let context;
  let problem = "";
  try { context = await requireFinanceContext(); }
  catch (error) {
    if (error instanceof HubError) {
      if (error.status === 401 || error.code === "MFA_REQUIRED") redirect("/admin/login?next=/finance");
      if (error.code === "MFA_ENROLLMENT_REQUIRED") redirect("/admin/security");
      problem = error.status === 403 ? "This finance workspace is currently available only to its approved owner." : error.message;
    } else problem = "Your finance connection could not be checked. Please try again shortly.";
  }
  if (!context) return <div className="auth-surface"><Link href="/" className="auth-brand"><span>g</span> geofox <em>finance</em></Link><section className="auth-setup"><span className="auth-chip">PRIVATE WORKSPACE</span><h1>Your money deserves its own space.</h1><p>{problem}</p><div className="auth-setup-actions"><Link className="auth-primary" href="/admin/login?next=/finance">Owner sign-in</Link><Link href="/admin">Return to Geofox Hub</Link></div></section></div>;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const month = today.slice(0, 7);
  const data = await loadFinanceData(context, month);
  return <FinanceWorkspace initialData={data} initialMonth={month} />;
}

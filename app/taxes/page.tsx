import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TaxWorkspace } from "@/components/taxes/tax-workspace";
import { HubError } from "@/lib/hub/server";
import { loadTaxData, requireTaxContext } from "@/lib/taxes/server";
import "@/components/auth/auth.css";

export const metadata: Metadata = { title: "Private taxes", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

export default async function TaxesPage() {
  let context;
  let problem = "";
  try { context = await requireTaxContext(); }
  catch (error) {
    if (error instanceof HubError) {
      if (error.status === 401 || error.code === "MFA_REQUIRED") redirect("/admin/login?next=/taxes");
      if (error.code === "MFA_ENROLLMENT_REQUIRED") redirect("/admin/security");
      problem = error.status === 403 ? "This tax workspace is available only to its approved private owner." : error.message;
    } else problem = "Your tax connection could not be checked. Please try again shortly.";
  }
  if (context) {
    try {
      const year = Math.max(2018, Math.min(2026, Number(new Intl.DateTimeFormat("en", { timeZone: "America/Chicago", year: "numeric" }).format(new Date()))));
      return <TaxWorkspace initialData={await loadTaxData(context, year)} />;
    } catch (error) { problem = error instanceof HubError ? error.message : "Your tax records could not be loaded. Please refresh in a moment."; }
  }
  return <div className="auth-surface"><Link href="/apps" className="auth-brand"><span>g</span> geofox <em>taxes</em></Link><section className="auth-setup"><span className="auth-chip">PRIVATE WORKSPACE</span><h1>Your taxes, one year at a time.</h1><p>{problem}</p><div className="auth-setup-actions"><Link className="auth-primary" href={context ? "/taxes" : "/admin/login?next=/taxes"}>{context ? "Try again" : "Owner sign-in"}</Link><Link href="/apps">Personal apps</Link></div></section></div>;
}

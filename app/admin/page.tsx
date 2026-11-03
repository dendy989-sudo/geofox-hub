import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminWorkspace } from "@/components/admin/admin-workspace";
import { getHubContext, HubError } from "@/lib/hub/server";
import "@/components/auth/auth.css";

export const metadata: Metadata = {
  title: "Control center",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  let problem = "";
  try { await getHubContext(); }
  catch (error) {
    if (error instanceof HubError) {
      if (error.status === 401 || error.code === "MFA_REQUIRED") redirect("/admin/login");
      if (error.code === "MFA_ENROLLMENT_REQUIRED") redirect("/admin/security");
      problem = error.message;
    } else problem = "The staff connection could not be checked. Please try again shortly.";
  }
  if (problem) return <div className="auth-surface"><Link href="/" className="auth-brand"><span>g</span> geofox <em>control center</em></Link><section className="auth-setup"><span className="auth-chip">GEOFOX CONTROL CENTER</span><h1>Your workspace is ready for connection.</h1><p>{problem}</p><p>The interface preview lets you explore the dashboard while staff access and app connections are configured.</p><div className="auth-setup-actions"><Link className="auth-primary" href="/admin/preview">Explore the interface</Link><Link href="/admin/login">Staff sign-in →</Link></div><p className="auth-small">Need help with NovaNook? <Link href="/support">Contact app support</Link>.</p></section></div>;
  return <AdminWorkspace />;
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/admin/icons";
import { PersonalAppRail } from "@/components/personal/app-rail";
import { requireFinanceContext } from "@/lib/finance/server";
import { HubError } from "@/lib/hub/server";
import "@/app/admin/admin.css";
import "@/components/workspace/workspace.css";
import "@/components/workspace/navigation.css";
import "@/components/workspace/responsive-print.css";
import "@/components/personal/apps.css";
import "@/components/auth/auth.css";

export const metadata: Metadata = { title: "Your apps", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

export default async function PersonalAppsPage() {
  let context;
  let problem = "";
  try { context = await requireFinanceContext(); }
  catch (error) {
    if (error instanceof HubError) {
      if (error.status === 401 || error.code === "MFA_REQUIRED") redirect("/admin/login?next=/apps");
      if (error.code === "MFA_ENROLLMENT_REQUIRED") redirect("/admin/security");
      problem = error.status === 403 ? "These personal apps are available only to their approved owner." : error.message;
    } else problem = "Your personal app connection could not be checked. Please try again shortly.";
  }
  if (!context) return <div className="auth-surface"><Link href="/" className="auth-brand"><span>g</span> geofox <em>your apps</em></Link><section className="auth-setup"><span className="auth-chip">PERSONAL APPS</span><h1>A little space for your own life.</h1><p>{problem}</p><div className="auth-setup-actions"><Link className="auth-primary" href="/admin/login?next=/apps">Owner sign-in</Link><Link href="/admin">Return to Geofox Hub</Link></div></section></div>;

  return <div className="hub-root hub-company-root personal-apps-root">
    <a className="hub-skip-link" href="#personal-apps-content">Skip to your apps</a>
    <PersonalAppRail active="apps" />
    <div className="hub-main">
      <header className="hub-topbar"><Link className="personal-apps-brand" href="/apps">geofox <span>apps</span></Link><span className="personal-private-label"><Icon name="lock" size={13} />Your private space</span></header>
      <main id="personal-apps-content" className="hub-content" tabIndex={-1}>
        <div className="personal-apps-heading"><p className="hub-kicker">YOUR PERSONAL APPS</p><h1>Your life, a little more organized.</h1><p>Choose where you want to focus today.</p></div>
        <div className="personal-app-cards">
          <Link className="personal-app-card personal-app-finance" href="/finance"><div className="personal-app-card-top"><span className="personal-app-symbol"><Icon name="wallet" size={28} /></span><span className="personal-app-tag">DAY TO DAY</span></div><h2>Finance</h2><p>Plan bills, follow your balances, and make room for the things that matter.</p><div className="personal-app-card-details"><span>Bills & accounts</span><span>Savings & goals</span></div><span className="personal-app-open">Open Finance <Icon name="arrow" size={19} /></span></Link>
          <Link className="personal-app-card personal-app-taxes" href="/taxes"><div className="personal-app-card-top"><span className="personal-app-symbol"><Icon name="scales" size={28} /></span><span className="personal-app-tag">TAX YEARS 2018–2026</span></div><h2>Taxes</h2><p>Bring statements, business records, and each tax year together, one step at a time.</p><div className="personal-app-card-details"><span>Statements & review</span><span>Year reports</span></div><span className="personal-app-open">Open Taxes <Icon name="arrow" size={19} /></span></Link>
        </div>
        <section className="personal-hub-return"><span className="personal-hub-return-icon"><Icon name="grid" size={22} /></span><div><h2>Ready to get back to your apps business?</h2><p>Support, marketing, tasks, and company operations live in Geofox Hub.</p></div><Link href="/admin">Open Hub <Icon name="arrow" size={17} /></Link></section>
        <p className="personal-apps-footnote"><Icon name="lock" size={13} />Personal records are kept in your private workspaces.</p>
      </main>
    </div>
  </div>;
}

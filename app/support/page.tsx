import type { Metadata } from "next";
import Image from "next/image";
import { GeofoxMark, Icon } from "@/components/admin/icons";
import "../home.css";
import { SupportForm } from "@/components/support/support-form";
import { getHubService } from "@/lib/hub/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Support",
  description: "Find the right place for help with NovaNook and Geofox apps.",
  alternates: { canonical: "/support" },
};

export default async function SupportPage() {
  const supportEmail = "support@geofoxapps.com";
  let available = false;
  let apps = [{ slug: "novanook", name: "NovaNook", color: "#a78bfa" }];
  try {
    const result = await getHubService().from("hub_apps").select("slug,name,color").eq("active", true).order("name").limit(100).abortSignal(AbortSignal.timeout(5000));
    if (!result.error && result.data?.length) { available = true; apps = result.data; }
  } catch { /* Keep the contact route usable while the database is being connected. */ }

  return (
    <div className="geofox-home geofox-support">
      <a className="gf-skip" href="#main-content">Skip to content</a>
      <header className="gf-header">
        <div className="gf-container gf-header-inner">
          <a className="gf-brand" href="/" aria-label="Geofox Apps home">
            <span className="gf-brand-mark"><GeofoxMark /></span>
            <span>geofox <span className="gf-brand-suffix">apps</span></span>
          </a>
          <nav className="gf-nav" aria-label="Main navigation">
            <a href="/#apps">Our apps</a>
            <a href="/#company">Our company</a>
            <a href="/support" aria-current="page">Support</a>
          </nav>
          <a className="gf-staff" href="/admin/login"><Icon name="lock" size={14} />Staff sign in<Icon name="arrow" size={14} /></a>
        </div>
      </header>

      <main id="main-content" className="gf-container support-main" tabIndex={-1}>
        <div className="support-page-heading">
          <p className="gf-kicker">GEOFOX SUPPORT CENTER</p>
          <h1>A little help, <span>in the right place.</span></h1>
          <p>Get help with your app, your account, or a question for Geofox. We’re here to help you find your next step.</p>
        </div>

        <div className="support-layout">
          <aside className="support-member-card" aria-labelledby="existing-app-support">
            <div className="support-member-brand">
              <Image src="/images/novanook/novanook-icon.svg" alt="NovaNook app icon" width={407} height={435} unoptimized />
              <div><p className="gf-kicker">A GEOFOX APP</p><span>NovaNook</span></div>
            </div>
            <h2 id="existing-app-support">Already use NovaNook?</h2>
            <p>Open My requests to submit a ticket or read our replies. Your app account is linked automatically, and the conversation stays with your ticket.</p>
            <a className="gf-button support-member-link" href="https://www.mynovanook.com/support.html">Open My requests<Icon name="external" size={16} /></a>
            <p className="support-member-note"><Icon name="info" size={15} /><span>Can’t sign in? Use the inquiry form on this page.</span></p>
          </aside>

          <div className="support-form-column">
            <SupportForm apps={apps} available={available} supportEmail={supportEmail} />
          </div>

          <aside className="support-guidance" aria-labelledby="support-details-title">
            <div className="support-guidance-heading"><Icon name="message" size={18} /><h2 id="support-details-title">A few details go a long way.</h2></div>
            <p>For help with something that isn’t working, tell us what happened, what you expected, and which device or browser you’re using.</p>
            <a className="gf-quiet-link" href="https://www.mynovanook.com">Just exploring? Get to know NovaNook<Icon name="external" size={13} /></a>
            <p className="support-safety-note">Safety reports can also be made through NovaNook’s in-app reporting tools.</p>
          </aside>
        </div>

        <p className="support-contact-note">For privacy requests, account-access help, or company contact, you can also reach us at <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>
      </main>

      <footer className="gf-footer">
        <div className="gf-container gf-footer-inner">
          <a className="gf-brand gf-footer-brand" href="/" aria-label="Geofox Apps home">
            <span className="gf-brand-mark"><GeofoxMark /></span>
            <span>geofox <span className="gf-brand-suffix">apps</span></span>
          </a>
          <nav aria-label="Footer navigation">
            <a href="/#apps">Our apps</a>
            <a href="/support" aria-current="page">Support</a>
            <a href="/admin/login">Staff sign in<Icon name="external" size={12} /></a>
          </nav>
          <p>© {new Date().getFullYear()} GEOFOX APPS LLC. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

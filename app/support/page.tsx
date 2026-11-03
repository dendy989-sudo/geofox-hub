import type { Metadata } from "next";
import { UtilityShell } from "@/components/utility-shell";
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
    <UtilityShell>
      <p className="eyebrow">GEOFOX SUPPORT</p>
      <h1>A little help,<br />in the right place.</h1>
      <p className="utility-intro">Get help with your app, your account, or a question for Geofox.</p>
      <section className="utility-contact" aria-labelledby="existing-app-support">
        <h2 id="existing-app-support">Already use NovaNook?</h2>
        <p><a className="text-link" href="https://www.mynovanook.com/support.html">Submit a ticket or view your requests in NovaNook <span aria-hidden="true">↗</span></a> to send a request and read our replies using your existing app account. Your app account is linked automatically, and all replies stay with your ticket.</p>
        <p>Can’t sign in, or have a question before joining? Use the form below and include an email where we can contact you.</p>
      </section>
      <SupportForm apps={apps} available={available} supportEmail={supportEmail} />
      <p className="utility-note">For account-access help, privacy requests, or company contact, you can also reach Geofox at <a className="text-link" href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>
      <p className="utility-note">For NovaNook app information, visit <a className="text-link" href="https://mynovanook.com">mynovanook.com</a>. Safety reports can also be made through NovaNook’s in-app reporting tools.</p>
    </UtilityShell>
  );
}

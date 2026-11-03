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
  const candidate = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();
  const supportEmail = candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
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
      <p className="utility-intro">Choose your app and tell us what you need. We’ll keep your request in the right place.</p>
      <SupportForm apps={apps} available={available} supportEmail={supportEmail} />
      {supportEmail ? (
        <section className="utility-contact" aria-labelledby="company-contact">
          <h2 id="company-contact">Contact Geofox</h2>
          <p>For company questions or help finding the right support, email <a className="text-link" href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>
        </section>
      ) : null}
      <p className="utility-note">For NovaNook app information, visit <a className="text-link" href="https://mynovanook.com">mynovanook.com</a>. Safety reports can also be made through NovaNook’s in-app reporting tools.</p>
    </UtilityShell>
  );
}

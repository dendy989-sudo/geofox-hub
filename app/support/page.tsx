import type { Metadata } from "next";
import { UtilityShell } from "@/components/utility-shell";

export const metadata: Metadata = {
  title: "Support",
  description: "Find the right place for help with NovaNook and Geofox apps.",
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  const candidate = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();
  const supportEmail = candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;

  return (
    <UtilityShell>
      <p className="eyebrow">GEOFOX SUPPORT</p>
      <h1>A little help,<br />in the right place.</h1>
      <p className="utility-intro">Find your app below to get started.</p>
      <section className="utility-card" aria-labelledby="novanook-support">
        <span className="support-app-label">OUR READING APP</span>
        <h2 id="novanook-support">NovaNook</h2>
        <p>For your library, reading activity, or NovaNook account, start at the NovaNook website.</p>
        <a className="button" href="https://mynovanook.com">Visit NovaNook <span aria-hidden="true">↗</span></a>
      </section>
      {supportEmail ? (
        <section className="utility-contact" aria-labelledby="company-contact">
          <h2 id="company-contact">Contact Geofox</h2>
          <p>For company questions or help finding the right support, email <a className="text-link" href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>
        </section>
      ) : null}
      <p className="utility-note">Our dedicated ticket portal is being prepared. For now, start with your app’s website.</p>
    </UtilityShell>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { UtilityShell } from "@/components/utility-shell";

export const metadata: Metadata = {
  title: "Staff access",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <UtilityShell>
      <p className="eyebrow">GEOFOX TEAM</p>
      <h1>A home for<br />the work behind it.</h1>
      <section className="utility-card" aria-labelledby="staff-access">
        <div className="status-label"><span aria-hidden="true" />Staff portal in preparation</div>
        <h2 id="staff-access">Staff access is not open yet.</h2>
        <p>This workspace will be available to authorized Geofox team members once account access and permissions are configured.</p>
        <p>No customer records or administrative controls are available on this page.</p>
        <Link className="button button-secondary" href="/support">Looking for app support? <span aria-hidden="true">↗</span></Link>
      </section>
    </UtilityShell>
  );
}

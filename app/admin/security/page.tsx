import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getHubContext, HubError } from "@/lib/hub/server";
import { MfaPanel } from "@/components/auth/mfa-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account security", robots: { index: false, follow: false } };
export default async function SecurityPage() {
  try { await getHubContext({ allowMfaEnrollment: true }); }
  catch (error) {
    if (error instanceof HubError && (error.status === 401 || error.code === "MFA_REQUIRED")) redirect("/admin/login");
    redirect("/admin");
  }
  return <MfaPanel />;
}

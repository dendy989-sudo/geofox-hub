"use client";

import { useState } from "react";
import { GeofoxMark, Icon } from "@/components/admin/icons";

type PersonalApp = "apps" | "finance" | "taxes";

export function PersonalAppRail({ active, onSignOut, loggingOut = false }: {
  active: PersonalApp;
  onSignOut?: () => void | Promise<void>;
  loggingOut?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    if (onSignOut) { await onSignOut(); return; }
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("Sign-out could not be completed. Please try again.");
      window.location.assign(`/admin/login?next=/${active}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Please try signing out again.");
      setBusy(false);
    }
  }

  return <nav className="hub-area-rail personal-app-rail" aria-label="Your personal apps">
    <a className="hub-rail-brand" href="/apps" aria-label="Your apps" title="Your apps"><GeofoxMark /></a>
    <div className="hub-area-list">
      <a className={`hub-area-button ${active === "finance" ? "active" : ""}`} href="/finance" aria-current={active === "finance" ? "page" : undefined} aria-label="Finance workspace" title="Finance"><Icon name="wallet" size={21} /><span>Finance</span></a>
      <a className={`hub-area-button ${active === "taxes" ? "active" : ""}`} href="/taxes" aria-current={active === "taxes" ? "page" : undefined} aria-label="Taxes workspace" title="Taxes"><Icon name="scales" size={21} /><span>Taxes</span></a>
    </div>
    <div className="hub-area-bottom">
      <a className="hub-area-button hub-workspace-switch" href="/admin" aria-label="Switch to Geofox Hub" title="Switch to Geofox Hub"><Icon name="grid" size={21} /><span>Hub</span></a>
      <a className="hub-area-button" href="/admin#profile/account" aria-label="My profile" title="My profile"><Icon name="profile" size={21} /><span>Profile</span></a>
      <button type="button" className="hub-area-button hub-rail-signout" aria-label="Sign out" title="Sign out" onClick={signOut} disabled={busy || loggingOut}><Icon name="logout" size={20} /><span>{busy || loggingOut ? "Wait…" : "Sign out"}</span></button>
    </div>
    {error ? <div className="personal-rail-error" role="alert"><p>{error}</p><button type="button" onClick={() => setError("")} aria-label="Dismiss sign-out error"><Icon name="close" size={15} /></button></div> : null}
  </nav>;
}

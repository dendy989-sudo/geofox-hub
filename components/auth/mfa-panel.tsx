"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import "./auth.css";

export function MfaPanel() {
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  useEffect(() => {
    let mounted = true;
    const client = createSupabaseBrowserClient();
    if (!client) { setLoading(false); setError("The sign-in connection is not configured."); return; }
    void client.auth.mfa.listFactors().then(({ data, error: failure }) => {
      if (!mounted) return;
      if (failure) setError("Security settings could not be loaded.");
      else setVerified(Boolean(data?.totp.some(item => item.status === "verified")));
      setLoading(false);
    });
    return () => { mounted = false; };
  }, []);
  async function enroll() {
    setBusy(true); setError("");
    try {
      const client = createSupabaseBrowserClient();
      if (!client) throw new Error("The sign-in connection is not configured.");
      const existing = await client.auth.mfa.listFactors();
      if (existing.error) throw new Error("Your security settings could not be verified.");
      if (existing.data.totp.some(item => item.status === "verified")) { setVerified(true); return; }
      for (const item of existing.data.all.filter(item => item.factor_type === "totp" && item.status === "unverified")) await client.auth.mfa.unenroll({ factorId: item.id });
      const result = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Geofox authenticator" });
      if (result.error) throw new Error("An authenticator could not be added. Please sign in again and retry.");
      setFactor({ id: result.data.id, qr: result.data.totp.qr_code, secret: result.data.totp.secret });
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setBusy(false); }
  }
  async function verify(event: FormEvent) {
    event.preventDefault(); if (!factor) return;
    setBusy(true); setError("");
    try {
      const client = createSupabaseBrowserClient();
      if (!client) throw new Error("The sign-in connection is not configured.");
      const result = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (result.error) throw new Error("That code could not be verified. Enter the current code from your authenticator.");
      setFactor(null); setCode(""); setVerified(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="auth-surface"><Link href="/admin" className="auth-brand"><span>g</span> geofox <em>account security</em></Link><section className="auth-setup"><span className="auth-chip">YOUR STAFF ACCOUNT</span><h1>One more layer of protection.</h1><p>Use an authenticator app to protect access to customer records and staff controls.</p>{error && <p className="auth-error" role="alert">{error}</p>}{loading ? <p>Checking your account…</p> : verified ? <><p className="auth-success">Your authenticator is enabled. Future sign-ins will ask for its six-digit code.</p><Link className="auth-primary" href="/admin">Return to the control center</Link></> : factor ? <form onSubmit={verify}><p>Scan this code in your authenticator app. Keep the setup key private.</p><img src={factor.qr} width={220} height={220} alt="Private authenticator setup QR code" /><details><summary>Enter the setup key manually</summary><code style={{ display: "block", overflowWrap: "anywhere", padding: 12 }}>{factor.secret}</code></details><label className="auth-mfa-label">Six-digit code<input autoComplete="one-time-code" inputMode="numeric" required pattern="[0-9]{6}" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} /></label><button className="auth-primary" disabled={busy}>{busy ? "Verifying…" : "Verify and enable"}</button></form> : <button className="auth-primary" disabled={busy} onClick={enroll}>{busy ? "Preparing…" : "Set up an authenticator"}</button>}<p className="auth-small">Keep a secure backup of your authenticator. Staff access cannot be recovered through a public signup.</p></section></div>;
}

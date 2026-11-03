"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import "./auth.css";

export function AuthPanel({ configured, passwordUpdate = false }: { configured: boolean; passwordUpdate?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const client = createSupabaseBrowserClient();
    if (!client) { setError("Staff sign-in is waiting for the Geofox connection to be configured."); setBusy(false); return; }
    try {
      if (factorId) {
        const result = await client.auth.mfa.challengeAndVerify({ factorId, code });
        if (result.error) throw new Error("That code could not be verified. Try the current code from your authenticator.");
      } else if (passwordUpdate) {
        const current = await client.auth.getUser();
        if (!current.data.user) throw new Error("Open the invitation or password-reset link from your email first.");
        const result = await client.auth.updateUser({ password });
        if (result.error) throw new Error("The password could not be saved. Use at least 12 characters and try again.");
      } else {
        const result = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (result.error) throw new Error("Sign-in failed. Check your staff email and password.");
      }
      const level = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (level.data?.nextLevel === "aal2" && level.data.currentLevel !== "aal2") {
        const factors = await client.auth.mfa.listFactors();
        const totp = factors.data?.totp.find(f => f.status === "verified");
        if (!totp) throw new Error("Complete your account’s verification before opening the hub.");
        setFactorId(totp.id); setPassword(""); setMessage("Enter the code from your authenticator app.");
      } else { router.replace("/admin"); router.refresh(); }
    } catch (e) { setError(e instanceof Error ? e.message : "Sign-in could not be completed."); }
    finally { setBusy(false); }
  }

  async function resetPassword() {
    if (!email.trim()) { setError("Enter your staff email address first."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const client = createSupabaseBrowserClient();
      if (!client) throw new Error("Staff sign-in is not configured yet.");
      const result = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/callback?next=/admin/password` });
      if (result.error) throw new Error("A reset email could not be requested. Please try again later.");
      setMessage("If this address has a staff account, you’ll receive a password-reset email.");
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-surface">
      <Link href="/" className="auth-brand"><span>g</span> geofox <em>control center</em></Link>
      <div className="auth-layout">
        <section className="auth-story"><p className="auth-kicker">YOUR APPS. ONE CLEAR VIEW.</p><h1>A calmer place<br />to run it all.</h1><p>Support your customers, spot issues early, and keep every Geofox app moving forward.</p><div className="auth-orbit" aria-hidden="true"><span>G</span><i /><i /><i /></div><p className="auth-small">Staff access is granted by your organization.</p></section>
        <section className="auth-card">
          <span className="auth-chip">PRIVATE WORKSPACE</span>
          <h2>{factorId ? "Verify it’s you" : passwordUpdate ? "Set your password" : "Welcome to the hub"}</h2>
          <p>{passwordUpdate ? "Choose a strong password for your staff account." : "Sign in with your approved Geofox staff account."}</p>
          {!configured && <div className="auth-notice">Staff sign-in is awaiting connection setup. You can explore the interface preview while configuration is completed.</div>}
          <form onSubmit={submit}>
            {!factorId && !passwordUpdate && <label>Staff email<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required disabled={!configured || busy} /></label>}
            {!factorId && <label>{passwordUpdate ? "New password" : "Password"}<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={passwordUpdate ? "new-password" : "current-password"} minLength={passwordUpdate ? 12 : undefined} required disabled={!configured || busy} /></label>}
            {factorId && <label>Authenticator code<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" required autoFocus /></label>}
            {error && <p className="auth-error" role="alert">{error}</p>}
            {message && <p className="auth-success" role="status">{message}</p>}
            <button type="submit" className="auth-primary" disabled={!configured || busy}>{busy ? "Please wait…" : factorId ? "Verify and continue" : passwordUpdate ? "Save password" : "Sign in securely"}</button>
          </form>
          {!passwordUpdate && !factorId && <button className="auth-text-button" type="button" onClick={resetPassword} disabled={!configured || busy}>Forgot your password?</button>}
          <div className="auth-card-footer"><Link href="/admin/preview">Explore the interface preview →</Link><Link href="/support">Looking for customer support?</Link></div>
        </section>
      </div>
    </div>
  );
}

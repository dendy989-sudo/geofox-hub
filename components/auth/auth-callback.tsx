"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import "./auth.css";

/** Supports both PKCE reset links and Supabase's default invitation fragment flow. */
export function AuthCallback() {
  const started = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const url = new URL(window.location.href);
    const next = url.searchParams.get("next") === "/admin/password" ? "/admin/password" : "/admin";
    const code = url.searchParams.get("code");
    if (code) {
      window.location.replace(`/auth/exchange?${new URLSearchParams({ code, next })}`);
      return;
    }
    const fragment = new URLSearchParams(url.hash.slice(1));
    const access = fragment.get("access_token");
    const refresh = fragment.get("refresh_token");
    // Remove credentials from the address bar before initializing any client or making requests.
    window.history.replaceState(null, "", "/auth/callback");
    const client = createSupabaseBrowserClient();
    if (!client || !access || !refresh || fragment.has("error")) { setError("This link could not be verified. It may have expired or already been used. Request a fresh invitation or password-reset email."); return; }
    void (async () => {
      try {
        const session = await client.auth.setSession({ access_token: access, refresh_token: refresh });
        if (session.error) throw new Error();
        const verified = await client.auth.getUser();
        if (verified.error || !verified.data.user) throw new Error();
        window.location.replace(next);
      } catch { setError("The email link could not be verified. Request a fresh link and try again."); }
    })();
  }, []);
  return <div className="auth-surface"><Link href="/" className="auth-brand"><span>g</span> geofox <em>secure sign-in</em></Link><section className="auth-setup"><span className="auth-chip">STAFF ACCOUNT</span><h1>{error ? "Let’s try a fresh link." : "Checking your email link…"}</h1>{error ? <><p className="auth-error" role="alert">{error}</p><Link className="auth-primary" href="/admin/login">Return to staff sign-in</Link></> : <p role="status">Your account is being verified. This page will continue automatically.</p>}</section></div>;
}

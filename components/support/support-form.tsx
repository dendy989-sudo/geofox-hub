"use client";

import { useState, type FormEvent } from "react";
import type { HubApp } from "@/lib/hub/types";
import "./support.css";

export function SupportForm({ apps, available, supportEmail }: { apps: Pick<HubApp, "slug" | "name" | "color">[]; available: boolean; supportEmail: string | null }) {
  const [app, setApp] = useState(apps[0]?.slug || "novanook");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !available) return;
    const fields = new FormData(event.currentTarget);
    setError(""); setBusy(true);
    try {
      const response = await fetch("/api/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appSlug: app, email: fields.get("email"), subject: fields.get("subject"), body: fields.get("message"), category: fields.get("category"), website: fields.get("website") }) });
      const body = await response.json() as { data?: { reference: string }; error?: string };
      if (!response.ok || !body.data?.reference) throw new Error(body.error || "Your request could not be saved. Please try again.");
      setReference(body.data.reference);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Your request could not be sent."); }
    finally { setBusy(false); }
  }
  if (reference) return <section className="support-receipt" aria-live="polite"><span className="support-check" aria-hidden="true">✓</span><p className="eyebrow">REQUEST RECEIVED</p><h2>We’ve got your message.</h2><p>Your request for {apps.find(item => item.slug === app)?.name || "your app"} is saved in the Geofox support inbox. Keep this reference for follow-up:</p><strong className="support-reference">{reference}</strong><p>We’ll use the email you provided to respond. This page does not display account details.</p><button className="button button-secondary" onClick={() => setReference("")}>Send another request</button></section>;
  return <section className="support-workspace"><div className="support-form-heading"><span className="support-form-mark" aria-hidden="true">↗</span><div><span className="support-app-label">YOUR APPS. OUR SUPPORT.</span><h2>How can we help?</h2></div></div>{!available ? <div className="support-unavailable"><strong>The request form is being connected.</strong><p>{supportEmail ? <>You can reach us now at <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</> : <>For now, visit <a href="https://mynovanook.com">NovaNook’s website</a> for app information.</>}</p></div> : null}<form onSubmit={submit}><fieldset disabled={!available || busy}><legend className="support-sr-only">Support request</legend><div className="support-app-choice" role="group" aria-label="Choose your app">{apps.map(item => <button type="button" key={item.slug} aria-pressed={app === item.slug} onClick={() => setApp(item.slug)} className={app === item.slug ? "selected" : ""}><span style={{ backgroundColor: item.color }} />{item.name}{app === item.slug ? " ✓" : ""}</button>)}</div><div className="support-fields"><label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required placeholder="Where we can reply" /></label><label>What is this about?<select name="category" defaultValue="general"><option value="general">General help</option><option value="account">Account & sign-in</option><option value="billing">Subscription & billing</option><option value="bug">Something isn’t working</option><option value="safety">Safety or moderation</option><option value="feedback">Feedback or an idea</option></select></label></div><label>Subject<input name="subject" minLength={3} maxLength={180} required placeholder="A short description of what you need" /></label><label>Your message<textarea name="message" minLength={10} maxLength={12000} rows={6} required placeholder="Tell us what happened, what you expected, and the steps that led to it." /></label><label className="support-trap" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label><p className="support-privacy">Your email and message help us respond to this request. Please leave out passwords, payment-card numbers, and private reading or journal content.</p>{error && <p className="support-error" role="alert">{error}</p>}<button className="button support-submit" type="submit">{busy ? "Sending your request…" : "Send support request"}<span aria-hidden="true">↗</span></button></fieldset></form></section>;
}

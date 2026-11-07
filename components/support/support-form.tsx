"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/admin/icons";
import type { HubApp } from "@/lib/hub/types";
import "./support.css";

type SupportFormProps = {
  apps: Pick<HubApp, "slug" | "name" | "color">[];
  available: boolean;
  supportEmail: string | null;
};

export function SupportForm({ apps, available, supportEmail }: SupportFormProps) {
  const [app, setApp] = useState(apps[0]?.slug || "novanook");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (submittedRef.current) headingRef.current?.focus();
  }, [reference]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !available) return;
    const fields = new FormData(event.currentTarget);
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appSlug: app,
          email: fields.get("email"),
          subject: fields.get("subject"),
          body: fields.get("message"),
          category: fields.get("category"),
          website: fields.get("website"),
        }),
      });
      const body = await response.json() as { data?: { reference: string }; error?: string };
      if (!response.ok || !body.data?.reference) {
        throw new Error(body.error || "Your request could not be saved. Please try again.");
      }
      submittedRef.current = true;
      setReference(body.data.reference);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your request could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  if (reference) {
    return (
      <section className="support-receipt" aria-labelledby="support-receipt-title" aria-live="polite">
        <span className="support-check"><Icon name="check" size={26} /></span>
        <p className="gf-kicker">REQUEST RECEIVED</p>
        <h2 id="support-receipt-title" ref={headingRef} tabIndex={-1}>We’ve got your message.</h2>
        <p>Your inquiry for {apps.find(item => item.slug === app)?.name || "your app"} is saved in the Geofox support inbox.</p>
        <div className="support-reference-card">
          <span>Your request reference</span>
          <strong className="support-reference">{reference}</strong>
          <p>Keep this handy if you need to follow up.</p>
        </div>
        <div className="support-receipt-next">
          <Icon name="message" size={20} />
          <div><h3>What happens next?</h3><p>Our team will use the email you provided to respond. This page does not display account details.</p></div>
        </div>
        <button className="gf-button support-another" type="button" onClick={() => setReference("")}>Send another request<Icon name="arrow" size={16} /></button>
      </section>
    );
  }

  return (
    <section className="support-workspace" aria-labelledby="support-form-title">
      <div className="support-form-heading">
        <span className="support-form-mark"><Icon name="ticket" size={23} /></span>
        <div><p className="gf-kicker">SEND AN INQUIRY</p><h2 id="support-form-title" ref={headingRef} tabIndex={-1}>Tell us what you need.</h2></div>
      </div>
      <p className="support-form-intro">Can’t sign in, or have a question before joining? Send a request here and include an email where we can contact you.</p>

      {!available ? (
        <div className="support-unavailable" role="status">
          <Icon name="info" size={19} />
          <div><strong>The inquiry form is temporarily unavailable.</strong><p>{supportEmail ? <>You can reach us at <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</> : <>For now, visit <a href="https://www.mynovanook.com">NovaNook’s website</a> for app information.</>}</p></div>
        </div>
      ) : null}

      <form onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={!available || busy}>
          <legend className="support-sr-only">Support request</legend>
          <div className="support-app-field">
            <span id="support-app-label" className="support-field-label">Which app is this about?</span>
            <div className="support-app-choice" role="group" aria-labelledby="support-app-label">
              {apps.map(item => (
                <button type="button" key={item.slug} aria-pressed={app === item.slug} onClick={() => setApp(item.slug)} className={app === item.slug ? "selected" : ""}>
                  {item.slug === "novanook"
                    ? <Image className="support-choice-icon" src="/images/novanook/novanook-icon.svg" alt="" width={407} height={435} unoptimized />
                    : <span className="support-choice-dot" style={{ backgroundColor: item.color }} />}
                  {item.name}
                  {app === item.slug ? <Icon name="check" size={15} /> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="support-fields">
            <label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required placeholder="Where we can reply" /></label>
            <label>What is this about?
              <select name="category" defaultValue="general">
                <option value="general">General help</option>
                <option value="account">Account & sign-in</option>
                <option value="billing">Subscription & billing</option>
                <option value="bug">Something isn’t working</option>
                <option value="safety">Safety or moderation</option>
                <option value="feedback">Feedback or an idea</option>
              </select>
            </label>
          </div>
          <label>Subject<input name="subject" minLength={3} maxLength={180} required placeholder="A short description of what you need" /></label>
          <label>Your message<textarea name="message" minLength={10} maxLength={12000} rows={6} required placeholder="Tell us what happened, what you expected, and the steps that led to it." /></label>
          <label className="support-trap" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
          <div className="support-privacy"><Icon name="shield" size={17} /><p>Your email and message help us respond to this request. Please leave out passwords, payment-card numbers, and private reading or journal content.</p></div>
          {error ? <p className="support-error" role="alert"><Icon name="alert" size={18} /><span>{error}</span></p> : null}
          <button className="gf-button support-submit" type="submit">
            {busy ? "Sending your request…" : "Send support request"}
            <span className={busy ? "support-spin" : undefined}><Icon name={busy ? "refresh" : "arrow"} size={17} /></span>
          </button>
        </fieldset>
      </form>
    </section>
  );
}

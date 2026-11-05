"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/admin/icons";
import { billReminders, calendarReminderEntries, remindersCalendar, shiftDate, type BillReminder } from "@/lib/finance/reminders";
import type { FinanceData, RecordsProps } from "@/lib/finance/types";
import { PAYMENT_METHOD_LABELS } from "@/lib/finance/types";
import { vendorForEntry, vendorWebsiteUrl } from "@/lib/finance/vendors";
import { EmptyState, FinanceDialog, formatDate, Money, monthLabel } from "./shared";
import { accountScopeLabel } from "./accounts";
import "./reminders.css";

export function useBillAlerts(data: FinanceData) {
  const [enabled, setEnabled] = useState(false), [supported, setSupported] = useState(false), [error, setError] = useState("");
  const lastSent = useRef("");
  const key = `geofox-finance-alerts:${data.user.id}`;
  useEffect(() => {
    setSupported("Notification" in window && window.isSecureContext && "serviceWorker" in navigator);
    try { setEnabled(localStorage.getItem(key) === "enabled"); } catch { /* Private browsing may disallow storage. */ }
  }, [key]);
  async function enable() {
    setError("");
    try {
      if (!supported) throw new Error("Use calendar reminders on this browser. Browser alerts require a supported secure browser.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notifications weren’t enabled. You can allow them in your browser settings, or use calendar reminders.");
      try { localStorage.setItem(key, "enabled"); } catch { /* Keep the explicit opt-in for this session. */ }
      setEnabled(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Browser alerts could not be enabled."); }
  }
  function disable() { setEnabled(false); setError(""); try { localStorage.removeItem(key); } catch {} }
  const due = billReminders(data).filter(item => item.state !== "snoozed");
  const signature = `${data.today}:${due.map(item => `${item.entry.id}:${item.entry.scheduled_date}`).sort().join(",")}`;
  useEffect(() => {
    if (!enabled || !supported || Notification.permission !== "granted") return;
    if (!due.length) return;
    try { if (localStorage.getItem(`${key}:last`) === signature) return; } catch {}
    if (lastSent.current === signature) return;
    let cancelled = false;
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register("/finance-reminders-sw.js", { scope: "/finance/", updateViaCache: "none" });
        if (!registration.active) {
          await new Promise<void>((resolve, reject) => {
            const worker = registration.installing ?? registration.waiting;
            if (!worker) return reject(new Error("Your browser could not start notifications. Use calendar reminders instead."));
            const timeout = window.setTimeout(() => { worker.removeEventListener("statechange", changed); reject(new Error("Notifications did not start. Try enabling them again.")); }, 8000);
            const changed = () => { if (worker.state === "activated") { window.clearTimeout(timeout); worker.removeEventListener("statechange", changed); resolve(); } };
            worker.addEventListener("statechange", changed); changed();
          });
        }
        if (cancelled) return;
        await registration.showNotification("Geofox Finance · bill reminders", { body: `${due.length} ${due.length === 1 ? "bill needs" : "bills need"} your attention. Open your private dashboard to review.`, tag: "geofox-finance-reminders", icon: "/icon.svg" });
        lastSent.current = signature;
        try { localStorage.setItem(`${key}:last`, signature); } catch {}
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "Browser notifications are unavailable. Calendar reminders are still available."); }
    })();
    return () => { cancelled = true; };
  }, [enabled, supported, key, signature, due.length]);
  return { enabled, supported, error, enable, disable };
}

export function RemindersPanel(props: RecordsProps & { alerts: ReturnType<typeof useBillAlerts> }) {
  const { data, today, month, mutate, openEntry, openPayment, openMove, alerts, notify } = props;
  const [tab, setTab] = useState<"active" | "snoozed">("active"), [snoozing, setSnoozing] = useState<BillReminder | null>(null), [snoozeDate, setSnoozeDate] = useState(shiftDate(today, 1));
  const [error, setError] = useState(""), [pending, setPending] = useState(false);
  const reminders = billReminders(data), active = reminders.filter(item => item.state !== "snoozed"), snoozed = reminders.filter(item => item.state === "snoozed");
  const calendarCount = calendarReminderEntries(data, month).length;
  async function saveSnooze(id: string, until: string | null) {
    if (pending) return; setPending(true); setError("");
    try { await mutate("snooze_reminder", { id, until }); setSnoozing(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The reminder could not be updated."); }
    finally { setPending(false); }
  }
  function exportCalendar() {
    const content = remindersCalendar(data, month);
    const url = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `geofox-bill-reminders-${month}.ics`; document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Calendar file downloaded. Import it into your calendar and keep its reminders enabled.");
  }
  return <div className="fn-stack">
    <div className="fr-reminder-stats"><div><span>Needs attention</span><strong>{active.length}</strong></div><div><span>Past planned date</span><strong className="fn-negative">{active.filter(item => item.state === "past_due").length}</strong></div><div><span>Due today</span><strong>{active.filter(item => item.state === "today").length}</strong></div><div><span>Coming up</span><strong>{active.filter(item => item.state === "upcoming").length}</strong></div></div>
    <section className="fn-panel"><div className="fn-panel-head"><div><h2>Your bill reminders</h2><p>Across all accounts and months, based on today · {formatDate(today)}.</p></div><Icon name="bell" size={21} /></div><div className="fn-panel-body"><p className="fn-muted">Reminders follow each bill’s planned payment date and the reminder setting on its record. Days past due count from the original due date, even when the planned payment date changes. Fully paid, cancelled, and collection records leave this list. Bills with reminders turned off stay on the Bills page.</p><div className="fn-tabs"><button className={`fn-tab ${tab === "active" ? "active" : ""}`} onClick={() => setTab("active")}>Active · {active.length}</button><button className={`fn-tab ${tab === "snoozed" ? "active" : ""}`} onClick={() => setTab("snoozed")}>Snoozed · {snoozed.length}</button></div></div>
      {error && !snoozing ? <p className="fn-form-error" role="alert">{error}</p> : null}
      {(tab === "active" ? active : snoozed).length ? <div className="fr-reminder-list">{(tab === "active" ? active : snoozed).map(reminder => {
        const { entry } = reminder, vendor = vendorForEntry(data, entry), website = vendorWebsiteUrl(vendor?.url);
        return <article className="fr-reminder" key={entry.id}><div className="fr-reminder-title"><div><h3>{entry.title}</h3><p>{formatDate(entry.scheduled_date)} · {accountScopeLabel(data, entry.account_id)} · {PAYMENT_METHOD_LABELS[entry.payment_method]}</p>{entry.scheduled_date !== entry.original_due_date ? <p><span className="fn-badge purple">Moved</span> Original due {formatDate(entry.original_due_date)}</p> : null}{entry.archived_at ? <span className="fn-badge">Archived record · still unpaid</span> : null}</div><div className="fr-reminder-amount"><Money cents={reminder.remaining_cents} /><>{reminder.days_past_due > 0 ? <span className="fn-badge negative" title="Counted from the original due date">{reminder.days_past_due} {reminder.days_past_due === 1 ? "day" : "days"} past due</span> : null}{!reminder.days_past_due || entry.scheduled_date !== entry.original_due_date || reminder.state === "snoozed" ? <span className={`fn-badge ${reminder.state === "past_due" ? "negative" : reminder.state === "today" ? "warning" : "purple"}`}>{reminder.state === "past_due" ? "Past planned date" : reminder.state === "today" ? "Due today" : reminder.state === "snoozed" ? `Snoozed to ${formatDate(entry.reminder_snoozed_until!)}` : "Upcoming"}</span> : null}</></div></div><div className="fn-actions"><button className="fn-button small primary" onClick={() => openPayment(entry)}>Record payment</button>{website ? <a className="fn-button small" href={website} target="_blank" rel="noopener noreferrer">Pay at vendor <Icon name="external" size={12} /><span className="fr-sr-only"> in a new tab</span></a> : null}<button className="fn-button small" onClick={() => openMove(entry)}>Move bill</button><button className="fn-button small" onClick={() => openEntry(entry)}>Edit bill</button>{reminder.state === "snoozed" ? <button className="fn-button subtle small" disabled={pending} onClick={() => saveSnooze(entry.id, null)}>Unsnooze</button> : <button className="fn-button subtle small" onClick={() => { setSnoozing(reminder); setSnoozeDate(shiftDate(today, 1)); setError(""); }}>Snooze reminder</button>}</div></article>;
      })}</div> : <EmptyState title={tab === "snoozed" ? "No snoozed reminders" : "You’re caught up on reminders"} description={tab === "snoozed" ? "Snoozing changes when a reminder appears; it does not move the bill." : "Upcoming reminders appear within each bill’s lead time. Add or edit a bill to choose when to be reminded."} />}
    </section>
    <div className="fn-equal-col"><section className="fn-panel"><div className="fn-panel-head"><div><h2>Alerts while Finance is open</h2><p>Optional notifications on this device.</p></div><Icon name="bell" size={19} /></div><div className="fn-panel-body"><p className="fn-muted">Your dashboard always shows reminders. Enable browser alerts for a notification when a bill needs attention while Finance is open. Alerts use a general message without bill names or amounts.</p>{alerts.error ? <p className="fn-form-error" role="alert">{alerts.error}</p> : null}<button className="fn-button" disabled={!alerts.supported && !alerts.enabled} onClick={alerts.enabled ? alerts.disable : alerts.enable}>{alerts.enabled ? "Turn off browser alerts" : "Enable browser alerts"}</button><p className="fn-muted">{alerts.enabled ? "Enabled on this device. Your browser’s notification settings also apply." : !alerts.supported ? "This browser does not support these alerts. Use calendar reminders below." : "Enable only on a device where you want these notifications."}</p></div></section>
      <section className="fn-panel"><div className="fn-panel-head"><div><h2>Reminders when Finance is closed</h2><p>Add this month’s bills to your own calendar.</p></div><Icon name="calendar" size={19} /></div><div className="fn-panel-body"><p className="fn-muted">Download {calendarCount} unpaid bill {calendarCount === 1 ? "reminder" : "reminders"} scheduled in {monthLabel(month)}. Import the file into your phone or computer calendar. Events are at 9 a.m. in your calendar’s local time, with each bill’s reminder lead time.</p><button className="fn-button" onClick={exportCalendar} disabled={!calendarCount}><Icon name="download" size={15} />Download calendar reminders</button><p className="fn-muted">This is a snapshot, not a live calendar connection. After paying or moving bills, update your imported events or replace the old import. Your calendar controls whether imported alerts are allowed.</p></div></section></div>
    {snoozing ? <FinanceDialog title={`Snooze · ${snoozing.entry.title}`} onClose={() => { if (!pending) setSnoozing(null); }}><form onSubmit={event => { event.preventDefault(); void saveSnooze(snoozing.entry.id, snoozeDate); }}><label className="fn-field"><span>Remind me again on</span><input type="date" min={shiftDate(today, 1)} max="2100-12-31" required value={snoozeDate} onChange={event => setSnoozeDate(event.target.value)} /></label><p className="fn-form-help">The bill keeps its planned payment date of {formatDate(snoozing.entry.scheduled_date)}. Snoozing changes the reminder only.</p>{error ? <p className="fn-form-error" role="alert">{error}</p> : null}<div className="fn-actions end"><button type="button" className="fn-button" disabled={pending} onClick={() => setSnoozing(null)}>Cancel</button><button className="fn-button primary" disabled={pending}>{pending ? "Saving…" : "Snooze reminder"}</button></div></form></FinanceDialog> : null}
  </div>;
}

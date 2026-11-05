"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { GeofoxMark, Icon, type IconName } from "@/components/admin/icons";
import { remainingAmount, shiftMonth } from "@/lib/finance/calculations";
import type { EntryKind, FinanceData, FinanceDebt, FinanceEntry, FinancePlan, RecordsProps } from "@/lib/finance/types";
import { EntryEditor, PaymentEditor, MoveEditor, PlanEditor, DebtEditor } from "./editors";
import { BillsPanel, IncomePanel, PaymentsPanel, DebtsPanel } from "./records";
import { OverviewPanel } from "./overview";
import { CalendarPanel, LiveMoneyPanel, StartingBalanceEditor, type DraftChange } from "./planning";
import { monthLabel } from "./shared";
import "@/app/admin/admin.css";
import "@/components/workspace/workspace.css";
import "./finance.css";
import "./records.css";

const ReportsPanel = dynamic(() => import("./reports").then(module => module.ReportsPanel), { loading: () => <div className="fn-panel fn-empty" role="status">Opening reports…</div> });
const NAV: { id: string; label: string; icon: IconName; description: string }[] = [
  { id: "overview", label: "Overview", icon: "grid", description: "A little clarity for today. A little breathing room for what’s next." },
  { id: "live-money", label: "Live Money", icon: "pulse", description: "See your money move through the month, one day and one decision at a time." },
  { id: "calendar", label: "Calendar", icon: "calendar", description: "Your income, bills, and daily balances, together on one monthly calendar." },
  { id: "bills", label: "Bills", icon: "checklist", description: "Know what was due, what’s paid, and what still needs a plan." },
  { id: "income", label: "Income", icon: "coins", description: "Plan your paydays and keep track of the money you’ve received." },
  { id: "payments", label: "Payments", icon: "layers", description: "Every installment and payment plan, with a clear view of your progress." },
  { id: "credit", label: "Credit & collections", icon: "shield", description: "Organize debts, collectors, balance changes, and offers in one place." },
  { id: "reports", label: "Reports", icon: "chart", description: "Understand your monthly commitments and the progress you’re making." },
];
type Editor = { type: "entry"; entry?: FinanceEntry; kind?: EntryKind; date?: string; draft?: DraftChange } | { type: "payment" | "move"; entry: FinanceEntry } | { type: "plan"; plan?: FinancePlan } | { type: "debt"; debt?: FinanceDebt } | { type: "balance" } | null;

export function FinanceWorkspace({ initialData, initialMonth }: { initialData: FinanceData; initialMonth: string }) {
  const [data, setData] = useState(initialData), [month, setMonth] = useState(initialMonth), [view, setView] = useState("overview");
  const [editor, setEditor] = useState<Editor>(null), [menuOpen, setMenuOpen] = useState(false), [toast, setToast] = useState("");
  const [error, setError] = useState(""), [refreshing, setRefreshing] = useState(false), [saving, setSaving] = useState(false), [loggingOut, setLoggingOut] = useState(false);
  const [loadedMonth, setLoadedMonth] = useState(initialMonth), [needsRefresh, setNeedsRefresh] = useState(false);
  const [confetti, setConfetti] = useState(false), [drafts, setDrafts] = useState<DraftChange[]>([]);
  const requestNumber = useRef(0), mutationBusy = useRef(false), initialLoad = useRef(true);
  const dataRef = useRef(data); dataRef.current = data;
  const current = NAV.find(item => item.id === view) || NAV[0];
  const displayName = data.user.display_name || "Your workspace";
  const initials = displayName.split(/\s+/).slice(0, 2).map(value => value[0]).join("");

  useEffect(() => {
    const update = () => { const next = window.location.hash.slice(1); if (NAV.some(item => item.id === next)) setView(next); setMenuOpen(false); };
    update(); window.addEventListener("hashchange", update); return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(""), 7000); return () => window.clearTimeout(timeout); }, [toast]);
  useEffect(() => { if (!confetti) return; const timeout = window.setTimeout(() => setConfetti(false), 2300); return () => window.clearTimeout(timeout); }, [confetti]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);

  const reload = useCallback(async (forMonth: string) => {
    const sequence = ++requestNumber.current; setRefreshing(true);
    try {
      const response = await fetch(`/api/finance?month=${encodeURIComponent(forMonth)}`, { cache: "no-store", credentials: "same-origin" });
      const result = await response.json();
      if (!response.ok || !result.data) throw new Error(result.error || "Your finances could not be refreshed.");
      const nextData = result.data as FinanceData;
      if (sequence === requestNumber.current) { setData(nextData); setLoadedMonth(forMonth); setNeedsRefresh(false); setError(""); }
      return nextData;
    } catch (e) { if (sequence === requestNumber.current) setError(e instanceof Error ? e.message : "Your finances could not be refreshed."); throw e; }
    finally { if (sequence === requestNumber.current) setRefreshing(false); }
  }, []);
  useEffect(() => { if (initialLoad.current) { initialLoad.current = false; return; } void reload(month).catch(() => {}); }, [month, reload]);

  async function mutate(action: string, payload: Record<string, unknown>) {
    if (mutationBusy.current) throw new Error("Please wait for the current save to finish.");
    if (needsRefresh || loadedMonth !== month) throw new Error("Refresh this month before making another change.");
    mutationBusy.current = true; setSaving(true); setError("");
    const before = action === "record_payment" ? dataRef.current.entries.find(entry => entry.id === payload.entry_id) : null;
    const previouslyOutstanding = before ? remainingAmount(before, dataRef.current.payments) : 0;
    try {
      const response = await fetch("/api/finance", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Your change could not be saved. Please try again.");
      let fresh: FinanceData | null = null;
      try { fresh = await reload(month); }
      catch { setNeedsRefresh(true); setError("Your change was saved, but the updated view could not be loaded. Refresh to see the latest balances."); setToast("Saved successfully. Refresh to load your updated balances."); }
      if (before?.kind === "bill" && previouslyOutstanding > 0 && fresh) {
        const paidEntry = fresh.entries.find(entry => entry.id === before.id);
        if (paidEntry && remainingAmount(paidEntry, fresh.payments) === 0) { setConfetti(true); setToast(`${before.title} is paid. One less thing on your list!`); }
        else setToast("Payment saved. Your remaining balance has been updated.");
      } else if (fresh) setToast(action === "record_payment" ? "Income received. Your balances have been updated." : action === "transfer_collections" ? "Moved to collections. The original history has been kept." : "Saved. Your finance workspace is up to date.");
    } finally { mutationBusy.current = false; setSaving(false); }
  }
  function navigate(next: string) { if (!NAV.some(item => item.id === next)) return; setView(next); window.location.hash = next; setMenuOpen(false); }
  async function signOut() {
    setLoggingOut(true); setError("");
    try { const response = await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); if (!response.ok) throw new Error("Sign-out could not be completed. Please try again."); window.location.assign("/admin/login?next=/finance"); }
    catch (e) { setError(e instanceof Error ? e.message : "Please try signing out again."); setLoggingOut(false); }
  }
  const props: RecordsProps = { data, month, today: data.today, mutate, notify: setToast,
    openEntry: (entry, kind, date) => setEditor({ type: "entry", entry, kind, date }),
    openPlan: plan => setEditor({ type: "plan", plan }), openDebt: debt => setEditor({ type: "debt", debt }),
    openPayment: entry => setEditor({ type: "payment", entry }), openMove: entry => setEditor({ type: "move", entry }),
  };
  const openBalance = () => setEditor({ type: "balance" });
  const editorProps = { data, month, today: data.today, mutate, onClose: () => { if (!mutationBusy.current) setEditor(null); } };
  function renderPanel() {
    switch (view) {
      case "live-money": return <LiveMoneyPanel {...props} openBalance={openBalance} drafts={drafts} setDrafts={setDrafts} commitDraft={draft => setEditor({ type: "entry", kind: draft.kind === "income" ? "income" : "bill", date: draft.date, draft })} />;
      case "calendar": return <CalendarPanel {...props} openBalance={openBalance} />;
      case "bills": return <BillsPanel {...props} />;
      case "income": return <IncomePanel {...props} />;
      case "payments": return <PaymentsPanel {...props} />;
      case "credit": return <DebtsPanel {...props} />;
      case "reports": return <ReportsPanel {...props} />;
      default: return <OverviewPanel {...props} openBalance={openBalance} navigate={navigate} />;
    }
  }
  return <div className="hub-root hub-company-root finance-root"><a className="hub-skip-link" href="#finance-content">Skip to finance content</a>
    <nav className="hub-area-rail" aria-label="Your workspaces"><a className="hub-rail-brand" href="/admin" aria-label="Geofox Hub"><GeofoxMark /></a><div className="hub-area-list"><a className="hub-area-button" href="/admin" aria-label="Open Geofox Hub" title="Geofox Hub"><Icon name="grid" size={21} /><span>Hub</span></a><a className="hub-area-button active" href="/finance" aria-current="page" aria-label="Finance workspace"><Icon name="wallet" size={21} /><span>Finance</span></a></div><div className="hub-area-bottom"><a className="hub-area-button" href="/admin#profile/account" aria-label="My profile"><Icon name="profile" size={21} /><span>Profile</span></a><button className="hub-area-button" aria-label="Sign out" onClick={signOut} disabled={loggingOut}><Icon name="logout" size={20} /><span>{loggingOut ? "Wait…" : "Sign out"}</span></button></div></nav>
    {menuOpen ? <button className="hub-sidebar-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /> : null}
    <aside id="finance-sidebar" className={`hub-sidebar ${menuOpen ? "is-open" : ""}`}><a className="hub-logo" href="/finance"><span>geofox <small>finance</small></span></a><p className="hub-workspace-name">A clearer view of your money</p><button className="hub-mobile-close hub-icon-button" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><Icon name="close" size={17} /></button><p className="hub-nav-label">YOUR MONEY</p><nav className="hub-nav" aria-label="Finance pages">{NAV.map(item => <button key={item.id} className={`hub-nav-button ${view === item.id ? "active" : ""}`} aria-current={view === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} size={18} />{item.label}{item.id === "live-money" ? <span className="hub-nav-pill">Plan</span> : null}</button>)}</nav><div className="hub-sidebar-bottom"><div className="hub-side-note"><div className="hub-note-icon"><Icon name="lock" size={18} /></div><strong>Just for you, for now.</strong><p>Your private finance workspace. Make a plan, move things around, and see what feels manageable.</p></div><div className="hub-profile"><span className="hub-avatar">{initials}</span><span className="hub-profile-name"><strong>{displayName}</strong><span>Private owner access</span></span></div></div></aside>
    <div className="hub-main"><header className="hub-topbar"><div className="fn-actions"><button type="button" className="hub-icon-button hub-menu-button" aria-label="Open finance navigation" aria-expanded={menuOpen} aria-controls="finance-sidebar" onClick={() => setMenuOpen(true)}><Icon name="menu" size={19} /></button><div className="hub-breadcrumb"><span className="fn-breadcrumb-label">Finance</span><Icon name="chevron" size={12} style={{ transform: "rotate(-90deg)" }} /><strong>{current.label}</strong></div></div><div className="hub-topbar-actions"><span className="fn-private"><Icon name="lock" size={12} />Private</span><div className="fn-month-picker"><button className="fn-icon-button" disabled={saving || refreshing} onClick={() => setMonth(value => shiftMonth(value, -1))} aria-label="Previous month"><Icon name="chevron" size={15} /></button><input type="month" aria-label="Selected finance month" value={month} min="2000-01" max="2100-12" onChange={event => { if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value); }} disabled={saving || refreshing} /><button className="fn-icon-button" disabled={saving || refreshing} onClick={() => setMonth(value => shiftMonth(value, 1))} aria-label="Next month"><Icon name="chevron" size={15} /></button></div><button className="fn-icon-button" disabled={refreshing || saving} onClick={() => { void reload(month).catch(() => {}); }} aria-label="Refresh finance data"><Icon name="refresh" size={15} /></button></div></header>
      <main className="hub-content" id="finance-content" tabIndex={-1}><div className="fn-heading"><div><p className="fn-eyebrow">{monthLabel(month)} · YOUR PRIVATE WORKSPACE</p><h1>{view === "overview" ? "Your money, in a calmer place." : current.label}</h1><p>{current.description}</p></div><div className="fn-actions"><button className="fn-button" onClick={() => props.openEntry(undefined, "income")} disabled={saving || refreshing || needsRefresh || loadedMonth !== month}><Icon name="plus" size={14} />Add income</button><button className="fn-button primary" onClick={() => view === "payments" ? props.openPlan() : view === "credit" ? props.openDebt() : props.openEntry(undefined, "bill")} disabled={saving || refreshing || needsRefresh || loadedMonth !== month}><Icon name="plus" size={14} />{view === "payments" ? "Add payment plan" : view === "credit" ? "Add debt" : "Add bill"}</button></div></div>
      {error ? <div className="fn-notice error" role="alert"><Icon name="alert" size={19} /><div>{error}</div><div className="fn-actions"><button className="fn-button small" onClick={() => { void reload(month).catch(() => {}); }} disabled={refreshing}>Refresh</button><a className="fn-button small" href="/admin/login?next=/finance">Sign in</a></div></div> : null}
      {refreshing ? <p className="fn-muted" role="status">Refreshing your saved balances…</p> : null}
      {loadedMonth !== month || needsRefresh ? <div className="fn-panel fn-empty" role="status"><h3>{needsRefresh ? "Your change is saved." : `Opening ${monthLabel(month)}…`}</h3><p>{needsRefresh ? "Refresh to load the updated records before continuing. Your saved data is secure." : "Loading this month’s recurring bills, income, and balances."}</p>{!refreshing ? <button className="fn-button primary" onClick={() => { void reload(month).catch(() => {}); }}>Refresh balances</button> : null}</div> : renderPanel()}<p className="fn-footer"><Icon name="lock" size={12} />Geofox Finance · Private owner workspace · USD · Central Time · Manually entered projections</p></main></div>
    {editor?.type === "entry" ? <EntryEditor {...editorProps} entry={editor.entry ? data.entries.find(item => item.id === editor.entry?.id) || editor.entry : undefined} kind={editor.kind} date={editor.date} initial={editor.draft ? { title: editor.draft.title, amount_cents: editor.draft.amount_cents } : undefined} onSaved={editor.draft ? () => setDrafts(old => old.filter(draft => draft.id !== editor.draft?.id)) : undefined} /> : null}
    {editor?.type === "payment" ? <PaymentEditor {...editorProps} entry={data.entries.find(item => item.id === editor.entry.id) || editor.entry} /> : null}
    {editor?.type === "move" ? <MoveEditor {...editorProps} entry={data.entries.find(item => item.id === editor.entry.id) || editor.entry} /> : null}
    {editor?.type === "plan" ? <PlanEditor {...editorProps} plan={editor.plan ? data.plans.find(item => item.id === editor.plan?.id) || editor.plan : undefined} /> : null}
    {editor?.type === "debt" ? <DebtEditor {...editorProps} debt={editor.debt ? data.debts.find(item => item.id === editor.debt?.id) || editor.debt : undefined} /> : null}
    {editor?.type === "balance" ? <StartingBalanceEditor {...editorProps} /> : null}
    {toast ? <div className="fn-toast" role="status"><Icon name="check" size={17} /><span>{toast}</span><button className="fn-icon-button" aria-label="Dismiss notification" onClick={() => setToast("")}><Icon name="close" size={13} /></button></div> : null}
    {confetti ? <div className="fn-confetti" aria-hidden="true">{Array.from({ length: 35 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, background: ["#a28be1", "#62b9a1", "#f1c471", "#f0a0b2", "#80b5e3"][i % 5], animationDelay: `${i % 7 * .05}s`, transform: `rotate(${i * 41}deg)` } as CSSProperties} />)}</div> : null}
  </div>;
}

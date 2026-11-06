"use client";

import { useRef, useState } from "react";
import { apiRequest, useHubData, date, type PanelProps } from "@/components/admin/common";
import { Icon } from "@/components/admin/icons";
import { DEPARTMENTS, DEPARTMENT_LABELS, type AlfredAction, type AlfredDashboard, type AlfredRun, type Department, type Knowledge } from "@/lib/alfred/schema";
import "./alfred.css";

const dollars = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const starters: Record<Department, string> = {
  briefing: "Give me an evidence-based company briefing: what needs my attention, what can wait, and what should we do next?",
  support: "Investigate the selected support ticket. Explain what is known, what is uncertain, and draft a helpful customer reply without claiming an unverified fix.",
  marketing: "Analyze the marketing results already recorded here. Propose three content experiments with captions, visual direction, and the metrics to compare. Do not invent trends or results.",
  accounting: "Review the available business accounting records for missing information, unusual entries, and questions to review with my accountant. Do not treat a sample as the complete ledger.",
  engineering: "Review the recorded application errors. Separate confirmed evidence from possible causes and propose safe investigation tasks, reproduction steps, and verification checks.",
  product: "Group the recent customer issues and tasks into a practical product priority list, explaining the supporting evidence and gaps.",
  legal: "Review the saved compliance tasks for items requiring owner or professional review. Identify missing information without inventing current laws or filing deadlines.",
};
const departmentNotes: Record<Department, string> = {
  briefing: "Your company, one clear briefing.", support: "Investigate, draft, then review.", marketing: "Turn recorded results into ideas.",
  accounting: "Understand your business records.", engineering: "Triage errors without risky repairs.", product: "Find patterns in customer needs.", legal: "Keep review work organized.",
};
function RunResult({ run }: { run: AlfredRun }) {
  return <article className="alfred-result">
    <div className="alfred-row"><span className={`alfred-status ${run.state}`}>{run.state}</span><small>{date(run.created_at)} · {DEPARTMENT_LABELS[run.department]}</small></div>
    {run.state === "running" && <p>This investigation is still recorded as running. Refresh Activity before retrying. Interrupted runs are marked failed on the next investigation.</p>}
    {run.error && <div className="alfred-notice error">{run.error}</div>}
    {run.output && <><div className="alfred-report">{run.output.report}</div>
      {!!run.output.limitations.length && <div className="alfred-notice"><strong>Limits of this investigation</strong>{run.output.limitations.map((item, i) => <p key={i}>{item}</p>)}</div>}
      {!!run.output.proposals.length && <p className="alfred-muted">{run.output.proposals.length} proposed action{run.output.proposals.length === 1 ? "" : "s"} saved for owner review. No proposal has been automatically executed.</p>}
    </>}
    {!!run.evidence?.length && <details className="alfred-evidence"><summary>Inspect the evidence ({run.evidence.length} sources)</summary>{run.evidence.map(source => <details key={source.id}><summary>[{source.id}] {source.label}</summary><pre>{JSON.stringify(source.data, null, 2)}</pre></details>)}</details>}
    <p className="alfred-micro">Run {run.id} · {run.estimated_usd == null ? "Cost not confirmed" : `Estimated model cost $${Number(run.estimated_usd).toFixed(4)}`} · Budget allowance {dollars(run.budget_cents)}</p>
  </article>;
}

export function AlfredPanel({ preview, app, apps, refreshKey, notify, tab = "command" }: PanelProps & { tab?: string }) {
  const [revision, setRevision] = useState(0);
  const scope = app;
  const resource = useHubData<AlfredDashboard>(preview ? null : `/api/alfred?scope=${encodeURIComponent(scope)}`, refreshKey + revision);
  const data = resource.data;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [department, setDepartment] = useState<Department>("briefing");
  const [question, setQuestion] = useState(starters.briefing);
  const [ticketId, setTicketId] = useState("");
  const [result, setResult] = useState<AlfredRun | null>(null);
  const pendingRun = useRef<{ fingerprint: string; id: string } | null>(null);
  const [knowledge, setKnowledge] = useState<Knowledge | null>(null);
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeBody, setKnowledgeBody] = useState("");
  const [knowledgeApp, setKnowledgeApp] = useState(scope === "all" || scope === "company" ? "" : scope);
  const [reviewedAction, setReviewedAction] = useState<string | null>(null);

  async function mutate(operation: string, payload: Record<string, unknown>, label: string) {
    if (preview) { notify("This is a visual preview. Sign in as owner to use Alfred."); return; }
    setBusy(operation); setError(null);
    try {
      const value = await apiRequest<{ message?: string }>("/api/alfred", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, ...payload }) });
      notify(value?.message || label); setRevision(v => v + 1); return value;
    } catch (e) { setError(e instanceof Error ? e.message : "The operation could not be confirmed. Refresh and inspect Activity before retrying."); }
    finally { setBusy(null); }
  }
  async function run() {
    if (preview) { notify("Sign in as owner to run an investigation. This preview does not call an AI model."); return; }
    const payload = { scope, department, question, ticketId: department === "support" && ticketId ? ticketId : null };
    const fingerprint = JSON.stringify(payload);
    if (!pendingRun.current || pendingRun.current.fingerprint !== fingerprint) pendingRun.current = { fingerprint, id: crypto.randomUUID() };
    setBusy("run"); setError(null);
    try {
      const next = await apiRequest<AlfredRun>("/api/alfred", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "run", requestId: pendingRun.current.id, ...payload }) });
      setResult(next); if (next.state !== "running") pendingRun.current = null; setRevision(v => v + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "The investigation could not be confirmed. Check Activity before retrying."); }
    finally { setBusy(null); }
  }
  function pickDepartment(next: Department) { setDepartment(next); setQuestion(starters[next]); setTicketId(""); setResult(null); }
  function editKnowledge(entry: Knowledge) { setKnowledge(entry); setKnowledgeTitle(entry.title); setKnowledgeBody(entry.body); setKnowledgeApp(entry.app_slug ?? ""); }
  const actionLabel = (action: AlfredAction) => action.kind === "support_reply" ? "Approve & send reply" : action.kind === "marketing_draft" ? "Approve & save draft" : "Approve & create task";
  const actions = data?.actions ?? [];
  const openActions = actions.filter(a => a.state === "pending");
  const appName = (slug: string | null) => slug ? apps.find(a => a.slug === slug)?.name || slug : "Geofox company";

  return <div className="alfred">
    <section className="alfred-hero">
      <div className="alfred-mark"><Icon name="bolt" /></div>
      <div><p className="alfred-eyebrow">GEOFOX INTELLIGENCE</p><h2>Meet Alfred.</h2><p>Your AI Chief of Staff. Real evidence. Clear proposals. You stay in control.</p></div>
      <div className="alfred-hero-status"><span className={`alfred-status ${data?.settings.enabled ? "completed" : "paused"}`}>{preview ? "Interface preview" : data?.settings.enabled ? "Active · approval required" : "Paused / awaiting activation"}</span><small>Owner-only workspace</small></div>
    </section>
    <div role="status" aria-live="polite">{busy && <div className="alfred-notice">{busy === "run" ? "Alfred is reviewing the connected records. You can find this investigation in Activity." : "Saving your decision…"}</div>}</div>
    {(error || resource.error) && <div className="alfred-notice error" role="alert">{error || resource.error}</div>}
    {resource.loading && !data && !preview && <p>Loading Alfred’s workspace…</p>}
    {preview && <div className="alfred-notice">Visual preview only. No private records, model requests, approvals, or spending are available here.</div>}
    {!preview && data && !data.settings.enabled && tab !== "controls" && <div className="alfred-notice"><strong>Alfred is paused.</strong> Open Controls to review the data-processing notice, choose spending limits, and activate Alfred. Reading history remains available while paused.</div>}

    {tab === "command" && <>
      <div className="alfred-metrics"><div><span>Awaiting your review</span><strong>{data?.pendingCount ?? "—"}</strong></div><div><span>Investigations this month</span><strong>{data?.usage.monthRuns ?? "—"}</strong></div><div><span>Estimated model cost</span><strong>{data ? `$${data.usage.monthEstimatedUsd.toFixed(2)}` : "—"}</strong></div><div><span>Autonomy</span><strong className="alfred-metric-text">Draft & review</strong></div></div>
      <div className="alfred-departments" role="group" aria-label="Alfred departments">{DEPARTMENTS.map(d => <button type="button" className={department === d ? "selected" : ""} key={d} onClick={() => pickDepartment(d)} aria-pressed={department === d}><strong>{DEPARTMENT_LABELS[d]}</strong><span>{departmentNotes[d]}</span></button>)}</div>
      <section className="alfred-card"><div className="alfred-section-head"><div><p className="alfred-eyebrow">{DEPARTMENT_LABELS[department]}</p><h3>What should we work on?</h3></div><span className="alfred-scope">{scope === "all" ? "All accessible apps + company" : appName(scope === "company" ? null : scope)}</span></div>
        {department === "support" && <label className="alfred-field">Support ticket<select value={ticketId} onChange={e => setTicketId(e.target.value)}><option value="">Review the support queue (no reply action)</option>{data?.tickets.map(t => <option value={t.id} key={t.id}>{t.reference} · {t.subject}</option>)}</select></label>}
        <label className="alfred-field">Your request<textarea rows={5} maxLength={4000} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask Alfred to investigate, analyze, or prepare a draft…" /></label>
        <div className="alfred-row"><p className="alfred-muted">Alfred only uses connected records in this scope. Each investigation starts fresh; include relevant context.</p><button type="button" className="alfred-primary" disabled={Boolean(busy) || question.trim().length < 3 || (!preview && !data?.settings.enabled)} onClick={() => void run()}><Icon name="bolt" />{busy === "run" ? "Investigating…" : "Ask Alfred"}</button></div>
      </section>
      {result && <RunResult run={result} />}
      <div className="alfred-notice"><strong>No silent changes.</strong> Alfred can propose tasks, marketing drafts, and support replies. It cannot change code, delete accounts, move money, file taxes, or publish posts on its own.</div>
    </>}

    {tab === "approvals" && <section><div className="alfred-section-head"><div><h3>Your approval inbox</h3><p className="alfred-muted">Review the exact content and destination before approving. Proposals expire after seven days.</p></div><button onClick={() => setRevision(v => v + 1)} disabled={Boolean(busy)}>Refresh</button></div>
      {!openActions.length && <div className="alfred-empty"><Icon name="check" /><h3>No pending proposals</h3><p>Actions from Alfred’s investigations will appear here. Nothing is generated just to fill this page.</p></div>}
      {openActions.map(action => <article className="alfred-card" key={action.id}><div className="alfred-row"><span className="alfred-status pending">{action.kind.replaceAll("_", " ")}</span><small>{appName(action.app_slug)} · {date(action.created_at)}</small></div><h3>{action.title}</h3><p className="alfred-muted">{String(action.payload.reason ?? "")}</p>
        {action.kind === "support_reply" && <div className="alfred-notice"><strong>Customer-facing reply · {String(action.payload.ticketReference)}</strong><p>Approving sends this exact message to the ticket’s existing recipient or app support thread. A changed conversation blocks sending.</p></div>}
        {action.kind === "marketing_draft" && <p>Destination: Marketing drafts · {String(action.payload.platform)}. This does not publish or schedule the post.</p>}
        <div className="alfred-proposal">{String(action.payload.body ?? "")}</div>
        <p className="alfred-micro">Source references: {Array.isArray(action.payload.sourceIds) ? action.payload.sourceIds.join(", ") || "Owner request" : "Owner request"} · Expires {date(action.expires_at)}</p>
        {reviewedAction === action.id ? <div className="alfred-confirm"><strong>Confirm this exact action for {appName(action.app_slug)}?</strong><div className="alfred-row"><button className="alfred-primary" disabled={Boolean(busy) || !data?.settings.enabled} onClick={async () => { await mutate("decide", { id: action.id, decision: "approve" }, "Action processed."); setReviewedAction(null); }}>{actionLabel(action)}</button><button disabled={Boolean(busy)} onClick={() => setReviewedAction(null)}>Cancel</button></div></div> : <div className="alfred-row"><button className="alfred-primary" disabled={Boolean(busy) || !data?.settings.enabled} onClick={() => setReviewedAction(action.id)}>Review & approve</button><button disabled={Boolean(busy)} onClick={() => void mutate("decide", { id: action.id, decision: "reject" }, "Proposal rejected.")}>Reject</button></div>}
      </article>)}
      {!!actions.filter(a => a.state !== "pending").length && <div className="alfred-card"><h3>Recent decisions</h3>{actions.filter(a => a.state !== "pending").map(a => <div className="alfred-decision" key={a.id}><span className={`alfred-status ${a.state}`}>{a.state.replaceAll("_", " ")}</span><div><strong>{a.title}</strong><p>{a.result?.message ?? (a.state === "executing" ? "Execution was claimed. If this remains unchanged, inspect the destination before retrying; no automatic resend occurs." : "No action was executed.")}</p></div></div>)}</div>}
    </section>}

    {tab === "activity" && <section><div className="alfred-section-head"><div><h3>Investigation history</h3><p className="alfred-muted">Latest 40 investigations in this scope. Each records evidence, outcome, usage, and proposals.</p></div><button onClick={() => setRevision(v => v + 1)}>Refresh</button></div>{!data?.runs.length && <div className="alfred-empty"><Icon name="clock" /><h3>No investigations yet</h3><p>Ask Alfred a question to start an auditable history.</p></div>}{data?.runs.map(run => <details className="alfred-history" key={run.id}><summary><span className={`alfred-status ${run.state}`}>{run.state}</span><strong>{run.question}</strong><small>{date(run.created_at)}</small></summary><RunResult run={run} /></details>)}</section>}

    {tab === "knowledge" && <div className="alfred-knowledge-layout"><section className="alfred-card"><h3>{knowledge ? "Edit knowledge" : "Teach Alfred your business"}</h3><p className="alfred-muted">Add approved support guidance, app facts, brand rules, or escalation instructions. Never enter passwords, API keys, bank details, or customer personal information.</p><label className="alfred-field">Application<select value={knowledgeApp} onChange={e => setKnowledgeApp(e.target.value)}><option value="">Company-wide knowledge</option>{apps.map(a => <option key={a.slug} value={a.slug}>{a.name}</option>)}</select></label><label className="alfred-field">Title<input maxLength={180} value={knowledgeTitle} onChange={e => setKnowledgeTitle(e.target.value)} /></label><label className="alfred-field">Approved guidance<textarea rows={10} maxLength={6000} value={knowledgeBody} onChange={e => setKnowledgeBody(e.target.value)} /></label><div className="alfred-row"><button className="alfred-primary" disabled={Boolean(busy) || !knowledgeTitle.trim() || !knowledgeBody.trim()} onClick={async () => { const saved = await mutate("knowledge", { id: knowledge?.id ?? null, version: knowledge?.version ?? null, appSlug: knowledgeApp || null, title: knowledgeTitle, body: knowledgeBody, enabled: true }, "Knowledge saved."); if (saved) { setKnowledge(null); setKnowledgeTitle(""); setKnowledgeBody(""); } }}>Save approved knowledge</button>{knowledge && <button onClick={() => { setKnowledge(null); setKnowledgeTitle(""); setKnowledgeBody(""); }}>Cancel edit</button>}</div></section><section><h3>Knowledge library</h3><p className="alfred-muted">Latest 100 entries in the selected scope. Investigations use up to 12 recent enabled entries, including applicable company guidance.</p>{!data?.knowledge.length && <div className="alfred-empty">No approved knowledge has been added yet.</div>}{data?.knowledge.map(k => <article className="alfred-card" key={k.id}><div className="alfred-row"><span className={`alfred-status ${k.enabled ? "completed" : "paused"}`}>{k.enabled ? "Enabled" : "Disabled"}</span><small>Version {k.version}</small></div><h4>{k.title}</h4><p className="alfred-muted">{appName(k.app_slug)}</p><p className="alfred-knowledge-excerpt">{k.body}</p><div className="alfred-row"><button onClick={() => editKnowledge(k)}>Edit</button><button disabled={Boolean(busy)} onClick={() => void mutate("knowledge", { id: k.id, version: k.version, appSlug: k.app_slug, title: k.title, body: k.body, enabled: !k.enabled }, "Knowledge updated.")}>{k.enabled ? "Disable" : "Enable"}</button></div></article>)}</section></div>}

    {tab === "controls" && <>
      {data && <Controls key={data.settings.version} data={data} busy={Boolean(busy)} save={(payload) => mutate("configure", payload, "Alfred controls saved.")} />}
      {preview && <div className="alfred-card"><h3>Owner controls</h3><p>Activation, data consent, daily/monthly spending limits, daily briefings, and emergency pause appear here after owner sign-in.</p></div>}
      <section className="alfred-card"><h3>Connection readiness</h3><p className="alfred-muted">Installed code is not the same as an authenticated, verified external service.</p>{data?.connections.map(connection => <div className="alfred-connection" key={connection.name}><div><strong>{connection.name}</strong><p>{connection.detail}</p></div><span className={`alfred-status ${connection.state === "available" ? "completed" : "pending"}`}>{connection.state.replaceAll("_", " ")}</span></div>)}</section>
    </>}
  </div>;
}
function Controls({ data, busy, save }: { data: AlfredDashboard; busy: boolean; save: (payload: Record<string, unknown>) => Promise<unknown> }) {
  const [enabled, setEnabled] = useState(data.settings.enabled);
  const [scheduled, setScheduled] = useState(data.settings.scheduled_enabled);
  const [consent, setConsent] = useState(Boolean(data.settings.consent_at));
  const [daily, setDaily] = useState((data.settings.daily_limit_cents / 100).toString());
  const [monthly, setMonthly] = useState((data.settings.monthly_limit_cents / 100).toString());
  const payload = { version: data.settings.version, enabled, consent, dailyCents: Math.round(Number(daily) * 100), monthlyCents: Math.round(Number(monthly) * 100), scheduled };
  return <section className="alfred-card"><div className="alfred-section-head"><div><h3>Operating controls</h3><p className="alfred-muted">Approval-required mode. No customer reply, publication, payment, or production change is automatic.</p></div><button className="alfred-stop" disabled={busy || !data.settings.enabled} onClick={() => void save({ version: data.settings.version, enabled: false, consent: false, dailyCents: data.settings.daily_limit_cents, monthlyCents: data.settings.monthly_limit_cents, scheduled: data.settings.scheduled_enabled })}>Pause Alfred</button></div>
    <div className="alfred-notice"><strong>Data-processing notice</strong><p>Activating Alfred allows the server to send bounded, redacted operational records and your requests through Vercel AI Gateway to the selected model provider. Redaction reduces exposure but cannot guarantee every personal detail is removed. Verify your customer notices, provider terms, and retention requirements before enabling.</p><p>Private household Finance records, credentials, attachments, and full customer profiles are excluded. Support text can still contain personal information. Evidence and outputs are retained in the private Hub until an owner-managed retention process is added.</p></div>
    <label className="alfred-checkbox"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />I authorize this processing for my company and have reviewed its privacy requirements.</label>
    <label className="alfred-checkbox"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Activate Alfred for owner-requested investigations and approved actions.</label>
    <label className="alfred-checkbox"><input type="checkbox" checked={scheduled} onChange={e => setScheduled(e.target.checked)} />Prepare a daily private company briefing at 13:00 UTC (7 a.m. CST / 8 a.m. CDT). No automatic execution.</label>
    <div className="alfred-budget"><label className="alfred-field">Daily model budget (USD)<input type="number" min="0.25" max="50" step="0.25" value={daily} onChange={e => setDaily(e.target.value)} /></label><label className="alfred-field">Monthly model budget (USD)<input type="number" min="0.25" max="500" step="0.25" value={monthly} onChange={e => setMonthly(e.target.value)} /></label></div>
    <p className="alfred-muted">Each investigation reserves $0.25 before contacting the model. A successful run releases the difference based on estimated token costs, rounded up to a cent. Failed or interrupted runs retain their allowance. This limits model requests; it is not a provider invoice or a cap on hosting/database costs. Two simultaneous investigations and ten starts per five minutes are allowed.</p>
    <div className="alfred-metrics"><div><span>Today’s used/reserved allowance</span><strong>{dollars(data.usage.dayCents)}</strong></div><div><span>This month’s allowance</span><strong>{dollars(data.usage.monthCents)}</strong></div><div><span>Estimated token cost</span><strong>${data.usage.monthEstimatedUsd.toFixed(4)}</strong></div></div>
    <p className="alfred-micro">{data.usage.period}. A pause blocks new generations and action starts; it cannot recall a message already submitted to a provider.</p><button className="alfred-primary" disabled={busy || (enabled && !consent)} onClick={() => void save(payload)}>Save controls</button>
  </section>;
}


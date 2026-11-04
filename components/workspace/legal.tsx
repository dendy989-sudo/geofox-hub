"use client";

import { useMemo, useState } from "react";
import { AppBadge, Card, Empty, ErrorBanner, Loading, Metric, Modal, PageHeading, apiRequest, count, date, label, money, useHubData, type PanelProps } from "../admin/common";
import { Icon } from "../admin/icons";
import { Attachments } from "./attachments";
import type { WorkspaceList, WorkspaceRecord } from "@/lib/workspace/types";
import { COMPLIANCE_SOURCES, LEGAL_SOURCE_CHECKED_AT, emptyLegalData, legalStarterRecords, localDay, nextLegalDate, readableLegalData, safeSourceUrl, starterRequestId, type LegalData, type LegalRecurrence } from "@/lib/workspace/legal-starters";
import { parseAmountCents } from "@/lib/workspace/accounting";
import "./finance-legal.css";

type LegalRecord = WorkspaceRecord<LegalData>;
type Editor = { record?: LegalRecord; title: string; appSlug: string; status: string; data: LegalData; amount: string; requestId: string };
type Completion = { record: LegalRecord; createNext: boolean; nextDate: string; requestId: string };
const LEGAL_STATUSES = ["open", "in_progress", "completed", "not_applicable", "archived"];
function isActive(record: LegalRecord) { return !["completed", "not_applicable", "archived"].includes(record.status); }
function targetDate(record: LegalRecord) { return record.data.dueDate || record.data.reviewDate; }
function scopeLabel(slug: string | null, apps: PanelProps["apps"]) { return slug ? apps.find((app) => app.slug === slug)?.name || slug : "Geofox company"; }
function statusName(status: string) { return status === "open" ? "To review" : label(status); }

export function LegalPanel({ preview, app, apps, refreshKey, notify, can, staffRole, workspaceAccess, view = "upcoming" }: PanelProps & { view?: string }) {
  const canWrite = !preview && can("legal:write");
  const companyWritable = preview || staffRole === "owner" || workspaceAccess?.legal.companyLevel === "write";
  const defaultScope = app !== "all" && app !== "company" ? app : companyWritable ? "company" : apps[0]?.slug || "";
  const source = useHubData<WorkspaceList<LegalData>>(preview ? null : `/api/workspace/records?module=legal&app=${encodeURIComponent(app)}&limit=1000`, refreshKey);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selected, setSelected] = useState<LegalRecord | null>(null);
  const [deleting, setDeleting] = useState<LegalRecord | null>(null);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [showStarters, setShowStarters] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const today = localDay();
  const records = useMemo(() => (source.data?.items || []).map((record) => ({ ...record, data: readableLegalData(record.data) })), [source.data]);
  const active = records.filter(isActive);
  const overdue = active.filter((record) => record.data.dueDate && record.data.dueDate < today);
  const monthAhead = new Date(`${today}T12:00:00Z`); monthAhead.setUTCDate(monthAhead.getUTCDate() + 30);
  const soon = active.filter((record) => record.data.dueDate && record.data.dueDate >= today && record.data.dueDate <= monthAhead.toISOString().slice(0, 10));
  const reviews = active.filter((record) => record.data.reviewDate && record.data.reviewDate <= today);
  const visible = records.filter((record) => {
    if (filter === "active" && !isActive(record)) return false;
    if (filter !== "all" && filter !== "active" && record.status !== filter) return false;
    return `${record.title} ${record.data.payee} ${record.data.jurisdiction} ${record.data.notes}`.toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => (targetDate(a) || "9999").localeCompare(targetDate(b) || "9999") || a.title.localeCompare(b.title));
  const starters = legalStarterRecords(app, apps.map((item) => item.slug), today).filter((starter) => (starter.appSlug || companyWritable) && !records.some((record) => record.appSlug === starter.appSlug && record.data.starterKey === starter.data.starterKey));
  const selectedSources = records.filter((record) => safeSourceUrl(record.data.sourceUrl));

  function beginEdit(record?: LegalRecord) {
    setError(""); setSelected(null);
    const data = record ? readableLegalData(record.data) : emptyLegalData();
    setEditor({ record, title: record?.title || "", appSlug: record ? record.appSlug || "company" : defaultScope, status: record?.status || "open", data, amount: data.amountCents === null ? "" : (data.amountCents / 100).toFixed(2), requestId: crypto.randomUUID() });
  }
  function changeData<K extends keyof LegalData>(key: K, value: LegalData[K]) { setEditor((current) => current ? { ...current, data: { ...current.data, [key]: value } } : current); }
  function beginCompletion(record: LegalRecord) {
    setError(""); setSelected(null);
    const next = nextLegalDate(record.data);
    setCompletion({ record, createNext: Boolean(next), nextDate: next || "", requestId: crypto.randomUUID() });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!editor || busy || uploading) return;
    if (!editor.appSlug || (editor.appSlug === "company" && !companyWritable)) { setError("Choose an app you can manage for this record."); return; }
    const amount = editor.amount.trim() === "" ? null : editor.amount.trim() === "0" || editor.amount.trim() === "0.00" ? 0 : parseAmountCents(editor.amount);
    if (editor.amount.trim() && amount === null) { setError("Enter an amount with at most two decimal places, or leave it blank until confirmed."); return; }
    if (editor.data.sourceUrl && !safeSourceUrl(editor.data.sourceUrl)) { setError("Enter a complete HTTPS source link without a username or password."); return; }
    setBusy(true); setError("");
    try {
      const body = { module: "legal", appSlug: editor.appSlug === "company" ? null : editor.appSlug, title: editor.title.trim(), status: editor.status, data: { ...editor.data, amountCents: amount, completedAt: editor.status === "completed" ? editor.data.completedAt || new Date().toISOString() : null }, ...(editor.record ? { version: editor.record.version } : { requestId: editor.requestId }) };
      await apiRequest(`/api/workspace/records${editor.record ? `/${editor.record.id}` : ""}`, { method: editor.record ? "PATCH" : "POST", body: JSON.stringify(body) });
      setEditor(null); source.reload(); notify(editor.record ? "Obligation updated." : "Obligation added.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save the obligation."); }
    finally { setBusy(false); }
  }
  async function complete() {
    if (!completion || busy) return;
    if (completion.createNext && (!completion.nextDate || completion.nextDate <= today)) { setError("Choose a future date for the next occurrence."); return; }
    setBusy(true); setError(""); let completed = false;
    try {
      const record = completion.record;
      await apiRequest(`/api/workspace/records/${record.id}`, { method: "PATCH", body: JSON.stringify({ version: record.version, status: "completed", data: { ...record.data, completedAt: new Date().toISOString() } }) });
      completed = true;
      if (completion.createNext) {
        const data = { ...record.data, completedAt: null, attachments: [], ...(record.data.dueDate ? { dueDate: completion.nextDate, reviewDate: null } : { dueDate: null, reviewDate: completion.nextDate }) };
        await apiRequest("/api/workspace/records", { method: "POST", body: JSON.stringify({ module: "legal", appSlug: record.appSlug, title: record.title, status: "open", data, requestId: completion.requestId }) });
      }
      setCompletion(null); source.reload(); notify(completion.createNext ? "Completed and the next occurrence is ready." : "Obligation marked complete.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to complete the obligation.";
      if (completed) { setCompletion(null); source.reload(); setError(`The current occurrence is completed, but its next occurrence could not be created. Add the next obligation using New obligation. ${message}`); }
      else setError(message);
    } finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting || busy) return; setBusy(true); setError("");
    try { await apiRequest(`/api/workspace/records/${deleting.id}`, { method: "DELETE", body: JSON.stringify({ version: deleting.version }) }); setDeleting(null); source.reload(); notify("Obligation deleted."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to delete this obligation."); }
    finally { setBusy(false); }
  }
  async function addStarters() {
    if (busy) return; setBusy(true); setError(""); let added = 0;
    try {
      for (const starter of starters) { await apiRequest("/api/workspace/records", { method: "POST", body: JSON.stringify({ ...starter, requestId: starterRequestId(starter.data.starterKey!, starter.appSlug) }) }); added++; }
      setShowStarters(false); source.reload(); notify(`${added} checklist ${added === 1 ? "item" : "items"} added for review.`);
    } catch (reason) { source.reload(); setError(`${added ? `${added} items were saved. ` : ""}${reason instanceof Error ? reason.message : "The checklist could not be completed."} Refresh to review saved items before retrying. If a starter was previously edited or deleted, use New obligation to create its replacement.`); }
    finally { setBusy(false); }
  }
  const actions = <div className="wf-actions"><button className="hub-button secondary" disabled={!canWrite || busy || source.loading || Boolean(source.error)} onClick={() => { setError(""); setShowStarters(true); }}><Icon name="book" size={15} />Starter checklist</button><button className="hub-button" disabled={!canWrite || !defaultScope || busy} onClick={() => beginEdit()}><Icon name="calendar" size={15} />New obligation</button></div>;

  return <div className="workspace-finance">
    <PageHeading kicker="Company workspace" title={view === "sources" ? "Sources & checklists" : view === "register" ? "Compliance register" : "Legal & compliance"} description="Keep deadlines, renewals, filing evidence, and app policy reviews in one place." />
    <div className="wf-toolbar"><p className="wf-help">{app === "all" ? "Across your company and accessible apps" : scopeLabel(app === "company" ? null : app, apps)}</p>{actions}</div>
    {preview && <div className="wf-compact-banner">This preview is empty. Sign in with Legal access to save and manage your obligations.</div>}
    {!preview && !canWrite && <p className="wf-help">You have view access to this workspace.</p>}
    {!editor && !deleting && !completion && !showStarters && <ErrorBanner error={error} />}
    <ErrorBanner error={source.error} />
    {source.data && source.data.total > records.length && <div className="hub-banner warning">This view contains {count(records.length)} of {count(source.data.total)} records. Select an app to narrow the view before reviewing totals.</div>}
    {view !== "sources" && <div className="hub-metrics-grid">
      <Metric title="Overdue" value={count(overdue.length)} detail="Open filing or payment dates" icon="alert" tone="orange" />
      <Metric title="Next 30 days" value={count(soon.length)} detail="Confirmed dates in your register" icon="calendar" tone="purple" />
      <Metric title="Review now" value={count(reviews.length)} detail="Internal check-ins due" icon="book" tone="cyan" />
      <Metric title="Completed" value={count(records.filter((record) => record.status === "completed").length)} detail="Saved completed occurrences" icon="check" tone="green" />
    </div>}
    {source.loading ? <Loading label="Loading your compliance register…" /> : view === "sources" ? <>
      <Card title="Official starting points" subtitle={`Sources checked ${date(LEGAL_SOURCE_CHECKED_AT, true)}. Confirm applicability and check current guidance before filing.`}><div className="hub-card-body wf-source-grid">{COMPLIANCE_SOURCES.map((item) => <article className="wf-source" key={item.key}><span className="wf-muted">{item.agency} · {item.scope === "company" ? "Company" : "App policy"}</span><h3>{item.title}</h3><p>{item.summary}</p><a className="wf-link" href={item.url} target="_blank" rel="noopener noreferrer">Read official guidance <Icon name="external" size={12} /></a></article>)}</div></Card>
      <Card title="Sources attached to your obligations" subtitle="Your own source links and filing references.">{selectedSources.length ? <ul className="wf-list">{selectedSources.map((record) => <li className="wf-list-item" key={record.id}><div className="wf-list-main"><button className="wf-list-title" onClick={() => setSelected(record)}>{record.title}</button><p className="wf-muted">{scopeLabel(record.appSlug, apps)}</p></div><a className="wf-link" href={safeSourceUrl(record.data.sourceUrl)} target="_blank" rel="noopener noreferrer">Source <Icon name="external" size={12} /></a></li>)}</ul> : <Empty icon="book" title="Build your source library" description="Add a source link to any obligation to keep the guidance beside the work." />}</Card>
    </> : <>
      <div className="hub-controls"><label className="hub-field wf-search"><span>Find an obligation</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, agency, jurisdiction…" /></label><label className="hub-field"><span>Status</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="active">Active obligations</option><option value="all">All statuses</option>{LEGAL_STATUSES.map((status) => <option key={status} value={status}>{statusName(status)}</option>)}</select></label></div>
      {view === "register" ? <Card title="Obligation register" subtitle="Use a filing due date for deadlines and a review date for your own check-ins.">
        {visible.length ? <div className="hub-table-scroll"><table className="hub-table"><thead><tr><th>Obligation</th><th>Company / app</th><th>Due / review</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visible.map((record) => <tr key={record.id}><td className="wf-table-title"><button className="wf-list-title" onClick={() => setSelected(record)}>{record.title}</button><span className="wf-table-note">{record.data.payee || record.data.jurisdiction || "Details to confirm"}</span></td><td>{record.appSlug ? <AppBadge slug={record.appSlug} apps={apps} /> : "Company"}</td><td>{record.data.dueDate ? date(record.data.dueDate, true) : "No filing date"}{record.data.reviewDate && <span className="wf-table-note">Review {date(record.data.reviewDate, true)}</span>}</td><td className="wf-amount">{record.data.amountCents === null ? "To confirm" : money(record.data.amountCents / 100)}</td><td><span className={`wf-status ${isActive(record) && record.data.dueDate && record.data.dueDate < today ? "overdue" : record.status}`}>{isActive(record) && record.data.dueDate && record.data.dueDate < today ? "Overdue" : statusName(record.status)}</span></td><td><div className="wf-table-actions"><button className="hub-table-action" onClick={() => setSelected(record)}>View</button>{canWrite && (record.appSlug || companyWritable) && <button className="hub-table-action" onClick={() => beginEdit(record)}>Edit</button>}</div></td></tr>)}</tbody></table></div> : <Empty icon="shield" title={query ? "No matching obligations" : "Your compliance register starts here"} description={query ? "Try another search or status filter." : "Add an obligation or review the starter checklist to record the filings, renewals, and policies that apply to you."} />}
        <div className="wf-table-footer"><span>{count(visible.length)} obligations</span><span>Amounts are recorded estimates or known dues; filing is handled with the linked agency.</span></div>
      </Card> : <div className="wf-two-column"><Card title="Next actions" subtitle="Filing dates and internal review dates, with the earliest items first.">
        {visible.length ? <ul className="wf-list">{visible.map((record) => { const next = targetDate(record); const due = next ? new Date(`${next}T12:00:00Z`) : null; return <li className="wf-list-item" key={record.id}><div className={`wf-date-badge ${isActive(record) && record.data.dueDate && record.data.dueDate < today ? "overdue" : ""}`}>{due ? <><span>{due.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</span><strong>{due.getUTCDate()}</strong></> : <Icon name="calendar" size={20} />}</div><div className="wf-list-main"><button className="wf-list-title" onClick={() => setSelected(record)}>{record.title}</button><div className="wf-meta"><span>{scopeLabel(record.appSlug, apps)}</span><span>·</span><span>{record.data.dueDate ? `Due ${date(record.data.dueDate, true)}` : record.data.reviewDate ? `Review ${date(record.data.reviewDate, true)}` : "Set a date"}</span><span className={`wf-status ${record.status}`}>{statusName(record.status)}</span></div>{record.data.condition && <p className="wf-inline-note">{record.data.condition}</p>}</div>{canWrite && (record.appSlug || companyWritable) && isActive(record) && <button className="hub-icon-button" aria-label={`Complete ${record.title}`} title="Mark complete" onClick={() => beginCompletion(record)}><Icon name="check" size={17} /></button>}</li>; })}</ul> : <Empty icon="calendar" title="A clear place for every deadline" description="Add filing dates, agent renewals, and app policy check-ins. The starter checklist gives you official sources to review." />}
      </Card><div className="wf-stack"><Card title="Stay ahead of the paperwork" subtitle="A lightweight routine for the company."><div className="hub-card-body"><div className="wf-report-row"><span>Filing and payment dates</span><strong>{count(active.filter((record) => record.data.dueDate).length)}</strong></div><div className="wf-report-row"><span>Awaiting a date</span><strong>{count(active.filter((record) => !targetDate(record)).length)}</strong></div><div className="wf-report-row"><span>Recurring obligations</span><strong>{count(active.filter((record) => record.data.recurrence !== "none").length)}</strong></div><p className="wf-inline-note">Complete an occurrence to keep its evidence and, when needed, create the next check-in. Confirm the next date against official guidance.</p></div></Card><div className="wf-compact-banner">Starter items need your review. They do not establish that every listed rule applies, submit filings, or automatically detect legal changes.</div></div></div>}
    </>}
    {editor && <Modal title={editor.record ? "Edit obligation" : "New obligation"} description="Record the action, its source, and the date you need to act." onClose={() => { if (!busy && !uploading) { setEditor(null); setError(""); } }}><form onSubmit={save}><ErrorBanner error={error} /><div className="wf-form-grid">
      <label className="hub-field wf-span"><span>Obligation title</span><input required maxLength={200} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} placeholder="e.g. Registered agent renewal" /></label>
      <label className="hub-field"><span>Company / app</span><select value={editor.appSlug} disabled={busy || uploading || editor.data.attachments.length > 0} onChange={(event) => setEditor({ ...editor, appSlug: event.target.value })}>{companyWritable && <option value="company">Geofox company</option>}{apps.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select>{editor.data.attachments.length > 0 && <small>Remove attachments before changing their company or app.</small>}</label>
      <label className="hub-field"><span>Status</span><select value={editor.status} onChange={(event) => setEditor({ ...editor, status: event.target.value })}>{LEGAL_STATUSES.map((status) => <option key={status} value={status}>{statusName(status)}</option>)}</select></label>
      <label className="hub-field"><span>Filing / payment due date</span><input type="date" value={editor.data.dueDate || ""} onChange={(event) => changeData("dueDate", event.target.value || null)} /></label>
      <label className="hub-field"><span>Internal review date</span><input type="date" value={editor.data.reviewDate || ""} onChange={(event) => changeData("reviewDate", event.target.value || null)} /></label>
      <label className="hub-field"><span>Recurrence</span><select value={editor.data.recurrence} onChange={(event) => changeData("recurrence", event.target.value as LegalRecurrence)}>{["none", "monthly", "quarterly", "annual", "continuous"].map((item) => <option key={item} value={item}>{label(item)}</option>)}</select><small>Next dates are confirmed when completing an occurrence.</small></label>
      <label className="hub-field"><span>Amount due (USD)</span><input inputMode="decimal" value={editor.amount} onChange={(event) => setEditor({ ...editor, amount: event.target.value })} placeholder="Leave blank until confirmed" /></label>
      <label className="hub-field"><span>Agency / payee</span><input maxLength={200} value={editor.data.payee} onChange={(event) => changeData("payee", event.target.value)} /></label>
      <label className="hub-field"><span>Jurisdiction</span><input maxLength={200} value={editor.data.jurisdiction} onChange={(event) => changeData("jurisdiction", event.target.value)} placeholder="e.g. Texas, United States" /></label>
      <label className="hub-field"><span>Category</span><select value={editor.data.category} onChange={(event) => changeData("category", event.target.value)}>{["company", "tax", "app_policy", "license", "contract", "insurance", "other"].map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label>
      <label className="hub-field"><span>Official source / reference URL</span><input type="url" maxLength={2000} value={editor.data.sourceUrl} onChange={(event) => changeData("sourceUrl", event.target.value)} placeholder="https://" /></label>
      <label className="hub-field wf-span"><span>Applicability / details to confirm</span><input maxLength={1500} value={editor.data.condition} onChange={(event) => changeData("condition", event.target.value)} placeholder="Who this applies to, exemptions, or facts to confirm" /></label>
      <label className="hub-field wf-span"><span>Notes and filing instructions</span><textarea maxLength={10000} value={editor.data.notes} onChange={(event) => changeData("notes", event.target.value)} /></label>
      <div className="wf-span"><Attachments module="legal" appSlug={editor.appSlug === "company" ? null : editor.appSlug} value={editor.data.attachments} onChange={(value) => changeData("attachments", value)} disabled={busy} onBusyChange={setUploading} /></div>
    </div><div className="wf-actions" style={{ justifyContent: "flex-end", marginTop: 20 }}><button type="button" className="hub-button secondary" disabled={busy || uploading} onClick={() => { setEditor(null); setError(""); }}>Cancel</button><button className="hub-button" disabled={busy || uploading}>{uploading ? "Uploading…" : busy ? "Saving…" : "Save obligation"}</button></div></form></Modal>}
    {selected && <Modal title={selected.title} description={scopeLabel(selected.appSlug, apps)} onClose={() => setSelected(null)} actions={<>{canWrite && (selected.appSlug || companyWritable) && <><button className="hub-button danger" onClick={() => { setSelected(null); setDeleting(selected); setError(""); }}>Delete</button><button className="hub-button secondary" onClick={() => beginEdit(selected)}>Edit</button>{isActive(selected) && <button className="hub-button" onClick={() => beginCompletion(selected)}>Mark complete</button>}</>}</>}><dl className="wf-detail"><div><dt>Status</dt><dd>{statusName(selected.status)}</dd></div><div><dt>Recurrence</dt><dd>{label(selected.data.recurrence)}</dd></div><div><dt>Due date</dt><dd>{selected.data.dueDate ? date(selected.data.dueDate, true) : "To confirm"}</dd></div><div><dt>Review date</dt><dd>{selected.data.reviewDate ? date(selected.data.reviewDate, true) : "Not set"}</dd></div><div><dt>Amount</dt><dd>{selected.data.amountCents === null ? "To confirm" : money(selected.data.amountCents / 100)}</dd></div><div><dt>Agency / payee</dt><dd>{selected.data.payee || "Not set"}</dd></div><div><dt>Jurisdiction</dt><dd>{selected.data.jurisdiction || "Not set"}</dd></div><div><dt>Category</dt><dd>{label(selected.data.category)}</dd></div>{selected.data.condition && <div className="wf-span"><dt>Applicability</dt><dd>{selected.data.condition}</dd></div>}{selected.data.notes && <div className="wf-span"><dt>Notes</dt><dd>{selected.data.notes}</dd></div>}{safeSourceUrl(selected.data.sourceUrl) && <div className="wf-span"><dt>Reference</dt><dd><a className="wf-link" href={safeSourceUrl(selected.data.sourceUrl)} target="_blank" rel="noopener noreferrer">Read source <Icon name="external" size={13} /></a>{selected.data.sourceCheckedAt && <p className="wf-inline-note">Starter source checked {date(selected.data.sourceCheckedAt, true)}; open the source for current guidance.</p>}</dd></div>}{selected.data.completedAt && <div><dt>Completed</dt><dd>{date(selected.data.completedAt)}</dd></div>}</dl><Attachments module="legal" appSlug={selected.appSlug} value={selected.data.attachments} onChange={() => {}} viewOnly /><p className="wf-inline-note">Last updated {date(selected.updatedAt)}</p></Modal>}
    {deleting && <Modal title="Delete obligation?" description={deleting.title} onClose={() => { if (!busy) { setDeleting(null); setError(""); } }} actions={<><button className="hub-button secondary" disabled={busy} onClick={() => { setDeleting(null); setError(""); }}>Keep obligation</button><button className="hub-button danger" disabled={busy} onClick={remove}>{busy ? "Deleting…" : "Delete obligation"}</button></>}><ErrorBanner error={error} /><p className="wf-help">This removes the obligation from your register. To keep the history, mark it completed or not applicable instead.</p></Modal>}
    {completion && <Modal title="Complete this occurrence" description={completion.record.title} onClose={() => { if (!busy) { setCompletion(null); setError(""); } }} actions={<><button className="hub-button secondary" disabled={busy} onClick={() => { setCompletion(null); setError(""); }}>Cancel</button><button className="hub-button" disabled={busy} onClick={complete}>{busy ? "Saving…" : "Mark complete"}</button></>}><ErrorBanner error={error} /><p className="wf-help">The completed occurrence and its evidence remain in your register.</p><label className="wf-checkbox"><input type="checkbox" checked={completion.createNext} onChange={(event) => setCompletion({ ...completion, createNext: event.target.checked })} />Create a new occurrence for the next deadline or review</label>{completion.createNext && <label className="hub-field"><span>{completion.record.data.dueDate ? "Next filing / payment due date" : "Next internal review date"}</span><input type="date" value={completion.nextDate} onChange={(event) => setCompletion({ ...completion, nextDate: event.target.value })} /><small>Confirm this date against the current official schedule, including weekends, holidays, and extensions.</small></label>}</Modal>}
    {showStarters && <Modal title="Add a starter checklist" description="Official starting points for a Texas single-member LLC and the apps in your current scope." onClose={() => { if (!busy) { setShowStarters(false); setError(""); } }} actions={<><button className="hub-button secondary" disabled={busy} onClick={() => { setShowStarters(false); setError(""); }}>Cancel</button><button className="hub-button" disabled={busy || !starters.length} onClick={addStarters}>{busy ? "Adding…" : `Add ${starters.length} items for review`}</button></>}><ErrorBanner error={error} /><div className="wf-compact-banner">Confirm your October 2026 formation, tax classification, actual locations, and product practices. These are review prompts with sources, not a determination of every obligation. Unknown amounts stay blank.</div>{starters.length ? <ul className="wf-list" style={{ padding: 0 }}>{starters.map((item) => <li className="wf-list-item" key={`${item.appSlug}-${item.data.starterKey}`}><div><strong className="wf-list-title">{item.title}</strong><p className="wf-muted">{scopeLabel(item.appSlug, apps)} · {item.data.dueDate ? `Expected due ${date(item.data.dueDate, true)}` : "Review applicability and set dates"}</p></div></li>)}</ul> : <p className="wf-help" style={{ marginTop: 15 }}>All starter checklist items for this scope are already in your register.</p>}</Modal>}
  </div>;
}

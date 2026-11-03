"use client";

import { useState, type FormEvent } from "react";
import type { ListResult, ModerationItem } from "@/lib/hub/types";
import { apiRequest, AppBadge, Card, date, Empty, ErrorBanner, label, listNotes, Loading, Modal, Notes, PageHeading, type PanelProps, Pill, useHubData } from "./common";
import { Icon } from "./icons";

const actions = [
  { value: "review", label: "Mark reviewing", detail: "Mark this report as being reviewed by staff." },
  { value: "dismiss", label: "Resolve / dismiss report", detail: "Close the report without changing the reported content or account." },
  { value: "remove_content", label: "Hide reported content", detail: "Hide the reported content through the app’s supported moderation action." },
  { value: "restore_content", label: "Restore reported content", detail: "Restore content that was previously hidden." },
  { value: "suspend_user", label: "Restrict social access", detail: "Restricts social sharing; sign-in and subscriptions remain available. Review the subject ID carefully." },
  { value: "restore_user", label: "Restore social access", detail: "Remove an existing restriction on the reported customer’s social features." },
] as const;
type ModerationAction = typeof actions[number]["value"];

function ReportDialog({ item, props, onClose, onSaved }: { item: ModerationItem; props: PanelProps; onClose: () => void; onSaved: () => void }) {
  const [action, setAction] = useState<ModerationAction>("review");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const writable = props.can("moderation:write") && !props.preview;
  const actionDescription = actions.find((item) => item.value === action)!;
  const highImpact = action === "remove_content" || action === "suspend_user";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!writable || busy || reason.trim().length < 10) return;
    setBusy(true); setError("");
    try {
      await apiRequest(`/api/admin/moderation/${encodeURIComponent(item.id)}`, { method: "POST", body: JSON.stringify({ app: item.appSlug, action, reason: reason.trim(), version: item.version }) });
      props.notify("Moderation decision saved and recorded in the audit history."); onSaved(); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to apply this decision. Refresh the report and try again."); }
    finally { setBusy(false); }
  }
  return <Modal title="Review moderation report" description="Read the report, check the context, and record a deliberate decision." onClose={() => { if (!busy) onClose(); }} actions={<><button className="hub-button secondary" disabled={busy} onClick={onClose}>Cancel</button><button form="moderation-decision" type="submit" className={`hub-button ${highImpact ? "danger" : ""}`} disabled={!writable || busy || reason.trim().length < 10}>{busy ? "Saving decision…" : "Confirm decision"}</button></>}><ErrorBanner error={error} /><div className="hub-detail-meta" style={{ marginTop: 0, marginBottom: 15 }}><AppBadge slug={item.appSlug} apps={props.apps} /><Pill status={item.status} /><span className="hub-row-sub">{label(item.type)}</span></div><div className="hub-modal-summary"><strong>{item.summary || "Reported item"}</strong><br />Report reason: {item.reason || "Not provided"}<br />Reported: {date(item.reportedAt)}{item.subjectUserId ? <><br />Subject: <span className="hub-mono">{item.subjectUserId}</span></> : null}</div>{item.content ? <><p className="hub-text-note">Reported content · provided by the app</p><pre className="hub-error-code">{item.content}</pre></> : <p className="hub-text-note">The app did not return content for this report. Confirm the context before taking an action that changes content or social access.</p>}<form id="moderation-decision" onSubmit={submit}><div className="hub-field"><label htmlFor="moderation-action">Decision</label><select id="moderation-action" value={action} disabled={!writable || busy} onChange={(event) => setAction(event.target.value as ModerationAction)}>{actions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>{actionDescription.detail}</small></div><div className="hub-field"><label htmlFor="moderation-reason">Reason for your decision</label><textarea id="moderation-reason" required minLength={10} maxLength={1000} value={reason} disabled={!writable || busy} onChange={(event) => setReason(event.target.value)} placeholder="Explain the evidence you reviewed and why this action is appropriate." /><small>At least 10 characters. This explanation is retained in the staff audit history.</small></div></form>{!writable ? <p className="hub-text-note">Your role can review reports. A moderator or administrator must apply decisions.</p> : null}{highImpact ? <div className="hub-banner warning" style={{ marginBottom: 0 }}><Icon name="alert" size={17} /><div><strong>This changes the customer’s app experience</strong><p>Confirm that the selected app, report, and affected account are correct before applying your decision.</p></div></div> : null}</Modal>;
}

export function ModerationPanel(props: PanelProps) {
  const [status, setStatus] = useState("unresolved");
  const list = useHubData<ListResult<ModerationItem>>(props.preview ? null : `/api/admin/moderation?app=${encodeURIComponent(props.app)}&status=${encodeURIComponent(status)}`, props.refreshKey);
  const [selected, setSelected] = useState<ModerationItem | null>(null);
  const statuses = ["unresolved", "open", "reviewing", "resolved", "all"];
  const items = list.data?.items || [];
  return <><PageHeading kicker="THOUGHTFUL, ACCOUNTABLE REVIEW" title="A safer space for your community." description="Review reports from each app, understand the context, and keep a record of every decision." /><ErrorBanner error={list.error} /><div className="hub-controls"><select className="hub-select" aria-label="Filter moderation by status" value={status} onChange={(event) => setStatus(event.target.value)}>{statuses.map((value) => <option value={value} key={value}>{value === "all" ? "All report statuses" : value === "unresolved" ? "Unresolved reports" : label(value)}</option>)}</select><span className="hub-text-note">Every report keeps its app label, including in the all-app view.</span></div><Card title="Moderation queue" subtitle="Reports, flagged content, and the app’s supported review actions" action={<Icon name="shield" size={17} />}>{list.loading ? <Loading /> : items.length ? <div className="hub-table-scroll"><table className="hub-table"><thead><tr><th>Report</th><th>App</th><th>Type</th><th>Status</th><th>Reported</th><th><span className="hub-sr-only">Review</span></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><span className="hub-row-title">{item.summary || "Moderation report"}</span><span className="hub-row-sub">{item.reason || "Reason unavailable"}</span></td><td><AppBadge slug={item.appSlug} apps={props.apps} /></td><td>{label(item.type)}</td><td><Pill status={item.status} /></td><td className="hub-no-wrap">{date(item.reportedAt, true)}</td><td><button className="hub-table-action" onClick={() => setSelected(item)}>Review<span className="hub-sr-only"> report {item.id}</span></button></td></tr>)}</tbody></table></div> : <Empty icon="shield" title={props.preview ? "Your review queue is ready" : "No reports match this view"} description={listNotes(list.data, props.preview, "moderation reports")} />}</Card><Notes notes={list.data?.notes} /><div className="hub-guidance"><strong>Decisions stay human</strong>Reports are shown for staff review. No content is removed and no social access is restricted automatically from this dashboard. Each submitted decision includes your reason and is checked against the current report version.</div>{selected ? <ReportDialog item={selected} props={props} onClose={() => setSelected(null)} onSaved={list.reload} /> : null}</>;
}

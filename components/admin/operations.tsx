"use client";

import { useState } from "react";
import type { ConnectionInfo, OperationsData, ReviewTask } from "@/lib/hub/types";
import { apiRequest, AppBadge, Card, date, Empty, ErrorBanner, Loading, PageHeading, type PanelProps, Pill, useHubData } from "./common";
import { Icon } from "./icons";
import { ServiceGrid } from "./overview";

export function Integrations({ integrations }: { integrations: ConnectionInfo[] }) {
  return <>{integrations.map((integration) => <div className="hub-integration" key={integration.id}><span className="hub-integration-icon"><Icon name={integration.id.includes("mail") ? "send" : integration.id.includes("vercel") ? "globe" : "layers"} size={18} /></span><div className="hub-integration-content"><strong>{integration.name}{integration.required ? " · Required" : ""}</strong><p>{integration.description}</p></div><Pill status={integration.state === "connected" ? "configured" : integration.state === "error" ? "error" : "unknown"}>{integration.state === "connected" ? "Configured" : integration.state === "error" ? "Needs attention" : "Not connected"}</Pill></div>)}</>;
}

const suggestedTasks: ReviewTask[] = [
  { id: "preview-daily-health", label: "Check service health and new errors", description: "Look for failed checks, critical errors, and unusual activity.", cadence: "daily", completedAt: null, completedBy: null },
  { id: "preview-daily-support", label: "Review tickets and moderation", description: "Prioritize urgent requests and reports that need a decision.", cadence: "daily", completedAt: null, completedBy: null },
  { id: "preview-daily-usage", label: "Review usage and quota reservations", description: "Check recorded ISBNdb activity, search usage, and provider limits.", cadence: "daily", completedAt: null, completedBy: null },
  { id: "preview-weekly-billing", label: "Review billing and account trends", description: "Compare verified access with the payment records actually available.", cadence: "weekly", completedAt: null, completedBy: null },
  { id: "preview-weekly-access", label: "Review staff access and audit history", description: "Check that every staff member has the right app scope and role.", cadence: "weekly", completedAt: null, completedBy: null },
  { id: "preview-weekly-provider", label: "Check provider usage and backups", description: "Review Vercel and Supabase limits, costs, and backup configuration.", cadence: "weekly", completedAt: null, completedBy: null },
];

export function OperationsPanel(props: PanelProps) {
  const operations = useHubData<OperationsData>(props.preview ? null : `/api/admin/operations?app=${encodeURIComponent(props.app)}`, props.refreshKey);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const tasks = props.preview ? suggestedTasks : operations.data?.checks || [];
  const writable = !props.preview && props.staffRole !== "analyst";
  async function toggle(task: ReviewTask) {
    if (!writable || busy) return;
    setBusy(task.id); setError("");
    try { await apiRequest(`/api/admin/operations?app=${encodeURIComponent(props.app)}`, { method: "POST", body: JSON.stringify({ id: task.id, completed: !task.completedAt }) }); props.notify(task.completedAt ? "Review task marked incomplete." : "Review task completed."); operations.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save this review."); }
    finally { setBusy(null); }
  }
  return <><PageHeading kicker="A CALMER WAY TO RUN YOUR APPS" title="Your daily operating rhythm." description="Check what matters, record your review, and keep your services and team in view." /><ErrorBanner error={error || operations.error} />{operations.loading ? <Loading /> : <><div className="hub-review-grid">{(["daily", "weekly"] as const).map((cadence) => <Card key={cadence} title={cadence === "daily" ? "Your daily review" : "Your weekly review"} subtitle={props.preview ? "Suggested routine · preview only" : "Reviews apply to selected apps · reset on the UTC calendar"} action={<Icon name={cadence === "daily" ? "checklist" : "calendar"} size={17} />}><div className="hub-card-body">{tasks.filter((task) => task.cadence === cadence).length ? tasks.filter((task) => task.cadence === cadence).map((task) => <label className={`hub-check-row ${task.completedAt ? "done" : ""}`} key={task.id}><input type="checkbox" checked={Boolean(task.completedAt)} disabled={!writable || Boolean(busy)} onChange={() => toggle(task)} /><div><strong>{task.label}</strong><span>{task.description}</span>{task.completedAt ? <span style={{ display: "block", marginTop: 4 }}>Reviewed {date(task.completedAt)}</span> : null}</div></label>) : <Empty icon="checklist" title="No review tasks returned" description="Your review routine appears after the hub is configured." />}</div></Card>)}</div><Card className="hub-standalone-card" title="Service checks" subtitle="Only a successful measured check is shown as operational">{operations.data?.services.length ? <ServiceGrid services={operations.data.services} apps={props.apps} onChecked={operations.reload} /> : <Empty icon="pulse" title="Service status is not verified yet" description="Connect the app’s monitoring sources to begin receiving health checks." />}</Card><div className="hub-settings-grid"><Card title="Connected sources" subtitle="Configuration status, separate from operational health" action={<button className="hub-section-link" onClick={() => props.navigate("settings")}>Manage <Icon name="arrow" size={13} /></button>}><div className="hub-card-body">{operations.data?.integrations.length ? <Integrations integrations={operations.data.integrations} /> : <Empty icon="layers" title="Source configuration is unavailable" description="Use Connections & team to review what remains to be connected." />}</div></Card><Card title="Staff activity" subtitle="A record of actions in the hub">{operations.data?.audit.length ? <div className="hub-timeline">{operations.data.audit.slice(0, 30).map((event) => <div className="hub-timeline-item" key={event.id}><strong>{event.title}</strong><p>{event.detail}</p>{event.appSlug ? <div style={{ marginBottom: 4 }}><AppBadge slug={event.appSlug} apps={props.apps} /></div> : null}<time dateTime={event.createdAt}>{date(event.createdAt)}</time></div>)}</div> : <Empty icon="clock" title="No staff activity returned" description="Supported actions are recorded with their time, actor, and context." />}</Card></div><div className="hub-guidance"><strong>Provider details still have their own source of truth</strong>This hub shows the data your connected services provide. Review provider costs, backup readiness, deployment history, and rate limits in their consoles until those sources are connected here.<div className="hub-controls" style={{ marginTop: 13, marginBottom: 0 }}><a className="hub-button secondary small" href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">Vercel console <Icon name="external" size={12} /></a><a className="hub-button secondary small" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Supabase console <Icon name="external" size={12} /></a></div></div></>}</>;
}

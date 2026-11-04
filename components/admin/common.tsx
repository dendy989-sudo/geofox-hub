"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiEnvelope, HealthState, HubApp, ListResult, StaffRole } from "@/lib/hub/types";
import type { WorkspaceAccess } from "@/lib/workspace/types";
import { Icon, type IconName } from "./icons";

export async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  let result: ApiEnvelope<T>;
  try { result = await response.json() as ApiEnvelope<T>; }
  catch { throw new Error("The server did not return a usable response. Please try again."); }
  if (!response.ok || result.error) {
    if (response.status === 401) throw new Error("Your session has ended. Sign in again to continue.");
    throw new Error(result.error || `The request could not be completed (${response.status}).`);
  }
  if (!("data" in result)) throw new Error("This data source is not ready yet.");
  return result.data as T;
}

export function useHubData<T>(url: string | null, refreshKey = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(url));
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError("");
    if (!url) { setLoading(false); return; }
    setLoading(true);
    apiRequest<T>(url, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load this section."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, refreshKey, revision]);
  return { data, error, loading, reload: () => setRevision((value) => value + 1) };
}

export function count(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("en-US").format(value) : "—";
}

export function money(value: number | null | undefined, currency = "USD") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${value.toFixed(2)} ${currency}`; }
}

export function date(value: string | null | undefined, compact = false) {
  if (!value || Number.isNaN(Date.parse(value))) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: compact ? "short" : "medium",
    ...(compact ? {} : { timeStyle: "short" as const }),
    timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? "UTC" : "America/Chicago",
  }).format(new Date(value));
}

export function label(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()) : "Not available";
}

export function appName(slug: string, apps: HubApp[]) {
  return apps.find((app) => app.slug === slug)?.name || label(slug);
}

export function AppBadge({ slug, apps }: { slug: string; apps: HubApp[] }) {
  const app = apps.find((item) => item.slug === slug);
  const accent = app?.color && /^#[0-9a-f]{6}$/i.test(app.color) ? app.color : "#8b5cf6";
  return <span className="hub-app-badge" style={{ backgroundColor: `${accent}10`, borderColor: `${accent}35` }}><span className="hub-app-color" style={{ backgroundColor: accent }} />{appName(slug, apps)}</span>;
}

export function Pill({ status, children }: { status: string; children?: React.ReactNode }) {
  return <span className={`hub-pill ${status.replace(/[^a-z_]/gi, "")}`}>{children || label(status)}</span>;
}

export function Empty({ icon = "layers", title, description }: { icon?: IconName; title: string; description?: string }) {
  return <div className="hub-empty"><span className="hub-empty-icon"><Icon name={icon} /></span><strong>{title}</strong>{description ? <p>{description}</p> : null}</div>;
}

export function Loading({ label: text = "Loading the latest information…" }: { label?: string }) {
  return <div className="hub-loading" role="status"><Icon name="refresh" size={16} />{text}</div>;
}

export function ErrorBanner({ error }: { error: string }) {
  return error ? <div className="hub-banner error" role="alert"><Icon name="alert" size={19} /><div><strong>We couldn’t complete that request</strong><p>{error}</p></div></div> : null;
}

export function Notes({ notes }: { notes?: string[] }) {
  if (!notes?.length) return null;
  return <div className="hub-banner warning"><Icon name="info" size={18} /><div><strong>About this data</strong>{notes.map((note, index) => <p key={`${index}-${note}`}>{note}</p>)}</div></div>;
}

export function Metric({ title, value, detail, icon, tone = "purple" }: { title: string; value: string; detail: string; icon: IconName; tone?: string }) {
  return <article className={`hub-metric ${tone}`}><div className="hub-metric-top"><span>{title}</span><span className="hub-metric-icon"><Icon name={icon} size={18} /></span></div><div className="hub-metric-value">{value}</div><div className="hub-metric-sub"><span />{detail}</div></article>;
}

export function Card({ title, subtitle, action, children, className = "" }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`hub-card ${className}`}><header className="hub-card-head"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>{action}</header>{children}</section>;
}

export function PageHeading({ kicker, title, description }: { kicker: string; title: string; description: string }) {
  return <header className="hub-page-heading"><div><p className="hub-kicker">{kicker}</p><h1>{title}</h1><p>{description}</p></div><div className="hub-date-chip"><Icon name="calendar" size={14} />{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" }).format(new Date())}</div></header>;
}

export function healthLabel(status: HealthState) {
  return { healthy: "Operational", degraded: "Needs attention", down: "Service issue", unknown: "Not verified" }[status] || "Not verified";
}

export function Modal({ title, description, children, actions, onClose, wide = false }: { title: string; description?: string; children: React.ReactNode; actions?: React.ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={`hub-modal${wide ? " hub-modal-wide" : ""}`} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-labelledby="hub-modal-title"><header className="hub-modal-head"><div><h2 id="hub-modal-title">{title}</h2>{description ? <p>{description}</p> : null}</div><button className="hub-icon-button" type="button" aria-label="Close dialog" onClick={onClose}><Icon name="close" size={17} /></button></header><div className="hub-modal-body">{children}</div>{actions ? <div className="hub-modal-actions">{actions}</div> : null}</dialog>;
}

export function listNotes<T>(data: ListResult<T> | null, preview: boolean, noun: string) {
  return preview ? `This preview contains no ${noun} or customer data. Connect your sources to see live records.` : data ? `There are no ${noun} matching this view.` : `This source has not returned ${noun} yet. Check Connections for setup details.`;
}

export function Pagination({ offset, limit, total, loaded, disabled, onPage }: { offset: number; limit: number; total: number; loaded: number; disabled?: boolean; onPage: (offset: number) => void }) {
  if (total <= limit && offset === 0) return null;
  return <div className="hub-pagination"><span>{total ? `${count(offset + 1)}–${count(offset + loaded)} of ${count(total)}` : "No matching records"}</span><div><button type="button" className="hub-button secondary small" disabled={disabled || offset === 0} onClick={() => onPage(Math.max(0, offset - limit))}>Previous</button><button type="button" className="hub-button secondary small" disabled={disabled || offset + limit >= total || offset >= 10000} onClick={() => onPage(offset + limit)}>Next</button></div></div>;
}

export interface PanelProps { preview: boolean; app: string; apps: HubApp[]; refreshKey: number; staffRole?: StaffRole; workspaceAccess?: WorkspaceAccess; notify: (message: string) => void; can: (capability: string) => boolean; navigate: (tab: string) => void; }

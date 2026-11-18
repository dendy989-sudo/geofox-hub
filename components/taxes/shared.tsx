"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/admin/icons";
import type { TaxRecord, TaxSnapshot } from "@/lib/taxes/types";
import { parseAmountCents } from "@/lib/taxes/model";

export const statusLabels: Record<string, string> = {
  unknown: "Not checked yet", not_filed: "Not filed", gathering: "In progress", ready_to_file: "Ready for review",
  filed: "Filed", needs_amendment: "Amendment review", amendment_in_progress: "Preparing amendment", amended: "Amended",
  married_joint: "Married filing jointly", married_separate: "Married filing separately", single: "Single",
  head_of_household: "Head of household", qualifying_surviving_spouse: "Qualifying surviving spouse",
  unresolved: "Needs a decision", business: "Business", personal: "Personal", mixed: "Business + personal", transfer: "Account transfer",
  loan: "Loan principal", owner_contribution: "Owner contribution", owner_draw: "Owner draw", tax_payment: "Tax payment",
  tax_refund: "Tax refund", relief: "Relief / PPP", excluded: "Excluded", confirmed: "Reviewed", needs_review: "Needs review",
  opening_balance: "Opening IRS balance", assessment: "Tax assessed", penalty: "Penalty", interest: "Interest",
  payment: "Payment to IRS", credit: "Credit applied", abatement: "Charge reduced / abatement", refund: "Refund issued",
  stimulus: "Stimulus / economic impact payment", advance_child_tax_credit: "Advance child tax credit", ppp_received: "PPP loan received",
  ppp_forgiven: "PPP forgiveness", other_relief: "Other relief", note: "Record / note",
};
export const human = (value: unknown) => typeof value === "string" ? statusLabels[value] || value.replaceAll("_", " ") : "—";
export const str = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
export const num = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
export const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export const dateLabel = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value.slice(0, 10) + "T12:00:00Z")) : "—";
export const byKind = (snapshot: TaxSnapshot, kind: TaxRecord["kind"]) => snapshot.records.filter(r => r.kind === kind && !r.archived);
export const decimal = (cents: unknown) => typeof cents === "number" ? (cents / 100).toFixed(2) : "";
export function cents(value: string, signed = true): number {
  const amount = parseAmountCents(value); if (!signed && amount < 0) throw new Error("Enter a positive amount."); return amount;
}
export async function taxRequest<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), credentials: "same-origin", cache: "no-store" });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Your request could not be completed. Please try again.");
  return result?.data as T;
}
export function Status({ value }: { value: unknown }) { return <span className={`tx-status ${str(value, "unknown")}`}>{human(value)}</span>; }
export function Field({ label, help, children, wide = false }: { label: string; help?: string; children: ReactNode; wide?: boolean }) {
  return <label className={`tx-field${wide ? " wide" : ""}`}><span>{label}</span>{children}{help ? <small>{help}</small> : null}</label>;
}
export function Empty({ title, children, action, icon = "layers" }: { title: string; children: ReactNode; action?: ReactNode; icon?: IconName }) {
  return <div className="tx-empty"><span className="tx-empty-icon"><Icon name={icon} size={25} /></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function Panel({ title, subtitle, action, children, className = "" }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`tx-panel ${className}`}>{title ? <div className="tx-panel-heading"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>{action}</div> : null}{children}</section>;
}
export function TaxDialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => { const el = ref.current; el?.showModal(); const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { el?.close(); document.body.style.overflow = previous; }; }, []);
  return <dialog ref={ref} className="tx-dialog" aria-labelledby={id} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><div className="tx-dialog-heading"><h2 id={id}>{title}</h2><button type="button" className="tx-icon-button" aria-label="Close editor" disabled={busy} onClick={onClose}><Icon name="close" size={18} /></button></div>{children}</dialog>;
}
export function downloadText(name: string, text: string, type = "text/plain") { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function csvText(rows: unknown[][]): string { return rows.map(row => row.map(cell => { let text = String(cell ?? ""); if (/^[=+@\t\r]/.test(text) || /^-(?!\d)/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; }).join(",")).join("\r\n"); }

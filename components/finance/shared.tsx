"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/admin/icons";

export function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
export function formatDate(date: string) {
  if (!date) return "—";
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}
export function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
}
export function Money({ cents, colored = false }: { cents: number; colored?: boolean }) {
  return <span className={`fn-money ${colored ? cents < 0 ? "fn-negative" : "fn-positive" : ""}`}>{formatMoney(cents)}</span>;
}
export function FinanceDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog?.close(); document.body.style.overflow = oldOverflow; };
  }, []);
  return <dialog className="fn-dialog" ref={ref} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}><div className="fn-dialog-head"><h2 id={titleId}>{title}</h2><button className="fn-icon-button" aria-label="Close dialog" type="button" onClick={onClose}><Icon name="close" size={18} /></button></div><div className="fn-dialog-body">{children}</div></dialog>;
}
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="fn-empty"><span className="fn-empty-icon"><Icon name="wallet" size={26} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function Progress({ value, label }: { value: number; label?: string }) {
  const percent = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  return <div className="fn-progress-wrap">{label ? <div className="fn-progress-label"><span>{label}</span><strong>{Math.round(percent)}%</strong></div> : null}<div className="fn-progress" role="progressbar" aria-label={label || "Payment progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><span style={{ width: `${percent}%` }} /></div></div>;
}
export function Metric({ title, cents, detail, icon = "wallet", tone = "purple", onClick }: { title: string; cents: number; detail: string; icon?: IconName; tone?: string; onClick?: () => void }) {
  const content = <><div className="fn-metric-top"><span>{title}</span><span className={`fn-metric-icon ${tone}`}><Icon name={icon} size={18} /></span></div><strong className={`fn-metric-value ${cents < 0 ? "fn-negative" : ""}`}><Money cents={cents} /></strong><span className="fn-metric-detail">{detail}</span></>;
  return onClick ? <button type="button" className="fn-metric" onClick={onClick}>{content}</button> : <div className="fn-metric">{content}</div>;
}
export interface ChartPoint { date: string; ending_cents: number }
export function BalanceChart({ points, baseline, label = "Projected ending balance" }: { points: ChartPoint[]; baseline?: ChartPoint[]; label?: string }) {
  const id = useId().replaceAll(":", "");
  const all = [...points, ...(baseline || [])].map(point => point.ending_cents);
  if (!all.length) return null;
  const low = Math.min(0, ...all), high = Math.max(100, ...all), range = high - low || 100;
  const width = 720, height = 205, left = 72, right = 16, top = 17, bottom = 32;
  const x = (i: number) => left + i * (width - left - right) / Math.max(points.length - 1, 1);
  const y = (value: number) => top + (high - value) * (height - top - bottom) / range;
  const line = (values: ChartPoint[]) => values.map((point, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(point.ending_cents).toFixed(2)}`).join(" ");
  const last = points.length - 1;
  return <div className="fn-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title`}><title id={`${id}-title`}>{`${label}. Starting at ${formatMoney(points[0].ending_cents)} and ending at ${formatMoney(points[last].ending_cents)}.`}</title><defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8c78e1" stopOpacity=".19" /><stop offset="100%" stopColor="#8c78e1" stopOpacity="0" /></linearGradient></defs>{[0, .5, 1].map(fraction => {
    const value = low + range * fraction;
    return <g key={fraction}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="#e9edf5" strokeDasharray="4 5" /><text x={left - 10} y={y(value) + 4} textAnchor="end" fill="#8791a7" fontSize="10">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value / 100)}</text></g>;
  })}<path d={`${line(points)} L${x(last)},${height - bottom} L${x(0)},${height - bottom} Z`} fill={`url(#${id}-fill)`} />{low < 0 ? <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} stroke="#dc8c98" strokeDasharray="4 4" /> : null}{baseline ? <path d={line(baseline)} fill="none" stroke="#aab4ca" strokeWidth="2" strokeDasharray="5 5" /> : null}<path d={line(points)} fill="none" stroke="#7963cf" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />{[0, Math.floor(last / 2), last].map(i => <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fill="#8791a7" fontSize="10">{points[i].date.slice(8)}</text>)}</svg><div className="fn-chart-caption"><span><i className="fn-legend-dot" />{label}</span>{baseline ? <span><i className="fn-legend-dot gray" />Saved bill & income forecast</span> : null}</div></div>;
}

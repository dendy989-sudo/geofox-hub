"use client";

import { Icon } from "@/components/admin/icons";
import { dailyLedger, debtSummary, monthSummary, planProgress, shiftMonth } from "@/lib/finance/calculations";
import type { RecordsProps } from "@/lib/finance/types";
import { BalanceChart, Metric, Money, monthLabel, Progress } from "./shared";

function csvCell(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ReportsPanel({ data, month, today }: RecordsProps) {
  const summary = monthSummary(data, month, today), debts = debtSummary(data, today);
  const ledger = dailyLedger(data, month);
  const history = [-5, -4, -3, -2, -1, 0].map(offset => { const key = shiftMonth(month, offset); return { month: key, summary: monthSummary(data, key, today) }; });
  const maxMovement = Math.max(1, ...history.flatMap(item => [item.summary.received_income_cents, item.summary.paid_bills_cents]));
  const bills = data.entries.filter(entry => entry.kind === "bill" && entry.original_due_date.startsWith(month));
  const groups = [...new Set(bills.map(entry => entry.category))].map(category => ({ category, total: bills.filter(entry => entry.category === category).reduce((sum, entry) => sum + entry.original_amount_cents, 0) })).sort((a, b) => b.total - a.total);
  function exportCsv() {
    const rows: unknown[][] = [["Date", "Income forecast USD", "Bill cash flow USD", "Net USD", "Projected ending balance USD"]];
    for (const day of ledger) rows.push([day.date, day.income_cents / 100, day.bills_cents / 100, day.net_cents / 100, day.ending_cents / 100]);
    download(rows.map(row => row.map(csvCell).join(",")).join("\r\n"), `geofox-finance-${month}.csv`, "text/csv;charset=utf-8");
  }
  return <div className="fn-stack"><div className="fn-actions end"><button className="fn-button" onClick={exportCsv}><Icon name="download" size={15} />Export month CSV</button><button className="fn-button" onClick={() => download(JSON.stringify({ schema_version: 2, exported_at: new Date().toISOString(), ...data }, null, 2), `geofox-finance-backup-${today}.json`, "application/json")}><Icon name="download" size={15} />Export all records</button></div>
    <div className="fn-metrics" style={{ marginBottom: 0 }}><Metric title="Income received" cents={summary.received_income_cents} detail="Actual receipts you recorded this month" icon="coins" tone="green" /><Metric title="Bills paid" cents={summary.paid_bills_cents} detail="Actual payments you recorded this month" icon="check" tone="cyan" /><Metric title="Recorded net movement" cents={summary.received_income_cents - summary.paid_bills_cents} detail="Received income minus recorded bill payments" icon="chart" /><Metric title="Tracked credit & collections" cents={debts.balance_cents} detail="Balances tracked outside ordinary bill schedules" icon="shield" tone="amber" /></div>
    <section className="fn-panel"><div className="fn-panel-head"><div><h2>Cash-flow outlook</h2><p>Saved income and bill schedule. Live Money spending and unsaved scenarios are excluded.</p></div></div><div className="fn-panel-body"><BalanceChart points={ledger} /></div></section>
    <div className="fn-equal-col"><section className="fn-panel"><div className="fn-panel-head"><div><h2>Received & paid · six months</h2><p>Based on recorded dates, rather than expected dates.</p></div></div><div className="fn-panel-body">{history.map(item => <div key={item.month} style={{ marginBottom: 19 }}><div className="fn-row" style={{ marginBottom: 7 }}><span className="fn-muted">{monthLabel(item.month)}</span><span style={{ display: "flex", gap: 10, fontSize: 10 }}><span className="fn-positive"><Money cents={item.summary.received_income_cents} /></span><span className="fn-muted"><Money cents={item.summary.paid_bills_cents} /></span></span></div><div className="fn-bar-track" style={{ marginBottom: 4 }}><span style={{ background: "#68b59e", width: `${item.summary.received_income_cents / maxMovement * 100}%`, minWidth: 0 }} /></div><div className="fn-bar-track"><span style={{ width: `${item.summary.paid_bills_cents / maxMovement * 100}%`, minWidth: 0 }} /></div></div>)}<div className="fn-chart-caption"><span><i className="fn-legend-dot" style={{ background: "#68b59e" }} />Income received</span><span><i className="fn-legend-dot" />Bills paid</span></div></div></section>
      <section className="fn-panel"><div className="fn-panel-head"><div><h2>Monthly commitments by category</h2><p>Original amounts due in {monthLabel(month)}.</p></div></div><div className="fn-panel-body">{groups.length ? groups.map(group => <div className="fn-bar-row" key={group.category}><span>{group.category}</span><span className="fn-bar-track"><span style={{ width: `${summary.original_bills_cents ? group.total / summary.original_bills_cents * 100 : 0}%` }} /></span><Money cents={group.total} /></div>) : <p className="fn-muted">Add bills to see your category breakdown here.</p>}<hr className="fn-divider" /><ul className="fn-list"><li><span className="fn-muted">Original monthly obligations</span><Money cents={summary.original_bills_cents} /></li><li><span className="fn-muted">Original amounts cancelled</span><Money cents={summary.original_cancelled_cents} /></li><li><span className="fn-muted">Original amounts sent to collections</span><Money cents={summary.original_collections_cents} /></li><li><span className="fn-muted">Remaining payments moved out</span><Money cents={summary.moved_out_cents} /></li><li><span className="fn-muted">Remaining payments moved in</span><Money cents={summary.moved_in_cents} /></li></ul></div></section></div>
    <section className="fn-panel"><div className="fn-panel-head"><div><h2>Payment plan progress</h2><p>Based on entered totals and recorded payments; no estimated interest is added.</p></div></div><div className="fn-panel-body">{data.plans.length ? <div className="fn-equal-col">{data.plans.map(plan => { const progress = planProgress(plan, data); return <div key={plan.id}><div className="fn-row" style={{ marginBottom: 11 }}><span className="fn-list-title">{plan.title} <span className="fn-badge">{plan.status === "collections" ? "Transferred to collections" : plan.status === "cancelled" ? "Cancelled plan" : progress.remaining_cents === 0 ? "Paid" : "Active"}</span></span><span className="fn-muted"><Money cents={progress.remaining_cents} /> remaining</span></div><Progress value={progress.percent} label={`${plan.title} paid`} /></div>; })}</div> : <p className="fn-muted">Payment plans and installments will appear here as you add them.</p>}</div></section>
    <p className="fn-muted">Reports reflect the amounts and dates you enter. Settlement offers show potential savings. Update the debt record when its balance changes; payment plans are tracked separately.</p>
  </div>;
}

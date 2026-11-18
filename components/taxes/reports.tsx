"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/admin/icons";
import { buildTaxReport } from "@/lib/taxes/model";
import type { TaxData, TaxSave, TaxSnapshot } from "@/lib/taxes/types";
import { INVENTORY_FIELDS, inventoryWorksheet, itemizedOtherExpenses } from "@/lib/taxes/schedule-worksheet";
import { ScheduleSupporting } from "./schedule-details";
import { Empty, Panel, byKind, csvText, dateLabel, downloadText, human, money, num, str } from "./shared";

export function TaxReports({ snapshot, onSave, onAdjustment }: { snapshot: TaxSnapshot; onSave: (record: TaxSave) => Promise<void>; onAdjustment: (initial?: TaxData) => void }) {
  const businesses = byKind(snapshot, "business");
  const [businessId, setBusinessId] = useState("");
  const [view, setView] = useState<"profit" | "schedule" | "records">("profit");
  const activeId = businesses.some(b => b.id === businessId) ? businessId : businesses.length === 1 ? businesses[0].id : "";
  const report = useMemo(() => buildTaxReport(snapshot.records, snapshot.year, activeId || null), [snapshot.records, snapshot.year, activeId]);
  const business = businesses.find(b => b.id === activeId);
  const yearRecord = snapshot.records.find(r => r.kind === "year" && r.tax_year === snapshot.year);
  const yearlyTreatment = (yearRecord?.data.business_treatments as Record<string, string> | undefined)?.[activeId] || business?.data.reporting_treatment || "needs_review";
  const records = snapshot.records.filter(r => r.tax_year === snapshot.year && !r.archived);
  const transactions = records.filter(r => r.kind === "transaction" && (!activeId || r.data.business_id === activeId || r.data.scope === "unresolved"));
  const line = (category: string, mode: "book" | "tax" = "tax") => { const l = report.lines.find(l => l.category === category); return l ? mode === "book" ? l.book_cents : l.deductible_cents : 0; };
  const receipts = line("gross_receipts"), returns = line("returns_allowances"), cogs = line("cost_of_goods"), otherIncome = line("other_income");
  const grossProfit = receipts - returns - cogs, grossIncome = grossProfit + otherIncome;
  const expenseLines = report.lines.filter(l => !["gross_receipts", "returns_allowances", "other_income", "cost_of_goods", "home_office"].includes(l.category));
  const formExpenseLines = Array.from(expenseLines.reduce((groups, item) => { const key = item.line || item.category, existing = groups.get(key); if (existing) { existing.deductible_cents += item.deductible_cents; existing.label = `${existing.label}; ${item.label.toLowerCase()}`; } else groups.set(key, { ...item }); return groups; }, new Map<string, typeof expenseLines[number]>()).values());
  const expenses = expenseLines.reduce((sum, l) => sum + l.deductible_cents, 0);
  const home = line("home_office");
  const generated = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const stem = `geofox-taxes-${snapshot.year}`;
  function ledgerExport() {
    downloadText(`${stem}-transactions.csv`, csvText([
      ["Record ID", "Date", "Vendor", "Original description", "Amount USD", "Account", "Scope", "Business", "Business %", "Category", "Reviewed", "Deduction %", "Deduction reviewed", "Statement ID", "Source", "Business purpose / notes"],
      ...transactions.map(r => [r.id, r.data.date, r.data.vendor, r.data.description, (num(r.data.amount_cents) / 100).toFixed(2), snapshot.records.find(a => a.id === r.data.account_id)?.title, human(r.data.scope), snapshot.records.find(b => b.id === r.data.business_id)?.title, r.data.business_percent, r.data.category, r.data.review_status, r.data.deduction_percent, r.data.deduction_confirmed, r.data.statement_id, r.data.source, r.data.notes]),
    ]), "text/csv;charset=utf-8");
  }
  function reportExport() {
    const details = (yearRecord?.data.schedule_c_details as Record<string, TaxData> | undefined)?.[activeId] || {};
    const inventory = inventoryWorksheet(details);
    const supportingRows: unknown[][] = activeId ? [
      [], ["Supporting worksheet", business?.title, snapshot.year],
      ["Reporting treatment", human(yearlyTreatment)], ["Business code", business?.data.business_code], ["Accounting method", business?.data.accounting_method],
      ...INVENTORY_FIELDS.map(([key, label]) => [label, typeof details[key] === "number" ? (Number(details[key]) / 100).toFixed(2) : "Not recorded"]),
      ["42 · Calculated COGS (not automatically added to line 4)", inventory.costOfGoods === null ? "Not recorded" : (inventory.costOfGoods / 100).toFixed(2)],
      ...Object.entries(details).filter(([key]) => !key.endsWith("_cents")).map(([key, value]) => [human(key), value === null ? "Not recorded" : typeof value === "boolean" ? value ? "Yes" : "No" : value]),
      [], ["Part V · Other expenses", "Date", "Amount USD", "Purpose / evidence"],
      ...itemizedOtherExpenses(snapshot.records, snapshot.year, activeId).map(row => [row.label, row.date, (row.cents / 100).toFixed(2), row.purpose]),
    ] : [];
    downloadText(`${stem}-report.csv`, csvText([
      ["Tax year", snapshot.year, "Business", business?.title || "All businesses"],
      ["DRAFT WORKSHEET", "Based only on reviewed records. Not a filed return."],
      ["Category", "Form line", "Book USD", "Confirmed tax USD"],
      ...report.lines.map(l => [l.label, l.line, (l.book_cents / 100).toFixed(2), (l.deductible_cents / 100).toFixed(2)]),
      ["Net income", "", (report.profit_cents / 100).toFixed(2), (report.draft_profit_cents / 100).toFixed(2)],
      ["Unresolved records", report.pending_count], ["Unconfirmed expense deductions", report.unreviewed_deductions_count],
      ["IRS form", report.sourceUrl], ...report.warnings.map(w => ["Review note", w]),
      ...supportingRows,
    ]), "text/csv;charset=utf-8");
  }
  function evidenceExport() {
    const link = document.createElement("a"); link.href = `/api/taxes/export?year=${snapshot.year}`; link.download = `${stem}-recordkeeping.json`; link.click();
  }
  return <div className="tx-stack"><div className="tx-toolbar no-print"><div className="tx-segmented" aria-label="Report type">{([["profit", "Profit & loss"], ["schedule", "Schedule C"], ["records", "Recordkeeping"]] as const).map(([id, label]) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}>{label}</button>)}</div><label className="tx-inline-field">Business<select className="tx-input" value={activeId} onChange={e => setBusinessId(e.target.value)}><option value="">All businesses</option>{businesses.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}</select></label><button className="tx-button" onClick={() => onAdjustment(activeId ? { business_id: activeId } : undefined)}><Icon name="plus" size={15} />Add adjustment</button><button className="tx-button" onClick={() => window.print()}><Icon name="printer" size={15} />Print / save PDF</button></div>
    {report.warnings.length ? <div className="tx-notice"><strong>Still to review</strong><ul>{report.warnings.map(w => <li key={w}>{w}</li>)}</ul></div> : null}
    {!report.record_count ? <div className="tx-notice">No reviewed business records are included yet. A zero below means no amount has been recorded and approved for this report; it does not confirm a complete tax year.</div> : null}
    {view === "profit" ? <Panel className="tx-report"><div className="tx-report-title"><span className="tx-eyebrow">GEOFOX TAXES · {snapshot.year}</span><h2>Profit & loss</h2><p>{business?.title || "All recorded businesses"} · January 1 – December 31, {snapshot.year}</p><span className="tx-status gathering">Working report</span></div><table className="tx-report-table"><thead><tr><th>Business activity</th><th>Recorded amount</th></tr></thead><tbody>
      <tr className="section"><th colSpan={2}>Income</th></tr>{report.lines.filter(l => ["gross_receipts", "returns_allowances", "other_income"].includes(l.category)).map(l => <tr key={l.category}><td>{l.label}</td><td>{l.category === "returns_allowances" ? "− " : ""}{money(l.book_cents)}</td></tr>)}<tr className="subtotal"><th>Net revenue</th><td>{money(report.income_cents)}</td></tr>
      <tr className="section"><th colSpan={2}>Cost of goods & operating expenses</th></tr>{report.lines.filter(l => !["gross_receipts", "returns_allowances", "other_income"].includes(l.category) && l.book_cents !== 0).map(l => <tr key={l.category}><td>{l.label}</td><td>{money(l.book_cents)}</td></tr>)}<tr className="subtotal"><th>Total recorded expenses</th><td>{money(report.expenses_cents)}</td></tr><tr className="total"><th>Net profit / (loss)</th><td>{money(report.profit_cents)}</td></tr>
    </tbody></table><div className="tx-report-foot"><p>Includes {report.record_count} reviewed records. {report.pending_count} unresolved items are excluded. Bookkeeping amounts may differ from tax deductions.</p><p>Generated {generated} Central Time · USD</p></div></Panel> : null}
    {view === "schedule" ? !activeId ? <Panel><Empty title="Choose one business" icon="book">Select a business above to see its draft Schedule C worksheet. Each business needs its own review.</Empty></Panel> : <Panel className="tx-report"><div className="tx-report-title"><span className="tx-eyebrow">{snapshot.year} · FORM 1040 SUPPORTING WORKSHEET</span><h2>Schedule C · draft</h2><p>{business?.title} · Profit or loss from business</p><span className="tx-status needs_review">Review before filing</span></div><dl className="tx-report-details"><div><dt>Filing status</dt><dd>{human(yearRecord?.data.filing_status || "unknown")}</dd></div><div><dt>Business structure</dt><dd>{human(business?.data.structure || "unknown")}</dd></div><div><dt>Reporting treatment</dt><dd>{human(yearlyTreatment)}</dd></div></dl><table className="tx-report-table"><thead><tr><th>Line</th><th>Part I · Income</th><th>Confirmed amount</th></tr></thead><tbody>
      {([["1", "Gross receipts or sales", receipts], ["2", "Returns and allowances", returns], ["3", "Subtract line 2 from line 1", receipts - returns], ["4", "Cost of goods sold — separate inventory calculation", cogs], ["5", "Gross profit", grossProfit], ["6", "Other business income", otherIncome], ["7", "Gross income", grossIncome]] as [string, string, number][]).map(([n, label, amount]) => <tr key={n} className={n === "7" ? "subtotal" : ""}><td className="tx-line-number">{n}</td><td>{label}</td><td>{money(amount)}</td></tr>)}
      <tr className="section"><th colSpan={3}>Part II · Expenses</th></tr>{formExpenseLines.map(l => <tr key={l.category}><td className="tx-line-number">{l.line || "Review"}</td><td>{l.label}</td><td>{money(l.deductible_cents)}</td></tr>)}
      <tr className="subtotal"><td className="tx-line-number">28</td><th>Total expenses before business use of home</th><td>{money(expenses)}</td></tr><tr><td className="tx-line-number">29</td><td>Tentative profit / (loss)</td><td>{money(grossIncome - expenses)}</td></tr><tr><td className="tx-line-number">30</td><td>Business use of home — separate calculation</td><td>{money(home)}</td></tr><tr className="total"><td className="tx-line-number">31</td><th>Draft net profit / (loss)</th><td>{money(grossIncome - expenses - home)}</td></tr>
    </tbody></table>{business ? <ScheduleSupporting snapshot={snapshot} business={business} yearRecord={yearRecord} recordedCogs={cogs} onSave={onSave} onAdjustment={onAdjustment} /> : null}<div className="tx-report-foot"><p>This worksheet uses confirmed classifications and deduction amounts. It does not calculate self-employment tax, personal credits, depreciation elections, vehicle deduction methods, home-office or loss limits, or the household's final tax due.</p><p>Keep the supporting evidence with this report. Add reviewed adjustments only for amounts not counted elsewhere.</p><a href={report.sourceUrl} target="_blank" rel="noreferrer">Open the IRS Schedule C for {snapshot.year} <Icon name="external" size={12} /></a><p>Generated {generated} Central Time · {report.record_count} reviewed records · USD</p></div></Panel> : null}
    {view === "records" ? <><div className="tx-export-grid"><Panel title="Transaction ledger" subtitle="All entries in this year and business view, with review state, classifications and statement links."><button className="tx-button" onClick={ledgerExport}><Icon name="download" size={15} />Download CSV</button></Panel><Panel title="Profit & loss + tax categories" subtitle="Book totals and confirmed deduction totals alongside year-specific form lines."><button className="tx-button" onClick={reportExport}><Icon name="download" size={15} />Download report CSV</button></Panel><Panel title="Recordkeeping package" subtitle="Year records, reusable rules, source-document index and available change history in one portable JSON file."><button className="tx-button" onClick={evidenceExport}><Icon name="download" size={15} />Download records</button></Panel></div><Panel title="Source-document index" subtitle="Original statements remain in private storage. Open Statements to download each file.">{records.some(r => r.kind === "statement") ? <div className="tx-table-wrap"><table className="tx-table"><thead><tr><th>Document</th><th>Status</th><th>Added</th><th>File fingerprint</th></tr></thead><tbody>{records.filter(r => r.kind === "statement").map(r => <tr key={r.id}><td>{r.title}</td><td>{human(r.data.status || r.data.state)}</td><td>{dateLabel(r.created_at)}</td><td className="tx-fingerprint">{str(r.data.sha256 || r.data.file_hash || r.data.checksum, "Available after extraction")}</td></tr>)}</tbody></table></div> : <Empty title="Your evidence index will grow here">Upload the first statement to start building a traceable record for this year.</Empty>}</Panel></> : null}
    {view !== "records" ? <div className="tx-actions no-print"><button className="tx-button" onClick={reportExport}><Icon name="download" size={15} />Export report CSV</button><button className="tx-button" onClick={ledgerExport}><Icon name="download" size={15} />Export supporting ledger</button></div> : null}
  </div>;
}

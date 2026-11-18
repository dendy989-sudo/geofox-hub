"use client";

import { useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/admin/icons";
import { INVENTORY_FIELDS, inventoryWorksheet, itemizedOtherExpenses } from "@/lib/taxes/schedule-worksheet";
import { scheduleLine } from "@/lib/taxes/model";
import type { TaxData, TaxRecord, TaxSave, TaxSnapshot } from "@/lib/taxes/types";
import { Field, TaxDialog, cents, dateLabel, decimal, human, money, str } from "./shared";

const yesNo = (value: unknown) => value === true ? "Yes" : value === false ? "No" : "Not recorded";
const amountLabel = (value: number | null) => value === null ? "Not recorded" : money(value);
const flagFields = [
  ["materially_participated", "G · Materially participated in this business?"],
  ["started_business_this_year", "H · Started or acquired this business this year?"],
  ["payments_require_1099", "I · Made payments requiring Forms 1099?"],
  ["forms_1099_filed", "J · Required Forms 1099 filed or to be filed?"],
  ["vehicle_personal_use_available", "45 · Vehicle available for personal use off duty?"],
  ["other_vehicle_available", "46 · Another vehicle available to you or your spouse for personal use?"],
  ["vehicle_evidence", "47a · Evidence supports the vehicle deduction?"],
  ["vehicle_evidence_written", "47b · Is that evidence written?"],
] as const;

export function ScheduleSupporting({ snapshot, business, yearRecord, recordedCogs, onSave, onAdjustment }: { snapshot: TaxSnapshot; business: TaxRecord; yearRecord?: TaxRecord; recordedCogs: number; onSave: (record: TaxSave) => Promise<void>; onAdjustment: (initial?: TaxData) => void }) {
  const [editing, setEditing] = useState(false);
  const details = (yearRecord?.data.schedule_c_details as Record<string, TaxData> | undefined)?.[business.id] || {};
  const inventory = inventoryWorksheet(details);
  const otherExpenses = itemizedOtherExpenses(snapshot.records, snapshot.year, business.id);
  const otherTotal = otherExpenses.reduce((sum, row) => sum + row.cents, 0);
  const hasCogs = snapshot.records.some(record => !record.archived && record.tax_year === snapshot.year && ["transaction", "adjustment"].includes(record.kind) && record.data.business_id === business.id && record.data.category === "cost_of_goods");
  const mileage = (key: string) => typeof details[key] === "number" ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(details[key])) : "Not recorded";
  return <>
    <div className="tx-support-heading"><div><h3>Supporting business details</h3><p>Saved separately for {business.title} in {snapshot.year}.</p></div><button className="tx-button no-print" onClick={() => setEditing(true)}><Icon name="edit" size={14} />Edit supporting worksheet</button></div>
    <dl className="tx-report-details"><div><dt>Business code</dt><dd>{str(business.data.business_code, "Not recorded") || "Not recorded"}</dd></div><div><dt>Accounting method</dt><dd>{human(business.data.accounting_method || "unknown")}</dd></div>{flagFields.slice(0, 4).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{yesNo(details[key])}</dd></div>)}<div><dt>32 · Investment at risk, if a loss</dt><dd>{details.loss_at_risk === "all_at_risk" ? "All investment at risk" : details.loss_at_risk === "some_not_at_risk" ? "Some investment not at risk — review Form 6198" : "Not recorded"}</dd></div></dl>
    <table className="tx-report-table"><thead><tr><th>Line</th><th>Part III · Cost of goods sold</th><th>Worksheet amount</th></tr></thead><tbody>
      <tr><td>33</td><td>Inventory valuation method</td><td>{details.inventory_method && details.inventory_method !== "unknown" ? human(details.inventory_method) : "Not recorded"}</td></tr><tr><td>34</td><td>Changed how inventory quantities, costs or values were determined?</td><td>{yesNo(details.inventory_changed)}</td></tr>
      {([["35", "Opening inventory", inventory.opening], ["36", "Purchases less personal withdrawals", inventory.netPurchases], ["37", "Inventory labor, excluding your own pay", inventory.labor], ["38", "Inventory materials and supplies", inventory.materials], ["39", "Other inventory costs", inventory.other], ["40", "Costs available — lines 35 through 39", inventory.available], ["41", "Closing inventory", inventory.closing], ["42", "Calculated cost of goods sold", inventory.costOfGoods]] as [string, string, number | null][]).map(([line, label, value]) => <tr key={line} className={line === "42" ? "subtotal" : ""}><td className="tx-line-number">{line}</td><td>{label}</td><td>{amountLabel(value)}</td></tr>)}
    </tbody></table>
    <div className="tx-report-foot"><p>Blank inputs stay unknown. Enter a verified zero where no amount applies. This worksheet does not automatically change line 4 or your books. Recorded and confirmed line 4 currently equals {money(recordedCogs)}.</p>{inventory.issue ? <p className="tx-notice error">{inventory.issue}</p> : inventory.costOfGoods !== null && inventory.costOfGoods !== recordedCogs ? <p className="tx-notice">The calculated inventory total and recorded line 4 differ by {money(inventory.costOfGoods - recordedCogs)}. Review existing COGS entries before changing the report.</p> : null}
      {inventory.costOfGoods !== null && inventory.costOfGoods > 0 && !inventory.issue && !hasCogs ? <button className="tx-button no-print" onClick={() => onAdjustment({ business_id: business.id, scope: "business", category: "cost_of_goods", business_percent: 100, amount_cents: -inventory.costOfGoods!, deduction_percent: 100, deduction_confirmed: false, review_status: "needs_review", source_reference: `${snapshot.year} Schedule C inventory worksheet, line 42`, notes: "Review this inventory calculation and confirm these costs are not already included in another transaction or expense category." })}>Prepare a COGS adjustment for review</button> : hasCogs ? <p>COGS entries already exist. Edit or reconcile those entries before adding another amount.</p> : null}
    </div>
    <table className="tx-report-table"><thead><tr><th>Line</th><th>Part IV · Vehicle information</th><th>Recorded answer</th></tr></thead><tbody>
      <tr><td>43</td><td>Placed in business service</td><td>{details.vehicle_service_date ? dateLabel(details.vehicle_service_date) : "Not recorded"}</td></tr>{([["44a", "Business miles", "business_miles"], ["44b", "Commuting miles", "commuting_miles"], ["44c", "Other miles", "other_miles"]] as const).map(([line, label, key]) => <tr key={key}><td>{line}</td><td>{label}</td><td>{mileage(key)}</td></tr>)}{flagFields.slice(4).map(([key, label]) => { const [line, ...words] = label.split(" · "); return <tr key={key}><td>{line}</td><td>{words.join(" · ")}</td><td>{yesNo(details[key])}</td></tr>; })}
    </tbody></table><div className="tx-report-foot"><p>These records support a vehicle review; they do not choose a mileage method or calculate a deduction. Keep mileage logs and additional vehicle worksheets with your evidence. Check whether Form 4562 is required before using Part IV.</p></div>
    <table className="tx-report-table"><thead><tr><th>Date</th><th>Part V · Itemized other expenses</th><th>Confirmed amount</th></tr></thead><tbody>{otherExpenses.length ? otherExpenses.map(row => <tr key={row.id}><td>{dateLabel(row.date)}</td><td>{row.label}{row.purpose ? <small className="tx-other-purpose">{row.purpose}</small> : null}</td><td>{money(row.cents)}</td></tr>) : <tr><td colSpan={3}>No confirmed other expenses recorded.</td></tr>}<tr className="subtotal"><td>48</td><th>Other expenses carried to line {scheduleLine("other_expenses", snapshot.year)}</th><td>{money(otherTotal)}</td></tr></tbody></table>
    {details.notes ? <div className="tx-report-foot"><h3>Supporting explanations</h3><p className="tx-record-notes">{str(details.notes)}</p></div> : null}
    {editing ? <ScheduleDetailsEditor key={`${snapshot.year}-${business.id}`} business={business} year={snapshot.year} yearRecord={yearRecord} onSave={onSave} onClose={() => setEditing(false)} /> : null}
  </>;
}

function ScheduleDetailsEditor({ business, year, yearRecord, onSave, onClose }: { business: TaxRecord; year: number; yearRecord?: TaxRecord; onSave: (record: TaxSave) => Promise<void>; onClose: () => void }) {
  const prior = (yearRecord?.data.schedule_c_details as Record<string, TaxData> | undefined)?.[business.id] || {};
  const [values, setValues] = useState<TaxData>({ ...prior });
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(INVENTORY_FIELDS.map(([key]) => [key, decimal(prior[key])])));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""); const lock = useRef(false);
  const put = (key: string, value: unknown) => setValues(old => ({ ...old, [key]: value }));
  const flag = (key: string, label: string) => <Field key={key} label={label}><select className="tx-input" value={typeof values[key] === "boolean" ? String(values[key]) : "unknown"} onChange={event => put(key, event.target.value === "unknown" ? null : event.target.value === "true")}><option value="unknown">Not recorded</option><option value="true">Yes</option><option value="false">No</option></select></Field>;
  async function save(event: FormEvent) {
    event.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      const details: TaxData = { ...values, vehicle_service_date: str(values.vehicle_service_date) || null };
      for (const [key] of INVENTORY_FIELDS) details[key] = amounts[key].trim() === "" ? null : cents(amounts[key], false);
      await onSave({ ...(yearRecord ? { id: yearRecord.id, version: yearRecord.version } : {}), kind: "year", tax_year: year, title: String(year), data: { ...(yearRecord?.data || {}), schedule_c_details: { ...(yearRecord?.data.schedule_c_details as Record<string, TaxData> || {}), [business.id]: details } } });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the supporting worksheet."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <TaxDialog title={`${year} · ${business.title} · supporting worksheet`} busy={busy} onClose={onClose}><form className="tx-editor" onSubmit={save}><p className="tx-muted">Record what you know. Leave unanswered fields blank. These inputs support the report and do not automatically approve deductions.</p><div className="tx-form-grid"><h3 className="wide">Business questions</h3>{flagFields.slice(0, 4).map(([key, label]) => flag(key, label))}<Field label="32 · Investment at risk, if reporting a loss" wide><select className="tx-input" value={str(values.loss_at_risk, "unknown")} onChange={event => put("loss_at_risk", event.target.value)}><option value="unknown">Not reviewed</option><option value="all_at_risk">All investment is at risk</option><option value="some_not_at_risk">Some investment is not at risk — review Form 6198</option></select></Field>
      <h3 className="wide">Part III · Inventory and cost of goods sold</h3><Field label="33 · Closing inventory valuation"><select className="tx-input" value={str(values.inventory_method, "unknown")} onChange={event => put("inventory_method", event.target.value)}><option value="unknown">Not recorded</option><option value="cost">Cost</option><option value="lower_cost_market">Lower of cost or market</option><option value="other">Other — explain in notes</option></select></Field>{flag("inventory_changed", "34 · Changed how inventory quantities, costs or values were determined?")}{INVENTORY_FIELDS.map(([key, label]) => <Field key={key} label={label}><input className="tx-input" inputMode="decimal" value={amounts[key]} onChange={event => setAmounts(old => ({ ...old, [key]: event.target.value }))} placeholder="Unknown" /></Field>)}<div className="wide"><button type="button" className="tx-button" onClick={() => setAmounts(Object.fromEntries(INVENTORY_FIELDS.map(([key]) => [key, "0.00"])))}>Set all inventory amounts to $0</button><p className="tx-muted">Use this only if you have verified there is no inventory or cost of goods sold for this business and year.</p></div>
      <h3 className="wide">Part IV · Vehicle information</h3><Field label="43 · Vehicle placed in business service"><input type="date" className="tx-input" value={str(values.vehicle_service_date)} onChange={event => put("vehicle_service_date", event.target.value || null)} /></Field>{([["business_miles", "44a · Business miles"], ["commuting_miles", "44b · Commuting miles"], ["other_miles", "44c · Other miles"]] as const).map(([key, label]) => <Field key={key} label={label}><input type="number" min="0" max="10000000" step="0.01" className="tx-input" value={typeof values[key] === "number" ? String(values[key]) : ""} onChange={event => put(key, event.target.value === "" ? null : Number(event.target.value))} placeholder="Unknown" /></Field>)}{flagFields.slice(4).map(([key, label]) => flag(key, label))}
      <Field label="Explanations and supporting record references" wide help="Explain inventory changes, a different opening balance, an alternative method, or additional vehicles. Part V is itemized from reviewed transactions and adjustments."><textarea className="tx-input" rows={4} maxLength={12000} value={str(values.notes)} onChange={event => put("notes", event.target.value)} /></Field></div>{error ? <div className="tx-notice error" role="alert">{error}</div> : null}<div className="tx-dialog-actions"><button type="button" className="tx-button" disabled={busy} onClick={onClose}>Cancel</button><button className="tx-button primary" disabled={busy}>{busy ? "Saving…" : "Save worksheet"}</button></div></form></TaxDialog>;
}

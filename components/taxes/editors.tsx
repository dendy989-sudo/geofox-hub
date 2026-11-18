"use client";

import { useRef, useState, type FormEvent } from "react";
import { FILING_STATUSES, IRS_ENTRY_TYPES, RETURN_STATUSES, TAX_CATEGORIES, TRANSACTION_SCOPES, type TaxData, type TaxKind, type TaxRecord, type TaxSave, type TaxSnapshot } from "@/lib/taxes/types";
import { Field, TaxDialog, byKind, cents, decimal, human, num, str } from "./shared";

const structureOptions = ["unknown", "sole_proprietorship", "llc", "partnership", "corporation", "nonprofit", "other"];
const treatmentOptions = ["needs_review", "sole_proprietor", "qualified_joint_venture", "partnership", "s_corporation", "c_corporation", "community_property", "other"];
const nonDeductionCategories = new Set(["gross_receipts", "other_income", "returns_allowances", "uncategorized"]);
type EditorKind = Exclude<TaxKind, "statement" | "chat">;
export interface TaxEditorState { kind: EditorKind; record?: TaxRecord; year?: number; initial?: TaxData; initialTitle?: string; draftId?: string; }
export function TaxEditor({ editor, snapshot, onSave, onClose }: { editor: TaxEditorState; snapshot: TaxSnapshot; onSave: (record: TaxSave) => Promise<void>; onClose: () => void }) {
  const year = editor.year ?? editor.record?.tax_year ?? snapshot.year;
  const prior = editor.record, initial = prior?.data || editor.initial || {};
  const [values, setValues] = useState<TaxData>({ ...initial, ...(editor.kind === "adjustment" ? { confirmed: initial.review_status === "confirmed" } : {}) });
  const [title, setTitle] = useState(prior?.title || editor.initialTitle || (editor.kind === "year" ? String(year) : ""));
  const [amount, setAmount] = useState(decimal(editor.kind === "adjustment" && typeof initial.amount_cents === "number" && !["gross_receipts", "other_income"].includes(str(initial.category)) ? -initial.amount_cents : initial.amount_cents));
  const [error, setError] = useState(""), [busy, setBusy] = useState(false); const lock = useRef(false);
  const businesses = byKind(snapshot, "business"), accounts = byKind(snapshot, "account");
  const documents = byKind(snapshot, "statement").filter(record => record.tax_year === year && record.data.status !== "awaiting_upload" && !!record.data.sha256);
  const linkedDocument = snapshot.records.find(record => record.kind === "statement" && record.id === values.document_id);
  const put = (key: string, value: unknown) => setValues(old => {
    const next = { ...old, [key]: value };
    if (["transaction", "rule", "adjustment"].includes(editor.kind) && old[key] !== value) {
      // A prior deduction review does not carry over to a different classification.
      if (key === "scope" || key === "category") {
        next.deduction_confirmed = false;
        next.deduction_percent = null;
        if (editor.kind === "adjustment") next.confirmed = false;
      }
      if (key === "confirmed" && value !== true) next.deduction_confirmed = false;
    }
    return next;
  });
  const text = (key: string, fallback = "") => str(values[key], fallback);
  const numeric = (key: string, fallback = 0) => num(values[key], fallback);
  const input = (key: string, label: string, type = "text", help?: string, required = false, fallback = "") => <Field label={label} help={help}><input className="tx-input" type={type} value={text(key, fallback)} required={required} maxLength={type === "text" ? 600 : undefined} onChange={e => put(key, e.target.value)} /></Field>;
  const select = (key: string, label: string, choices: readonly string[], fallback: string, help?: string) => <Field label={label} help={help}><select className="tx-input" value={text(key, fallback)} onChange={e => put(key, e.target.value)}>{choices.map(value => <option key={value} value={value}>{human(value)}</option>)}</select></Field>;
  const checkbox = (key: string, label: string, help?: string) => <label className="tx-checkbox wide"><input type="checkbox" checked={values[key] === true} onChange={e => put(key, e.target.checked)} /><span>{label}{help ? <small>{help}</small> : null}</span></label>;
  const percentage = (key: string, label: string, fallback: number | null = 100, help?: string) => <Field label={label} help={help}><input className="tx-input" type="number" min="0" max="100" step="0.01" value={values[key] === null ? "" : typeof values[key] === "number" ? String(values[key]) : fallback === null ? "" : String(fallback)} onChange={e => put(key, e.target.value === "" ? null : Number(e.target.value))} /></Field>;
  const businessField = <Field label="Business"><select className="tx-input" value={text("business_id")} onChange={e => put("business_id", e.target.value || null)}><option value="">Choose a business</option>{businesses.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}</select></Field>;
  const categoryField = <Field label="Tax category"><select className="tx-input" value={text("category", "uncategorized")} onChange={e => put("category", e.target.value)}>{TAX_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>;
  const amountField = <Field label={editor.kind === "transaction" ? "Amount (USD)" : "Amount (USD)"} help={editor.kind === "transaction" ? "Money received is positive. Money spent is negative, for example −125.00." : editor.kind === "adjustment" ? "Enter a positive total for this category; a negative amount reverses part of it." : "Enter the amount shown in your records. The activity type determines its effect."}><input className="tx-input" type="text" inputMode="decimal" value={amount} required={editor.kind !== "irs_entry" || text("type", "assessment") !== "note"} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></Field>;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const defaultDate = today.startsWith(String(year)) ? today : `${year}-01-01`;
  const typeLabel = ({ year: "tax year", business: "business", account: "bank account", transaction: "transaction", rule: "vendor rule", dependent: "dependent", irs_entry: "IRS or relief record", adjustment: "report adjustment" } as const)[editor.kind];

  async function save(event: FormEvent) {
    event.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      let data: TaxData = { ...values, notes: text("notes") };
      if (editor.kind === "year") data = { ...data, status: text("status", "unknown"), filing_status: text("filing_status", "unknown"), filed_date: text("filed_date") || null, amended_date: text("amended_date") || null, reporting_treatment: text("reporting_treatment", "needs_review"), irs_balance_confirmed: values.irs_balance_confirmed === true, irs_balance_as_of: text("irs_balance_as_of") || null };
      if (editor.kind === "business") data = { ...data, legal_name: text("legal_name") || title.trim(), structure: text("structure", "unknown"), reporting_treatment: text("reporting_treatment", "needs_review"), owner_share_percent: typeof values.owner_share_percent === "number" ? values.owner_share_percent : null, start_year: numeric("start_year", 2018), end_year: values.end_year == null ? null : numeric("end_year") };
      if (editor.kind === "account") data = { ...data, institution: text("institution"), last_four: text("last_four"), account_type: text("account_type", "checking") };
      if (editor.kind === "transaction" || editor.kind === "rule") {
        const scope = text("scope", editor.kind === "rule" ? "business" : "unresolved");
        const deductionApplies = ["business", "mixed"].includes(scope) && !nonDeductionCategories.has(text("category", "uncategorized"));
        data = { ...data, scope, business_id: values.business_id || null, business_percent: scope === "business" ? 100 : scope === "mixed" ? numeric("business_percent", 50) : 0, category: text("category", "uncategorized"), deduction_percent: deductionApplies && typeof values.deduction_percent === "number" ? values.deduction_percent : null, deduction_confirmed: deductionApplies && values.deduction_confirmed === true };
        if (editor.kind === "transaction") data = { ...data, date: text("date", defaultDate), amount_cents: cents(amount), account_id: values.account_id || null, statement_id: values.statement_id || null, description: text("description") || title.trim(), vendor: text("vendor") || title.trim(), review_status: text("review_status", "needs_review"), source: text("source", "manual"), manual_override: true, rule_id: values.rule_id || null };
        else data = { ...data, match: text("match") || title.trim(), match_type: text("match_type", "contains"), enabled: values.enabled !== false, deduction_confirmed: false };
      }
      if (editor.kind === "dependent") data = { ...data, name: title.trim(), birth_date: text("birth_date") || null, relationship: text("relationship", "child"), months_lived: numeric("months_lived", 12), student: values.student === true, disabled: values.disabled === true, claimed: values.claimed === true };
      if (editor.kind === "irs_entry") data = { ...data, date: text("date", defaultDate), type: text("type", "assessment"), amount_cents: amount ? cents(amount) : 0, reference: text("reference"), document_id: values.document_id || null, affects_balance: typeof values.affects_balance === "boolean" ? values.affects_balance : ["opening_balance", "assessment", "penalty", "interest", "payment", "credit", "abatement"].includes(text("type", "assessment")) };
      if (editor.kind === "adjustment") {
        const deductionApplies = !nonDeductionCategories.has(text("category", "uncategorized"));
        data = { ...data, date: text("date", defaultDate), business_id: values.business_id || null, category: text("category", "uncategorized"), amount_cents: ["gross_receipts", "other_income"].includes(text("category")) ? cents(amount) : -cents(amount), scope: "business", business_percent: 100, review_status: values.confirmed === true ? "confirmed" : "needs_review", deduction_percent: deductionApplies ? values.deduction_percent === null ? null : numeric("deduction_percent", 100) : null, deduction_confirmed: values.confirmed === true && deductionApplies, source_reference: text("source_reference"), notes: text("notes") };
      }
      delete data.confirmed;
      await onSave({ ...(prior ? { id: prior.id, version: prior.version } : editor.draftId ? { id: editor.draftId } : {}), kind: editor.kind, tax_year: ["business", "account", "rule"].includes(editor.kind) ? null : year, title: title.trim() || (editor.kind === "year" ? String(year) : ""), data });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save. Please try again."); } finally { setBusy(false); lock.current = false; }
  }
  return <TaxDialog title={`${prior ? "Edit" : "Add"} ${typeLabel}${["business", "account", "rule"].includes(editor.kind) ? "" : ` · ${year}`}`} busy={busy} onClose={onClose}><form onSubmit={save} className="tx-editor"><div className="tx-form-grid">
    {editor.kind !== "year" ? <Field label={editor.kind === "dependent" ? "Name" : editor.kind === "business" ? "Business name" : editor.kind === "account" ? "Account nickname" : "Title"} wide><input className="tx-input" value={title} required maxLength={180} onChange={e => setTitle(e.target.value)} autoFocus /></Field> : null}
    {editor.kind === "year" ? <>
      {select("status", "Where this year stands", FILING_STATUSES, "unknown")}{select("filing_status", "Filing status for this year", RETURN_STATUSES, "unknown")}
      {input("filed_date", "Original return filed", "date")}{input("amended_date", "Amended return filed", "date")}
      {input("preparer", "Preparer / accountant")}
      {businesses.map(b => <Field key={b.id} label={`${b.title} · reporting treatment for ${year}`} help="A joint return does not automatically mean one Schedule C. Leave this as needs review until checked."><select className="tx-input" value={str((values.business_treatments as Record<string, unknown> | undefined)?.[b.id], str(b.data.reporting_treatment, "needs_review"))} onChange={e => put("business_treatments", { ...((values.business_treatments || {}) as Record<string, string>), [b.id]: e.target.value })}>{treatmentOptions.map(t => <option key={t} value={t}>{human(t)}</option>)}</select></Field>)}
      {input("irs_balance_as_of", "IRS balance checked through", "date", "Use the date of the transcript or notice you reviewed.")}
      {checkbox("irs_balance_confirmed", "I checked this year's balance against IRS records", "Enter the actual balance and dated activity in IRS activity. This checkbox does not create a balance.")}
      <Field label="Original return notes" wide><textarea className="tx-input" rows={2} value={text("original_return_notes")} maxLength={6000} onChange={e => put("original_return_notes", e.target.value)} /></Field>
      <Field label="Amendment questions & changes" wide><textarea className="tx-input" rows={2} value={text("amendment_notes")} maxLength={6000} onChange={e => put("amendment_notes", e.target.value)} placeholder="What was reported originally, what may be missing, and what needs professional review." /></Field>
    </> : null}
    {editor.kind === "business" ? <>
      {input("legal_name", "Legal name (if different)")}{select("structure", "Legal structure", structureOptions, "unknown")}
      {select("reporting_treatment", "Tax reporting treatment", treatmentOptions, "needs_review")}{percentage("owner_share_percent", "Your ownership share (%)", null, "Leave blank if not established. Reports do not automatically divide the business between owners.")}
      {input("other_owners", "Other owners")}{input("business_code", "Business activity code (if known)")}{select("accounting_method", "Accounting method", ["unknown", "cash", "accrual", "other"], "unknown")}
      <Field label="First tax year"><input className="tx-input" type="number" min="2018" max="2026" value={numeric("start_year", 2018)} onChange={e => put("start_year", Number(e.target.value))} /></Field>
      <Field label="Last active year (optional)"><input className="tx-input" type="number" min="2018" max="2026" value={values.end_year == null ? "" : numeric("end_year")} onChange={e => put("end_year", e.target.value ? Number(e.target.value) : null)} /></Field>
      <p className="tx-notice wide">A business run by both spouses may need separate Schedule C worksheets or a partnership return. Keep the treatment as “needs review” until that is established.</p>
    </> : null}
    {editor.kind === "account" ? <>
      {input("institution", "Bank / institution")}{input("last_four", "Last four digits only", "text", "Use a nickname and the last four digits. Full account numbers are unnecessary.")}
      {select("account_type", "Account type", ["checking", "savings", "credit_card", "other"], "checking")}
      <p className="tx-muted wide">A bank account can contain both business and personal transactions. Each transaction is classified separately.</p>
    </> : null}
    {editor.kind === "transaction" ? <>
      {input("date", "Transaction date", "date", undefined, true, defaultDate)}{amountField}
      {input("vendor", "Vendor / merchant")}{input("description", "Original description", "text", "Keep the statement wording so you can trace this item later.")}
      <Field label="Bank account"><select className="tx-input" value={text("account_id")} onChange={e => put("account_id", e.target.value || null)}><option value="">Unassigned</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></Field>
      {select("review_status", "Review status", ["needs_review", "confirmed"], "needs_review")}
    </> : null}
    {editor.kind === "rule" ? <>
      {input("match", "Vendor text to match", "text", "A specific merchant phrase avoids matching unrelated charges.", true)}
      {select("match_type", "Match method", ["contains", "exact"], "contains")}
      <label className="tx-checkbox wide"><input type="checkbox" checked={values.enabled !== false} onChange={e => put("enabled", e.target.checked)} /><span>Use this rule for future imports across all accounts and tax years</span></label>
    </> : null}
    {editor.kind === "transaction" || editor.kind === "rule" ? <>
      {select("scope", "This belongs to", TRANSACTION_SCOPES, editor.kind === "rule" ? "business" : "unresolved")}{businessField}
      {text("scope", editor.kind === "rule" ? "business" : "unresolved") === "mixed" ? percentage("business_percent", "Business portion (%)", 50, "The rest remains personal. The original statement amount is preserved.") : null}
      {categoryField}{percentage("deduction_percent", "Deductible part of business amount (%)", null, "Leave blank until checked. Business use and tax deductibility are separate decisions.")}
      {editor.kind === "transaction" ? checkbox("deduction_confirmed", "I have reviewed the deduction treatment", "Only confirmed deductions enter the draft Schedule C. Keep purpose and evidence in the notes.") : <p className="tx-muted wide">The percentage is a suggestion for matched records. Deduction treatment stays in review for each tax year; rules never silently confirm it.</p>}
    </> : null}
    {editor.kind === "dependent" ? <>
      {input("birth_date", "Date of birth", "date")}{select("relationship", "Relationship", ["child", "stepchild", "foster_child", "sibling", "parent", "other"], "child")}
      <Field label={`Months living with you in ${year}`}><input className="tx-input" type="number" min="0" max="12" value={numeric("months_lived", 12)} onChange={e => put("months_lived", Number(e.target.value))} /></Field>
      {checkbox("student", "Full-time student for the relevant period")}{checkbox("disabled", "Disability criteria need to be considered")}{checkbox("claimed", "Claimed on this year's return")}
      {input("other_claimant", "Other person who may claim this dependent")}{input("citizenship", "Citizenship / residency notes")}
      <Field label="Did this person provide over half their own support?"><select className="tx-input" value={values.support_over_half == null ? "unknown" : values.support_over_half ? "yes" : "no"} onChange={e => put("support_over_half", e.target.value === "unknown" ? null : e.target.value === "yes")}><option value="unknown">Needs review</option><option value="yes">Yes</option><option value="no">No</option></select></Field>
      {checkbox("eligibility_reviewed", "Dependency eligibility reviewed for this year")}
      <p className="tx-muted wide">Use notes for support, custody, someone else's claim, citizenship/residency, and other eligibility questions. No Social Security number is stored here. Recording a child does not automatically claim a credit.</p>
    </> : null}
    {editor.kind === "irs_entry" ? <>
      {select("type", "Activity type", IRS_ENTRY_TYPES, "assessment")}{input("date", "Posted / received date", "date", "This date may be later than the tax year the record belongs to.", true, defaultDate)}
      {amountField}{input("reference", "Notice, transcript, loan or check reference")}
      <Field label="Supporting document (optional)" wide help="Link an uploaded statement, notice, return or relief record from this tax year. Upload new evidence in Statements & documents."><select className="tx-input" value={text("document_id")} onChange={e => put("document_id", e.target.value || null)}><option value="">No linked document</option>{text("document_id") && !documents.some(record => record.id === values.document_id) ? <option value={text("document_id")}>Previously linked · {linkedDocument?.title || "document unavailable"}</option> : null}{documents.map(record => <option key={record.id} value={record.id}>{record.title}</option>)}</select></Field>
      <label className="tx-checkbox wide"><input type="checkbox" checked={typeof values.affects_balance === "boolean" ? values.affects_balance : ["opening_balance", "assessment", "penalty", "interest", "payment", "credit", "abatement"].includes(text("type", "assessment"))} onChange={e => put("affects_balance", e.target.checked)} /><span>Include this entry in the recorded IRS balance<small>Use for assessed tax, penalties, interest, applied payments, credits and refunds. Relief and PPP stay outside the tax-debt balance.</small></span></label>
      <p className="tx-notice wide">An opening balance is the balance as of its date. Older activity is retained in history and is not added again. A refund issued consumes a credit; it does not reduce tax debt.</p>
    </> : null}
    {editor.kind === "adjustment" ? <>
      {businessField}{categoryField}{amountField}{percentage("deduction_percent", "Deductible portion (%)", 100)}{input("source_reference", "Supporting document / calculation reference")}
      {checkbox("confirmed", "I reviewed this adjustment and its evidence")}
      <p className="tx-notice wide">Use adjustments for substantiated amounts that are not already counted in transactions, such as a calculated inventory/COGS total, depreciation or home-office amount. Describe the calculation and avoid counting the same cost twice.</p>
    </> : null}
    <Field label={editor.kind === "transaction" || editor.kind === "rule" ? "Business purpose, evidence & notes" : "Notes & supporting records"} wide><textarea className="tx-input" rows={4} value={text("notes")} maxLength={6000} onChange={e => put("notes", e.target.value)} placeholder="What you know, what is missing, and where the supporting record can be found." /></Field>
    </div>{error ? <div className="tx-notice error" role="alert">{error}</div> : null}<div className="tx-dialog-actions"><button type="button" className="tx-button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="tx-button primary" disabled={busy}>{busy ? "Saving…" : "Save record"}</button></div></form></TaxDialog>;
}

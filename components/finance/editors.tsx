"use client";

import { financeId } from "@/lib/finance/id";

import { useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/admin/icons";
import { isMoved, monthDays, paidAmount, parseMoney, remainingAmount } from "@/lib/finance/calculations";
import { FINANCE_CATEGORIES, FREQUENCY_LABELS, INCOME_CATEGORIES, type CustomRepeatMode, type EntryKind, type ExpenseType, type FinanceData, type FinanceDebt, type FinanceEntry, type FinanceMutate, type FinancePlan, type Frequency } from "@/lib/finance/types";
import { normalizeVendorUrl, vendorForEntry, vendorWebsiteUrl } from "@/lib/finance/vendors";
import { FinanceDialog, Money, formatDate, formatMoney } from "./shared";
import "./records.css";

interface EditorBase {
  data: FinanceData;
  month: string;
  today: string;
  mutate: FinanceMutate;
  onClose: () => void;
}

function useFormAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  async function run(work: () => Promise<void>, done?: () => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      await work();
      done?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This change could not be saved. Please try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return { pending, error, setError, run };
}

function FormError({ message }: { message: string }) {
  return message ? <div className="fr-form-error" role="alert"><Icon name="alert" size={17} /><span>{message}</span></div> : null;
}

function AmountInput({ label, value, onChange, hint, required = true, disabled = false }: { label: string; value: string; onChange: (value: string) => void; hint?: string; required?: boolean; disabled?: boolean }) {
  return <label className="fn-field"><span>{label}</span><div className="fr-money-input"><span aria-hidden="true">$</span><input type="text" inputMode="decimal" autoComplete="off" value={value} onChange={event => onChange(event.target.value)} placeholder="0.00" required={required} disabled={disabled} maxLength={15} /></div>{hint && <small>{hint}</small>}</label>;
}

function NotesInput({ value, onChange, label = "Notes", hint, maxLength = 4000 }: { value: string; onChange: (value: string) => void; label?: string; hint?: string; maxLength?: number }) {
  return <label className="fn-field full"><span>{label} <span className="fr-optional">optional</span></span><textarea rows={3} maxLength={maxLength} value={value} onChange={event => onChange(event.target.value)} placeholder="Anything you want to remember…" />{hint && <small>{hint}</small>}</label>;
}

type VendorPayload = { vendor_id: string | null; new_vendor?: never } | { vendor_id?: never; new_vendor: { id: string; name: string; url: string | null } };

function useVendorFields(initialId?: string | null) {
  const [selection, setSelection] = useState(initialId ?? "");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const newId = useRef("");
  function choose(value: string) {
    if (value === "new") newId.current ||= financeId();
    setSelection(value);
  }
  function payload(): VendorPayload {
    if (selection !== "new") return { vendor_id: selection || null };
    newId.current ||= financeId();
    if (!name.trim()) throw new Error("Enter a name for the new vendor, or choose an existing vendor.");
    return { new_vendor: { id: newId.current, name: name.trim(), url: normalizeVendorUrl(url) } };
  }
  return { selection, choose, name, setName, url, setUrl, payload };
}

function VendorFields({ data, vendor, help }: { data: FinanceData; vendor: ReturnType<typeof useVendorFields>; help?: string }) {
  const vendors = data.vendors ?? [];
  const available = vendors.filter(item => !item.archived_at || item.id === vendor.selection).sort((a, b) => a.name.localeCompare(b.name));
  const selected = vendors.find(item => item.id === vendor.selection);
  const website = vendorWebsiteUrl(selected?.url);
  return <div className="fr-vendor-fields full">
    <label className="fn-field"><span>Vendor / company <span className="fr-optional">optional</span></span><select value={vendor.selection} onChange={event => vendor.choose(event.target.value)}>
      <option value="">No vendor selected</option>
      {available.map(item => <option key={item.id} value={item.id}>{item.name}{item.archived_at ? " · Archived" : ""}</option>)}
      <option value="new">+ Add a new vendor</option>
    </select><small>{help ?? "Reuse a saved company and its website. Manage existing vendor details on the Vendors page."}</small></label>
    {vendor.selection === "new" ? <div className="fr-new-vendor"><div className="fr-section-caption"><Icon name="globe" size={15} /><strong>New vendor</strong><span>Saved with this record</span></div><div className="fn-fields">
      <label className="fn-field"><span>Vendor name</span><input value={vendor.name} onChange={event => vendor.setName(event.target.value)} required maxLength={200} placeholder="e.g. Electric company" autoComplete="organization" /></label>
      <label className="fn-field"><span>Payment website <span className="fr-optional">optional</span></span><input type="text" inputMode="url" autoComplete="url" autoCapitalize="none" autoCorrect="off" value={vendor.url} onChange={event => vendor.setUrl(event.target.value)} maxLength={2048} placeholder="company.com/pay" /><small>Use the company’s website or payment page. Links open in a new tab.</small></label>
    </div><p className="fn-muted fr-small">You can reuse this vendor on other bills, income, and payment plans.</p></div> : selected ? <div className="fr-selected-vendor"><span><Icon name="globe" size={14} />{selected.name}{selected.archived_at ? <span className="fn-badge">Archived</span> : null}</span>{website ? <a href={website} target="_blank" rel="noopener noreferrer" className="fr-vendor-link">Open website <Icon name="external" size={12} /><span className="fr-sr-only"> for {selected.name} in a new tab</span></a> : <small>No website saved</small>}</div> : null}
  </div>;
}

function validCustomDate(value: string): boolean {
  return /^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(value) && monthDays(value.slice(0, 7)).includes(value);
}

const moneyText = (cents: number) => (cents / 100).toFixed(2);
const initialDate = (month: string, today: string) => today.startsWith(month) ? today : `${month}-01`;

export function EntryEditor({ data, month, today, mutate, onClose, entry: initialEntry, kind: initialKind = "bill", date, initial, onSaved }: EditorBase & { entry?: FinanceEntry; kind?: EntryKind; date?: string; initial?: { title?: string; amount_cents?: number }; onSaved?: () => void }) {
  const entry = initialEntry ? data.entries.find(item => item.id === initialEntry.id) ?? initialEntry : undefined;
  const kind = entry?.kind ?? initialKind;
  const income = kind === "income";
  const [title, setTitle] = useState(entry?.title ?? initial?.title ?? "");
  const [amount, setAmount] = useState(entry ? moneyText(entry.amount_cents) : initial?.amount_cents !== undefined ? moneyText(initial.amount_cents) : "");
  const [category, setCategory] = useState(entry?.category ?? (income ? "Paycheck" : "Home"));
  const [expenseType, setExpenseType] = useState<ExpenseType>(entry?.expense_type ?? "bill");
  const [originalDue, setOriginalDue] = useState(entry?.original_due_date ?? date ?? initialDate(month, today));
  const [scheduledDate, setScheduledDate] = useState(entry?.scheduled_date ?? date ?? initialDate(month, today));
  const [frequency, setFrequency] = useState<Frequency | "once">("once");
  const [endDate, setEndDate] = useState("");
  const [customMode, setCustomMode] = useState<CustomRepeatMode>("month_days");
  const [customMonthDays, setCustomMonthDays] = useState<number[]>(() => [Number(originalDue.slice(8))].filter(day => day >= 1 && day <= 31));
  const [customDates, setCustomDates] = useState<string[]>([]);
  const [dateToAdd, setDateToAdd] = useState("");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [reversal, setReversal] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const id = useRef(entry?.id ?? "");
  const vendor = useVendorFields(entry?.vendor_id);
  const action = useFormAction();
  const receipts = entry ? data.payments.filter(payment => payment.entry_id === entry.id).sort((a, b) => b.paid_on.localeCompare(a.paid_on) || b.created_at.localeCompare(a.created_at)) : [];
  const series = entry?.series_id ? data.series.find(item => item.id === entry.series_id) : null;
  const paid = entry ? paidAmount(entry, data.payments) : 0;
  const categories = income ? INCOME_CATEGORIES : FINANCE_CATEGORIES;
  const selectedDates = [...new Set([originalDue, ...customDates].filter(Boolean))].sort();
  const matchesMonthPattern = validCustomDate(originalDue) && customMonthDays.some(day => Math.min(day, monthDays(originalDue.slice(0, 7)).length) === Number(originalDue.slice(8)));
  const close = () => { if (!action.pending) onClose(); };
  function changeOriginalDate(next: string) {
    if (customMonthDays.length === 1 && customMonthDays[0] === Number(originalDue.slice(8)) && validCustomDate(next)) setCustomMonthDays([Number(next.slice(8))]);
    if (scheduledDate === originalDue) setScheduledDate(next);
    setOriginalDue(next);
  }
  function addCustomDate() {
    if (!validCustomDate(originalDue)) return action.setError("Choose the original due date before adding custom dates.");
    if (!validCustomDate(dateToAdd)) return action.setError("Choose a valid calendar date to add.");
    if (dateToAdd < originalDue) return action.setError("Custom dates must be on or after the original due date.");
    if (endDate && dateToAdd > endDate) return action.setError("This date is after the repeat end date. Choose an earlier date or change Repeat until.");
    if (new Set([...selectedDates, dateToAdd]).size > 240) return action.setError("A custom schedule can include up to 240 dates. Remove a date before adding another.");
    if (dateToAdd !== originalDue) setCustomDates(old => [...new Set([...old, dateToAdd])].sort());
    setDateToAdd("");
    action.setError("");
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null || cents <= 0) return action.setError("Enter an amount greater than zero, using up to two decimal places.");
    if (cents < paid) return action.setError(`The amount cannot be less than the ${formatMoney(paid)} already ${income ? "received" : "paid"}. Reverse an incorrect payment first.`);
    if (!title.trim()) return action.setError(`Enter a name for this ${income ? "income" : "bill"}.`);
    if (!entry && frequency !== "once" && endDate && endDate < originalDue) return action.setError("The repeat end date must be on or after the first due date.");
    const dates = [...new Set([...selectedDates, ...(dateToAdd ? [dateToAdd] : [])])].sort();
    if (!entry && frequency === "custom") {
      if (customMode === "month_days") {
        if (!customMonthDays.length) return action.setError("Choose at least one day of the month for this schedule.");
        if (!matchesMonthPattern) return action.setError("The original due date must match a selected monthly day. Change that date or select its day below.");
      } else {
        if (dates.length > 240) return action.setError("A custom schedule can include up to 240 dates, including the original due date.");
        if (dates.some(item => !validCustomDate(item) || item < originalDue)) return action.setError("Every custom date must be valid and on or after the original due date. Remove earlier dates or change the original due date.");
        if (endDate && dates.some(item => item > endDate)) return action.setError("Some custom dates are after Repeat until. Remove those dates or change the repeat end date.");
      }
    }
    let vendorPayload: VendorPayload;
    try { vendorPayload = vendor.payload(); }
    catch (cause) { return action.setError(cause instanceof Error ? cause.message : "Check the vendor name and website."); }
    id.current ||= financeId();
    void action.run(() => mutate("save_entry", {
      id: id.current, kind, title: title.trim(), category, expense_type: income ? "bill" : expenseType,
      amount_cents: cents, original_due_date: entry?.original_due_date ?? originalDue,
      scheduled_date: scheduledDate, notes: notes.trim(),
      ...(!entry ? { frequency, end_date: frequency === "once" ? null : endDate || null,
        ...(frequency === "custom" ? { custom_mode: customMode, custom_month_days: customMode === "month_days" ? customMonthDays : [], custom_dates: customMode === "specific_dates" ? dates : [] } : {}) } : {}),
      ...vendorPayload,
    }), () => { onSaved?.(); onClose(); });
  }
  return <FinanceDialog title={`${entry ? "Manage" : "Add"} ${income ? "income" : "bill"}`} onClose={close}>
    <form className="fn-stack fr-editor-form" onSubmit={submit}>
      <p className="fr-form-intro">{income ? "Income appears in your overview, calendar, and Live Money. Record receipts as money arrives." : "Bills are committed expenses. Saving here updates your overview, calendar, and Live Money. Everyday spending belongs in Live Money."}</p>
      {entry?.series_id && <div className="fr-info"><Icon name="refresh" size={17} /><span>You are editing one occurrence. Other repeats keep their existing amounts and original dates.</span></div>}
      {entry?.plan_id && <div className="fr-info"><Icon name="layers" size={17} /><span>This bill is part of a payment schedule. Its payments also update the plan’s progress.</span></div>}
      <fieldset className="fr-fieldset" disabled={action.pending || entry?.status === "collections"}>
        <div className="fn-fields">
          <label className="fn-field full"><span>{income ? "Income name" : "Bill name"}</span><input autoFocus value={title} onChange={event => setTitle(event.target.value)} maxLength={160} required placeholder={income ? "e.g. Main paycheck" : "e.g. Rent, electric, or car insurance"} /></label>
          <AmountInput label={income ? "Expected amount" : "Bill amount"} value={amount} onChange={setAmount} hint={entry && entry.original_amount_cents !== parseMoney(amount) ? `Originally ${formatMoney(entry.original_amount_cents)}. Your original monthly obligation stays visible.` : undefined} />
          <label className="fn-field"><span>Category</span><select value={category} onChange={event => setCategory(event.target.value)}>{!categories.some(item => item === category) && <option value={category}>{category}</option>}{categories.map(item => <option key={item}>{item}</option>)}</select></label>
          <VendorFields data={data} vendor={vendor} help={entry?.series_id ? "Changing the vendor here updates this occurrence only. Other repeats keep their original vendor." : undefined} />
          {!income && <label className="fn-field full"><span>Expense type</span><select value={expenseType} onChange={event => setExpenseType(event.target.value as ExpenseType)} disabled={Boolean(entry?.plan_id)}><option value="bill">Regular bill</option><option value="installment">Installment</option><option value="payment_plan">Payment plan</option></select>{!entry?.plan_id && expenseType !== "bill" && <small>This labels this bill. To generate and track a complete payment schedule, add a plan on the Payments page.</small>}</label>}
          <label className="fn-field"><span>{income ? "Original expected date" : "Original due date"}</span><input type="date" value={originalDue} min="2000-01-01" max="2100-12-31" disabled={Boolean(entry)} required onChange={event => changeOriginalDate(event.target.value)} /><small>{entry ? "Kept for your records, even when the planned date changes." : "The date this amount is originally due."}</small></label>
          <label className="fn-field"><span>{income ? "Planned receipt date" : "Planned payment date"}</span><input type="date" value={scheduledDate} onChange={event => setScheduledDate(event.target.value)} required /><small>{scheduledDate !== originalDue ? "Moved · original date remains unchanged." : "Move this date when you need to plan for another day."}</small></label>
          {!entry && <><label className="fn-field"><span>Repeat</span><select value={frequency} onChange={event => setFrequency(event.target.value as Frequency | "once")}>{Object.entries(FREQUENCY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>{frequency !== "once" && <label className="fn-field"><span>Repeat until <span className="fr-optional">optional</span></span><input type="date" value={endDate} min={originalDue} max="2100-12-31" onChange={event => setEndDate(event.target.value)} /><small>{frequency === "custom" && customMode === "specific_dates" ? "Leave blank to include every date you choose below." : "Leave blank to continue until you pause the series."}</small></label>}</>}
          {!entry && frequency === "custom" && <div className="fr-custom-repeat full">
            <label className="fn-field"><span>Custom schedule</span><select value={customMode} onChange={event => setCustomMode(event.target.value as CustomRepeatMode)}><option value="month_days">Choose days each month</option><option value="specific_dates">Choose specific calendar dates</option></select></label>
            {customMode === "month_days" ? <fieldset className="fr-month-picker"><legend>Days of the month</legend><p className="fn-muted fr-small">Choose one or more days, such as the 1st and 15th. Days 29–31 use the last day of shorter months; overlapping days create one occurrence.</p><div className="fr-month-days">{Array.from({ length: 31 }, (_, index) => index + 1).map(day => <label key={day} className="fr-month-day"><input type="checkbox" checked={customMonthDays.includes(day)} aria-label={`Repeat on day ${day} of each month`} onChange={event => { const checked = event.target.checked; setCustomMonthDays(old => checked ? [...old, day].sort((a, b) => a - b) : old.filter(value => value !== day)); }} /><span>{day}</span></label>)}</div><p className={`fr-repeat-hint${customMonthDays.length && !matchesMonthPattern ? " invalid" : ""}`}>{customMonthDays.length ? `Selected: ${customMonthDays.join(", ")}. ${matchesMonthPattern ? "Your first due date matches this schedule." : "Choose a matching original due date, or add its day above."}` : "Select at least one day to repeat."}</p></fieldset> : <div className="fr-specific-dates"><p className="fn-muted fr-small">Choose each date this amount is due. Your original due date is always included as the first occurrence. You can schedule up to 240 dates.</p><div className="fr-add-date"><label className="fn-field"><span>Add a calendar date</span><input type="date" min={originalDue || "2000-01-01"} max={endDate || "2100-12-31"} value={dateToAdd} onChange={event => setDateToAdd(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addCustomDate(); } }} /></label><button type="button" className="fn-button" disabled={!dateToAdd} onClick={addCustomDate}><Icon name="plus" size={13} />Add date</button></div><div className="fr-section-caption"><strong>Selected dates</strong><span>{selectedDates.length} / 240</span></div><ul className="fr-date-chips" aria-label="Selected custom dates">{selectedDates.map(item => <li key={item} className={item < originalDue || (endDate && item > endDate) ? "invalid" : ""}><span>{formatDate(item)}</span>{item === originalDue ? <small>First</small> : <button type="button" onClick={() => setCustomDates(old => old.filter(value => value !== item))} aria-label={`Remove ${formatDate(item)} from the schedule`}><Icon name="close" size={12} /></button>}</li>)}</ul>{selectedDates.some(item => item < originalDue || (endDate && item > endDate)) && <p className="fr-repeat-hint invalid">Remove dates outside your first due date and repeat end date, or adjust those limits above.</p>}</div>}
          </div>}
          <NotesInput value={notes} onChange={setNotes} />
        </div>
      </fieldset>
      {entry?.status === "collections" && <div className="fr-info"><Icon name="info" size={17} /><span>This balance was moved to collections. Manage it in Credit & collections. Original dates and payment history stay here.</span></div>}
      <FormError message={action.error} />
      <div className="fn-actions end"><button className="fn-button" type="button" onClick={close} disabled={action.pending}>Close</button>{entry?.status !== "collections" && <button className="fn-button primary" type="submit" disabled={action.pending}>{action.pending ? "Saving…" : entry ? "Save changes" : `Add ${income ? "income" : "bill"}`}</button>}</div>
    </form>
    {entry && <div className="fr-editor-section">
      <div className="fn-row"><h3>{income ? "Receipt history" : "Payment history"}</h3><strong><Money cents={paid} /> {income ? "received" : "paid"}</strong></div>
      {receipts.length ? <div className="fr-history">{receipts.map(payment => <div className={`fr-history-item${payment.reversed_at ? " reversed" : ""}`} key={payment.id}><div><strong><Money cents={payment.amount_cents} /></strong><span>{formatDate(payment.paid_on)}{payment.reversed_at ? " · Reversed" : ""}</span>{payment.note && <p>{payment.note}</p>}</div>{!payment.reversed_at && (reversal === payment.id ? <div className="fr-inline-confirm"><p>Reverse this record? Its amount will become outstanding again.</p><div className="fn-actions"><button className="fn-button small" type="button" disabled={action.pending} onClick={() => setReversal(null)}>Keep record</button><button className="fn-button small danger" type="button" disabled={action.pending} onClick={() => { void action.run(() => mutate("remove_payment", { id: payment.id }), () => setReversal(null)); }}>Reverse</button></div></div> : <button className="fn-button small subtle" type="button" disabled={action.pending} onClick={() => setReversal(payment.id)}>Reverse</button>)}</div>)}</div> : <p className="fn-muted fr-small">No {income ? "receipts" : "payments"} recorded yet. Use “{income ? "Record receipt" : "Record payment"}” on the list to record full or partial amounts.</p>}
    </div>}
    {series && <div className="fr-editor-section"><div className="fn-row"><div><h3>Recurring {income ? "income" : "bill"}</h3><p className="fn-muted fr-small">{FREQUENCY_LABELS[series.frequency]} · {series.active ? "Repeats are active" : "Repeats are paused"}{series.end_date ? ` · Ends ${formatDate(series.end_date)}` : ""}</p></div><button className="fn-button small" type="button" disabled={action.pending} onClick={() => { void action.run(() => mutate("save_series", { id: series.id, active: !series.active })); }}>{series.active ? "Pause repeats" : "Resume repeats"}</button></div>
      {series.frequency === "custom" && <div className="fr-series-pattern">{series.custom_mode === "month_days" ? <><strong>Every month on days {series.custom_month_days.join(", ")}</strong><p>Starts {formatDate(series.start_date)}. Days 29–31 use the last available day in shorter months, with one occurrence per date.</p></> : <details className="fr-series-dates"><summary><span>{series.custom_dates.length} selected calendar {series.custom_dates.length === 1 ? "date" : "dates"}</span><span>View schedule <Icon name="chevron" size={12} /></span></summary><ul className="fr-date-chips" aria-label="Saved custom schedule">{series.custom_dates.map(item => <li key={item}><span>{formatDate(item)}</span>{item === series.start_date ? <small>First</small> : null}</li>)}</ul></details>}<small>The repeating pattern is kept as created. This editor changes one occurrence.</small></div>}
      <p className="fn-muted fr-small">Pausing stops new occurrences. Already created bills and income keep their own status. Resuming generates missed occurrences from the original schedule, including dates while paused. Cancel any occurrences that no longer apply.</p></div>}
    {entry && entry.status !== "collections" && <div className="fr-editor-section"><h3>Record status</h3><p className="fn-muted fr-small">{income ? "Cancel income that will no longer arrive." : "Cancel a bill that no longer needs payment."} Cancelled records keep their original dates and history. Archiving hides a record from the default list and preserves its balance impact.</p>{confirmCancel ? <div className="fr-inline-confirm"><p>Cancel this occurrence? {remainingAmount(entry, data.payments) > 0 ? "Its unpaid amount will leave the cash-flow forecast." : "Existing payment records will stay in your history."}{entry.series_id ? " Future repeats remain active unless you pause them above." : ""}</p><div className="fn-actions"><button className="fn-button small" type="button" disabled={action.pending} onClick={() => setConfirmCancel(false)}>Keep active</button><button className="fn-button small danger" type="button" disabled={action.pending} onClick={() => { void action.run(() => mutate("entry_status", { id: entry.id, status: "cancelled" }), onClose); }}>Confirm cancellation</button></div></div> : <div className="fn-actions">{entry.status === "active" ? <button className="fn-button small danger" type="button" disabled={action.pending} onClick={() => setConfirmCancel(true)}>Cancel {income ? "income" : "bill"}</button> : <button className="fn-button small" type="button" disabled={action.pending} onClick={() => { void action.run(() => mutate("entry_status", { id: entry.id, status: "active" }), onClose); }}>Restore active</button>}<button className="fn-button small" type="button" disabled={action.pending} onClick={() => { void action.run(() => mutate("entry_status", { id: entry.id, status: entry.status, archived: !entry.archived_at }), onClose); }}>{entry.archived_at ? "Unarchive" : "Archive record"}</button></div>}</div>}
  </FinanceDialog>;
}

export function PaymentEditor({ data, today, mutate, onClose, entry: initialEntry }: EditorBase & { entry: FinanceEntry }) {
  const entry = data.entries.find(item => item.id === initialEntry.id) ?? initialEntry;
  const remaining = remainingAmount(entry, data.payments);
  const income = entry.kind === "income";
  const vendor = vendorForEntry(data, entry);
  const website = vendorWebsiteUrl(vendor?.url);
  const [amount, setAmount] = useState(moneyText(remaining));
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState("");
  const id = useRef("");
  const action = useFormAction();
  const close = () => { if (!action.pending) onClose(); };
  function submit(event: FormEvent) {
    event.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null || cents <= 0) return action.setError("Enter an amount greater than zero, using up to two decimal places.");
    if (cents > remaining) return action.setError(`The remaining amount is ${formatMoney(remaining)}. Enter that amount or a smaller partial payment.`);
    if (paidOn > today) return action.setError(`Record money ${income ? "received" : "paid"} today or earlier. To plan a future date, move the record instead.`);
    if (entry.status !== "active") return action.setError("Restore this record to active before recording a payment.");
    id.current ||= financeId();
    void action.run(() => mutate("record_payment", { id: id.current, entry_id: entry.id, amount_cents: cents, paid_on: paidOn, note: note.trim() }), onClose);
  }
  return <FinanceDialog title={income ? "Record income received" : "Record a payment"} onClose={close}><form onSubmit={submit} className="fn-stack fr-editor-form"><div className="fr-entry-summary"><span>{entry.title}</span><strong><Money cents={remaining} /></strong><small>{income ? "Still expected" : "Still to pay"} · Original {income ? "date" : "due"} {formatDate(entry.original_due_date)}{vendor ? ` · ${vendor.name}` : ""}</small></div><p className="fr-form-intro">{income ? "Record the amount that actually arrived. Partial receipts leave the rest in your forecast." : "Record what you actually paid. Partial payments reduce the remaining balance and keep the bill open until it is fully paid."}</p>
    {website && vendor && <div className="fr-vendor-payment"><div><strong>{vendor.name}</strong><p>{income ? "Open the saved company website if needed. Record your receipt here when the money arrives." : "Pay on the company’s website, then record the payment here. Opening this link does not mark the bill paid."}</p></div><a className="fn-button small" href={website} target="_blank" rel="noopener noreferrer"><Icon name="external" size={13} />{income ? "Open website" : "Open payment website"}<span className="fr-sr-only"> for {vendor.name} in a new tab</span></a></div>}
    <fieldset className="fr-fieldset" disabled={action.pending}><div className="fn-fields"><AmountInput label={income ? "Amount received" : "Amount paid"} value={amount} onChange={setAmount} /><label className="fn-field"><span>{income ? "Received on" : "Paid on"}</span><input autoFocus type="date" required max={today} value={paidOn} onChange={event => setPaidOn(event.target.value)} /></label><NotesInput value={note} onChange={setNote} label="Payment note" maxLength={1000} /></div></fieldset>{parseMoney(amount) !== null && parseMoney(amount)! > 0 && parseMoney(amount)! < remaining && <div className="fr-info"><Icon name="info" size={17} /><span>Partial {income ? "receipt" : "payment"}: <Money cents={remaining - parseMoney(amount)!} /> will remain {income ? "expected" : "outstanding"}.</span></div>}<FormError message={action.error} /><div className="fn-actions end"><button className="fn-button" type="button" onClick={close} disabled={action.pending}>Cancel</button><button className="fn-button primary" type="submit" disabled={action.pending || remaining <= 0}>{action.pending ? "Recording…" : income ? "Record receipt" : "Record payment"}</button></div></form></FinanceDialog>;
}

export function MoveEditor({ data, mutate, onClose, entry: initialEntry }: EditorBase & { entry: FinanceEntry }) {
  const entry = data.entries.find(item => item.id === initialEntry.id) ?? initialEntry;
  const [date, setDate] = useState(entry.scheduled_date);
  const [note, setNote] = useState("");
  const action = useFormAction();
  const close = () => { if (!action.pending) onClose(); };
  function submit(event: FormEvent) {
    event.preventDefault();
    void action.run(() => mutate("move_entry", { id: entry.id, scheduled_date: date, note: note.trim() }), onClose);
  }
  return <FinanceDialog title={`Move ${entry.kind === "income" ? "income" : "bill"}`} onClose={close}><form className="fn-stack fr-editor-form" onSubmit={submit}><div className="fr-entry-summary"><span>{entry.title}</span><strong><Money cents={remainingAmount(entry, data.payments)} /></strong><small>Original {entry.kind === "income" ? "expected date" : "due date"} · {formatDate(entry.original_due_date)}</small></div><div className="fr-info"><Icon name="calendar" size={17} /><span>Only the planned date changes. Your original monthly obligation and overdue status stay visible across the app. A planned move does not change an agreement with your creditor.</span></div><fieldset className="fr-fieldset" disabled={action.pending}><div className="fn-fields"><label className="fn-field full"><span>New planned {entry.kind === "income" ? "receipt" : "payment"} date</span><input autoFocus type="date" required value={date} onChange={event => setDate(event.target.value)} /><small>Currently planned for {formatDate(entry.scheduled_date)}{isMoved(entry) ? " · Already moved" : ""}.</small></label><NotesInput value={note} onChange={setNote} label="Reason for moving" maxLength={1000} /></div></fieldset><FormError message={action.error} /><div className="fn-actions end">{date !== entry.original_due_date && <button className="fn-button subtle" type="button" disabled={action.pending} onClick={() => setDate(entry.original_due_date)}>Use original date</button>}<button className="fn-button" type="button" onClick={close} disabled={action.pending}>Cancel</button><button className="fn-button primary" type="submit" disabled={action.pending}>{action.pending ? "Moving…" : "Save planned date"}</button></div></form></FinanceDialog>;
}

export function PlanEditor({ data, month, today, mutate, onClose, plan }: EditorBase & { plan?: FinancePlan }) {
  const [title, setTitle] = useState(plan?.title ?? "");
  const [creditor, setCreditor] = useState(plan?.creditor ?? "");
  const [kind, setKind] = useState<FinancePlan["kind"]>(plan?.kind ?? "installment");
  const [category, setCategory] = useState(plan?.category ?? "Debt payments");
  const [total, setTotal] = useState(plan ? moneyText(plan.total_amount_cents) : "");
  const [openingPaid, setOpeningPaid] = useState(plan ? moneyText(plan.opening_paid_cents) : "0.00");
  const [installment, setInstallment] = useState(plan ? moneyText(plan.installment_amount_cents) : "");
  const [frequency, setFrequency] = useState<FinancePlan["frequency"]>(plan?.frequency ?? "monthly");
  const [firstDate, setFirstDate] = useState(plan?.first_due_date ?? initialDate(month, today));
  const [notes, setNotes] = useState(plan?.notes ?? "");
  const id = useRef(plan?.id ?? "");
  const vendor = useVendorFields(plan?.vendor_id);
  const action = useFormAction();
  const cents = parseMoney(total), prior = parseMoney(openingPaid), each = parseMoney(installment);
  const remaining = cents !== null && prior !== null ? cents - prior : 0;
  const count = each && remaining > 0 ? Math.ceil(remaining / each) : 0;
  const close = () => { if (!action.pending) onClose(); };
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !creditor.trim()) return action.setError("Enter the plan name and the company you pay.");
    if (cents === null || cents <= 0 || prior === null || prior < 0 || each === null || each <= 0) return action.setError("Enter positive total and installment amounts. Already paid can be zero.");
    if (!plan && prior >= cents) return action.setError("The remaining balance must be greater than zero to create a payment schedule.");
    if (!plan && count > 240) return action.setError("This would create more than 240 installments. Increase the regular payment amount.");
    let vendorPayload: VendorPayload;
    try { vendorPayload = vendor.payload(); }
    catch (cause) { return action.setError(cause instanceof Error ? cause.message : "Check the vendor name and website."); }
    id.current ||= financeId();
    void action.run(() => mutate("save_plan", { id: id.current, title: title.trim(), creditor: creditor.trim(), kind, category, total_amount_cents: cents, opening_paid_cents: prior, installment_amount_cents: each, frequency, first_due_date: firstDate, notes: notes.trim(), ...vendorPayload }), onClose);
  }
  return <FinanceDialog title={plan ? "Manage payment plan" : "Add a payment plan"} onClose={close}>
    <form className="fn-stack fr-editor-form" onSubmit={submit}>
      <p className="fr-form-intro">Create an installment schedule once. Each payment appears as a bill across your calendar, Live Money, and monthly totals. Record or move individual payments as life changes.</p>
      {plan && <div className="fr-info"><Icon name="info" size={17} /><span>Your original amounts and frequency stay intact. Edit the name, company, vendor, or notes here. Record payments or move individual dates in the schedule.</span></div>}
      <fieldset className="fr-fieldset" disabled={action.pending}><div className="fn-fields">
        <label className="fn-field"><span>Plan name</span><input autoFocus required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Car repair installments" /></label>
        <label className="fn-field"><span>Company / creditor</span><input required maxLength={160} value={creditor} onChange={event => setCreditor(event.target.value)} placeholder="Who you pay" /></label>
        <VendorFields data={data} vendor={vendor} help={plan ? "Changing this vendor updates every installment in the plan, including its recorded payment history." : "Attach a saved company and payment website to every installment in this plan."} />
        <label className="fn-field"><span>Plan type</span><select value={kind} disabled={Boolean(plan)} onChange={event => setKind(event.target.value as FinancePlan["kind"])}><option value="installment">Installments</option><option value="payment_plan">Payment plan</option></select></label>
        <label className="fn-field"><span>Category</span><select value={category} disabled={Boolean(plan)} onChange={event => setCategory(event.target.value)}>{!FINANCE_CATEGORIES.some(item => item === category) && <option>{category}</option>}{FINANCE_CATEGORIES.map(item => <option key={item}>{item}</option>)}</select></label>
        <AmountInput label="Total agreed amount" value={total} onChange={setTotal} disabled={Boolean(plan)} hint="Include any agreed interest or fees in this total." />
        <AmountInput label="Already paid before tracking" value={openingPaid} onChange={setOpeningPaid} disabled={Boolean(plan)} hint="This advances the plan’s progress without deducting from this month’s cash." />
        <AmountInput label="Regular payment amount" value={installment} onChange={setInstallment} disabled={Boolean(plan)} />
        <label className="fn-field"><span>Payment frequency</span><select value={frequency} disabled={Boolean(plan)} onChange={event => setFrequency(event.target.value as FinancePlan["frequency"])}><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option></select></label>
        <label className="fn-field full"><span>First unpaid payment due</span><input type="date" required min="2000-01-01" max="2100-12-31" disabled={Boolean(plan)} value={firstDate} onChange={event => setFirstDate(event.target.value)} /></label>
        <NotesInput value={notes} onChange={setNotes} />
      </div></fieldset>
      {!plan && count > 0 && count <= 240 && <div className="fr-info"><Icon name="layers" size={17} /><span><strong>{count} {count === 1 ? "payment" : "payments"}</strong> will be created for <Money cents={remaining} /> remaining. The last payment is <Money cents={remaining - (count - 1) * (each ?? 0)} />.</span></div>}
      <FormError message={action.error} /><div className="fn-actions end"><button className="fn-button" type="button" disabled={action.pending} onClick={close}>Cancel</button><button className="fn-button primary" type="submit" disabled={action.pending}>{action.pending ? "Saving…" : plan ? "Save plan details" : "Create payment schedule"}</button></div>
    </form>
  </FinanceDialog>;
}

export function DebtEditor({ data, today, mutate, onClose, debt: originalDebt }: EditorBase & { debt?: FinanceDebt }) {
  const debt = originalDebt ? data.debts.find(item => item.id === originalDebt.id) ?? originalDebt : undefined;
  const [title, setTitle] = useState(debt?.title ?? "");
  const [stage, setStage] = useState<FinanceDebt["stage"]>(debt?.stage ?? "collections");
  const [originalCreditor, setOriginalCreditor] = useState(debt?.original_creditor ?? "");
  const [collector, setCollector] = useState(debt?.collector ?? "");
  const [originalAmount, setOriginalAmount] = useState(debt ? moneyText(debt.original_balance_cents) : "");
  const [balance, setBalance] = useState(debt ? moneyText(debt.current_balance_cents) : "");
  const [status, setStatus] = useState<FinanceDebt["status"]>(debt?.status ?? "open");
  const [dateAdded, setDateAdded] = useState(debt?.date_added ?? today);
  const [dateRemoved, setDateRemoved] = useState(debt?.date_removed ?? "");
  const [settlement, setSettlement] = useState(debt?.settlement_offer_cents !== null && debt?.settlement_offer_cents !== undefined ? moneyText(debt.settlement_offer_cents) : "");
  const [monthlyOffer, setMonthlyOffer] = useState(debt?.offer_monthly_cents !== null && debt?.offer_monthly_cents !== undefined ? moneyText(debt.offer_monthly_cents) : "");
  const [offerExpires, setOfferExpires] = useState(debt?.offer_expires_on ?? "");
  const [notes, setNotes] = useState(debt?.notes ?? "");
  const [changeNote, setChangeNote] = useState("");
  const id = useRef(debt?.id ?? "");
  const action = useFormAction();
  const history = debt ? data.debt_history.filter(item => item.debt_id === debt.id).sort((a, b) => b.created_at.localeCompare(a.created_at)) : [];
  const close = () => { if (!action.pending) onClose(); };
  function submit(event: FormEvent) {
    event.preventDefault();
    const original = parseMoney(originalAmount), current = parseMoney(balance), offered = settlement.trim() ? parseMoney(settlement) : null, monthly = monthlyOffer.trim() ? parseMoney(monthlyOffer) : null;
    if (!title.trim() || !originalCreditor.trim()) return action.setError("Enter the debt name and original company.");
    if (stage === "collections" && !collector.trim()) return action.setError("Enter the current collection agency or creditor.");
    if (original === null || original <= 0 || current === null || current < 0) return action.setError("Enter a positive original balance and a valid current balance of zero or more.");
    if ((settlement.trim() && offered === null) || (monthlyOffer.trim() && monthly === null)) return action.setError("Enter valid offer amounts, or leave them blank if no offer exists.");
    if (status === "paid" && current !== 0) return action.setError("A paid debt must have a current balance of zero.");
    if (offered !== null && offered > current) return action.setError("The settlement offer cannot be greater than the current balance.");
    if (monthly !== null && monthly > current) return action.setError("The monthly offer cannot be greater than the current balance.");
    if (dateRemoved && dateRemoved < dateAdded) return action.setError("The removal date cannot be earlier than the added date.");
    if (dateAdded > today || dateRemoved > today) return action.setError("Added and removed dates record actual events and cannot be in the future.");
    id.current ||= financeId();
    void action.run(() => mutate("save_debt", {
      id: id.current, title: title.trim(), stage, original_creditor: originalCreditor.trim(), collector: collector.trim(),
      original_balance_cents: original, current_balance_cents: current, status, date_added: dateAdded, date_removed: dateRemoved || null,
      settlement_offer_cents: offered, offer_monthly_cents: monthly, offer_expires_on: offerExpires || null, notes: notes.trim(), change_note: changeNote.trim(),
    }), onClose);
  }
  return <FinanceDialog title={debt ? "Manage debt" : "Add credit or collection item"} onClose={close}><form onSubmit={submit} className="fn-stack fr-editor-form"><p className="fr-form-intro">Keep a clear record of the company, current balance, collection agency, and offers. Changes are saved in this item’s history. This page tracks debt records; it does not pull a credit score.</p><fieldset className="fr-fieldset" disabled={action.pending}><div className="fn-fields"><label className="fn-field"><span>Item name</span><input autoFocus maxLength={160} required value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Old medical bill" /></label><label className="fn-field"><span>Where it belongs</span><select value={stage} onChange={event => setStage(event.target.value as FinanceDebt["stage"])}><option value="collections">Collections / not on credit</option><option value="credit_report">On credit report</option></select></label><label className="fn-field"><span>Original company</span><input required maxLength={160} value={originalCreditor} onChange={event => setOriginalCreditor(event.target.value)} placeholder="Original creditor or service provider" /></label><label className="fn-field"><span>Current creditor / collection agency{stage !== "collections" && <span className="fr-optional"> optional</span>}</span><input required={stage === "collections"} maxLength={160} value={collector} onChange={event => setCollector(event.target.value)} placeholder="Who owns or collects the debt now" /></label><AmountInput label="Original balance" value={originalAmount} onChange={value => { setOriginalAmount(value); if (!balance || balance === originalAmount) setBalance(value); }} disabled={Boolean(debt)} /><AmountInput label="Current balance" value={balance} onChange={setBalance} hint="Update this if the balance changes. A history entry is kept." /><label className="fn-field"><span>Status</span><select value={status} onChange={event => { const next = event.target.value as FinanceDebt["status"]; setStatus(next); if (next === "paid") { setBalance("0.00"); setSettlement(""); setMonthlyOffer(""); setOfferExpires(""); } }}><option value="open">Open</option><option value="charged_off">Charged off</option><option value="closed">Closed</option><option value="paid">Paid</option></select><small>Closed and charged-off items can still have a balance. Marking paid sets the balance to zero.</small></label><label className="fn-field"><span>Date added</span><input type="date" required max={today} value={dateAdded} onChange={event => setDateAdded(event.target.value)} /></label><label className="fn-field full"><span>Date removed <span className="fr-optional">optional</span></span><input type="date" min={dateAdded} max={today} value={dateRemoved} onChange={event => setDateRemoved(event.target.value)} /><small>Use when this item is removed from a report or collection record. The history remains available.</small></label></div><div className="fr-editor-section"><h3>Current offers</h3><p className="fn-muted fr-small">Offers help you compare options. They do not add scheduled bills or change cash balances until you create a payment plan.</p><div className="fn-fields"><AmountInput label="Settlement amount offered" value={settlement} onChange={setSettlement} required={false} hint="Leave blank when there is no offer. Enter zero only for an explicit full waiver." /><AmountInput label="Monthly payment offered" value={monthlyOffer} onChange={setMonthlyOffer} required={false} /><label className="fn-field full"><span>Offer expires <span className="fr-optional">optional</span></span><input type="date" value={offerExpires} onChange={event => setOfferExpires(event.target.value)} /><small>Expired offers remain in the record but are excluded from current offer totals.</small></label><NotesInput value={notes} onChange={setNotes} />{debt && <label className="fn-field full"><span>Reason for this update <span className="fr-optional">optional</span></span><input maxLength={500} value={changeNote} onChange={event => setChangeNote(event.target.value)} placeholder="e.g. New offer received by mail" /></label>}</div></div></fieldset><FormError message={action.error} /><div className="fn-actions end"><button className="fn-button" type="button" disabled={action.pending} onClick={close}>Cancel</button><button className="fn-button primary" type="submit" disabled={action.pending}>{action.pending ? "Saving…" : debt ? "Save debt update" : "Add debt item"}</button></div></form>{debt && <div className="fr-editor-section"><h3>Balance & update history</h3>{history.length ? <div className="fr-history">{history.map(item => <div className="fr-history-item" key={item.id}><div><strong>{item.previous_balance_cents !== null && item.previous_balance_cents !== item.balance_cents ? <><Money cents={item.previous_balance_cents} /> <span aria-label="changed to">→</span> </> : null}<Money cents={item.balance_cents} /></strong><span>{formatDate(item.created_at.slice(0, 10))}</span><p>{item.note || "Record updated"}</p></div></div>)}</div> : <p className="fn-muted fr-small">Updates to this debt will appear here.</p>}</div>}</FinanceDialog>;
}

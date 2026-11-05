"use client";

import { financeId } from "@/lib/finance/id";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/admin/icons";
import { debtSummary, entryState, isMoved, isPastDue, matchesAccountScope, monthSummary, paidAmount, planProgress, remainingAmount } from "@/lib/finance/calculations";
import { BILL_PAYMENT_METHODS, FINANCE_CATEGORIES, FREQUENCY_LABELS, INCOME_PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type FinanceDebt, type FinanceEntry, type FinancePlan, type FinanceSeries, type PaymentMethod, type RecordsProps } from "@/lib/finance/types";
import { vendorForEntry, vendorWebsiteUrl } from "@/lib/finance/vendors";
import { EmptyState, FinanceDialog, Metric, Money, Progress, formatDate, formatMoney, monthLabel } from "./shared";
import "./records.css";

type EntryFilter = "all" | "open" | "past_due" | "moved" | "paid" | "cancelled" | "collections" | "archived";
type CollectionSource = { entry: FinanceEntry; plan?: never } | { plan: FinancePlan; entry?: never };

const stateNames = { scheduled: "Scheduled", partial: "Partly paid", past_due: "Past due", paid: "Paid", received: "Received", cancelled: "Cancelled", collections: "In collections" };
const debtStatusNames: Record<FinanceDebt["status"], string> = { open: "Open", charged_off: "Charged off", closed: "Closed", paid: "Paid" };
const expenseNames = { bill: "Bill", installment: "Installment", payment_plan: "Payment plan" };
const inMonth = (date: string, month: string) => date.startsWith(`${month}-`);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function accountName(data: RecordsProps["data"], accountId?: string | null): string {
  if (!accountId) return "Unassigned";
  const account = (data.accounts ?? []).find(item => item.id === accountId && item.user_id === data.user.id);
  return account ? `${account.name}${account.last_four ? ` · ••${account.last_four}` : ""}${account.archived_at ? " · Archived" : ""}` : "Saved account";
}

function MethodFilter({ kind, value, onChange }: { kind: "bill" | "income"; value: PaymentMethod | "all"; onChange: (value: PaymentMethod | "all") => void }) {
  const methods = kind === "income" ? INCOME_PAYMENT_METHODS : BILL_PAYMENT_METHODS;
  return <label><span className="fr-sr-only">{kind === "income" ? "Income method filter" : "Payment method filter"}</span><select value={value} onChange={event => onChange(event.target.value as PaymentMethod | "all")}><option value="all">All {kind === "income" ? "income" : "payment"} methods</option>{methods.map(method => <option key={method} value={method}>{PAYMENT_METHOD_LABELS[method]}</option>)}</select></label>;
}

function AccountScopeHelp({ props }: { props: RecordsProps }) {
  return props.accountScope === undefined || props.accountScope === "all" ? null : <p className="fr-scope-help"><Icon name="info" size={14} /><span>Lists show the account assigned to each bill or income. Actual payment totals use the account recorded with the transaction. A bill’s paid progress includes payments from every account.</span></p>;
}

function repeatLabel(series: FinanceSeries): string {
  if (series.frequency !== "custom") return FREQUENCY_LABELS[series.frequency];
  if (series.custom_mode === "month_days") {
    const days = series.custom_month_days;
    return `Monthly · ${days.length > 4 ? `${days.length} selected days` : `${days.length === 1 ? "day" : "days"} ${days.join(", ")}`}`;
  }
  return `${series.custom_dates.length} selected calendar ${series.custom_dates.length === 1 ? "date" : "dates"}`;
}

function useRecordAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  async function run(work: () => Promise<void>, done?: () => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try { await work(); done?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This change could not be saved. Please try again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  return { pending, error, setError, run };
}

function ErrorNotice({ message }: { message: string }) {
  return message ? <div className="fn-notice error" role="alert"><Icon name="alert" size={17} />{message}</div> : null;
}

function EntryBadge({ entry, data, today }: Pick<RecordsProps, "data" | "today"> & { entry: FinanceEntry }) {
  const state = entryState(entry, data.payments, today);
  const positive = state === "paid" || state === "received";
  const tone = positive ? "positive" : state === "past_due" ? "negative" : state === "partial" ? "warning" : state === "collections" ? "purple" : "";
  const label = entry.kind === "income" && state === "past_due" ? "Overdue income" : entry.kind === "income" && state === "partial" ? "Partly received" : stateNames[state];
  return <div className="fr-badges"><span className={`fn-badge ${tone}`}>{positive && <Icon name="check" size={11} />}{label}</span>{entry.archived_at && <span className="fn-badge">Archived</span>}</div>;
}

function SearchField({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return <label className="fr-search"><Icon name="search" size={16} /><input type="search" aria-label={label} placeholder={label} value={value} onChange={event => onChange(event.target.value)} /></label>;
}

function EntryTable({ entries, props, transfer }: { entries: FinanceEntry[]; props: RecordsProps; transfer?: (entry: FinanceEntry) => void }) {
  const { data, today, openEntry, openPayment, openMove } = props;
  const income = entries[0]?.kind === "income";
  return <div className="fn-table-wrap"><table className="fn-table fr-entry-table"><thead><tr><th>{income ? "Income" : "Bill"}</th><th>Due & planned date</th><th className="numeric">Amount</th><th className="numeric">{income ? "Received / remaining" : "Paid / remaining"}</th><th>Status</th><th><span className="fr-sr-only">Actions</span></th></tr></thead><tbody>{entries.map(entry => {
    const paid = paidAmount(entry, data.payments);
    const remaining = remainingAmount(entry, data.payments);
    const actionable = entry.status === "active" && remaining > 0;
    const series = entry.series_id ? data.series.find(item => item.id === entry.series_id) : undefined;
    const vendor = vendorForEntry(data, entry);
    const website = vendorWebsiteUrl(vendor?.url);
    return <tr key={entry.id} className={entry.status !== "active" ? "fr-row-inactive" : ""}>
      <td data-label={income ? "Income" : "Bill"}><button type="button" className="fr-record-title" onClick={() => openEntry(entry)}>{entry.title}</button><small>{entry.category}{entry.kind === "bill" && entry.expense_type !== "bill" ? ` · ${expenseNames[entry.expense_type]}` : ""}</small>{vendor && <small className="fr-record-vendor"><span>{vendor.name}</span>{website && <a href={website} target="_blank" rel="noopener noreferrer" className="fr-vendor-link">Website <Icon name="external" size={10} /><span className="fr-sr-only"> for {vendor.name}, opens in a new tab</span></a>}</small>}<small className="fr-account-method"><Icon name="wallet" size={11} /><span>{accountName(data, entry.account_id)} · {PAYMENT_METHOD_LABELS[entry.payment_method ?? "manual"]}</span></small>{series && <small className="fr-repeat"><Icon name="refresh" size={10} />{repeatLabel(series)}{series.active ? "" : " · Paused"}</small>}</td>
      <td data-label="Due & planned date"><span className={isPastDue(entry, data.payments, today) ? "fn-negative" : ""}>{formatDate(entry.original_due_date)}</span>{isMoved(entry) ? <small className="fr-moved"><span className="fn-badge purple">Moved</span>{formatDate(entry.scheduled_date)}</small> : <small>Planned on due date</small>}</td>
      <td data-label="Amount" className="numeric"><Money cents={entry.amount_cents} />{entry.original_amount_cents !== entry.amount_cents && <small>Originally {formatMoney(entry.original_amount_cents)}</small>}</td>
      <td data-label={income ? "Received / remaining" : "Paid / remaining"} className="numeric"><span className={paid > 0 ? "fn-positive" : "fn-muted"}><Money cents={paid} /></span><small>{entry.status === "active" ? `${formatMoney(remaining)} left` : entry.status === "collections" ? "Balance tracked in collections" : "Remaining schedule cancelled"}</small></td>
      <td data-label="Status"><EntryBadge entry={entry} data={data} today={today} /></td>
      <td data-label="Actions"><div className="fn-actions fr-entry-actions">{actionable && <><button type="button" className="fn-button small primary" onClick={() => openPayment(entry)}>{income ? "Receive" : "Pay"}</button><button type="button" className="fn-button small" onClick={() => openMove(entry)} aria-label={`Move ${entry.title}`}><Icon name="calendar" size={12} />Move</button></>}<button type="button" className="fn-button small subtle" onClick={() => openEntry(entry)}>Manage</button>{actionable && transfer && !entry.plan_id && <button type="button" className="fr-text-button fr-collection-link" onClick={() => transfer(entry)}>To collections</button>}</div></td>
    </tr>;
  })}</tbody></table></div>;
}

function TransferCollectionsDialog({ source, props, onClose }: { source: CollectionSource; props: RecordsProps; onClose: () => void }) {
  const [collector, setCollector] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const id = useRef("");
  const action = useRecordAction();
  const currentEntry = source.entry ? props.data.entries.find(entry => entry.id === source.entry.id) ?? source.entry : undefined;
  const currentPlan = source.plan ? props.data.plans.find(plan => plan.id === source.plan.id) ?? source.plan : undefined;
  const title = currentEntry?.title ?? currentPlan!.title;
  const currentProgress = currentPlan ? planProgress(currentPlan, props.data) : undefined;
  const remaining = currentEntry ? remainingAmount(currentEntry, props.data.payments) : Math.max(0, currentProgress!.remaining_cents - currentProgress!.collections_remaining_cents);
  const close = () => { if (!action.pending) onClose(); };
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!collector.trim()) return action.setError("Enter the collection company or the current debt owner.");
    if (!confirmed) return action.setError("Confirm the transfer before continuing.");
    id.current ||= financeId();
    void action.run(() => props.mutate("transfer_collections", { id: id.current, ...(currentEntry ? { entry_id: currentEntry.id } : { plan_id: currentPlan!.id }), collector: collector.trim(), notes }), () => { props.notify(`${title} is now tracked in Credit & collections.`); onClose(); });
  }
  return <FinanceDialog title="Move to collections" onClose={close}><form className="fr-form" onSubmit={submit}><div className="fr-payment-summary"><div><span>{currentPlan ? "Entire payment plan" : "Bill"}</span><strong>{title}</strong></div><div><span>Remaining balance</span><strong><Money cents={remaining} /></strong></div></div><div className="fn-notice warning"><Icon name="info" size={17} /><span>This moves the remaining balance to Credit & collections. {currentPlan ? "Unpaid installments in this plan stop appearing in your cash forecast." : "The unpaid bill stops appearing in your cash forecast."} Original due dates and past payments stay in your history. This records your debt&apos;s status; it does not contact or pay a collector.</span></div><label className="fn-field"><span>Collection company / current debt owner</span><input required maxLength={160} disabled={action.pending} value={collector} onChange={event => setCollector(event.target.value)} placeholder="Who now handles this debt?" /></label><label className="fn-field"><span>Notes <span className="fr-optional">optional</span></span><textarea maxLength={4000} rows={3} disabled={action.pending} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Reference number, transfer date, or contact details" /></label><label className="fr-confirm-check"><input type="checkbox" required disabled={action.pending} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>I confirm this {currentPlan ? "plan" : "bill"} is in collections and want to transfer the remaining {formatMoney(remaining)}.</span></label><ErrorNotice message={action.error} /><div className="fn-actions end"><button type="button" className="fn-button" disabled={action.pending} onClick={close}>Cancel</button><button type="submit" className="fn-button primary" disabled={action.pending || !confirmed || remaining <= 0}>{action.pending ? "Moving…" : "Confirm transfer"}</button></div></form></FinanceDialog>;
}

function matchesFilter(entry: FinanceEntry, filter: EntryFilter, props: RecordsProps) {
  const remaining = remainingAmount(entry, props.data.payments);
  if (filter === "archived") return Boolean(entry.archived_at);
  if (filter === "past_due") return isPastDue(entry, props.data.payments, props.today);
  if (entry.archived_at) return false;
  if (filter === "open") return entry.status === "active" && remaining > 0;
  if (filter === "moved") return isMoved(entry);
  if (filter === "paid") return entry.status === "active" && remaining === 0;
  if (filter === "cancelled" || filter === "collections") return entry.status === filter;
  return true;
}

export function BillsPanel(props: RecordsProps) {
  const { data, month, today, openEntry, accountScope = "all" } = props;
  const [filter, setFilter] = useState<EntryFilter>("all");
  const [method, setMethod] = useState<PaymentMethod | "all">("all");
  const [dateView, setDateView] = useState<"original" | "planned">("original");
  const [search, setSearch] = useState("");
  const [transfer, setTransfer] = useState<CollectionSource | null>(null);
  const summary = useMemo(() => monthSummary(data, month, today, accountScope), [data, month, today, accountScope]);
  const allMonths = filter === "past_due" || filter === "archived";
  const entries = data.entries.filter(entry => entry.kind === "bill" && matchesAccountScope(entry.account_id, accountScope) && (method === "all" || (entry.payment_method ?? "manual") === method) && matchesFilter(entry, filter, props) && (allMonths || inMonth(dateView === "original" ? entry.original_due_date : entry.scheduled_date, month)) && `${entry.title} ${entry.category} ${vendorForEntry(data, entry)?.name ?? ""}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.original_due_date.localeCompare(b.original_due_date) || a.title.localeCompare(b.title));
  const groups = Array.from(new Set(entries.map(entry => entry.category))).sort((a, b) => {
    const first = (FINANCE_CATEGORIES as readonly string[]).indexOf(a), second = (FINANCE_CATEGORIES as readonly string[]).indexOf(b);
    return (first === -1 ? 100 : first) - (second === -1 ? 100 : second) || a.localeCompare(b);
  });
  const originalActive = data.entries.filter(entry => entry.kind === "bill" && matchesAccountScope(entry.account_id, accountScope) && entry.status === "active" && inMonth(entry.original_due_date, month));
  const paidCount = originalActive.filter(entry => remainingAmount(entry, data.payments) === 0).length;
  const filteredTotal = sum(entries.filter(entry => entry.status === "active").map(entry => entry.amount_cents));
  const filteredRemaining = sum(entries.filter(entry => entry.status === "active").map(entry => remainingAmount(entry, data.payments)));
  return <div className="fn-stack"><div className="fn-metrics"><Metric title="Original monthly bills" cents={summary.original_bills_cents} detail="Before moves, cancellations, or transfers" icon="book" /><Metric title="Planned cash out this month" cents={summary.scheduled_bills_cents} detail="Paid this month + remaining scheduled" icon="calendar" /><Metric title="Paid toward this month" cents={summary.original_paid_cents} detail={`${paidCount} of ${originalActive.length} active bills paid in full`} icon="check" tone="green" /><Metric title="Past due · all months" cents={summary.past_due_cents} detail="Based on the original due date" icon="alert" tone="red" onClick={() => setFilter("past_due")} /></div>
    <section className="fn-panel"><div className="fn-panel-head"><div><h2>{monthLabel(month)} payment progress</h2><p>Moving a bill keeps its original month visible here.</p></div><span className="fn-badge purple">{paidCount} / {originalActive.length} paid</span></div><div className="fn-panel-body"><Progress value={summary.original_progress_percent} label={`${formatMoney(summary.original_paid_cents)} of ${formatMoney(summary.original_payable_cents)} active bills paid`} /><div className="fr-progress-breakdown"><span><strong>{formatMoney(summary.original_remaining_cents)}</strong> still owed for this month</span>{summary.moved_out_cents > 0 && <span><strong>{formatMoney(summary.moved_out_cents)}</strong> moved to another month</span>}{summary.original_cancelled_cents > 0 && <span><strong>{formatMoney(summary.original_cancelled_cents)}</strong> original bills cancelled</span>}{summary.original_collections_cents > 0 && <span><strong>{formatMoney(summary.original_collections_cents)}</strong> original bills transferred</span>}</div></div></section>
    <div className="fr-toolbar"><SearchField value={search} onChange={setSearch} label="Search bills or categories" /><div className="fr-toolbar-controls"><MethodFilter kind="bill" value={method} onChange={setMethod} /><label><span className="fr-sr-only">Bill month view</span><select value={dateView} onChange={event => setDateView(event.target.value as "original" | "planned")} disabled={allMonths}><option value="original">Original due month</option><option value="planned">Planned payment month</option></select></label><label><span className="fr-sr-only">Bill status</span><select value={filter} onChange={event => setFilter(event.target.value as EntryFilter)}><option value="all">All statuses</option><option value="open">Unpaid & partly paid</option><option value="past_due">Past due · all months</option><option value="moved">Moved bills</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option><option value="collections">Transferred to collections</option><option value="archived">Archive · all months</option></select></label><button type="button" className="fn-button primary" onClick={() => openEntry(undefined, "bill")}><Icon name="plus" size={15} />Add bill</button></div></div>
    <AccountScopeHelp props={props} /><div className="fr-list-context"><span>{allMonths ? filter === "past_due" ? "Every overdue bill, including archived records. Moving a bill does not erase its original due date." : "Archived bills across all months. Archive keeps payments and balances in your history." : dateView === "original" ? `Bills originally due in ${monthLabel(month)}, including those moved out.` : `Bills planned for ${monthLabel(month)}, including bills moved in from other months.`}</span><strong>{entries.length} {entries.length === 1 ? "bill" : "bills"}</strong></div>
    {groups.length ? <div className="fr-groups">{groups.map(category => {
      const categoryEntries = entries.filter(entry => entry.category === category);
      const active = categoryEntries.filter(entry => entry.status === "active");
      return <section className="fn-panel" key={category}><div className="fn-panel-head"><div><h2>{category}</h2><p>{categoryEntries.length} {categoryEntries.length === 1 ? "bill" : "bills"} · {active.filter(entry => remainingAmount(entry, data.payments) === 0).length} paid</p></div><div className="fr-category-total"><strong><Money cents={sum(active.map(entry => entry.amount_cents))} /></strong><small>{formatMoney(sum(active.map(entry => remainingAmount(entry, data.payments))))} remaining</small></div></div><EntryTable entries={categoryEntries} props={props} transfer={entry => setTransfer({ entry })} /></section>;
    })}<div className="fr-total-bar"><span>Displayed active bills <small>Totals follow the current filters. The original monthly total stays above.</small></span><div><strong><Money cents={filteredTotal} /></strong><small>{formatMoney(filteredRemaining)} remaining</small></div></div></div> : <section className="fn-panel"><EmptyState title={data.entries.some(entry => entry.kind === "bill") ? "No bills match this view" : "Give your month a clear starting point"} description={data.entries.some(entry => entry.kind === "bill") ? "Change the month or filters to find your bills. Past due and Archive include every month." : "Add your rent, utilities, subscriptions, and other bills. You can move a payment date while keeping its original due date."} action={<button type="button" className="fn-button primary" onClick={() => openEntry(undefined, "bill")}><Icon name="plus" size={15} />Add a bill</button>} /></section>}
    <div className="fn-notice"><Icon name="info" size={17} /><span><strong>Bills are your commitments.</strong> Everyday spending and what-if purchases have their own column in Live Money. Manage a bill to edit its details, cancel it, archive it, or review its payment history.</span></div>
    {transfer && <TransferCollectionsDialog source={transfer} props={props} onClose={() => setTransfer(null)} />}</div>;
}

export function IncomePanel(props: RecordsProps) {
  const { data, month, today, openEntry, mutate, notify, accountScope = "all" } = props;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<EntryFilter>("all");
  const [method, setMethod] = useState<PaymentMethod | "all">("all");
  const action = useRecordAction();
  const summary = useMemo(() => monthSummary(data, month, today, accountScope), [data, month, today, accountScope]);
  const allMonths = filter === "past_due" || filter === "archived";
  const entries = data.entries.filter(entry => entry.kind === "income" && matchesAccountScope(entry.account_id, accountScope) && (method === "all" || (entry.payment_method ?? "manual") === method) && matchesFilter(entry, filter, props) && (allMonths || inMonth(entry.scheduled_date, month) || inMonth(entry.original_due_date, month) || data.payments.some(payment => payment.entry_id === entry.id && !payment.reversed_at && inMonth(payment.paid_on, month))) && `${entry.title} ${entry.category} ${vendorForEntry(data, entry)?.name ?? ""}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || a.title.localeCompare(b.title));
  const overdue = sum(data.entries.filter(entry => entry.kind === "income" && matchesAccountScope(entry.account_id, accountScope) && isPastDue(entry, data.payments, today)).map(entry => remainingAmount(entry, data.payments)));
  const series = data.series.filter(item => item.kind === "income" && matchesAccountScope(item.account_id, accountScope));
  return <div className="fn-stack"><div className="fn-metrics"><Metric title="This month’s income forecast" cents={summary.income_cents} detail="Received + still expected this month" icon="wallet" tone="green" /><Metric title="Received this month" cents={summary.received_income_cents} detail="Recorded on the actual receipt date" icon="check" tone="green" /><Metric title="Still expected this month" cents={summary.expected_income_cents} detail="Outstanding scheduled income" icon="calendar" /><Metric title="Overdue income · all months" cents={overdue} detail="Expected date has passed" icon="clock" tone="amber" onClick={() => setFilter("past_due")} /></div>
    <div className="fr-toolbar"><SearchField value={search} onChange={setSearch} label="Search income" /><div className="fr-toolbar-controls"><MethodFilter kind="income" value={method} onChange={setMethod} /><label><span className="fr-sr-only">Income status</span><select value={filter} onChange={event => setFilter(event.target.value as EntryFilter)}><option value="all">All statuses</option><option value="open">Expected & partly received</option><option value="paid">Fully received</option><option value="past_due">Overdue · all months</option><option value="moved">Moved</option><option value="cancelled">Cancelled</option><option value="archived">Archive · all months</option></select></label><button type="button" className="fn-button primary" onClick={() => openEntry(undefined, "income")}><Icon name="plus" size={15} />Add income</button></div></div>
    <AccountScopeHelp props={props} /><section className="fn-panel"><div className="fn-panel-head"><div><h2>{allMonths ? filter === "archived" ? "Income archive" : "Overdue income" : `${monthLabel(month)} income`}</h2><p>{allMonths ? "All months are included in this view." : "Income expected, originally due, or received this month. Confirm receipts when money arrives."}</p></div><span className="fn-badge">{entries.length} records</span></div>{entries.length ? <EntryTable entries={entries} props={props} /> : <EmptyState title="Make room for your next payday" description="Add income and its expected date. Repeat on a regular schedule or choose your own dates." action={<button type="button" className="fn-button primary" onClick={() => openEntry(undefined, "income")}>Add income</button>} />}</section>
    {series.length > 0 && <section className="fn-panel"><div className="fn-panel-head"><div><h2>Repeating income</h2><p>Pausing stops new occurrences and keeps existing income. Resuming generates missed occurrences from the original schedule, including dates while paused. Cancel any occurrences that no longer apply.</p></div><Icon name="refresh" size={18} /></div><div className="fn-panel-body fr-series-list">{series.map(item => <div className="fr-series-row" key={item.id}><div><strong>{item.title}</strong><span>{repeatLabel(item)} · {formatMoney(item.amount_cents)}{item.end_date ? ` · Until ${formatDate(item.end_date)}` : ""}</span><small>{accountName(data, item.account_id)} · {PAYMENT_METHOD_LABELS[item.payment_method ?? "manual"]}</small></div><div className="fn-actions"><span className={`fn-badge ${item.active ? "positive" : ""}`}>{item.active ? "Repeating" : "Paused"}</span><button type="button" className="fn-button small" disabled={action.pending} onClick={() => void action.run(() => mutate("save_series", { id: item.id, active: !item.active }), () => notify(item.active ? "Repeating income paused. Existing occurrences are unchanged." : "Repeating income resumed. Review missed occurrences and cancel any that no longer apply."))}>{item.active ? "Pause" : "Resume"}</button></div></div>)}<ErrorNotice message={action.error} /></div></section>}
    <div className="fn-notice"><Icon name="info" size={17} /><span>Scheduled income is a forecast. Recording a receipt uses the date the money arrived and reduces the remaining expected amount. You can record part of an income payment and receive the rest later.</span></div></div>;
}

function PlanCard({ plan, props, transfer }: { plan: FinancePlan; props: RecordsProps; transfer: (plan: FinancePlan) => void }) {
  const { data, month, today, mutate, notify, openPlan, openPayment, accountScope = "all" } = props;
  const [confirmCancel, setConfirmCancel] = useState(false);
  const action = useRecordAction();
  const progress = planProgress(plan, data);
  const scoped = accountScope !== "all";
  const allChildren = data.entries.filter(entry => entry.plan_id === plan.id).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || a.original_due_date.localeCompare(b.original_due_date));
  const children = allChildren.filter(entry => matchesAccountScope(entry.account_id, accountScope));
  const childIds = new Set(allChildren.map(entry => entry.id));
  const monthlyRemaining = plan.status === "active" ? sum(children.filter(entry => entry.status === "active" && inMonth(entry.scheduled_date, month)).map(entry => remainingAmount(entry, data.payments))) : 0;
  const actualThisMonth = sum(data.payments.filter(payment => !payment.reversed_at && inMonth(payment.paid_on, month) && childIds.has(payment.entry_id) && matchesAccountScope(payment.account_id, accountScope)).map(payment => payment.amount_cents));
  const paidCount = allChildren.filter(entry => entry.status === "active" && remainingAmount(entry, data.payments) === 0).length;
  const scopedPastDue = plan.status === "active" ? sum(children.filter(entry => isPastDue(entry, data.payments, today)).map(entry => remainingAmount(entry, data.payments))) : 0;
  const nextEntry = plan.status === "active" ? children.find(entry => entry.status === "active" && remainingAmount(entry, data.payments) > 0) : undefined;
  const state = plan.status === "collections" ? "In collections" : plan.status === "cancelled" ? "Cancelled" : progress.remaining_cents === 0 ? "Completed" : "Active";
  return <section className="fn-panel fr-plan-card">
    <div className="fn-panel-head"><div className="fr-plan-title"><span className="fr-plan-icon"><Icon name="layers" size={19} /></span><div><h2>{plan.title}</h2><p>{plan.creditor} · {expenseNames[plan.kind]}</p><p className="fr-plan-account">Default: {accountName(data, plan.account_id)} · {PAYMENT_METHOD_LABELS[plan.payment_method ?? "manual"]}</p></div></div><div className="fr-badges"><span className={`fn-badge ${state === "Completed" ? "positive" : state === "Active" ? "purple" : ""}`}>{state}</span>{scopedPastDue > 0 && <span className="fn-badge negative">{formatMoney(scopedPastDue)} past due{scoped ? " in this account" : ""}</span>}</div></div>
    <div className="fn-panel-body">
      {scoped ? <p className="fr-plan-scope-note">The agreement totals and progress below include every account. This month’s cash total and the schedule list follow your selected account.</p> : null}
      <div className="fr-plan-stats"><div><span>{scoped ? "Whole agreement" : "Total plan"}</span><strong><Money cents={plan.total_amount_cents} /></strong></div><div><span>Paid to date{scoped ? " · whole agreement" : ""}</span><strong className="fn-positive"><Money cents={progress.paid_cents} /></strong></div><div><span>Unpaid agreement balance</span><strong><Money cents={progress.remaining_cents} /></strong></div><div><span>Planned this month{scoped ? " · selected account" : ""}</span><strong><Money cents={monthlyRemaining + actualThisMonth} /></strong></div></div>
      <Progress value={progress.percent} label={`${formatMoney(progress.paid_cents)} paid of ${formatMoney(plan.total_amount_cents)}${scoped ? " · whole agreement" : ""}`} />
      <div className="fr-plan-meta"><span>{formatMoney(plan.installment_amount_cents)} · {FREQUENCY_LABELS[plan.frequency].toLowerCase()}</span><span>{paidCount} / {allChildren.length} scheduled payments paid</span><span>{formatMoney(progress.active_remaining_cents)} still scheduled{scoped ? " across all accounts" : ""}</span>{progress.cancelled_remaining_cents > 0 && <span>{formatMoney(progress.cancelled_remaining_cents)} cancelled from schedule</span>}{progress.collections_remaining_cents > 0 && <span>{formatMoney(progress.collections_remaining_cents)} transferred to collections</span>}{plan.opening_paid_cents > 0 && <span>{formatMoney(plan.opening_paid_cents)} paid before tracking</span>}</div>
      {nextEntry && <div className="fr-next-payment"><span><Icon name="calendar" size={15} />Next planned payment{scoped ? " in this account" : ""} <strong>{formatDate(nextEntry.scheduled_date)}</strong></span><span><Money cents={remainingAmount(nextEntry, data.payments)} />{isMoved(nextEntry) && <span className="fn-badge purple">Moved</span>}<button type="button" className="fn-button small primary" onClick={() => openPayment(nextEntry)}>Record payment</button></span></div>}
      {plan.notes && <p className="fr-plan-note">{plan.notes}</p>}
      <div className="fn-actions fr-plan-actions"><button type="button" className="fn-button small" onClick={() => openPlan(plan)}><Icon name="edit" size={12} />{scoped ? "Manage whole plan" : "Manage plan"}</button>{plan.status === "active" && progress.remaining_cents - progress.collections_remaining_cents > 0 && <><button type="button" className="fn-button small subtle" onClick={() => transfer(plan)}>{scoped ? "Move whole plan to collections" : "Move plan to collections"}</button><button type="button" className="fr-text-button" onClick={() => setConfirmCancel(true)}>Cancel {scoped ? "entire " : ""}remaining schedule</button></>}{plan.status === "cancelled" && <button type="button" className="fn-button small" disabled={action.pending} onClick={() => void action.run(() => mutate("plan_status", { id: plan.id, status: "active" }), () => notify("Payment plan restored. Review the dates of its remaining payments."))}>Restore {scoped ? "whole " : ""}schedule</button>}</div>
      {confirmCancel && <div className="fr-confirm-box"><p>Cancel all remaining payments for <strong>{plan.title}</strong>, across every account? They will leave the forecast. This does not forgive the debt, remove past payments, or stop automatic charges with the creditor.</p><div className="fn-actions"><button type="button" className="fn-button small danger" disabled={action.pending} onClick={() => void action.run(() => mutate("plan_status", { id: plan.id, status: "cancelled" }), () => { setConfirmCancel(false); notify("Remaining payment schedule cancelled."); })}>{action.pending ? "Cancelling…" : "Confirm cancellation"}</button><button type="button" className="fn-button small" disabled={action.pending} onClick={() => setConfirmCancel(false)}>Keep schedule</button></div></div>}
      <ErrorNotice message={action.error} />
    </div>
    <details className="fr-plan-schedule"><summary><span><Icon name="calendar" size={15} />View & manage payment schedule</span><span>{children.length}{scoped ? ` of ${allChildren.length}` : ""} payments <Icon name="chevron" size={13} /></span></summary>{children.length ? <EntryTable entries={children} props={props} /> : <p className="fn-muted fr-schedule-empty">{scoped ? "No installments are currently assigned to this account. Recorded payments may still belong to it; choose All accounts to see the complete schedule." : "There are no installments in this plan."}</p>}</details>
  </section>;
}

export function PaymentsPanel(props: RecordsProps) {
  const { data, month, today, openPlan, openEntry, accountScope = "all" } = props;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const [transfer, setTransfer] = useState<CollectionSource | null>(null);
  const allTypedEntries = data.entries.filter(entry => entry.kind === "bill" && (entry.plan_id || entry.expense_type !== "bill"));
  const typedIds = new Set(allTypedEntries.map(entry => entry.id));
  const typedEntries = allTypedEntries.filter(entry => matchesAccountScope(entry.account_id, accountScope));
  const activeEntries = typedEntries.filter(entry => entry.status === "active" && (!entry.plan_id || data.plans.find(plan => plan.id === entry.plan_id)?.status === "active"));
  const scheduleRemaining = sum(activeEntries.filter(entry => inMonth(entry.scheduled_date, month)).map(entry => remainingAmount(entry, data.payments)));
  const paidThisMonth = sum(data.payments.filter(payment => !payment.reversed_at && inMonth(payment.paid_on, month) && typedIds.has(payment.entry_id) && matchesAccountScope(payment.account_id, accountScope)).map(payment => payment.amount_cents));
  const pastDue = sum(activeEntries.filter(entry => isPastDue(entry, data.payments, today)).map(entry => remainingAmount(entry, data.payments)));
  const activeRemaining = sum(activeEntries.map(entry => remainingAmount(entry, data.payments)));
  const activePlanCount = new Set(activeEntries.filter(entry => entry.plan_id && remainingAmount(entry, data.payments) > 0).map(entry => entry.plan_id)).size;
  const individualCount = activeEntries.filter(entry => !entry.plan_id && remainingAmount(entry, data.payments) > 0).length;
  const standalone = typedEntries.filter(entry => {
    if (entry.plan_id || entry.archived_at) return false;
    const remaining = remainingAmount(entry, data.payments);
    const matchesStatus = filter === "all" || filter === "active" && entry.status === "active" && remaining > 0 || filter === "late" && isPastDue(entry, data.payments, today) || filter === "complete" && entry.status === "active" && remaining === 0 || (filter === "cancelled" || filter === "collections") && filter === entry.status;
    return matchesStatus && (inMonth(entry.original_due_date, month) || inMonth(entry.scheduled_date, month) || isPastDue(entry, data.payments, today)) && `${entry.title} ${entry.category} ${vendorForEntry(data, entry)?.name ?? ""}`.toLowerCase().includes(search.toLowerCase());
  });
  const plans = data.plans.map(plan => {
    const children = allTypedEntries.filter(entry => entry.plan_id === plan.id);
    const childIds = new Set(children.map(entry => entry.id));
    const assigned = children.filter(entry => matchesAccountScope(entry.account_id, accountScope));
    const hasAccountHistory = data.payments.some(payment => !payment.reversed_at && childIds.has(payment.entry_id) && matchesAccountScope(payment.account_id, accountScope));
    const belongs = accountScope === "all" || assigned.length > 0 || hasAccountHistory || !children.length && matchesAccountScope(plan.account_id, accountScope);
    const progress = planProgress(plan, data);
    const late = plan.status === "active" && assigned.some(entry => isPastDue(entry, data.payments, today));
    return { plan, progress, belongs, late };
  }).filter(({ plan, progress, belongs, late }) => belongs && `${plan.title} ${plan.creditor} ${(data.vendors ?? []).find(vendor => vendor.id === plan.vendor_id)?.name ?? ""}`.toLowerCase().includes(search.toLowerCase()) && (filter === "all" || filter === "active" && plan.status === "active" && progress.remaining_cents > 0 || filter === "complete" && plan.status === "active" && progress.remaining_cents === 0 || filter === "late" && late || (filter === "cancelled" || filter === "collections") && filter === plan.status));
  return <div className="fn-stack">
    <div className="fn-metrics"><Metric title="Payments planned this month" cents={scheduleRemaining + paidThisMonth} detail="Recorded payments + remaining schedule" icon="calendar" /><Metric title="Active scheduled balance" cents={activeRemaining} detail={`${activePlanCount} plans · ${individualCount} individual expenses`} icon="layers" /><Metric title="Paid this month" cents={paidThisMonth} detail="Actual installment & plan payments" icon="check" tone="green" /><Metric title="Past-due payments" cents={pastDue} detail="All installments and payment plans" icon="alert" tone="red" onClick={() => setFilter("late")} /></div>
    <div className="fr-toolbar"><SearchField value={search} onChange={setSearch} label="Search plans or creditors" /><div className="fr-toolbar-controls"><label><span className="fr-sr-only">Payment plan status</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="active">Active plans & payments</option><option value="late">With past-due payments</option><option value="complete">Completed plans & payments</option><option value="cancelled">Cancelled schedules</option><option value="collections">Transferred to collections</option><option value="all">All plans & payments</option></select></label><button type="button" className="fn-button primary" onClick={() => openPlan()}><Icon name="plus" size={15} />Add payment plan</button></div></div>
    <AccountScopeHelp props={props} /><div className="fr-list-context"><span>Each plan preserves the unpaid agreement total across every account. Cancelled and collection amounts are separated from active scheduled payments. Individual expenses below follow the same status filter.</span><strong>{plans.length} {plans.length === 1 ? "plan" : "plans"}</strong></div>
    {plans.length ? <div className="fr-plan-grid">{plans.map(({ plan }) => <PlanCard key={plan.id} plan={plan} props={props} transfer={item => setTransfer({ plan: item })} />)}</div> : standalone.length ? null : <section className="fn-panel"><EmptyState title={data.plans.length || allTypedEntries.length ? "No payments match this view" : "A clear path through every payment"} description={data.plans.length || allTypedEntries.length ? "Try a different account, status, or search. Completed and cancelled plans stay available in their own views." : "Create an installment agreement or payment plan. We’ll lay out each payment, track partial payments, and keep the original dates when you need to move one."} action={<button type="button" className="fn-button primary" onClick={() => openPlan()}>Add a payment plan</button>} /></section>}
    {standalone.length > 0 && <section className="fn-panel"><div className="fn-panel-head"><div><h2>Individual plan expenses</h2><p>Expenses labeled as installments or payment plans, without a linked agreement. Includes this month and overdue items.</p></div><button type="button" className="fn-button small" onClick={() => openEntry(undefined, "bill")}>Add expense</button></div><EntryTable entries={standalone} props={props} transfer={entry => setTransfer({ entry })} /></section>}
    <div className="fn-notice"><Icon name="info" size={17} /><span>Open a payment schedule to pay, move, or manage any installment. Moving its date changes every finance view while preserving the original due date. A cancelled schedule or charged-off debt may still have a balance owed.</span></div>{transfer && <TransferCollectionsDialog source={transfer} props={props} onClose={() => setTransfer(null)} />}
  </div>;
}

export function DebtsPanel(props: RecordsProps) {
  const { data, today, openDebt, openPlan } = props;
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");
  const [status, setStatus] = useState("all");
  const summary = useMemo(() => debtSummary(data, today), [data, today]);
  const debts = data.debts.filter(debt => (stage === "all" || debt.stage === stage) && (status === "all" || status === "removed" && debt.date_removed !== null || debt.status === status) && `${debt.title} ${debt.original_creditor} ${debt.collector}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.current_balance_cents - a.current_balance_cents || a.title.localeCompare(b.title));
  const displayedBalance = sum(debts.map(debt => debt.current_balance_cents));
  const displayedSettlement = sum(debts.map(debt => debt.settlement_offer_cents !== null && (!debt.offer_expires_on || debt.offer_expires_on >= today) ? Math.min(debt.current_balance_cents, debt.settlement_offer_cents) : debt.current_balance_cents));
  const monthlyOffer = sum(debts.filter(debt => debt.current_balance_cents > 0 && (!debt.offer_expires_on || debt.offer_expires_on >= today)).map(debt => debt.offer_monthly_cents ?? 0));
  return <div className="fn-stack"><div className="fn-metrics"><Metric title="Tracked debt balance" cents={summary.balance_cents} detail="Credit items + collections" icon="book" /><Metric title="After current settlement offers" cents={summary.settlement_cents} detail={`${formatMoney(summary.balance_cents - summary.settlement_cents)} potential reduction`} icon="scales" tone="green" /><Metric title="Monthly amounts offered" cents={summary.monthly_offers_cents} detail="Current offers; not scheduled payments" icon="calendar" /><Metric title="In collections" cents={summary.collections_cents} detail="Current balance of collection items" icon="alert" tone="amber" /></div><div className="fr-toolbar"><SearchField value={search} onChange={setSearch} label="Search debts, companies, or collectors" /><div className="fr-toolbar-controls"><label><span className="fr-sr-only">Debt location</span><select value={stage} onChange={event => setStage(event.target.value)}><option value="all">Credit & collections</option><option value="credit_report">On credit report</option><option value="collections">Collections</option></select></label><label><span className="fr-sr-only">Debt status</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="charged_off">Charged off</option><option value="closed">Closed</option><option value="paid">Paid</option><option value="removed">Removed from report</option></select></label><button type="button" className="fn-button primary" onClick={() => openDebt()}><Icon name="plus" size={15} />Add debt item</button></div></div>
    <section className="fn-panel"><div className="fn-panel-head"><div><h2>Your debt records</h2><p>Keep original creditors, collectors, changing balances, offers, and notes together.</p></div><span className="fn-badge">{debts.length} {debts.length === 1 ? "item" : "items"}</span></div>{debts.length ? <div className="fr-debt-list">{debts.map(debt => {
      const expired = Boolean(debt.offer_expires_on && debt.offer_expires_on < today);
      const historyCount = data.debt_history.filter(item => item.debt_id === debt.id).length;
      return <article className="fr-debt-record" key={debt.id}><div className="fr-debt-main"><div><div className="fr-debt-name"><button type="button" className="fr-record-title" onClick={() => openDebt(debt)}>{debt.title}</button><span className={`fn-badge ${debt.status === "paid" ? "positive" : debt.status === "charged_off" ? "warning" : ""}`}>{debtStatusNames[debt.status]}</span></div><p>Original creditor <strong>{debt.original_creditor}</strong></p><p>Current owner / collector <strong>{debt.collector || "Not recorded"}</strong></p><div className="fr-badges"><span className={`fn-badge ${debt.stage === "collections" ? "warning" : "purple"}`}>{debt.stage === "collections" ? "Collections" : "On credit report"}</span>{(debt.source_entry_id || debt.source_plan_id) && <span className="fn-badge">Transferred from {debt.source_plan_id ? "plan" : "bill"}</span>}{debt.date_removed && <span className="fn-badge">Removed {formatDate(debt.date_removed)}</span>}</div></div><div className="fr-debt-balance"><span>Current balance</span><strong><Money cents={debt.current_balance_cents} /></strong><small>Originally {formatMoney(debt.original_balance_cents)}</small></div></div><div className="fr-debt-details"><div><span>Settlement offer</span><strong className={expired ? "fr-expired" : ""}>{debt.settlement_offer_cents !== null ? <Money cents={debt.settlement_offer_cents} /> : "No offer recorded"}</strong></div><div><span>Monthly amount offered</span><strong className={expired ? "fr-expired" : ""}>{debt.offer_monthly_cents !== null ? <Money cents={debt.offer_monthly_cents} /> : "No offer recorded"}</strong></div><div><span>{expired ? "Offer expired" : "Offer valid through"}</span><strong className={expired ? "fn-negative" : ""}>{debt.offer_expires_on ? formatDate(debt.offer_expires_on) : "No expiry recorded"}</strong></div><div><span>Date added</span><strong>{formatDate(debt.date_added)}</strong></div></div>{debt.notes && <p className="fr-debt-note">{debt.notes}</p>}<div className="fr-debt-footer"><span>{historyCount} {historyCount === 1 ? "update" : "updates"} in history{expired ? " · Expired offers are excluded from totals" : ""}</span><button type="button" className="fn-button small" onClick={() => openDebt(debt)}><Icon name="edit" size={12} />Manage & history</button></div></article>;
    })}</div> : <EmptyState title={data.debts.length ? "No debt records match this view" : "Know where every debt stands"} description={data.debts.length ? "Try another status, location, or search." : "Add a credit-report item or collection account, including balances, settlement offers, and the company currently handling it. Bills and entire payment plans can also be transferred here."} action={<button type="button" className="fn-button primary" onClick={() => openDebt()}>Add a debt item</button>} />}</section>
    {debts.length > 0 && <div className="fr-debt-totals"><div><span>Displayed debt balance</span><strong><Money cents={displayedBalance} /></strong></div><div><span>After current settlement offers</span><strong><Money cents={displayedSettlement} /></strong></div><div><span>Monthly amounts offered</span><strong><Money cents={monthlyOffer} /></strong></div></div>}
    <section className="fn-panel"><div className="fn-panel-head"><div><h2>Turn an accepted offer into a payment plan</h2><p>Offers help you compare options. When you accept terms, create a plan to put those payments on your calendar.</p></div><button type="button" className="fn-button" onClick={() => openPlan()}><Icon name="plus" size={14} />Add payment plan</button></div></section><div className="fn-notice"><Icon name="info" size={17} /><span>This is a debt organizer, not a credit score. Balances and offers are the figures you enter. Marking an item closed, charged off, or removed from a report does not erase its outstanding balance. Accepted plans and recorded payments do not automatically update these debt records; update the balance when it changes.</span></div></div>;
}

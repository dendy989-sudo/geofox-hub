"use client";

import { useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/admin/icons";
import { accountTrackingStart, dailyLedger, entryState, isMoved, matchesAccountScope, monthDays, monthOpening, parseMoney, remainingAmount, shiftMonth, type FinanceDraft, type FinanceLedgerDay } from "@/lib/finance/calculations";
import { financeId } from "@/lib/finance/id";
import { PAYMENT_METHOD_LABELS, type FinanceAccountScope, type FinanceData, type FinanceMutate, type RecordsProps } from "@/lib/finance/types";
import { BalanceChart, FinanceDialog, formatDate, formatMoney, Metric, Money, monthLabel } from "./shared";
import "./planning.css";

export interface DraftChange extends FinanceDraft { title: string }
type PlanningProps = RecordsProps & { openStartingBalance: () => void };

function scopeOf(props: Pick<RecordsProps, "accountScope">): FinanceAccountScope { return props.accountScope === undefined ? "all" : props.accountScope; }
function accountName(data: FinanceData, accountId: string | null | undefined): string {
  if (!accountId) return "Unassigned";
  const account = (data.accounts ?? []).find(item => item.user_id === data.user.id && item.id === accountId);
  return account ? `${account.name}${account.last_four ? ` · ${account.last_four}` : ""}` : "Account unavailable";
}
function scopeName(data: FinanceData, scope: FinanceAccountScope): string { return scope === "all" ? "All accounts + unassigned" : accountName(data, scope); }
function initialAccount(data: FinanceData, scope: FinanceAccountScope, allowArchived = false): string | null {
  if (scope === "all" || scope === null) return null;
  return (data.accounts ?? []).some(item => item.user_id === data.user.id && item.id === scope && (allowArchived || !item.archived_at)) ? scope : null;
}
function openDatedBalance(props: RecordsProps, date: string) {
  const scope = scopeOf(props);
  props.openBalance?.(date, scope === "all" ? undefined : scope);
}
function AccountField({ data, value, onChange, allowArchived = false }: { data: FinanceData; value: string | null; onChange: (value: string | null) => void; allowArchived?: boolean }) {
  const accounts = (data.accounts ?? []).filter(item => item.user_id === data.user.id && (allowArchived || !item.archived_at || item.id === value));
  return <label className="fn-field"><span>Account</span><select value={value ?? ""} onChange={event => onChange(event.target.value || null)}>
    <option value="">Unassigned</option>{accounts.map(account => <option key={account.id} value={account.id}>{accountName(data, account.id)}{account.archived_at ? " · Archived" : ""}</option>)}
  </select><small>Choose the account this amount belongs to. Unassigned keeps your original monthly balance.</small></label>;
}
function TrackingNotice({ data, month, accountScope }: { data: FinanceData; month: string; accountScope: FinanceAccountScope }) {
  if (accountScope === null || accountScope === "all") return null;
  const start = accountTrackingStart(data, accountScope);
  return start && start > `${month}-01` ? <p className="fn-notice fp-tracking-note"><Icon name="info" size={16} /><span>Balance tracking starts {formatDate(start)}. Earlier recorded payments stay in history; this account’s forecast begins on its first opening or dated balance update. Move older unpaid bills to a current planned date to include them in the forecast.</span></p> : null;
}

export function StartingBalanceEditor({ data, month, mutate, onClose, accountScope = "all" }: { data: FinanceData; month: string; mutate: FinanceMutate; onClose: () => void; accountScope?: FinanceAccountScope }) {
  const [accountId, setAccountId] = useState<string | null>(() => initialAccount(data, accountScope, true));
  const [value, setValue] = useState(() => (monthOpening(data, month, initialAccount(data, accountScope, true)) / 100).toFixed(2));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const inFlight = useRef(false), newId = useRef("");
  const date = `${month}-01`;
  const update = (data.balance_updates ?? []).find(item => item.user_id === data.user.id && item.account_id === accountId && item.date === date);
  const account = (data.accounts ?? []).find(item => item.id === accountId && item.user_id === data.user.id);
  const previousMonth = shiftMonth(month, -1);
  const previous = dailyLedger(data, previousMonth, { accountScope: accountId }).at(-1)?.ending_cents ?? 0;
  function chooseAccount(next: string | null) { setAccountId(next); setValue((monthOpening(data, month, next) / 100).toFixed(2)); setError(""); newId.current = ""; }
  const close = () => { if (!inFlight.current) onClose(); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const amount = parseMoney(value, true);
    if (amount === null) { setError("Enter a valid starting balance with up to two decimal places."); return; }
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (accountId !== null || update) {
        newId.current ||= financeId();
        await mutate("save_balance_update", { id: update?.id ?? newId.current, account_id: accountId, date, balance_cents: amount, notes: update?.notes ?? "Monthly starting balance." });
      } else await mutate("save_month", { month, opening_balance_cents: amount });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The balance could not be saved."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <FinanceDialog title={`Starting balance · ${monthLabel(month)}`} onClose={close}>
    <form onSubmit={submit} className="fn-stack">
      <p className="fn-form-help">Set one account’s balance at the start of {formatDate(date)}, before that day’s transactions. The combined view adds each account and the unassigned balance.</p>
      <fieldset className="fp-fieldset" disabled={busy}><div className="fn-fields">
        <AccountField data={data} value={accountId} onChange={chooseAccount} allowArchived />
        <label className="fn-field"><span>Starting balance (USD)</span><input type="text" inputMode="decimal" required value={value} onChange={event => setValue(event.target.value)} autoFocus /><small>{account?.kind === "credit_card" ? "Enter an amount owed as a negative balance. A payment to this card is an account transfer." : "Negative balances are allowed. This is a manually tracked balance."}</small></label>
      </div></fieldset>
      <p className="fn-form-help">{accountId === null ? update ? "A dated update already exists on the first day. Saving edits that update so the opening you see takes effect." : "Unassigned has an explicit opening for each month. It does not automatically carry a prior month’s projection." : "This saves a dated balance update. Earlier dates stay unchanged, and later balances recalculate from this opening."}</p>
      <div className="fn-notice fp-carry"><div><strong>Continue from last month</strong><p>{monthLabel(previousMonth)} projects {formatMoney(previous)} for {accountName(data, accountId)}, excluding Live Money scenarios. Review the forecast before using it as your starting balance.</p><button className="fn-button small" type="button" disabled={busy} onClick={() => setValue((previous / 100).toFixed(2))}>Use this amount</button></div></div>
      {error ? <p className="fn-form-error" role="alert">{error}</p> : null}
      <div className="fn-actions end"><button type="button" className="fn-button" disabled={busy} onClick={close}>Cancel</button><button className="fn-button primary" disabled={busy}>{busy ? "Saving…" : "Save starting balance"}</button></div>
    </form>
  </FinanceDialog>;
}

function AnchorDetails({ day, data, edit }: { day: FinanceLedgerDay; data: FinanceData; edit?: (accountId: string | null) => void }) {
  if (!day.balance_updates.length && !day.account_openings.length) return null;
  const corrected = new Set(day.balance_updates.map(update => update.account_id));
  return <div className="fp-anchor-details"><strong>Starting balances set for this day</strong>
    {day.account_openings.filter(account => !corrected.has(account.id)).map(account => <div className="fp-anchor-line" key={account.id}><span>{accountName(data, account.id)} · opening</span><Money cents={account.opening_balance_cents} /></div>)}
    {day.balance_updates.map(update => <div className="fp-anchor-line" key={update.id}><span>{accountName(data, update.account_id)}{update.notes ? <small>{update.notes}</small> : null}</span><Money cents={update.balance_cents} />{edit ? <button type="button" className="fn-button small" onClick={() => edit(update.account_id)}>Edit</button> : null}</div>)}
    <p>These balances replace the prior forecast for the selected accounts before this day’s transactions. They are not income or expenses.</p>
  </div>;
}

function DayDialog({ date, props, onClose }: { date: string; props: RecordsProps; onClose: () => void }) {
  const { data, openEntry, openMove, openPayment } = props;
  const scope = scopeOf(props);
  const day = dailyLedger(data, date.slice(0, 7), { accountScope: scope }).find(item => item.date === date)!;
  const payments = data.payments.filter(payment => payment.user_id === data.user.id && payment.paid_on === date && !payment.reversed_at && matchesAccountScope(payment.account_id, scope));
  const paidIds = new Set(payments.map(payment => payment.entry_id));
  const entries = data.entries.filter(entry => entry.user_id === data.user.id && ((entry.scheduled_date === date && matchesAccountScope(entry.account_id, scope)) || paidIds.has(entry.id)));
  function handoff(action: () => void) { onClose(); action(); }
  return <FinanceDialog title={formatDate(date)} onClose={onClose}><div className="fn-stack">
    <p className="fp-scope-caption">{scopeName(data, scope)}</p>
    <div className="fp-day-summary"><span>Starting balance<strong><Money cents={day.starting_cents} /></strong></span><span>Daily change<strong><Money cents={day.net_cents} colored /></strong></span><span>Ending balance<strong><Money cents={day.ending_cents} colored /></strong></span></div>
    <div className="fn-actions"><button className="fn-button primary" onClick={() => handoff(() => openEntry(undefined, "bill", date))}><Icon name="plus" size={14} />Add bill</button><button className="fn-button" onClick={() => handoff(() => openEntry(undefined, "income", date))}><Icon name="plus" size={14} />Add income</button>{props.openBalance ? <button className="fn-button" onClick={() => handoff(() => openDatedBalance(props, date))}>Set starting balance</button> : null}{props.openTransfer ? <button className="fn-button" onClick={() => handoff(() => props.openTransfer?.(date))}>Transfer</button> : null}</div>
    <p className="fn-form-help">Saved changes update the app. Recorded payments stay with the account and method used when they were recorded, even if the remaining bill is later assigned elsewhere.</p>
    <AnchorDetails day={day} data={data} edit={props.openBalance ? accountId => handoff(() => props.openBalance?.(date, accountId)) : undefined} />
    {day.transfers.length ? <section className="fp-transfer-list"><h3>Account transfers</h3>{day.transfers.map(transfer => <div className="fp-transfer" key={transfer.id}><div><strong>{accountName(data, transfer.from_account_id)} → {accountName(data, transfer.to_account_id)}</strong><small>{transfer.status === "completed" ? "Completed" : "Planned"}{transfer.notes ? ` · ${transfer.notes}` : ""}</small></div><Money cents={transfer.amount_cents} /></div>)}<p>Transfers move money between your accounts. They do not count as income or bills.</p></section> : null}
    <div className="fn-day-items">{entries.length ? entries.map(entry => {
      const recorded = payments.filter(payment => payment.entry_id === entry.id);
      return <div className="fn-day-item" key={entry.id}>
        <div className="fn-row"><h3>{entry.title}</h3><span className={`fn-badge ${entry.kind === "income" ? "positive" : "purple"}`}>{entry.kind === "income" ? "Income" : "Bill"}</span></div>
        <p>{entry.category} · {formatMoney(entry.amount_cents)} · {entryState(entry, data.payments, props.today).replaceAll("_", " ")}</p>
        <p>Planned: {accountName(data, entry.account_id)} · {PAYMENT_METHOD_LABELS[entry.payment_method ?? "manual"]}</p>
        {isMoved(entry) ? <p>Moved to {formatDate(entry.scheduled_date)} · originally due {formatDate(entry.original_due_date)}</p> : null}
        {recorded.map(payment => <p className="fp-recorded-payment" key={payment.id}>Recorded {entry.kind === "income" ? "receipt" : "payment"}: {formatMoney(payment.amount_cents)} · {accountName(data, payment.account_id)} · {PAYMENT_METHOD_LABELS[payment.payment_method ?? "manual"]}</p>)}
        <div className="fn-actions"><button className="fn-button small" onClick={() => handoff(() => openEntry(entry))}>Edit / manage</button>{entry.status === "active" && remainingAmount(entry, data.payments) > 0 ? <><button className="fn-button small" onClick={() => handoff(() => openMove(entry))}>Move date</button><button className="fn-button primary small" onClick={() => handoff(() => openPayment(entry))}>{entry.kind === "income" ? "Record receipt" : "Record payment"}</button></> : null}</div>
      </div>;
    }) : <p className="fn-muted">No bills or income in this account view for this day.</p>}</div>
  </div></FinanceDialog>;
}

function SpendingEditor({ date, props, onClose }: { date: string; props: RecordsProps; onClose: () => void }) {
  const [id] = useState(() => financeId());
  const [amount, setAmount] = useState(""), [title, setTitle] = useState("");
  const [accountId, setAccountId] = useState<string | null>(() => initialAccount(props.data, scopeOf(props)));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const inFlight = useRef(false);
  const spending = props.data.spending.filter(item => item.user_id === props.data.user.id && item.date === date && matchesAccountScope(item.account_id, scopeOf(props)));
  const close = () => { if (!inFlight.current) onClose(); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const cents = parseMoney(amount);
    if (cents === null || cents <= 0) { setError("Enter a spending amount greater than zero."); return; }
    if (accountId && (accountTrackingStart(props.data, accountId) ?? "") > date) { setError("Add an earlier balance update or choose an account already tracked on this date."); return; }
    inFlight.current = true; setBusy(true); setError("");
    try { await props.mutate("save_spending", { id, date, amount_cents: cents, title: title.trim() || "Planned spending", account_id: accountId }); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Spending could not be saved."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function remove(spendingId: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { await props.mutate("remove_spending", { id: spendingId }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove this amount."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <FinanceDialog title={`Planning spending · ${formatDate(date)}`} onClose={close}><form onSubmit={submit} className="fn-stack">
    <p className="fn-form-help">Try groceries, a meal out, or a purchase. It affects Live Money only, and does not create a bill, a recorded payment, or funds for savings goals.</p>
    {spending.length ? <ul className="fn-list">{spending.map(item => <li key={item.id}><span className="fn-list-title">{item.title}<small className="fp-account-label">{accountName(props.data, item.account_id)}</small></span><Money cents={item.amount_cents} /><button className="fn-icon-button" type="button" aria-label={`Remove ${item.title}`} disabled={busy} onClick={() => { void remove(item.id); }}><Icon name="trash" size={14} /></button></li>)}</ul> : null}
    <fieldset className="fp-fieldset" disabled={busy}><div className="fn-fields"><AccountField data={props.data} value={accountId} onChange={setAccountId} /><label className="fn-field"><span>Amount (USD)</span><input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" autoFocus required placeholder="200.00" /></label><label className="fn-field full"><span>What is it for?</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} placeholder="Groceries, outing, purchase…" /></label></div></fieldset>
    {accountId && (accountTrackingStart(props.data, accountId) ?? "") > date ? <p className="fn-form-error">This date is before the account’s balance tracking starts. Add an earlier balance update to include this spending in the forecast.</p> : null}
    {error ? <p className="fn-form-error" role="alert">{error}</p> : null}<div className="fn-actions end"><button className="fn-button" type="button" disabled={busy} onClick={close}>Done</button><button className="fn-button primary" disabled={busy}>{busy ? "Saving…" : "Add planning spending"}</button></div>
  </form></FinanceDialog>;
}

function DraftEditor({ data, month, accountScope, onAdd, onClose }: { data: FinanceData; month: string; accountScope: FinanceAccountScope; onAdd: (change: DraftChange) => void; onClose: () => void }) {
  const [kind, setKind] = useState<"income" | "bill">("bill"), [date, setDate] = useState(`${month}-01`);
  const [accountId, setAccountId] = useState<string | null>(() => initialAccount(data, accountScope));
  const [title, setTitle] = useState(""), [amount, setAmount] = useState(""), [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault(); const cents = parseMoney(amount);
    if (cents === null || cents <= 0) { setError("Enter a positive amount with up to two decimal places."); return; }
    if (!monthDays(month).includes(date)) { setError("Choose a day in the selected month."); return; }
    if (accountId && (accountTrackingStart(data, accountId) ?? "") > date) { setError("Choose a date on or after this account’s tracking start, or save an earlier balance update first."); return; }
    onAdd({ id: financeId(), kind, date, account_id: accountId, title: title.trim() || (kind === "bill" ? "Test bill" : "Test income"), amount_cents: cents }); onClose();
  }
  return <FinanceDialog title="Try a change" onClose={onClose}><form onSubmit={submit} className="fn-stack">
    <p className="fn-form-help">Try an amount without changing saved records. “Save across app” opens its full form. Temporary changes clear on reload and never increase the money available to savings goals.</p>
    <div className="fn-fields"><label className="fn-field"><span>Type</span><select value={kind} onChange={event => setKind(event.target.value as "bill" | "income")}><option value="bill">Bill expense</option><option value="income">Income</option></select></label><AccountField data={data} value={accountId} onChange={setAccountId} /><label className="fn-field"><span>Day</span><input type="date" value={date} min={`${month}-01`} max={monthDays(month).at(-1)} onChange={event => setDate(event.target.value)} required /></label><label className="fn-field"><span>Amount (USD)</span><input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required autoFocus /></label><label className="fn-field full"><span>Label</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} /></label></div>
    {error ? <p className="fn-form-error" role="alert">{error}</p> : null}<div className="fn-actions end"><button className="fn-button" type="button" onClick={onClose}>Cancel</button><button className="fn-button primary">Try this change</button></div>
  </form></FinanceDialog>;
}

function hasAnchor(day: FinanceLedgerDay) { return day.balance_updates.length > 0 || day.account_openings.length > 0; }
function DayCard({ day, today, onManage, onBalance, onSpending }: { day: FinanceLedgerDay; today: string; onManage: () => void; onBalance?: () => void; onSpending?: () => void }) {
  return <article className={`fp-day-card${day.date === today ? " today" : ""}${hasAnchor(day) ? " adjusted" : ""}`}>
    <div className="fp-day-card-head"><button type="button" onClick={onManage}><strong>{formatDate(day.date)}</strong>{day.date === today ? <span className="fn-badge purple">Today</span> : null}</button><span className={`fn-end-balance ${day.ending_cents < 0 ? "negative" : ""}`}><Money cents={day.ending_cents} /></span></div>
    <div className="fp-day-card-start"><span>Starts at <Money cents={day.starting_cents} /></span>{hasAnchor(day) ? <span className="fp-balance-tag"><Icon name="refresh" size={11} />Balance set</span> : null}</div>
    <dl className="fp-day-amounts"><div><dt>Income</dt><dd><Money cents={day.income_cents} colored /></dd></div><div><dt>Bills</dt><dd><Money cents={day.bills_cents} /></dd></div>{onSpending ? <div><dt>Planning spending</dt><dd><button type="button" className="fn-live-spend" onClick={onSpending}><Icon name="plus" size={11} /><Money cents={day.spending_cents} /></button></dd></div> : null}<div><dt>Transfers</dt><dd><Money cents={day.transfer_cents} colored />{day.transfers.length ? <small>{day.transfers.length} {day.transfers.length === 1 ? "transfer" : "transfers"}</small> : null}</dd></div><div><dt>Daily change</dt><dd><Money cents={day.net_cents} colored /></dd></div></dl>
    <div className="fn-actions fp-day-card-actions"><button type="button" className="fn-button small" onClick={onManage}>Manage day</button>{onBalance ? <button type="button" className="fn-button small" onClick={onBalance}>Set balance</button> : null}</div>
  </article>;
}

export function LiveMoneyPanel(props: PlanningProps & { drafts: DraftChange[]; setDrafts: (update: (old: DraftChange[]) => DraftChange[]) => void; commitDraft: (draft: DraftChange) => void }) {
  const { data, month, drafts, setDrafts } = props;
  const scope = scopeOf(props);
  const [selectedDay, setSelectedDay] = useState<string | null>(null), [spendingDate, setSpendingDate] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false), [resetOpen, setResetOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const resetBusy = useRef(false);
  const baseline = dailyLedger(data, month, { accountScope: scope }), scenario = dailyLedger(data, month, { accountScope: scope, includeSpending: true, drafts });
  const changes = drafts.filter(draft => draft.date.startsWith(`${month}-`) && matchesAccountScope(draft.account_id, scope));
  const spendingTotal = data.spending.filter(item => item.user_id === data.user.id && item.date.startsWith(`${month}-`) && matchesAccountScope(item.account_id, scope)).reduce((sum, item) => sum + item.amount_cents, 0);
  const last = scenario.at(-1)?.ending_cents ?? 0, savedLast = baseline.at(-1)?.ending_cents ?? 0;
  const lowest = scenario.reduce((a, b) => a.ending_cents <= b.ending_cents ? a : b);
  async function reset() {
    if (resetBusy.current) return;
    resetBusy.current = true; setBusy(true); setError("");
    try {
      await props.mutate("clear_spending", { month, ...(scope === "all" ? {} : { account_id: scope }) });
      setDrafts(old => old.filter(draft => !draft.date.startsWith(`${month}-`) || !matchesAccountScope(draft.account_id, scope)));
      setResetOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not clear the scenario."); }
    finally { resetBusy.current = false; setBusy(false); }
  }
  return <div className="fn-stack fp-planning">
    <div className="fn-notice"><Icon name="info" size={20} /><div><strong>Bills are obligations. Spending is your planning space.</strong><p>Saved bills and income update the app. Planning spending and test changes affect only Live Money. A dated balance update sets the selected account’s starting balance before that day’s transactions.</p></div></div>
    <TrackingNotice data={data} month={month} accountScope={scope} />
    <div className="fn-metrics fp-metrics"><Metric title="Starting balance" cents={monthOpening(data, month, scope)} detail={scopeName(data, scope)} onClick={props.openStartingBalance} /><Metric title="Saved forecast ending" cents={savedLast} detail="Saved entries, transfers, and balance updates" icon="calendar" tone="cyan" /><Metric title="With your spending plan" cents={last} detail="Includes spending and temporary changes" icon="wallet" tone="green" /><Metric title="Lowest planned balance" cents={lowest.ending_cents} detail={formatDate(lowest.date)} icon="pulse" tone={lowest.ending_cents < 0 ? "red" : "purple"} /></div>
    <section className="fn-panel"><div className="fn-panel-head"><div><h2>Make room for real life</h2><p>A change carries forward until that account’s next dated balance update.</p></div><button className="fn-button subtle small" onClick={props.openStartingBalance}>Edit starting balance</button></div><div className="fn-panel-body"><BalanceChart points={scenario} baseline={baseline} label="Your Live Money plan" /></div></section>
    <section className="fn-panel"><div className="fn-toolbar"><div><h2 className="fp-month-heading">{monthLabel(month)}</h2><p className="fn-muted fp-month-caption">{scopeName(data, scope)} · Tap a date to manage saved entries.</p></div><div className="fn-actions"><button className="fn-button" onClick={() => setDraftOpen(true)}><Icon name="plus" size={14} />Try a change</button>{changes.length || spendingTotal > 0 ? <button className="fn-button subtle" onClick={() => setResetOpen(true)}>Reset scenario</button> : null}</div></div>
      <div className="fn-table-wrap fp-live-desktop"><table className="fn-table fn-live-table fp-live-table"><thead><tr><th>Day</th><th className="numeric">Income</th><th className="numeric">Bills</th><th className="numeric">Planning spending</th><th className="numeric">Transfers</th><th className="numeric">Daily change</th><th className="numeric">Ending balance</th><th>Manage</th></tr></thead><tbody>{scenario.map(day => {
        const weekday = new Date(`${day.date}T12:00:00Z`).getUTCDay();
        return <tr key={day.date} className={`${day.date === props.today ? "today " : ""}${hasAnchor(day) ? "fp-adjusted-row" : ""}`}>
          <td><button className="fn-list-button fn-day-label" onClick={() => setSelectedDay(day.date)} aria-label={`Manage ${formatDate(day.date)}`}><strong>{Number(day.date.slice(8))}</strong><span className={weekday === 0 || weekday === 6 ? "weekend" : ""}>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday]}</span>{day.date === props.today ? <span className="fn-badge purple">Today</span> : null}</button>{hasAnchor(day) ? <span className="fp-balance-tag" title="An opening balance or dated update sets an account's starting balance on this day."><Icon name="refresh" size={10} />Balance set</span> : null}</td>
          <td className="numeric"><Money cents={day.income_cents} colored /></td><td className="numeric"><Money cents={day.bills_cents} /></td><td className="numeric"><button className="fn-live-spend" onClick={() => setSpendingDate(day.date)} aria-label={`Plan spending for ${formatDate(day.date)}`}><Icon name="plus" size={11} /><Money cents={day.spending_cents} /></button></td><td className="numeric"><Money cents={day.transfer_cents} colored />{day.transfers.length ? <small>{day.transfers.length} {day.transfers.length === 1 ? "transfer" : "transfers"}</small> : null}</td><td className="numeric"><Money cents={day.net_cents} colored /></td><td className="numeric"><span className={`fn-end-balance ${day.ending_cents < 0 ? "negative" : ""}`}><Money cents={day.ending_cents} /></span><small>Start {formatMoney(day.starting_cents)}</small></td>
          <td><div className="fn-actions fp-row-actions">{props.openBalance ? <button className="fn-button small" onClick={() => openDatedBalance(props, day.date)} aria-label={`Set starting balance for ${formatDate(day.date)}`}>Set balance</button> : null}<button className="fn-icon-button" onClick={() => setSelectedDay(day.date)} aria-label={`Add or edit entries for ${formatDate(day.date)}`}><Icon name="edit" size={14} /></button></div></td>
        </tr>;
      })}</tbody></table></div>
      <div className="fp-live-mobile">{scenario.map(day => <DayCard key={day.date} day={day} today={props.today} onManage={() => setSelectedDay(day.date)} onBalance={props.openBalance ? () => openDatedBalance(props, day.date) : undefined} onSpending={() => setSpendingDate(day.date)} />)}</div>
      <div className="fn-summary-strip"><span>Planning spending<strong><Money cents={spendingTotal} /></strong></span><span>Temporary changes<strong>{changes.length}</strong></span><span>Planned ending balance<strong className={last < 0 ? "fn-negative" : "fn-positive"}><Money cents={last} /></strong></span></div>
    </section>
    {changes.length ? <section className="fn-panel"><div className="fn-panel-head"><div><h2>Your temporary changes</h2><p>These stay in this session until you save them across the app or remove them.</p></div></div><div className="fn-panel-body fn-stack">{changes.map(draft => <div className="fn-draft" key={draft.id}><div className="fn-row"><strong>{draft.title}</strong><span className="fn-badge purple">Test {draft.kind}</span></div><p>{formatDate(draft.date)} · {formatMoney(draft.amount_cents)} · {accountName(data, draft.account_id)}</p><div className="fn-actions"><button className="fn-button small" onClick={() => props.commitDraft(draft)}>Save across app</button><button className="fn-button subtle small" onClick={() => setDrafts(old => old.filter(item => item.id !== draft.id))}>Remove test</button></div></div>)}</div></section> : null}
    {selectedDay ? <DayDialog date={selectedDay} props={props} onClose={() => setSelectedDay(null)} /> : null}
    {spendingDate ? <SpendingEditor date={spendingDate} props={props} onClose={() => setSpendingDate(null)} /> : null}
    {draftOpen ? <DraftEditor data={data} month={month} accountScope={scope} onAdd={draft => setDrafts(old => [...old, draft])} onClose={() => setDraftOpen(false)} /> : null}
    {resetOpen ? <FinanceDialog title="Reset this month’s scenario?" onClose={() => { if (!resetBusy.current) setResetOpen(false); }}><div className="fn-stack"><p className="fn-form-help">Clear planning spending and temporary changes for {monthLabel(month)} in {scopeName(data, scope)}. Saved bills, income, payments, transfers, and balance updates stay in place.</p>{error ? <p className="fn-form-error" role="alert">{error}</p> : null}<div className="fn-actions end"><button className="fn-button" onClick={() => setResetOpen(false)} disabled={busy}>Keep scenario</button><button className="fn-button danger" onClick={() => { void reset(); }} disabled={busy}>{busy ? "Clearing…" : "Reset scenario"}</button></div></div></FinanceDialog> : null}
  </div>;
}

export function CalendarPanel(props: PlanningProps) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null), [view, setView] = useState<"calendar" | "list">("calendar");
  const scope = scopeOf(props);
  const ledger = dailyLedger(props.data, props.month, { accountScope: scope });
  const offset = new Date(`${props.month}-01T12:00:00Z`).getUTCDay();
  const trailing = (7 - (offset + ledger.length) % 7) % 7;
  return <div className="fn-stack fp-planning"><div className="fn-notice"><Icon name="calendar" size={20} /><div><strong>Your saved monthly schedule</strong><p>Open a day to add, record, or move entries and set its starting balance. Transfers stay separate from income and bills. Live Money scenarios are excluded.</p></div><div className="fn-actions"><button className="fn-button" onClick={props.openStartingBalance}>Starting balance <Money cents={monthOpening(props.data, props.month, scope)} /></button></div></div>
    <TrackingNotice data={props.data} month={props.month} accountScope={scope} />
    <section className="fn-panel"><div className="fn-panel-head"><div><h2>{monthLabel(props.month)}</h2><p>{scopeName(props.data, scope)} · Green is zero or above; red is below zero.</p></div><div className="fn-tabs fp-calendar-views" aria-label="Calendar layout"><button className={`fn-tab ${view === "calendar" ? "active" : ""}`} aria-pressed={view === "calendar"} onClick={() => setView("calendar")}>Month grid</button><button className={`fn-tab ${view === "list" ? "active" : ""}`} aria-pressed={view === "list"} onClick={() => setView("list")}>Daily list</button></div></div>
      <div className={`fp-calendar-month${view !== "calendar" ? " fp-view-hidden" : ""}`}><div className="fn-calendar-scroll"><div className="fn-calendar">{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(day => <div className="fn-calendar-weekday" key={day}>{day}</div>)}{Array.from({ length: offset }, (_, index) => <div key={`before-${index}`} className="fn-calendar-day blank" aria-hidden="true" />)}{ledger.map(day => <button key={day.date} className={`fn-calendar-day ${day.date === props.today ? "today" : ""}`} onClick={() => setSelectedDay(day.date)} aria-label={`${formatDate(day.date)}. Income ${formatMoney(day.income_cents)}, bills ${formatMoney(day.bills_cents)}, transfers ${formatMoney(day.transfer_cents)}, ending balance ${formatMoney(day.ending_cents)}.${hasAnchor(day) ? " Starting balance updated." : ""} Manage day.`}>
        <span className="fn-calendar-date"><strong>{Number(day.date.slice(8))}</strong><Icon name="plus" size={12} /></span>{hasAnchor(day) ? <span className="fp-balance-tag"><Icon name="refresh" size={10} />Balance set</span> : null}<span className="fn-calendar-detail"><span>Income</span><Money cents={day.income_cents} colored /></span><span className="fn-calendar-detail"><span>Bills</span><Money cents={day.bills_cents} /></span>{day.transfers.length ? <span className="fn-calendar-detail"><span>Transfers</span><Money cents={day.transfer_cents} colored /></span> : null}<span className="fn-calendar-detail"><span>Net</span><Money cents={day.net_cents} colored /></span><span className="fn-calendar-balance"><span className={`fn-end-balance ${day.ending_cents < 0 ? "negative" : ""}`}><Money cents={day.ending_cents} /></span></span>
      </button>)}{Array.from({ length: trailing }, (_, index) => <div key={`after-${index}`} className="fn-calendar-day blank" aria-hidden="true" />)}</div></div></div>
      <div className={`fp-calendar-list${view !== "list" ? " fp-view-hidden" : ""}`}>{ledger.map(day => <DayCard key={day.date} day={day} today={props.today} onManage={() => setSelectedDay(day.date)} onBalance={props.openBalance ? () => openDatedBalance(props, day.date) : undefined} />)}</div>
    </section>
    {selectedDay ? <DayDialog date={selectedDay} props={props} onClose={() => setSelectedDay(null)} /> : null}
  </div>;
}

"use client";

import { useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/admin/icons";
import { accountTrackingStart, actualAccountBalance, dailyLedger, parseMoney } from "@/lib/finance/calculations";
import { financeId } from "@/lib/finance/id";
import type { FinanceAccount, FinanceData, FinanceMutate, FinanceTransfer, RecordsProps } from "@/lib/finance/types";
import { EmptyState, FinanceDialog, formatDate, Metric, Money } from "./shared";
import "./accounts.css";

const ACCOUNT_LABELS: Record<FinanceAccount["kind"], string> = { checking: "Checking / debit card", savings: "Savings", cash: "Cash", credit_card: "Credit card" };
export function accountLabel(account: FinanceAccount): string { return `${account.name}${account.last_four ? ` · •••• ${account.last_four}` : ""}`; }
export function accountScopeLabel(data: FinanceData, scope: "all" | string | null): string {
  if (scope === "all") return "All accounts";
  if (scope === null) return "Unassigned";
  const account = data.accounts.find(item => item.id === scope);
  return account ? `${accountLabel(account)}${account.archived_at ? " · Archived" : ""}` : "Account";
}

interface AccountEditorBase { data: FinanceData; today: string; mutate: FinanceMutate; onClose: () => void; }
function useAccountAction() {
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const busy = useRef(false);
  async function run(work: () => Promise<void>, done?: () => void) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError("");
    try { await work(); done?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This change could not be saved."); }
    finally { busy.current = false; setPending(false); }
  }
  return { pending, error, setError, run };
}
function FormError({ error }: { error: string }) { return error ? <p className="fn-form-error" role="alert">{error}</p> : null; }

export function AccountEditor({ data, today, mutate, onClose, account, kind: initialKind = "checking" }: AccountEditorBase & { account?: FinanceAccount; kind?: FinanceAccount["kind"] }) {
  const [name, setName] = useState(account?.name ?? ""), [institution, setInstitution] = useState(account?.institution ?? "");
  const [kind, setKind] = useState<FinanceAccount["kind"]>(account?.kind ?? initialKind), [lastFour, setLastFour] = useState(account?.last_four ?? "");
  const [date, setDate] = useState(account?.opening_date ?? today), [balance, setBalance] = useState(account ? (account.opening_balance_cents / 100).toFixed(2) : "");
  const [limit, setLimit] = useState(account?.credit_limit_cents != null ? (account.credit_limit_cents / 100).toFixed(2) : ""), [notes, setNotes] = useState(account?.notes ?? "");
  const id = useRef(account?.id ?? ""), action = useAccountAction();
  const close = () => { if (!action.pending) onClose(); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    const cents = parseMoney(balance, true), limitCents = limit.trim() ? parseMoney(limit) : null;
    if (cents === null || (kind === "credit_card" && limit.trim() && limitCents === null)) return action.setError("Enter a valid dollar balance and, if provided, credit limit.");
    if (lastFour && !/^\d{4}$/.test(lastFour)) return action.setError("Enter exactly four digits, or leave the last four digits blank.");
    id.current ||= financeId();
    await action.run(() => mutate("save_account", { id: id.current, name: name.trim(), institution: institution.trim(), kind, last_four: lastFour || null, opening_date: date, opening_balance_cents: cents, credit_limit_cents: kind === "credit_card" ? limitCents : null, notes }), onClose);
  }
  return <FinanceDialog title={account ? "Edit account" : kind === "savings" ? "Add savings account" : "Add bank or card"} onClose={close}><form onSubmit={submit}>
    <p className="fn-form-help">Give each account a recognizable name. Use the optional last four digits to tell cards apart. A debit card belongs to its checking account.</p>
    <fieldset className="fn-fields fa-fields" disabled={action.pending}>
      <label className="fn-field"><span>Account nickname</span><input value={name} onChange={event => setName(event.target.value)} maxLength={120} required placeholder="Everyday checking" autoComplete="off" /></label>
      <label className="fn-field"><span>Account type</span><select value={kind} onChange={event => setKind(event.target.value as FinanceAccount["kind"])}>{Object.entries(ACCOUNT_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
      <label className="fn-field"><span>Bank / card issuer <small>optional</small></span><input value={institution} onChange={event => setInstitution(event.target.value)} maxLength={160} placeholder="Bank or credit union" autoComplete="off" /></label>
      <label className="fn-field"><span>Last four digits <small>optional</small></span><input type="text" inputMode="numeric" autoComplete="off" value={lastFour} onChange={event => setLastFour(event.target.value.replace(/\D/g, "").slice(0, 4))} pattern="[0-9]{4}" maxLength={4} placeholder="1234" /><small>Only the last four digits are stored.</small></label>
      <label className="fn-field"><span>Balance starts on</span><input type="date" required min="2000-01-01" max="2100-12-31" value={date} onChange={event => setDate(event.target.value)} /><small>Balance at the start of this day, before its transactions.</small></label>
      <label className="fn-field"><span>Opening balance (USD)</span><input type="text" inputMode="decimal" required value={balance} onChange={event => setBalance(event.target.value)} placeholder={kind === "credit_card" ? "-500.00" : "0.00"} autoComplete="off" /><small>{kind === "credit_card" ? "Use a negative balance for money owed, e.g. −500.00. A positive balance is a credit." : "Use a negative number if the account is overdrawn."}</small></label>
      {kind === "credit_card" ? <label className="fn-field"><span>Credit limit (USD) <small>optional</small></span><input type="text" inputMode="decimal" value={limit} onChange={event => setLimit(event.target.value)} placeholder="0.00" autoComplete="off" /></label> : null}
      <label className="fn-field full"><span>Notes <small>optional</small></span><textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={4000} /></label>
    </fieldset>
    {account ? <p className="fn-form-help">Changing the opening balance recalculates history from that date. To reconcile a later balance, choose Update balance on the account instead.</p> : <p className="fn-form-help">Existing records stay under Unassigned until you assign them to an account. Avoid counting the same opening money in both places.</p>}
    <FormError error={action.error} /><div className="fn-actions end"><button className="fn-button" type="button" onClick={close} disabled={action.pending}>Cancel</button><button className="fn-button primary" disabled={action.pending}>{action.pending ? "Saving…" : "Save account"}</button></div>
  </form></FinanceDialog>;
}

export function BalanceUpdateEditor({ data, today, mutate, onClose, date: initialDate, accountId }: AccountEditorBase & { date: string; accountId?: string | null }) {
  const [selection, setSelection] = useState(accountId === undefined ? "choose" : accountId ?? "unassigned");
  const [date, setDate] = useState(initialDate);
  const selectedId = selection === "unassigned" ? null : selection;
  const existing = selection === "choose" ? undefined : data.balance_updates.find(item => item.account_id === selectedId && item.date === date);
  const [balance, setBalance] = useState(existing ? (existing.balance_cents / 100).toFixed(2) : ""), [notes, setNotes] = useState(existing?.notes ?? "");
  const [confirmRemove, setConfirmRemove] = useState(false), action = useAccountAction(), id = useRef("");
  const close = () => { if (!action.pending) onClose(); };
  function changeSelection(value: string, newDate = date) {
    setSelection(value); setDate(newDate); setConfirmRemove(false); id.current = "";
    const prior = data.balance_updates.find(item => item.account_id === (value === "unassigned" ? null : value) && item.date === newDate);
    setBalance(prior ? (prior.balance_cents / 100).toFixed(2) : ""); setNotes(prior?.notes ?? "");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (selection === "choose") return action.setError("Choose the account whose balance you are updating.");
    const cents = parseMoney(balance, true);
    if (cents === null) return action.setError("Enter a valid balance in dollars.");
    id.current ||= existing?.id ?? financeId();
    await action.run(() => mutate("save_balance_update", { id: id.current, account_id: selectedId, date, balance_cents: cents, notes }), onClose);
  }
  const account = data.accounts.find(item => item.id === selectedId);
  return <FinanceDialog title="Set a dated starting balance" onClose={close}><form onSubmit={submit}>
    <div className="fn-notice" style={{ marginBottom: 0 }}><Icon name="wallet" size={19} /><div><strong>Start this day with your corrected balance.</strong><p>The day’s income, bills, transfers, and Live Money spending apply after this amount. Earlier days stay the same; later balances recalculate until the next balance update.</p></div></div>
    <fieldset className="fn-fields fa-fields" disabled={action.pending}>
      <label className="fn-field full"><span>Account</span><select value={selection} onChange={event => changeSelection(event.target.value)} required><option value="choose" disabled>Choose an account</option><option value="unassigned">Unassigned · existing balances and records</option>{data.accounts.filter(item => !item.archived_at || item.id === selectedId || data.balance_updates.some(update => update.account_id === item.id && update.date === date)).map(item => <option key={item.id} value={item.id}>{accountLabel(item)}{item.archived_at ? " · Archived" : ""}</option>)}</select><small>All accounts is the total of these accounts. Update the account that changed.</small></label>
      <label className="fn-field"><span>Balance date</span><input type="date" min="2000-01-01" max="2100-12-31" required value={date} onChange={event => changeSelection(selection, event.target.value)} /></label>
      <label className="fn-field"><span>Balance at start of day (USD)</span><input type="text" inputMode="decimal" required value={balance} onChange={event => setBalance(event.target.value)} placeholder="0.00" autoComplete="off" /><small>{account?.kind === "credit_card" ? "Enter a negative amount for card debt; a positive amount is a credit." : "Enter the balance before any transactions listed for this day."}</small></label>
      <label className="fn-field full"><span>Why did it change? <small>optional</small></span><textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={4000} placeholder="Reconciled with bank balance" /></label>
    </fieldset>
    {date > today ? <p className="fn-form-help">This future balance is a forecast reset. It will not fund savings goals before its date.</p> : null}
    {existing ? <p className="fn-form-help">A saved balance already exists for this account and date. Saving replaces it.</p> : null}
    <FormError error={action.error} />
    {confirmRemove && existing ? <div className="fn-notice warning"><div><strong>Remove this balance update?</strong><p>The account will use its previous balance and recorded cash flow for this day.</p><div className="fn-actions"><button type="button" className="fn-button danger" disabled={action.pending} onClick={() => action.run(() => mutate("remove_balance_update", { id: existing.id }), onClose)}>Remove update</button><button type="button" className="fn-button" disabled={action.pending} onClick={() => setConfirmRemove(false)}>Keep it</button></div></div></div> : null}
    <div className="fn-actions end">{existing && !confirmRemove ? <button className="fn-button danger" type="button" disabled={action.pending} onClick={() => setConfirmRemove(true)}>Remove update</button> : null}<button className="fn-button" type="button" onClick={close} disabled={action.pending}>Cancel</button><button className="fn-button primary" disabled={action.pending || selection === "choose"}>{action.pending ? "Saving…" : "Save starting balance"}</button></div>
  </form></FinanceDialog>;
}

export function TransferEditor({ data, today, mutate, onClose, transfer, date: initialDate }: AccountEditorBase & { transfer?: FinanceTransfer; date?: string }) {
  const [from, setFrom] = useState(transfer?.from_account_id ?? ""), [to, setTo] = useState(transfer?.to_account_id ?? "");
  const [amount, setAmount] = useState(transfer ? (transfer.amount_cents / 100).toFixed(2) : ""), [date, setDate] = useState(transfer?.date ?? initialDate ?? today);
  const [status, setStatus] = useState<FinanceTransfer["status"]>(transfer?.status ?? ((initialDate ?? today) > today ? "planned" : "completed")), [notes, setNotes] = useState(transfer?.notes ?? "");
  const action = useAccountAction(), id = useRef(transfer?.id ?? "");
  const close = () => { if (!action.pending) onClose(); };
  const accounts = data.accounts.filter(item => !item.archived_at || item.id === from || item.id === to);
  async function submit(event: FormEvent) {
    event.preventDefault(); const cents = parseMoney(amount);
    if (cents === null || cents <= 0) return action.setError("Enter a transfer amount greater than zero.");
    if (!from || !to || from === to) return action.setError("Choose two different accounts.");
    if (status === "completed" && date > today) return action.setError("Future transfers must be planned. Mark them completed after they happen.");
    id.current ||= financeId();
    await action.run(() => mutate("save_transfer", { id: id.current, from_account_id: from, to_account_id: to, amount_cents: cents, date, status, notes }), onClose);
  }
  return <FinanceDialog title={transfer ? "Manage transfer" : "Move money between accounts"} onClose={close}><form onSubmit={submit}>
    <p className="fn-form-help">Record money moved between your own accounts, including savings deposits and credit card repayments. This records your transfer; make the actual transfer with your bank.</p>
    <fieldset className="fn-fields fa-fields" disabled={action.pending}><label className="fn-field"><span>From account</span><select required value={from} onChange={event => setFrom(event.target.value)}><option value="">Choose account</option>{accounts.map(item => <option key={item.id} value={item.id}>{accountLabel(item)}</option>)}</select></label><label className="fn-field"><span>To account</span><select required value={to} onChange={event => setTo(event.target.value)}><option value="">Choose account</option>{accounts.filter(item => item.id !== from).map(item => <option key={item.id} value={item.id}>{accountLabel(item)}</option>)}</select></label>
      <label className="fn-field"><span>Amount (USD)</span><input type="text" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required autoComplete="off" placeholder="0.00" /></label><label className="fn-field"><span>Transfer date</span><input type="date" min="2000-01-01" max="2100-12-31" required value={date} onChange={event => setDate(event.target.value)} /></label>
      <label className="fn-field"><span>Status</span><select value={status} onChange={event => setStatus(event.target.value as FinanceTransfer["status"])}><option value="planned">Planned</option><option value="completed">Completed</option>{transfer ? <option value="cancelled">Cancelled</option> : null}</select></label>
      <label className="fn-field full"><span>Notes <small>optional</small></span><textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={4000} /></label>
    </fieldset><p className="fn-form-help">Transfers change the two account balances and leave the combined balance unchanged. Record a card purchase as a bill on the card; record its repayment here so it isn’t counted as another expense.</p>
    <FormError error={action.error} /><div className="fn-actions end"><button type="button" className="fn-button" disabled={action.pending} onClick={close}>Cancel</button><button className="fn-button primary" disabled={action.pending}>{action.pending ? "Saving…" : "Save transfer"}</button></div>
  </form></FinanceDialog>;
}

export function AccountsPanel(props: RecordsProps & { editTransfer: (transfer: FinanceTransfer) => void }) {
  const { data, today, month, mutate, openAccount, openBalance, openTransfer, editTransfer } = props;
  const [archived, setArchived] = useState(false), [search, setSearch] = useState(""), [historyId, setHistoryId] = useState<string | null>(null);
  const action = useAccountAction();
  const accounts = data.accounts.filter(item => Boolean(item.archived_at) === archived && `${item.name} ${item.institution} ${item.last_four ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const balances = data.accounts.map(account => ({ account, balance: actualAccountBalance(data, account.id, today) }));
  const cash = balances.filter(item => item.account.kind !== "credit_card").reduce((sum, item) => sum + item.balance, 0);
  const cardDebt = balances.filter(item => item.account.kind === "credit_card").reduce((sum, item) => sum + Math.max(0, -item.balance), 0);
  const transfers = data.transfers.filter(item => item.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
  const historyAccount = data.accounts.find(item => item.id === historyId);
  const name = (id: string) => data.accounts.find(item => item.id === id)?.name ?? "Account";
  return <div className="fn-stack">
    <div className="fn-metrics"><Metric title="Cash & bank balances" cents={cash} detail={`Recorded balances as of ${formatDate(today)}`} icon="wallet" tone="green" /><Metric title="Credit card balances owed" cents={cardDebt} detail="Negative card balances shown as amounts owed" icon="card" tone="amber" /><Metric title="Combined tracked balance" cents={balances.reduce((sum, item) => sum + item.balance, actualAccountBalance(data, null, today))} detail="All accounts, signed cards, and unassigned money" icon="layers" /><Metric title="Unassigned balance" cents={actualAccountBalance(data, null, today)} detail="Existing balance and records without an account" icon="info" /></div>
    <div className="fn-notice"><Icon name="info" size={19} /><div><strong>One place for each bank account or card.</strong><p>Assign bills and income to an account, then use the account filter in Live Money, Calendar, Bills, Income, Overview, and Reports. These balances use your opening amounts, dated updates, and recorded transactions.</p></div></div>
    <section className="fn-panel"><div className="fn-panel-head"><div><h2>Your accounts</h2><p>Balances below use recorded transactions through today. Forecasts appear in Live Money.</p></div><div className="fn-actions"><button className="fn-button" onClick={() => openTransfer?.()} disabled={data.accounts.filter(item => !item.archived_at).length < 2}><Icon name="arrow" size={14} />Move money</button><button className="fn-button primary" onClick={() => openAccount?.()}><Icon name="plus" size={14} />Add bank or card</button></div></div>
      <div className="fn-toolbar"><div className="fn-tabs"><button className={`fn-tab ${!archived ? "active" : ""}`} onClick={() => setArchived(false)}>Active</button><button className={`fn-tab ${archived ? "active" : ""}`} onClick={() => setArchived(true)}>Archived</button></div><input className="fn-input fn-search" aria-label="Search bank and card accounts" placeholder="Search accounts or last four…" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <FormError error={action.error} />
      {accounts.length ? <div className="fa-account-grid">{accounts.map(account => {
        const trackingStart = accountTrackingStart(data, account.id) ?? account.opening_date;
        const balance = actualAccountBalance(data, account.id, today), forecast = dailyLedger(data, month, { accountScope: account.id }).at(-1)?.ending_cents ?? balance;
        return <article className="fa-account" key={account.id}><div className="fn-row"><span className="fn-metric-icon"><Icon name={account.kind === "credit_card" ? "card" : "wallet"} size={19} /></span><span className="fn-badge">{ACCOUNT_LABELS[account.kind]}</span></div><h3>{accountLabel(account)}</h3><p className="fn-muted">{account.institution || "Manually tracked account"}{account.archived_at ? " · Archived" : ""}</p><strong className="fa-balance"><Money cents={balance} colored /></strong><p className="fn-muted">{trackingStart > today ? `Balance starts ${formatDate(trackingStart)}` : `Recorded balance · ${formatDate(today)}`}</p>
          {account.kind === "credit_card" && account.credit_limit_cents != null ? <p className="fn-muted">Available credit: <Money cents={account.credit_limit_cents + balance} /> · Limit <Money cents={account.credit_limit_cents} /></p> : null}
          <div className="fa-forecast"><span>Selected month-end forecast</span><Money cents={forecast} colored /></div><div className="fn-actions">{!account.archived_at ? <button className="fn-button small" onClick={() => openBalance?.(today, account.id)}>Update balance</button> : null}<button className="fn-button small" onClick={() => openAccount?.(account.kind, account)}>Edit</button><button className="fn-button small" onClick={() => setHistoryId(account.id)}>Balance history</button><button className="fn-button subtle small" disabled={action.pending} onClick={() => action.run(() => mutate("account_status", { id: account.id, archived: !account.archived_at }))}>{account.archived_at ? "Restore" : "Archive"}</button></div></article>;
      })}</div> : <EmptyState title={archived ? "No archived accounts" : "Add your first bank account or card"} description="Start with a nickname, optional last four digits, and an opening balance. Then assign your bills and income." action={!archived ? <button className="fn-button primary" onClick={() => openAccount?.()}>Add account</button> : undefined} />}
      <div className="fn-summary-strip"><span>Archiving preserves account balances and history. Archived accounts remain in All accounts totals.</span></div>
    </section>
    <section className="fn-panel"><div className="fn-panel-head"><div><h2>Transfers this month</h2><p>Money between your accounts, kept separate from income and bills.</p></div><button className="fn-button" disabled={data.accounts.filter(item => !item.archived_at).length < 2} onClick={() => openTransfer?.()}>Add transfer</button></div>{transfers.length ? <div className="fn-table-wrap"><table className="fn-table"><thead><tr><th>Date</th><th>From → to</th><th className="numeric">Amount</th><th>Status</th><th className="fn-no-print">Manage</th></tr></thead><tbody>{transfers.map(transfer => <tr key={transfer.id}><td>{formatDate(transfer.date)}</td><td><strong>{name(transfer.from_account_id)} → {name(transfer.to_account_id)}</strong>{transfer.notes ? <small>{transfer.notes}</small> : null}</td><td className="numeric"><Money cents={transfer.amount_cents} /></td><td><span className={`fn-badge ${transfer.status === "completed" ? "positive" : transfer.status === "planned" ? "purple" : ""}`}>{transfer.status}</span></td><td className="fn-no-print"><button className="fn-button small" onClick={() => editTransfer(transfer)}>Manage transfer</button></td></tr>)}</tbody></table></div> : <p className="fn-panel-body fn-muted">No transfers in the selected month.</p>}</section>
    {historyAccount ? <FinanceDialog title={`${historyAccount.name} · balance history`} onClose={() => setHistoryId(null)}><p className="fn-form-help">Each amount replaces the balance at the start of its date. The day’s transactions are applied afterward.</p><ul className="fn-list"><li><span><strong>Opening balance</strong><small className="fn-list-meta">{formatDate(historyAccount.opening_date)}</small></span><Money cents={historyAccount.opening_balance_cents} /></li>{data.balance_updates.filter(item => item.account_id === historyId).sort((a, b) => b.date.localeCompare(a.date)).map(item => <li key={item.id}><button className="fn-list-button" onClick={() => { setHistoryId(null); openBalance?.(item.date, historyAccount.id); }}><span className="fn-list-title">{formatDate(item.date)}</span><small className="fn-list-meta">{item.notes || "Balance update"}</small></button><Money cents={item.balance_cents} /></li>)}</ul></FinanceDialog> : null}
  </div>;
}

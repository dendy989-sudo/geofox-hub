"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/admin/icons";
import { accountTrackingStart, actualAccountBalance, matchesAccountScope, parseMoney } from "@/lib/finance/calculations";
import { financeId } from "@/lib/finance/id";
import type { FinanceAccount, FinanceData, FinanceGoal, FinanceMilestone, RecordsProps } from "@/lib/finance/types";
import { EmptyState, FinanceDialog, Metric, Money, Progress, formatDate, formatMoney } from "./shared";
import "./savings.css";

const milestones: FinanceMilestone[] = [25, 50, 75, 100];
const amountText = (cents: number) => (cents / 100).toFixed(2);
const accountName = (account: FinanceAccount) => `${account.name}${account.last_four ? ` · ••${account.last_four}` : ""}`;

function activeAllocations(data: FinanceData, accountId: string, excludeGoalId?: string): number {
  return (data.goals ?? []).filter(goal => goal.user_id === data.user.id && goal.account_id === accountId && !goal.archived_at && goal.id !== excludeGoalId).reduce((total, goal) => total + goal.allocated_cents, 0);
}

function historyDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago", timeZoneName: "short" }).format(new Date(value));
}

function useSavingsAction() {
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const busy = useRef(false);
  async function run(work: () => Promise<void>, done?: () => void) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError("");
    try { await work(); done?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This savings change could not be saved. Please try again."); }
    finally { busy.current = false; setPending(false); }
  }
  return { pending, error, setError, run };
}

function SavingsError({ message }: { message: string }) {
  return message ? <div className="fs-error" role="alert"><Icon name="alert" size={17} /><span>{message}</span></div> : null;
}

function GoalEditor({ props, initialGoal, initialAccountId, onClose }: { props: RecordsProps; initialGoal?: FinanceGoal; initialAccountId?: string; onClose: () => void }) {
  const { data, today, mutate } = props;
  const goal = initialGoal ? (data.goals ?? []).find(item => item.id === initialGoal.id) ?? initialGoal : undefined;
  const savingsAccounts = (data.accounts ?? []).filter(account => account.user_id === data.user.id && account.kind === "savings" && (!account.archived_at || account.id === goal?.account_id)).sort((a, b) => a.name.localeCompare(b.name));
  const [title, setTitle] = useState(goal?.title ?? "");
  const [accountId, setAccountId] = useState(goal?.account_id ?? initialAccountId ?? savingsAccounts.find(account => !account.archived_at)?.id ?? "");
  const [target, setTarget] = useState(goal ? amountText(goal.target_cents) : "");
  const [allocated, setAllocated] = useState(goal ? amountText(goal.allocated_cents) : "0.00");
  const [startDate, setStartDate] = useState(goal?.start_date ?? today);
  const [targetDate, setTargetDate] = useState(goal?.target_date ?? "");
  const [notes, setNotes] = useState(goal?.notes ?? ""), [changeNote, setChangeNote] = useState("");
  const id = useRef(goal?.id ?? "");
  const action = useSavingsAction();
  const account = savingsAccounts.find(item => item.id === accountId);
  const actual = account ? actualAccountBalance(data, account.id, today) : 0;
  const otherAllocated = account ? activeAllocations(data, account.id, goal?.id) : 0;
  const available = actual - otherAllocated;
  const targetCents = parseMoney(target), allocatedCents = parseMoney(allocated);
  const progress = targetCents && allocatedCents !== null ? Math.min(100, allocatedCents / targetCents * 100) : 0;
  const close = () => { if (!action.pending) onClose(); };

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return action.setError("Give this savings goal a name.");
    if (!account || account.kind !== "savings") return action.setError("Choose a savings account for this goal.");
    if (account.archived_at && account.id !== goal?.account_id) return action.setError("Restore this savings account before assigning a new goal to it.");
    if (targetCents === null || targetCents <= 0) return action.setError("Enter a target amount greater than zero, using up to two decimal places.");
    if (allocatedCents === null || allocatedCents < 0) return action.setError("Enter an amount to earmark of zero or more, using up to two decimal places.");
    if (targetDate && targetDate < startDate) return action.setError("The target date must be on or after the goal’s start date.");
    const needsFundsCheck = !goal || goal.account_id !== accountId || allocatedCents > goal.allocated_cents;
    if (needsFundsCheck && allocatedCents > Math.max(0, available)) return action.setError(`This account has ${formatMoney(Math.max(0, available))} available for this goal after other active earmarks. Lower the amount or record additional savings first.`);
    id.current ||= financeId();
    void action.run(() => mutate("save_goal", { id: id.current, account_id: accountId, title: title.trim(), target_cents: targetCents, allocated_cents: allocatedCents, start_date: startDate, target_date: targetDate || null, notes: notes.trim(), change_note: changeNote.trim() }), onClose);
  }

  return <FinanceDialog title={goal ? "Manage savings goal" : "Create a savings goal"} onClose={close}>
    <form className="fs-goal-form" onSubmit={submit}>
      <p className="fn-form-help">Earmark money already in a savings account for something that matters to you. A goal does not create a deposit or add to your account balance.</p>
      {goal?.archived_at ? <div className="fs-notice"><Icon name="info" size={17} /><span>This goal is archived. Its recorded allocation is not reserved now; restoring the goal checks available funds and earmarks it again.</span></div> : null}
      <fieldset className="fs-fieldset" disabled={action.pending}>
        <div className="fn-fields">
          <label className="fn-field full"><span>Goal name</span><input autoFocus required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="Emergency fund, a trip, a new car…" /></label>
          <label className="fn-field full"><span>Savings account</span><select value={accountId} onChange={event => setAccountId(event.target.value)} required><option value="">Choose a savings account</option>{savingsAccounts.map(item => <option value={item.id} key={item.id}>{accountName(item)}{item.archived_at ? " · Archived" : ""}</option>)}</select><small>Changing the account moves the earmark only. Record a transfer separately if money actually moves between accounts.</small></label>
          <label className="fn-field"><span>Target amount (USD)</span><input type="text" inputMode="decimal" autoComplete="off" required maxLength={15} value={target} onChange={event => setTarget(event.target.value)} placeholder="0.00" /><small>How much you want to set aside for this goal.</small></label>
          <label className="fn-field"><span>Amount earmarked (USD)</span><input type="text" inputMode="decimal" autoComplete="off" required maxLength={15} value={allocated} onChange={event => setAllocated(event.target.value)} placeholder="0.00" /><small>Existing money reserved for this goal. Start at zero if you are still planning.</small></label>
          <label className="fn-field"><span>Start date</span><input type="date" required min="2000-01-01" max="2100-12-31" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
          <label className="fn-field"><span>Target date <span className="fs-optional">optional</span></span><input type="date" min={startDate || "2000-01-01"} max="2100-12-31" value={targetDate} onChange={event => setTargetDate(event.target.value)} /><small>A personal target; an earlier target date can stay in your history.</small></label>
          <label className="fn-field full"><span>Notes <span className="fs-optional">optional</span></span><textarea rows={3} maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="What are you saving for?" /></label>
          {goal ? <label className="fn-field full"><span>Reason for this update <span className="fs-optional">optional</span></span><input maxLength={500} value={changeNote} onChange={event => setChangeNote(event.target.value)} placeholder="Added to the emergency fund, changed the target…" /></label> : null}
        </div>
      </fieldset>
      {account ? <div className={`fs-allocation-budget${available < 0 ? " overallocated" : ""}`}>
        <div><span>Recorded balance · {formatDate(today)}</span><strong><Money cents={actual} /></strong></div>
        <div><span>Earmarked for other active goals</span><strong><Money cents={otherAllocated} /></strong></div>
        <div className="fs-budget-total"><span>Available for this goal</span><strong><Money cents={Math.max(0, available)} /></strong></div>
        {available < 0 ? <p>{otherAllocated > 0 ? `Other active earmarks exceed this account’s recorded balance by ${formatMoney(-available)}.` : "This account has a negative recorded balance."} You can plan a goal with zero allocated or reduce an existing earmark. Record available money before increasing allocations.</p> : <p>Forecast income and planned transfers are excluded. Balance updates do not automatically add money to goals.</p>}
      </div> : null}
      {targetCents !== null && targetCents > 0 && allocatedCents !== null && allocatedCents >= 0 ? <div className="fs-goal-preview"><Progress value={progress} label={`${formatMoney(allocatedCents)} earmarked toward ${formatMoney(targetCents)}`} /><p>Milestones: 25%, 50%, 75%, and fully funded. Each milestone is celebrated once.</p></div> : null}
      <SavingsError message={action.error} />
      <div className="fn-actions end"><button type="button" className="fn-button" disabled={action.pending} onClick={close}>Cancel</button><button type="submit" className="fn-button primary" disabled={action.pending}>{action.pending ? "Saving…" : goal?.archived_at ? "Save archived goal" : goal ? "Save goal & allocation" : "Create goal"}</button></div>
    </form>
  </FinanceDialog>;
}

function GoalCard({ goal, account, props, onEdit }: { goal: FinanceGoal; account?: FinanceAccount; props: RecordsProps; onEdit: () => void }) {
  const [confirmArchive, setConfirmArchive] = useState(false);
  const action = useSavingsAction();
  const percent = Math.min(100, goal.allocated_cents / goal.target_cents * 100);
  const remaining = Math.max(0, goal.target_cents - goal.allocated_cents);
  const funded = remaining === 0;
  const lateTarget = !goal.archived_at && !funded && goal.target_date && goal.target_date < props.today;
  const history = (props.data.goal_history ?? []).filter(item => item.user_id === props.data.user.id && item.goal_id === goal.id).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));

  function changeArchive() {
    const archived = !goal.archived_at;
    void action.run(() => props.mutate("goal_status", { id: goal.id, archived }), () => {
      setConfirmArchive(false);
      props.notify(archived ? "Goal archived. Its earmark was released; the account balance is unchanged." : "Goal restored. Its saved amount is earmarked again.");
    });
  }

  return <section className={`fn-panel fs-goal-card${goal.archived_at ? " archived" : funded ? " funded" : ""}`} aria-label={`${goal.title} savings goal`}>
    <div className="fs-goal-head"><span className="fs-goal-icon"><Icon name={funded ? "check" : "target"} size={20} /></span><div><h3>{goal.title}</h3><p>{account ? accountName(account) : "Savings account unavailable"}{account?.archived_at ? " · Archived account" : ""}</p></div><span className={`fn-badge ${goal.archived_at ? "" : funded ? "positive" : lateTarget ? "warning" : "purple"}`}>{goal.archived_at ? "Archived" : funded ? "Funded" : lateTarget ? "Target date passed" : "In progress"}</span></div>
    <div className="fs-goal-body">
      <div className="fs-goal-amounts"><div><span>{goal.archived_at ? "Last recorded allocation" : "Earmarked"}</span><strong><Money cents={goal.allocated_cents} /></strong></div><div><span>Goal target</span><strong><Money cents={goal.target_cents} /></strong></div></div>
      <Progress value={percent} label={`${Math.round(percent)}% of the current target`} />
      <div className="fs-goal-dates"><span>{funded ? goal.allocated_cents > goal.target_cents ? `${formatMoney(goal.allocated_cents - goal.target_cents)} above target` : "Target reached" : `${formatMoney(remaining)} still to earmark`}</span><span>{goal.target_date ? `Target ${formatDate(goal.target_date)}` : `Started ${formatDate(goal.start_date)}`}</span></div>
      <div className="fs-milestone-caption"><strong>Milestones reached</strong><span>Kept once earned</span></div>
      <ol className="fs-milestones" aria-label="Savings milestones">{milestones.map(value => {
        const reached = (goal.achieved_milestones ?? []).includes(value);
        return <li className={reached ? "reached" : ""} key={value}><span className="fs-milestone-dot">{reached ? <Icon name="check" size={12} /> : <span aria-hidden="true" />}</span><span>{value}%</span><span className="fs-sr-only">{reached ? " reached" : " not yet reached"}</span></li>;
      })}</ol>
      {goal.notes ? <p className="fs-goal-notes">{goal.notes}</p> : null}
      {goal.archived_at ? <p className="fs-goal-help">This archived goal does not reserve money. Restoring it checks current funds first.</p> : funded ? <p className="fs-goal-help">This goal stays earmarked until you reduce its allocation or archive it.</p> : null}
      <div className="fn-actions fs-goal-actions"><button type="button" className="fn-button small" onClick={onEdit} disabled={action.pending}><Icon name="edit" size={12} />{goal.archived_at ? "Edit goal" : "Manage allocation"}</button><button type="button" className="fn-button subtle small" onClick={() => goal.archived_at ? changeArchive() : setConfirmArchive(true)} disabled={action.pending}>{action.pending ? "Saving…" : goal.archived_at ? "Restore goal" : "Archive goal"}</button></div>
      {confirmArchive ? <div className="fs-archive-confirm"><p>Archive <strong>{goal.title}</strong>? Its {formatMoney(goal.allocated_cents)} earmark will be released. The account balance and goal history stay unchanged.</p><div className="fn-actions"><button type="button" className="fn-button small" onClick={() => setConfirmArchive(false)} disabled={action.pending}>Keep active</button><button type="button" className="fn-button small" onClick={changeArchive} disabled={action.pending}>{action.pending ? "Archiving…" : "Archive & release earmark"}</button></div></div> : null}
      <SavingsError message={action.error} />
    </div>
    <details className="fs-goal-history"><summary><span><Icon name="clock" size={13} />Allocation history</span><span>{history.length} {history.length === 1 ? "update" : "updates"}<Icon name="chevron" size={12} /></span></summary><div className="fs-history-list">{history.length ? history.map(item => <div className="fs-history-row" key={item.id}><div><strong>{item.previous_allocated_cents !== null && item.previous_allocated_cents !== item.allocated_cents ? <><Money cents={item.previous_allocated_cents} /><span aria-label="changed to"> → </span></> : null}<Money cents={item.allocated_cents} /></strong><p>{item.note || "Goal updated"}</p></div><time dateTime={item.created_at}>{historyDate(item.created_at)}</time></div>) : <p className="fs-goal-help">Updates to this goal will appear here.</p>}</div></details>
  </section>;
}

export function SavingsPanel(props: RecordsProps) {
  const { data, today, accountScope = "all", openAccount, openBalance, openTransfer } = props;
  const [filter, setFilter] = useState<"active" | "funded" | "archived" | "all">("active");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{ goal?: FinanceGoal; accountId?: string } | null>(null);
  const accounts = useMemo(() => (data.accounts ?? []).filter(account => account.user_id === data.user.id && account.kind === "savings" && matchesAccountScope(account.id, accountScope)).sort((a, b) => Number(Boolean(a.archived_at)) - Number(Boolean(b.archived_at)) || a.name.localeCompare(b.name)), [data, accountScope]);
  const allGoals = (data.goals ?? []).filter(goal => goal.user_id === data.user.id && matchesAccountScope(goal.account_id, accountScope));
  const activeGoals = allGoals.filter(goal => !goal.archived_at);
  const availableAccounts = accounts.filter(account => !account.archived_at);
  const accountRows = accounts.map(account => {
    const balance = actualAccountBalance(data, account.id, today);
    const allocated = activeAllocations(data, account.id);
    return { account, balance, allocated, available: balance - allocated };
  });
  const balanceTotal = accountRows.reduce((total, row) => total + row.balance, 0);
  const allocatedTotal = accountRows.reduce((total, row) => total + row.allocated, 0);
  const remainingTotal = activeGoals.reduce((total, goal) => total + Math.max(0, goal.target_cents - goal.allocated_cents), 0);
  const fundedCount = activeGoals.filter(goal => goal.allocated_cents >= goal.target_cents).length;
  const overallocated = accountRows.filter(row => row.available < 0 && row.allocated > 0);
  const query = search.trim().toLocaleLowerCase();
  const goals = allGoals.filter(goal => {
    const matchesStatus = filter === "all" || (filter === "archived" ? Boolean(goal.archived_at) : !goal.archived_at && (filter !== "funded" || goal.allocated_cents >= goal.target_cents));
    const matchesSearch = !query || `${goal.title} ${goal.notes} ${(data.accounts ?? []).find(account => account.id === goal.account_id)?.name ?? ""}`.toLocaleLowerCase().includes(query);
    return matchesStatus && matchesSearch;
  }).sort((a, b) => Number(Boolean(a.archived_at)) - Number(Boolean(b.archived_at)) || (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999") || a.title.localeCompare(b.title));
  const defaultAccount = availableAccounts.length === 1 ? availableAccounts[0].id : undefined;

  return <div className="fn-stack fs-workspace">
    <div className="fn-notice fs-intro"><Icon name="target" size={20} /><div><strong>Give your savings a purpose.</strong><p>Goals earmark existing money. They do not add deposits, duplicate your account balance, or use forecast income. Recorded balances below are current through {formatDate(today)}.</p></div></div>
    {accounts.length ? <>
      <div className="fn-metrics"><Metric title="Recorded savings" cents={balanceTotal} detail={`Actual balances · ${formatDate(today)}`} icon="wallet" tone="green" /><Metric title="Earmarked for goals" cents={allocatedTotal} detail="Reserved within your savings accounts" icon="target" tone="purple" /><Metric title="Unallocated balance" cents={balanceTotal - allocatedTotal} detail="Balance less active goal earmarks" icon="coins" tone={balanceTotal - allocatedTotal < 0 ? "red" : "cyan"} /><Metric title="Goals still to fund" cents={remainingTotal} detail={`${fundedCount} of ${activeGoals.length} active goals funded`} icon="chart" /></div>
      {overallocated.length ? <div className="fs-notice warning" role="status"><Icon name="alert" size={18} /><div><strong>Some earmarks exceed the recorded account balance.</strong><p>{overallocated.map(row => `${row.account.name}: ${formatMoney(-row.available)} overallocated`).join(" · ")}. Update an inaccurate starting balance, record money that actually moved, or reduce goal allocations. Existing goals keep their amounts until you change them.</p></div></div> : null}
      <section className="fs-accounts-section" aria-labelledby="fs-accounts-heading"><div className="fs-section-head"><div><h2 id="fs-accounts-heading">Your savings accounts</h2><p>Check each account before assigning more money to goals.</p></div><div className="fn-actions fs-no-print">{openTransfer ? <button type="button" className="fn-button small" onClick={() => openTransfer()}><Icon name="arrow" size={13} />Record transfer</button> : null}{openAccount ? <button type="button" className="fn-button small" onClick={() => openAccount("savings")}><Icon name="plus" size={13} />Add savings account</button> : null}</div></div><div className="fs-account-grid">{accountRows.map(({ account, balance, allocated, available }) => {
        const trackingStart = accountTrackingStart(data, account.id) ?? account.opening_date;
        const opensLater = trackingStart > today;
        const goalCount = activeGoals.filter(goal => goal.account_id === account.id).length;
        return <article className={`fn-panel fs-account-card${available < 0 ? " overallocated" : ""}`} key={account.id}><div className="fs-account-head"><span className="fs-account-icon"><Icon name="wallet" size={19} /></span><div><h3>{account.name}</h3><p>{account.institution || "Savings account"}{account.last_four ? ` · ••${account.last_four}` : ""}</p></div>{account.archived_at ? <span className="fn-badge">Archived</span> : opensLater ? <span className="fn-badge">Future opening</span> : null}</div><div className="fs-account-balance"><span>Recorded balance</span><strong className={balance < 0 ? "fn-negative" : ""}><Money cents={balance} /></strong></div><dl className="fs-account-allocation"><div><dt>Earmarked · {goalCount} {goalCount === 1 ? "goal" : "goals"}</dt><dd><Money cents={allocated} /></dd></div><div><dt>{available < 0 ? allocated > 0 ? "Overallocated" : "Balance below zero" : "Available to allocate"}</dt><dd className={available < 0 ? "fn-negative" : "fn-positive"}><Money cents={available < 0 ? -available : available} /></dd></div></dl>{opensLater ? <p className="fs-account-help">The recorded balance begins {formatDate(trackingStart)} and cannot fund goals yet.</p> : account.archived_at ? <p className="fs-account-help">Existing balances and earmarks remain. Restore this account in Banks & cards to use it for new goals.</p> : <p className="fs-account-help">A balance update sets the start of today. Payments and completed transfers dated today apply after it.</p>}<div className="fn-actions fs-account-actions">{!account.archived_at ? <button type="button" className="fn-button small primary" onClick={() => setEditor({ accountId: account.id })}><Icon name="plus" size={12} />Add goal</button> : null}{openBalance && !account.archived_at && !opensLater ? <button type="button" className="fn-button small" onClick={() => openBalance(today, account.id)}>Update starting balance</button> : null}{openAccount ? <button type="button" className="fn-button subtle small" onClick={() => openAccount("savings", account)}>Account details</button> : null}</div></article>;
      })}</div></section>
    </> : <section className="fn-panel"><EmptyState title={accountScope === "all" ? "Start with a savings account" : "Choose a savings account"} description={accountScope === "all" ? "Add a savings account with a nickname and starting balance. Then create goals that earmark the money already there." : "Savings goals belong to a savings account. Choose All accounts or a savings account to see its balances and goals."} action={openAccount && accountScope === "all" ? <button type="button" className="fn-button primary" onClick={() => openAccount("savings")}><Icon name="plus" size={14} />Add savings account</button> : undefined} /></section>}
    {accounts.length || allGoals.length ? <section className="fs-goals-section" aria-labelledby="fs-goals-heading"><div className="fs-section-head"><div><h2 id="fs-goals-heading">Savings goals</h2><p>Funded goals stay reserved until you reduce their allocation or archive them.</p></div><button type="button" className="fn-button primary fs-no-print" disabled={!availableAccounts.length} onClick={() => setEditor({ accountId: defaultAccount })}><Icon name="plus" size={14} />Create goal</button></div><div className="fs-toolbar"><label className="fs-search"><Icon name="search" size={15} /><input type="search" placeholder="Search goals or accounts" aria-label="Search savings goals" value={search} onChange={event => setSearch(event.target.value)} /></label><label className="fs-goal-filter"><span className="fs-sr-only">Goal status</span><select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="active">All active goals</option><option value="funded">Funded goals</option><option value="archived">Archived goals</option><option value="all">All goals & history</option></select></label><span className="fs-result-count">{goals.length} {goals.length === 1 ? "goal" : "goals"}</span></div>{goals.length ? <div className="fs-goal-grid">{goals.map(goal => <GoalCard key={goal.id} goal={goal} account={(data.accounts ?? []).find(account => account.id === goal.account_id && account.user_id === data.user.id)} props={props} onEdit={() => setEditor({ goal })} />)}</div> : <section className="fn-panel"><EmptyState title={query ? "No matching goals" : filter === "archived" ? "No archived goals" : filter === "funded" ? "Your next milestone is ahead" : "What would you like to save for?"} description={query ? "Try another goal name or account." : filter === "archived" ? "Archived goals keep their notes and allocation history without reserving money." : filter === "funded" ? "Earmark money for an active goal to build toward its target. Milestones are saved as you reach them." : "Start an emergency fund, plan a trip, or save for something important. You can create a goal with zero allocated and add to it later."} action={!query && filter === "active" && availableAccounts.length ? <button type="button" className="fn-button primary" onClick={() => setEditor({ accountId: defaultAccount })}>Create your first goal</button> : undefined} /></section>}</section> : null}
    <p className="fn-muted fs-footer">Savings balances include recorded income, payments, completed transfers, and dated starting-balance updates. Planned income and transfers do not fund goals. Goal allocation changes never change the account balance.</p>
    {editor ? <GoalEditor key={editor.goal?.id ?? `new-${editor.accountId ?? "account"}`} props={props} initialGoal={editor.goal} initialAccountId={editor.accountId} onClose={() => setEditor(null)} /> : null}
  </div>;
}

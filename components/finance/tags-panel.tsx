"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/admin/icons";
import { daysPastDue, entryState, isMoved, remainingAmount } from "@/lib/finance/calculations";
import { financeId } from "@/lib/finance/id";
import { normalizeTagName, tagSummary, tagsForEntry } from "@/lib/finance/tags";
import type { FinanceEntry, FinanceTag, RecordsProps } from "@/lib/finance/types";
import { EmptyState, FinanceDialog, Metric, Money, formatDate, formatMoney, monthLabel } from "./shared";
import "./tags-panel.css";

function TagEditor({ tag, mutate, onClose }: { tag?: FinanceTag; mutate: RecordsProps["mutate"]; onClose: () => void }) {
  const [name, setName] = useState(tag?.name ?? "");
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const busy = useRef(false), id = useRef(tag?.id ?? "");
  const close = () => { if (!busy.current) onClose(); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    setError("");
    let normalized: string;
    try { normalized = normalizeTagName(name); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Enter a tag name."); return; }
    busy.current = true; setPending(true);
    try {
      id.current ||= financeId();
      await mutate("save_tag", { id: id.current, name: normalized });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This tag could not be saved. Please try again."); }
    finally { busy.current = false; setPending(false); }
  }
  return <FinanceDialog title={tag ? "Edit tag" : "Add tag"} onClose={close}>
    <form onSubmit={submit} className="fn-stack">
      <label className="fn-field">Tag name<input autoFocus required maxLength={120} disabled={pending} value={name} onChange={event => setName(event.target.value)} placeholder="For example, Household, Medical, or Side business" /><small>Use up to 60 characters. Choose this tag on any bill, income item, or payment plan.</small></label>
      <p className="fn-form-help">{tag ? "Renaming this tag updates its label everywhere it is used. Recorded amounts and dates stay the same." : "Tags help you group related money across categories and vendors. A record can have more than one tag."}</p>
      {error ? <p className="fn-form-error" role="alert">{error}</p> : null}
      <div className="fn-actions end"><button className="fn-button" type="button" disabled={pending} onClick={close}>Cancel</button><button className="fn-button primary" disabled={pending}>{pending ? "Saving…" : "Save tag"}</button></div>
    </form>
  </FinanceDialog>;
}

function TagRecord({ entry, props }: { entry: FinanceEntry; props: RecordsProps }) {
  const { data, today, openEntry, openPayment, openMove } = props;
  const remaining = remainingAmount(entry, data.payments), overdue = daysPastDue(entry, data.payments, today);
  const state = entryState(entry, data.payments, today);
  const label = state === "past_due" ? entry.kind === "income" ? "Overdue income" : "Past due" : state === "partial" ? entry.kind === "income" ? "Partly received" : "Partly paid" : state === "collections" ? "In collections" : state[0].toUpperCase() + state.slice(1);
  const actionable = entry.status === "active" && remaining > 0;
  return <tr>
    <td data-label="Bill / income"><button className="fr-record-title" onClick={() => openEntry(entry)}>{entry.title}</button><small>{entry.kind === "income" ? "Income" : "Bill"} · {entry.category}</small><div className="ftm-labels">{tagsForEntry(data, entry).map(tag => <span className="fn-badge purple" key={tag.id}>{tag.name}{tag.archived_at ? " · Archived" : ""}</span>)}</div></td>
    <td data-label="Original / planned date">{formatDate(entry.original_due_date)}{isMoved(entry) ? <small><span className="fn-badge purple">Moved</span> {formatDate(entry.scheduled_date)}</small> : <small>Planned on original date</small>}{entry.kind === "bill" && overdue > 0 ? <small className="ftm-overdue">{overdue} {overdue === 1 ? "day" : "days"} past due</small> : null}</td>
    <td data-label="Amount" className="numeric"><Money cents={entry.amount_cents} /></td>
    <td data-label="Remaining" className="numeric">{entry.status === "active" ? <Money cents={remaining} /> : <span className="fn-muted">{entry.status === "collections" ? "In collections" : "Cancelled"}</span>}</td>
    <td data-label="Status"><span className={`fn-badge ${state === "paid" || state === "received" ? "positive" : state === "past_due" ? "negative" : ""}`}>{label}</span>{entry.archived_at ? <small>Archived record</small> : null}</td>
    <td data-label="Actions"><div className="fn-actions">{actionable ? <><button className="fn-button small primary" onClick={() => openPayment(entry)}>{entry.kind === "income" ? "Receive" : "Pay"}</button><button className="fn-button small" onClick={() => openMove(entry)}>Move</button></> : null}<button className="fn-button small" onClick={() => openEntry(entry)}>Manage</button></div></td>
  </tr>;
}

export function TagsPanel(props: RecordsProps) {
  const { data, month, today, mutate } = props;
  const [search, setSearch] = useState(""), [directoryFilter, setDirectoryFilter] = useState<"active" | "archived" | "all">("active");
  const [selectedId, setSelectedId] = useState<string | null>(null), [period, setPeriod] = useState<"month" | "all">("month");
  const [recordKind, setRecordKind] = useState<"all" | "bill" | "income">("all");
  const [editor, setEditor] = useState<{ tag?: FinanceTag } | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const busy = useRef(false);
  const tags = useMemo(() => (data.tags ?? []).filter(tag => tag.user_id === data.user.id).toSorted((a, b) => a.name.localeCompare(b.name)), [data.tags, data.user.id]);
  const summaries = useMemo(() => new Map(tags.map(tag => [tag.id, tagSummary(data, tag.id, month, today)])), [data, tags, month, today]);
  const selected = tags.find(tag => tag.id === selectedId);
  const detailScope = selected?.id ?? (selectedId === "untagged" ? "untagged" : null);
  const detail = useMemo(() => detailScope ? tagSummary(data, detailScope, month, today) : null, [data, detailScope, month, today]);
  const query = search.trim().toLocaleLowerCase();
  const visibleTags = tags.filter(tag => (directoryFilter === "all" || (directoryFilter === "archived" ? Boolean(tag.archived_at) : !tag.archived_at)) && (!query || tag.name.toLocaleLowerCase().includes(query)));
  function selectGroup(id: string) { setSelectedId(id); setRecordKind("all"); setPeriod("month"); setError(""); }
  async function archive(tag: FinanceTag) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError("");
    try { await mutate("archive_tag", { id: tag.id, archived: !tag.archived_at }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This tag could not be updated."); }
    finally { busy.current = false; setPending(false); }
  }
  const displayedEntries = detail?.entries.filter(entry => (recordKind === "all" || entry.kind === recordKind) && (period === "all" || entry.original_due_date.startsWith(`${month}-`) || entry.scheduled_date.startsWith(`${month}-`) || data.payments.some(payment => payment.user_id === data.user.id && payment.entry_id === entry.id && payment.paid_on.startsWith(`${month}-`)))).toSorted((a, b) => a.original_due_date.localeCompare(b.original_due_date) || a.title.localeCompare(b.title)) ?? [];
  const groupLabel = selected?.name ?? "Untagged";
  return <div className="fn-stack ftm-workspace">
    {error ? <p className="fn-notice error" role="alert">{error}</p> : null}
    {detail ? <>
      <div className="ftm-detail-actions"><button className="fn-button subtle" onClick={() => setSelectedId(null)}><Icon name="arrow" size={14} style={{ transform: "rotate(180deg)" }} />All tags</button>{selected ? <div className="fn-actions"><button className="fn-button" disabled={pending} onClick={() => setEditor({ tag: selected })}><Icon name="edit" size={14} />Edit tag</button><button className="fn-button" disabled={pending} onClick={() => { void archive(selected); }}>{pending ? "Saving…" : selected.archived_at ? "Restore tag" : "Archive tag"}</button></div> : null}</div>
      <section className="fn-panel ftm-profile"><span className="fv-avatar"><Icon name="layers" size={24} /></span><div><p className="ftm-eyebrow">Tag group · All accounts</p><h2>{groupLabel}</h2><p>{detail.entry_count} linked {detail.entry_count === 1 ? "record" : "records"} across all dates · monthly totals for {monthLabel(month)}</p>{selected?.archived_at ? <span className="fn-badge">Archived tag</span> : null}</div></section>
      {selected?.archived_at ? <p className="fn-notice"><Icon name="info" size={17} />This tag remains on existing records and in filters. Restore it to assign it to new records.</p> : null}
      <div className="fn-metrics"><Metric title="Original monthly bills" cents={detail.original_bills_cents} detail="Original due month · before moves or cancellations" icon="book" /><Metric title="Planned monthly bills" cents={detail.scheduled_bills_cents} detail="Actual payments + remaining scheduled bills" icon="calendar" /><Metric title="Monthly income" cents={detail.income_cents} detail="Actual receipts + remaining scheduled income" icon="coins" tone="green" /><Metric title="Monthly income minus bills" cents={detail.net_cents} detail="Group cash flow · excludes bank balances" icon="chart" tone={detail.net_cents < 0 ? "red" : "green"} /></div>
      <div className="fn-summary-strip ftm-summary"><span>Paid in {monthLabel(month)} <strong><Money cents={detail.paid_cents} /></strong></span><span>Received in {monthLabel(month)} <strong><Money cents={detail.received_cents} /></strong></span><span>Open bills · all dates <strong><Money cents={detail.outstanding_cents} /></strong></span><span>Past due · all dates <strong className={detail.past_due_cents > 0 ? "fn-negative" : ""}><Money cents={detail.past_due_cents} /></strong></span></div>
      <p className="fn-notice"><Icon name="info" size={16} />A record with several tags appears in each group. Bills and Income count each record once when All tags is selected; adding group totals together can include the same record more than once.</p>
      <section className="fn-panel"><div className="fn-panel-head"><div><h2>{groupLabel} · bills & income</h2><p>{displayedEntries.length} {displayedEntries.length === 1 ? "record" : "records"} · {period === "month" ? monthLabel(month) : "All generated dates"} · {recordKind === "all" ? "Bills and income" : recordKind === "bill" ? "Bills" : "Income"}</p></div></div>
        <div className="fn-toolbar ftm-record-controls"><label>Record dates<select className="fn-select" aria-label="Tag group record period" value={period} onChange={event => setPeriod(event.target.value as "month" | "all")}><option value="month">{monthLabel(month)}</option><option value="all">All generated dates</option></select></label><label>Record type<select className="fn-select" aria-label="Tag group record type" value={recordKind} onChange={event => setRecordKind(event.target.value as "all" | "bill" | "income")}><option value="all">Bills & income</option><option value="bill">Bills</option><option value="income">Income</option></select></label></div>
        <p className="ftm-table-help">Includes paid, cancelled, archived, and transferred records. Month view includes original dates, planned dates, or recorded payments in that month. The summary above stays on {monthLabel(month)}.</p>
        {displayedEntries.length ? <div className="fn-table-wrap"><table className="fn-table ftm-records"><thead><tr><th>Bill / income</th><th>Original / planned date</th><th className="numeric">Amount</th><th className="numeric">Remaining</th><th>Status</th><th><span className="fr-sr-only">Actions</span></th></tr></thead><tbody>{displayedEntries.map(entry => <TagRecord key={entry.id} entry={entry} props={props} />)}</tbody></table></div> : <EmptyState title="No records in this view" description={detailScope === "untagged" ? "Bills and income without a tag appear here. Choose another month or All generated dates to review more records." : "Choose this tag when adding or editing bills and income, or select All generated dates to see other months."} />}
      </section>
    </> : <>
      <div className="fn-notice"><Icon name="layers" size={21} /><div><strong>Group bills and income your way.</strong>Create reusable tags for a household, project, or purpose. Assign them on bills and income, then filter those pages or open a tag here to see its totals.</div></div>
      <section className="fn-panel"><div className="fn-panel-head"><div><h2>Tag directory</h2><p>{tags.filter(tag => !tag.archived_at).length} active tags · monthly totals for {monthLabel(month)}</p></div><button className="fn-button primary" onClick={() => setEditor({})}><Icon name="plus" size={14} />Add tag</button></div>
        <div className="fn-toolbar"><label className="fr-search"><Icon name="search" size={16} /><input type="search" aria-label="Search tags" placeholder="Search tags" value={search} onChange={event => setSearch(event.target.value)} /></label><div className="fn-tabs" aria-label="Tag status">{(["active", "archived", "all"] as const).map(filter => <button key={filter} className={`fn-tab ${directoryFilter === filter ? "active" : ""}`} aria-pressed={directoryFilter === filter} onClick={() => setDirectoryFilter(filter)}>{filter === "all" ? "All tags" : filter === "active" ? "Active" : "Archived"}</button>)}</div></div>
        <p className="ftm-table-help">Showing {directoryFilter === "all" ? "all tags" : `${directoryFilter} tags`}{search.trim() ? ` matching “${search.trim()}”` : ""}. Tags may overlap; each card shows its own group.</p>
        {visibleTags.length ? <div className="fv-grid">{visibleTags.map(tag => {
          const summary = summaries.get(tag.id)!;
          return <article className="fv-card ftm-card" key={tag.id}><button className="fv-card-main" onClick={() => selectGroup(tag.id)} aria-label={`View ${tag.name} tag group`}><div className="fv-card-title"><span className="fv-avatar small"><Icon name="layers" size={20} /></span><div><h3>{tag.name}</h3><p>{summary.entry_count} linked {summary.entry_count === 1 ? "record" : "records"} · all dates</p></div>{tag.archived_at ? <span className="fn-badge">Archived</span> : null}</div><div className="fv-card-amounts"><span>Original monthly bills<strong><Money cents={summary.original_bills_cents} /></strong></span><span>Monthly income<strong><Money cents={summary.income_cents} /></strong></span></div><p>{summary.past_due_cents > 0 ? `${formatMoney(summary.past_due_cents)} in past-due bills` : `${monthLabel(month)} · all accounts`}</p><span className="fv-history-link">View group totals & records<Icon name="arrow" size={13} /></span></button></article>;
        })}</div> : <EmptyState title={search ? "No matching tags" : directoryFilter === "archived" ? "No archived tags" : "Give your money a few useful labels"} description={search ? "Try another tag name." : directoryFilter === "archived" ? "Archived tags keep their existing records and can be restored at any time." : "Try Household, Car, Medical, or a project name. You can apply more than one tag to each bill or income item."} action={!search && directoryFilter !== "archived" ? <button className="fn-button primary" onClick={() => setEditor({})}>Add your first tag</button> : undefined} />}
      </section>
      <div className="ftm-untagged"><div><h3>Find records that still need a tag</h3><p>Review bills and income with no tags, including older records.</p></div><button className="fn-button" onClick={() => selectGroup("untagged")}>View untagged bills & income<Icon name="arrow" size={14} /></button></div>
    </>}
    {editor ? <TagEditor key={editor.tag?.id ?? "new"} tag={editor.tag} mutate={mutate} onClose={() => setEditor(null)} /> : null}
  </div>;
}

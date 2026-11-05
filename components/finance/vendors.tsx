"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/admin/icons";
import { entryState, isMoved, remainingAmount } from "@/lib/finance/calculations";
import { financeId } from "@/lib/finance/id";
import type { FinanceVendor, RecordsProps } from "@/lib/finance/types";
import { normalizeVendorUrl, vendorSummary, vendorWebsiteUrl } from "@/lib/finance/vendors";
import { EmptyState, FinanceDialog, Metric, Money, formatDate, formatMoney, monthLabel } from "./shared";
import "./vendors.css";

function websiteLabel(value: string | null) {
  const url = vendorWebsiteUrl(value);
  return url ? new URL(url).hostname.replace(/^www\./, "") : "No website saved";
}

function VendorEditor({ vendor, mutate, onClose }: { vendor?: FinanceVendor; mutate: RecordsProps["mutate"]; onClose: () => void }) {
  const [name, setName] = useState(vendor?.name ?? "");
  const [url, setUrl] = useState(vendor?.url ?? "");
  const [notes, setNotes] = useState(vendor?.notes ?? "");
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const busy = useRef(false), id = useRef(vendor?.id ?? "");
  const close = () => { if (!busy.current) onClose(); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    setError("");
    if (!name.trim()) { setError("Enter a vendor name."); return; }
    busy.current = true; setPending(true);
    try {
      id.current ||= financeId();
      await mutate("save_vendor", { id: id.current, name: name.trim(), url: normalizeVendorUrl(url), notes: notes.trim() });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This vendor could not be saved. Please try again."); }
    finally { busy.current = false; setPending(false); }
  }
  return <FinanceDialog title={vendor ? "Edit vendor" : "Add vendor"} onClose={close}>
    <form onSubmit={submit}>
      <div className="fn-fields">
        <label className="fn-field full">Vendor name<input autoFocus required maxLength={200} value={name} onChange={event => setName(event.target.value)} placeholder="For example, your electricity company" disabled={pending} /></label>
        <label className="fn-field full">Website / payment link<input type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" maxLength={2048} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/pay" disabled={pending} /><small>Save the vendor’s website or payment page. The link opens in a new tab.</small></label>
        <label className="fn-field full">Notes<textarea maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Contact details or a reminder for next time" disabled={pending} /></label>
      </div>
      {vendor ? <p className="fn-form-help">Name and website changes appear on every bill, income item, and plan linked to this vendor. Recorded amounts and dates stay the same.</p> : <p className="fn-form-help">Choose this vendor when adding or editing bills, income, or a payment plan. You can also create a vendor while adding a bill.</p>}
      {error ? <p className="fn-form-error" role="alert">{error}</p> : null}
      <div className="fn-actions end"><button type="button" className="fn-button" onClick={close} disabled={pending}>Cancel</button><button type="submit" className="fn-button primary" disabled={pending}>{pending ? "Saving…" : "Save vendor"}</button></div>
    </form>
  </FinanceDialog>;
}

const statusLabels = { scheduled: "Scheduled", partial: "Partly paid", past_due: "Past due", paid: "Paid", received: "Received", cancelled: "Cancelled", collections: "In collections" };

export function VendorsPanel(props: RecordsProps) {
  const { data, month, today, mutate, openEntry, openPayment, openMove } = props;
  const [search, setSearch] = useState(""), [directoryFilter, setDirectoryFilter] = useState<"active" | "archived" | "all">("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"history" | "records">("history");
  const [period, setPeriod] = useState<"all" | "month">("all");
  const [editor, setEditor] = useState<{ vendor?: FinanceVendor } | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const busy = useRef(false);
  const vendors = useMemo(() => (data.vendors ?? []).filter(vendor => vendor.user_id === data.user.id).map(vendor => ({ vendor, summary: vendorSummary(data, vendor.id, today, month) })).sort((a, b) => a.vendor.name.localeCompare(b.vendor.name)), [data, today, month]);
  const selected = vendors.find(item => item.vendor.id === selectedId);
  const activeCount = vendors.filter(({ vendor }) => !vendor.archived_at).length;
  const query = search.trim().toLocaleLowerCase();
  const filtered = vendors.filter(({ vendor }) => (directoryFilter === "all" || (directoryFilter === "archived" ? Boolean(vendor.archived_at) : !vendor.archived_at)) && (!query || `${vendor.name} ${vendor.url ?? ""} ${vendor.notes}`.toLocaleLowerCase().includes(query)));

  async function changeArchive(vendor: FinanceVendor) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError("");
    try { await mutate("vendor_status", { id: vendor.id, archived: !vendor.archived_at }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The vendor could not be updated."); }
    finally { busy.current = false; setPending(false); }
  }
  function selectVendor(id: string) { setSelectedId(id); setTab("history"); setPeriod("all"); setError(""); }

  function renderDetail() {
    if (!selected) return null;
    const { vendor, summary } = selected;
    const website = vendorWebsiteUrl(vendor.url);
    const history = period === "all" ? summary.history : summary.history.filter(({ payment }) => payment.paid_on.startsWith(`${month}-`));
    const entries = summary.entries.filter(entry => period === "all" || entry.original_due_date.startsWith(`${month}-`) || entry.scheduled_date.startsWith(`${month}-`)).toSorted((a, b) => b.original_due_date.localeCompare(a.original_due_date) || a.title.localeCompare(b.title));
    const hasIncome = summary.entries.some(entry => entry.kind === "income");
    return <>
      <div className="fv-detail-head">
        <button className="fn-button subtle" type="button" onClick={() => setSelectedId(null)}><Icon name="arrow" size={14} style={{ transform: "rotate(180deg)" }} />All vendors</button>
        <div className="fn-actions"><button className="fn-button" type="button" onClick={() => setEditor({ vendor })} disabled={pending}><Icon name="edit" size={13} />Edit vendor</button><button className="fn-button" type="button" onClick={() => { void changeArchive(vendor); }} disabled={pending}>{pending ? "Saving…" : vendor.archived_at ? "Restore vendor" : "Archive vendor"}</button></div>
      </div>
      <section className="fn-panel fv-profile" aria-label="Vendor details">
        <span className="fv-avatar"><Icon name="globe" size={25} /></span>
        <div className="fv-profile-copy"><div className="fn-actions"><h2>{vendor.name}</h2>{vendor.archived_at ? <span className="fn-badge">Archived vendor</span> : null}</div><p>{websiteLabel(vendor.url)} · {summary.entry_count} linked {summary.entry_count === 1 ? "record" : "records"}</p>{vendor.notes ? <p className="fv-notes">{vendor.notes}</p> : null}</div>
        {website ? <a className="fn-button primary" href={website} target="_blank" rel="noopener noreferrer"><Icon name="external" size={14} />Open vendor website<span className="fr-sr-only"> for {vendor.name}, opens in a new tab</span></a> : <button className="fn-button" type="button" onClick={() => setEditor({ vendor })}>Add payment link</button>}
      </section>
      {vendor.archived_at ? <p className="fn-notice"><Icon name="info" size={17} />This vendor is hidden from new selections. Existing bills, repeating schedules, and payment history continue unchanged. Restore the vendor to use it on new records.</p> : null}
      <div className="fn-metrics">
        <Metric title="Paid to this vendor" cents={summary.paid_cents} detail="All recorded bill payments · reversals excluded" icon="check" tone="green" />
        <Metric title="Paid this month" cents={summary.month_paid_cents} detail={`${monthLabel(month)} · actual payment dates`} icon="calendar" tone="cyan" />
        <Metric title="Open bill balance" cents={summary.outstanding_cents} detail="All generated active bills, including future months" icon="wallet" />
        <Metric title="Past due" cents={summary.past_due_cents} detail="Unpaid active bills · based on original due dates" icon="clock" tone="red" />
      </div>
      {hasIncome ? <div className="fn-notice"><Icon name="coins" size={19} /><div><strong>Income from this vendor</strong><Money cents={summary.received_cents} /> received overall · <Money cents={summary.month_received_cents} /> received in {monthLabel(month)}. Income is shown separately from payments to the vendor.</div></div> : null}
      <section className="fn-panel">
        <div className="fn-toolbar"><div className="fn-tabs" aria-label="Vendor activity"><button className={`fn-tab ${tab === "history" ? "active" : ""}`} aria-pressed={tab === "history"} onClick={() => setTab("history")}>Payment history</button><button className={`fn-tab ${tab === "records" ? "active" : ""}`} aria-pressed={tab === "records"} onClick={() => setTab("records")}>Bills & income</button></div><label className="fv-period">Show<select className="fn-select" aria-label="Vendor activity period" value={period} onChange={event => setPeriod(event.target.value as "all" | "month")}><option value="all">All history</option><option value="month">{monthLabel(month)}</option></select></label></div>
        {tab === "history" ? <>
          <div className="fn-panel-head"><div><h2>{history.length} recorded {history.length === 1 ? "transaction" : "transactions"}</h2><p>Payments you record in Finance appear here. Reversed records remain visible for reference.</p></div></div>
          {history.length ? <div className="fn-table-wrap"><table className="fn-table fv-history"><thead><tr><th>Payment date</th><th>Bill / income</th><th>Type</th><th className="numeric">Amount</th><th>Status</th><th><span className="fr-sr-only">Actions</span></th></tr></thead><tbody>{history.map(({ payment, entry }) => <tr key={payment.id} className={payment.reversed_at ? "fv-reversed" : ""}>
            <td>{formatDate(payment.paid_on)}<small>Recorded {formatDate(payment.created_at)}</small></td><td><strong>{entry.title}</strong><small>Originally due {formatDate(entry.original_due_date)}</small>{payment.note ? <small className="fv-notes">{payment.note}</small> : null}</td><td>{entry.kind === "bill" ? "Bill payment" : "Income received"}</td><td className="numeric"><Money cents={payment.amount_cents} /></td><td><span className={`fn-badge ${payment.reversed_at ? "" : "positive"}`}>{payment.reversed_at ? "Reversed" : entry.kind === "bill" ? "Paid" : "Received"}</span>{payment.reversed_at ? <small>{formatDate(payment.reversed_at)}</small> : null}</td><td><button className="fn-button small" onClick={() => openEntry(entry)} aria-label={`View payment history for ${entry.title}`}>View record</button></td>
          </tr>)}</tbody></table></div> : <EmptyState title="No recorded payments here yet" description={period === "month" ? "Choose All history to see other months, or record a payment on a linked bill." : "Link a bill or income item to this vendor, then record a payment or receipt. Its history will appear here."} />}
        </> : <>
          <div className="fn-panel-head"><div><h2>{entries.length} linked {entries.length === 1 ? "record" : "records"}</h2><p>Includes paid, cancelled, archived, and transferred records. Month view includes original or moved dates in that month.</p></div></div>
          {entries.length ? <div className="fn-table-wrap"><table className="fn-table fv-records"><thead><tr><th>Bill / income</th><th>Original / planned date</th><th className="numeric">Amount</th><th className="numeric">Remaining</th><th>Status</th><th><span className="fr-sr-only">Actions</span></th></tr></thead><tbody>{entries.map(entry => {
            const state = entryState(entry, data.payments, today), remaining = remainingAmount(entry, data.payments);
            const actionable = entry.status === "active" && remaining > 0;
            const label = entry.kind === "income" && state === "partial" ? "Partly received" : entry.kind === "income" && state === "past_due" ? "Overdue income" : statusLabels[state];
            return <tr key={entry.id}><td><button className="fr-record-title" onClick={() => openEntry(entry)}>{entry.title}</button><small>{entry.kind === "income" ? "Income" : "Bill"} · {entry.category}</small></td><td>{formatDate(entry.original_due_date)}{isMoved(entry) ? <small><span className="fn-badge purple">Moved</span> {formatDate(entry.scheduled_date)}</small> : <small>Planned on due date</small>}</td><td className="numeric"><Money cents={entry.amount_cents} /></td><td className="numeric">{entry.status === "active" ? <Money cents={remaining} /> : <span className="fn-muted">{entry.status === "collections" ? "In collections" : "Cancelled"}</span>}</td><td><span className={`fn-badge ${state === "paid" || state === "received" ? "positive" : state === "past_due" ? "negative" : ""}`}>{label}</span>{entry.archived_at ? <small>Archived record</small> : null}</td><td><div className="fn-actions">{actionable ? <><button className="fn-button small primary" onClick={() => openPayment(entry)}>{entry.kind === "income" ? "Receive" : "Pay"}</button><button className="fn-button small" onClick={() => openMove(entry)}>Move</button></> : null}<button className="fn-button small" onClick={() => openEntry(entry)}>Manage</button></div></td></tr>;
          })}</tbody></table></div> : <EmptyState title="No linked records in this view" description="Choose this vendor when adding or editing a bill, income item, or payment plan. Existing records can be linked at any time." />}
        </>}
      </section>
      <p className="fn-muted fv-footnote">Opening a vendor’s website does not record or send a payment. After paying there, record it in Finance to update your balances and history. Plan amounts marked “already paid” are opening balances and do not create dated payment history.</p>
    </>;
  }

  return <div className="fv-workspace">
    {error ? <p className="fn-notice error" role="alert">{error}</p> : null}
    {selected ? renderDetail() : <>
      <div className="fn-notice"><Icon name="globe" size={20} /><div><strong>Your payment links and history, together.</strong>Save each company once, then link its bills, income, and payment plans. Choose a vendor to see its recorded payments and open balances.</div></div>
      <section className="fn-panel">
        <div className="fn-panel-head"><div><h2>Vendor directory</h2><p>{activeCount} active {activeCount === 1 ? "vendor" : "vendors"} · payment totals use the selected month</p></div><button className="fn-button primary" onClick={() => setEditor({})}><Icon name="plus" size={14} />Add vendor</button></div>
        <div className="fn-toolbar"><label className="fr-search"><Icon name="search" size={16} /><input type="search" aria-label="Search vendors" placeholder="Search name, website, or notes" value={search} onChange={event => setSearch(event.target.value)} /></label><div className="fn-tabs" aria-label="Vendor status">{(["active", "archived", "all"] as const).map(filter => <button key={filter} className={`fn-tab ${directoryFilter === filter ? "active" : ""}`} aria-pressed={directoryFilter === filter} onClick={() => setDirectoryFilter(filter)}>{filter === "all" ? "All vendors" : filter === "active" ? "Active" : "Archived"}</button>)}</div></div>
        {filtered.length ? <div className="fv-grid">{filtered.map(({ vendor, summary }) => {
          const website = vendorWebsiteUrl(vendor.url);
          return <article className="fv-card" key={vendor.id}><button className="fv-card-main" onClick={() => selectVendor(vendor.id)} aria-label={`View ${vendor.name} history. Paid this month ${formatMoney(summary.month_paid_cents)}. Open bills ${formatMoney(summary.outstanding_cents)}. ${summary.past_due_cents > 0 ? `${formatMoney(summary.past_due_cents)} past due.` : ""}`}><div className="fv-card-title"><span className="fv-avatar small"><Icon name="globe" size={20} /></span><div><h3>{vendor.name}</h3><p>{websiteLabel(vendor.url)}</p></div>{vendor.archived_at ? <span className="fn-badge">Archived</span> : null}</div><div className="fv-card-amounts"><span>Paid this month<strong><Money cents={summary.month_paid_cents} /></strong></span><span>Open bills<strong><Money cents={summary.outstanding_cents} /></strong></span></div>{summary.past_due_cents > 0 ? <p className="fn-negative">{formatMoney(summary.past_due_cents)} past due</p> : <p>{summary.entry_count} linked {summary.entry_count === 1 ? "record" : "records"}</p>}<span className="fv-history-link">View payments & history<Icon name="arrow" size={13} /></span></button>{website ? <a className="fv-website" href={website} target="_blank" rel="noopener noreferrer" aria-label={`Open ${vendor.name} website in a new tab`}><Icon name="external" size={12} />Open website</a> : null}</article>;
        })}</div> : <EmptyState title={search ? "No matching vendors" : directoryFilter === "archived" ? "No archived vendors" : "Keep your vendors in one place"} description={search ? "Try another vendor name or website." : directoryFilter === "archived" ? "Archiving hides a vendor from new selections and keeps its history available here." : "Add your first vendor here, or create one while adding a bill or income item."} action={!search && directoryFilter !== "archived" ? <button className="fn-button primary" onClick={() => setEditor({})}><Icon name="plus" size={14} />Add your first vendor</button> : undefined} />}
      </section>
      <p className="fn-muted fv-footnote">Open bills include all generated active dates, including future months. Payment history includes only payments recorded in Finance. You can link older bills to a vendor by editing them.</p>
    </>}
    {editor ? <VendorEditor key={editor.vendor?.id ?? "new"} vendor={editor.vendor} mutate={mutate} onClose={() => setEditor(null)} /> : null}
  </div>;
}

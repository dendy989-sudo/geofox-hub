"use client";

import { useMemo, useState } from "react";
import { AppBadge, Card, Empty, ErrorBanner, Loading, Metric, Modal, PageHeading, apiRequest, count, date, money, useHubData, type PanelProps } from "../admin/common";
import { Icon } from "../admin/icons";
import { Attachments } from "./attachments";
import type { WorkspaceList, WorkspaceRecord } from "@/lib/workspace/types";
import { CATEGORIES, TRANSACTION_TYPES, TYPE_LABELS, accountingCsv, accountingTotals, amountText, parseAmountCents, type AccountingData, type TransactionType } from "@/lib/workspace/accounting";
import { localDay } from "@/lib/workspace/legal-starters";
import "./finance-legal.css";

type Transaction = WorkspaceRecord<AccountingData>;
type Editor = { record?: Transaction; title: string; appSlug: string; status: string; amount: string; data: AccountingData; requestId: string };
function emptyData(): AccountingData { return { type: "expense", amountCents: 0, currency: "USD", occurredOn: localDay(), category: "Other", payee: "", reference: "", notes: "", attachments: [] }; }
function normalizeData(data: Partial<AccountingData>): AccountingData { return { ...emptyData(), ...data, attachments: Array.isArray(data.attachments) ? data.attachments : [] }; }
function dollars(cents: number) { return money(cents / 100); }
function statusName(value: string) { return value === "paid" ? "Paid" : value === "pending" ? "Pending" : value === "void" ? "Void" : value; }
function scopeLabel(slug: string | null, apps: PanelProps["apps"]) { return slug ? apps.find((item) => item.slug === slug)?.name || slug : "Geofox company"; }
function monthName(value: string) { return value ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}-01T12:00:00Z`)) : "All dates"; }

export function AccountingPanel({ preview, app, apps, refreshKey, notify, can, staffRole, workspaceAccess, view = "overview" }: PanelProps & { view?: string }) {
  const canWrite = !preview && can("accounting:write");
  const companyWritable = preview || staffRole === "owner" || workspaceAccess?.accounting.companyLevel === "write";
  const defaultScope = app !== "all" && app !== "company" ? app : companyWritable ? "company" : apps[0]?.slug || "";
  const source = useHubData<WorkspaceList<AccountingData>>(preview ? null : `/api/workspace/records?module=accounting&app=${encodeURIComponent(app)}&limit=1000`, refreshKey);
  const [month, setMonth] = useState(() => localDay().slice(0, 7));
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const records = useMemo(() => (source.data?.items || []).map((record) => ({ ...record, data: normalizeData(record.data) })), [source.data]);
  const visible = records.filter((record) => (!month || record.data.occurredOn.startsWith(month)) && (kind === "all" || record.data.type === kind) && (status === "all" || record.status === status) && `${record.title} ${record.data.category} ${record.data.payee} ${record.data.reference} ${record.data.notes}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.data.occurredOn.localeCompare(a.data.occurredOn) || b.createdAt.localeCompare(a.createdAt));
  const incomplete = !!source.data && source.data.total > records.length;
  const totals = accountingTotals(visible);
  const categories = new Map<string, number>();
  const periods = new Map<string, Transaction[]>();
  for (const record of visible) {
    if (record.data.type === "expense" && record.status === "paid") categories.set(record.data.category || "Other", (categories.get(record.data.category || "Other") || 0) + record.data.amountCents);
    const period = record.data.occurredOn.slice(0, 7);
    periods.set(period, [...(periods.get(period) || []), record]);
  }
  const categoryRows = [...categories.entries()].sort((a, b) => b[1] - a[1]);
  const monthRows = [...periods.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const receiptCount = visible.reduce((total, record) => total + record.data.attachments.length, 0);

  function beginEdit(record?: Transaction) {
    setError(""); setSelected(null);
    const data = record ? normalizeData(record.data) : emptyData();
    setEditor({ record, title: record?.title || "", appSlug: record ? record.appSlug || "company" : defaultScope, status: record?.status || "paid", amount: record ? amountText(data.amountCents) : "", data, requestId: crypto.randomUUID() });
  }
  function changeData<K extends keyof AccountingData>(key: K, value: AccountingData[K]) { setEditor((current) => current ? { ...current, data: { ...current.data, [key]: value } } : current); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!editor || busy || uploading) return;
    if (!editor.appSlug || (editor.appSlug === "company" && !companyWritable)) { setError("Choose an app you can manage for this record."); return; }
    const amount = parseAmountCents(editor.amount);
    if (amount === null) { setError("Enter a positive USD amount with at most two decimal places."); return; }
    setBusy(true); setError("");
    try {
      await apiRequest(`/api/workspace/records${editor.record ? `/${editor.record.id}` : ""}`, { method: editor.record ? "PATCH" : "POST", body: JSON.stringify({ module: "accounting", appSlug: editor.appSlug === "company" ? null : editor.appSlug, title: editor.title.trim(), status: editor.status, data: { ...editor.data, amountCents: amount }, ...(editor.record ? { version: editor.record.version } : { requestId: editor.requestId }) }) });
      setEditor(null); source.reload(); notify(editor.record ? "Transaction updated." : "Transaction recorded.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save this transaction."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting || busy) return; setBusy(true); setError("");
    try { await apiRequest(`/api/workspace/records/${deleting.id}`, { method: "DELETE", body: JSON.stringify({ version: deleting.version }) }); setDeleting(null); source.reload(); notify("Transaction deleted."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to delete this transaction."); }
    finally { setBusy(false); }
  }
  function exportCsv() {
    if (!visible.length || incomplete) return;
    const url = URL.createObjectURL(new Blob(["\uFEFF", accountingCsv(visible)], { type: "text/csv;charset=utf-8;" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `geofox-cashbook-${app}-${month || "all-dates"}.csv`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(`Exported ${visible.length} filtered ${visible.length === 1 ? "transaction" : "transactions"}.`);
  }
  function transactionTable(items: Transaction[]) {
    return items.length ? <div className="hub-table-scroll"><table className="hub-table"><thead><tr><th>Date</th><th>Transaction</th><th>Company / app</th><th>Type</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>{items.map((record) => <tr key={record.id}><td>{date(record.data.occurredOn, true)}</td><td className="wf-table-title"><button className="wf-list-title" onClick={() => setSelected(record)}>{record.title}</button><span className="wf-table-note">{record.data.category}{record.data.payee ? ` · ${record.data.payee}` : ""}{record.data.attachments.length ? ` · ${record.data.attachments.length} receipt${record.data.attachments.length > 1 ? "s" : ""}` : ""}</span></td><td>{record.appSlug ? <AppBadge slug={record.appSlug} apps={apps} /> : "Company"}</td><td>{TYPE_LABELS[record.data.type]}</td><td className={`wf-amount ${record.data.type}`}>{dollars(record.data.amountCents)}</td><td><span className={`wf-status ${record.status}`}>{statusName(record.status)}</span></td><td><div className="wf-table-actions"><button className="hub-table-action" onClick={() => setSelected(record)}>View</button>{canWrite && (record.appSlug || companyWritable) && <button className="hub-table-action" onClick={() => beginEdit(record)}>Edit</button>}</div></td></tr>)}</tbody></table></div> : <Empty icon="coins" title={records.length ? "No transactions in this view" : "Start with your first transaction"} description={records.length ? "Choose another month, clear the search, or adjust your filters." : "Record income and expenses, attach receipts, and track owner activity separately."} />;
  }

  return <div className="workspace-finance">
    <PageHeading kicker="Company workspace" title={view === "transactions" ? "Transaction register" : view === "reports" ? "Accounting reports" : "Accounting"} description="A simple cashbook for company spending, app income, and the records behind every transaction." />
    <div className="wf-toolbar"><p className="wf-help">{app === "all" ? "Company and accessible apps" : scopeLabel(app === "company" ? null : app, apps)} · USD</p><div className="wf-actions"><button className="hub-button secondary" onClick={exportCsv} disabled={!visible.length || source.loading || incomplete}><Icon name="download" size={15} />Export CSV</button><button className="hub-button" disabled={!canWrite || !defaultScope || busy} onClick={() => beginEdit()}><Icon name="coins" size={15} />New transaction</button></div></div>
    {preview && <div className="wf-compact-banner">This preview is empty. Sign in with Accounting access to save transactions and receipts.</div>}
    {!preview && !canWrite && <p className="wf-help">You have view access to this workspace.</p>}
    <ErrorBanner error={source.error} />
    {!editor && !deleting && <ErrorBanner error={error} />}
    {incomplete && <div className="hub-banner warning" role="status">Loaded {count(records.length)} of {count(source.data?.total || 0)} records. All figures below are subtotals of the loaded records, and CSV export is disabled. Narrow the app scope to load a complete register.</div>}
    <div className="hub-controls"><label className="hub-field"><span>Month</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><button className="hub-button secondary small" style={{ alignSelf: "flex-end" }} onClick={() => setMonth(month ? "" : localDay().slice(0, 7))}>{month ? "All dates" : "Current month"}</button><label className="hub-field wf-search"><span>Search</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Description, payee, category, reference…" /></label><label className="hub-field"><span>Type</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All types</option>{TRANSACTION_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}</select></label><label className="hub-field"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="paid">Paid</option><option value="pending">Pending</option><option value="void">Void</option></select></label></div>
    <div className="hub-metrics-grid"><Metric title="Income received" value={dollars(totals.income)} detail="Paid operating income in this view" icon="coins" tone="green" /><Metric title="Expenses paid" value={dollars(totals.expenses)} detail="Paid operating expenses in this view" icon="book" tone="orange" /><Metric title="Net operating cash" value={dollars(totals.net)} detail="Income less expenses; excludes owner activity" icon="pulse" tone="purple" /><Metric title="Pending payments" value={dollars(totals.pendingExpenses)} detail={`${count(totals.pendingCount)} pending transactions in this view`} icon="clock" tone="cyan" /></div>
    {source.loading ? <Loading label="Loading your cashbook…" /> : view === "reports" ? <>
      <div className="wf-two-column"><Card title="Monthly cash summary" subtitle="Paid transactions in the selected filters. Owner activity is shown separately.">{monthRows.length ? <div className="hub-table-scroll"><table className="hub-table"><thead><tr><th>Month</th><th>Income</th><th>Expenses</th><th>Net operating</th><th>Contributions</th><th>Draws</th></tr></thead><tbody>{monthRows.map(([period, items]) => { const row = accountingTotals(items); return <tr key={period}><td>{monthName(period)}</td><td className="wf-amount">{dollars(row.income)}</td><td className="wf-amount">{dollars(row.expenses)}</td><td className="wf-amount">{dollars(row.net)}</td><td className="wf-amount">{dollars(row.contributions)}</td><td className="wf-amount">{dollars(row.draws)}</td></tr>; })}</tbody></table></div> : <Empty icon="pulse" title="Your monthly view will grow here" description="Record paid transactions to see income, expenses, and owner activity by month." />}</Card><Card title="Expenses by category" subtitle={monthName(month)}><div className="hub-card-body">{categoryRows.length ? categoryRows.map(([category, amount]) => <div key={category} style={{ marginBottom: 16 }}><div className="wf-report-row" style={{ border: 0, paddingBottom: 0 }}><span>{category}</span><strong>{dollars(amount)}</strong></div><div className="wf-category-bar" role="img" aria-label={`${category}: ${Math.round(amount / totals.expenses * 100)} percent of expenses`}><span style={{ width: `${amount / totals.expenses * 100}%` }} /></div></div>) : <p className="wf-help">No paid expenses in this view.</p>}</div></Card></div>
      <Card title="Records for your bookkeeping" subtitle="A cashbook summary based on the transactions you entered."><div className="hub-card-body"><div className="wf-report-row"><span>Filtered transactions</span><strong>{count(visible.length)}</strong></div><div className="wf-report-row"><span>Attached receipts and evidence</span><strong>{count(receiptCount)}</strong></div><div className="wf-report-row"><span>Pending income</span><strong>{dollars(totals.pendingIncome)}</strong></div><div className="wf-report-row"><span>Pending expenses</span><strong>{dollars(totals.pendingExpenses)}</strong></div><p className="wf-inline-note">CSV exports contain the filtered transaction register. Receipts remain attached to each record. These reports do not calculate taxable profit, depreciation, sales tax, or your bank balance.</p></div></Card>
    </> : view === "transactions" ? <Card title="Cashbook" subtitle={`${monthName(month)} · ${count(visible.length)} transactions`}>{transactionTable(visible)}<div className="wf-table-footer"><span>All amounts in USD</span><span>{count(receiptCount)} attached receipts</span></div></Card> : <>
      <div className="wf-two-column"><Card title="Recent transactions" subtitle={`${monthName(month)} · Showing ${Math.min(8, visible.length)} of ${count(visible.length)} filtered transactions`}>{transactionTable(visible.slice(0, 8))}</Card><div className="wf-stack"><Card title="Owner activity" subtitle="Separate from operating income and expenses."><div className="hub-card-body"><div className="wf-report-row"><span>Owner contributions</span><strong>{dollars(totals.contributions)}</strong></div><div className="wf-report-row"><span>Owner draws</span><strong>{dollars(totals.draws)}</strong></div><div className="wf-report-row"><span>Internal transfers recorded</span><strong>{dollars(totals.transfers)}</strong></div><div className="wf-report-row total"><span>Net recorded cash movement</span><strong>{dollars(totals.cashMovement)}</strong></div><p className="wf-inline-note">Net operating cash plus contributions, less draws. Internal transfers do not change the total. This is activity in the selected view, not a reconciled bank balance.</p></div></Card><Card title="Waiting to be settled" subtitle="Pending transactions stay out of paid totals."><div className="hub-card-body"><div className="wf-report-row"><span>Income expected</span><strong>{dollars(totals.pendingIncome)}</strong></div><div className="wf-report-row"><span>Expenses expected</span><strong>{dollars(totals.pendingExpenses)}</strong></div><p className="wf-inline-note">Open a transaction and change its status and date after the money is received or paid.</p></div></Card></div></div>
      <div className="wf-compact-banner">Start with the cash that actually moves: enter each receipt or payment once, attach its evidence, and use owner contribution or owner draw for money moved between you and the company.</div>
    </>}
    {editor && <Modal title={editor.record ? "Edit transaction" : "New transaction"} description="Enter a positive amount. The transaction type determines how it appears in reports." onClose={() => { if (!busy && !uploading) { setEditor(null); setError(""); } }}><form onSubmit={save}><ErrorBanner error={error} /><div className="wf-form-grid">
      <label className="hub-field wf-span"><span>Description</span><input required maxLength={200} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} placeholder="e.g. Monthly hosting invoice" /></label>
      <label className="hub-field"><span>Company / app</span><select value={editor.appSlug} disabled={busy || uploading || editor.data.attachments.length > 0} onChange={(event) => setEditor({ ...editor, appSlug: event.target.value })}>{companyWritable && <option value="company">Geofox company</option>}{apps.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select>{editor.data.attachments.length > 0 && <small>Remove attachments before changing their company or app.</small>}</label>
      <label className="hub-field"><span>Transaction type</span><select value={editor.data.type} onChange={(event) => changeData("type", event.target.value as TransactionType)}>{TRANSACTION_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}</select></label>
      <label className="hub-field"><span>Amount (USD)</span><input required inputMode="decimal" value={editor.amount} onChange={(event) => setEditor({ ...editor, amount: event.target.value })} placeholder="0.00" /></label>
      <label className="hub-field"><span>Date {editor.status === "pending" ? "expected" : editor.status === "paid" ? "received / paid" : "recorded"}</span><input required type="date" value={editor.data.occurredOn} onChange={(event) => changeData("occurredOn", event.target.value)} /></label>
      <label className="hub-field"><span>Status</span><select value={editor.status} onChange={(event) => setEditor({ ...editor, status: event.target.value })}><option value="paid">Paid / received</option><option value="pending">Pending</option><option value="void">Void</option></select></label>
      <label className="hub-field"><span>Category</span><input list="accounting-categories" required maxLength={120} value={editor.data.category} onChange={(event) => changeData("category", event.target.value)} /><datalist id="accounting-categories">{CATEGORIES.map((category) => <option key={category} value={category} />)}</datalist></label>
      <label className="hub-field"><span>{editor.data.type === "income" ? "Customer / source" : "Payee / recipient"}</span><input maxLength={200} value={editor.data.payee} onChange={(event) => changeData("payee", event.target.value)} /></label>
      <label className="hub-field"><span>Invoice / reference</span><input maxLength={200} value={editor.data.reference} onChange={(event) => changeData("reference", event.target.value)} /></label>
      <label className="hub-field wf-span"><span>Notes</span><textarea maxLength={10000} value={editor.data.notes} onChange={(event) => changeData("notes", event.target.value)} placeholder={editor.data.type === "transfer" ? "Record the source and destination accounts; enter each internal transfer once." : "Context, payment method, or anything you need for later."} /></label>
      <div className="wf-span"><Attachments module="accounting" appSlug={editor.appSlug === "company" ? null : editor.appSlug} value={editor.data.attachments} onChange={(value) => changeData("attachments", value)} disabled={busy} onBusyChange={setUploading} /></div>
    </div>{["owner_contribution", "owner_draw", "transfer"].includes(editor.data.type) && <p className="wf-inline-note">This transaction will be excluded from operating income and expenses.</p>}<div className="wf-actions" style={{ justifyContent: "flex-end", marginTop: 20 }}><button type="button" className="hub-button secondary" disabled={busy || uploading} onClick={() => { setEditor(null); setError(""); }}>Cancel</button><button className="hub-button" disabled={busy || uploading}>{uploading ? "Uploading…" : busy ? "Saving…" : "Save transaction"}</button></div></form></Modal>}
    {selected && <Modal title={selected.title} description={`${TYPE_LABELS[selected.data.type]} · ${scopeLabel(selected.appSlug, apps)}`} onClose={() => setSelected(null)} actions={canWrite && (selected.appSlug || companyWritable) ? <><button className="hub-button danger" onClick={() => { setSelected(null); setDeleting(selected); setError(""); }}>Delete</button><button className="hub-button" onClick={() => beginEdit(selected)}>Edit transaction</button></> : undefined}><dl className="wf-detail"><div><dt>Amount</dt><dd>{dollars(selected.data.amountCents)}</dd></div><div><dt>Status</dt><dd>{selected.status === "paid" ? "Paid / received" : statusName(selected.status)}</dd></div><div><dt>{selected.status === "paid" ? "Date received / paid" : selected.status === "pending" ? "Expected date" : "Date recorded"}</dt><dd>{date(selected.data.occurredOn, true)}</dd></div><div><dt>Category</dt><dd>{selected.data.category}</dd></div><div><dt>Payee / source</dt><dd>{selected.data.payee || "Not recorded"}</dd></div><div><dt>Reference</dt><dd>{selected.data.reference || "Not recorded"}</dd></div>{selected.data.notes && <div className="wf-span"><dt>Notes</dt><dd>{selected.data.notes}</dd></div>}</dl><Attachments module="accounting" appSlug={selected.appSlug} value={selected.data.attachments} onChange={() => {}} viewOnly /><p className="wf-inline-note">Last updated {date(selected.updatedAt)}</p></Modal>}
    {deleting && <Modal title="Delete transaction?" description={`${deleting.title} · ${dollars(deleting.data.amountCents)}`} onClose={() => { if (!busy) { setDeleting(null); setError(""); } }} actions={<><button className="hub-button secondary" disabled={busy} onClick={() => { setDeleting(null); setError(""); }}>Keep transaction</button><button className="hub-button danger" disabled={busy} onClick={remove}>{busy ? "Deleting…" : "Delete transaction"}</button></>}><ErrorBanner error={error} /><p className="wf-help">This removes the entry from your cashbook and its totals. Edit it instead if you need to correct an amount, status, or category.</p></Modal>}
  </div>;
}

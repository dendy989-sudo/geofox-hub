"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Icon } from "@/components/admin/icons";
import { TAX_YEARS, type ImportPreview, type TaxRecord, type TaxSnapshot } from "@/lib/taxes/types";
import { STATEMENT_MONTHS, bankStatementCoverage, statementVisibleInYear, statementYearGroups } from "@/lib/taxes/statement-periods";
import { byKind, dateLabel, Empty, Field, human, money, Panel, str, taxRequest } from "./shared";
import "./intake.css";

interface Props { snapshot: TaxSnapshot; onRefresh: () => Promise<void>; notify: (message: string) => void; }
interface CsvMapping { date: string; description: string; amount?: string; debit?: string; credit?: string; date_format?: "mdy" | "dmy" | "ymd"; invert_amount?: boolean; }
interface MappingNeeded { needs_mapping: true; statement: TaxRecord; headers: string[]; sample: string[][]; suggested_mapping?: Partial<CsvMapping>; warnings?: string[]; }
const pageSize = 25;
const maximumBytes = 20 * 1024 * 1024;
const documentTypes = [
  { value: "bank_statement", label: "Bank / card statement" }, { value: "return", label: "Filed tax return" },
  { value: "notice", label: "IRS notice or transcript" }, { value: "receipt", label: "Receipt / supporting expense" },
  { value: "ppp", label: "PPP loan or forgiveness record" }, { value: "relief", label: "Stimulus / relief record" },
  { value: "other", label: "Other supporting document" },
] as const;
type DocumentType = typeof documentTypes[number]["value"];

function fileMime(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const allowed: Record<string, string> = { csv: "text/csv", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
  return extension ? allowed[extension] || "" : "";
}
function statementStatus(record: TaxRecord) {
  const status = str(record.data.status);
  return status === "imported" ? "Imported" : status === "preview" ? "Ready for review" : status === "uploaded" ? "Original saved" : status === "failed" ? "Needs another try" : "Upload needs verification";
}
function isMappingNeeded(value: ImportPreview | MappingNeeded): value is MappingNeeded { return "needs_mapping" in value && value.needs_mapping; }
function savedPreview(statement: TaxRecord): ImportPreview | null {
  const candidate = statement.data.preview;
  if (!candidate || typeof candidate !== "object" || !Array.isArray((candidate as ImportPreview).rows)) return null;
  return { ...candidate as Omit<ImportPreview, "statement">, statement };
}

export function TaxImportPanel({ snapshot, onRefresh, notify }: Props) {
  const accounts = byKind(snapshot, "account");
  const allStatements=byKind(snapshot,"statement");
  const statements=allStatements.filter(record=>statementVisibleInYear(record,snapshot.year)).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const [coverageAccount,setCoverageAccount]=useState(accounts[0]?.id??"");
  const [filterType,setFilterType]=useState("all");
  const [filterAccount,setFilterAccount]=useState("all");
  const [periodDrafts,setPeriodDrafts]=useState<Record<string,string>>({});
  const [month,setMonth]=useState("");
  const visibleStatements=statements.filter(record=>(filterType==="all"||(filterType==="bank_statement"?record.data.document_type==="bank_statement":record.data.document_type!=="bank_statement"))&&(filterAccount==="all"||record.data.account_id===filterAccount));
  const coverage=bankStatementCoverage(allStatements,coverageAccount,snapshot.year);
  const [year, setYear] = useState(snapshot.year);
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0].id : "");
  const [documentType, setDocumentType] = useState<DocumentType>("bank_statement");
  const [file, setFile] = useState<File | null>(null);
  const [aiConsent, setAiConsent] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mappingNeeded, setMappingNeeded] = useState<MappingNeeded | null>(null);
  const [mapping, setMapping] = useState<CsvMapping>({ date: "", description: "", amount: "", date_format: "mdy", invert_amount: false });
  const [amountMode, setAmountMode] = useState<"signed" | "separate">("signed");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [opening, setOpening] = useState("");
  const operation = useRef(false);
  const mounted = useRef(true);
  const currentViewYear = useRef(snapshot.year);
  currentViewYear.current = snapshot.year;

  useEffect(() => { setYear(snapshot.year); setPreview(null); setMappingNeeded(null); setError(""); setPage(0); setReviewed(false); setMonth(""); setPeriodDrafts({}); }, [snapshot.year]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const selectedTotals = useMemo(() => (preview?.rows || []).reduce((total, row, index) => selected.has(index) ? { count: total.count + 1, net: total.net + row.amount_cents } : total, { count: 0, net: 0 }), [preview, selected]);
  const duplicateCount = preview?.rows.filter(row => row.possible_duplicate).length || 0;
  const needsReconciliationReview = preview?.reconciliation_difference_cents !== 0;
  const selectedAccountExists = accounts.some(account => account.id === accountId);
  const isStatement = documentType === "bank_statement";
  const canShowResult = (requestedViewYear: number) => mounted.current && currentViewYear.current === requestedViewYear;

  function showPreview(result: ImportPreview | MappingNeeded) {
    setReviewed(false); setPage(0);
    if (isMappingNeeded(result)) {
      setMappingNeeded(result); setPreview(null);
      setMapping({ date: result.suggested_mapping?.date || "", description: result.suggested_mapping?.description || "", amount: result.suggested_mapping?.amount || "", debit: result.suggested_mapping?.debit || "", credit: result.suggested_mapping?.credit || "", date_format: result.suggested_mapping?.date_format || "mdy", invert_amount: false });
      setAmountMode(result.suggested_mapping?.debit || result.suggested_mapping?.credit ? "separate" : "signed");
    } else {
      setMappingNeeded(null); setPreview(result);
      setSelected(new Set(result.rows.flatMap((row, index) => row.possible_duplicate || Number(row.date.slice(0,4)) < 2018 || Number(row.date.slice(0,4)) > 2100 ? [] : [index])));
    }
  }
  function chooseFile(next: File | undefined) {
    if (!next || operation.current) return;
    setError("");
    if (!fileMime(next)) { setError("Choose a CSV, PDF, JPG, PNG, or WebP statement."); return; }
    if (next.size <= 0 || next.size > maximumBytes) { setError("Choose a nonempty statement no larger than 20 MB."); return; }
    setFile(next);
  }
  function dropFile(event: DragEvent<HTMLLabelElement>) { event.preventDefault(); chooseFile(event.dataTransfer.files[0]); }
  function chooseFromInput(event: ChangeEvent<HTMLInputElement>) { chooseFile(event.target.files?.[0]); event.target.value = ""; }
  async function refreshAfterSave(requestedViewYear: number) {
    if (!canShowResult(requestedViewYear)) return;
    try { await onRefresh(); }
    catch { notify("Saved. Refresh the workspace to see the latest statement list."); }
  }
  async function upload() {
    if (!file || operation.current || (isStatement && (!selectedAccountExists || !month))) return;
    const currentFile = file;
    const mime = fileMime(currentFile);
    const requestedViewYear = snapshot.year;
    const documentYear = year;
    let preparedId = "";
    operation.current = true; setError(""); setBusy("Saving your original statement privately…");
    try {
      const prepared = await taxRequest<{ statement: TaxRecord; upload: { url: string; token: string; path: string } }>("/api/taxes/import", { action: "prepare_upload", year: documentYear, document_type: documentType, statement_month: isStatement ? Number(month) : null, account_id: accountId || null, file_name: currentFile.name, mime_type: mime, size_bytes: currentFile.size });
      preparedId = prepared.statement.id;
      const uploaded = await fetch(prepared.upload.url, { method: "PUT", headers: { "Content-Type": mime, "x-upsert": "false" }, body: currentFile, credentials: "omit" });
      if (!uploaded.ok) throw new Error("The statement did not finish uploading. Keep the original file and try again.");
      const verified = await taxRequest<{ statement: TaxRecord }>("/api/taxes/import", { action: "verify_upload", statement_id: prepared.statement.id });
      if (!canShowResult(requestedViewYear)) { notify(`Your original is saved under ${documentYear}. Open that year to continue.`); return; }
      setFile(null); setMonth(""); await refreshAfterSave(requestedViewYear);
      if (!isStatement) { notify(`Supporting document saved privately under ${documentYear}.`); return; }
      if (mime !== "text/csv" && (!aiConsent || !snapshot.aiAvailable)) {
        notify("Your original statement is saved privately. Turn on AI reading and choose Review transactions when you are ready.");
        return;
      }
      setBusy(mime === "text/csv" ? "Reading statement rows…" : "AI is reading your statement. This can take a moment…");
      const result = await taxRequest<ImportPreview | MappingNeeded>("/api/taxes/import", { action: "preview", statement_id: verified.statement.id, ai_consent: aiConsent });
      if (canShowResult(requestedViewYear)) showPreview(result);
      await refreshAfterSave(requestedViewYear);
    } catch (reason) { if (canShowResult(requestedViewYear)) { if (preparedId) await refreshAfterSave(requestedViewYear); setError(reason instanceof Error ? reason.message : "The statement could not be read. Your saved original can be opened again below."); } }
    finally { operation.current = false; if (canShowResult(requestedViewYear)) setBusy(""); }
  }
  async function resume(statement: TaxRecord, newMapping?: CsvMapping, forceMapping = false) {
    if (operation.current) return;
    const stored = !newMapping && !forceMapping && savedPreview(statement);
    if (stored) { showPreview(stored); setError(""); return; }
    const mime = str(statement.data.mime_type);
    const requestedViewYear = snapshot.year;
    if (!mime.includes("csv") && mime !== "application/vnd.ms-excel" && (!aiConsent || !snapshot.aiAvailable)) { setError("Enable AI statement reading above to extract transactions from this PDF or image."); return; }
    operation.current = true; setError(""); setBusy("Reading your saved statement…");
    try {
      const result = await taxRequest<ImportPreview | MappingNeeded>("/api/taxes/import", { action: "preview", statement_id: statement.id, ai_consent: aiConsent, ...(newMapping ? { mapping: newMapping } : {}), ...(forceMapping ? { force_mapping: true } : {}) });
      if (canShowResult(requestedViewYear)) showPreview(result);
      await refreshAfterSave(requestedViewYear);
    } catch (reason) { if (canShowResult(requestedViewYear)) setError(reason instanceof Error ? reason.message : "This statement could not be read. Please try again."); }
    finally { operation.current = false; if (canShowResult(requestedViewYear)) setBusy(""); }
  }
  async function commit() {
    if (!preview || !reviewed || operation.current) return;
    const requestedViewYear = snapshot.year;
    operation.current = true; setBusy("Saving reviewed transactions…"); setError("");
    try {
      const result = await taxRequest<{ imported: number; duplicates_skipped: number; statement_id: string }>("/api/taxes/import", { action: "commit", statement_id: preview.statement.id, rows: preview.rows.filter((_, index) => selected.has(index)), acknowledge_unreconciled: reviewed && (needsReconciliationReview || selected.size === 0) });
      if (canShowResult(requestedViewYear)) { setPreview(null); setSelected(new Set()); setReviewed(false); }
      await refreshAfterSave(requestedViewYear);
      notify(result.imported ? `${result.imported} transactions imported${result.duplicates_skipped ? `; ${result.duplicates_skipped} duplicates skipped` : ""}. Open Review queue for anything that needs a decision.` : `Statement review saved without adding transactions${result.duplicates_skipped ? `; ${result.duplicates_skipped} duplicates skipped` : ""}.`);
    } catch (reason) { if (canShowResult(requestedViewYear)) setError(reason instanceof Error ? reason.message : "The transactions could not be saved. Please try again."); }
    finally { operation.current = false; if (canShowResult(requestedViewYear)) setBusy(""); }
  }
  async function verifyOriginal(statement: TaxRecord) {
    if (operation.current) return;
    const requestedViewYear = snapshot.year;
    operation.current = true; setBusy("Checking the saved original…"); setError("");
    try {
      await taxRequest<{ statement: TaxRecord }>("/api/taxes/import", { action: "verify_upload", statement_id: statement.id });
      await refreshAfterSave(requestedViewYear); notify("Your original document is verified and saved.");
    } catch (reason) { if (canShowResult(requestedViewYear)) setError(reason instanceof Error ? reason.message : "The upload could not be verified. Choose the original file and upload it again."); }
    finally { operation.current = false; if (canShowResult(requestedViewYear)) setBusy(""); }
  }
  async function openOriginal(statement: TaxRecord) {
    if (opening) return;
    setOpening(statement.id); setError("");
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const result = await taxRequest<{ url: string }>("/api/taxes/import", { action: "download", statement_id: statement.id });
      if (tab) tab.location.replace(result.url);
      else { const anchor = document.createElement("a"); anchor.href = result.url; anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; anchor.click(); }
    } catch (reason) { tab?.close(); setError(reason instanceof Error ? reason.message : "The original could not be opened."); }
    finally { setOpening(""); }
  }
  async function saveStatementMonth(statement:TaxRecord) {
    const chosen=Number(periodDrafts[statement.id]??statement.data.statement_month);
    if(!Number.isInteger(chosen)||chosen<1||chosen>12||operation.current)return;
    const target=snapshot.year;operation.current=true;setBusy("Saving the statement month…");setError("");
    try{await taxRequest("/api/taxes/import",{action:"set_period",statement_id:statement.id,version:statement.version,statement_month:chosen});await refreshAfterSave(target);notify("Statement month saved.");}
    catch(e){setError(e instanceof Error?e.message:"Could not save the statement month.");}
    finally{operation.current=false;if(canShowResult(target))setBusy("");}
  }
  async function removeStatement(statement:TaxRecord) {
    if(operation.current)return;
    const count=Number(statement.data.imported_count||0);
    if(!window.confirm(`Delete “${statement.title}”? ${count? `This also removes ${count} imported transactions from their tax years and recalculates your reports. `:""}The original file will be deleted; change history is kept. This cannot be undone.`))return;
    const target=snapshot.year;operation.current=true;setBusy("Deleting document and linked transactions…");setError("");
    try{
      const result=await taxRequest<{removed_transactions:number;original_deleted:boolean}>("/api/taxes/import",{action:"remove",statement_id:statement.id,version:statement.version});
      if(preview?.statement.id===statement.id){setPreview(null);setMappingNeeded(null);}
      await refreshAfterSave(target);
      notify(result.original_deleted ? `Document deleted. ${result.removed_transactions} linked transactions removed from reports.` : "Document removed from your workspace, but the private original could not be erased automatically. Contact support for final file cleanup.");
    }catch(e){setError(e instanceof Error?e.message:"Could not delete the document.");}
    finally{operation.current=false;if(canShowResult(target))setBusy("");}
  }
  function toggle(index: number) { setSelected(current => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; }); setReviewed(false); }
  const pageRows = preview?.rows.slice(page * pageSize, (page + 1) * pageSize) || [];
  const yearGroups = preview ? statementYearGroups(preview.rows) : [];

  return <div className="tx-stack">
    <Panel title="Start with one document" subtitle="Keep statements, filed returns, IRS notices, and supporting records together for the year.">
      <div className="tx-intake-form">
        <Field label="Document type"><select className="tx-input" value={documentType} onChange={event => setDocumentType(event.target.value as DocumentType)} disabled={Boolean(busy)}>{documentTypes.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></Field>
        <Field label={isStatement ? "Statement year" : "Tax year"}><select className="tx-input" value={year} onChange={event => setYear(Number(event.target.value))} disabled={Boolean(busy)}>{TAX_YEARS.map(value => <option key={value} value={value}>{value}</option>)}</select></Field>
        {isStatement ? <Field label="Statement month"><select id="tx-statement-month" className="tx-input" value={month} onChange={event=>setMonth(event.target.value)} disabled={Boolean(busy)}><option value="">Choose month</option>{STATEMENT_MONTHS.map((label,index)=><option key={label} value={index+1}>{label} {year}</option>)}</select></Field> : null}
         <Field label={`Bank or card account${isStatement ? "" : " (optional)"}`}><select className="tx-input" value={accountId} onChange={event => setAccountId(event.target.value)} disabled={Boolean(busy)}><option value="">{isStatement ? "Choose the statement’s account" : "No bank account linked"}</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.title}</option>)}</select></Field>
      </div>
      {!accounts.length && isStatement ? <p className="tx-notice">Add a bank or card in Businesses & accounts first. One account can contain both business and personal transactions.</p> : null}
      <label className={`tx-upload-drop${file ? " has-file" : ""}`} onDragOver={event => event.preventDefault()} onDrop={dropFile}>
        <span className="tx-upload-symbol"><Icon name={file ? "check" : "upload"} size={25} /></span><strong>{file ? file.name : "Choose a document or drop it here"}</strong><span>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ready to upload` : "CSV, PDF, JPG, PNG, or WebP · up to 20 MB"}</span><input type="file" accept=".csv,.pdf,.jpg,.jpeg,.png,.webp" aria-label="Choose a tax document" onChange={chooseFromInput} disabled={Boolean(busy)} />
      </label>
      {isStatement ? <label className="tx-checkline"><input type="checkbox" checked={aiConsent} onChange={event => setAiConsent(event.target.checked)} disabled={Boolean(busy) || !snapshot.aiAvailable} /><span>Use AI to read PDFs and images. The selected statement is sent to the configured AI service; extracted rows stay in review until I save them.</span></label> : <p className="tx-muted">Supporting documents are saved as original evidence. They do not create transactions or change your tax totals.</p>}
      {!snapshot.aiAvailable && isStatement ? <p className="tx-muted">AI reading is not connected yet. CSV imports and private original uploads are available.</p> : null}
      <div className="tx-actions"><button type="button" className="tx-button primary" onClick={upload} disabled={!file || (isStatement && (!selectedAccountExists || !month)) || Boolean(busy)}><Icon name="upload" size={16} />{!isStatement || file && fileMime(file) !== "text/csv" && (!aiConsent || !snapshot.aiAvailable) ? "Save original" : "Upload & review"}</button>{file ? <button type="button" className="tx-button" disabled={Boolean(busy)} onClick={() => setFile(null)}>Clear file</button> : null}<span className="tx-muted">Private to your owner account.</span></div>
    </Panel>
    {busy ? <div className="tx-notice" role="status"><Icon name="refresh" size={18} />{busy}</div> : null}
    {error ? <div className="tx-notice error" role="alert">{error}</div> : null}
    {mappingNeeded ? <Panel title="Match this bank’s columns" subtitle="Tell us once how this statement stores its dates and amounts, then check the extracted totals.">
      {mappingNeeded.warnings?.length ? <div className="tx-notice"><ul>{mappingNeeded.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div> : null}
      <div className="tx-intake-form">{(["date", "description"] as const).map(key => <Field key={key} label={key === "date" ? "Transaction date column" : "Description column"}><select className="tx-input" value={mapping[key]} onChange={event => setMapping(current => ({ ...current, [key]: event.target.value }))} disabled={Boolean(busy)}><option value="">Choose a column</option>{mappingNeeded.headers.map(header => <option key={header} value={header}>{header}</option>)}</select></Field>)}
        <Field label="How amounts appear"><select className="tx-input" value={amountMode} onChange={event => setAmountMode(event.target.value as "signed" | "separate")} disabled={Boolean(busy)}><option value="signed">One signed amount column</option><option value="separate">Separate debit and credit columns</option></select></Field>
        <Field label="Date order"><select className="tx-input" value={mapping.date_format} onChange={event => setMapping(current => ({ ...current, date_format: event.target.value as CsvMapping["date_format"] }))} disabled={Boolean(busy)}><option value="mdy">Month / day / year</option><option value="dmy">Day / month / year</option><option value="ymd">Year / month / day</option></select></Field>
        {(amountMode === "signed" ? ["amount"] as const : ["debit", "credit"] as const).map(key => <Field key={key} label={key === "amount" ? "Amount column" : key === "debit" ? "Money out / debit column" : "Money in / credit column"}><select className="tx-input" value={mapping[key] || ""} onChange={event => setMapping(current => ({ ...current, [key]: event.target.value }))} disabled={Boolean(busy)}><option value="">Choose a column</option>{mappingNeeded.headers.map(header => <option key={header} value={header}>{header}</option>)}</select></Field>)}
      </div>
      {amountMode === "signed" ? <label className="tx-checkline"><input type="checkbox" checked={Boolean(mapping.invert_amount)} onChange={event => setMapping(current => ({ ...current, invert_amount: event.target.checked }))} disabled={Boolean(busy)} /><span>This bank uses positive amounts for money out. Reverse the signs during import.</span></label> : null}
      <div className="tx-table-wrap"><table className="tx-table"><caption>Sample rows from your CSV</caption><thead><tr>{mappingNeeded.headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{mappingNeeded.sample.slice(0, 5).map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table></div>
      <div className="tx-actions"><button type="button" className="tx-button primary" disabled={Boolean(busy) || !mapping.date || !mapping.description || (amountMode === "signed" ? !mapping.amount : !mapping.debit && !mapping.credit)} onClick={() => void resume(mappingNeeded.statement, { date: mapping.date, description: mapping.description, date_format: mapping.date_format, ...(amountMode === "signed" ? { amount: mapping.amount, invert_amount: mapping.invert_amount } : { debit: mapping.debit, credit: mapping.credit }) })}>Preview transactions</button><button type="button" className="tx-button" onClick={() => setMappingNeeded(null)} disabled={Boolean(busy)}>Review later</button></div>
    </Panel> : null}
    {preview ? <Panel title="Review before importing" subtitle={`${preview.statement.title} · ${preview.statement.tax_year} · ${preview.extracted_by === "ai" ? "AI extraction" : "CSV extraction"}`} action={<div className="tx-actions">{preview.extracted_by === "csv" ? <button type="button" className="tx-button" onClick={() => void resume(preview.statement, undefined, true)} disabled={Boolean(busy)}>Adjust columns / signs</button> : null}<button type="button" className="tx-button" onClick={() => void openOriginal(preview.statement)} disabled={Boolean(opening)}>Open original</button></div>}>
      {yearGroups.length ? <div className="tx-year-allocation" aria-label="Transactions by tax year"><strong>Automatic tax-year split</strong><div>{yearGroups.map(group=><span key={group.year} className="tx-year-pill">{group.year}: {group.count} transaction{group.count===1?"":"s"}</span>)}</div><p>The original remains filed under {preview.statement.tax_year}. Each selected transaction will appear under its own posted date and tax year.</p></div> : null}
      <div className="tx-import-totals"><div><span>Transactions found</span><strong>{preview.totals.row_count}</strong></div><div><span>Money in</span><strong>{money(preview.totals.incoming_cents)}</strong></div><div><span>Money out</span><strong>{money(Math.abs(preview.totals.outgoing_cents))}</strong></div><div><span>Net movement</span><strong>{money(preview.totals.net_cents)}</strong></div></div>
      <div className={`tx-reconciliation ${preview.reconciliation_difference_cents === 0 ? "balanced" : "review"}`}><Icon name={preview.reconciliation_difference_cents === 0 ? "check" : "info"} size={18} /><div><strong>{preview.reconciliation_difference_cents === 0 ? "Statement balances reconcile" : preview.reconciliation_difference_cents === null ? "Balance reconciliation needs your review" : `${money(preview.reconciliation_difference_cents)} difference to check`}</strong><p>Opening balance: {preview.opening_balance_cents === null ? "not available" : money(preview.opening_balance_cents)} · Closing balance: {preview.closing_balance_cents === null ? "not available" : money(preview.closing_balance_cents)}</p></div></div>
      {preview.warnings.length || preview.questions.length ? <div className="tx-notice"><strong>Things to check</strong><ul>{[...preview.warnings, ...preview.questions].map((message, index) => <li key={index}>{message}</li>)}</ul></div> : null}
      <div className="tx-actions tx-import-selection"><strong>{selectedTotals.count} selected · {money(selectedTotals.net)} net</strong><button type="button" className="tx-button" disabled={Boolean(busy)} onClick={() => { setSelected(new Set(preview.rows.flatMap((row, index) => row.possible_duplicate || Number(row.date.slice(0,4)) < 2018 || Number(row.date.slice(0,4)) > 2100 ? [] : [index]))); setReviewed(false); }}>Select nonduplicates</button><button type="button" className="tx-button" disabled={Boolean(busy)} onClick={() => { setSelected(new Set()); setReviewed(false); }}>Clear selection</button></div>
      {duplicateCount ? <p className="tx-muted">{duplicateCount} possible duplicate{duplicateCount === 1 ? " is" : "s are"} unchecked. Select one only after checking it against your saved transactions.</p> : null}
      <div className="tx-table-wrap"><table className="tx-table tx-import-table"><thead><tr><th scope="col">Import</th><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Amount</th><th scope="col">Review</th></tr></thead><tbody>{pageRows.map((row, offset) => { const index = page * pageSize + offset; return <tr key={index} className={row.possible_duplicate ? "tx-possible-duplicate" : ""}><td><input type="checkbox" aria-label={`Import ${row.description} on ${row.date}`} checked={selected.has(index)} onChange={() => toggle(index)} disabled={Boolean(busy) || Number(row.date.slice(0,4)) < 2018 || Number(row.date.slice(0,4)) > 2100} /></td><td>{dateLabel(row.date)}{Number(row.date.slice(0,4))!==preview.statement.tax_year ? <small className="tx-cross-year">→ {row.date.slice(0,4)}</small> : null}</td><td><strong>{row.description}</strong>{row.vendor && row.vendor !== row.description ? <span className="tx-table-detail">{row.vendor}</span> : null}</td><td className="tx-amount">{money(row.amount_cents)}</td><td>{row.possible_duplicate ? <span className="tx-status needs_review">Possible duplicate</span> : row.question ? row.question : row.scope ? human(row.scope) : "Ready for categorization"}</td></tr>; })}</tbody></table></div>
      <div className="tx-pagination"><span>{preview.rows.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, preview.rows.length)} of {preview.rows.length} rows</span><div className="tx-actions"><button type="button" className="tx-button" disabled={page === 0} onClick={() => setPage(current => current - 1)}>Previous</button><button type="button" className="tx-button" disabled={(page + 1) * pageSize >= preview.rows.length} onClick={() => setPage(current => current + 1)}>Next</button></div></div>
      <label className="tx-checkline"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={Boolean(busy)} /><span>{selected.size ? <>I checked the dates, signs, amounts, and selected rows against the original{needsReconciliationReview ? ", including the incomplete balance reconciliation" : ""}.</> : <>I want to finish this statement review without adding any transactions. I checked that all rows are duplicates or should be excluded.</>}</span></label>
      <div className="tx-actions"><button type="button" className="tx-button primary" disabled={!reviewed || Boolean(busy)} onClick={commit}><Icon name="check" size={16} />{selected.size ? `Import ${selected.size} selected transactions` : "Finish review without transactions"}</button><button type="button" className="tx-button" disabled={Boolean(busy)} onClick={() => setPreview(null)}>Review later</button></div><p className="tx-muted tx-import-footnote">Vendor rules apply during import. Unclear categories go to your review queue. Corrections can be made in Transactions after import.</p>
    </Panel> : null}
    <Panel title="Statement coverage" subtitle="Each filled month represents an original bank statement on file, not the dates of every transaction in it.">
      <div className="tx-intake-form"><Field label="Bank / card account"><select className="tx-input" value={coverageAccount} onChange={event=>setCoverageAccount(event.target.value)}><option value="">Choose an account</option>{accounts.map(account=><option value={account.id} key={account.id}>{account.title}</option>)}</select></Field></div>
      {coverageAccount ? <><div className="tx-month-grid">{coverage.map(entry=><button key={entry.month} type="button" onClick={()=>{setYear(snapshot.year);setMonth(String(entry.month));document.getElementById("tx-statement-month")?.scrollIntoView({behavior:"smooth",block:"center"});}} className={`tx-month-cell ${entry.onFile?"on-file":entry.needsVerification?"unverified":"missing"}`} title={entry.onFile?`${entry.label}: original saved`:entry.needsVerification?`${entry.label}: upload not verified`:`${entry.label}: no original recorded`}><span>{entry.label}</span><strong>{entry.onFile?"✓":entry.needsVerification?"!":"+"}</strong></button>)}</div><p className="tx-muted">Colored = statement on file · Outlined = missing · ! = needs verification. Select a month to prepare its upload.</p></> : <p className="tx-muted">Add or choose a bank account to see its 12-month statement calendar.</p>}
      {allStatements.some(record=>record.tax_year===snapshot.year&&record.data.document_type==="bank_statement"&&!record.data.statement_month) ? <p className="tx-notice">Assign a month to your older uploaded statements below so they appear in the calendar.</p> : null}
    </Panel>
    <Panel title={`Your ${snapshot.year} statements & documents`} subtitle="Originals, unfinished reviews, and statements containing transactions from this year.">
      <div className="tx-statement-filters"><Field label="Document filter"><select className="tx-input" value={filterType} onChange={event=>setFilterType(event.target.value)}><option value="all">All documents</option><option value="bank_statement">Bank statements</option><option value="supporting">Supporting documents</option></select></Field><Field label="Account filter"><select className="tx-input" value={filterAccount} onChange={event=>setFilterAccount(event.target.value)}><option value="all">All accounts</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.title}</option>)}</select></Field><span className="tx-muted">{visibleStatements.length} shown</span></div>
      {visibleStatements.length ? <div className="tx-statement-list">{visibleStatements.map(statement => {
        const type = str(statement.data.document_type, "bank_statement");
        const awaitingUpload = statement.data.status === "awaiting_upload";
        const bankStatement = type === "bank_statement";
        return <article className="tx-statement-item" key={statement.id}>
          <span className="tx-statement-symbol"><Icon name={str(statement.data.mime_type).startsWith("image/") ? "image" : "book"} size={20} /></span>
          <div className="tx-statement-copy"><strong>{str(statement.data.file_name, statement.title)}</strong><span>{documentTypes.find(item => item.value === type)?.label || "Supporting document"} · {statementStatus(statement)}</span>{statement.data.account_id ? <small>{accounts.find(account => account.id === statement.data.account_id)?.title || "Linked bank account"}</small> : null}{statement.tax_year !== snapshot.year ? <small>Original filed under {statement.tax_year}; includes {snapshot.year} transactions (not a {snapshot.year} monthly original)</small> : null}{statement.data.status === "imported" ? <small>{Number(statement.data.imported_count || 0)} transactions imported across applicable tax years</small> : null}
             {bankStatement && statement.tax_year===snapshot.year ? <label className="tx-statement-month-edit">Statement month <select className="tx-input" value={periodDrafts[statement.id]??String(statement.data.statement_month??"")} onChange={event=>setPeriodDrafts(current=>({...current,[statement.id]:event.target.value}))} disabled={Boolean(busy)}><option value="">Not assigned</option>{STATEMENT_MONTHS.map((label,index)=><option key={label} value={index+1}>{label} {snapshot.year}</option>)}</select>{periodDrafts[statement.id] && Number(periodDrafts[statement.id])!==Number(statement.data.statement_month) ? <button type="button" className="tx-button" onClick={()=>void saveStatementMonth(statement)} disabled={Boolean(busy)}>Save month</button> : null}</label> : null}{str(statement.data.sha256) ? <details className="tx-file-details"><summary>Original file details</summary><dl><div><dt>Uploaded</dt><dd>{dateLabel(statement.created_at)}</dd></div><div><dt>Size</dt><dd>{(Number(statement.data.size_bytes || 0) / 1024).toFixed(1)} KB</dd></div><div><dt>SHA-256 fingerprint</dt><dd><code>{str(statement.data.sha256)}</code></dd></div></dl></details> : null}</div>
          <div className="tx-actions">
            <button type="button" className="tx-button" onClick={() => void openOriginal(statement)} disabled={Boolean(opening) || awaitingUpload}>{opening === statement.id ? "Opening…" : "Original"}</button>
            {awaitingUpload ? <button type="button" className="tx-button primary" onClick={() => void verifyOriginal(statement)} disabled={Boolean(busy)}>Verify upload</button> : null}
            {bankStatement && statement.data.status !== "imported" && !awaitingUpload ? <>{["text/csv", "application/csv", "application/vnd.ms-excel"].includes(str(statement.data.mime_type)) ? <button type="button" className="tx-button" onClick={() => void resume(statement, undefined, true)} disabled={Boolean(busy)}>CSV settings</button> : null}<button type="button" className="tx-button primary" onClick={() => void resume(statement)} disabled={Boolean(busy)}>Review transactions</button></> : null}
            <button type="button" className="tx-button tx-danger" onClick={()=>void removeStatement(statement)} disabled={Boolean(busy)||Boolean(opening)}>Delete</button>
          </div>
        </article>;
      })}</div> : <Empty title="Your first document is a good place to start" icon="upload">Upload a bank statement, filed return, or IRS notice. Each original stays with its tax year.</Empty>}
    </Panel>
  </div>;
}

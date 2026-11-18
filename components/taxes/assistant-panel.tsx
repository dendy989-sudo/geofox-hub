"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/admin/icons";
import { TAX_CATEGORIES, type TaxRecord, type TaxSave, type TaxSnapshot } from "@/lib/taxes/types";
import { byKind, dateLabel, human, money, Panel, str, taxRequest } from "./shared";
import "./intake.css";

interface Props {
  snapshot: TaxSnapshot;
  onRefresh: () => Promise<void>;
  notify: (message: string) => void;
  onEditProposal?: (record: TaxSave) => void;
}
interface AssistantReply { reply: string; questions: string[]; proposals: TaxSave[]; record: TaxRecord; }
const prompts = [
  { label: "Find my next step", text: "Help me choose one small next step for this tax year. Tell me which records are missing and which decisions will save the most repeated work." },
  { label: "Sort unclear transactions", text: "Review the unresolved transactions in this tax year. Group similar vendors and ask me the smallest number of questions needed to separate business and personal spending." },
  { label: "Check my year’s progress", text: "Summarize what is recorded for this tax year, what still needs review, and what is missing before the draft reports can be trusted. Do not infer an IRS balance or filing status from missing records." },
];

function proposalsFrom(record: TaxRecord): TaxSave[] {
  if (!Array.isArray(record.data.proposals)) return [];
  return record.data.proposals.filter((proposal): proposal is TaxSave => Boolean(proposal && typeof proposal === "object" && ["transaction", "rule", "year"].includes(proposal.kind) && typeof proposal.title === "string" && proposal.data && typeof proposal.data === "object" && !Array.isArray(proposal.data)));
}
function proposalApplied(proposal: TaxSave, records: TaxRecord[]) {
  if (!proposal.id) return false;
  const existing = records.find(record => record.id === proposal.id && !record.archived);
  return Boolean(existing && existing.kind === proposal.kind && existing.title === proposal.title && existing.tax_year === proposal.tax_year && Object.entries(proposal.data).every(([key, value]) => JSON.stringify(existing.data[key]) === JSON.stringify(value)));
}
function displayValue(key: string, value: unknown, snapshot: TaxSnapshot): string {
  if (value === null || value === undefined || value === "") return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key.endsWith("_cents") && typeof value === "number") return money(value);
  if (key.endsWith("_percent") && typeof value === "number") return `${value}%`;
  if (["business_id", "account_id", "statement_id", "rule_id"].includes(key)) return snapshot.records.find(record => record.id === value)?.title || "Linked record";
  if (key === "category") return TAX_CATEGORIES.find(category => category.id === value)?.label || human(value);
  if (typeof value === "string") return key === "notes" || key === "description" || key === "match" || key === "vendor" ? value : human(value);
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function TaxAssistantPanel({ snapshot, onRefresh, notify, onEditProposal }: Props) {
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState("");
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<TaxRecord[]>([]);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const requestBusy = useRef(false);
  const mounted = useRef(true);
  const currentYear = useRef(snapshot.year);
  currentYear.current = snapshot.year;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { setRecent([]); setMessage(""); setError(""); setConsent(false); setApplied(new Set()); }, [snapshot.year]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const history = useMemo(() => {
    const records = new Map([...byKind(snapshot, "chat"), ...recent].filter(record => record.tax_year === snapshot.year).map(record => [record.id, record]));
    return [...records.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [snapshot, recent]);
  useEffect(() => { if (recent.length) end.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" }); }, [recent.length]);
  const canShowResult = (requestedYear: number) => mounted.current && currentYear.current === requestedYear;

  async function send(event: FormEvent) {
    event.preventDefault();
    if (requestBusy.current || !message.trim() || !consent || !snapshot.aiAvailable) return;
    const requestedYear = snapshot.year;
    requestBusy.current = true; setSending(true); setError("");
    try {
      const result = await taxRequest<AssistantReply>("/api/taxes/assistant", { year: requestedYear, message: message.trim(), ai_consent: true });
      if (!result?.record || typeof result.reply !== "string") throw new Error("The assistant did not return a complete answer. Your records have not been changed.");
      if (!canShowResult(requestedYear)) { notify(`Your assistant reply was saved under ${requestedYear}.`); return; }
      setRecent(current => [...current.filter(record => record.id !== result.record.id), result.record]); setMessage("");
      try { await onRefresh(); } catch { notify("Your conversation was saved. Refresh to reload your latest records."); }
    } catch (reason) { if (canShowResult(requestedYear)) setError(reason instanceof Error ? reason.message : "The assistant could not answer. Please try again."); }
    finally { requestBusy.current = false; if (canShowResult(requestedYear)) setSending(false); }
  }
  async function apply(proposal: TaxSave, key: string) {
    if (requestBusy.current || applied.has(key)) return;
    const requestedYear = snapshot.year;
    requestBusy.current = true; setApplying(key); setError("");
    try {
      await taxRequest<TaxRecord>("/api/taxes", { action: "save", record: proposal });
      if (!canShowResult(requestedYear)) { notify(`Saved: ${proposal.title}.`); return; }
      setApplied(current => new Set([...current, key]));
      try { await onRefresh(); } catch { notify("The change was saved. Refresh to load the updated record."); }
      notify(`Saved: ${proposal.title}.`);
    } catch (reason) { if (canShowResult(requestedYear)) setError(reason instanceof Error ? reason.message : "The proposed change could not be saved. Refresh and review it again."); }
    finally { requestBusy.current = false; if (canShowResult(requestedYear)) setApplying(""); }
  }
  function choosePrompt(text: string) { setMessage(text); textarea.current?.focus(); }

  return <div className="tx-stack">
    <Panel title="A little help, one decision at a time" subtitle={`Talk through your ${snapshot.year} records. The assistant can explain what is missing, group questions, and propose changes for you to review.`}>
      <div className="tx-assistant-intro"><span className="tx-assistant-symbol"><Icon name="message" size={25} /></span><div><strong>You do not have to solve every year at once.</strong><p>Start with what you know. A confirmed vendor rule can save you from answering the same question across statements and accounts.</p></div></div>
      <div className="tx-prompt-choices">{prompts.map(prompt => <button key={prompt.label} type="button" className="tx-button" disabled={sending || Boolean(applying)} onClick={() => choosePrompt(prompt.text)}>{prompt.label}<Icon name="arrow" size={15} /></button>)}</div>
      {!snapshot.aiAvailable ? <div className="tx-notice">AI is not connected yet. Your tax records, vendor rules, imports, and reports can still be managed from the other pages.</div> : null}
    </Panel>
    {history.length ? <section className="tx-chat-history" aria-label={`${snapshot.year} tax assistant conversation`}>
      {history.map(record => <article className="tx-chat-turn" key={record.id}>
        <div className="tx-chat-message tx-chat-user"><div className="tx-chat-label"><Icon name="profile" size={15} /><strong>You</strong><span>{dateLabel(record.created_at)}</span></div><p>{str(record.data.message)}</p></div>
        <div className="tx-chat-message tx-chat-assistant"><div className="tx-chat-label"><Icon name="message" size={15} /><strong>Tax assistant</strong><span>{snapshot.year}</span></div><p>{str(record.data.reply)}</p>
          {Array.isArray(record.data.questions) && record.data.questions.length ? <div className="tx-assistant-questions"><strong>A few things to clarify</strong><ul>{record.data.questions.filter((question): question is string => typeof question === "string").map((question, index) => <li key={index}><span>{question}</span><button type="button" className="tx-button" disabled={sending || Boolean(applying)} onClick={() => choosePrompt(`About this question: “${question}”\n\n`)}>Answer</button></li>)}</ul></div> : null}
          {proposalsFrom(record).map((proposal, index) => {
            const key = `${record.id}:${index}`;
            const current = snapshot.records.find(item => item.id === proposal.id);
            const isApplied = applied.has(key) || proposalApplied(proposal, snapshot.records);
            const changed = Boolean(current && proposal.version !== undefined && current.version !== proposal.version && !isApplied);
            const fields = Object.entries(proposal.data).filter(([name, value]) => !current || JSON.stringify(current.data[name]) !== JSON.stringify(value));
            const reason = Array.isArray(record.data.proposal_reasons) ? str(record.data.proposal_reasons[index]) : "";
            return <section className="tx-ai-proposal" key={key}><div className="tx-ai-proposal-heading"><span className={`tx-status ${isApplied ? "confirmed" : "needs_review"}`}>{isApplied ? "Applied" : "Proposed change"}</span><span className="tx-muted">{human(proposal.kind)}{proposal.tax_year ? ` · ${proposal.tax_year}` : " · all years"}</span></div><h3>{proposal.title}</h3>{reason ? <p className="tx-muted">{reason}</p> : null}
              {!isApplied ? <><div className="tx-table-wrap"><table className="tx-table"><thead><tr><th scope="col">Field</th>{current ? <th scope="col">Currently</th> : null}<th scope="col">Proposed</th></tr></thead><tbody>{current?.title !== proposal.title ? <tr><th scope="row">Title</th>{current ? <td>{current.title}</td> : null}<td>{proposal.title}</td></tr> : null}{fields.map(([name, value]) => <tr key={name}><th scope="row">{human(name)}</th>{current ? <td>{displayValue(name, current.data[name], snapshot)}</td> : null}<td>{displayValue(name, value, snapshot)}</td></tr>)}</tbody></table></div>{changed ? <p className="tx-notice">This record changed after the suggestion was made. Ask the assistant to review the latest version before applying it.</p> : null}<div className="tx-actions"><button type="button" className="tx-button primary" disabled={sending || Boolean(applying) || changed} onClick={() => void apply(proposal, key)}><Icon name="check" size={15} />{applying === key ? "Saving…" : "Apply this change"}</button>{onEditProposal ? <button type="button" className="tx-button" disabled={sending || Boolean(applying) || changed} onClick={() => onEditProposal(proposal)}>Edit before saving</button> : null}</div></> : <p className="tx-muted">This change has been saved to your tax records.</p>}
            </section>;
          })}
        </div>
      </article>)}
      <div ref={end} />
    </section> : null}
    <Panel title={history.length ? "Continue the conversation" : "What would you like to sort out?"}>
      <form onSubmit={send} className="tx-assistant-form"><label className="tx-field"><span>Message for your {snapshot.year} tax year</span><textarea ref={textarea} className="tx-input" rows={5} maxLength={4000} value={message} onChange={event => setMessage(event.target.value)} placeholder="For example: league fees always belong to my soccer business. Help me make a rule for that across every account." disabled={sending || Boolean(applying)} /></label><label className="tx-checkline"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={sending || Boolean(applying) || !snapshot.aiAvailable} /><span>Use the configured AI service with my message and selected tax records to help with this year. Changes are shown for my review before they are saved.</span></label>{error ? <div className="tx-notice error" role="alert">{error}</div> : null}<div className="tx-actions"><button type="submit" className="tx-button primary" disabled={!message.trim() || !consent || !snapshot.aiAvailable || sending || Boolean(applying)}><Icon name="send" size={16} />{sending ? "Reviewing your records…" : "Ask the assistant"}</button><span className="tx-muted">{message.length.toLocaleString()} / 4,000</span></div>{sending ? <p className="tx-muted" role="status">The assistant is checking your selected records. This can take a moment.</p> : null}</form>
      <p className="tx-assistant-note"><Icon name="info" size={15} />The assistant helps organize records and explain questions. Its suggestions do not establish deduction eligibility, amendment deadlines, or an official IRS balance.</p>
    </Panel>
  </div>;
}

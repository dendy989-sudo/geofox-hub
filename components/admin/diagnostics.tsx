"use client";

import { useState } from "react";
import { apiRequest, ErrorBanner, Modal } from "./common";
import { Icon } from "./icons";

export function DiagnosticButton({ app, customerId, errorIds, disabled, notify, text = "Copy repair brief" }: { app: string; customerId?: string; errorIds?: string[]; disabled?: boolean; notify: (message: string) => void; text?: string }) {
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  async function prepare() {
    if (disabled || busy) return;
    setBusy(true); setError("");
    try {
      const result = await apiRequest<{ prompt: string; redacted: true }>("/api/admin/diagnostics", { method: "POST", body: JSON.stringify({ app, customerId, errorIds }) });
      if (!result.redacted) throw new Error("A redacted brief could not be prepared.");
      setPrompt(result.prompt);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to prepare this brief."); }
    finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(prompt); notify("Redacted repair brief copied. Review it before sharing."); }
    catch { notify("Select and copy the brief below. Clipboard access is unavailable."); }
  }
  return <><button className="hub-button secondary" type="button" disabled={disabled || busy} onClick={prepare}><Icon name={busy ? "refresh" : "copy"} size={15} className={busy ? "hub-spinning" : undefined} />{busy ? "Preparing…" : text}</button>{error ? <Modal title="Repair brief unavailable" onClose={() => setError("")}><ErrorBanner error={error} /></Modal> : null}{prompt ? <Modal title="Your repair brief" description="Prepared from the selected app’s recorded errors. Review before you copy." onClose={() => setPrompt("")} actions={<><button className="hub-button secondary" onClick={() => setPrompt("")}>Done</button><button className="hub-button" onClick={copy}><Icon name="copy" size={14} />Copy brief</button></>}><div className="hub-guidance" style={{ marginTop: 0, marginBottom: 18 }}><strong>A starting point for a careful fix</strong>Customer identifiers and secrets are redacted by the server. Check for any sensitive context before pasting into ChatGPT. Ask for a reviewed change and a test plan; this brief does not make changes to your app.</div><div className="hub-field"><label htmlFor="repair-brief">Redacted diagnostic context</label><textarea id="repair-brief" readOnly value={prompt} rows={15} className="hub-mono" onFocus={(event) => event.currentTarget.select()} /></div></Modal> : null}</>;
}

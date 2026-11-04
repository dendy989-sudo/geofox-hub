"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { apiRequest } from "@/components/admin/common";
import { Icon } from "@/components/admin/icons";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { WorkspaceAttachment, WorkspaceModule, WorkspaceUpload } from "@/lib/workspace/types";

export type Attachment = WorkspaceAttachment;
export interface MediaAttachment extends WorkspaceAttachment { width?: number; height?: number; duration?: number; }
const MAX_SIZE = 50 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime", "application/pdf"];

function mediaMetadata(file: File): Promise<{ width?: number; height?: number; duration?: number }> {
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return Promise.resolve({});
  return new Promise(resolve => {
    const objectUrl = URL.createObjectURL(file);
    const element = file.type.startsWith("image/") ? new Image() : document.createElement("video");
    let finished = false;
    const done = (data: { width?: number; height?: number; duration?: number }) => {
      if (finished) return;
      finished = true; clearTimeout(timeout); URL.revokeObjectURL(objectUrl);
      element.removeAttribute("src"); resolve(data);
    };
    const timeout = window.setTimeout(() => done({}), 10000);
    element.onerror = () => done({});
    if (element instanceof HTMLImageElement) element.onload = () => done({ width: element.naturalWidth, height: element.naturalHeight });
    else { element.preload = "metadata"; element.onloadedmetadata = () => done({ width: element.videoWidth, height: element.videoHeight, ...(Number.isFinite(element.duration) ? { duration: Math.round(element.duration * 100) / 100 } : {}) }); }
    element.src = objectUrl;
  });
}

export async function uploadWorkspaceFile(file: File, module: WorkspaceModule, appSlug: string | null): Promise<MediaAttachment> {
  if (!TYPES.includes(file.type)) throw new Error("Choose a JPG, PNG, WebP, GIF, MP4, MOV, or PDF file.");
  if (module !== "marketing" && file.type.startsWith("video/")) throw new Error("Choose a photo or PDF attachment for this workspace.");
  if (file.size <= 0 || file.size > MAX_SIZE) throw new Error("Choose a file smaller than 50 MB.");
  const client = createSupabaseBrowserClient();
  if (!client) throw new Error("The secure file connection is not available. Refresh the page and try again.");
  const prepared = await apiRequest<WorkspaceUpload>("/api/workspace/uploads", { method: "POST", body: JSON.stringify({ module, appSlug, filename: file.name, contentType: file.type, size: file.size }) });
  const uploaded = await client.storage.from("hub-workspace").uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
  if (uploaded.error) throw new Error("The file could not be uploaded. Check your connection and try again.");
  const verified = await apiRequest<WorkspaceAttachment>("/api/workspace/uploads", { method: "PATCH", body: JSON.stringify({ path: prepared.path }) });
  return { ...verified, ...await mediaMetadata(file) };
}

export async function getAttachmentUrl(path: string): Promise<string> {
  const result = await apiRequest<{ url: string }>(`/api/workspace/uploads?path=${encodeURIComponent(path)}`);
  return result.url;
}

export function useAttachmentUrl(path?: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setUrl(null); setError("");
    if (!path) return;
    apiRequest<{ url: string }>(`/api/workspace/uploads?path=${encodeURIComponent(path)}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setUrl(data.url); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Preview unavailable."); });
    return () => controller.abort();
  }, [path, refresh]);
  return { url, error, reload: () => setRefresh(value => value + 1) };
}

export function AttachmentPreview({ attachment, className, alt }: { attachment: WorkspaceAttachment | null; className?: string; alt?: string }) {
  const result = useAttachmentUrl(attachment?.path);
  if (!attachment) return <span className={className}><Icon name="image" size={20} /></span>;
  if (!result.url) return <span className={className} title={result.error || "Loading preview"}><Icon name="image" size={20} /></span>;
  if (attachment.contentType.startsWith("video/")) return <video className={className} src={result.url} muted preload="metadata" playsInline aria-label={alt || attachment.filename} />;
  if (attachment.contentType.startsWith("image/")) return <img className={className} src={result.url} alt={alt || attachment.filename} loading="lazy" />;
  return <span className={className}><Icon name="book" size={20} /></span>;
}

export function Attachments({ module, appSlug, value, onChange, disabled = false, viewOnly = false, accept, maxFiles = 10, onBusyChange }: {
  module: WorkspaceModule; appSlug: string | null; value: MediaAttachment[]; onChange?: (files: MediaAttachment[]) => void;
  disabled?: boolean; viewOnly?: boolean; accept?: string; maxFiles?: number; onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState("");
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []); event.target.value = "";
    if (!files.length || busy || disabled || viewOnly) return;
    if (value.length + files.length > maxFiles) { setError(`You can attach up to ${maxFiles} files.`); return; }
    setBusy(true); onBusyChange?.(true); setError("");
    const saved = [...value];
    try {
      for (const file of files) { saved.push(await uploadWorkspaceFile(file, module, appSlug)); onChange?.([...saved]); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The attachment could not be saved."); }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  async function open(file: WorkspaceAttachment) {
    if (opening) return;
    setOpening(file.path); setError("");
    // Open synchronously to avoid popup blockers, then navigate to a short-lived URL.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const url = await getAttachmentUrl(file.path);
      if (tab) tab.location.replace(url);
      else { const anchor = document.createElement("a"); anchor.href = url; anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; anchor.click(); }
    } catch (reason) { tab?.close(); setError(reason instanceof Error ? reason.message : "The file could not be opened."); }
    finally { setOpening(""); }
  }
  return <div className="ws-attachments">
    {value.length ? <ul className="ws-file-list">{value.map(file => <li key={file.path}><Icon name={file.contentType.startsWith("image/") ? "image" : file.contentType.startsWith("video/") ? "image" : "book"} size={15} /><button type="button" className="ws-file-name" onClick={() => open(file)} disabled={Boolean(opening)}>{opening === file.path ? "Opening…" : file.filename}</button><small>{file.size >= 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.ceil(file.size / 1024))} KB`}</small>{!viewOnly ? <button type="button" className="hub-icon-button" aria-label={`Remove ${file.filename} from this record`} disabled={disabled || busy} onClick={() => onChange?.(value.filter(item => item.path !== file.path))}><Icon name="close" size={12} /></button> : null}</li>)}</ul> : viewOnly ? <p className="ws-help">No attachments.</p> : null}
    {!viewOnly ? <label className="ws-upload-label"><Icon name="upload" size={15} /><span>{busy ? "Uploading securely…" : "Attach files"}</span><input type="file" aria-label="Upload attachments" accept={accept || TYPES.filter(type => module === "marketing" || !type.startsWith("video/")).join(",")} multiple={maxFiles > 1} disabled={disabled || busy || value.length >= maxFiles} onChange={upload} /></label> : null}
    {!viewOnly ? <p className="ws-help">Private files · up to 50 MB each. Save the record to keep its attachments together.</p> : null}
    {error ? <p className="ws-help ws-danger" role="alert">{error}</p> : null}
  </div>;
}

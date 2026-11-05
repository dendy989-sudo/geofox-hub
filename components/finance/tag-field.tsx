"use client";

import { useId, useRef, useState } from "react";
import { Icon } from "@/components/admin/icons";
import { financeId } from "@/lib/finance/id";
import { normalizeTagName, tagNameKey } from "@/lib/finance/tags";
import type { FinanceData, FinanceMutate } from "@/lib/finance/types";
import "./tag-field.css";

export function useFinanceTagField({ data, mutate, initialIds }: { data: FinanceData; mutate: FinanceMutate; initialIds?: readonly string[] | null }) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => [...new Set(initialIds ?? [])]);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [createdLabels, setCreatedLabels] = useState<Record<string, string>>({});
  const originalIds = useRef(new Set(initialIds ?? []));
  const request = useRef<{ id: string; key: string } | null>(null);
  const creating = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tags = (data.tags ?? []).filter(tag => tag.user_id === data.user.id).sort((a, b) => a.name.localeCompare(b.name));
  const available = tags.filter(tag => !tag.archived_at || originalIds.current.has(tag.id));

  function focusName() {
    const input = inputRef.current;
    const details = input?.closest("details");
    if (details) details.open = true;
    input?.focus();
  }

  function changeName(value: string) {
    setName(value);
    setError("");
    setAnnouncement("");
  }

  function select(id: string) {
    const tag = available.find(item => item.id === id);
    if (!tag || selectedIds.includes(id)) return;
    if (selectedIds.length >= 20) { setError("Choose up to 20 tags. Remove one before selecting another."); return; }
    setSelectedIds(previous => [...new Set([...previous, id])]);
    setError("");
    setAnnouncement(`${tag.name} selected. Save the form to attach it.`);
  }

  function remove(id: string) {
    setSelectedIds(previous => previous.filter(value => value !== id));
    setError("");
    setAnnouncement("Tag removed from this form. Save to apply the change.");
  }

  async function create() {
    if (creating.current) return;
    let normalized: string;
    try { normalized = normalizeTagName(name); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Enter a valid tag name."); focusName(); return; }
    if (selectedIds.length >= 20) { setError("Choose up to 20 tags. Remove one before creating and selecting another."); return; }
    const key = tagNameKey(normalized);
    const existing = tags.find(tag => tagNameKey(tag.name) === key);
    if (existing) {
      setError(existing.archived_at ? `“${existing.name}” already exists as an archived tag. Restore it in Vendors & tags to use it on new records.` : `“${existing.name}” already exists. Choose it from the saved tags above.`);
      focusName();
      return;
    }
    if (!request.current || request.current.key !== key) request.current = { id: financeId(), key };
    const id = request.current.id;
    creating.current = true;
    setPending(true);
    setError("");
    try {
      await mutate("save_tag", { id, name: normalized });
      setCreatedLabels(previous => ({ ...previous, [id]: normalized }));
      setSelectedIds(previous => [...new Set([...previous, id])]);
      setName("");
      request.current = null;
      setAnnouncement(`“${normalized}” created and selected. Save the form to attach it.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The tag could not be created. Your form is still here; try again.");
    } finally {
      creating.current = false;
      setPending(false);
    }
  }

  function prepareForSave(): string[] | null {
    if (creating.current) { setError("Wait for this tag to finish creating before saving the form."); return null; }
    if (name.trim()) { setError("Click Create tag to save the new tag, or clear its name to continue without it."); focusName(); return null; }
    if (selectedIds.length > 20) { setError("Choose up to 20 tags for this record."); return null; }
    for (const id of selectedIds) {
      const tag = tags.find(item => item.id === id);
      if (!tag && !createdLabels[id]) { setError("A selected tag is no longer available. Remove it or refresh the dashboard before saving."); return null; }
      if (tag?.archived_at && !originalIds.current.has(id)) { setError(`“${tag.name}” has been archived. Remove it or restore it in Vendors & tags before saving.`); return null; }
    }
    setError("");
    return [...new Set(selectedIds)];
  }

  return { selectedIds, tags, available, createdLabels, name, pending, error, announcement, inputRef, changeName, select, remove, create, prepareForSave, isCreating: () => creating.current };
}

export function FinanceTagField({ field, disabled = false, help }: { field: ReturnType<typeof useFinanceTagField>; disabled?: boolean; help?: string }) {
  const id = useId();
  const available = field.available.filter(tag => !field.selectedIds.includes(tag.id));
  const atLimit = field.selectedIds.length >= 20;
  return <fieldset className="ft-field full" disabled={disabled || field.pending}>
    <legend>Tags <span className="ft-optional">optional</span></legend>
    <p className="ft-help" id={`${id}-help`}>{help ?? "Group bills and income in a way that works for you. Selected tags apply when you save this record."}</p>
    <div className="ft-selected-heading"><strong>Selected tags</strong><span>{field.selectedIds.length} / 20</span></div>
    {field.selectedIds.length ? <ul className="ft-chips" aria-label="Selected tags">{field.selectedIds.map(tagId => {
      const tag = field.tags.find(item => item.id === tagId), name = tag?.name ?? field.createdLabels[tagId] ?? "Unavailable tag";
      return <li key={tagId} className={tag?.archived_at ? "archived" : ""}><span>{name}{tag?.archived_at ? <small>Archived</small> : null}</span><button type="button" disabled={disabled || field.pending} onClick={() => field.remove(tagId)} aria-label={`Remove tag ${name}`}><Icon name="close" size={12} /></button></li>;
    })}</ul> : <p className="ft-untagged">No tags selected · Untagged</p>}
    <label className="fn-field"><span>Choose a saved tag</span><select value="" disabled={disabled || field.pending || atLimit || !available.length} onChange={event => field.select(event.target.value)} aria-describedby={`${id}-help`}><option value="">{atLimit ? "20 tags selected" : available.length ? "Select a tag…" : "No more tags available"}</option>{available.map(tag => <option key={tag.id} value={tag.id}>{tag.name}{tag.archived_at ? " · Archived, already linked" : ""}</option>)}</select></label>
    <details className="ft-create"><summary><Icon name="plus" size={13} />Create a reusable tag</summary><div className="ft-create-body"><div className="ft-create-row"><label className="fn-field"><span>New tag name</span><input ref={field.inputRef} type="text" maxLength={180} autoComplete="off" value={field.name} onChange={event => field.changeName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }} placeholder="e.g. Household" aria-describedby={`${id}-create-help${field.error ? ` ${id}-error` : ""}`} /></label><button type="button" className="fn-button" disabled={disabled || field.pending || !field.name.trim() || atLimit} onClick={() => { void field.create(); }}><Icon name="plus" size={13} />{field.pending ? "Creating…" : "Create tag"}</button></div><p id={`${id}-create-help`}>Up to 60 characters. Create tag saves it for reuse immediately. Save this form to attach the selected tags.</p></div></details>
    {field.error ? <p className="ft-error" id={`${id}-error`} role="alert"><Icon name="alert" size={15} />{field.error}</p> : null}
    <span className="ft-sr-only" role="status" aria-live="polite">{field.announcement}</span>
  </fieldset>;
}

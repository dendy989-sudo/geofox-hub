"use client";

import { useId, useRef, useState } from "react";
import { Icon } from "@/components/admin/icons";
import { debtPersonKey, normalizeResponsiblePeople } from "@/lib/finance/debt-people";
import type { FinanceDebtHistory } from "@/lib/finance/types";
import "./debt-people.css";

/** Names stay local until the parent form explicitly saves its debt or transfer. */
export function useDebtPeopleField(initial?: string[]) {
  const [names, setNames] = useState(() => normalizeResponsiblePeople(initial));
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function changeDraft(value: string) {
    setDraft(value);
    setError("");
    setAnnouncement("");
  }

  function add(raw = draft) {
    try {
      if (!raw.trim()) throw new Error("Enter a household name, or choose a saved name.");
      const next = normalizeResponsiblePeople([...names, raw]);
      const duplicate = next.length === names.length;
      setNames(next);
      setDraft("");
      setError("");
      setAnnouncement(duplicate ? "That name is already selected." : `${next[next.length - 1]} added. ${next.length} ${next.length === 1 ? "person" : "people"} selected.`);
      inputRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check this household name.");
      inputRef.current?.focus();
    }
  }

  function remove(name: string) {
    setNames(previous => previous.filter(value => debtPersonKey(value) !== debtPersonKey(name)));
    setError("");
    setAnnouncement(`${name} removed from this form.`);
    inputRef.current?.focus();
  }

  function prepareForSave(): string[] | null {
    try {
      const next = normalizeResponsiblePeople([...names, ...(draft.trim() ? [draft] : [])]);
      setError("");
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the household names before saving.");
      inputRef.current?.focus();
      return null;
    }
  }

  return { names, draft, error, announcement, inputRef, changeDraft, add, remove, prepareForSave };
}

export function DebtPeopleField({ field, suggestions, disabled = false }: { field: ReturnType<typeof useDebtPeopleField>; suggestions: string[]; disabled?: boolean }) {
  const id = useId();
  const selected = new Set(field.names.map(debtPersonKey));
  const query = field.draft.trim().toLowerCase();
  const available = suggestions.filter(name => !selected.has(debtPersonKey(name)));
  const matching = available.filter(name => !query || name.toLowerCase().includes(query));
  const shown = matching.slice(0, 8);
  const atLimit = field.names.length >= 20;
  return <fieldset className="fdp-field full" disabled={disabled}>
    <legend>People responsible <span className="fdp-optional">optional</span></legend>
    <p className="fdp-help" id={`${id}-help`}>Choose one or more household names for this debt. Names are labels in your private dashboard. Leave empty for Unassigned.</p>
    <div className="fdp-selected-heading"><strong>Selected names</strong><span>{field.names.length} / 20</span></div>
    {field.names.length ? <ul className="fdp-chips" aria-label="Selected household names">{field.names.map(name => <li key={debtPersonKey(name)}><Icon name="profile" size={12} /><span>{name}</span><button type="button" disabled={disabled} onClick={() => field.remove(name)} aria-label={`Remove ${name}`}><Icon name="close" size={12} /></button></li>)}</ul> : <p className="fdp-unassigned">No names selected · Unassigned</p>}
    <div className="fdp-add-row"><label className="fn-field"><span>Household name</span><input ref={field.inputRef} type="text" value={field.draft} onChange={event => field.changeDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); field.add(); } }} maxLength={200} autoComplete="off" placeholder="e.g. Janna" list={`${id}-suggestions`} aria-invalid={Boolean(field.error)} aria-describedby={`${id}-help ${id}-entry-help${field.error ? ` ${id}-error` : ""}`} /></label><button type="button" className="fn-button" disabled={disabled || !field.draft.trim()} onClick={() => field.add()}><Icon name="plus" size={13} />Add name</button></div>
    <datalist id={`${id}-suggestions`}>{available.map(name => <option key={debtPersonKey(name)} value={name} />)}</datalist>
    <p className="fdp-entry-help" id={`${id}-entry-help`}>{atLimit ? "Twenty names are selected. Remove one before adding someone else." : "Enter one name at a time, up to 100 characters. Press Enter or Add name. Any name still in the box is included when you save the form."}</p>
    {shown.length && !atLimit ? <div className="fdp-suggestions"><span>Saved names{query ? " matching your entry" : ""}</span><div role="group" aria-label="Add a saved household name">{shown.map(name => <button type="button" key={debtPersonKey(name)} disabled={disabled} onClick={() => field.add(name)}><Icon name="plus" size={11} /><span>{name}</span><span className="fdp-sr-only"> · add to this debt</span></button>)}</div>{matching.length > shown.length ? <small>Type to narrow {matching.length} available names.</small> : null}</div> : null}
    {field.error ? <p className="fdp-error" id={`${id}-error`} role="alert"><Icon name="alert" size={15} />{field.error}</p> : null}
    <span className="fdp-sr-only" role="status" aria-live="polite">{field.announcement}</span>
  </fieldset>;
}

export function DebtPeopleHistory({ details }: { details?: FinanceDebtHistory["details"] }) {
  const current = details?.responsible_people;
  const previous = details?.previous_responsible_people;
  if (!Array.isArray(current) || !current.every(name => typeof name === "string")) return null;
  const hasPrevious = Array.isArray(previous) && previous.every(name => typeof name === "string");
  const changed = hasPrevious && JSON.stringify(previous) !== JSON.stringify(current);
  return <div className="fdp-history"><Icon name="users" size={13} /><p><strong>{changed ? "People changed: " : "People: "}</strong>{changed ? <><span>{previous.length ? previous.join(", ") : "Unassigned"}</span><span aria-label="changed to"> → </span></> : null}<span>{current.length ? current.join(", ") : "Unassigned"}</span></p></div>;
}

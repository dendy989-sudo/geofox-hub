"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { TaskCompletion, TaskData, TaskStatus, WorkspaceList, WorkspaceRecord } from "@/lib/workspace/types";
import { apiRequest, AppBadge, Card, date, Empty, ErrorBanner, label, Loading, Metric, Modal, PageHeading, type PanelProps, useHubData } from "@/components/admin/common";
import { Icon } from "@/components/admin/icons";

type Task = WorkspaceRecord<TaskData>;
const statuses: { id: TaskStatus; name: string }[] = [{ id: "todo", name: "To do" }, { id: "in_progress", name: "In progress" }, { id: "done", name: "Done" }];
export function centralToday() {
  const parts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Chicago" }).formatToParts(new Date());
  return `${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}-${parts.find(p => p.type === "day")?.value}`;
}
function calendarDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(Date.UTC(year, monthNumber - 1, 1 - first.getUTCDay() + i));
    return day.toISOString().slice(0, 10);
  });
}
function moveMonth(month: string, direction: number) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + direction, 1)).toISOString().slice(0, 7);
}

function TaskForm({ item, initialStatus = "todo", props, onClose, onSaved }: { item: Task | null; initialStatus?: TaskStatus; props: PanelProps; onClose: () => void; onSaved: () => void }) {
  const companyAllowed = props.preview || props.staffRole === "owner" || props.workspaceAccess?.tasks.companyLevel === "write";
  const [title, setTitle] = useState(item?.title || "");
  const [description, setDescription] = useState(item?.data.description || "");
  const [appSlug, setAppSlug] = useState(item ? item.appSlug || "" : props.app !== "all" && props.app !== "company" ? props.app : companyAllowed ? "" : props.apps[0]?.slug || "");
  const [status, setStatus] = useState(item?.status || initialStatus);
  const [priority, setPriority] = useState<TaskData["priority"]>(item?.data.priority || "normal");
  const [dueDate, setDueDate] = useState(item?.data.dueDate || "");
  const [recurrence, setRecurrence] = useState<TaskData["recurrence"]>(item?.data.recurrence || "none");
  const [checklist, setChecklist] = useState((item?.data.checklist || []).map(step => step.text).join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || props.preview || !props.can("tasks:write")) return;
    setBusy(true); setError("");
    try {
      const usedStepIds = new Set<string>();
      const steps = checklist.split("\n").map(value => value.trim()).filter(Boolean).map(text => {
        const existing = item?.data.checklist.find(step => step.text === text && !usedStepIds.has(step.id));
        const step = existing || { id: crypto.randomUUID(), text, done: false };
        usedStepIds.add(step.id); return step;
      });
      const data: TaskData = { description: description.trim(), priority, dueDate: dueDate || null, recurrence, checklist: steps };
      await apiRequest<Task>(item ? `/api/workspace/records/${item.id}` : "/api/workspace/records", { method: item ? "PATCH" : "POST", body: JSON.stringify({ module: "tasks", appSlug: appSlug || null, title: title.trim(), status, data, ...(item ? { version: item.version } : { requestId }) }) });
      props.notify(item ? "Task updated." : "Task added to your planner."); onSaved(); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The task could not be saved."); }
    finally { setBusy(false); }
  }
  return <Modal title={item ? "Edit task" : "A new next step"} description="Keep it simple. Add the details you need to move this forward." onClose={() => { if (!busy) onClose(); }} actions={<><button className="hub-button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="hub-button" type="submit" form="task-editor" disabled={busy}>{busy ? "Saving…" : item ? "Save changes" : "Create task"}</button></>}>
    <ErrorBanner error={error} /><form id="task-editor" onSubmit={submit}>
      <div className="hub-field"><label htmlFor="task-title">Task name</label><input id="task-title" autoFocus required maxLength={180} value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs to get done?" disabled={busy} /></div>
      <div className="hub-field"><label htmlFor="task-notes">Notes</label><textarea id="task-notes" rows={3} maxLength={10000} value={description} onChange={e => setDescription(e.target.value)} placeholder="Ideas, context, or the next small step…" disabled={busy} /></div>
      <div className="ws-form-grid"><div className="hub-field"><label htmlFor="task-app">Company or app</label><select id="task-app" value={appSlug} onChange={e => setAppSlug(e.target.value)} disabled={busy}>{companyAllowed ? <option value="">Geofox company</option> : null}{props.apps.map(app => <option key={app.slug} value={app.slug}>{app.name}</option>)}</select></div>
      <div className="hub-field"><label htmlFor="task-status">Progress</label><select id="task-status" value={status} onChange={e => setStatus(e.target.value)} disabled={busy}><option value="todo">To do</option><option value="in_progress">In progress</option>{item?.status === "done" ? <option value="done">Done</option> : null}<option value="archived">Archived</option></select></div>
      <div className="hub-field"><label htmlFor="task-priority">Priority</label><select id="task-priority" value={priority} onChange={e => setPriority(e.target.value as TaskData["priority"])} disabled={busy}>{["low", "normal", "high", "urgent"].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></div>
      <div className="hub-field"><label htmlFor="task-due">Due date</label><input id="task-due" type="date" required={recurrence !== "none"} value={dueDate} onChange={e => setDueDate(e.target.value)} disabled={busy} /></div>
      <div className="hub-field ws-full"><label htmlFor="task-recur">Repeat after completion</label><select id="task-recur" value={recurrence} onChange={e => setRecurrence(e.target.value as TaskData["recurrence"])} disabled={busy}><option value="none">Does not repeat</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select>{recurrence !== "none" ? <small>Completing this task creates its next occurrence. The completed task stays in your history.</small> : null}</div></div>
      <div className="hub-field"><label htmlFor="task-checklist">Checklist · one step per line</label><textarea id="task-checklist" rows={4} value={checklist} maxLength={10000} onChange={e => setChecklist(e.target.value)} placeholder={"Prepare the first draft\nReview the details\nPublish the update"} disabled={busy} /></div>
    </form>
  </Modal>;
}

function TaskCard({ item, props, today, busy, onOpen, onStatus }: { item: Task; props: PanelProps; today: string; busy: boolean; onOpen: () => void; onStatus: (status: TaskStatus) => void }) {
  const completed = item.status === "done";
  const steps = item.data.checklist || [];
  const overdue = !completed && Boolean(item.data.dueDate && item.data.dueDate < today);
  return <article className="ws-task"><div className="ws-task-head"><button className={`ws-complete ${completed ? "done" : ""}`} type="button" aria-label={`${completed ? "Reopen" : "Complete"} ${item.title}`} disabled={busy || props.preview || !props.can("tasks:write")} onClick={() => onStatus(completed ? "todo" : "done")}>{completed ? <Icon name="check" size={12} /> : null}</button><button type="button" className={`ws-task-title ${completed ? "done" : ""}`} onClick={onOpen}>{item.title}</button></div>
    {item.data.description ? <p className="ws-task-description">{item.data.description}</p> : null}
    <div className="ws-task-tags">{item.appSlug ? <AppBadge slug={item.appSlug} apps={props.apps} /> : <span className="hub-app-badge">Geofox company</span>}<span className={`ws-priority ${item.data.priority}`}>{label(item.data.priority)}</span></div>
    <div className="ws-task-meta">{item.data.dueDate ? <span className={overdue ? "ws-overdue" : ""}><Icon name="calendar" size={11} />{date(item.data.dueDate, true)}{overdue ? " · overdue" : ""}</span> : <span>No due date</span>}{steps.length ? <span><Icon name="checklist" size={11} />{steps.filter(step => step.done).length}/{steps.length}</span> : null}{item.data.recurrence !== "none" ? <span title={`Repeats ${item.data.recurrence}`}><Icon name="refresh" size={11} /></span> : null}<select value={item.status} aria-label={`Progress for ${item.title}`} disabled={busy || props.preview || !props.can("tasks:write")} onChange={e => onStatus(e.target.value as TaskStatus)}>{statuses.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}{item.status === "archived" ? <option value="archived">Archived</option> : null}</select></div>
  </article>;
}

export function TasksPanel(props: PanelProps & { view?: string }) {
  const view = props.view || "board";
  const [revision, setRevision] = useState(0);
  const result = useHubData<WorkspaceList<TaskData>>(props.preview ? null : `/api/workspace/records?module=tasks&app=${encodeURIComponent(props.app)}&limit=200`, props.refreshKey + revision);
  const [extra, setExtra] = useState<Task[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("all");
  const [listStatus, setListStatus] = useState("active");
  const [dialog, setDialog] = useState<{ item: Task | null; status?: TaskStatus } | null>(null);
  const [detail, setDetail] = useState<Task | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const today = centralToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const records = [...(result.data?.items || []), ...extra];
  const tasks = records.filter(item => (priority === "all" || item.data.priority === priority) && (!search.trim() || `${item.title} ${item.data.description}`.toLowerCase().includes(search.trim().toLowerCase())));
  const active = records.filter(item => item.status !== "done" && item.status !== "archived");
  const filtered = tasks.filter(item => view === "completed" ? item.status === "done" : view === "list" ? listStatus === "all" || (listStatus === "active" ? item.status !== "done" && item.status !== "archived" : item.status === listStatus) : item.status !== "archived");
  const canWrite = props.can("tasks:write") && !props.preview;
  const canCreate = canWrite && (props.apps.length > 0 || props.workspaceAccess?.tasks.companyLevel === "write");
  useEffect(() => { setExtra([]); }, [result.data]);
  function reload() { setExtra([]); setRevision(value => value + 1); }
  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true); setError("");
    try {
      const next = await apiRequest<WorkspaceList<TaskData>>(`/api/workspace/records?module=tasks&app=${encodeURIComponent(props.app)}&limit=200&offset=${records.length}`);
      setExtra(current => [...current, ...next.items.filter(item => !records.some(existing => existing.id === item.id))]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "More tasks could not be loaded."); }
    finally { setLoadingMore(false); }
  }
  async function setStatus(item: Task, status: TaskStatus) {
    if (!canWrite || busyId || status === item.status) return;
    setBusyId(item.id); setError("");
    try {
      if (status === "done") {
        const saved = await apiRequest<TaskCompletion>(`/api/workspace/records/${item.id}/complete`, { method: "POST", body: JSON.stringify({ version: item.version }) });
        props.notify(saved.next ? "Task completed. Its next occurrence is on your planner." : "Task completed.");
      } else {
        await apiRequest<Task>(`/api/workspace/records/${item.id}`, { method: "PATCH", body: JSON.stringify({ module: "tasks", appSlug: item.appSlug, title: item.title, data: item.data, status, version: item.version }) });
        props.notify(status === "todo" ? "Task moved to To do." : "Task progress updated.");
      }
      setDetail(null); reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Task progress could not be updated."); }
    finally { setBusyId(""); }
  }
  async function toggleStep(item: Task, stepId: string) {
    if (!canWrite || busyId) return;
    setBusyId(item.id); setError("");
    try {
      const updated = await apiRequest<Task>(`/api/workspace/records/${item.id}`, { method: "PATCH", body: JSON.stringify({ module: "tasks", appSlug: item.appSlug, title: item.title, status: item.status, version: item.version, data: { ...item.data, checklist: item.data.checklist.map(step => step.id === stepId ? { ...step, done: !step.done } : step) } }) });
      setDetail(updated); reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The checklist could not be saved."); }
    finally { setBusyId(""); }
  }
  async function remove() {
    if (!confirmDelete || busyId || !canWrite) return;
    setBusyId(confirmDelete.id); setError("");
    try {
      await apiRequest(`/api/workspace/records/${confirmDelete.id}`, { method: "DELETE", body: JSON.stringify({ version: confirmDelete.version }) });
      setConfirmDelete(null); setDetail(null); reload(); props.notify("Task deleted.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The task could not be deleted."); }
    finally { setBusyId(""); }
  }
  return <>
    <PageHeading kicker="A little space to plan" title={view === "calendar" ? "Your days, in focus." : view === "completed" ? "Look how far you’ve come." : "Make room for what’s next."} description="One planner for Geofox, NovaNook, and every app you build next." />
    <div className="hub-metrics-grid"><Metric title="Open tasks" value={String(active.length)} detail="Ready for your next step" icon="checklist" /><Metric title="Due today" value={String(active.filter(item => item.data.dueDate === today).length)} detail="Your focus for today" icon="calendar" tone="cyan" /><Metric title="Overdue" value={String(active.filter(item => item.data.dueDate && item.data.dueDate < today).length)} detail="Review or move the due date" icon="clock" tone="orange" /><Metric title="Completed" value={String(records.filter(item => item.status === "done").length)} detail="Progress worth keeping" icon="check" tone="green" /></div>
    <div className="ws-toolbar"><div className="ws-search"><Icon name="search" size={15} /><input aria-label="Search tasks" placeholder="Find a task…" value={search} onChange={e => setSearch(e.target.value)} /></div><select className="ws-filter" aria-label="Task priority" value={priority} onChange={e => setPriority(e.target.value)}><option value="all">All priorities</option>{["urgent", "high", "normal", "low"].map(value => <option key={value} value={value}>{label(value)}</option>)}</select>{view === "list" ? <select className="ws-filter" aria-label="Task status" value={listStatus} onChange={e => setListStatus(e.target.value)}><option value="active">Active tasks</option><option value="all">All statuses</option>{statuses.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}<option value="archived">Archived</option></select> : null}<button className="hub-button" type="button" disabled={!canCreate} onClick={() => setDialog({ item: null })}><Icon name="plus" size={15} />New task</button></div>
    <ErrorBanner error={error || result.error} />
    {result.loading ? <Loading label="Loading your planner…" /> : view === "calendar" ? <><section className="ws-calendar"><header className="ws-calendar-head"><h2>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`))}</h2><div className="ws-actions"><button className="hub-icon-button" aria-label="Previous month" onClick={() => setMonth(moveMonth(month, -1))}><Icon name="chevron" size={15} style={{ transform: "rotate(90deg)" }} /></button><button className="hub-button secondary small" onClick={() => setMonth(today.slice(0, 7))}>Today</button><button className="hub-icon-button" aria-label="Next month" onClick={() => setMonth(moveMonth(month, 1))}><Icon name="chevron" size={15} style={{ transform: "rotate(-90deg)" }} /></button></div></header><div className="ws-calendar-scroll"><div className="ws-calendar-grid">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <div key={day} className="ws-calendar-weekday">{day}</div>)}</div><div className="ws-calendar-grid">{calendarDays(month).map(day => <div key={day} className={`ws-calendar-day ${day.startsWith(month) ? "" : "outside"} ${day === today ? "today" : ""}`}><span className="ws-day-number">{Number(day.slice(-2))}</span>{filtered.filter(item => item.data.dueDate === day).map(item => <button className={`ws-calendar-item ${item.status === "done" ? "done" : ""}`} key={item.id} title={item.title} onClick={() => setDetail(item)}>{item.status === "done" ? "✓ " : ""}{item.title}</button>)}</div>)}</div></div></section>{filtered.filter(item => !item.data.dueDate).length ? <p className="ws-help" style={{ marginTop: 14 }}>{filtered.filter(item => !item.data.dueDate).length} tasks have no due date. You can find them in All tasks.</p> : null}</> : view === "board" ? <div className="ws-board">{statuses.map(status => <section className="ws-column" key={status.id}><header className="ws-column-head"><span className={`hub-dot ${status.id === "done" ? "healthy" : status.id === "in_progress" ? "warning" : ""}`} />{status.name}<span className="ws-count">{filtered.filter(item => item.status === status.id).length}</span>{status.id !== "done" ? <button aria-label={`Add a ${status.name.toLowerCase()} task`} disabled={!canCreate} onClick={() => setDialog({ item: null, status: status.id })}><Icon name="plus" size={16} /></button> : null}</header>{filtered.filter(item => item.status === status.id).map(item => <TaskCard key={item.id} item={item} props={props} today={today} busy={Boolean(busyId)} onOpen={() => setDetail(item)} onStatus={status => setStatus(item, status)} />)}{!filtered.some(item => item.status === status.id) ? <div className="ws-column-empty">{status.id === "todo" ? "A clear place for your next idea." : status.id === "in_progress" ? "Move a task here when you’re ready to begin." : "Your completed work will appear here."}</div> : null}</section>)}</div> : <Card title={view === "completed" ? "Completed tasks" : "Your task list"} subtitle={`${filtered.length} ${filtered.length === 1 ? "task" : "tasks"} in this view`}>{filtered.length ? <div className="hub-table-wrap"><table className="hub-table"><thead><tr><th>Task</th><th>Company / app</th><th>Due</th><th>Priority</th><th>Progress</th></tr></thead><tbody>{filtered.map(item => <tr key={item.id}><td><button className="ws-task-title" onClick={() => setDetail(item)}>{item.title}</button>{item.data.checklist.length ? <div className="ws-help">{item.data.checklist.filter(step => step.done).length}/{item.data.checklist.length} steps</div> : null}</td><td>{item.appSlug ? <AppBadge slug={item.appSlug} apps={props.apps} /> : "Geofox company"}</td><td className={item.status !== "done" && item.data.dueDate && item.data.dueDate < today ? "ws-overdue" : ""}>{item.data.dueDate ? date(item.data.dueDate, true) : "—"}</td><td><span className={`ws-priority ${item.data.priority}`}>{label(item.data.priority)}</span></td><td><select className="ws-filter" aria-label={`Progress for ${item.title}`} value={item.status} disabled={!canWrite || Boolean(busyId)} onChange={e => setStatus(item, e.target.value as TaskStatus)}>{statuses.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}<option value="archived">Archived</option></select></td></tr>)}</tbody></table></div> : <Empty icon="checklist" title={view === "completed" ? "Your progress starts here" : "A fresh page for your plans"} description={view === "completed" ? "Completed tasks stay here so you can see what you’ve accomplished." : "Add a task, set a date, and take it one step at a time."} />}</Card>}
    {result.data && result.data.total > records.length ? <div className="ws-load-more"><span className="ws-help">Showing {records.length} of {result.data.total}. Counts and filters cover loaded tasks.</span><button className="hub-button secondary small" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load more tasks"}</button></div> : null}
    {dialog ? <TaskForm item={dialog.item} initialStatus={dialog.status} props={props} onClose={() => setDialog(null)} onSaved={reload} /> : null}
    {detail ? <Modal title={detail.title} description={detail.appSlug ? props.apps.find(app => app.slug === detail.appSlug)?.name : "Geofox company"} onClose={() => setDetail(null)} actions={<><button className="hub-button secondary small ws-danger" disabled={!canWrite || Boolean(busyId)} onClick={() => { setConfirmDelete(detail); setDetail(null); }}><Icon name="trash" size={13} />Delete</button><button className="hub-button secondary" disabled={!canWrite || Boolean(busyId)} onClick={() => { setDialog({ item: detail }); setDetail(null); }}>Edit task</button><button className="hub-button" disabled={!canWrite || Boolean(busyId)} onClick={() => setStatus(detail, detail.status === "done" ? "todo" : "done")}>{busyId ? "Saving…" : detail.status === "done" ? "Reopen task" : "Mark complete"}</button></>}><ErrorBanner error={error} /><div className="ws-detail-meta"><span className={`ws-priority ${detail.data.priority}`}>{label(detail.data.priority)} priority</span><span>{detail.data.dueDate ? `Due ${date(detail.data.dueDate, true)}` : "No due date"}</span>{detail.data.recurrence !== "none" ? <span>Repeats {detail.data.recurrence}</span> : null}</div><p className="ws-detail-description">{detail.data.description || "No notes added yet."}</p>{detail.data.checklist.length ? <><h3 className="ws-help">Checklist</h3><ul className="ws-checklist">{detail.data.checklist.map(step => <li key={step.id}><label className={step.done ? "is-done" : ""}><input type="checkbox" checked={step.done} disabled={!canWrite || Boolean(busyId)} onChange={() => toggleStep(detail, step.id)} />{step.text}</label></li>)}</ul></> : null}<p className="ws-help">Last updated {date(detail.updatedAt)}</p></Modal> : null}
    {confirmDelete ? <Modal title="Delete this task?" description={confirmDelete.title} onClose={() => { if (!busyId) setConfirmDelete(null); }} actions={<><button className="hub-button secondary" disabled={Boolean(busyId)} onClick={() => setConfirmDelete(null)}>Keep task</button><button className="hub-button" disabled={Boolean(busyId)} onClick={remove}>{busyId ? "Deleting…" : "Delete task"}</button></>}><ErrorBanner error={error} /><p className="ws-help">This removes the task and its checklist. Other occurrences of a repeating task are kept.</p></Modal> : null}
  </>;
}

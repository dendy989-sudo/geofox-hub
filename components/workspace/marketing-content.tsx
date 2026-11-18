"use client";

import { useRef, useState, type FormEvent } from "react";
import { AppBadge, Empty, ErrorBanner, Loading, Modal, PageHeading, Pill, apiRequest, date, label, useHubData, type PanelProps } from "@/components/admin/common";
import { Icon } from "@/components/admin/icons";
import { AttachmentPreview, Attachments, useAttachmentUrl } from "./attachments";
import type { WorkspaceList } from "@/lib/workspace/types";
import { SOCIAL_PLATFORMS, type ContentRecord, type MarketingContent, type MarketingData, type MarketingMedia, type PostRecord, type SocialPlatform } from "@/lib/workspace/marketing-types";
import { PLATFORM_NAMES, normalizeHashtags } from "@/lib/workspace/marketing-utils";
import "./marketing-content.css";

const STATUS_NAMES: Record<string, string> = {
  draft: "Draft", in_progress: "In progress", in_review: "Waiting on review",
  approved: "Approved", published: "Published", archived: "Archived",
};
const FORMAT_NAMES = { video: "Video", photo: "Image", carousel: "Carousel", text: "Text" };
type ContentInput = { id?: string; version?: number; appSlug: string | null; title: string; status: string; data: MarketingContent };
type EditorState = { record: ContentRecord | null; initial?: ContentInput; displayStatus?: string };

function freshContent(isTemplate = false): MarketingContent {
  return { kind: "content", isTemplate, contentType: "video", platforms: ["tiktok"], brief: "", script: "", caption: "", hashtags: "", notes: "", campaign: "", media: [], thumbnail: null, sourceTemplateId: null, approval: null, linkedPostId: null };
}
function contentStatus(record: ContentRecord, posts: PostRecord[]) {
  return record.status !== "archived" && posts.some(post => post.id === record.data.linkedPostId && post.status === "published") ? "published" : record.status;
}
async function copy(value: string, notify: PanelProps["notify"]) {
  try { await navigator.clipboard.writeText(value); notify("Copied to clipboard."); }
  catch { notify("Select the text to copy it. Clipboard access is unavailable."); }
}
function defaultScope(props: PanelProps) {
  if (props.app !== "all") return props.app === "company" ? null : props.app;
  return props.apps.find(app => app.slug === "novanook")?.slug ?? props.apps[0]?.slug ?? null;
}

export function MarketingContentPanel(props: PanelProps) {
  const { app, apps, preview, can, notify, navigate, refreshKey } = props;
  const query = useHubData<WorkspaceList<MarketingData>>(preview ? null : `/api/workspace/records?module=marketing&app=${encodeURIComponent(app)}&limit=1000`, refreshKey);
  const [collection, setCollection] = useState<"content" | "templates">("content");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState<SocialPlatform | "all">("all");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  const records = (query.data?.items ?? []).filter((record): record is ContentRecord => record.data.kind === "content");
  const posts = (query.data?.items ?? []).filter((record): record is PostRecord => record.data.kind === "post");
  const writable = !preview && can("marketing:write");
  const owner = props.staffRole === "owner";
  const company = preview || owner || props.workspaceAccess?.marketing.companyLevel === "write";
  const content = records.filter(record => !record.data.isTemplate && record.status !== "archived");
  const templates = records.filter(record => record.data.isTemplate && record.status !== "archived");
  const visible = records.filter(record => {
    const state = contentStatus(record, posts);
    return record.data.isTemplate === (collection === "templates")
      && (status === "all" ? state !== "archived" : state === status)
      && (platform === "all" || record.data.platforms.includes(platform))
      && `${record.title} ${record.data.brief} ${record.data.caption} ${record.data.campaign} ${record.data.hashtags}`.toLowerCase().includes(search.toLowerCase());
  }).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  function open(record: ContentRecord) { setError(""); requestId.current = null; setEditor({ record, displayStatus: contentStatus(record, posts) }); }
  function create(isTemplate = false) {
    setError(""); requestId.current = null;
    setEditor({ record: null, initial: { appSlug: defaultScope(props), title: "", status: "draft", data: freshContent(isTemplate) } });
  }
  function duplicate(record: ContentRecord, isTemplate: boolean) {
    setError(""); requestId.current = null;
    setEditor({ record: null, initial: {
      appSlug: record.appSlug, title: `${record.title}${isTemplate ? " — template" : record.data.isTemplate ? "" : " — copy"}`.slice(0, 200), status: "draft",
      data: { ...record.data, isTemplate, approval: null, linkedPostId: null, sourceTemplateId: record.data.isTemplate ? record.id : record.data.sourceTemplateId },
    } });
  }
  async function save(input: ContentInput) {
    setBusy(true); setError("");
    try {
      const saved = await apiRequest<ContentRecord>(input.id ? `/api/workspace/records/${input.id}` : "/api/workspace/records", {
        method: input.id ? "PATCH" : "POST",
        body: JSON.stringify({ ...input, module: "marketing", ...(!input.id ? { requestId: requestId.current ??= crypto.randomUUID() } : {}) }),
      });
      requestId.current = null; setEditor(null); query.reload();
      notify(input.status === "approved" && saved.status === "in_progress" ? "Changes saved. Send this updated version for review again." : saved.status === "approved" ? "Content approved. It is ready for the post planner." : saved.status === "in_review" ? "Saved and waiting on your review." : "Content saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Content could not be saved."); }
    finally { setBusy(false); }
  }
  async function plan(record: ContentRecord) {
    setBusy(true); setError("");
    try {
      await apiRequest<{ content: ContentRecord; post: PostRecord }>(`/api/marketing/content/${record.id}/post`, { method: "POST", body: JSON.stringify({ version: record.version }) });
      setEditor(null); query.reload(); notify("Approved content is in Posts & drafts. Choose its publishing date there."); navigate("marketing/posts");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The post could not be prepared."); }
    finally { setBusy(false); }
  }

  return <div className="content-workspace">
    <PageHeading kicker="MARKETING" title="Content" description="A home for every idea, work in progress, and finished creative." />
    <ErrorBanner error={query.error || (!editor ? error : "")} />
    {preview ? <div className="content-note"><Icon name="info" size={17} /><p>Sign in to see your private content, save templates, and review new creative.</p></div> : null}
    <section className="content-intro" aria-label="Creative workflow">
      <div><span className="content-eyebrow">YOUR CREATIVE WORKSPACE</span><h2>From the first idea to the final yes.</h2><p>Keep the brief, script, media, and feedback together. Reuse what works. Review each piece before it enters the post planner.</p>
        <ol className="content-flow"><li>Draft</li><li>In progress</li><li>Review</li><li>Approved</li><li>Published</li></ol>
      </div>
      <div className="content-intro-actions"><button className="hub-button" type="button" disabled={!writable} onClick={() => create(false)}><Icon name="plus" size={16} />New content</button><button className="hub-button secondary" type="button" disabled={!writable} onClick={() => create(true)}><Icon name="copy" size={15} />New template</button></div>
    </section>
    <div className="content-stats" aria-label="Content overview">
      {[{ title: "In the making", statuses: ["draft", "in_progress"], hint: "Ideas & works in progress", icon: "edit" as const }, { title: "Waiting on review", statuses: ["in_review"], hint: "Ready for a closer look", icon: "message" as const }, { title: "Approved", statuses: ["approved"], hint: "Ready for the post planner", icon: "check" as const }, { title: "Published", statuses: ["published"], hint: "Your finished, shared work", icon: "megaphone" as const }].map(stat => <div className="content-stat" key={stat.title}><span className="content-stat-icon"><Icon name={stat.icon} size={18} /></span><div><span>{stat.title}</span><strong>{content.filter(record => stat.statuses.includes(contentStatus(record, posts))).length}</strong><small>{stat.hint}</small></div></div>)}
    </div>
    <div className="content-library-heading"><div className="content-tabs" role="group" aria-label="Content collection"><button type="button" className={collection === "content" ? "active" : ""} aria-pressed={collection === "content"} onClick={() => setCollection("content")}>All content <span>{content.length}</span></button><button type="button" className={collection === "templates" ? "active" : ""} aria-pressed={collection === "templates"} onClick={() => setCollection("templates")}>Templates <span>{templates.length}</span></button></div><button className="hub-button secondary small" type="button" onClick={query.reload} disabled={preview || query.loading}><Icon name="refresh" size={14} />Refresh</button></div>
    <div className="content-filters"><label className="content-search"><Icon name="search" size={17} /><input type="search" aria-label="Search content" placeholder="Search ideas, campaigns, or captions…" value={search} onChange={event => setSearch(event.target.value)} /></label><select className="hub-select" aria-label="Content status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All active statuses</option>{Object.entries(STATUS_NAMES).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select><select className="hub-select" aria-label="Content channel" value={platform} onChange={event => setPlatform(event.target.value as SocialPlatform | "all")}><option value="all">All channels</option>{SOCIAL_PLATFORMS.map(item => <option key={item} value={item}>{PLATFORM_NAMES[item]}</option>)}</select></div>
    {query.loading ? <Loading label="Loading your creative workspace…" /> : visible.length ? <div className="content-grid">{visible.map(record => <ContentCard key={record.id} record={record} status={contentStatus(record, posts)} apps={apps} readOnly={!writable} busy={busy} onOpen={() => open(record)} onDuplicate={() => duplicate(record, false)} onPlan={() => plan(record)} />)}</div> : <div className="content-empty"><Empty icon={collection === "templates" ? "copy" : "layers"} title={search || status !== "all" || platform !== "all" ? "No matches just yet" : collection === "templates" ? "Give your next idea a head start" : "Your next good idea belongs here"} description={search || status !== "all" || platform !== "all" ? "Try another search or status to find your creative." : collection === "templates" ? "Save a repeatable structure for your ads, launch posts, and recurring series." : "Add a brief, write a script, and attach your images or video. Everything stays together as you work."} />{writable ? <button className="hub-button secondary" type="button" onClick={() => create(collection === "templates")}><Icon name="plus" size={15} />{collection === "templates" ? "Create a template" : "Create content"}</button> : null}</div>}
    {query.data && query.data.total > query.data.items.length ? <p className="content-help">Showing the latest {query.data.items.length} Marketing records. Choose a specific app to narrow the collection.</p> : null}
    <div className="content-footer-note"><Icon name="lock" size={14} /><p>Private to your Marketing workspace. Approval prepares content for planning; publishing still uses your connected channel or the network’s own tools.</p></div>
    {editor ? <ContentEditor key={editor.record?.id ?? "new"} state={editor} apps={apps} company={company} owner={owner} readOnly={!writable} busy={busy} error={error} notify={notify} onSave={save} onClose={() => { if (!busy) { setEditor(null); setError(""); requestId.current = null; } }} onPlan={plan} onDuplicate={duplicate} navigate={navigate} /> : null}
  </div>;
}

function ContentCard({ record, status, apps, readOnly, busy, onOpen, onDuplicate, onPlan }: { record: ContentRecord; status: string; apps: PanelProps["apps"]; readOnly: boolean; busy: boolean; onOpen: () => void; onDuplicate: () => void; onPlan: () => void }) {
  const media = record.data.thumbnail ?? record.data.media[0] ?? null;
  const video = record.data.media.find(item => item.contentType.startsWith("video/"));
  return <article className={`content-card content-card-${record.data.contentType}`}>
    <button type="button" className={`content-card-cover ${media ? "has-media" : ""}`} onClick={onOpen} aria-label={`Open ${record.title}`}>
      {media ? <AttachmentPreview attachment={media} alt={record.title} /> : <div className="content-card-art"><Icon name={record.data.isTemplate ? "copy" : record.data.contentType === "text" ? "edit" : "image"} size={30} /><span>{record.data.isTemplate ? "REUSABLE TEMPLATE" : record.data.script ? "SCRIPT & CONCEPT" : "CREATIVE IN PROGRESS"}</span><strong>{record.title}</strong></div>}
      <span className="content-format">{record.data.isTemplate ? "Template" : FORMAT_NAMES[record.data.contentType]}{video?.duration ? ` · ${Math.round(video.duration)}s` : ""}</span>
      {video ? <span className="content-play" aria-hidden="true">▶</span> : null}
    </button>
    <div className="content-card-body"><div className="content-card-meta"><Pill status={status}>{STATUS_NAMES[status] ?? label(status)}</Pill>{record.appSlug ? <AppBadge slug={record.appSlug} apps={apps} /> : <span className="hub-app-badge">Geofox company</span>}</div><button type="button" className="content-title" onClick={onOpen}>{record.title}</button><p className="content-card-summary">{record.data.brief || record.data.caption || "Start with a brief, script, or first piece of media."}</p><div className="content-card-channels">{record.data.platforms.map(platform => <span key={platform}>{PLATFORM_NAMES[platform]}</span>)}{record.data.campaign ? <span>{record.data.campaign}</span> : null}</div><small className="content-updated">Updated {date(record.updatedAt, true)}</small></div>
    <footer className="content-card-actions"><button type="button" className="content-text-button" onClick={onOpen}>{status === "in_review" ? "Review content" : readOnly ? "View content" : "Open content"}<Icon name="arrow" size={14} /></button>{record.data.isTemplate ? <button type="button" className="hub-button secondary small" disabled={readOnly || busy} onClick={onDuplicate}>Use template</button> : status === "approved" ? <button type="button" className="hub-button secondary small" disabled={readOnly || busy} onClick={onPlan}>{record.data.linkedPostId ? "Open in planner" : "Prepare post"}</button> : null}</footer>
  </article>;
}

function CreativePreview({ media, thumbnail, title }: { media: MarketingMedia[]; thumbnail: MarketingMedia | null; title: string }) {
  const playable = media.find(item => item.contentType.startsWith("video/")) ?? media.find(item => item.contentType.startsWith("image/")) ?? null;
  const source = useAttachmentUrl(playable?.path);
  const poster = useAttachmentUrl(thumbnail?.path);
  return <div className="content-preview"><div className="content-preview-heading"><span>CREATIVE PREVIEW</span>{playable?.width && playable.height ? <small>{playable.width} × {playable.height}</small> : null}</div><div className={`content-preview-stage ${playable?.contentType.startsWith("video/") ? "is-video" : ""}`}>
    {playable && source.url ? playable.contentType.startsWith("video/") ? <video key={source.url} src={source.url} poster={poster.url ?? undefined} controls playsInline preload="metadata" aria-label={title || "Content video preview"} /> : <img src={source.url} alt={title || "Content image preview"} /> : thumbnail && poster.url ? <img src={poster.url} alt={title || "Cover preview"} /> : <div className="content-preview-empty"><Icon name="image" size={35} /><strong>{playable ? "Loading your creative…" : "Your creative goes here"}</strong><p>Attach the video or images you want to review. Your original format stays intact.</p></div>}
  </div>{source.error ? <div className="content-preview-error" role="alert"><p>{source.error}</p><button type="button" className="content-text-button" onClick={source.reload}>Reload preview</button></div> : null}{playable?.duration ? <p className="content-help">{Math.round(playable.duration)} seconds · {playable.filename}</p> : null}</div>;
}

function ContentEditor({ state, apps, company, owner, readOnly, busy, error, notify, onSave, onClose, onPlan, onDuplicate, navigate }: { state: EditorState; apps: PanelProps["apps"]; company: boolean; owner: boolean; readOnly: boolean; busy: boolean; error: string; notify: PanelProps["notify"]; onSave: (input: ContentInput) => Promise<void>; onClose: () => void; onPlan: (record: ContentRecord) => Promise<void>; onDuplicate: (record: ContentRecord, isTemplate: boolean) => void; navigate: PanelProps["navigate"] }) {
  const record = state.record;
  const initial = record ?? state.initial!;
  const [title, setTitle] = useState(initial.title);
  const [scope, setScope] = useState(initial.appSlug);
  const initialStatus = state.displayStatus ?? initial.status;
  const published = initialStatus === "published";
  const [status, setStatus] = useState(initialStatus);
  const [data, setData] = useState<MarketingContent>(() => ({ ...freshContent(), ...initial.data }));
  const [section, setSection] = useState<"creative" | "caption" | "review">("creative");
  const [mediaBusy, setMediaBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [validation, setValidation] = useState("");
  const pending = busy || mediaBusy || coverBusy;
  const disabled = readOnly || pending || published;
  const dirty = title !== initial.title || scope !== initial.appSlug || status !== initialStatus || JSON.stringify(data) !== JSON.stringify({ ...freshContent(), ...initial.data });
  const lockedScope = Boolean(data.media.length || data.thumbnail || data.linkedPostId || data.sourceTemplateId);
  const update = <K extends keyof MarketingContent>(key: K, value: MarketingContent[K]) => setData(current => ({ ...current, [key]: value }));
  function close() {
    if (pending) return;
    if (!readOnly && dirty && !window.confirm("Discard your unsaved changes?")) return;
    onClose();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const nextStatus = submitter instanceof HTMLButtonElement ? submitter.dataset.status || status : status;
    if (!title.trim()) { setValidation("Give this content a title."); return; }
    if (!data.platforms.length) { setValidation("Choose at least one channel."); return; }
    if (nextStatus === "in_review" && !data.script.trim() && !data.caption.trim() && !data.media.length) { setValidation("Add a script, caption, or creative file before sending this for review."); return; }
    setValidation("");
    await onSave({ ...(record ? { id: record.id, version: record.version } : {}), title: title.trim(), appSlug: scope, status: nextStatus, data: { ...data, hashtags: normalizeHashtags(data.hashtags) } });
  }
  const showReview = !data.isTemplate && !["approved", "published", "archived"].includes(status);
  const actions = <><button className="hub-button secondary" type="button" disabled={pending} onClick={close}>Close</button>{!readOnly && !published ? <><button className="hub-button secondary" type="submit" form="content-editor" disabled={pending}>{pending ? mediaBusy || coverBusy ? "Uploading…" : "Saving…" : "Save changes"}</button>{showReview && status !== "in_review" ? <button className="hub-button" type="submit" form="content-editor" data-status="in_review" disabled={pending}><Icon name="send" size={15} />Send for review</button> : null}{owner && record?.status === "in_review" && !data.isTemplate ? <button className="hub-button" type="submit" form="content-editor" data-status="approved" disabled={pending || dirty}><Icon name="check" size={15} />Approve content</button> : null}{record?.status === "approved" && !data.isTemplate ? <button className="hub-button" type="button" disabled={pending || dirty} onClick={() => onPlan(record)}><Icon name="calendar" size={15} />{record.data.linkedPostId ? "Open in planner" : "Prepare post"}</button> : null}</> : null}</>;
  return <Modal title={data.isTemplate ? record ? "Edit template" : "New template" : record ? title || "Content details" : "Create content"} description={data.isTemplate ? "A repeatable starting point. Each use creates a separate draft." : "Review the creative, refine the copy, and keep feedback in one place."} wide onClose={close} actions={actions}>
    <ErrorBanner error={validation || error} />
    <form id="content-editor" onSubmit={submit} className="content-editor">
      <div className="content-editor-main"><div className="content-editor-top"><Pill status={status}>{STATUS_NAMES[status] ?? label(status)}</Pill>{data.isTemplate ? <span className="hub-app-badge">Reusable template</span> : null}{record ? <small>Version {record.version} · Updated {date(record.updatedAt, true)}</small> : null}</div>
        <fieldset className="content-fields" disabled={disabled}><div className="hub-field"><label htmlFor="content-title">Title</label><input id="content-title" value={title} onChange={event => setTitle(event.target.value)} placeholder="A cozy home for your TBR" maxLength={200} required /></div><div className="content-form-two"><div className="hub-field"><label htmlFor="content-scope">Company or app</label><select id="content-scope" value={scope ?? "company"} disabled={disabled || lockedScope} onChange={event => setScope(event.target.value === "company" ? null : event.target.value)}>{company ? <option value="company">Geofox company</option> : null}{apps.map(app => <option key={app.slug} value={app.slug}>{app.name}</option>)}</select>{lockedScope ? <small>This creative stays with its app and attached files.</small> : null}</div><div className="hub-field"><label htmlFor="content-format">Format</label><select id="content-format" value={data.contentType} onChange={event => update("contentType", event.target.value as MarketingContent["contentType"])}>{Object.entries(FORMAT_NAMES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></div></div><div className="hub-field"><span className="content-field-label" id="content-channels-label">Channels</span><div className="content-channel-options" role="group" aria-labelledby="content-channels-label">{SOCIAL_PLATFORMS.map(platform => <button key={platform} type="button" aria-pressed={data.platforms.includes(platform)} className={data.platforms.includes(platform) ? "active" : ""} onClick={() => update("platforms", data.platforms.includes(platform) ? data.platforms.filter(item => item !== platform) : [...data.platforms, platform])}>{PLATFORM_NAMES[platform]}</button>)}</div></div></fieldset>
        <div className="content-section-tabs" role="group" aria-label="Content details">{(["creative", "caption", "review"] as const).map(item => <button type="button" key={item} id={`content-tab-${item}`} aria-pressed={section === item} aria-controls={`content-section-${item}`} className={section === item ? "active" : ""} onClick={() => setSection(item)}>{item === "creative" ? "Brief & script" : item === "caption" ? "Caption & media" : "Review & notes"}</button>)}</div>
        <div className="content-fields">
          <div id="content-section-creative" role="region" aria-labelledby="content-tab-creative" hidden={section !== "creative"}><div className="hub-field"><label htmlFor="content-brief">Creative brief</label><textarea id="content-brief" disabled={disabled} rows={4} value={data.brief} maxLength={10000} placeholder="The audience, angle, hook, and what this piece should communicate…" onChange={event => update("brief", event.target.value)} /></div><div className="hub-field"><label htmlFor="content-script">Script & shot list</label><textarea id="content-script" disabled={disabled} className="content-script" rows={12} value={data.script} maxLength={20000} placeholder={"0–3s · Hook\n[Show the actual app] On-screen text…\n\n3–20s · Demonstration\nVoiceover, shot directions, and captions…\n\n20–28s · Close\nThe next step for the viewer…"} onChange={event => update("script", event.target.value)} /></div></div>
          <div id="content-section-caption" role="region" aria-labelledby="content-tab-caption" hidden={section !== "caption"}><div className="hub-field"><label htmlFor="content-caption">Post caption</label><textarea id="content-caption" disabled={disabled} rows={5} maxLength={10000} value={data.caption} onChange={event => update("caption", event.target.value)} placeholder="What readers will see below your post…" /></div><div className="hub-field"><label htmlFor="content-hashtags">Hashtags</label><input id="content-hashtags" disabled={disabled} value={data.hashtags} maxLength={2500} onChange={event => update("hashtags", event.target.value)} placeholder="#BookTok #CozyReading #NovaNook" /></div><div className="hub-field"><span className="content-field-label">Creative files</span><Attachments module="marketing" appSlug={scope} value={data.media} onChange={value => update("media", value)} onBusyChange={setMediaBusy} disabled={disabled} viewOnly={readOnly || published} maxFiles={20} accept="image/*,video/*,application/pdf" /></div><div className="hub-field"><span className="content-field-label">Cover image</span><Attachments module="marketing" appSlug={scope} value={data.thumbnail ? [data.thumbnail] : []} onChange={value => update("thumbnail", value.at(-1) ?? null)} onBusyChange={setCoverBusy} disabled={disabled} viewOnly={readOnly || published} maxFiles={1} accept="image/*" /></div></div>
          <div id="content-section-review" role="region" aria-labelledby="content-tab-review" hidden={section !== "review"}><div className="content-form-two"><div className="hub-field"><label htmlFor="content-status">Work status</label><select id="content-status" disabled={disabled} value={status} onChange={event => setStatus(event.target.value)}>{["draft", "in_progress", ...(!data.isTemplate ? ["in_review"] : []), ...(["approved", "published"].includes(initialStatus) ? [initialStatus] : []), "archived"].map(value => <option key={value} value={value}>{STATUS_NAMES[value]}</option>)}</select><small>{data.isTemplate ? "Templates remain reusable starting points." : "The owner approves the reviewed version before planning."}</small></div><div className="hub-field"><label htmlFor="content-campaign">Campaign</label><input id="content-campaign" disabled={disabled} value={data.campaign} maxLength={200} onChange={event => update("campaign", event.target.value)} placeholder="NovaNook · Web launch" /></div></div><div className="hub-field"><label htmlFor="content-notes">Feedback & production notes</label><textarea id="content-notes" disabled={disabled} rows={8} maxLength={10000} value={data.notes} onChange={event => update("notes", event.target.value)} placeholder="Requested edits, references, audio direction, or notes for the next person…" /></div></div>
        </div>
        {published ? <div className="content-note"><Icon name="megaphone" size={16} /><p>This creative has been published. Duplicate it to make a new version while keeping the published record intact.</p></div> : data.approval ? <div className="content-approval"><Icon name="check" size={16} /><div><strong>Owner approved · {date(data.approval.reviewedAt)}</strong><p>Changing the creative sends it back to in progress for another review.</p></div></div> : !data.isTemplate && status === "in_review" ? <div className="content-note"><Icon name="message" size={16} /><p>{owner ? "Watch the preview and review the caption. Save any edits before approving this version." : "This version is waiting for the owner’s review."}</p></div> : null}
        {record && !readOnly ? <div className="content-editor-links"><button type="button" className="content-text-button" disabled={pending || dirty} onClick={() => onDuplicate(record, false)}><Icon name="copy" size={14} />{data.isTemplate ? "Use this template" : "Duplicate as a new draft"}</button>{!data.isTemplate ? <button type="button" className="content-text-button" disabled={pending || dirty} onClick={() => onDuplicate(record, true)}>Save a template copy</button> : null}</div> : null}
      </div>
      <aside className="content-editor-preview"><CreativePreview media={data.media} thumbnail={data.thumbnail} title={title} /><div className="content-preview-actions"><button type="button" className="hub-button secondary small" disabled={!data.script} onClick={() => copy(data.script, notify)}><Icon name="copy" size={14} />Copy script</button><button type="button" className="hub-button secondary small" disabled={!data.caption} onClick={() => copy([data.caption, data.hashtags].filter(Boolean).join("\n\n"), notify)}><Icon name="copy" size={14} />Copy caption</button></div>{data.linkedPostId ? <div className="content-linked"><Icon name="calendar" size={17} /><div><strong>Connected to the post planner</strong><p>Set the publishing date and record the final post in Posts & drafts.</p><button type="button" className="content-text-button" disabled={pending || dirty} onClick={() => { onClose(); navigate("marketing/posts"); }}>Open Posts & drafts<Icon name="arrow" size={14} /></button></div></div> : null}<p className="content-preview-tip">Review original media at its natural proportions. Scripts, captions, and files stay private until you publish through your chosen channel.</p></aside>
    </form>
  </Modal>;
}

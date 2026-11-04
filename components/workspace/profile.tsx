"use client";

import { useState, type FormEvent } from "react";
import { apiRequest, Card, date, Empty, ErrorBanner, label, Loading, Modal, PageHeading, type PanelProps, useHubData } from "@/components/admin/common";
import { Icon, type IconName } from "@/components/admin/icons";
import type { WorkspaceLevel, WorkspaceModule, WorkspaceProfile, WorkspaceStaffAccess } from "@/lib/workspace/types";

const sections: { id: WorkspaceModule; label: string; icon: IconName; description: string }[] = [
  { id: "marketing", label: "Marketing", icon: "megaphone", description: "Content planning, media, social records, and insights." },
  { id: "tasks", label: "Tasks", icon: "checklist", description: "Company plans, checklists, and recurring work." },
  { id: "legal", label: "Legal", icon: "scales", description: "Obligations, due dates, and compliance documents." },
  { id: "accounting", label: "Accounting", icon: "wallet", description: "Income, expenses, receipts, and financial exports." },
];
function accessLabel(level: WorkspaceLevel | undefined) { return level === "write" ? "View & manage" : level === "read" ? "View only" : "No access"; }

function AccessEditor({ member, onClose, onSaved, notify }: { member: WorkspaceStaffAccess; onClose: () => void; onSaved: () => void; notify: (message: string) => void }) {
  const [grants, setGrants] = useState<Record<WorkspaceModule, WorkspaceLevel | "default">>({ tasks: member.grants.tasks ?? "default", marketing: member.grants.marketing ?? "default", legal: member.grants.legal ?? "default", accounting: member.grants.accounting ?? "default" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || member.role === "owner") return;
    setBusy(true); setError("");
    try {
      await apiRequest("/api/workspace/access", { method: "PATCH", body: JSON.stringify({ userId: member.userId, grants: Object.fromEntries(Object.entries(grants).map(([module, level]) => [module, level === "default" ? null : level])) }) });
      notify("Workspace access updated."); onSaved(); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Access could not be updated."); }
    finally { setBusy(false); }
  }
  return <Modal title={`Workspace access · ${member.displayName}`} description={`${label(member.role)} · ${member.active ? "Active staff member" : "Staff access disabled"}`} onClose={() => { if (!busy) onClose(); }} actions={<><button className="hub-button secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="hub-button" type="submit" form="workspace-access-form" disabled={busy}>{busy ? "Saving…" : "Save permissions"}</button></>}><ErrorBanner error={error} /><p className="ws-help">A specific permission grants access to this section’s Geofox company records and the member’s assigned apps. Use the role default to keep task access limited to their assigned apps.</p><form id="workspace-access-form" onSubmit={submit}>{sections.map(section => <div className="hub-field" key={section.id}><label htmlFor={`access-${section.id}`}>{section.label}</label><select id={`access-${section.id}`} value={grants[section.id]} disabled={busy} onChange={e => setGrants(current => ({ ...current, [section.id]: e.target.value as WorkspaceLevel | "default" }))}><option value="default">Role default · {accessLabel(member.defaultPermissions[section.id])}</option><option value="none">No access · hide workspace</option><option value="read">View only</option><option value="write">View & manage</option></select><small>{section.description}</small></div>)}</form><p className="ws-help">Admin functions continue to follow the existing staff role. Only an owner can change workspace permissions.</p></Modal>;
}

function AccountForm({ profile, onSaved, notify }: { profile: WorkspaceProfile; onSaved: () => void; notify: (message: string) => void }) {
  const [name, setName] = useState(profile.staff.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try { await apiRequest("/api/workspace/profile", { method: "PATCH", body: JSON.stringify({ displayName: name.trim() }) }); notify("Your profile has been updated."); onSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Your profile could not be saved."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit}><ErrorBanner error={error} /><div className="hub-field"><label htmlFor="profile-display-name">Display name</label><input id="profile-display-name" required maxLength={100} autoComplete="name" value={name} onChange={e => setName(e.target.value)} disabled={busy} /><small>This is how your name appears inside the company workspace.</small></div><div className="hub-field"><label htmlFor="profile-email">Sign-in email</label><input id="profile-email" value={profile.user.email} readOnly /></div><button type="submit" className="hub-button" disabled={busy || name.trim() === profile.staff.displayName}>{busy ? "Saving…" : "Save account details"}</button></form>;
}

export function ProfilePanel(props: PanelProps & { view?: string; onProfileSaved?: () => void }) {
  const view = props.view || "account";
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<WorkspaceStaffAccess | null>(null);
  const profile = useHubData<WorkspaceProfile>(props.preview ? null : "/api/workspace/profile", props.refreshKey + revision);
  const team = useHubData<{ members: WorkspaceStaffAccess[] }>(!props.preview && view === "team" && props.can("staff:write") ? "/api/workspace/access" : null, props.refreshKey + revision);
  const user = profile.data?.user as (WorkspaceProfile["user"] & { createdAt?: string; lastSignInAt?: string; emailVerified?: boolean; mfaEnabled?: boolean }) | undefined;
  function reload() { setRevision(value => value + 1); props.onProfileSaved?.(); }
  return <>
    <PageHeading kicker="Your Geofox workspace" title={view === "team" ? "The right access for each person." : view === "permissions" ? "Your workspace permissions." : "A space that’s yours."} description={view === "team" ? "Choose which company workspaces each staff member can see and manage." : "Your account information, security, and access, all in one place."} />
    <ErrorBanner error={profile.error || team.error} />
    {profile.loading || team.loading ? <Loading label="Loading account information…" /> : view === "team" ? <>
      {props.can("staff:write") ? <Card title="Company workspace access" subtitle="Owner accounts retain full access to every section and every app." action={<button className="hub-button secondary small" onClick={() => props.navigate("admin/settings")}><Icon name="users" size={13} />Invite & manage staff</button>}>
        {team.data?.members.length ? <div className="hub-table-wrap"><table className="hub-table"><thead><tr><th>Staff member</th><th>Role</th>{sections.map(section => <th key={section.id}>{section.label}</th>)}<th>Access</th></tr></thead><tbody>{team.data.members.map(member => <tr key={member.userId}><td><strong>{member.displayName}</strong><div className="ws-help">{member.active ? "Active" : "Disabled"}</div></td><td>{label(member.role)}</td>{sections.map(section => <td key={section.id}>{accessLabel(member.effectivePermissions[section.id].level)}<div className="ws-help">{member.effectivePermissions[section.id].companyLevel === "none" ? "Assigned apps" : "Company + assigned apps"}</div></td>)}<td>{member.role === "owner" ? <span className="hub-pill healthy">Full access</span> : <button className="hub-button secondary small" onClick={() => setSelected(member)}>Edit access</button>}</td></tr>)}</tbody></table></div> : <Empty icon="users" title={props.preview ? "Your team’s access lives here" : "No staff records available"} description="Invite staff through Admin → Connections & team, then assign their workspaces here." />}
      </Card> : <Empty icon="lock" title="Owner access required" description="Only the company owner can manage workspace permissions." />}
    </> : view === "permissions" ? <>
      <Card title={profile.data?.staff.role === "owner" ? "Owner · full company access" : `${label(profile.data?.staff.role || props.staffRole)} access`} subtitle={profile.data?.staff.role === "owner" ? "You can view and manage every workspace, including new registered apps." : "Your staff role and workspace assignments determine what is available."}><div className="hub-card-body"><p className="ws-help">Admin access follows your existing role. App records are limited to your assigned apps; company records require company permission.</p><div className="ws-permissions"><article className="ws-permission"><Icon name="grid" size={21} /><div><h3>Admin</h3><p>{props.can("overview:read") ? "Access to the admin sections included in your staff role." : "No admin sections assigned."}</p></div></article>{sections.map(section => <article className="ws-permission" key={section.id}><Icon name={section.icon} size={21} /><div><h3>{section.label}</h3><p>{accessLabel(profile.data?.effectivePermissions[section.id].level)} · app records<br />{accessLabel(profile.data?.effectivePermissions[section.id].companyLevel)} · company records</p></div></article>)}</div></div></Card>
      <Card title="Assigned apps" subtitle="Your permitted scope for app records." className="ws-app-access-card"><div className="hub-card-body"><p className="ws-help">{profile.data?.staff.role === "owner" ? "All registered apps, including apps you add in the future." : (profile.data?.apps || []).map(app => app.name).join(", ") || "No apps assigned."}</p></div></Card>
    </> : <div className="ws-profile-grid">
      <Card title="Account information" subtitle="Keep your workspace name up to date."><div className="ws-profile-hero"><span className="ws-profile-avatar"><Icon name="profile" size={27} /></span><div><h2>{profile.data?.staff.displayName || "Your Geofox account"}</h2><p>{profile.data?.user.email || "Sign in to view your account"}</p></div></div><div className="hub-card-body" style={{ paddingTop: 22 }}>{profile.data ? <AccountForm key={profile.data.staff.displayName} profile={profile.data} onSaved={reload} notify={props.notify} /> : <Empty icon="profile" title="Your account details appear here" description="Your profile and permissions are private to your staff session." />}</div></Card>
      <div className="ws-stack"><Card title="Security & access" subtitle="Your existing secure Geofox sign-in."><div className="hub-card-body"><dl className="ws-facts"><div><dt>Staff role</dt><dd>{label(profile.data?.staff.role || props.staffRole)}</dd></div><div><dt>Account ID</dt><dd>{profile.data?.user.id || "Available after sign-in"}</dd></div>{user?.createdAt ? <div><dt>Account created</dt><dd>{date(user.createdAt)}</dd></div> : null}{user?.lastSignInAt ? <div><dt>Last sign-in</dt><dd>{date(user.lastSignInAt)}</dd></div> : null}<div><dt>Email verification</dt><dd>{profile.data ? "Verified" : "Available after sign-in"}</dd></div></dl><div className="ws-actions" style={{ marginTop: 20 }}><a className="hub-button secondary small" href="/admin/security"><Icon name="shield" size={13} />Two-step verification</a><a className="hub-button secondary small" href="/admin/password">Change password</a></div></div></Card><Card title="Your permissions" subtitle="See which sections and apps you can use."><div className="hub-card-body"><p className="ws-help">{profile.data?.staff.role === "owner" ? "As owner, you have full access across Geofox and all registered apps." : "Your access is managed by the company owner."}</p><button className="hub-section-link" onClick={() => props.navigate("profile/permissions")}>View my permissions <Icon name="arrow" size={13} /></button></div></Card></div>
    </div>}
    {selected ? <AccessEditor member={selected} onClose={() => setSelected(null)} onSaved={reload} notify={props.notify} /> : null}
  </>;
}

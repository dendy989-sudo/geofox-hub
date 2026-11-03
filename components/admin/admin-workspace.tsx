"use client";

import { useEffect, useState } from "react";
import type { HubApp, HubBootstrap } from "@/lib/hub/types";
import { AppBadge, Empty, ErrorBanner, label, Loading, type PanelProps, useHubData } from "./common";
import { CustomersPanel } from "./customers";
import { ErrorsPanel } from "./errors";
import { GeofoxMark, Icon, type IconName } from "./icons";
import { ModerationPanel } from "./moderation";
import { OperationsPanel } from "./operations";
import { OverviewPanel } from "./overview";
import { SettingsPanel } from "./settings";
import { TicketsPanel } from "./tickets";
import "@/app/admin/admin.css";

const navigation: { id: string; label: string; icon: IconName; capability: string; group: "workspace" | "manage" }[] = [
  { id: "overview", label: "Overview", icon: "grid", capability: "overview:read", group: "workspace" },
  { id: "customers", label: "Customers", icon: "users", capability: "customers:read", group: "workspace" },
  { id: "tickets", label: "Support inbox", icon: "ticket", capability: "tickets:read", group: "workspace" },
  { id: "errors", label: "Errors & fixes", icon: "pulse", capability: "errors:read", group: "workspace" },
  { id: "moderation", label: "Moderation", icon: "shield", capability: "moderation:read", group: "workspace" },
  { id: "operations", label: "Operations", icon: "checklist", capability: "operations:read", group: "manage" },
  { id: "settings", label: "Connections & team", icon: "settings", capability: "settings:write", group: "manage" },
];
const previewApps: HubApp[] = [{ slug: "novanook", name: "NovaNook", color: "#8b5cf6", website: "https://www.mynovanook.com", configured: false }];

export function AdminWorkspace({ preview = false, initialAppId = "all" }: { preview?: boolean; initialAppId?: string }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const bootstrap = useHubData<HubBootstrap>(preview ? null : "/api/admin/bootstrap", refreshKey);
  const [tab, setTab] = useState("overview");
  const [app, setApp] = useState(initialAppId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const apps = preview ? previewApps : bootstrap.data?.apps || [];
  const can = (capability: string) => preview || Boolean(bootstrap.data?.capabilities.some((available) => available === capability));
  const allowedNavigation = navigation.filter((item) => can(item.capability));
  const current = allowedNavigation.find((item) => item.id === tab) || allowedNavigation[0];
  const currentApp = apps.some((item) => item.slug === app) ? app : "all";
  const displayName = preview ? "Workspace preview" : bootstrap.data?.staff.displayName || bootstrap.data?.user.email || "Staff workspace";
  const initials = preview ? "G" : displayName.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((name) => name[0]).join("").toUpperCase();

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 6000);
    return () => window.clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [menuOpen]);
  function navigate(id: string) {
    if (!allowedNavigation.some((item) => item.id === id)) { setToast("Your staff role does not include access to that section."); return; }
    setTab(id); setMenuOpen(false); window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function signOut() {
    if (preview || loggingOut) return;
    setLoggingOut(true); setLogoutError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("Sign-out could not be completed. Please try again.");
      window.location.assign("/admin/login");
    } catch (reason) { setLogoutError(reason instanceof Error ? reason.message : "Sign-out failed."); setLoggingOut(false); }
  }
  const props: PanelProps = { preview, app: currentApp, apps, refreshKey, staffRole: bootstrap.data?.staff.role, notify: setToast, can, navigate };
  const ready = preview || Boolean(bootstrap.data);
  const panels: Record<string, React.ReactNode> = ready ? {
    overview: <OverviewPanel key={`overview-${currentApp}`} {...props} />,
    customers: <CustomersPanel key={`customers-${currentApp}`} {...props} />,
    tickets: <TicketsPanel key={`tickets-${currentApp}`} {...props} />,
    errors: <ErrorsPanel key={`errors-${currentApp}`} {...props} />,
    moderation: <ModerationPanel key={`moderation-${currentApp}`} {...props} />,
    operations: <OperationsPanel key={`operations-${currentApp}`} {...props} />,
    settings: <SettingsPanel key="settings" {...props} />,
  } : {};

  return <div className="hub-root"><a className="hub-skip-link" href="#hub-content">Skip to workspace content</a>{menuOpen ? <button className="hub-sidebar-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /> : null}<aside id="hub-sidebar" className={`hub-sidebar ${menuOpen ? "is-open" : ""}`} aria-label="Workspace navigation"><a className="hub-logo" href="/" aria-label="Geofox home"><span className="hub-logo-mark"><GeofoxMark /></span><span>geofox <small>hub</small></span></a><button className="hub-mobile-close" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><Icon name="close" size={18} /></button><div className="hub-workspace-name">GEOFOX APPS LLC</div>{(["workspace", "manage"] as const).map((group) => allowedNavigation.some((item) => item.group === group) ? <div key={group}><div className="hub-nav-label">{group === "workspace" ? "Your workspace" : "Manage"}</div><nav className="hub-nav" aria-label={group === "workspace" ? "Workspace sections" : "Management sections"}>{allowedNavigation.filter((item) => item.group === group).map((item) => <button key={item.id} type="button" className={`hub-nav-button ${current?.id === item.id ? "active" : ""}`} aria-current={current?.id === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} size={17} />{item.label}</button>)}</nav></div> : null)}<div className="hub-sidebar-bottom"><div className="hub-side-note"><div className="hub-note-icon"><Icon name="layers" size={18} /></div><strong>A home for every app.</strong><p>One clear view of your company, with each app’s story kept distinct.</p></div><div className="hub-profile"><span className="hub-avatar">{initials || "G"}</span><div className="hub-profile-name"><strong title={displayName}>{displayName}</strong><span>{preview ? "No live data displayed" : label(bootstrap.data?.staff.role)}</span></div></div>{preview ? <a className="hub-signout" href="/admin/login"><Icon name="lock" size={14} />Staff sign-in <Icon name="arrow" size={12} /></a> : <button type="button" className="hub-signout" disabled={loggingOut} onClick={signOut}><Icon name="logout" size={14} />{loggingOut ? "Signing out…" : "Sign out"}</button>}</div></aside><div className="hub-main"><header className="hub-topbar"><button type="button" className="hub-icon-button hub-menu-button" aria-label="Open workspace navigation" aria-expanded={menuOpen} aria-controls="hub-sidebar" onClick={() => setMenuOpen(true)}><Icon name="menu" size={19} /></button><div className="hub-breadcrumb"><span>Control center</span><Icon name="chevron" size={12} style={{ transform: "rotate(-90deg)" }} /><strong>{current?.label || "Workspace"}</strong></div><div className="hub-topbar-actions"><div className="hub-scope"><Icon name={currentApp === "all" ? "layers" : "book"} size={15} /><label htmlFor="workspace-app">App scope</label><select id="workspace-app" aria-label="App scope" value={currentApp} onChange={(event) => setApp(event.target.value)} disabled={!ready}><option value="all">All apps</option>{apps.map((app) => <option key={app.slug} value={app.slug}>{app.name}</option>)}</select></div><button className="hub-icon-button" type="button" aria-label="Refresh workspace data" title={preview ? "Preview has no live data" : "Refresh workspace data"} disabled={bootstrap.loading} onClick={() => { if (preview) setToast("This preview contains no live data. Sign in to view connected sources."); else setRefreshKey((key) => key + 1); }}><Icon name="refresh" size={15} /></button><a href="/" className="hub-icon-button" aria-label="Open Geofox website" title="Geofox website"><Icon name="external" size={15} /></a></div></header><main id="hub-content" className="hub-content" tabIndex={-1}>{preview ? <div className="hub-banner"><Icon name="info" size={20} /><div><strong>Your control center, ready to connect.</strong><p>Interface preview · no live data or customer information. Explore the workspace; staff actions become available after secure setup.</p></div><div className="hub-banner-actions"><a href="/admin/login" className="hub-button small">Staff sign-in <Icon name="arrow" size={13} /></a></div></div> : null}{!preview && bootstrap.data?.setupIssues.length && current?.id !== "settings" ? <div className="hub-banner warning"><Icon name="info" size={19} /><div><strong>A few connections still need attention</strong><p>{bootstrap.data.setupIssues[0]}</p>{can("settings:write") ? <button className="hub-section-link" style={{ marginTop: 6 }} onClick={() => navigate("settings")}>Review connection setup <Icon name="arrow" size={12} /></button> : null}</div></div> : null}{currentApp !== "all" ? <div className="hub-current-app"><AppBadge slug={currentApp} apps={apps} /><span>App view · records and totals scoped to this app</span></div> : null}<ErrorBanner error={logoutError} />{bootstrap.loading ? <Loading label="Opening your secure workspace…" /> : bootstrap.error ? <><ErrorBanner error={bootstrap.error} /><div className="hub-controls"><a className="hub-button" href="/admin/login">Sign in again</a><button className="hub-button secondary" onClick={bootstrap.reload}>Try again</button></div></> : current ? panels[current.id] : ready ? <Empty icon="lock" title="No sections are assigned to this role" description="Ask an owner to review your role and app access." /> : null}<p className="hub-footer-note"><Icon name="lock" size={12} />GEOFOX APPS LLC · {preview ? "Interface preview" : "Secure staff workspace"} · Displayed times: Central Time unless marked UTC.</p></main></div>{toast ? <div className="hub-toast" role="status"><Icon name="info" size={17} /><span>{toast}</span><button className="hub-toast-close" type="button" aria-label="Dismiss notification" onClick={() => setToast("")}><Icon name="close" size={14} /></button></div> : null}</div>;
}

"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { HubApp, HubBootstrap } from "@/lib/hub/types";
import { AppBadge, Empty, ErrorBanner, label, Loading, type PanelProps, useHubData } from "./common";
import { CustomersPanel } from "./customers";
import { ErrorsPanel } from "./errors";
import { GeofoxMark, Icon, type IconName } from "./icons";
import { trapMobileMenuFocus } from "./mobile-menu-focus";
import { ModerationPanel } from "./moderation";
import { OperationsPanel } from "./operations";
import { OverviewPanel } from "./overview";
import { SettingsPanel } from "./settings";
import { TicketsPanel } from "./tickets";
import "@/app/admin/admin.css";
import "@/components/workspace/workspace.css";
import "@/components/workspace/navigation.css";
import "@/components/workspace/responsive-print.css";

const CostMonitorPanel = dynamic(() => import("@/components/costs/monitor").then(m => m.CostMonitorPanel), { loading: () => <Loading /> });
const CostAlertBanner = dynamic(() => import("@/components/costs/monitor").then(m => m.CostAlertBanner));
const OperationsWorkflowsPanel = dynamic(() => import("@/components/ops/operations").then(m => m.OperationsPanel), { loading: () => <Loading /> });
const AlfredPanel = dynamic(() => import("@/components/alfred/alfred").then((module) => module.AlfredPanel), { loading: () => <Loading /> });
const TasksPanel = dynamic(() => import("@/components/workspace/tasks").then((module) => module.TasksPanel), { loading: () => <Loading /> });
const MarketingPanel = dynamic(() => import("@/components/workspace/marketing").then((module) => module.MarketingPanel), { loading: () => <Loading /> });
const LegalPanel = dynamic(() => import("@/components/workspace/legal").then((module) => module.LegalPanel), { loading: () => <Loading /> });
const AccountingPanel = dynamic(() => import("@/components/workspace/accounting").then((module) => module.AccountingPanel), { loading: () => <Loading /> });
const ProfilePanel = dynamic(() => import("@/components/workspace/profile").then((module) => module.ProfilePanel), { loading: () => <Loading /> });

type Area = "alfred" | "admin" | "marketing" | "tasks" | "legal" | "accounting" | "profile";
interface NavItem { id: string; label: string; icon: IconName; capability?: string; group?: "manage"; }
const navigation: Record<Area, NavItem[]> = {
  alfred: [{ id: "command", label: "Command center", icon: "bolt" }, { id: "operations", label: "Workflows & connections", icon: "layers" }, { id: "approvals", label: "Approvals", icon: "checklist" }, { id: "activity", label: "Activity", icon: "clock" }, { id: "knowledge", label: "Knowledge", icon: "book" }, { id: "controls", label: "Controls", icon: "settings" }],
  admin: [
    { id: "overview", label: "Overview", icon: "grid", capability: "overview:read" },
    { id: "customers", label: "Customers", icon: "users", capability: "customers:read" },
    { id: "tickets", label: "Support inbox", icon: "ticket", capability: "tickets:read" },
    { id: "errors", label: "Errors & fixes", icon: "pulse", capability: "errors:read" },
    { id: "moderation", label: "Moderation", icon: "shield", capability: "moderation:read" },
    { id: "operations", label: "Operations", icon: "checklist", capability: "operations:read", group: "manage" },
    { id: "settings", label: "Connections & team", icon: "settings", capability: "settings:write", group: "manage" },
  ],
  marketing: [
    { id: "calendar", label: "Content calendar", icon: "calendar" },
    { id: "posts", label: "Posts & drafts", icon: "edit" },
    { id: "grid", label: "Grid preview", icon: "grid" },
    { id: "analytics", label: "Insights", icon: "chart" },
    { id: "inbox", label: "Social inbox", icon: "ticket" },
    { id: "accounts", label: "Social accounts", icon: "globe", group: "manage" },
  ],
  tasks: [
    { id: "board", label: "Task board", icon: "columns" },
    { id: "list", label: "All tasks", icon: "checklist" },
    { id: "calendar", label: "Planner calendar", icon: "calendar" },
    { id: "completed", label: "Completed", icon: "check" },
  ],
  legal: [
    { id: "upcoming", label: "Upcoming obligations", icon: "calendar" },
    { id: "register", label: "Compliance register", icon: "scales" },
    { id: "sources", label: "Starter checklist", icon: "book", group: "manage" },
  ],
  accounting: [
    { id: "costs", label: "Usage & bills", icon: "pulse" },
    { id: "provider_reports", label: "Provider billing reports", icon: "chart" },
    { id: "overview", label: "Money overview", icon: "wallet" },
    { id: "transactions", label: "Transactions", icon: "checklist" },
    { id: "reports", label: "Reports & export", icon: "chart" },
  ],
  profile: [
    { id: "account", label: "My account", icon: "profile" },
    { id: "permissions", label: "My permissions", icon: "lock" },
    { id: "team", label: "Workspace access", icon: "users", capability: "staff:write", group: "manage" },
  ],
};
const areas: { id: Area; label: string; icon: IconName }[] = [
  { id: "alfred", label: "Alfred", icon: "bolt" },
  { id: "admin", label: "Admin", icon: "grid" },
  { id: "marketing", label: "Marketing", icon: "megaphone" },
  { id: "tasks", label: "Tasks", icon: "checklist" },
  { id: "legal", label: "Legal", icon: "scales" },
  { id: "accounting", label: "Accounting", icon: "wallet" },
];
const areaNotes: Record<Area, { title: string; text: string }> = {
  alfred: { title: "Meet Alfred", text: "Private investigations, clear proposals, and owner-approved actions." },
  admin: { title: "A home for every app.", text: "Customers, support, and app health, together in one place." },
  marketing: { title: "Make room to create.", text: "Plan your content, preview your feed, and learn what connects." },
  tasks: { title: "A little more organized.", text: "Turn company plans into clear, manageable next steps." },
  legal: { title: "Keep the important dates.", text: "Track obligations, review changes, and keep supporting records." },
  accounting: { title: "Know where things stand.", text: "Keep income, expenses, and receipts organized across your apps." },
  profile: { title: "Your place in Geofox.", text: "Review your account, security, and workspace permissions." },
};
const previewApps: HubApp[] = [{ slug: "novanook", name: "NovaNook", color: "#8b5cf6", website: "https://www.mynovanook.com", configured: false }];

function readLocation(): { area: Area; tab: string } {
  const [area, tab] = window.location.hash.slice(1).split("/");
  if (Object.hasOwn(navigation, area)) return { area: area as Area, tab: tab || navigation[area as Area][0].id };
  return { area: "admin", tab: "overview" };
}

export function AdminWorkspace({ preview = false, initialAppId = "all" }: { preview?: boolean; initialAppId?: string }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const bootstrap = useHubData<HubBootstrap>(preview ? null : "/api/admin/bootstrap", refreshKey);
  const [route, setRoute] = useState<{ area: Area; tab: string }>({ area: "admin", tab: "overview" });
  const [app, setApp] = useState(initialAppId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const apps = preview ? previewApps : bootstrap.data?.apps || [];
  const can = (capability: string) => preview || Boolean(bootstrap.data?.capabilities.some((available) => available === capability));
  const visibleAreas = areas.filter((area) => {
    if (preview) return true;
    if (area.id === "alfred") return bootstrap.data?.staff.role === "owner";
    if (area.id === "admin") return navigation.admin.some((item) => item.capability && can(item.capability));
    if (area.id === "profile") return true;
    const companyAccess = bootstrap.data?.workspaceAccess?.[area.id].companyLevel;
    return can(`${area.id}:read`) && (apps.length > 0 || companyAccess === "read" || companyAccess === "write");
  });
  const activeArea = route.area === "profile" || visibleAreas.some((area) => area.id === route.area) ? route.area : visibleAreas[0]?.id || "profile";
  const allowedNavigation = navigation[activeArea].filter((item) => (!["costs","provider_reports"].includes(item.id) || preview || bootstrap.data?.staff.role === "owner") && (!item.capability || can(item.capability)));
  const current = allowedNavigation.find((item) => item.id === route.tab) || allowedNavigation[0];
  const isCompanyWorkspace = activeArea !== "admin" && activeArea !== "profile" && activeArea !== "alfred";
  const companyLevel = isCompanyWorkspace ? bootstrap.data?.workspaceAccess?.[activeArea].companyLevel : "none";
  const companyScopeAllowed = (activeArea === "alfred" && (preview || bootstrap.data?.staff.role === "owner")) || (isCompanyWorkspace && (preview || companyLevel === "read" || companyLevel === "write"));
  const currentApp = app === "company" && companyScopeAllowed ? "company" : apps.some((item) => item.slug === app) ? app : "all";
  const displayName = preview ? "Workspace preview" : bootstrap.data?.staff.displayName || bootstrap.data?.user.email || "Staff workspace";
  const initials = preview ? "G" : displayName.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((name) => name[0]).join("").toUpperCase();
  const ready = preview || Boolean(bootstrap.data);

  useEffect(() => {
    const update = () => { if (window.location.hash === "#hub-content") return; setRoute(readLocation()); setMenuOpen(false); };
    update(); window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 6000);
    return () => window.clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    document.getElementById("hub-sidebar")?.querySelector<HTMLButtonElement>(".hub-mobile-close")?.focus();
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); else trapMobileMenuFocus(event, "hub-sidebar"); };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [menuOpen]);

  function openArea(area: Area, tab = navigation[area][0].id) {
    if (area !== "profile" && !visibleAreas.some((item) => item.id === area)) { setToast("Your account does not have access to this workspace."); return; }
    if (!navigation[area].some((item) => item.id === tab && (!item.capability || can(item.capability)))) { setToast("Your staff role does not include this section."); return; }
    setRoute({ area, tab }); setMenuOpen(false); window.location.hash = `${area}/${tab}`;
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function navigate(id: string) {
    if (id.includes("/")) {
      const [area, tab] = id.split("/");
      if (Object.hasOwn(navigation, area)) openArea(area as Area, tab);
      return;
    }
    openArea(navigation[activeArea].some((item) => item.id === id) ? activeArea : "admin", id);
  }
  async function signOut() {
    if (preview) { window.location.assign("/admin/login"); return; }
    if (loggingOut) return;
    setLoggingOut(true); setLogoutError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("Sign-out could not be completed. Please try again.");
      window.location.assign("/admin/login");
    } catch (reason) { setLogoutError(reason instanceof Error ? reason.message : "Sign-out failed."); setLoggingOut(false); }
  }
  const scopedCan = (capability: string) => {
    if (!can(capability)) return false;
    if (preview || currentApp !== "company" || !isCompanyWorkspace) return true;
    const level = bootstrap.data?.workspaceAccess?.[activeArea].companyLevel;
    return level === "write" || (level === "read" && capability.endsWith(":read"));
  };
  const props: PanelProps = { preview, app: currentApp, apps, refreshKey, staffRole: bootstrap.data?.staff.role, workspaceAccess: bootstrap.data?.workspaceAccess, notify: setToast, can: scopedCan, navigate };
  function panel() {
    if (activeArea === "accounting" && current?.id === "provider_reports") return <OperationsWorkflowsPanel key="provider-billing" {...props} initialTab="billing" />;
    if (activeArea === "accounting" && current?.id === "costs") return <CostMonitorPanel key={`costs-${currentApp}`} {...props} />;
    if (activeArea === "alfred" && current?.id === "operations") return <OperationsWorkflowsPanel {...props} />;
    if (activeArea === "alfred") return <AlfredPanel key={`alfred-${currentApp}`} {...props} tab={current?.id || "command"} />;
    if (!current) return <Empty icon="lock" title="No sections are assigned" description="Ask an owner to review your workspace access." />;
    if (activeArea === "tasks") return <TasksPanel key={`tasks-${currentApp}`} {...props} view={current.id} />;
    if (activeArea === "marketing") return <MarketingPanel key={`marketing-${currentApp}`} {...props} view={current.id} />;
    if (activeArea === "legal") return <LegalPanel key={`legal-${currentApp}`} {...props} view={current.id} />;
    if (activeArea === "accounting") return <AccountingPanel key={`accounting-${currentApp}`} {...props} view={current.id} />;
    if (activeArea === "profile") return <ProfilePanel {...props} view={current.id} onProfileSaved={() => setRefreshKey((key) => key + 1)} />;
    switch (current.id) {
      case "overview": return <OverviewPanel key={`overview-${currentApp}`} {...props} />;
      case "customers": return <CustomersPanel key={`customers-${currentApp}`} {...props} />;
      case "tickets": return <TicketsPanel key={`tickets-${currentApp}`} {...props} />;
      case "errors": return <ErrorsPanel key={`errors-${currentApp}`} {...props} />;
      case "moderation": return <ModerationPanel key={`moderation-${currentApp}`} {...props} />;
      case "operations": return <OperationsPanel key={`operations-${currentApp}`} {...props} />;
      case "settings": return <SettingsPanel {...props} />;
      default: return null;
    }
  }

  return <div className="hub-root hub-company-root">
    <a className="hub-skip-link" href="#hub-content">Skip to workspace content</a>
    <nav className="hub-area-rail" aria-label="Company workspaces">
      <a className="hub-rail-brand" href="/" aria-label="Geofox home"><GeofoxMark /></a>
      <div className="hub-area-list">{visibleAreas.map((area) => <button key={area.id} type="button" className={`hub-area-button ${activeArea === area.id ? "active" : ""}`} aria-label={`${area.label} workspace`} aria-current={activeArea === area.id ? "page" : undefined} title={area.label} onClick={() => openArea(area.id)}><Icon name={area.icon} size={21} /><span>{area.label}</span></button>)}{!preview && bootstrap.data?.staff.role === "owner" ? <a className="hub-area-button" href="/finance" aria-label="Open private finance workspace" title="Private finance"><Icon name="coins" size={21} /><span>Finance</span></a> : null}</div>
      <div className="hub-area-bottom"><button type="button" className={`hub-area-button ${activeArea === "profile" ? "active" : ""}`} aria-label="My profile and permissions" aria-current={activeArea === "profile" ? "page" : undefined} title="Profile and permissions" onClick={() => openArea("profile")}><Icon name="profile" size={21} /><span>Profile</span></button><button type="button" className="hub-area-button hub-rail-signout" aria-label={preview ? "Staff sign-in" : "Sign out"} title={preview ? "Staff sign-in" : "Sign out"} disabled={loggingOut} onClick={signOut}><Icon name={preview ? "lock" : "logout"} size={20} /><span>{loggingOut ? "Signing out" : preview ? "Sign in" : "Sign out"}</span></button></div>
    </nav>
    {menuOpen ? <button className="hub-sidebar-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /> : null}
    <aside id="hub-sidebar" className={`hub-sidebar ${menuOpen ? "is-open" : ""}`} aria-label={`${label(activeArea)} navigation`}>
      <a className="hub-logo" href="/" aria-label="Geofox home"><span>geofox <small>hub</small></span></a>
      <button className="hub-mobile-close" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><Icon name="close" size={18} /></button>
      <div className="hub-workspace-name">GEOFOX APPS LLC</div>
      {([undefined, "manage"] as const).map((group) => allowedNavigation.some((item) => item.group === group) ? <div key={group || "workspace"}>
        <div className="hub-nav-label">{group === "manage" ? "Manage" : `${label(activeArea)} workspace`}</div>
        <nav className="hub-nav" aria-label={group === "manage" ? "Management sections" : `${label(activeArea)} sections`}>{allowedNavigation.filter((item) => item.group === group).map((item) => <button key={item.id} type="button" className={`hub-nav-button ${current?.id === item.id ? "active" : ""}`} aria-current={current?.id === item.id ? "page" : undefined} onClick={() => openArea(activeArea, item.id)}><Icon name={item.icon} size={17} />{item.label}</button>)}</nav>
      </div> : null)}
      <div className="hub-sidebar-bottom"><div className="hub-side-note"><div className="hub-note-icon"><Icon name="layers" size={18} /></div><strong>{areaNotes[activeArea].title}</strong><p>{areaNotes[activeArea].text}</p></div><button className="hub-profile hub-profile-link" type="button" onClick={() => openArea("profile")}><span className="hub-avatar">{initials || "G"}</span><span className="hub-profile-name"><strong title={displayName}>{displayName}</strong><span>{preview ? "Interface preview" : label(bootstrap.data?.staff.role)}</span></span><Icon name="chevron" size={13} /></button></div>
    </aside>
    <div className="hub-main" inert={menuOpen}>
      <header className="hub-topbar"><button type="button" className="hub-icon-button hub-menu-button" aria-label="Open workspace navigation" aria-expanded={menuOpen} aria-controls="hub-sidebar" onClick={() => setMenuOpen(true)}><Icon name="menu" size={19} /></button><div className="hub-breadcrumb"><span>{label(activeArea)}</span><Icon name="chevron" size={12} style={{ transform: "rotate(-90deg)" }} /><strong>{current?.label || "Workspace"}</strong></div><div className="hub-topbar-actions">{activeArea !== "profile" ? <div className="hub-scope"><Icon name={currentApp === "all" || currentApp === "company" ? "layers" : "book"} size={15} /><label htmlFor="workspace-app">Workspace scope</label><select id="workspace-app" aria-label="Workspace scope" value={currentApp} onChange={(event) => setApp(event.target.value)} disabled={!ready}><option value="all">{companyScopeAllowed ? "Company & all apps" : "All apps"}</option>{companyScopeAllowed ? <option value="company">Geofox company</option> : null}{apps.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></div> : null}<button className="hub-icon-button" type="button" aria-label="Print this page" title="Print this page" onClick={() => window.print()}><Icon name="printer" size={15} /></button><button className="hub-icon-button" type="button" aria-label="Refresh workspace data" title="Refresh workspace data" disabled={bootstrap.loading} onClick={() => { if (preview) setToast("Sign in to view saved workspace data."); else setRefreshKey((key) => key + 1); }}><Icon name="refresh" size={15} /></button><a href="/" className="hub-icon-button" aria-label="Open Geofox website" title="Geofox website"><Icon name="external" size={15} /></a></div></header>
      <main id="hub-content" className="hub-content" tabIndex={-1}><div className="hub-print-context">Geofox Hub · {label(activeArea)} · {current?.label || "Workspace"} · {currentApp === "all" ? "All permitted records" : currentApp === "company" ? "Geofox company" : apps.find(item => item.slug === currentApp)?.name || currentApp}</div>
        {preview ? <div className="hub-banner"><Icon name="info" size={20} /><div><strong>Your company, together in one place.</strong><p>Interface preview · sign in to use your saved tasks, content, compliance records, and books.</p></div><div className="hub-banner-actions"><a href="/admin/login" className="hub-button small">Staff sign-in <Icon name="arrow" size={13} /></a></div></div> : null}
        {!preview && Boolean(bootstrap.data?.setupIssues.length) && activeArea === "admin" && current?.id !== "settings" ? <div className="hub-banner warning"><Icon name="info" size={19} /><div><strong>A few connections still need attention</strong><p>{bootstrap.data?.setupIssues[0]}</p>{can("settings:write") ? <button className="hub-section-link" style={{ marginTop: 6 }} onClick={() => navigate("settings")}>Review connection setup <Icon name="arrow" size={12} /></button> : null}</div></div> : null}
        {currentApp !== "all" && activeArea !== "profile" ? <div className="hub-current-app">{currentApp === "company" ? <span className="hub-app-badge"><Icon name="layers" size={12} />Geofox company</span> : <AppBadge slug={currentApp} apps={apps} />}<span>{currentApp === "company" ? "Company records across your business" : "Records and totals scoped to this app"}</span></div> : null}
        {!preview && bootstrap.data?.staff.role === "owner" && !(activeArea === "accounting" && current?.id === "costs") ? <CostAlertBanner navigate={navigate} /> : null}
        <ErrorBanner error={logoutError} />
        {bootstrap.loading ? <Loading label="Opening your secure workspace…" /> : bootstrap.error ? <><ErrorBanner error={bootstrap.error} /><div className="hub-controls"><a className="hub-button" href="/admin/login">Sign in again</a><button className="hub-button secondary" onClick={bootstrap.reload}>Try again</button></div></> : ready ? panel() : null}
        <p className="hub-footer-note"><Icon name="lock" size={12} />GEOFOX APPS LLC · {preview ? "Interface preview" : "Secure company workspace"} · Central Time unless marked otherwise.</p>
      </main>
    </div>
    {toast ? <div className="hub-toast" role="status"><Icon name="info" size={17} /><span>{toast}</span><button className="hub-toast-close" type="button" aria-label="Dismiss notification" onClick={() => setToast("")}><Icon name="close" size={14} /></button></div> : null}
  </div>;
}

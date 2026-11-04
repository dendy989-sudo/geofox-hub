"use client";

import { useEffect, useState } from "react";
import type { OverviewData, OverviewMetrics, ServiceStatus } from "@/lib/hub/types";
import { apiRequest, AppBadge, Card, count, date, Empty, ErrorBanner, healthLabel, Metric, money, Notes, PageHeading, type PanelProps, useHubData } from "./common";
import { Icon, type IconName } from "./icons";
import { isbnOutcomeLabel } from "@/lib/integrations/isbn-reporting";
import { currentErrorCollectionStatus, errorCollectionLabel } from "@/lib/integrations/error-collection-status";

const emptyMetrics: OverviewMetrics = { usersTotal: null, freeUsers: null, paidUsers: null, adultFree: null, adultPaid: null, teenFree: null, teenPaid: null, unknownAge: null, booksTotal: null, searchesPeriod: null, isbnCallsToday: null, revenuePeriod: null, openTickets: null, openErrors: null, pendingModeration: null };

const unknownServices: ServiceStatus[] = [
  { id: "website", appSlug: "novanook", name: "App website", status: "unknown", detail: "No health check loaded", latencyMs: null, checkedAt: null },
  { id: "database", appSlug: "novanook", name: "Database", status: "unknown", detail: "Awaiting a verified connection", latencyMs: null, checkedAt: null },
  { id: "books", appSlug: "novanook", name: "Book lookups", status: "unknown", detail: "Usage monitoring not connected", latencyMs: null, checkedAt: null },
  { id: "billing", appSlug: "novanook", name: "Billing", status: "unknown", detail: "Payment source not connected", latencyMs: null, checkedAt: null },
];

export function ServiceGrid({ services, apps, onChecked }: { services: ServiceStatus[]; apps: PanelProps["apps"]; onChecked?: () => void }) {
  return <div className="hub-services">{services.map((service, index) => <ServiceCard key={`${service.appSlug}-${service.id}`} initial={service} apps={apps} index={index} onChecked={onChecked} />)}</div>;
}

function ServiceCard({ initial, apps, index, onChecked }: { initial: ServiceStatus; apps: PanelProps["apps"]; index: number; onChecked?: () => void }) {
  const [checked, setChecked] = useState<{ value: ServiceStatus; source: ServiceStatus } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now);
  const received = checked && (checked.source === initial || Date.parse(checked.value.checkedAt || "") >= Date.parse(initial.checkedAt || "1970-01-01")) ? checked.value : initial;
  const service = currentErrorCollectionStatus(received, clock);
  const collection = service.errorCollection;
  const nextCheckAt = Date.parse(collection?.nextCheckAt || "");
  const expiresAt = Date.parse(received.checkedAt || "") + (received.errorCollection?.state === "checking" ? 30_000 : received.errorCollection?.state === "connected" ? 300_001 : NaN);
  useEffect(() => {
    const future = [nextCheckAt, expiresAt].filter(value => Number.isFinite(value) && value > clock);
    if (!future.length) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.max(0, Math.min(...future) - Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [nextCheckAt, expiresAt, clock]);
  const pendingAt = received.errorCollection?.state === "checking" ? Date.parse(received.checkedAt || "") : NaN;
  useEffect(() => {
    if (!onChecked || !Number.isFinite(pendingAt)) return;
    // Another staff session may have claimed the same check. Refresh at most
    // three times within its original window; never poll indefinitely.
    const next = [10_000, 22_000, 30_500].map(offset => pendingAt + offset).find(value => value > Date.now());
    if (next === undefined) return;
    const timer = setTimeout(onChecked, Math.max(0, next - Date.now()));
    return () => clearTimeout(timer);
  }, [pendingAt, onChecked]);
  async function checkConnection() {
    if (busy || !collection?.canCheck) return;
    setBusy(true); setError("");
    try {
      const result = await apiRequest<ServiceStatus>("/api/admin/operations/error-collection/check", { method: "POST", body: JSON.stringify({ app: service.appSlug }) });
      setChecked({ value: result, source: initial }); setClock(Date.now()); onChecked?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The connection check could not be completed."); }
    finally { setBusy(false); }
  }
  const stateLabel = collection ? errorCollectionLabel(collection.state) : healthLabel(service.status);
  return <article className="hub-service">
    <div className="hub-service-heading"><span className="hub-service-name"><Icon name={service.id === "isbn" ? "book" : service.id === "errors" ? "pulse" : (["globe", "layers", "book", "coins"] as IconName[])[index % 4]} size={17} />{service.name}</span><span className={`hub-dot ${service.status}`} title={stateLabel} /></div>
    <div className={`hub-service-state ${service.status}`} aria-live={collection ? "polite" : undefined}>{busy ? "Checking connection…" : stateLabel}{!busy && service.latencyMs !== null ? ` · ${service.latencyMs} ms` : ""}</div>
    <div className="hub-service-note">{service.detail}</div>
    {service.checkedAt ? <div className="hub-service-note">{service.id === "isbn" ? "Observed" : "Checked"} {date(service.checkedAt)}</div> : null}
    {service.isbn ? <IsbnRequestDetails report={service.isbn} /> : null}
    {collection ? <>
      {collection.lastSuccessAt && collection.lastSuccessAt !== service.checkedAt ? <div className="hub-service-note">Last connected {date(collection.lastSuccessAt)}</div> : null}
      {collection.lastErrorAt ? <div className="hub-service-note">Last real error received {date(collection.lastErrorAt)}</div> : null}
      <div className="hub-service-note">Covers selected catalog, subscription verification, and safety notification server errors. Browser and native crashes are not included.</div>
      {collection.canCheck ? <div style={{ marginTop: 12 }}><button className="hub-button secondary small" type="button" disabled={busy || nextCheckAt > clock} onClick={checkConnection}><Icon name="refresh" size={13} />{busy ? "Checking…" : "Check connection"}</button>{!busy && nextCheckAt > clock ? <div className="hub-service-note" style={{ marginTop: 6 }}>You can check again in a minute.</div> : null}</div> : null}
      {error ? <p role="alert" className="hub-service-note">{error}</p> : null}
    </> : null}
    {apps.length > 1 ? <div style={{ marginTop: 9 }}><AppBadge slug={service.appSlug} apps={apps} /></div> : null}
  </article>;
}

function IsbnRequestDetails({ report }: { report: NonNullable<ServiceStatus["isbn"]> }) {
  return <div className="hub-provider-details">
    <strong className="hub-provider-caption">Recorded requests today · UTC</strong>
    <dl className="hub-provider-counts">
      <div><dt>Requests</dt><dd>{count(report.today.requests)}</dd></div>
      <div><dt>Successful</dt><dd>{count(report.today.successes)}</dd></div>
      <div><dt>No match</dt><dd>{count(report.today.notFound)}</dd></div>
      <div><dt>Errors</dt><dd>{count(report.today.failures)}</dd></div>
    </dl>
    {report.today.rateLimited > 0 ? <p className="hub-service-note">{count(report.today.rateLimited)} error(s) were rate limits.</p> : null}
    <p className="hub-service-note">Last valid response: {report.lastSuccessAt ? date(report.lastSuccessAt) : "Awaiting first response"}</p>
    <p className="hub-service-note">Last error: {report.lastFailure ? <>{isbnOutcomeLabel[report.lastFailure.outcome]}{report.lastFailure.httpStatus ? ` (HTTP ${report.lastFailure.httpStatus})` : ""} · {date(report.lastFailure.observedAt)}</> : "None recorded"}</p>
    {report.daily.length > 1 ? <details className="hub-provider-history"><summary>Daily request history</summary><div className="hub-provider-history-scroll"><table aria-label="Recorded ISBNdb requests by UTC day"><thead><tr><th scope="col">Day (UTC)</th><th scope="col">Requests</th><th scope="col">Errors</th></tr></thead><tbody>{[...report.daily].sort((a, b) => b.date.localeCompare(a.date)).map(day => <tr key={day.date}><th scope="row">{day.date}</th><td>{count(day.requests)}</td><td>{count(day.failures)}</td></tr>)}</tbody></table></div></details> : null}
    <p className="hub-service-note">Collection started {date(report.collectedSince)}. Cached books are excluded.</p>
  </div>;
}

function total(...values: (number | null)[]) { return values.some((value) => value === null) ? null : values.reduce<number>((sum, value) => sum + (value || 0), 0); }

export function OverviewPanel(props: PanelProps) {
  const { data, error, loading, reload } = useHubData<OverviewData>(props.preview ? null : `/api/admin/overview?app=${encodeURIComponent(props.app)}`, props.refreshKey);
  const metrics = data?.metrics || emptyMetrics;
  const scopedApps = props.app === "all" ? props.apps : props.apps.filter((app) => app.slug === props.app);
  const services = data?.services?.length ? data.services : scopedApps.flatMap((app) => unknownServices.map((service) => ({ ...service, appSlug: app.slug })));
  const connected = data?.coverage.connected;
  const totalApps = data?.coverage.total;
  const issueCount = data?.services.filter((service) => ["down", "degraded"].includes(service.status)).length;
  const allMeasured = Boolean(data?.services.length && data.services.every((service) => service.status === "healthy"));
  const trend = data?.trend.filter((point) => typeof point.users === "number") || [];
  const max = Math.max(1, ...trend.map((point) => point.users || 0));
  const attention = [...(data?.attention || [])].sort((a, b) => ({ critical: 0, warning: 1, info: 2 })[a.severity] - ({ critical: 0, warning: 1, info: 2 })[b.severity]);
  const points = trend.map((point, index) => `${(index / Math.max(1, trend.length - 1)) * 620},${140 - ((point.users || 0) / max) * 115}`).join(" ");

  return <>
    <PageHeading kicker="YOUR WORKSPACE, AT A GLANCE" title="A clear view of everything." description="Your apps, your customers, and the things that need your attention." />
    <ErrorBanner error={error} />
    <div className="hub-status-strip"><span className={`hub-dot ${allMeasured ? "healthy" : issueCount ? "degraded" : "unknown"}`} /><strong>{loading ? "Checking your sources…" : allMeasured ? "All measured services are operational" : issueCount ? `${issueCount} service${issueCount === 1 ? " needs" : "s need"} attention` : "Waiting for verified service data"}</strong><span>·</span><span>{connected === undefined ? "Sources not connected" : `${connected} of ${totalApps} app sources connected`}</span><span className="hub-last-updated">{data?.updatedAt ? `Updated ${date(data.updatedAt)}` : "Live values appear after setup"}</span></div>
    {data?.coverage.missing.length ? <div className="hub-banner warning"><Icon name="info" size={18} /><div><strong>Some app data is unavailable</strong><p>Complete totals are unavailable while a selected app source is missing. Missing: {data.coverage.missing.join(", ")}.</p></div></div> : null}
    <div className="hub-metrics-grid">
      <Metric title="Total customers" value={count(metrics.usersTotal)} detail="Accounts in the selected apps" icon="users" />
      <Metric title="Verified Pro access" value={count(metrics.paidUsers)} detail="Includes verified trials / promotions" icon="shield" tone="cyan" />
      <Metric title="Current saved books" value={count(metrics.booksTotal)} detail="Books currently in customer libraries" icon="book" tone="orange" />
      <Metric title="Recorded revenue" value={money(metrics.revenuePeriod, data?.currency)} detail={data?.period.label || "Actual payments only · no estimates"} icon="coins" tone="green" />
    </div>
    <div className="hub-overview-grid">
      <Card title="Your customer community" subtitle="Age band and verified current access" action={<Icon name="users" size={16} />}><div className="hub-card-body"><table className="hub-membership-table"><thead><tr><th scope="col">Customers</th><th scope="col">Free</th><th scope="col">Pro access</th><th scope="col">Total</th></tr></thead><tbody><tr><td><span className="hub-member-label"><span className="hub-square" />Adults · 18+</span></td><td>{count(metrics.adultFree)}</td><td>{count(metrics.adultPaid)}</td><td className="hub-table-total">{count(total(metrics.adultFree, metrics.adultPaid))}</td></tr><tr><td><span className="hub-member-label"><span className="hub-square cyan" />Teens · 13–17</span></td><td>{count(metrics.teenFree)}</td><td>{count(metrics.teenPaid)}</td><td className="hub-table-total">{count(total(metrics.teenFree, metrics.teenPaid))}</td></tr><tr><td><span className="hub-member-label"><span className="hub-square gray" />Age unavailable</span></td><td>—</td><td>—</td><td className="hub-table-total">{count(metrics.unknownAge)}</td></tr></tbody><tfoot><tr><td>All customers</td><td>{count(metrics.freeUsers)}</td><td>{count(metrics.paidUsers)}</td><td className="hub-table-total">{count(metrics.usersTotal)}</td></tr></tfoot></table><p className="hub-footnote">Only age bands are shown. Missing information stays unknown, and a dash never means zero.</p></div></Card>
      <Card title="Usage & activity" subtitle={data ? `${data.period.label} · ${data.period.timezone}` : "Ready for your first connected source"} action={<Icon name="bolt" size={16} />}><div className="hub-card-body"><div className="hub-usage-list"><div className="hub-usage-row"><span className="hub-usage-icon"><Icon name="search" size={17} /></span><div className="hub-usage-label"><strong>Search reservations</strong><span>This UTC calendar month · recorded quota use</span></div><span className="hub-usage-number">{count(metrics.searchesPeriod)}</span></div><div className="hub-usage-row"><span className="hub-usage-icon cyan"><Icon name="book" size={17} /></span><div className="hub-usage-label"><strong>ISBNdb requests</strong><span>Today UTC · recorded calls, including errors</span></div><span className="hub-usage-number">{count(metrics.isbnCallsToday)}</span></div><div className="hub-usage-row"><span className="hub-usage-icon orange"><Icon name="pulse" size={17} /></span><div className="hub-usage-label"><strong>Open error groups</strong><span>Review in Errors & fixes</span></div><span className="hub-usage-number">{count(metrics.openErrors)}</span></div></div></div></Card>
    </div>
    <Card className="hub-standalone-card" title="System health" subtitle="Green means a successful check. Gray means we don’t know yet." action={<button className="hub-section-link" onClick={() => props.navigate("operations")}>View operations <Icon name="arrow" size={13} /></button>}><ServiceGrid services={services} apps={props.apps} onChecked={reload} /></Card>
    <div className="hub-bottom-grid">
      <Card title="New accounts" subtitle="Actual account creation over time" action={<span className="hub-pill">{data?.period.label || "No source yet"}</span>}><div className="hub-card-body">{trend.length > 1 ? <><svg className="hub-chart" viewBox="0 0 620 155" role="img" aria-label={`New accounts: ${trend.map((point) => `${point.date}: ${point.users}`).join("; ")}`} preserveAspectRatio="none"><defs><linearGradient id="hub-search-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9985dc" stopOpacity=".18" /><stop offset="1" stopColor="#9985dc" stopOpacity="0" /></linearGradient></defs>{[25, 65, 105, 145].map((y) => <line key={y} x1="0" x2="620" y1={y} y2={y} stroke="#eff2f8" />)}<polygon points={`0,150 ${points} 620,150`} fill="url(#hub-search-fill)" /><polyline points={points} stroke="#9a83d8" strokeWidth="2.5" fill="none" strokeLinejoin="round" /></svg><div className="hub-chart-labels"><span>{date(trend[0].date.slice(0, 10), true)}</span><span>{date(trend[trend.length - 1].date.slice(0, 10), true)}</span></div></> : <div className="hub-chart-empty"><span>Activity will appear as real events are recorded</span></div>}<div className="hub-chart-legend"><span><span className="hub-square" />New accounts</span><span>Historical data is never estimated</span></div></div></Card>
      <Card title="Your attention, where it matters" subtitle="A small list of the next useful actions" action={<Icon name="alert" size={16} />}>{data?.attention.length ? <div className="hub-card-body">{attention.slice(0, 4).map((item) => <div className="hub-attention-row" key={item.id}><Icon name={item.severity === "critical" ? "alert" : "info"} size={16} /><div><strong>{item.title}</strong><p>{item.description}</p>{item.appSlug ? <div style={{ marginTop: 7 }}><AppBadge slug={item.appSlug} apps={props.apps} /></div> : null}{item.tab ? <button className="hub-section-link" style={{ marginTop: 7 }} onClick={() => props.navigate(item.tab!)}>Review <Icon name="arrow" size={12} /></button> : null}</div></div>)}</div> : <Empty icon="checklist" title={data ? "No attention items returned" : "Your next steps will live here"} description={data ? "Continue your daily review in Operations." : "Connect your app to surface service issues, urgent tickets, and moderation reports."} />}</Card>
    </div>
    <div className="hub-controls" style={{ marginTop: 22 }}><button className="hub-button secondary" onClick={() => props.navigate("tickets")}><Icon name="ticket" size={15} />Support tickets {count(metrics.openTickets)}</button><button className="hub-button secondary" onClick={() => props.navigate("moderation")}><Icon name="shield" size={15} />Moderation queue {count(metrics.pendingModeration)}</button><button className="hub-button secondary" onClick={() => props.navigate("operations")}><Icon name="checklist" size={15} />Daily review</button></div>
    <Notes notes={data?.notes} />
  </>;
}

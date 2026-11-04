import "server-only";
import { allowedAppSlugs, assertCapability, databaseError, getHubService, HubError, type HubContext } from "@/lib/hub/server";
import { listAudit, listErrors, listReviewTasks, listTickets, recordAudit } from "@/lib/hub/data";
import type { AttentionItem, ConnectionInfo, CustomerRecord, IsbnProviderReport, OperationsData, OverviewData, OverviewMetrics, PaymentRecord, ServiceStatus, TrendPoint } from "@/lib/hub/types";
import { novaConfigured, novaCustomer, novaIsbnOverview, novaOverview, type NovaOverview } from "./novanook";
import { vercelHealth, websiteHealth } from "./health";
import { supportEmailSettings } from "./email-config";
import { isbnCallsToday, isbnServiceStatus } from "./isbn-reporting";

interface Summary {
  openTickets: number; openErrors: number;
  paymentTotals: { appSlug: string; currency: string | null; amountMinor: number | null; count: number }[];
  ingestion: { appSlug: string; kind: string; lastAt: string }[];
  dailyErrors: { date: string; count: number }[];
}
export function majorAmount(minor: number | null, currency: string | null): number | null {
  if (minor === null || !Number.isSafeInteger(Number(minor)) || !currency || !/^[A-Z]{3}$/.test(currency)) return null;
  try { return Number(minor) / (10 ** (new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2)); }
  catch { return null; }
}

function period() {
  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 29));
  return { label: "Last 30 calendar days", start: start.toISOString(), end: end.toISOString(), timezone: "UTC" };
}

export function integrationInfo(context: HubContext): ConnectionInfo[] {
  return [
    { id: "hub", name: "Geofox staff & support", state: "connected", description: "Your sign-in, staff membership and app access were verified for this request.", required: true },
    ...context.apps.map(app => ({ id: `app-${app.slug}`, name: `${app.name} data bridge`, state: (app.slug === "novanook" && novaConfigured() ? "connected" : "missing") as ConnectionInfo["state"], description: app.slug === "novanook" ? "Credentials configured here do not prove connectivity. Operations runs the actual bridge check." : "Tickets and app access are available. Add a data adapter before showing customer and account totals.", required: true })),
    ...context.apps.map(app => ({ id: `telemetry-${app.slug}`, name: `${app.name} error collection`, state: (process.env[`${app.slug.replaceAll("-", "_").toUpperCase()}_HUB_INGEST_SECRET`] ? "connected" : "missing") as ConnectionInfo["state"], description: "The hub receiver needs a signing secret; the source app must also deploy its matching reporter settings. A first accepted error confirms delivery. No errors received does not establish app health.", required: false })),
    { id: "email", name: "Customer reply email", state: process.env.RESEND_API_KEY && supportEmailSettings() ? "connected" : "missing", description: "Optional for in-app conversations. Public-form email replies need a verified support sender and Resend key. Replies go to support@geofoxapps.com. Set RESEND_API_KEY and SUPPORT_FROM_EMAIL in Geofox hosting, then redeploy. Incoming mailbox replies are not imported automatically.", required: false },
    { id: "vercel", name: "Vercel deployment check", state: process.env.VERCEL_ACCESS_TOKEN && process.env.HUB_VERCEL_PROJECT_ID ? "connected" : "missing", description: "The hub makes read-only deployment requests using VERCEL_ACCESS_TOKEN and the configured team/project IDs. ChatGPT’s Vercel connection does not supply this runtime token. Provider bills and full runtime logs need separate data sources.", required: false },
  ];
}

export async function loadOverview(context: HubContext, requestedApp: string | null = null): Promise<OverviewData> {
  assertCapability(context, "overview:read");
  const slugs = allowedAppSlugs(context, requestedApp);
  if (!slugs.length) throw new HubError(403, "APP_ACCESS_REQUIRED", "Ask the owner to assign an app to this staff account before loading its dashboard.");
  const apps = context.apps.filter(app => slugs.includes(app.slug));
  const range = period();
  const summaryResult = await getHubService().rpc("hub_reporting_summary", { p_apps: slugs, p_start: range.start, p_end: range.end });
  if (summaryResult.error) databaseError(summaryResult.error);
  const summary = summaryResult.data as Summary;
  if (!summary) throw new HubError(503, "REPORTING_UNAVAILABLE", "Reporting could not be loaded.");
  const sources = await Promise.all(apps.map(async app => {
    const start = Date.now();
    const webChecks = Promise.all([websiteHealth(app), vercelHealth(app.slug, app.name)]);
    let data: NovaOverview | null = null;
    let databaseLatency: number | null = null;
    let isbn: IsbnProviderReport | null = null;
    let isbnMessage = "ISBNdb request reporting is not connected for this app.";
    let message = "A customer data adapter is not connected for this app.";
    let configured = false;
    if (app.slug === "novanook") {
      configured = novaConfigured();
      const accountRead = novaOverview(context).then(result => { databaseLatency = Date.now() - start; return result; });
      const [accountResult, isbnResult] = await Promise.allSettled([accountRead, novaIsbnOverview(context)]);
      if (accountResult.status === "fulfilled") data = accountResult.value;
      else message = accountResult.reason instanceof HubError ? accountResult.reason.message : "The app’s data check could not be completed.";
      if (isbnResult.status === "fulfilled") isbn = isbnResult.value;
      else isbnMessage = "ISBNdb request reporting could not be read. Check the reporting migration and database connection. Other account totals are independent of this check.";
    }
    const [website, deployment] = await webChecks;
    const checkedAt = new Date().toISOString();
    const services: ServiceStatus[] = [website, { id: "database", appSlug: app.slug, name: `${app.name} database bridge`, status: data ? "healthy" : configured ? "degraded" : "unknown", detail: data ? "The account and operations summary was read successfully." : message, latencyMs: databaseLatency, checkedAt: configured ? checkedAt : null }, deployment];
    services.push(isbnServiceStatus(app.slug, isbn, data?.operations.blockedUntil ?? null, isbnMessage));
    services.push({ id: "billing", appSlug: app.slug, name: "Billing collection", status: "unknown", detail: summary.ingestion.some(row => row.appSlug === app.slug && row.kind === "payment") ? "Payment events have been recorded. Provider receipt verification and financial reconciliation are checked separately." : "A verified transaction feed has not delivered payment events to Geofox. Subscription access is available separately; access alone is not a payment, and adding billing credentials does not import transaction history.", latencyMs: null, checkedAt: null });
    const errorEvent = summary.ingestion.find(row => row.appSlug === app.slug && row.kind === "error");
    const receiverConfigured = Boolean(process.env[`${app.slug.replaceAll("-", "_").toUpperCase()}_HUB_INGEST_SECRET`]);
    services.push({ id: "errors", appSlug: app.slug, name: "Application error collection", status: "unknown", detail: errorEvent ? `Latest accepted error: ${errorEvent.lastAt}. This confirms a past delivery, not continuous reporter or application health.` : receiverConfigured ? "The hub receiver is configured; no application error has arrived yet. The source reporter must be deployed with its matching settings. A quiet error feed is not a failed health check." : "The hub receiver is not configured. Add the app’s signing secret and deploy its server reporter to begin collection.", latencyMs: null, checkedAt: null });
    return { app, data, isbn, services, message };
  }));
  const complete = sources.length > 0 && sources.every(source => source.data !== null);
  const sum = (read: (data: NovaOverview) => number): number | null => {
    if (!complete) return null;
    const values = sources.map(source => read(source.data!));
    const total = values.reduce((a, b) => a + b, 0);
    return values.every(value => Number.isFinite(value) && value >= 0) && Number.isSafeInteger(total) ? total : null;
  };
  const currency = /^[A-Z]{3}$/.test(process.env.HUB_REVENUE_CURRENCY || "") ? process.env.HUB_REVENUE_CURRENCY! : "USD";
  const payments = summary.paymentTotals || [];
  const revenueComplete = slugs.length > 0 && slugs.every(slug => payments.some(row => row.appSlug === slug)) && payments.every(row => row.currency === currency && row.amountMinor !== null);
  const revenue = revenueComplete ? majorAmount(payments.reduce((total, row) => total + Number(row.amountMinor), 0), currency) : null;
  const metrics: OverviewMetrics = {
    usersTotal: sum(data => data.users.total), freeUsers: sum(data => data.users.free), paidUsers: sum(data => data.users.pro),
    adultFree: sum(data => data.users.adultFree), adultPaid: sum(data => data.users.adultPro), teenFree: sum(data => data.users.teenFree), teenPaid: sum(data => data.users.teenPro), unknownAge: sum(data => data.users.unknownAgeFree + data.users.unknownAgePro),
    booksTotal: sum(data => data.usage.libraryBooks), searchesPeriod: sum(data => data.usage.searchReservationsMonth), isbnCallsToday: isbnCallsToday(sources.map(source => source.isbn)), revenuePeriod: revenue,
    openTickets: Number(summary.openTickets), openErrors: Number(summary.openErrors), pendingModeration: sum(data => data.operations.openReports + data.operations.reviewingReports),
  };
  const trend: TrendPoint[] = [];
  for (let index = 0; index < 30; index++) {
    const date = new Date(Date.parse(range.start) + index * 86400_000).toISOString().slice(0, 10);
    trend.push({ date, users: sum(data => data.dailySignups.find(day => day.date === date)?.count ?? NaN), searches: null, revenue: null, errors: summary.ingestion.some(row => row.kind === "error") ? Number(summary.dailyErrors.find(day => day.date === date)?.count || 0) : null });
  }
  const attention: AttentionItem[] = [];
  for (const source of sources) {
    if (!source.data) attention.push({ id: `connect-${source.app.slug}`, title: `${source.app.name} data needs connection`, description: source.message, severity: "info", appSlug: source.app.slug, tab: "operations" });
    if (source.data?.operations.childSafetyReports) attention.push({ id: `safety-${source.app.slug}`, title: `${source.data.operations.childSafetyReports} safety report(s) need priority review`, description: "Review the reported context and existing safety workflow. A report is not a confirmed violation.", severity: "critical", appSlug: source.app.slug, tab: "moderation" });
    if (source.data?.operations.failedAlerts) attention.push({ id: `alerts-${source.app.slug}`, title: "Safety notifications need attention", description: `${source.data.operations.failedAlerts} undelivered notification(s) have a recorded delivery failure.`, severity: "critical", appSlug: source.app.slug, tab: "moderation" });
    if (source.data?.operations.pendingDeletions) attention.push({ id: `deletions-${source.app.slug}`, title: "Account deletion work is pending", description: `${source.data.operations.pendingDeletions} request(s) are not complete. Review them in NovaNook’s existing account-deletion tools.`, severity: "warning", appSlug: source.app.slug, tab: "operations" });
    for (const service of source.services.filter(service => ["down", "degraded"].includes(service.status))) attention.push({ id: `${source.app.slug}-${service.id}`, title: `${service.name} needs a check`, description: service.detail, severity: service.status === "down" ? "critical" : "warning", appSlug: source.app.slug, tab: "operations" });
  }
  if (summary.openTickets) attention.push({ id: "tickets", title: `${summary.openTickets} open support request(s)`, description: "Review new requests and conversations waiting for a next step.", severity: "info", tab: "tickets" });
  if (summary.openErrors) attention.push({ id: "errors", title: `${summary.openErrors} unresolved error group(s)`, description: "Review impact, the most recent occurrence, and the suggested investigation steps.", severity: "warning", tab: "errors" });
  const activity = context.capabilities.includes("audit:read") ? await listAudit(context, requestedApp, { limit: 12 }) : [];
  return { period: range, metrics, trend, services: sources.flatMap(source => source.services), attention, activity, coverage: { connected: sources.filter(source => source.data).length, total: apps.length, missing: sources.filter(source => !source.data).map(source => source.app.name) }, updatedAt: new Date().toISOString(), currency, notes: [
    "Totals across apps count accounts, not unique people. If a selected app’s account source is missing, combined account and library totals remain unavailable.",
    "Verified Pro access includes valid entitlements; it is not proof of payment. Tester preview access is excluded.",
    "Search reservations cover this UTC calendar month and include uncached attempts that may fail. ISBNdb counts are recorded provider requests today in UTC, including failures; cached results and quota reservations are excluded.",
    "ISBNdb reporting starts when collection is installed and does not reconstruct earlier requests. Recorded requests are not a provider billing statement. Health uses the latest real request and becomes unverified after 24 hours without an observation.",
    "Saved books and signup history reflect currently retained accounts and libraries, not lifetime activity after deletion.",
    revenue === null ? `Revenue is unavailable until verified payments with known amounts in ${currency} are recorded for every selected app. Different currencies are never silently combined.` : `Revenue is recorded ${currency} receipts less recorded refunds during this period. It does not establish complete historical revenue, taxes, store fees, or payouts.`,
    "The error count covers events received by this hub. No events does not mean the app has had no errors.",
  ] };
}

export async function loadOperations(context: HubContext, requestedApp: string | null): Promise<OperationsData> {
  assertCapability(context, "operations:read");
  const [overview, checks, deployment] = await Promise.all([loadOverview(context, requestedApp), listReviewTasks(context, requestedApp), vercelHealth("geofox", "Geofox")]);
  return { services: [{ id: "hub-database", appSlug: "geofox", name: "Geofox support database", status: "healthy", detail: "Staff access and reporting queries completed successfully for this request.", latencyMs: null, checkedAt: new Date().toISOString() }, deployment, ...overview.services], checks, audit: overview.activity, integrations: integrationInfo(context) };
}

export async function loadCustomer(context: HubContext, appSlug: string, id: string): Promise<CustomerRecord> {
  assertCapability(context, "customers:read", appSlug);
  if (appSlug !== "novanook") throw new HubError(503, "APP_NOT_CONNECTED", "Customer lookup will be available after this app’s data adapter is connected.");
  const record = await novaCustomer(context, id);
  if (!record.found || !record.customer || !record.usage) throw new HubError(404, "CUSTOMER_NOT_FOUND", "No current NovaNook account was found with this customer ID.");
  const customer = record.customer;
  const [errors, tickets, payments] = await Promise.all([
    listErrors(context, appSlug, { customerId: id, limit: 100 }),
    listTickets(context, appSlug, { customerId: id, status: "all", limit: 100 }),
    getHubService().from("hub_payments").select("id,provider,status,amount_minor,currency,occurred_at,product").eq("app_slug", appSlug).eq("customer_id", id).order("occurred_at", { ascending: false }).limit(100),
  ]);
  if (payments.error) databaseError(payments.error);
  const billing: PaymentRecord[] = (payments.data || []).map(payment => ({ id: payment.id, provider: payment.provider, status: payment.status, amount: majorAmount(payment.amount_minor === null ? null : Number(payment.amount_minor), payment.currency), currency: payment.currency, occurredAt: payment.occurred_at, product: payment.product }));
  await recordAudit(context, { appSlug, action: "customer.viewed", entityType: "customer", entityId: id, summary: "Customer support record viewed." });
  return { id, appSlug, email: customer.email, displayName: customer.displayName || customer.username, createdAt: customer.createdAt, lastSignInAt: customer.lastSignInAt, ageBand: customer.ageBand, plan: customer.plan === "pro" ? "paid" : "free", accountStatus: record.deletion ? `Deletion ${record.deletion.status}` : customer.socialRestricted ? "Social access restricted" : customer.emailVerified ? "Email verified" : "Email not verified", usage: { books: record.usage.libraryBooks, searches: record.usage.searchReservationsAllTime, readingSessions: record.usage.readingSessions, readingMinutes: record.usage.readingMinutes }, billing, history: (record.history || []).map(item => ({ ...item, appSlug })), errors: errors.items, tickets: tickets.items, notes: [
    "Verify the customer’s identity before sharing account details or making account changes. A customer ID submitted on a public ticket is an unverified claim.",
    "Usage reflects the currently retained library and quota reservations. Reading totals can include manual logs; deleted data is not reconstructed.",
    ...(customer.store ? [`Current subscription provider: ${customer.store}. Last entitlement check: ${customer.billingCheckedAt || "unavailable"}.`] : []),
    ...(customer.proExpiresAt ? [`Current Pro access expiration: ${customer.proExpiresAt}.`] : []),
    ...(customer.testPreview ? ["Tester preview is separate from verified paid access."] : []),
    ...(record.moderation ? [`Recorded moderation: ${record.moderation.openReports} unresolved report(s); ${record.moderation.activeHolds} active content hold(s).`] : []),
    billing.length ? "The most recent 100 payments received by this hub are shown. Earlier transactions are not automatically imported." : "Payment history is not yet recorded for this account in Geofox. Current subscription access does not establish payment history.",
    "Errors shown were received after telemetry was connected. Historical application errors are not available from NovaNook’s existing account tables.",
  ] };
}

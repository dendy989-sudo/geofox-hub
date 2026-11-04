import type { WorkspaceAccess } from "../workspace/types";

export type StaffRole = "owner" | "admin" | "support" | "moderator" | "analyst";
export type Capability = "overview:read" | "customers:read" | "tickets:read" | "tickets:write" | "errors:read" | "errors:write" | "moderation:read" | "moderation:write" | "operations:read" | "settings:write" | "staff:write" | "audit:read" | "tasks:read" | "tasks:write" | "marketing:read" | "marketing:write" | "legal:read" | "legal:write" | "accounting:read" | "accounting:write";
export type HealthState = "healthy" | "degraded" | "down" | "unknown";
export interface HubApp { slug: string; name: string; color: string; website: string; configured: boolean; }
export interface HubBootstrap { user: { id: string; email: string }; staff: { role: StaffRole; displayName: string }; apps: HubApp[]; capabilities: Capability[]; workspaceAccess: WorkspaceAccess; setupIssues: string[]; }
export type IsbnOutcome = "success" | "not_found" | "authentication" | "rate_limited" | "unavailable" | "invalid_response" | "timeout" | "network_error";
export interface IsbnObservation { observedAt: string; operation: "detail" | "search"; outcome: IsbnOutcome; httpStatus: number | null; latencyMs: number; }
export interface IsbnDailyUsage { date: string; requests: number; successes: number; notFound: number; failures: number; rateLimited: number; avgLatencyMs: number | null; }
export interface IsbnProviderReport { version: 1; appId: "novanook"; provider: "isbndb"; capturedAt: string; timezone: "UTC"; collectedSince: string; today: IsbnDailyUsage; lastObservation: IsbnObservation | null; lastSuccessAt: string | null; lastFailure: IsbnObservation | null; daily: IsbnDailyUsage[]; }
export interface ServiceStatus { id: string; appSlug: string; name: string; status: HealthState; detail: string; latencyMs: number | null; checkedAt: string | null; isbn?: IsbnProviderReport; }
export interface OverviewMetrics { usersTotal: number | null; freeUsers: number | null; paidUsers: number | null; adultFree: number | null; adultPaid: number | null; teenFree: number | null; teenPaid: number | null; unknownAge: number | null; booksTotal: number | null; searchesPeriod: number | null; isbnCallsToday: number | null; revenuePeriod: number | null; openTickets: number | null; openErrors: number | null; pendingModeration: number | null; }
export interface TrendPoint { date: string; users: number | null; searches: number | null; revenue: number | null; errors: number | null; }
export interface ActivityItem { id: string; appSlug: string | null; title: string; detail: string; createdAt: string; kind: string; }
export interface AttentionItem { id: string; title: string; description: string; severity: "info" | "warning" | "critical"; appSlug?: string; tab?: string; }
export interface OverviewData { period: { label: string; start: string; end: string; timezone: string }; metrics: OverviewMetrics; trend: TrendPoint[]; services: ServiceStatus[]; attention: AttentionItem[]; activity: ActivityItem[]; coverage: { connected: number; total: number; missing: string[] }; updatedAt: string; currency: string; notes: string[]; }
export type TicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export interface Ticket { id: string; reference: string; appSlug: string; appName: string; subject: string; status: TicketStatus; priority: TicketPriority; category: string; email: string; customerId: string | null; customerOwnerId: string | null; identityVerified: boolean; source: "web" | "app" | "staff" | "email"; createdAt: string; updatedAt: string; assigneeId: string | null; customerReplyPending: boolean; customerReplyAt: string | null; }
export interface TicketMessage { id: string; body: string; authorName: string; internal: boolean; createdAt: string; deliveryStatus: "not_requested" | "pending" | "sent" | "failed"; notificationNotice?: string; replayed?: boolean; }
export interface TicketDetail extends Ticket { messages: TicketMessage[]; nextMessagesCursor: string | null; audit: ActivityItem[]; customerReplyMessageId: string | null; }
export interface TicketReadReceipt { ticketId: string; messageId: string; readThroughMessageId: string; readThroughCreatedAt: string; }
export type ErrorState = "open" | "investigating" | "resolved" | "ignored";
export interface ErrorItem { id: string; appSlug: string; severity: "info" | "warning" | "error" | "critical"; errorCode: string | null; fingerprint: string; title: string; message: string; route: string | null; firstSeen: string; lastSeen: string; count: number; status: ErrorState; customerId: string | null; suggestedAction: string; source: string; stack?: string | null; }
export interface PaymentRecord { id: string; provider: string; status: string; amount: number | null; currency: string | null; occurredAt: string | null; product: string | null; }
export interface CustomerRecord { id: string; appSlug: string; email: string | null; displayName: string | null; createdAt: string | null; lastSignInAt: string | null; ageBand: "adult" | "teen" | "unknown"; plan: "free" | "paid" | "unknown"; accountStatus: string; usage: { books: number | null; searches: number | null; readingSessions: number | null; readingMinutes: number | null }; billing: PaymentRecord[]; history: ActivityItem[]; errors: ErrorItem[]; tickets: Ticket[]; notes: string[]; }
export interface ModerationItem { id: string; appSlug: string; type: string; status: string; reason: string; reportedAt: string; reporterId: string | null; subjectUserId: string | null; summary: string; content: string | null; version?: string; }
export interface ReviewTask { id: string; label: string; description: string; cadence: "daily" | "weekly"; completedAt: string | null; completedBy: string | null; }
export interface ConnectionInfo { id: string; name: string; state: "connected" | "missing" | "error"; description: string; required: boolean; }
export interface OperationsData { services: ServiceStatus[]; checks: ReviewTask[]; audit: ActivityItem[]; integrations: ConnectionInfo[]; }
export interface ListResult<T> { items: T[]; total: number; notes: string[]; }
export interface ApiEnvelope<T> { data?: T; error?: string; code?: string; }

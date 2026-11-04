import type { WorkspaceAttachment, WorkspaceRecordInput } from "./types";

export type LegalRecurrence = "none" | "monthly" | "quarterly" | "annual" | "continuous";
export interface LegalData {
  dueDate: string | null;
  reviewDate: string | null;
  amountCents: number | null;
  currency: "USD";
  payee: string;
  jurisdiction: string;
  category: string;
  recurrence: LegalRecurrence;
  sourceUrl: string;
  notes: string;
  condition: string;
  starterKey?: string;
  sourceCheckedAt?: string;
  completedAt?: string | null;
  attachments: WorkspaceAttachment[];
}

export interface ComplianceSource { key: string; title: string; agency: string; url: string; summary: string; scope: "company" | "app"; }
export const COMPLIANCE_SOURCES: ComplianceSource[] = [
  { key: "texas-franchise-pir", title: "Texas franchise tax and Public Information Report", agency: "Texas Comptroller", url: "https://comptroller.texas.gov/taxes/franchise/pir-oir-filing-req.php", summary: "Texas LLCs file a Public Information Report annually. The general annual due date is May 15; weekend and holiday rules can move it. A tax-report exemption does not automatically remove the information-report requirement.", scope: "company" },
  { key: "registered-agent", title: "Registered agent and registered office", agency: "Texas Secretary of State", url: "https://www.sos.state.tx.us/corp/registeredagentfaqs.shtml", summary: "A Texas filing entity must continuously maintain a registered agent and registered office. Keep contact details, consent, and any service contract current. Vendor renewal dates and fees depend on your agreement.", scope: "company" },
  { key: "federal-tax", title: "Single-member LLC federal tax classification", agency: "Internal Revenue Service", url: "https://www.irs.gov/businesses/small-businesses-self-employed/single-member-limited-liability-companies", summary: "An individual-owned single-member LLC is generally disregarded for federal income tax unless it elects corporate treatment. Employment and certain excise taxes have separate rules. Confirm your actual classification and applicable return.", scope: "company" },
  { key: "estimated-tax", title: "Estimated tax review", agency: "Internal Revenue Service", url: "https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes", summary: "Individuals generally need estimated payments when they expect to owe at least $1,000 after withholding and credits, subject to additional rules and exceptions. Use the IRS payment schedule and your actual income, withholding, and prior-year tax.", scope: "company" },
  { key: "boi-review", title: "Beneficial ownership reporting status", agency: "FinCEN", url: "https://www.fincen.gov/news/news-releases/fincen-removes-beneficial-ownership-reporting-requirements-us-companies-and-us", summary: "FinCEN's March 2025 rule exempts entities created in the United States from BOI reporting. Keep this as a rule-review item for a domestic Texas LLC, rather than an assumed annual filing.", scope: "company" },
  { key: "privacy-review", title: "Texas privacy applicability and data practices", agency: "Texas Legislature", url: "https://tcss.legis.texas.gov/resources/BC/htm/BC.541.htm", summary: "Chapter 541 includes applicability criteria and a small-business exception, with a separate restriction on selling sensitive data. Review the actual product, data, vendors, and states served before determining obligations.", scope: "app" },
  { key: "coppa-review", title: "Children's privacy and age controls", agency: "Federal Trade Commission", url: "https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions", summary: "COPPA covers services directed to children under 13 and general-audience services with actual knowledge they collect personal information from children under 13. A 13+ label alone does not settle applicability.", scope: "app" },
];

export const LEGAL_SOURCE_CHECKED_AT = "2026-11-04";
export function emptyLegalData(): LegalData {
  return { dueDate: null, reviewDate: null, amountCents: null, currency: "USD", payee: "", jurisdiction: "", category: "company", recurrence: "none", sourceUrl: "", notes: "", condition: "", completedAt: null, attachments: [] };
}
export function readableLegalData(value: Partial<LegalData> | undefined): LegalData {
  return { ...emptyLegalData(), ...value, attachments: Array.isArray(value?.attachments) ? value.attachments : [] };
}
export function localDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function shiftDate(value: string, months: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result.toISOString().slice(0, 10);
}
export function nextLegalDate(data: LegalData): string | null {
  const months = { none: 0, monthly: 1, quarterly: 3, annual: 12, continuous: 0 }[data.recurrence];
  const base = data.dueDate || data.reviewDate;
  return months && base ? shiftDate(base, months) : null;
}
export function safeSourceUrl(value: string): string | undefined {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined; }
  catch { return undefined; }
}

export function legalStarterRecords(scope: string, appSlugs: string[], today = localDay()): WorkspaceRecordInput<LegalData>[] {
  const targets: (string | null)[] = scope === "all" ? [null, ...appSlugs] : [scope === "company" ? null : scope];
  return targets.flatMap((appSlug) => COMPLIANCE_SOURCES.filter((source) => source.scope === (appSlug ? "app" : "company")).map((source) => {
    const taxReport = source.key === "texas-franchise-pir";
    const isApp = source.scope === "app";
    const notes: Record<string, string> = {
      "texas-franchise-pir": "Review this item and set the due date after confirming the company's Texas tax account and first report year. For a company that became subject in October 2026, the expected first annual due date is May 17, 2027 (May 15 falls on Saturday). Verify the actual account, report instructions, threshold, and any applicable extension. Preserve the filed report and confirmation. Report/payment rules: https://comptroller.texas.gov/taxes/franchise/faq/reports-payments.php ; general deadline: https://comptroller.texas.gov/taxes/franchise/ .",
      "registered-agent": "Check the current registered agent, Texas street address, consent, and service contract. Add the actual provider, renewal date, and quoted fee when known. Update the Secretary of State if details change; this record does not submit that update.",
      "federal-tax": "Confirm the owner's tax classification and any corporate election. Gather income, expenses, receipts, asset purchases, and owner activity. Set the applicable filing deadline after confirming the return. Add payroll or excise obligations separately if they become relevant.",
      "estimated-tax": "Check whether federal estimated payments apply using actual income, withholding, credits, and prior-year tax. Add each required installment and due date from the current IRS Form 1040-ES instructions. Quarterly internal review is a planning cadence, not the IRS payment schedule.",
      "boi-review": "This domestic-entity exemption was checked on November 4, 2026. Revisit the official source when the entity structure or rule changes; no BOI filing or fee is assumed by this checklist.",
      "privacy-review": "Review the US states the app actually serves, personal and sensitive data collected, retention/deletion, vendors, privacy notices, consent, and user-rights handling. Confirm which state laws apply to the company and product. The quarterly review cadence is an internal management choice, not a legal deadline.",
      "coppa-review": "Review whether the app is child-directed, age controls, signup flows, reports of under-13 users, and analytics/advertising SDK data collection. Document how the team handles actual knowledge of under-13 users. The quarterly review cadence is an internal management choice, not a legal deadline.",
    };
    return {
      module: "legal", appSlug, title: source.title, status: "open",
      data: { ...emptyLegalData(), starterKey: source.key, sourceCheckedAt: LEGAL_SOURCE_CHECKED_AT, sourceUrl: source.url, payee: source.agency, jurisdiction: isApp ? "United States — confirm states served" : source.key.startsWith("texas") || source.key === "registered-agent" ? "Texas" : "United States", category: isApp ? "app_policy" : source.key.includes("tax") || taxReport ? "tax" : "company", recurrence: isApp || source.key === "estimated-tax" || source.key === "boi-review" ? "quarterly" : source.key === "registered-agent" ? "continuous" : "annual", dueDate: null, reviewDate: today, condition: taxReport ? "Confirm October 2026 formation and the first Texas report year." : isApp ? "Confirm applicability to this app's audience, data practices, and locations." : "Review applicability and confirm the company's actual details before relying on this record.", notes: notes[source.key], amountCents: null },
    };
  }));
}
/** Stable UUID for each starter and scope, so concurrent/retried imports do not duplicate it. */
export function starterRequestId(starterKey: string, appSlug: string | null): string {
  const text = `geofox-legal-v1:${appSlug || "company"}:${starterKey}`;
  const hashes = [2166136261, 2654435761, 2246822519, 3266489917].map((seed) => {
    let hash = seed;
    for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
    return hash.toString(16).padStart(8, "0");
  }).join("");
  return `${hashes.slice(0, 8)}-${hashes.slice(8, 12)}-4${hashes.slice(13, 16)}-a${hashes.slice(17, 20)}-${hashes.slice(20, 32)}`;
}

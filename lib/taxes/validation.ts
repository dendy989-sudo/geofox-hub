import { z } from "zod";
import { FILING_STATUSES, RETURN_STATUSES, IRS_ENTRY_TYPES, TAX_CATEGORIES, TAX_KINDS, TRANSACTION_SCOPES, type TaxData, type TaxSave } from "./types.ts";

const short = (max = 200) => z.string().trim().max(max);
const notes = short(12000).default("");
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) === value, "Choose a valid calendar date.");
const nullableDate = dateSchema.nullable().default(null);
export const yearSchema = z.number().int().min(2018).max(2100);
const cents = z.number().int().safe().min(-1_000_000_000_000).max(1_000_000_000_000);
const percent = z.number().min(0).max(100).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, "Use at most two percentage decimals.");
const id = z.uuid().nullable().default(null);
const category = z.enum(TAX_CATEGORIES.map(item => item.id) as [string, ...string[]]);
const treatment = z.enum(["needs_review", "unknown", "sole_proprietor", "qualified_joint_venture", "community_property", "partnership", "s_corporation", "c_corporation", "other"]);
const optionalInventoryAmount=cents.nonnegative().nullable().default(null);
const optionalMiles=z.number().min(0).max(10_000_000).nullable().default(null);
const optionalFlag=z.boolean().nullable().default(null);
const scheduleDetails=z.object({
  inventory_method:z.enum(["cost","lower_cost_market","other","unknown"]).default("unknown"),inventory_changed:optionalFlag,
  opening_inventory_cents:optionalInventoryAmount,purchases_cents:optionalInventoryAmount,personal_withdrawals_cents:optionalInventoryAmount,
  cost_of_labor_cents:optionalInventoryAmount,materials_cents:optionalInventoryAmount,other_costs_cents:optionalInventoryAmount,closing_inventory_cents:optionalInventoryAmount,
  vehicle_service_date:nullableDate,business_miles:optionalMiles,commuting_miles:optionalMiles,other_miles:optionalMiles,
  vehicle_personal_use_available:optionalFlag,other_vehicle_available:optionalFlag,vehicle_evidence:optionalFlag,vehicle_evidence_written:optionalFlag,
  materially_participated:optionalFlag,started_business_this_year:optionalFlag,payments_require_1099:optionalFlag,forms_1099_filed:optionalFlag,notes,
  loss_at_risk:z.enum(["unknown","all_at_risk","some_not_at_risk"]).default("unknown"),
}).strict();
const transaction = z.object({
  date: dateSchema, amount_cents: cents, account_id: id, statement_id: id,
  description: short(1000).default(""), vendor: short(300).default(""),
  scope: z.enum(TRANSACTION_SCOPES).default("unresolved"), business_id: id,
  business_percent: percent.default(100), category: category.default("uncategorized"),
  review_status: z.enum(["needs_review", "confirmed"]).default("needs_review"),
  deduction_percent: percent.nullable().default(null), deduction_confirmed: z.boolean().default(false), notes,
  source: z.enum(["manual", "csv", "ai"]).default("manual"), rule_id: id, manual_override: z.boolean().default(true),
  source_row: z.number().int().min(1).max(1000000).optional(), fingerprint: short(64).optional(),
  source_reference: short(1000).default(""), question: short(1000).default(""),
}).strict();
export const recordSchemas = {
  year: z.object({status:z.enum(FILING_STATUSES).default("unknown"),filing_status:z.enum(RETURN_STATUSES).default("unknown"),filed_date:nullableDate,amended_date:nullableDate,notes,
    reporting_treatment:treatment.default("needs_review"),business_treatments:z.record(z.uuid(),treatment).default({}),
    irs_balance_confirmed:z.boolean().default(false),irs_balance_as_of:nullableDate,checklist:z.array(short(300)).max(100).default([]),
    original_return_notes:short(6000).default(""),amendment_notes:short(6000).default(""),
    document_checklist:z.record(z.string().max(100),z.boolean()).default({}),preparer:short().default(""),extension_date:nullableDate,
    schedule_c_details:z.record(z.uuid(),scheduleDetails).default({}),
  }).strict(),
  business:z.object({legal_name:short().default(""),structure:z.enum(["unknown","sole_proprietorship","llc","partnership","corporation","nonprofit","other"]).default("unknown"),reporting_treatment:treatment.default("needs_review"),owner_share_percent:percent.nullable().default(null),notes,start_year:yearSchema.default(2018),end_year:yearSchema.nullable().default(null),business_code:short(6).default(""),accounting_method:z.enum(["cash","accrual","other","unknown"]).default("unknown"),other_owners:short(500).default("")}).strict(),
  account:z.object({institution:short().default(""),last_four:z.string().regex(/^\d{0,4}$/).default(""),account_type:z.enum(["checking","savings","credit_card","payment_platform","cash","other"]).default("checking"),notes,ownership:z.enum(["personal","business","mixed","unknown"]).default("mixed")}).strict(),
  transaction,
  adjustment:transaction.extend({source_reference:short(1000).default("")}),
  rule:z.object({match:short(300).min(2),match_type:z.enum(["exact","contains"]).default("contains"),scope:z.enum(TRANSACTION_SCOPES),business_id:id,business_percent:percent.default(100),category:category.default("uncategorized"),deduction_percent:percent.nullable().default(null),deduction_confirmed:z.boolean().default(false),enabled:z.boolean().default(true),notes}).strict(),
  dependent:z.object({name:short().min(1),birth_date:nullableDate,relationship:short(100).default("child"),months_lived:z.number().int().min(0).max(12).default(12),student:z.boolean().default(false),disabled:z.boolean().default(false),claimed:z.boolean().default(false),notes,other_claimant:short().default(""),support_over_half:z.boolean().nullable().default(null),citizenship:short(100).default(""),eligibility_reviewed:z.boolean().default(false)}).strict(),
  irs_entry:z.object({date:dateSchema,type:z.enum(IRS_ENTRY_TYPES),amount_cents:cents,reference:short(1000).default(""),notes,affects_balance:z.boolean().optional(),document_id:id,payment_method:short(100).default("")}).strict(),
  statement:z.object({notes,document_type:z.enum(["bank_statement","return","notice","receipt","ppp","relief","other"]).default("bank_statement")}).strict(),
  chat:z.object({message:short(5000),reply:short(20000),questions:z.array(short(1000)).max(12),proposals:z.array(z.record(z.string(),z.unknown())).max(20)}).strict(),
};
export function validateTaxSave(input: unknown): TaxSave {
  const basic = z.object({id:z.uuid().optional(),kind:z.enum(TAX_KINDS),tax_year:yearSchema.nullable(),title:short().min(1),data:z.record(z.string(),z.unknown()),version:z.number().int().min(1).optional()}).strict().parse(input);
  const schema = recordSchemas[basic.kind];
  const data = schema.parse(basic.data) as TaxData;
  if (["business","account","rule"].includes(basic.kind) && basic.tax_year !== null) throw new Error("Businesses, accounts, and vendor rules apply across tax years.");
  if (!["business","account","rule"].includes(basic.kind) && basic.tax_year === null) throw new Error("Choose a tax year for this record.");
  if (["transaction","adjustment"].includes(basic.kind)) {
    if (Number(String(data.date).slice(0,4)) !== basic.tax_year) throw new Error("The transaction date must belong to the selected tax year.");
    if (["business","mixed"].includes(String(data.scope)) && !data.business_id) throw new Error("Choose the business for this transaction.");
    if (data.scope === "business" && data.business_percent !== 100) throw new Error("Use Mixed for a partial business allocation.");
    if (["business","mixed"].includes(String(data.scope)) && data.review_status === "confirmed" && data.category === "uncategorized") throw new Error("Choose a category before confirming a business transaction.");
    if (data.deduction_confirmed && data.deduction_percent === null) throw new Error("Enter the deduction percentage before confirming it.");
    if (data.deduction_confirmed && (!["business","mixed"].includes(String(data.scope)) || ["gross_receipts","other_income","returns_allowances","uncategorized"].includes(String(data.category)))) throw new Error("Confirm deductions only for a categorized business expense or its refund.");
    if (!["business","mixed"].includes(String(data.scope))) { data.business_percent = 0; data.deduction_confirmed = false; data.deduction_percent = null; }
  }
  if (basic.kind === "rule") {
    if (["business","mixed"].includes(String(data.scope)) && !data.business_id) throw new Error("Choose a business for this rule.");
    if (data.scope === "business" && data.business_percent !== 100) throw new Error("Use Mixed for a partial business rule.");
    if (data.scope === "mixed" && (data.business_percent === 0 || data.business_percent === 100)) throw new Error("A mixed rule needs a business share between 0 and 100 percent.");
  }
  if (basic.kind === "irs_entry") {
    if (data.type !== "opening_balance" && Number(data.amount_cents) < 0) throw new Error("Enter a positive IRS activity amount; the activity type determines its effect.");
    if (data.affects_balance === undefined) data.affects_balance = ["opening_balance","assessment","penalty","interest","payment","credit","abatement"].includes(String(data.type));
  }
  return {...basic,data};
}

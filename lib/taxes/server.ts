import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireFinanceContext } from "@/lib/finance/server";
import { getHubService, HubError, type HubContext } from "@/lib/hub/server";
import { applyRuleToTransaction, ruleMatches } from "./model";
import { validateTaxSave, yearSchema } from "./validation";
import type { TaxRecord, TaxSave, TaxSnapshot, TransactionData } from "./types";

export const TAX_BUCKET = "tax-documents";
export async function requireTaxContext() { return requireFinanceContext(); }
export function taxInputError(error: unknown): never {
  if (error instanceof HubError) throw error;
  if (error instanceof z.ZodError) throw new HubError(400,"INVALID_TAX_INPUT", error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).slice(0,3).join("; "));
  throw new HubError(400,"INVALID_TAX_INPUT", error instanceof Error ? error.message : "Check the tax record fields.");
}
export function taxDatabaseError(error: {code?:string}): never {
  if (["42P01","42883","PGRST202","PGRST205"].includes(error.code??"")) throw new HubError(503,"TAXES_DATABASE_NOT_READY","The Taxes workspace database update is pending. Your existing Finance data is safe.");
  if (error.code === "42501") throw new HubError(403,"TAXES_ACCESS_REQUIRED","Taxes is available only to its approved private owner.");
  if (error.code === "40001") throw new HubError(409,"TAX_RECORD_CHANGED","This record changed or the request was already completed. Refresh before trying again.");
  if (error.code === "P0002") throw new HubError(404,"TAX_RECORD_NOT_FOUND","This tax record could not be found.");
  if (error.code === "23505") throw new HubError(409,"TAX_RECORD_EXISTS","This year, statement row, or record already exists. Refresh before trying again.");
  if (error.code === "23503") throw new HubError(409,"TAX_RECORD_LINKED","A linked tax record is unavailable, or this record supports saved evidence and must be kept.");
  if (["22023","22P02","23514","23502","22007","22008","22003"].includes(error.code??"")) throw new HubError(400,"INVALID_TAX_INPUT","Check the year, dates, amounts and record links.");
  throw new HubError(503,"TAXES_DATABASE_UNAVAILABLE","Your tax records could not be loaded or saved. Please try again.");
}
export async function taxRpc<T>(name:string,parameters:Record<string,unknown>):Promise<T> {
  const {data,error}=await getHubService().rpc(name,parameters);if(error)taxDatabaseError(error);return data as T;
}
export async function taxReserve(context:HubContext,category:string,limit=30,window=60) {
  const key=createHash("sha256").update(`taxes:${category}:${context.user.id}`).digest("hex");
  const allowed=await taxRpc<boolean>("hub_reserve_rate_limit",{p_key_hash:key,p_window_seconds:window,p_limit:limit});
  if(!allowed)throw new HubError(429,"TAXES_RATE_LIMITED","Please wait a moment before starting another tax request.");
}
// In deployed Vercel Functions, the AI SDK reads the OIDC token from the
// invocation header. VERCEL_OIDC_TOKEN is primarily available for local CLI use.
// Project OIDC must remain enabled for the deployment-authenticated path.
export function taxAiAvailable() {
  return Boolean(
    process.env.AI_GATEWAY_API_KEY ||
    process.env.VERCEL_OIDC_TOKEN ||
    (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview")
  );
}
export async function getTaxRecord(context:HubContext,id:string,kind?:string):Promise<TaxRecord> {
  if(!z.uuid().safeParse(id).success)throw new HubError(400,"INVALID_TAX_INPUT","Choose a valid tax record.");
  const {data,error}=await getHubService().from("tax_records").select("id,kind,tax_year,title,data,version,archived,created_at,updated_at").eq("id",id).eq("user_id",context.user.id).eq("archived",false).maybeSingle();
  if(error)taxDatabaseError(error);if(!data||(kind&&data.kind!==kind))throw new HubError(404,"TAX_RECORD_NOT_FOUND","This tax record is unavailable.");return data as TaxRecord;
}
export async function loadTaxData(context:HubContext,year:number,fullAudit=false):Promise<TaxSnapshot> {
  try{yearSchema.parse(year);}catch(error){taxInputError(error);}
  const snapshot=await taxRpc<Omit<TaxSnapshot,"user"|"aiAvailable">>("taxes_snapshot",{p_actor:context.user.id,p_year:year,p_full_audit:fullAudit});
  return {...snapshot,user:{id:context.user.id,display_name:context.staff.displayName},aiAvailable:taxAiAvailable()};
}
/** Internal callers own server-generated provenance. Client saves pass validateTaxSave first. */
export async function saveInternalTaxRecord(context:HubContext,record:TaxSave):Promise<TaxRecord> {
  return taxRpc("taxes_save_record",{p_actor:context.user.id,p_record:{...record,id:record.id??randomUUID()}});
}
export async function saveTaxRecord(context:HubContext,input:unknown):Promise<TaxRecord> {
  let record:TaxSave;try{record=validateTaxSave(input);}catch(error){return taxInputError(error);}
  if(record.kind==="chat")throw new HubError(400,"INVALID_TAX_INPUT","Chat history is saved by the assistant endpoint.");
  if(record.kind==="statement"){
    if(!record.id)throw new HubError(400,"INVALID_TAX_INPUT","Use Upload documents to add an original file.");
    const existing=await getTaxRecord(context,record.id,"statement");
    record={...record,data:{...existing.data,...record.data},tax_year:existing.tax_year};
  }
  if(record.kind==="transaction"||record.kind==="adjustment"){
    // Preserve source row identity even when correcting an imported transaction.
    if(record.id&&record.version){const existing=await getTaxRecord(context,record.id,record.kind);
      for(const field of ["source","source_row","fingerprint","statement_id"]){if(existing.data[field]!==undefined)record.data[field]=existing.data[field];}
    }else{record.data.source="manual";record.data.statement_id=null;delete record.data.source_row;delete record.data.fingerprint;}
    record.data.manual_override=true;
  }
  return saveInternalTaxRecord(context,record);
}
export async function mutateTax(context:HubContext,input:Record<string,unknown>) {
  await taxReserve(context,"write",120);
  if(input.action==="save")return saveTaxRecord(context,input.record);
  if(input.action==="archive"){
    const checked=z.object({id:z.uuid(),version:z.number().int().positive()}).safeParse(input);
    // Parse only the relevant fields; the request also carries action.
    if(!checked.success) return taxInputError(checked.error);
    return taxRpc("taxes_archive_record",{p_actor:context.user.id,p_id:checked.data.id,p_version:checked.data.version});
  }
  if(input.action==="apply_rule"){
    const rule=await getTaxRecord(context,String(input.ruleId??input.id),"rule");
    if(input.version!==rule.version)throw new HubError(409,"TAX_RECORD_CHANGED","The rule changed. Review it again before applying.");
    if(rule.data.enabled===false)throw new HubError(400,"RULE_DISABLED","Enable this rule before applying it.");
    const {data:rules,error:ruleError}=await getHubService().from("tax_records").select("*").eq("user_id",context.user.id).eq("kind","rule").eq("archived",false);
    if(ruleError)taxDatabaseError(ruleError);
    const updates:TaxSave[]=[];let offset=0;let skipped=0;
    while(true){
      const {data,error}=await getHubService().from("tax_records").select("*").eq("user_id",context.user.id).eq("kind","transaction").eq("archived",false).order("id").range(offset,offset+499);
      if(error)taxDatabaseError(error);
      for(const row of data??[]){const tx=row as TaxRecord<TransactionData>;if(!ruleMatches(rule,tx))continue;
        if(tx.data.manual_override||(rules??[]).filter(r=>ruleMatches(r as TaxRecord,tx)).length!==1){skipped++;continue;}
        const changed=applyRuleToTransaction(rule,tx.data);updates.push({id:tx.id,kind:tx.kind,tax_year:tx.tax_year,title:tx.title,version:tx.version,data:changed});
      }
      if((data?.length??0)<500)break;offset+=500;
      if(updates.length>10000)throw new HubError(413,"RULE_MATCHES_TOO_MANY","This rule matches more than 10,000 transactions. Narrow the match before applying.");
    }
    const digest=createHash("sha256").update(JSON.stringify({actor:context.user.id,rule:rule.id,version:rule.version,updates})).digest("hex");
    const byYear:Record<string,number>={};for(const update of updates){const year=String(update.tax_year);byYear[year]=(byYear[year]??0)+1;}
    if(input.preview===true)return {count:updates.length,skipped,by_year:byYear,preview_token:digest};
    if(input.preview_token!==digest)throw new HubError(409,"RULE_PREVIEW_CHANGED","The matching transactions changed. Review the rule preview again before applying.");
    if(updates.length)await taxRpc("taxes_save_batch",{p_actor:context.user.id,p_records:updates});
    return {updated:updates.length,skipped};
  }
  if(input.action==="confirm_transactions"){
    const checked=z.object({items:z.array(z.object({id:z.uuid(),version:z.number().int().positive()})).min(1).max(200),deduction_percent:z.number().min(0).max(100).optional()}).safeParse(input);
    if(!checked.success)return taxInputError(checked.error);
    const updates:TaxSave[]=[];
    for(const item of checked.data.items){const tx=await getTaxRecord(context,item.id,"transaction");
      if(tx.data.scope==="unresolved"||(["business","mixed"].includes(String(tx.data.scope))&&tx.data.category==="uncategorized"))throw new HubError(400,"CLASSIFICATION_REQUIRED","Categorize every selected business transaction before confirming.");
      const data={...tx.data,review_status:"confirmed",manual_override:true};
      if(checked.data.deduction_percent!==undefined){
        if(!["business","mixed"].includes(String(tx.data.scope))||["gross_receipts","other_income","returns_allowances"].includes(String(tx.data.category)))throw new HubError(400,"EXPENSES_REQUIRED","Deduction confirmation applies only to business expense categories.");
        Object.assign(data,{deduction_confirmed:true,deduction_percent:checked.data.deduction_percent});
      }
      try{updates.push(validateTaxSave({id:tx.id,version:item.version,kind:tx.kind,tax_year:tx.tax_year,title:tx.title,data}));}catch(error){taxInputError(error);}
    }
    await taxRpc("taxes_save_batch",{p_actor:context.user.id,p_records:updates});return {updated:updates.length};
  }
  throw new HubError(400,"INVALID_TAX_ACTION","Choose a supported tax action.");
}

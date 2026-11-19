import { merchantIdentity, ruleMatches } from "./model.ts";
import type { TaxRecord, TransactionData, TaxCategory } from "./types.ts";

export const BULK_SCOPES = ["personal","business","mixed","transfer","loan","owner_contribution","owner_draw","tax_payment","tax_refund","relief","excluded"] as const;
export type BulkScope = typeof BULK_SCOPES[number];
export interface BulkChoice { scope:BulkScope; business_id:string|null; business_percent:number; category:TaxCategory; }
export function merchantKey(transaction:TaxRecord | TransactionData):string {
  const data="data" in transaction ? transaction.data as TransactionData : transaction;
  return merchantIdentity(data);
}
export function specificMerchant(key:string):boolean {return key.length>=4 && key.length<=300 && !/^(PURCHASE|PAYMENT|DEBIT|CREDIT|CARD|POS|ACH|TRANSFER|CHECK|UNKNOWN|OTHER|WITHDRAWAL|DEPOSIT|ONLINE PAYMENT|CARD PURCHASE)$/.test(key);}
export function groupRecurringVendors(transactions:TaxRecord[],rules:TaxRecord[],minimum=2) {
  const groups=new Map<string,TaxRecord[]>();
  for(const tx of transactions){
    const key=merchantKey(tx);
    // Never offer generic payment labels as a blanket merchant rule.
    if(!specificMerchant(key))continue;
    if(rules.some(rule=>ruleMatches(rule,tx)))continue;
    groups.set(key,[...(groups.get(key)||[]),tx]);
  }
  return [...groups].filter(([,rows])=>rows.length>=minimum)
    .sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0]))
    .map(([merchant,rows])=>({merchant,rows,count:rows.length}));
}
export function bulkTransactionData(transaction:TaxRecord,choice:BulkChoice):TransactionData {
  const business=choice.scope==="business"||choice.scope==="mixed";
  return {
    ...(transaction.data as TransactionData),
    scope:choice.scope,
    business_id:business?choice.business_id:null,
    business_percent:choice.scope==="business"?100:choice.scope==="mixed"?choice.business_percent:0,
    category:business?choice.category:"uncategorized",
    review_status:"confirmed",
    // Reclassifying a transaction never carries an old deductible-expense approval.
    deduction_confirmed:false,
    deduction_percent:null,
    manual_override:true,
    rule_id:null,
    question:"",
  };
}

import type { TaxRecord } from "./types.ts";

/** Shared metadata is limited to owners' reusable businesses, accounts and rules. All year records stay scoped. */
export function selectTaxAssistantEvidence(records:TaxRecord[],year:number,message:string,limit=160){
  const transactions=records.filter(record=>!record.archived&&record.kind==="transaction"&&record.tax_year===year);
  const words=message.toLowerCase().split(/\W+/).filter(word=>word.length>=4);
  const sorted=transactions.map(record=>({record,score:words.reduce((score,word)=>score+(String(record.data.description).toLowerCase().includes(word)?5:0),record.data.review_status==="needs_review"?1:0)})).sort((a,b)=>b.score-a.score);
  const visible=sorted.slice(0,limit).map(({record})=>record);
  const metadata=records.filter(record=>!record.archived&&(["business","account","rule"].includes(record.kind)||record.kind==="year"&&record.tax_year===year));
  return {transactions,visible,metadata,evidence:[...metadata,...visible]};
}
export function taxProposalMatchesYear(record:TaxRecord,kind:string,year:number){return record.kind===kind&&!record.archived&&(!["year","transaction"].includes(kind)||record.tax_year===year);}

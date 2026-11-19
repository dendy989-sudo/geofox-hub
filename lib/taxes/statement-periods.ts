import type { ImportRow, TaxRecord } from "./types.ts";

export const STATEMENT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"] as const;
const validMonth = (value: unknown):number|null => Number.isInteger(value) && Number(value)>=1 && Number(value)<=12 ? Number(value) : null;

export function statementVisibleInYear(record:TaxRecord,year:number):boolean {
  if(record.archived || record.kind!=="statement")return false;
  const includes=(key:string)=>Array.isArray(record.data[key]) && (record.data[key] as unknown[]).includes(year);
  return record.tax_year===year || includes("years_in_statement") || includes("imported_years");
}

/** Coverage is the statement's named month, never a month inferred from its transactions. */
export function bankStatementCoverage(records:TaxRecord[],accountId:string,year:number){
  return STATEMENT_MONTHS.map((label,index)=>{
    const statements=records.filter(record=>!record.archived&&record.kind==="statement"&&record.data.document_type==="bank_statement"&&record.data.account_id===accountId&&record.tax_year===year&&validMonth(record.data.statement_month)===index+1);
    const onFile=statements.some(record=>record.data.status!=="awaiting_upload");
    return {month:index+1,label,onFile,count:statements.length,needsVerification:!onFile&&statements.length>0};
  });
}
export function statementYearGroups(rows:Pick<ImportRow,"date">[]):{year:number,count:number}[]{
  const years=new Map<number,number>();
  for(const row of rows){const year=Number(row.date.slice(0,4));if(Number.isInteger(year))years.set(year,(years.get(year)??0)+1);}
  return [...years].sort((a,b)=>a[0]-b[0]).map(([year,count])=>({year,count}));
}

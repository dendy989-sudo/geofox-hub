import {parseAmountCents} from "./model.ts";
import {dateSchema} from "./validation.ts";
import type {ImportRow} from "./types.ts";
export interface CsvMapping {date:string;description:string;amount?:string;debit?:string;credit?:string;date_format?:"mdy"|"dmy"|"ymd";invert_amount?:boolean;}
export function readCsv(text:string):string[][] {
  const source=text.replace(/^\uFEFF/,"");
  const firstLine=source.split(/\r?\n/,1)[0];
  const delimiter=firstLine.includes("\t")&&!firstLine.includes(",")?"\t":firstLine.includes(";")&&!firstLine.includes(",")?";":",";
  const rows:string[][]=[];let row:string[]=[];let cell="";let quoted=false;
  for(let i=0;i<source.length;i++){
    const char=source[i];
    if(char==='"'){
      if(quoted&&source[i+1]==='"'){cell+='"';i++;}else if(quoted||cell==="")quoted=!quoted;else throw new Error("A CSV quote is not valid. Export the bank statement as a standard CSV and try again.");
    }else if(char===delimiter&&!quoted){row.push(cell);cell="";}
    else if((char==="\n"||char==="\r")&&!quoted){if(char==="\r"&&source[i+1]==="\n")i++;row.push(cell);if(row.some(value=>value.trim()))rows.push(row);row=[];cell="";}
    else cell+=char;
    if(rows.length>10005)throw new Error("This file has too many rows. Upload smaller statements of at most 2,000 transactions each.");
  }
  if(quoted)throw new Error("A quoted CSV field was not closed. Check the export before importing.");
  row.push(cell);if(row.some(value=>value.trim()))rows.push(row);
  return rows;
}
const key=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,"");
export function suggestCsvMapping(headers:string[]):Partial<CsvMapping>{
  const choose=(names:string[])=>headers.find(header=>names.includes(key(header)));
  return {date:choose(["date","transactiondate","postingdate","posteddate","postdate"]),description:choose(["description","transactiondescription","payee","merchant","name","memo"]),amount:choose(["amount","transactionamount"]),debit:choose(["debit","debits","withdrawal","withdrawals","debitamount"]),credit:choose(["credit","credits","deposit","deposits","creditamount"]),date_format:"mdy",invert_amount:false};
}
export function parseBankDate(raw:string,format:"mdy"|"dmy"|"ymd"="mdy"):string {
  const text=raw.trim().split(/[T ]/)[0];let result=text;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)){
    const match=text.match(/^(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})$/);if(!match)throw new Error(`The date “${raw.slice(0,30)}” could not be read. Choose the matching date format.`);
    let year:number,month:number,day:number;
    if(format==="ymd"||match[1].length===4){year=Number(match[1]);month=Number(match[2]);day=Number(match[3]);}
    else {year=Number(match[3]);month=Number(match[format==="dmy"?2:1]);day=Number(match[format==="dmy"?1:2]);}
    if(year<100)year+=2000;
    result=`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  }
  if(!dateSchema.safeParse(result).success)throw new Error(`The date “${raw.slice(0,30)}” is not a valid calendar date.`);
  return result;
}
export function parseStatementCsv(text:string,year:number,mapping?:CsvMapping,forceMapping=false):{headers:string[];sample:string[][];suggested_mapping:Partial<CsvMapping>;needs_mapping:boolean;rows:ImportRow[];warnings:string[]} {
  void year;
   const csv=readCsv(text);if(csv.length<2)throw new Error("The CSV has no transaction rows.");
  let headerIndex=csv.findIndex((row,index)=>index<15&&Boolean(suggestCsvMapping(row).date)&&Boolean(suggestCsvMapping(row).description));
  if(headerIndex<0)headerIndex=0;
  const headers=csv[headerIndex].map(value=>value.trim());
  if(new Set(headers).size!==headers.length)throw new Error("The CSV has duplicate column headings. Give each column a unique heading before uploading.");
  const suggested=suggestCsvMapping(headers), chosen=mapping??suggested;
  const base={headers,sample:csv.slice(headerIndex+1,headerIndex+6),suggested_mapping:suggested};
  if(forceMapping||!chosen.date||!chosen.description||(!chosen.amount&&!chosen.debit&&!chosen.credit))return {...base,needs_mapping:true,rows:[],warnings:[]};
  for(const field of [chosen.date,chosen.description,chosen.amount,chosen.debit,chosen.credit].filter(Boolean))if(!headers.includes(field!))throw new Error("A selected CSV column is missing. Choose the matching column names.");
  if(chosen.amount&&(chosen.debit||chosen.credit))throw new Error("Choose either one signed amount column or separate debit and credit columns.");
  const rows:ImportRow[]=[];
  const at=(row:string[],name?:string)=>name?row[headers.indexOf(name)]?.trim()??"":"";
  for(let index=headerIndex+1;index<csv.length;index++){
    const row=csv[index];if(row.length!==headers.length)throw new Error(`CSV row ${index+1} has a different number of columns. Check this row before importing.`);
    const date=parseBankDate(at(row,chosen.date),chosen.date_format);
    // Keep all posted dates, including transactions from adjacent years in the same original.
    const description=at(row,chosen.description);if(!description)throw new Error(`CSV row ${index+1} needs a description.`);
    let amount:number;
    try{
      if(chosen.amount)amount=parseAmountCents(at(row,chosen.amount))*(chosen.invert_amount?-1:1);
      else {const debitText=at(row,chosen.debit),creditText=at(row,chosen.credit);if(!debitText&&!creditText)throw new Error("Both amounts are empty.");const debit=debitText?parseAmountCents(debitText):0,credit=creditText?parseAmountCents(creditText):0;if(debit<0||credit<0||debit&&credit)throw new Error("Use separate positive debit/credit values, with only one nonzero amount per row.");amount=credit-debit;}
    }catch(error){throw new Error(`CSV row ${index+1}: ${error instanceof Error?error.message:"Check the amount."}`);}
    rows.push({date,description:description.slice(0,1000),vendor:description.slice(0,300),amount_cents:amount,source_row:index+1});
  }
  if(rows.length>2000)throw new Error("This statement has more than 2,000 transactions. Split the export into smaller files; no rows were imported.");
  return {...base,needs_mapping:false,rows,warnings:["Check the direction of money: incoming must be positive and outgoing must be negative.","CSV files usually do not include statement opening and closing balances. Compare the imported totals with your bank statement."]};
}

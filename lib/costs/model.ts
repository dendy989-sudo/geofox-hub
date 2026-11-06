import { z } from 'zod';
export const configSchema = z.object({
 name:z.string().trim().min(1).max(160), kind:z.enum(['prepaid','subscription','usage','annual','one_time']).default('usage'),
 active:z.boolean().default(true), autoReload:z.enum(['off','on','unknown']).default('unknown'),
 fixedMonthlyCents:z.number().int().min(0).max(100000000).nullable().default(null),
 monthlyBudgetCents:z.number().int().positive().max(100000000).nullable().default(null),
 renewalDate:z.iso.date().nullable().default(null), warningBalance:z.number().min(0).max(1000000).default(10), criticalBalance:z.number().min(0).max(1000000).default(5),
 usageLimit:z.number().positive().max(1e12).nullable().default(null), usageUnit:z.string().max(60).default('units'), usagePeriod:z.enum(['daily','monthly']).default('monthly'),
 warningPercent:z.number().min(1).max(99).default(80), criticalPercent:z.number().min(1).max(100).default(90), notes:z.string().max(2000).default(''),
}).strict().refine(c=>c.warningBalance>=c.criticalBalance && c.warningPercent<c.criticalPercent,'Warning thresholds must come before critical thresholds.');
export type CostConfig=z.infer<typeof configSchema>;
export interface Sample { captured_at:string; balance_usd:number|string|null; cumulative_usd:number|string|null; usage_count:number|string|null; usage_period:string|null; error:string|null; source:string; }
export interface Service { id:string; connector:'gateway'|'isbn'|'manual'; app_slug:string|null; config:CostConfig; version:number; latest:Sample|null; good:Sample|null; monthStart:Sample|null; monthEnd:Sample|null; weekStart:Sample|null; }
export interface CostAlert { key:string; serviceId?:string; service_id?:string; severity:'warning'|'critical'|'exhausted'; title:string; detail:string; active?:boolean; revision?:number; email_state?:string; }
export interface CostDashboard {services:Service[]; alerts:CostAlert[]; cash:{paid:number;pending:number;count:number}; monitor:{enabled:boolean;emailEnabled:boolean;lastStartedAt:string|null;lastCompletedAt:string|null};month:string;emailConfigured:boolean;}
export function value(n:unknown):number|null { if(n===null||n===undefined||n==='')return null;const v=Number(n);return Number.isFinite(v)?v:null; }
export function localDate(now=new Date()){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);return ['year','month','day'].map(k=>p.find(x=>x.type===k)!.value).join('-');}
export function observedSpend(s:Service){const a=value(s.monthStart?.cumulative_usd),b=value(s.monthEnd?.cumulative_usd);return a!==null&&b!==null&&b>=a?b-a:null;}
export function burnRate(s:Service){
 const a=value(s.weekStart?.cumulative_usd),b=value(s.good?.cumulative_usd);
 const days=(Date.parse(s.good?.captured_at??'')-Date.parse(s.weekStart?.captured_at??''))/86400000;
 if(a===null||b===null||b<a||days<1||days>8)return null;
 return (b-a)/days;
}
export function assess(s:Service,now=Date.now()):{alerts:CostAlert[];gap:string|null;fresh:boolean;dailyRate:number|null;runway:number|null;reloadAmount:number|null;reloadTrigger:number|null} {
 const c=configSchema.parse(s.config), alerts:CostAlert[]=[];
 const add=(key:string,severity:CostAlert['severity'],title:string,detail:string)=>alerts.push({key:`${s.id}:${key}`,serviceId:s.id,severity,title:`${c.name}: ${title}`,detail});
 const age=now-Date.parse(s.good?.captured_at??''),fresh=!!s.good&&!s.latest?.error&&age>=-60000&&age<(s.connector==='manual'?86400000:1800000);
 const dailyRate=fresh?burnRate(s):null,balance=value(s.good?.balance_usd),runway=dailyRate&&balance!==null?Math.max(0,balance)/dailyRate:null;
 let gap:string|null=null;
 if(!c.active)return {alerts:[],gap:null,fresh:false,dailyRate:null,runway:null,reloadAmount:null,reloadTrigger:null};
 if(s.connector==='manual'&&!s.good)gap='No live billing feed. Enter a dated usage reading and actual bills; unknown is not zero.';
 else if(s.connector!=='manual'&&(!fresh)){gap=s.latest?.error??'Live reading is missing or stale.';add('connection','warning','monitoring needs attention',gap);}
 else if(!fresh)gap='Manual reading is stale; update it before relying on usage warnings.';
 if(c.kind==='prepaid'&&balance!==null){
  if(balance<=c.warningBalance)add('balance',balance<=0?'exhausted':balance<=c.criticalBalance?'critical':'warning','credit is running low',`Last reported balance $${balance.toFixed(2)}${fresh?'':' (stale reading)'}. Auto-reload is ${c.autoReload} (owner-recorded). Add credit in the provider dashboard; Geofox never purchases credit.`);
  if(runway!==null&&runway<=7)add('runway',runway<=2?'critical':'warning','estimated credit runway is short',`About ${runway.toFixed(1)} days at the observed average. This forecast is not a guarantee; sudden traffic can spend faster.`);
 }
 const expectedPeriod=new Date(now).toISOString().slice(0,c.usagePeriod==='daily'?10:7);
 const used=value(s.good?.usage_count);
 if(c.usageLimit&&used!==null&&s.good?.usage_period===expectedPeriod){const pct=100*used/c.usageLimit;if(pct>=c.warningPercent)add('quota',pct>=100?'exhausted':pct>=c.criticalPercent?'critical':'warning','usage allowance warning',`${used.toLocaleString()} / ${c.usageLimit.toLocaleString()} ${c.usageUnit} (${pct.toFixed(1)}%)${fresh?'':' (last known, stale reading)'}. ${s.connector==='isbn'?'NovaNook telemetry only; other account usage is not included.':''}`);}
 if(s.connector==='manual'&&c.kind==='usage'&&!c.usageLimit)gap='The provider allowance is not entered; usage percentages cannot be monitored yet.';
 if(s.connector==='isbn'&&!c.usageLimit)gap='Live request telemetry can be read, but the provider allowance must be entered before percentage alerts work.';
 if(c.renewalDate){const days=Math.floor((Date.parse(c.renewalDate+'T12:00:00Z')-Date.parse(localDate(new Date(now))+'T12:00:00Z'))/86400000);if(days<=7)add('renewal',days<0?'critical':'warning',days<0?'bill or renewal needs review':'bill or renewal approaching',`${c.renewalDate}. Confirm payment/renewal and update this date; no payment is made automatically.`);}
 const spend=observedSpend(s);if(c.monthlyBudgetCents&&spend!==null&&s.monthEnd?.captured_at.slice(0,7)===new Date(now).toISOString().slice(0,7)&&spend*100>=c.monthlyBudgetCents*c.warningPercent/100)add('budget',spend*100>=c.monthlyBudgetCents?'critical':'warning','tracked usage budget warning',`Observed consumption $${spend.toFixed(2)} against $${(c.monthlyBudgetCents/100).toFixed(2)}. Tracking may cover only part of this month.`);
 return {alerts,gap,fresh,dailyRate,runway,reloadAmount:dailyRate&&dailyRate>0?Math.ceil(Math.max(25,dailyRate*30)/5)*5:null,reloadTrigger:dailyRate&&dailyRate>0?Math.ceil(Math.max(c.warningBalance,dailyRate*7)/5)*5:null};
}

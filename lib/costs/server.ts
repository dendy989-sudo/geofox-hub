import 'server-only';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createGateway } from 'ai';
import { z } from 'zod';
import { getHubContext, getHubService, HubError, databaseError, capabilitiesForRole, type HubContext } from '@/lib/hub/server';
import { workspaceAccessFor } from '@/lib/workspace/access';
import { saveWorkspaceRecord } from '@/lib/workspace/server';
import { novaIsbnOverview } from '@/lib/integrations/novanook';
import { supportEmailSettings } from '@/lib/integrations/email-config';
import { classifyAlfredFailure } from '@/lib/alfred/failure';
import { configSchema, assess, localDate, value, type CostDashboard } from './model';
const db = () => getHubService();
function check(error:{code?:string}|null){if(error?.code==='40001')throw new HubError(409,'COST_CHANGED','This record changed. Refresh before saving.');if(error)databaseError(error);}
async function rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{const r=await db().rpc(name,args);check(r.error);return r.data as T;}
export async function costContext(){const c=await getHubContext();if(c.staff.role!=='owner')throw new HubError(403,'OWNER_REQUIRED','Company cost monitoring is owner-only.');return c;}
export function costEmailConfigured(){return !!(process.env.RESEND_API_KEY&&supportEmailSettings());}
export async function costDashboard(c:HubContext,scope='all',month=localDate().slice(0,7)){
 const data=await rpc<CostDashboard>('hub_cost_dashboard',{p_actor:c.user.id,p_scope:scope,p_month:month});
 data.services=data.services.map(s=>({...s,config:configSchema.parse(s.config)}));data.emailConfigured=costEmailConfigured();return data;
}
async function sample(row:Record<string,unknown>){const r=await db().from('hub_cost_samples').insert(row);check(r.error);}
export async function monitorContext():Promise<HubContext|null>{
 const {data:s,error}=await db().from('hub_cost_monitor').select('enabled,owner_id').eq('singleton',true).single();check(error);if(!s?.enabled||!s.owner_id)return null;
 await rpc('hub_alfred_owner',{p_actor:s.owner_id});
 const {data:apps,error:e}=await db().from('hub_apps').select('slug,name,color,website').eq('active',true);check(e);
 return {user:{id:s.owner_id,email:''},staff:{role:'owner',displayName:'Owner-authorized cost monitor'},apps:(apps??[]).map(a=>({...a,configured:true})),capabilities:capabilitiesForRole('owner'),workspaceAccess:workspaceAccessFor('owner'),setupIssues:[]};
}
async function sendAlerts(c:HubContext){
 if(!costEmailConfigured())return;
 const user=await db().auth.admin.getUserById(c.user.id);
 if(user.error||!user.data.user?.email||!user.data.user.email_confirmed_at)return;
 await rpc('hub_alfred_owner',{p_actor:c.user.id});
 const alerts=await rpc<Array<{key:string;revision:number;title:string;detail:string}>>('hub_cost_claim_mail',{p_actor:c.user.id});
 if(!alerts.length)return;
 const id=createHash('sha256').update(alerts.map(a=>`${a.key}:${a.revision}`).sort().join('|')).digest('hex');
 let state='uncertain';
 try{
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`geofox-cost-${id}`},body:JSON.stringify({from:supportEmailSettings()!.from,to:[user.data.user.email],subject:`Geofox: ${alerts.length} service usage / billing alert${alerts.length===1?'':'s'}`,text:alerts.map(a=>`${a.title}\n${a.detail}`).join('\n\n')+'\n\nReview Accounting → Usage & bills in Geofox Hub.\nhttps://www.geofoxapps.com/admin#accounting/costs\n\nNo credits were purchased and no provider billing settings were changed.'}),signal:AbortSignal.timeout(10000),cache:'no-store'});
  if(response.ok){const receipt=await response.json();state=typeof receipt.id==='string'?'accepted':'uncertain';}else state=response.status>=400&&response.status<500?'failed':'uncertain';
 }catch{/* Unknown delivery is not retried automatically. */}
 for(const a of alerts){const r=await db().from('hub_cost_alerts').update({email_state:state}).eq('key',a.key).eq('email_revision',a.revision).eq('email_state','pending');check(r.error);}
}
export async function syncCosts(context?:HubContext){
 const c=context??await monitorContext();if(!c)return {skipped:true,reason:'Monitoring disabled.'};
 const lease=randomUUID();if(!await rpc<boolean>('hub_cost_claim',{p_actor:c.user.id,p_lease:lease}))return {skipped:true,reason:'A recent or current check already covers this request.'};
 const {data:services,error}=await db().from('hub_cost_services').select('id,connector,app_slug,config');check(error);
 for(const s of services??[]){
  if(!configSchema.parse(s.config).active||s.connector==='manual')continue;
  try{
   if(s.connector==='gateway'){
    // The fixed SDK endpoint uses the same project authentication as Alfred. No generation or top-up request.
    const gateway=createGateway({fetch:(url,init)=>fetch(url,{...init,cache:'no-store',signal:AbortSignal.timeout(8000)})});
    const credits=await gateway.getCredits();const balance=value(credits.balance),used=value(credits.totalUsed);
    if(balance===null||used===null||used<0)throw new Error('Invalid credit response');
    await sample({service_id:s.id,source:'gateway',balance_usd:balance,cumulative_usd:used});
   }else if(s.connector==='isbn'){
    const report=await novaIsbnOverview(c);
    await sample({service_id:s.id,source:'isbn',captured_at:report.capturedAt,usage_count:report.today.requests,usage_period:report.today.date});
   }
  }catch(e){
   const code=s.connector==='gateway'?classifyAlfredFailure(e).code:'ISBN_TELEMETRY_UNAVAILABLE';
   await sample({service_id:s.id,source:s.connector,error:`${code}: the latest reading could not be confirmed. Check the provider connection; previous readings are not current.`});
  }
 }
 const dashboard=await costDashboard(c);const alerts=dashboard.services.flatMap(s=>assess(s).alerts);
 await rpc('hub_cost_publish',{p_actor:c.user.id,p_lease:lease,p_alerts:alerts});await sendAlerts(c);
 return {checked:true,activeAlerts:alerts.length};
}
export function authenticateCostCron(request:Request){
 const expected=Buffer.from(process.env.CRON_SECRET?`Bearer ${process.env.CRON_SECRET}`:'');const actual=Buffer.from(request.headers.get('authorization')??'');
 if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new HubError(401,'AUTH_REQUIRED','Scheduled access is not authorized.');
}
export async function mutateCost(c:HubContext,input:Record<string,unknown>){
 if(c.staff.role!=='owner')throw new HubError(403,'OWNER_REQUIRED','Owner access required.');
 const permitted=await rpc<boolean>('hub_reserve_rate_limit',{p_key_hash:createHash('sha256').update(`cost-mutation:${c.user.id}`).digest('hex'),p_window_seconds:60,p_limit:30});
 if(!permitted)throw new HubError(429,'RATE_LIMITED','Please wait before making more changes.');
 const id=z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/);
 switch(input.operation){
  case 'refresh':return syncCosts(c);
  case 'service':{
   const p=z.object({id,version:z.number().int().positive().nullable(),appSlug:z.string().max(48).nullable(),config:configSchema}).parse(input.payload);
   await rpc('hub_cost_save',{p_actor:c.user.id,p_id:p.id,p_version:p.version,p_app:p.appSlug,p_config:p.config});return {saved:true};
  }
  case 'reading':{
   const p=z.object({id,balance:z.number().min(0).max(1e9).nullable(),used:z.number().min(0).max(1e12).nullable(),period:z.string().regex(/^20\d\d-(0[1-9]|1[012])(?:-(0[1-9]|[12]\d|3[01]))?$/).nullable()}).parse(input.payload);
   const service=await db().from('hub_cost_services').select('connector').eq('id',p.id).single();check(service.error);
   if(service.data?.connector!=='manual')throw new HubError(400,'PROVIDER_OWNED','Live provider readings cannot be overridden manually.');
   if(p.balance===null&&p.used===null)throw new HubError(400,'READING_REQUIRED','Enter a balance or usage reading.');
   await sample({service_id:p.id,source:'manual',balance_usd:p.balance,usage_count:p.used,usage_period:p.period});
   const audit=await db().from('hub_audit_log').insert({actor_id:c.user.id,action:'cost.reading.saved',entity_type:'cost',entity_id:p.id,summary:'Owner supplied a dated manual usage reading; no payment made'});check(audit.error);
   return {saved:true};
  }
  case 'bill':{
   const p=z.object({id,requestId:z.uuid(),amountCents:z.number().int().positive().max(100000000),occurredOn:z.iso.date(),status:z.enum(['paid','pending']),reference:z.string().max(200),notes:z.string().max(2000)}).parse(input.payload);
   const s=await db().from('hub_cost_services').select('app_slug,config').eq('id',p.id).single();check(s.error);
   const config=configSchema.parse(s.data!.config);
   return saveWorkspaceRecord(c,{module:'accounting',appSlug:s.data!.app_slug,title:`${config.name} · ${config.kind==='prepaid'?'credit purchase':'bill'}`,status:p.status,requestId:p.requestId,data:{type:'expense',amountCents:p.amountCents,currency:'USD',occurredOn:p.occurredOn,category:'Hosting & infrastructure',payee:config.name,reference:p.reference,notes:`Service: ${p.id}. ${config.kind==='prepaid'?'Prepaid purchase tracked as cash paid, not consumed usage. ':''}${p.notes}`,attachments:[]}});
  }
  default:throw new HubError(400,'INVALID_OPERATION','Choose a valid cost operation.');
 }
}

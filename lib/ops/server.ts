import 'server-only';
import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getHubService,HubError,databaseError,capabilitiesForRole,type HubContext } from '@/lib/hub/server';
import { workspaceAccessFor } from '@/lib/workspace/access';
import { alfredContext,runAlfred } from '@/lib/alfred/server';
import { replyEmailConfigured } from '@/lib/integrations/email';
import { supportEmailSettings } from '@/lib/integrations/email-config';
import { parseSocialConnections,findSocialConnection,supportsDirectPublishing,verifySocialIdentity } from '@/lib/workspace/marketing-providers';
import { publishMarketingPost } from '@/lib/workspace/marketing-server';
import { getWorkspaceRecord } from '@/lib/workspace/server';
import type { MarketingPost } from '@/lib/workspace/marketing-types';
import { stableId,sensitiveCase,readVercelCharges,boundedText } from './policy';
export const db=()=>getHubService();
export function check(e:{code?:string}|null){if(e?.code==='40001')throw new HubError(409,'WORKFLOW_CHANGED','This item changed or was already claimed. Refresh and review again.');if(e)databaseError(e);}
export async function rpc<T>(name:string,p:Record<string,unknown>):Promise<T>{const r=await db().rpc(name,p);check(r.error);return r.data as T;}
export const ownerContext=alfredContext;
export async function limit(c:HubContext,key:string,max=10){const ok=await rpc('hub_reserve_rate_limit',{p_key_hash:createHash('sha256').update(`ops:${c.user.id}:${key}`).digest('hex'),p_window_seconds:60,p_limit:max});if(!ok)throw new HubError(429,'RATE_LIMITED','Please wait before repeating this operation.');}
export async function audit(c:HubContext,action:string,id:string,summary:string){const r=await db().from('hub_audit_log').insert({actor_id:c.user.id,action,entity_type:'alfred_operations',entity_id:id,summary});check(r.error);}
export function socialConnections(){try{return parseSocialConnections(process.env.MARKETING_SOCIAL_ACCOUNTS);}catch{throw new HubError(503,'SOCIAL_CONFIG','The social-account configuration needs review. No token is shown in the Hub.');}}
export async function recordCheck(key:string,state:'verified'|'blocked'|'failed'|'configured',summary:string,data:unknown={}){const r=await db().from('hub_ops_checks').upsert({key,state,summary,data,checked_at:new Date().toISOString()});check(r.error);}
export function readiness(){return [
 {id:'outgoing-email',name:'Owner alerts & support replies',configured:replyEmailConfigured(),need:'RESEND_API_KEY and verified SUPPORT_FROM_EMAIL',steps:'Verify the sending domain in Resend, then add the server-only key and sender in Vercel. Send a test from this page. Keep the GoDaddy mailbox and existing MX records.'},
 {id:'inbound-email',name:'Incoming support email',configured:!!(process.env.RESEND_API_KEY&&process.env.RESEND_WEBHOOK_SECRET&&process.env.ALFRED_INBOUND_ADDRESSES),need:'RESEND_WEBHOOK_SECRET and ALFRED_INBOUND_ADDRESSES',steps:'Use a Resend receiving address or a dedicated inbound subdomain. Forward support mail from GoDaddy to it; do not replace root-domain MX records. Configure email.received webhook at /api/alfred/inbound. Mail enters owner review, not verified customer accounts.'},
 {id:'vercel-billing',name:'Vercel billing report',configured:!!(process.env.VERCEL_ACCESS_TOKEN&&process.env.VERCEL_TEAM_ID),need:'Existing Vercel token with billing read access',steps:'The existing token is checked without changing provider settings. Billing is day-granularity and separate from cash payments; it can overlap credit purchases.'},
 {id:'github-billing',name:'GitHub Actions billing',configured:!!process.env.GITHUB_BILLING_TOKEN,need:'GITHUB_BILLING_TOKEN (Plan read permission)',steps:'Create a narrowly scoped user billing credential and place it in Vercel. It is separate from repository access. No allowance or subscription price is assumed.'},
 {id:'social',name:'Social accounts & approved scheduling',configured:!!process.env.MARKETING_SOCIAL_ACCOUNTS,need:'MARKETING_SOCIAL_ACCOUNTS',steps:'Connect the exact Facebook Page or X account with its own scoped token using docs/social-connections.md. Only explicitly approved text posts are scheduled here. Instagram/TikTok publishing and video rendering remain separate integrations.'},
 {id:'github-repairs',name:'Engineering draft pull requests',configured:!!process.env.ALFRED_GITHUB_TOKEN,need:'ALFRED_GITHUB_TOKEN (selected repos only)',steps:'Use a fine-grained token for geofox-hub and Booknook: contents and pull requests write, checks/actions read. Only owner-approved, bounded UI patches can create draft PRs. Merging and production deployment remain manual in GitHub after CI.'},
 {id:'other-billing',name:'Supabase and other provider invoices',configured:false,need:'Actual invoice records / billing integrations',steps:'Use the reviewed invoice import here for Supabase, Google, GoDaddy, app stores, Codemagic and other bills. App database keys do not grant organization billing access. No bank feed, tax filing or payment automation is enabled.'},
 ];}
export async function getOperations(c:HubContext){
 const rows=await Promise.all([
 db().from('hub_ops_settings').select('*').eq('singleton',true).single(),db().from('hub_ops_jobs').select('*').order('created_at',{ascending:false}).limit(60),
 db().from('hub_ops_checks').select('*').order('checked_at',{ascending:false}),db().from('hub_ops_mail').select('*').eq('state','review').order('received_at',{ascending:false}).limit(30),
 db().from('hub_ops_repairs').select('id,app_slug,repo,base_sha,summary,files,state,result,created_at').order('created_at',{ascending:false}).limit(12),
 db().from('hub_workspace_records').select('id,title,version,app_slug,status,data').eq('module','marketing').is('deleted_at',null).in('status',['draft','scheduled','published']).order('updated_at',{ascending:false}).limit(60),
 db().from('hub_cost_services').select('id,app_slug,config').order('id')]);rows.forEach(r=>check(r.error));
 return {settings:rows[0].data,jobs:rows[1].data,checks:rows[2].data,inbound:rows[3].data,repairs:rows[4].data,posts:rows[5].data,services:rows[6].data,connections:readiness(),accounts:socialConnections().map(a=>({appSlug:a.appSlug,platform:a.platform,accountId:a.accountId,handle:a.handle})),apps:c.apps};
}
export async function syncBilling(force=false){
 const prior=await db().from('hub_ops_checks').select('key,checked_at,state').in('key',['vercel-billing','github-billing']);check(prior.error);
 for(const provider of ['vercel-billing','github-billing']){
 if(!force&&prior.data?.some(p=>p.key===provider&&p.state==='verified'&&Date.now()-Date.parse(p.checked_at)<3600000))continue;
 const key=provider==='vercel-billing'?process.env.VERCEL_ACCESS_TOKEN:process.env.GITHUB_BILLING_TOKEN;
 if(!key){await recordCheck(provider,'blocked','A server-side billing credential is required. No usage or cost is assumed.');continue;}
 try{
 const now=new Date(),month=now.toISOString().slice(0,7);let url:string;
 if(provider==='vercel-billing'){
  if(!process.env.VERCEL_TEAM_ID)throw new Error('Team missing');
  url=`https://api.vercel.com/v1/billing/charges?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}&from=${month}-01T00:00:00.000Z&to=${new Date().toISOString()}`;
 }else url=`https://api.github.com/users/dendy989-sudo/settings/billing/usage?year=${now.getUTCFullYear()}&month=${now.getUTCMonth()+1}`;
 const r=await fetch(url,{headers:{Authorization:`Bearer ${key}`,Accept:provider==='vercel-billing'?'application/x-ndjson':'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!r.ok){await recordCheck(provider,'failed',`Provider returned HTTP ${r.status}. Check billing permissions. Previous costs are not replaced with invented zero values.`);continue;}
 let report:Record<string,unknown>;
 if(provider==='vercel-billing')report=await readVercelCharges(r);else{
 const parsed=JSON.parse(await boundedText(r,3000000));if(!Array.isArray(parsed.usageItems)||parsed.usageItems.length>20000)throw new Error('Unexpected billing format');
 const rows=parsed.usageItems;let net=0;for(const item of rows){if(!Number.isFinite(item.netAmount))throw new Error('Incomplete usage amount');net+=item.netAmount;}
 report={netUsd:net,returnedRows:rows.length,usage:rows.slice(0,100).map((p:Record<string,unknown>)=>({product:p.product,sku:p.sku,quantity:p.quantity,unit:p.unitType,netAmount:p.netAmount})),note:'Provider usage charges in returned report, not payment confirmation or your plan allowance. Included, billed and raw runner minutes can differ.'};}
 await recordCheck(provider,'verified','Read-only provider report received. Coverage is limited to returned rows; zero rows do not verify zero company cost. Not added to cash totals.',{month,...report});
 }catch(e){const code=e instanceof Error&&['FOCUS_REPORT_LIMIT','FOCUS_SCHEMA_INVALID'].includes(e.message)?e.message:e instanceof Error&&e.name==='TimeoutError'?'BILLING_TIMEOUT':'BILLING_UNVERIFIED';await recordCheck(provider,'failed',`[${code}] Billing report could not be verified. Check response limits, access or provider availability. Missing costs remain unknown.`,{diagnostic:code});}
 }
}
async function workflowContext(){const r=await db().from('hub_ops_settings').select('*').eq('singleton',true).single();check(r.error);const s=r.data;if(!s?.enabled||!s.owner_id)return null;await rpc('hub_alfred_owner',{p_actor:s.owner_id});const apps=await db().from('hub_apps').select('slug,name,color,website').eq('active',true);check(apps.error);const c:HubContext={user:{id:s.owner_id,email:''},staff:{role:'owner',displayName:'Owner-authorized Alfred workflows'},apps:(apps.data??[]).map(a=>({...a,configured:true})),capabilities:capabilitiesForRole('owner'),workspaceAccess:workspaceAccessFor('owner'),setupIssues:[]};return {s,c};}
async function finishJob(id:string,state:string,message:string,runId?:string){const r=await db().from('hub_ops_jobs').update({state,result:{message},finished_at:new Date().toISOString(),...(runId?{run_id:runId}:{})}).eq('id',id).eq('state','running');check(r.error);}
export async function runWorkflowTick(){
 const context=await workflowContext();if(!context)return {skipped:true};const {s,c}=context;
 await syncBilling();
 const scheduled=await rpc<{id:string;ref_id:string;payload:Record<string,unknown>}|null>('hub_ops_take_scheduled',{p_actor:c.user.id});
 if(scheduled){try{const control=await db().from('hub_alfred_settings').select('enabled').eq('singleton',true).single();check(control.error);if(!control.data?.enabled)throw new HubError(409,'ALFRED_PAUSED','Alfred was paused before publication started. No post sent.');await publishMarketingPost(c,{id:scheduled.ref_id,...scheduled.payload});await finishJob(scheduled.id,'completed','Approved post accepted by the provider.');}catch(e){await finishJob(scheduled.id,'needs_review',e instanceof HubError?e.message:'Publication outcome uncertain; inspect the native account before retrying.');}return {publicationProcessed:true};}
 const controls=await db().from('hub_alfred_settings').select('enabled,consent_at').eq('singleton',true).single();check(controls.error);if(!controls.data?.enabled||!controls.data.consent_at)return {paused:true};
 if(s.support_enabled){const tickets=await db().from('hub_tickets').select('id,updated_at,app_slug,category,subject').in('status',['open','in_progress']).order('updated_at',{ascending:false}).limit(20);check(tickets.error);
 for(const t of tickets.data??[]){
 const latest=await db().from('hub_ticket_messages').select('id,body,author_kind').eq('ticket_id',t.id).eq('internal',false).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();check(latest.error);if(!latest.data||!['customer','guest'].includes(latest.data.author_kind))continue;
 const pending=await db().from('hub_alfred_actions').select('id').eq('kind','support_reply').in('state',['pending','executing']).contains('payload',{ticketId:t.id}).limit(1);check(pending.error);if(pending.data?.length)continue;
 const key=`support:${t.id}:${latest.data.id}`,id=stableId(key);if(!await rpc('hub_ops_claim',{p_actor:c.user.id,p_id:id,p_key:key,p_kind:'support',p_ref:t.id,p_payload:{ticketUpdatedAt:t.updated_at}}))continue;
 if(sensitiveCase(t.category,t.subject+' '+latest.data.body)){await finishJob(id,'needs_review','Sensitive account, billing, legal or safety issue. Owner review required; no reply generated or sent.');return {escalated:true};}
 try{const run=await runAlfred(c,{requestId:id,scope:t.app_slug,department:'support',ticketId:t.id,question:'Prepare a helpful draft for this active ticket using approved knowledge and evidence. Do not send anything. Unverified email or web senders must not receive account-specific data; ask for safe verification through the app. Escalate uncertainty. No promises of fixes.'});await finishJob(id,run.state==='completed'?'completed':'needs_review','Support investigation '+run.state+'. Customer replies remain in Approvals.',run.id);}catch(e){await finishJob(id,'needs_review',e instanceof HubError?e.message:'Investigation interrupted; check Activity. No automatic retry.');}return {supportProcessed:true};
 }}
 if(s.incidents_enabled){const errors=await db().from('hub_errors').select('id,app_slug,title').in('status',['open','investigating']).order('last_seen',{ascending:false}).limit(10);check(errors.error);for(const e of errors.data??[]){const key=`incident:${e.id}:${new Date().toISOString().slice(0,10)}`,id=stableId(key);if(!await rpc('hub_ops_claim',{p_actor:c.user.id,p_id:id,p_key:key,p_kind:'incident',p_ref:e.id,p_payload:{}}))continue;
 try{const run=await runAlfred(c,{requestId:id,scope:e.app_slug,department:'engineering',question:`Review recorded errors for this app, including incident ${e.id}. Separate evidence from hypotheses, propose safe reproduction and test tasks. Do not claim to access source code, fix, deploy or close incidents.`,ticketId:null});await finishJob(id,run.state==='completed'?'completed':'needs_review','Incident investigation '+run.state+'. No production changes.',run.id);}catch(e){await finishJob(id,'needs_review',e instanceof HubError?e.message:'Incident investigation could not be confirmed.');}return {incidentProcessed:true};}}
 return {checked:true,noNewDrafts:true};
}
export async function testEmail(c:HubContext,id:string){
 if(!replyEmailConfigured())throw new HubError(409,'EMAIL_NOT_CONNECTED','Configure the verified sender and Resend key first.');
 const user=await db().auth.admin.getUserById(c.user.id);if(!user.data.user?.email_confirmed_at||!user.data.user.email)throw new HubError(403,'VERIFICATION','Owner email verification required.');
 const claim=await db().from('hub_ops_jobs').insert({id,dedupe_key:`email-test:${id}`,kind:'email_test',actor_id:c.user.id});if(claim.error?.code==='23505')return {message:'This test was already attempted. Check its result before sending another.'};check(claim.error);
 try{const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`geofox-alert-test-${id}`},body:JSON.stringify({from:supportEmailSettings()!.from,to:[user.data.user.email],subject:'Geofox Hub · owner alert test',text:'This is the owner-requested Geofox alert test. No customer message was sent and no billing settings were changed.'}),signal:AbortSignal.timeout(12000),redirect:'error'});if(!r.ok)throw new Error('Rejected');const v=JSON.parse(await boundedText(r,20000));if(typeof v.id!=='string')throw new Error('Receipt missing');await finishJob(id,'completed','Provider accepted the owner test email. Confirm it arrived in your inbox.');await recordCheck('outgoing-email','configured','Provider accepted an owner test. Inbox delivery is not verified.',{providerId:v.id});return {message:'Provider accepted the test. Check your owner inbox; acceptance is not proof of delivery.'};}catch{await finishJob(id,'needs_review','Email delivery not confirmed. No automatic resend.');throw new HubError(502,'EMAIL_UNCERTAIN','Test delivery not confirmed. Review Resend and the owner inbox before retrying.');}
}
export async function importBills(c:HubContext,input:unknown){
 const rows=z.array(z.object({serviceId:z.string().min(2).max(64),reference:z.string().trim().min(1).max(120),date:z.iso.date(),amountCents:z.number().int().positive().max(100000000),status:z.enum(['paid','pending'])}).strict()).min(1).max(50).parse(input);
 const keys=new Set<string>();for(const p of rows){const k=p.serviceId+':'+p.reference;if(keys.has(k))throw new HubError(400,'DUPLICATE_REFERENCE','The import repeats a service/invoice reference.');keys.add(k);}
 const result=await rpc<{created:number;alreadyRecorded:number}>('hub_ops_import_bills',{p_actor:c.user.id,p_rows:rows});
 return {message:`Created ${result.created} reviewed invoice records; ${result.alreadyRecorded} already recorded. The batch is atomic and never makes payments.`};
}

export async function schedulePost(c:HubContext,input:unknown){const p=z.object({id:z.uuid(),version:z.number().int().positive(),platform:z.enum(['facebook','x']),accountId:z.string().regex(/^\d{1,40}$/),when:z.iso.datetime()}).strict().parse(input);const record=await getWorkspaceRecord(c,p.id,'write');if(record.version!==p.version||record.module!=='marketing'||record.data.kind!=='post'||!supportsDirectPublishing(record.data as unknown as MarketingPost))throw new HubError(409,'POST_CHANGED','Review a current text-only marketing draft.');const conn=findSocialConnection(socialConnections(),record.appSlug,p.platform);if(!conn||conn.accountId!==p.accountId||!await verifySocialIdentity(conn))throw new HubError(409,'ACCOUNT_NOT_VERIFIED','The exact destination account could not be verified.');const id=randomUUID();await rpc('hub_ops_schedule',{p_actor:c.user.id,p_id:id,p_record:p.id,p_version:p.version,p_platform:p.platform,p_account:p.accountId,p_when:p.when});return {message:'Exact post version approved for scheduled publication. Editing the post invalidates this approval.'};}

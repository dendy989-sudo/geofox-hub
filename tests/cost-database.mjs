import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const owner = '10000000-0000-4000-8000-000000000001';
const support = '10000000-0000-4000-8000-000000000002';
const analyst = '10000000-0000-4000-8000-000000000003';
const inactive = '10000000-0000-4000-8000-000000000004';
const banned = '10000000-0000-4000-8000-000000000005';
const unverified = '10000000-0000-4000-8000-000000000006';
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz);
insert into auth.users values
('${owner}','owner@example.test',now(),null,null),('${support}','support@example.test',now(),null,null),
('${analyst}','analyst@example.test',now(),null,null),('${inactive}','inactive@example.test',now(),null,null),
('${banned}','banned@example.test',now(),now()+interval '1 day',null),('${unverified}','unverified@example.test',null,null,null);
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
create policy existing_broad_policy on storage.objects for all to anon,authenticated using(true) with check(true);
`);
await db.exec(await readFile(new URL('../supabase/migrations/202611030001_geofox_hub.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../supabase/migrations/20261103134124_customer_app_support.sql',import.meta.url),'utf8'));
const bootstrap=await readFile(new URL('../supabase/bootstrap_owner.sql',import.meta.url),'utf8');
await db.exec(bootstrap.replace("owner_email text := 'REPLACE_WITH_YOUR_VERIFIED_COMPANY_EMAIL'","owner_email text := 'owner@example.test'"));
await db.exec(`
insert into public.hub_apps(slug,name,website) values('otherapp','Other app','https://example.test');
insert into public.hub_staff(user_id,display_name,role,active) values
('${support}','Support','support',true),('${analyst}','Analyst','analyst',true),('${inactive}','Inactive','admin',false),('${banned}','Banned','admin',true),('${unverified}','Unverified','admin',true);
insert into public.hub_staff_apps(user_id,app_slug) values('${support}','novanook'),('${analyst}','novanook'),('${inactive}','novanook'),('${banned}','novanook'),('${unverified}','novanook');
`);
const migration=await readFile(new URL('../supabase/migrations/20261104151508_company_workspace.sql',import.meta.url),'utf8');
await db.exec(migration);
async function one(sql,params=[]){return (await db.query(sql,params)).rows[0];}
async function rpc(name,params=[]){const args=params.map((_,i)=>`$${i+1}`).join(','); return (await one(`select public.${name}(${args}) as result`,params)).result;}
const denied=(call,code='42501')=>assert.rejects(call,e=>e.code===code);
const task=(extra={})=>({description:'',priority:'normal',dueDate:null,recurrence:'none',checklist:[],assigneeId:null,...extra});
async function save(actor=owner,{id=null,version=null,module='tasks',app='novanook',title='Task',status='todo',data=task(),request=null}={}){
 return rpc('hub_workspace_save',[actor,id,version,module,app,title,status,JSON.stringify(data),request]);
}
const get=(actor,id)=>rpc('hub_workspace_get',[actor,id]);
const list=(actor,module='tasks',scope='all',limit=200,offset=0)=>rpc('hub_workspace_list',[actor,module,scope,limit,offset]);
const grants=(user,levels,actor=owner)=>rpc('hub_workspace_set_access',[actor,user,JSON.stringify(levels)]);
const can=async(actor,module,action,app)=>rpc('hub_workspace_actor_can',[actor,module,action,app]);
const auditCount=async()=>Number((await one('select count(*) as n from public.hub_audit_log')).n);


await db.exec(await readFile(new URL('../supabase/migrations/20261106135856_alfred_operations.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../supabase/migrations/20261106170049_alfred_failure_diagnostics.sql',import.meta.url),'utf8'));

await db.exec(await readFile(new URL('../supabase/migrations/20261106182943_company_cost_monitor.sql',import.meta.url),'utf8'));

const view=(actor=owner,scope='all')=>rpc('hub_cost_dashboard',[actor,scope,'2026-11']);
const service=(extra={})=>({name:'Test service',kind:'usage',...extra});
test('all cost tables are private and every RPC is server-only',async()=>{
 for(const t of ['hub_cost_services','hub_cost_samples','hub_cost_alerts','hub_cost_monitor']){
 assert.equal((await one('select relrowsecurity from pg_class where oid=$1::regclass',[`public.${t}`])).relrowsecurity,true);
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') as ok",[role,`public.${t}`])).ok,false);
 }
 const fs=(await db.query("select oid::regprocedure::text signature,prosecdef from pg_proc where proname like 'hub_cost_%'")).rows;assert.equal(fs.length,5);
 for(const f of fs){assert.equal(f.prosecdef,false);for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,$2,'EXECUTE') as ok",[role,f.signature])).ok,false);}
 for(const actor of [support,inactive,banned,unverified,randomUUID()])await denied(()=>view(actor));
});
test('service inventory has unknown charges, not fabricated zero invoices',async()=>{const v=await view();assert.equal(v.services.length,11);assert.equal(Number(v.cash.paid),0);assert.ok(v.services.every(s=>s.good===null));});
test('versioned updates reject stale edits and prevent moving a live meter into another app',async()=>{
 await rpc('hub_cost_save',[owner,'custom',null,'novanook',JSON.stringify(service())]);
 await rpc('hub_cost_save',[owner,'custom',1,'novanook',JSON.stringify(service({notes:'new'}))]);
 await denied(()=>rpc('hub_cost_save',[owner,'custom',1,'novanook',JSON.stringify(service())]),'40001');
 await denied(()=>rpc('hub_cost_save',[owner,'ai-gateway',1,'novanook',JSON.stringify(service())]),'40001');
 await denied(()=>rpc('hub_cost_save',[support,'custom',2,'novanook',JSON.stringify(service())]));
});
test('recorded cash aggregates all rows once and respects company vs app scope',async()=>{
 const accounting=(amount,date='2026-11-06')=>JSON.stringify({type:'expense',amountCents:amount,currency:'USD',occurredOn:date});
 for(const [scope,status,amount,date] of [[null,'paid',2500,'2026-11-06'],['novanook','paid',3000,'2026-11-06'],[null,'pending',1000,'2026-11-06'],[null,'void',9900,'2026-11-06'],[null,'paid',8800,'2026-10-06']])await rpc('hub_workspace_save',[owner,null,null,'accounting',scope,'Bill',status,accounting(amount,date),randomUUID()]);
 assert.equal(Number((await view()).cash.paid),5500);assert.equal(Number((await view(owner,'company')).cash.paid),2500);assert.equal(Number((await view(owner,'novanook')).cash.paid),3000);
 await db.query("insert into public.hub_cost_samples(service_id,source,captured_at,cumulative_usd,balance_usd) values('ai-gateway','gateway','2026-11-06T12:00Z',0,25),('ai-gateway','gateway','2026-11-07T12:00Z',2,23)");
 assert.equal(Number((await view()).cash.paid),5500);assert.equal((await view(owner,'novanook')).services.some(s=>s.id==='ai-gateway'),false);
});
test('checks have a cross-request lease and one-minute cooldown',async()=>{
 const id=randomUUID();assert.equal(await rpc('hub_cost_claim',[owner,id]),false);
 await db.query('update public.hub_cost_monitor set enabled=true,owner_id=$1',[owner]);
 assert.equal(await rpc('hub_cost_claim',[owner,id]),true);assert.equal(await rpc('hub_cost_claim',[owner,randomUUID()]),false);
 await denied(()=>rpc('hub_cost_publish',[owner,randomUUID(),'[]']),'40001');
 await rpc('hub_cost_publish',[owner,id,'[]']);assert.equal(await rpc('hub_cost_claim',[owner,randomUUID()]),false);
});
test('alert changes are deduplicated; mail claims are one-shot and reopening creates a new revision',async()=>{
 const a={key:'ai-gateway:balance',serviceId:'ai-gateway',severity:'warning',title:'Low credit',detail:'Known balance'};
 async function publish(alerts){await db.exec("update public.hub_cost_monitor set last_started_at=null,lease_until=null");const id=randomUUID();await rpc('hub_cost_claim',[owner,id]);await rpc('hub_cost_publish',[owner,id,JSON.stringify(alerts)]);}
 await publish([a]);await publish([a]);assert.equal((await one('select revision from public.hub_cost_alerts where key=$1',[a.key])).revision,1);
 assert.equal((await rpc('hub_cost_claim_mail',[owner])).length,1);assert.equal((await rpc('hub_cost_claim_mail',[owner])).length,0);
 await publish([]);assert.equal((await one('select active from public.hub_cost_alerts where key=$1',[a.key])).active,false);
 await publish([a]);assert.equal((await one('select revision from public.hub_cost_alerts where key=$1',[a.key])).revision,2);assert.equal((await rpc('hub_cost_claim_mail',[owner])).length,1);
});
test('dashboard rejects invalid months and inaccessible app scope',async()=>{await denied(()=>view(owner,'missing'),'42501');await denied(()=>rpc('hub_cost_dashboard',[owner,'all','2026-13']),'22023');});
test.after(()=>db.close());

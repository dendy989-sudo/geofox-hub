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


await db.exec(await readFile(new URL('../supabase/migrations/20261106193010_alfred_connected_workflows.sql',import.meta.url),'utf8'));
const configure=async(opts={})=>{const s=await one('select * from public.hub_ops_settings');return rpc('hub_ops_configure',[owner,s.version,opts.enabled??true,opts.support??true,opts.incidents??true,opts.daily??8]);};
const claim=(id,key=id,kind='support')=>rpc('hub_ops_claim',[owner,id,key,kind,randomUUID(),'{}']);
async function clearJobs(){await db.exec('delete from public.hub_ops_jobs');await configure();}
test('workflow storage and RPCs are private; non-owners and disabled accounts cannot configure',async()=>{
 for(const t of ['settings','jobs','mail','checks','repairs','invoices']){const name='public.hub_ops_'+t;assert.equal((await one('select relrowsecurity from pg_class where oid=$1::regclass',[name])).relrowsecurity,true);for(const role of ['anon','authenticated'])assert.equal((await one("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') ok",[role,name])).ok,false);}
 const functions=(await db.query("select oid::regprocedure::text signature,prosecdef from pg_proc where proname like 'hub_ops_%'")).rows;assert.equal(functions.length,7);for(const f of functions){assert.equal(f.prosecdef,false);for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,$2,'EXECUTE') ok",[role,f.signature])).ok,false);}
 for(const who of [support,analyst,inactive,banned,unverified,randomUUID()])await denied(()=>rpc('hub_ops_configure',[who,1,true,true,true,8]));
});
test('activation requires existing data consent and version checks',async()=>{await denied(()=>configure());await rpc('hub_alfred_configure',[owner,1,true,true,500,2500,false]);await configure();await denied(()=>rpc('hub_ops_configure',[owner,1,true,true,true,8]),'40001');});
test('automated claims enforce daily cap, concurrency and persistent event dedupe',async()=>{
 await clearJobs();await configure({daily:2});const a=randomUUID();assert.equal(await claim(a),true);assert.equal(await claim(randomUUID()),false);await db.query("update public.hub_ops_jobs set state='completed' where id=$1",[a]);assert.equal(await claim(a),false);const b=randomUUID();assert.equal(await claim(b),true);await db.query("update public.hub_ops_jobs set state='completed' where id=$1",[b]);assert.equal(await claim(randomUUID()),false);
});
test('workflow pause and global Alfred pause stop new draft claims',async()=>{await clearJobs();await configure({enabled:false});assert.equal(await claim(randomUUID()),false);await configure();await db.exec('update public.hub_alfred_settings set enabled=false');assert.equal(await claim(randomUUID()),false);await db.exec('update public.hub_alfred_settings set enabled=true');});
test('email routing is idempotent and never grants customer identity',async()=>{
 const id=randomUUID();await db.query("insert into public.hub_ops_mail(id,sender,recipient,subject,body) values($1,'customer@example.test','inbound@example.test','Support help','Please help me with my account.')",[id]);await denied(()=>rpc('hub_ops_route_mail',[support,id,'novanook',false]));const a=await rpc('hub_ops_route_mail',[owner,id,'novanook',false]),b=await rpc('hub_ops_route_mail',[owner,id,'novanook',false]);assert.equal(a.ticketId,b.ticketId);const t=await one('select * from public.hub_tickets where id=$1',[a.ticketId]);assert.equal(t.source,'email');assert.equal(t.identity_verified,false);assert.equal(t.customer_owner_id,null);assert.equal((await one('select author_kind from public.hub_ticket_messages where ticket_id=$1',[t.id])).author_kind,'guest');assert.equal(Number((await one('select count(*) n from public.hub_ticket_messages where ticket_id=$1',[t.id])).n),1);
});
const post=()=>({kind:'post',platforms:['facebook'],caption:'Reviewed caption',hashtags:'',mentions:'',media:[],thumbnail:null,scheduledAt:null,timeZone:'America/Chicago',publishedAt:null,contentType:'text',campaign:'',notes:'',publication:{},flags:[]});
const createPost=()=>rpc('hub_workspace_save',[owner,null,null,'marketing','novanook','Approved post','draft',JSON.stringify(post()),randomUUID()]);
test('scheduled approvals bind to exact post version and one destination',async()=>{await clearJobs();const p=await createPost(),id=randomUUID(),when=new Date(Date.now()+600000).toISOString();await denied(()=>rpc('hub_ops_schedule',[owner,id,p.id,99,'facebook','123',when]),'40001');await rpc('hub_ops_schedule',[owner,id,p.id,p.version,'facebook','123',when]);await denied(()=>rpc('hub_ops_schedule',[owner,randomUUID(),p.id,p.version,'facebook','123',when]),'40001');assert.equal(await rpc('hub_ops_take_scheduled',[owner]),null);await db.query("update public.hub_ops_jobs set scheduled_at=now()-interval '1 minute' where id=$1",[id]);await db.exec('update public.hub_alfred_settings set enabled=false');assert.equal(await rpc('hub_ops_take_scheduled',[owner]),null);await db.exec('update public.hub_alfred_settings set enabled=true');assert.equal((await rpc('hub_ops_take_scheduled',[owner])).id,id);assert.equal(await rpc('hub_ops_take_scheduled',[owner]),null);});
test('missed publication windows require a new approval rather than late posting',async()=>{await clearJobs();const p=await createPost(),id=randomUUID();await rpc('hub_ops_schedule',[owner,id,p.id,p.version,'facebook','123',new Date(Date.now()+600000).toISOString()]);await db.query("update public.hub_ops_jobs set scheduled_at=now()-interval '1 hour' where id=$1",[id]);assert.equal(await rpc('hub_ops_take_scheduled',[owner]),null);assert.equal((await one('select state from public.hub_ops_jobs where id=$1',[id])).state,'needs_review');});
test('repair approval is owner-bound one-shot and cannot bypass global pause',async()=>{const id=randomUUID();await db.query("insert into public.hub_ops_repairs(id,actor_id,repo,base_sha,summary,files) values($1,$2,'dendy989-sudo/geofox-hub',$3,'Test repair','[]')",[id,owner,'a'.repeat(40)]);await denied(()=>rpc('hub_ops_claim_repair',[support,id]));await db.exec('update public.hub_alfred_settings set enabled=false');await denied(()=>rpc('hub_ops_claim_repair',[owner,id]));await db.exec('update public.hub_alfred_settings set enabled=true');assert.equal((await rpc('hub_ops_claim_repair',[owner,id])).state,'creating');await denied(()=>rpc('hub_ops_claim_repair',[owner,id]),'40001');});
test('invoice batch is atomic, idempotent, and rejects altered duplicates',async()=>{const rows=[{serviceId:'supabase',reference:'ops-test-001',date:'2026-11-06',amountCents:2500,status:'paid'}];const run=r=>rpc('hub_ops_import_bills',[owner,JSON.stringify(r)]);await assert.rejects(()=>run([...rows,{...rows[0],serviceId:'unknown-service',reference:'invalid'}]));assert.equal(Number((await one('select count(*) n from public.hub_ops_invoices')).n),0);assert.equal((await run(rows)).created,1);assert.equal((await run(rows)).alreadyRecorded,1);await denied(()=>run([{...rows[0],amountCents:2600}]),'40001');assert.equal(Number((await one('select count(*) n from public.hub_ops_invoices')).n),1);await denied(()=>run([...rows,...rows]),'22023');});
test.after(()=>db.close());

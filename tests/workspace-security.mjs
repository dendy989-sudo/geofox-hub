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

test('migration is replayable and all private tables and functions reject browser roles',async()=>{
 await db.exec(migration);
 for(const table of ['hub_staff_modules','hub_workspace_records','hub_workspace_uploads']){
  assert.equal((await one('select relrowsecurity from pg_class where oid=$1::regclass',[`public.${table}`])).relrowsecurity,true);
  for(const role of ['anon','authenticated']) assert.equal((await one("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') as allowed",[role,`public.${table}`])).allowed,false);
 }
 const functions=await db.query("select p.oid::regprocedure::text as name,prosecdef,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'hub_workspace_%'");
 assert.ok(functions.rows.length>=15);
 for(const f of functions.rows){
  assert.equal(f.prosecdef,true); assert.ok(f.proconfig.includes('search_path=""'));
  for(const role of ['anon','authenticated']) assert.equal((await one("select has_function_privilege($1,$2,'EXECUTE') as allowed",[role,f.name])).allowed,false);
  assert.equal((await one("select has_function_privilege('service_role',$1,'EXECUTE') as allowed",[f.name])).allowed,true);
 }
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  try{await denied(()=>db.query('select * from public.hub_workspace_records'));await denied(()=>can(owner,'tasks','write',null));}
  finally{await db.exec('reset role');}
 }
});

test('owner gets all modules, while role defaults grant tasks only in assigned apps',async()=>{
 for(const module of ['tasks','marketing','legal','accounting']) for(const app of [null,'novanook','otherapp']) assert.equal(await can(owner,module,'write',app),true);
 assert.equal(await can(support,'tasks','write','novanook'),true);
 assert.equal(await can(analyst,'tasks','read','novanook'),true);
 assert.equal(await can(analyst,'tasks','write','novanook'),false);
 for(const app of [null,'otherapp']) assert.equal(await can(support,'tasks','read',app),false);
 for(const module of ['marketing','legal','accounting']) assert.equal(await can(support,module,'read','novanook'),false);
 for(const actor of [inactive,banned,unverified,randomUUID()]) assert.equal(await can(actor,'tasks','read','novanook'),false);
 assert.equal(await can(owner,'unknown','read',null),false);
 assert.equal(await can(owner,'tasks','erase',null),false);
});

test('only owner can replace explicit grants; company access is explicit and owner is immutable',async()=>{
 await denied(()=>grants(support,{accounting:'write'},support));
 await denied(()=>grants(owner,{tasks:'none'}));
 await denied(()=>grants(support,{unknown:'write'}),'22023');
 await grants(support,{tasks:'read',marketing:'write',accounting:'none'});
 assert.equal(await can(support,'tasks','read',null),true);
 assert.equal(await can(support,'tasks','write','novanook'),false);
 assert.equal(await can(support,'marketing','write',null),true);
 assert.equal(await can(support,'marketing','read','otherapp'),false);
 assert.equal(await can(support,'accounting','read',null),false);
 await grants(support,{tasks:null,marketing:null});
 assert.equal(await can(support,'tasks','write','novanook'),true);
 assert.equal(await can(support,'tasks','read',null),false);
 assert.equal(await can(support,'marketing','read',null),false);
 await denied(()=>rpc('hub_workspace_list_access',[support]));
 const members=await rpc('hub_workspace_list_access',[owner]);
 assert.equal(members.find(m=>m.userId===support).grants.tasks,undefined);
});

test('record reads and writes enforce both module and app scope, including moves',async()=>{
 const allowed=await save(owner,{title:'Scoped task'});
 const company=await save(owner,{app:null,title:'Company confidential'});
 const other=await save(owner,{app:'otherapp',title:'Other confidential'});
 assert.equal((await get(support,allowed.id)).id,allowed.id);
 await denied(()=>get(support,company.id));await denied(()=>get(support,other.id));
 await denied(()=>save(support,{app:null}));await denied(()=>save(support,{app:'otherapp'}));
 await denied(()=>save(analyst,{}));
 await denied(()=>save(support,{id:other.id,version:other.version,app:'novanook'}));
 await denied(()=>save(support,{id:allowed.id,version:allowed.version,app:'otherapp'}));
 const listed=await list(support);assert.ok(listed.items.some(r=>r.id===allowed.id));assert.ok(listed.items.every(r=>r.app_slug==='novanook'));
 await denied(()=>list(support,'tasks','company')); await denied(()=>list(support,'tasks','otherapp'));await denied(()=>list(support,'legal'));
 const page=await list(owner,'tasks','all',1,0);assert.equal(page.items.length,1);assert.ok(page.total>=3);
 await denied(()=>list(owner,'tasks','all',1001),'22023');
});

test('mutations preserve identity, reject stale edits, and write transactional audit events',async()=>{
 const created=await save(owner,{title:'Versioned task'});const before=await auditCount();
 const changed=await save(support,{id:created.id,version:created.version,title:'Changed',data:task({priority:'high'})});
 assert.equal(changed.created_by,owner);assert.equal(changed.updated_by,support);assert.equal(changed.created_at,created.created_at);assert.equal(changed.version,2);
 assert.equal(await auditCount(),before+1);
 await denied(()=>save(owner,{id:created.id,version:1,title:'Stale'}),'40001');
 await denied(()=>rpc('hub_workspace_delete',[owner,created.id,1]),'40001');
 assert.equal(await auditCount(),before+1);
 await rpc('hub_workspace_delete',[support,created.id,2]);
 await denied(()=>get(owner,created.id),'P0002');
 assert.ok(!(await list(owner)).items.some(r=>r.id===created.id));
 const audits=await db.query('select action,actor_id from public.hub_audit_log where entity_id=$1 order by created_at',[created.id]);
 assert.deepEqual(audits.rows.map(r=>r.action),['workspace.created','workspace.updated','workspace.deleted']);
});

test('a request ID is safe to retry and cannot silently represent a different record',async()=>{
 const request=randomUUID(), before=await auditCount();
 const options={title:'Idempotent task',request,data:task({priority:'urgent'})};
 const first=await save(owner,options);const again=await save(owner,options);
 assert.equal(first.id,again.id);assert.equal(await auditCount(),before+1);
 await denied(()=>save(owner,{...options,title:'Changed payload'}),'23505');
 await denied(()=>save(owner,{...options,app:'otherapp'}),'23505');
 assert.equal(await auditCount(),before+1);
});

test('recurrence creates one next task, resets checklist, and stays idempotent after reopening',async()=>{
 const original=await save(owner,{title:'Monthly review',data:task({dueDate:'2028-01-31',recurrence:'monthly',checklist:[{id:'one',text:'Review',done:true}]})});
 await denied(()=>save(owner,{id:original.id,version:1,status:'done',data:original.data}),'22023');
 const done=await rpc('hub_workspace_complete_task',[owner,original.id,1]);
 assert.equal(done.item.status,'done');assert.equal(done.next.data.dueDate,'2028-02-29');assert.equal(done.next.data.checklist[0].done,false);
 const again=await rpc('hub_workspace_complete_task',[owner,original.id,1]);assert.equal(again.next.id,done.next.id);
 const reopened=await save(owner,{id:original.id,version:done.item.version,title:original.title,data:original.data});
 const redone=await rpc('hub_workspace_complete_task',[owner,original.id,reopened.version]);assert.equal(redone.next.id,done.next.id);
 assert.equal(Number((await one('select count(*) as n from public.hub_workspace_records where parent_record_id=$1',[original.id])).n),1);
 await rpc('hub_workspace_delete',[owner,done.next.id,done.next.version]);
 assert.equal((await rpc('hub_workspace_complete_task',[owner,original.id,redone.item.version])).next,null);
 for(const [recurrence,due,next] of [['daily','2026-12-31','2027-01-01'],['weekly','2026-12-31','2027-01-07']]){
  const record=await save(owner,{data:task({recurrence,dueDate:due})});assert.equal((await rpc('hub_workspace_complete_task',[owner,record.id,1])).next.data.dueDate,next);
 }
});

test('completion never returns an inaccessible next occurrence after scope changes',async()=>{
 const original=await save(owner,{app:'otherapp',data:task({dueDate:'2026-11-04',recurrence:'weekly'})});
 await rpc('hub_workspace_complete_task',[owner,original.id,1]);
 const done=await get(owner,original.id);
 await save(owner,{id:original.id,version:done.version,app:'novanook',status:'done',data:done.data});
 const retry=await rpc('hub_workspace_complete_task',[support,original.id,3]);assert.equal(retry.next,null);
});

test('invalid calendar dates, money, checklist values, and inaccessible assignees are rejected',async()=>{
 for(const data of [task({dueDate:'2026-02-30'}),task({dueDate:'today'}),task({dueDate:'1800-01-01'}),task({recurrence:'weekly'}),task({checklist:[{id:'one',text:'Bad',done:'yes'}]}),task({checklist:[{id:'one',text:'A',done:false},{id:'one',text:'B',done:true}]}),task({assigneeId:banned})]){
  await assert.rejects(()=>save(owner,{data}),e=>['22023','22007','22008'].includes(e.code));
 }
 for(const amountCents of [-1,1.25,100000000000]) await denied(()=>save(owner,{module:'accounting',status:'paid',data:{type:'expense',currency:'USD',occurredOn:'2026-11-04',amountCents}}),'22023');
 await denied(()=>save(owner,{module:'legal',status:'open',data:{currency:'USD',recurrence:'annual',reviewDate:'2026-11-31'}}),'22008');
});

test('upload metadata must be verified and attachments cannot cross module or app scope',async()=>{
 const path=`tasks/novanook/${randomUUID()}.png`, info={path,filename:'proof.png',contentType:'image/png',size:100};
 await rpc('hub_workspace_register_upload',[support,'tasks','novanook',path,info.filename,info.contentType,info.size]);
 await denied(()=>save(owner,{data:{...task(),attachments:[info]}}),'22023');
 await denied(()=>rpc('hub_workspace_verify_upload',[support,path,101,'image/png']),'22023');
 await rpc('hub_workspace_verify_upload',[support,path,100,'image/png']);
 await save(owner,{data:{...task(),attachments:[info]}});
 await denied(()=>save(owner,{app:'otherapp',data:{...task(),attachments:[info]}}),'22023');
 await denied(()=>save(owner,{module:'legal',status:'open',data:{currency:'USD',recurrence:'none',attachments:[info]}}),'22023');
 await denied(()=>save(owner,{data:{...task(),attachments:[{...info,filename:'other.png'}]}}),'22023');
 await denied(()=>rpc('hub_workspace_register_upload',[support,'tasks','novanook',`tasks/otherapp/${randomUUID()}.png`,'x.png','image/png',100]),'22023');
 const privatePath=`accounting/company/${randomUUID()}.pdf`;
 await rpc('hub_workspace_register_upload',[owner,'accounting',null,privatePath,'receipt.pdf','application/pdf',100]);
 await denied(()=>rpc('hub_workspace_upload_info',[support,privatePath]));
 await denied(()=>rpc('hub_workspace_verify_upload',[support,privatePath,100,'application/pdf']));
});

test('private bucket remains blocked despite existing permissive browser storage policies',async()=>{
 const bucket=await one("select * from storage.buckets where id='hub-workspace'");assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),52428800);
 await db.exec("insert into storage.objects(bucket_id,name) values('hub-workspace','private.pdf'),('existing-public','public.png')");
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  try{const rows=(await db.query('select bucket_id from storage.objects')).rows;assert.deepEqual(rows,[{bucket_id:'existing-public'}]);await denied(()=>db.query("insert into storage.objects(bucket_id,name) values('hub-workspace','forged.png')"));}
  finally{await db.exec('reset role');}
 }
});

test('profile updates affect only the actor display name and enforce limits',async()=>{
 await rpc('hub_workspace_update_profile',[support,'  New name  ']);
 assert.deepEqual(await one('select display_name,role from public.hub_staff where user_id=$1',[support]),{display_name:'New name',role:'support'});
 await denied(()=>rpc('hub_workspace_update_profile',[support,'x'.repeat(101)]),'22023');
 await denied(()=>rpc('hub_workspace_update_profile',[unverified,'Forged']));
 assert.equal((await one('select role from public.hub_staff where user_id=$1',[owner])).role,'owner');
});

test.after(async()=>db.close());

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { emptyContent } from '../lib/workspace/marketing-content.ts';
import { validateWorkspaceData } from '../lib/workspace/validation.ts';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const owner = '10000000-0000-4000-8000-000000000001';
const writer = '10000000-0000-4000-8000-000000000002';
const reader = '10000000-0000-4000-8000-000000000003';
const inactive = '10000000-0000-4000-8000-000000000004';
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz);
insert into auth.users values ('${owner}','owner@example.test',now(),null,null),('${writer}','writer@example.test',now(),null,null),('${reader}','reader@example.test',now(),null,null),('${inactive}','inactive@example.test',now(),null,null);`);
await db.exec(await readFile(new URL('../supabase/migrations/202611030001_geofox_hub.sql',import.meta.url),'utf8'));
const bootstrap = await readFile(new URL('../supabase/bootstrap_owner.sql',import.meta.url),'utf8');
await db.exec(bootstrap.replace("owner_email text := 'REPLACE_WITH_YOUR_VERIFIED_COMPANY_EMAIL'", "owner_email text := 'owner@example.test'"));
await db.exec(`insert into public.hub_apps(slug,name,website) values('otherapp','Other app','https://example.test');
insert into public.hub_staff(user_id,display_name,role,active) values('${writer}','Writer','support',true),('${reader}','Reader','analyst',true),('${inactive}','Inactive','owner',false);
insert into public.hub_staff_apps(user_id,app_slug) values('${writer}','novanook'),('${reader}','novanook');`);
await db.exec(await readFile(new URL('../supabase/migrations/20261104151508_company_workspace.sql',import.meta.url),'utf8'));
const migration = await readFile(new URL('../supabase/migrations/20261118135413_marketing_content_library.sql',import.meta.url),'utf8');
await db.exec(migration);
async function rpc(name, params=[]) { return (await db.query(`select public.${name}(${params.map((_,i)=>`$${i+1}`).join(',')}) as result`,params)).rows[0].result; }
await rpc('hub_workspace_set_access',[owner,writer,JSON.stringify({marketing:'write'})]);
await rpc('hub_workspace_set_access',[owner,reader,JSON.stringify({marketing:'read'})]);
function creative(extra={}) { return {...emptyContent(),contentType:'text',caption:'A cozy home for your books.',...extra}; }
async function save({ actor=owner, id=null, version=null, app='novanook', title='A cozy reading nook', status='draft', data=creative(), request=null }={}) {
 return rpc('hub_workspace_save',[actor,id,version,'marketing',app,title,status,JSON.stringify(data),request]);
}
const update=(row,patch={})=>save({id:row.id,version:row.version,app:row.app_slug,title:row.title,status:row.status,data:row.data,...patch});
async function approved(data=creative()) { const row=await save({status:'in_review',data}); return update(row,{status:'approved'}); }
const handoff=(row,actor=owner)=>rpc('hub_marketing_content_post',[actor,row.id,row.version]);
const denied=(operation,code='22023')=>assert.rejects(operation,error=>error.code===code);
const invalid=fn=>assert.throws(fn,error=>error.status===400&&error.code==='INVALID_INPUT');

// These exercise the public payload parser as well as the service-role SQL boundary.
test('content validation rejects forged review metadata, bad links, and malformed creative',()=>{
 const data=validateWorkspaceData('marketing','in_review',creative({script:'[Real app recording] A cozy reading tracker.'}));
 assert.equal(data.approval,null); assert.equal(data.linkedPostId,null);
 invalid(()=>validateWorkspaceData('marketing','draft',creative({approval:{reviewedBy:owner,reviewedAt:new Date().toISOString()}})));
 invalid(()=>validateWorkspaceData('marketing','draft',creative({linkedPostId:randomUUID()})));
 invalid(()=>validateWorkspaceData('marketing','draft',creative({platforms:['tiktok','tiktok']})));
 invalid(()=>validateWorkspaceData('marketing','draft',creative({script:'x'.repeat(20001)})));
 invalid(()=>validateWorkspaceData('marketing','approved',creative({isTemplate:true})));
 invalid(()=>validateWorkspaceData('marketing','in_review',emptyContent()));
 const previous={...data,approval:{reviewedBy:owner,reviewedAt:'2026-11-18T14:00:00Z'},linkedPostId:randomUUID()};
 assert.deepEqual(validateWorkspaceData('marketing','approved',{...data,approval:undefined,linkedPostId:undefined},previous).approval,previous.approval);
 const post={kind:'post',platforms:['tiktok'],contentType:'text',timeZone:'America/Chicago'};
 invalid(()=>validateWorkspaceData('marketing','draft',{...post,sourceContentId:randomUUID()}));
 const linked={...post,sourceContentId:randomUUID(),sourceApprovalAt:'2026-11-18T14:00:00Z'};
 const result=validateWorkspaceData('marketing','draft',post,linked);
 assert.equal(result.sourceContentId,linked.sourceContentId);
 invalid(()=>validateWorkspaceData('marketing','draft',{...linked,sourceContentId:randomUUID()},linked));
});

test('migration is repeatable and private routines remain inaccessible to browser roles',async()=>{
 await db.exec(migration);
 for(const name of ['hub_marketing_content_creative(text,jsonb)','hub_marketing_post_creative(text,jsonb)','hub_marketing_content_post(uuid,uuid,integer)','hub_workspace_save(uuid,uuid,integer,text,text,text,text,jsonb,uuid)']) {
  for(const role of ['anon','authenticated']) assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,`public.${name}`])).rows[0].allowed,false);
  assert.equal((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') allowed",[`public.${name}`])).rows[0].allowed,true);
 }
 for(const role of ['anon','authenticated']) { await db.exec(`set role ${role}`); try { await denied(()=>db.query('select * from public.hub_workspace_records'),'42501'); } finally { await db.exec('reset role'); } }
});

test('content reads and writes honor both module permission and app scope',async()=>{
 const scoped=await save(); const other=await save({app:'otherapp'});
 assert.equal((await rpc('hub_workspace_get',[reader,scoped.id])).id,scoped.id);
 await denied(()=>rpc('hub_workspace_get',[writer,other.id]),'42501');
 await denied(()=>save({actor:writer,app:'otherapp'}),'42501');
 await denied(()=>save({actor:reader}),'42501');
 await denied(()=>save({actor:inactive}),'42501');
 const row=await save({actor:writer,status:'in_review'});
 await denied(()=>update(row,{actor:writer,status:'approved'}),'42501');
 await denied(()=>update(row,{actor:reader,status:'approved'}),'42501');
 await denied(()=>update(row,{actor:inactive,status:'approved'}),'42501');
});

test('only an unchanged saved review can be approved and approval identity is stamped by SQL',async()=>{
 await denied(()=>save({status:'approved'}));
 let row=await save(); await denied(()=>update(row,{status:'approved'}));
 row=await update(row,{status:'in_review'});
 await denied(()=>update(row,{status:'approved',data:{...row.data,caption:'Unreviewed replacement'}}));
 await denied(()=>update(row,{data:{...row.data,approval:{reviewedBy:owner,reviewedAt:'2020-01-01'}}}));
 row=await update(row,{status:'approved'});
 assert.equal(row.data.approval.reviewedBy,owner);
 assert.ok(Date.parse(row.data.approval.reviewedAt)>Date.parse('2026-01-01'));
 const kept=await update(row,{actor:writer,data:{...row.data,notes:'Internal production note'}});
 assert.deepEqual(kept.data.approval,row.data.approval);
 const changed=await update(kept,{actor:writer,data:{...kept.data,caption:'Changed creative'}});
 assert.equal(changed.status,'in_progress'); assert.equal(changed.data.approval,null);
 await denied(()=>update(changed,{status:'approved'}));
});

test('competing approvals and stale edits cannot overwrite a newer review',async()=>{
 const row=await save({status:'in_review'});
 const attempts=await Promise.allSettled([update(row,{status:'approved'}),update(row,{status:'approved'})]);
 assert.equal(attempts.filter(item=>item.status==='fulfilled').length,1);
 assert.equal(attempts.find(item=>item.status==='rejected').reason.code,'40001');
 await denied(()=>update(row,{actor:writer,data:{...row.data,caption:'Late edit'}}),'40001');
 const latest=await rpc('hub_workspace_get',[owner,row.id]);
 assert.equal(latest.status,'approved');assert.equal(latest.data.caption,row.data.caption);
 const reviewed=await update(latest,{actor:writer,data:{...latest.data,notes:'Review feedback: check the final native cover.'}});
 assert.deepEqual(reviewed.data.approval,latest.data.approval);
 const revised=await update(reviewed,{actor:writer,data:{...reviewed.data,script:'The hook has changed.'}});
 assert.equal(revised.status,'in_progress');assert.equal(revised.data.approval,null);
});

test('template references stay scoped and templates cannot be approved or handed off',async()=>{
 const template=await save({data:creative({isTemplate:true})});
 const content=await save({data:creative({sourceTemplateId:template.id})});
 assert.equal(content.data.sourceTemplateId,template.id);
 await denied(()=>update(content,{app:'otherapp'}));
 await denied(()=>save({app:'otherapp',data:creative({sourceTemplateId:template.id})}));
 await denied(()=>save({data:creative({sourceTemplateId:content.id})}));
 const review=await update(template,{status:'in_review'});
 await denied(()=>update(review,{status:'approved'}));
 await denied(()=>handoff(review));
 await rpc('hub_workspace_delete',[owner,template.id,review.version]);
 assert.equal((await update(content,{data:{...content.data,notes:'Source template was retired.'}})).data.sourceTemplateId,template.id);
});

test('unverified or cross-scope attachments never reach a content record',async()=>{
 const path=`marketing/novanook/${randomUUID()}.mp4`;
 const media={path,filename:'cozy.mp4',contentType:'video/mp4',size:1234};
 await rpc('hub_workspace_register_upload',[owner,'marketing','novanook',path,media.filename,media.contentType,media.size]);
 await denied(()=>save({data:creative({media:[media]})}));
 await rpc('hub_workspace_verify_upload',[owner,path,1234,'video/mp4']);
 const row=await save({data:creative({media:[media]})}); assert.equal(row.data.media[0].path,path);
 await denied(()=>save({app:'otherapp',data:creative({media:[media]})}));
 await denied(()=>save({data:creative({media:[{...media,filename:'false.mp4'}]})}));
});

test('planner handoff requires owner approval, final media, current versions, and write access',async()=>{
 const draft=await save(); await denied(()=>handoff(draft));
 const video=await approved(creative({contentType:'video',script:'[Screen recording]'}));
 await denied(()=>handoff(video));
 const row=await approved();
 await denied(()=>handoff({...row,version:row.version-1}),'40001');
 await denied(()=>handoff(row,reader),'42501');
 await denied(()=>handoff(row,inactive),'42501');
 const other=await save({app:'otherapp',status:'in_review'}); const otherApproved=await update(other,{status:'approved'});
 await denied(()=>handoff(otherApproved,writer),'42501');
});

test('handoff atomically creates one linked draft and safely returns it on retries',async()=>{
 const source=await approved(); const first=await handoff(source,writer); const repeated=await handoff(source,writer);
 assert.equal(first.post.id,repeated.post.id);
 assert.equal(first.content.data.linkedPostId,first.post.id);
 assert.equal(first.post.data.sourceContentId,source.id);
 assert.equal(first.post.data.sourceApprovalAt,source.data.approval.reviewedAt);
 assert.equal(first.post.status,'draft'); assert.equal(first.post.data.scheduledAt,null);
 assert.deepEqual(first.post.data.publication,{}); assert.equal(first.post.data.caption,source.data.caption);
 assert.equal(Number((await db.query("select count(*) n from public.hub_workspace_records where data->>'sourceContentId'=$1",[source.id])).rows[0].n),1);
 await denied(()=>update(first.content,{data:{...first.content.data,linkedPostId:randomUUID()}}));
 await denied(()=>update(first.content,{app:'otherapp'}));
 await denied(()=>save({data:first.post.data}));
});

test('planner cannot detach a review, move scope, or alter approved creative',async()=>{
 const {content,post}=await handoff(await approved());
 for(const change of [{caption:'Unreviewed caption'},{mentions:'@unreviewed'},{sourceContentId:randomUUID()},{sourceApprovalAt:'2020-01-01'}]) await denied(()=>update(post,{data:{...post.data,...change}}));
 const detached={...post.data};delete detached.sourceContentId;delete detached.sourceApprovalAt;
 await denied(()=>update(post,{data:detached}));
 await denied(()=>update(post,{app:'otherapp'}));
 await denied(()=>update(post,{title:'Unreviewed title'}));
 const scheduled=await update(post,{status:'scheduled',data:{...post.data,scheduledAt:'2026-12-01T15:00:00Z'}});
 assert.equal(scheduled.status,'scheduled');
 const staleSource=await update(content,{data:{...content.data,script:'Changed creative instructions'}});
 assert.equal(staleSource.data.approval,null);
 await denied(()=>update(scheduled,{status:'published',data:{...scheduled.data,publishedAt:'2026-12-01T15:00:00Z'}}));
 await denied(()=>update(scheduled,{data:{...scheduled.data,delivery:{tiktok:{state:'publishing'}}}}));
});

test('reapproval refreshes the same draft and requires a draft before replacing scheduled creative',async()=>{
 let {content,post}=await handoff(await approved());
 content=await update(content,{data:{...content.data,caption:'Revised final creative'}});
 content=await update(content,{status:'in_review'}); content=await update(content,{status:'approved'});
 let result=await handoff(content); assert.equal(result.post.id,post.id); assert.equal(result.post.data.caption,'Revised final creative');
 post=await update(result.post,{status:'scheduled',data:{...result.post.data,scheduledAt:'2026-12-01T15:00:00Z'}});
 content=await update(content,{data:{...content.data,caption:'Another revision'}}); content=await update(content,{status:'in_review'});content=await update(content,{status:'approved'});
 await denied(()=>handoff(content));
 post=await update(post,{status:'draft'});
 result=await handoff(content); assert.equal(result.post.id,post.id); assert.equal(result.post.data.caption,'Another revision');assert.equal(result.post.status,'draft');
});

test('content cannot change while direct publishing has claimed its post',async()=>{
 const {content,post}=await handoff(await approved());
 const claimed=await update(post,{data:{...post.data,delivery:{facebook:{state:'publishing',attemptId:randomUUID()}}}});
 await denied(()=>update(content,{data:{...content.data,caption:'Concurrent edit'}}),'40001');
 const completed=await update(claimed,{status:'published',data:{...claimed.data,delivery:{facebook:{state:'published'}},publishedAt:'2026-11-18T14:00:00Z'}});
 assert.equal(completed.status,'published');
 await denied(()=>update(content,{data:{...content.data,caption:'Rewrite published creative'}}));
 const recorded=await update(content,{status:'published'});assert.equal(recorded.status,'published');
});

test('neither member of a linked content/post pair can be deleted, including during delivery',async()=>{
 const {content,post}=await handoff(await approved());
 await denied(()=>rpc('hub_workspace_delete',[owner,content.id,content.version]));
 await denied(()=>rpc('hub_workspace_delete',[owner,post.id,post.version]));
 const claimed=await update(post,{data:{...post.data,delivery:{facebook:{state:'publishing',attemptId:randomUUID()}}}});
 await denied(()=>rpc('hub_workspace_delete',[owner,content.id,content.version]));
 await denied(()=>rpc('hub_workspace_delete',[owner,claimed.id,claimed.version]));
 const failed=await update(claimed,{data:{...claimed.data,delivery:{facebook:{state:'failed'}}}});
 assert.equal((await update(content,{status:'archived'})).status,'archived');
 assert.equal((await update(failed,{status:'cancelled'})).status,'cancelled');
 const unlinked=await save();await rpc('hub_workspace_delete',[owner,unlinked.id,unlinked.version]);
 await denied(()=>rpc('hub_workspace_get',[owner,unlinked.id]),'P0002');
});

test('published content requires an actually published linked post and state changes cannot forge publication',async()=>{
 let row=await approved(); await denied(()=>update(row,{status:'published'}));
 const {content,post}=await handoff(row);await denied(()=>update(content,{status:'published'}));
 await denied(()=>update(content,{data:{...content.data,kind:'post'}}));
 const published=await update(post,{status:'published',data:{...post.data,publishedAt:'2026-11-18T14:00:00Z'}});assert.equal(published.status,'published');
 row=await update(content,{status:'published'});assert.ok(row.data.approval);
});

test('unrelated marketing posts retain their existing draft and scheduling behavior',async()=>{
 const data={kind:'post',platforms:['tiktok'],contentType:'video',caption:'Existing planner workflow',media:[],thumbnail:null,timeZone:'America/Chicago'};
 const row=await save({data}); assert.equal(row.data.sourceContentId,undefined);
 const scheduled=await update(row,{status:'scheduled',data:{...data,scheduledAt:'2026-12-01T15:00:00Z'}});assert.equal(scheduled.status,'scheduled');
});

test.after(()=>db.close());

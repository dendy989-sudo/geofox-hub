import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import * as validation from '../lib/workspace/validation.ts';
import { validateWorkspaceData, dateOnly, timestamp, safeUrl, attachment, appScope } from '../lib/workspace/validation.ts';
const invalid=fn=>assert.throws(fn,e=>e.status===400&&e.code==='INVALID_INPUT');
const post=(extra={})=>({kind:'post',platforms:['tiktok'],timeZone:'America/New_York',contentType:'video',...extra});

test('task payloads normalize defaults and reject malformed or duplicate checklist items',()=>{
 assert.deepEqual(validateWorkspaceData('tasks','todo',{}),{description:'',priority:'normal',dueDate:null,recurrence:'none',checklist:[],assigneeId:null});
 invalid(()=>validateWorkspaceData('tasks','todo',{recurrence:'weekly'}));
 invalid(()=>validateWorkspaceData('tasks','todo',{checklist:[{id:'a',text:'A',done:false},{id:'a',text:'B',done:true}]}));
 invalid(()=>validateWorkspaceData('tasks','todo',{checklist:[{id:'a',text:'A',done:'false'}]}));
 invalid(()=>validateWorkspaceData('tasks','todo',{description:'x'.repeat(10001)}));
});

test('calendar dates and zoned timestamps are strict, including leap years',()=>{
 assert.equal(dateOnly('2028-02-29','date'),'2028-02-29');
 for(const value of ['2026-02-29','2026-04-31','today','1800-01-01','2201-01-01']) invalid(()=>dateOnly(value,'date'));
 assert.equal(timestamp('2026-11-04T09:15-05:00','time'),'2026-11-04T14:15:00.000Z');
 for(const value of ['2026-11-04T09:15','2026-11-04T24:15Z','2026-11-04T09:61Z','2026-02-30T09:15Z']) invalid(()=>timestamp(value,'time'));
 invalid(()=>validateWorkspaceData('marketing','scheduled',post({scheduledAt:'2026-11-04T09:15Z',timeZone:'Not/APlace'})));
 invalid(()=>validateWorkspaceData('marketing','scheduled',post()));
});

test('accounting uses bounded integer cents and real dates',()=>{
 const valid={type:'expense',currency:'USD',amountCents:1234,occurredOn:'2026-11-04'};
 assert.equal(validateWorkspaceData('accounting','paid',valid).amountCents,1234);
 for(const amountCents of [0,-1,12.5,'1234',Infinity,100000000000]) invalid(()=>validateWorkspaceData('accounting','paid',{...valid,amountCents}));
 invalid(()=>validateWorkspaceData('accounting','paid',{...valid,currency:'EUR'}));
 invalid(()=>validateWorkspaceData('accounting','paid',{...valid,occurredOn:'2026-02-29'}));
});

test('file references and outgoing links reject unsafe or malformed values',()=>{
 for(const value of ['javascript:alert(1)','http://example.test','https://user:password@example.test']) invalid(()=>safeUrl(value,'link'));
 assert.equal(safeUrl('https://example.test/path','link'),'https://example.test/path');
 const file={path:'marketing/novanook/10000000-0000-4000-8000-000000000001.mp4',filename:'video.mp4',contentType:'video/mp4',size:1000};
 assert.equal(attachment({...file,width:1080,height:1920,duration:12}).duration,12);
 invalid(()=>attachment({...file,path:'marketing/novanook/../company/private.mp4'}));
 invalid(()=>attachment({...file,size:52428801}));
 invalid(()=>attachment({...file,contentType:'text/html'}));
 invalid(()=>attachment({...file,duration:Infinity}));
 for(const scope of ['all','company','../other','x',undefined]) invalid(()=>appScope(scope));
 assert.equal(appScope(null),null);assert.equal(appScope('novanook'),'novanook');
});

test('social delivery and provider metrics cannot be forged or overwritten by a client',()=>{
 invalid(()=>validateWorkspaceData('marketing','draft',post({delivery:{tiktok:{state:'published',postId:'forged'}}})));
 invalid(()=>validateWorkspaceData('marketing','published',post({publication:{tiktok:{metrics:{source:'provider',likes:999}}}})));
 const previous={...post(),delivery:{tiktok:{state:'published',postId:'real-id'}},publication:{tiktok:{url:'https://www.tiktok.com/real',publishedAt:'2026-11-04T12:00:00.000Z',metrics:{source:'provider',capturedAt:'2026-11-04T12:30:00.000Z',likes:3}}}};
 const preserved=validateWorkspaceData('marketing','published',post({caption:'Updated note'}),previous);
 assert.deepEqual(preserved.delivery,previous.delivery);assert.deepEqual(preserved.publication,previous.publication);
 invalid(()=>validateWorkspaceData('marketing','published',post({delivery:{tiktok:{state:'failed'}}}),previous));
 invalid(()=>validateWorkspaceData('marketing','published',post({publication:{tiktok:{metrics:{source:'manual',likes:999,capturedAt:'2026-11-04T12:30:00Z'}}}}),previous));
 const unchanged=validateWorkspaceData('marketing','published',previous,previous);assert.deepEqual(unchanged.publication,previous.publication);
 invalid(()=>validateWorkspaceData('marketing','active',{kind:'account',platform:'tiktok',handle:'changed'},previous));
});

test('manual metrics are explicit, nonnegative, and timestamped',()=>{
 const metrics={source:'manual',capturedAt:'2026-11-04T12:00Z',likes:42,views:1200};
 const value=validateWorkspaceData('marketing','published',post({publication:{tiktok:{metrics}}}));
 assert.equal(value.publication.tiktok.metrics.source,'manual');assert.equal(value.publication.tiktok.metrics.likes,42);
 invalid(()=>validateWorkspaceData('marketing','published',post({publication:{tiktok:{metrics:{...metrics,likes:-1}}}})));
 invalid(()=>validateWorkspaceData('marketing','published',post({publication:{tiktok:{metrics:{source:'manual',likes:1}}}})));
});

test('directly published posts accept manual statistics while retaining provider identity and time',()=>{
 const previous={...post(),delivery:{tiktok:{state:'published',providerId:'real-id'}},publication:{tiktok:{url:'https://www.tiktok.com/real',publishedAt:'2026-11-04T12:00:00.000Z'}}};
 const input={...previous,publication:{tiktok:{url:'https://example.test/replacement',publishedAt:'2026-10-01T10:00Z',metrics:{source:'manual',capturedAt:'2026-11-04T13:00Z',likes:42,views:1200}}}};
 const saved=validateWorkspaceData('marketing','published',input,previous);
 assert.equal(saved.publication.tiktok.url,previous.publication.tiktok.url);
 assert.equal(saved.publication.tiktok.publishedAt,previous.publication.tiktok.publishedAt);
 assert.equal(saved.publication.tiktok.metrics.source,'manual');
 assert.equal(saved.publication.tiktok.metrics.likes,42);
 assert.equal(saved.publication.tiktok.metrics.views,1200);
 assert.deepEqual(saved.delivery,previous.delivery);
 const revised=validateWorkspaceData('marketing','published',{...saved,publication:{tiktok:{metrics:{source:'manual',capturedAt:'2026-11-05T13:00Z',likes:50}}}},saved);
 assert.equal(revised.publication.tiktok.metrics.likes,50);
 assert.equal(revised.publication.tiktok.url,previous.publication.tiktok.url);
 const omitted=validateWorkspaceData('marketing','published',post({notes:'Keep recorded statistics'}),saved);
 assert.deepEqual(omitted.publication,saved.publication);
 invalid(()=>validateWorkspaceData('marketing','published',{...input,publication:{tiktok:{metrics:{source:'manual',capturedAt:'2026-11-04T13:00Z',likes:-1}}}},previous));
});

// Execute the actual server functions with a local RPC boundary. SQL tests cover
// the database's atomic version checks; these tests cover the pre-write guards.
const builtinRequire=createRequire(import.meta.url);
function mutationServer(row, writeError) {
 const calls=[];
 class HubError extends Error {
  constructor(status,code,message){super(message);this.name='HubError';this.status=status;this.code=code;}
 }
 const hub={HubError,getHubService:()=>({rpc:async(name,parameters)=>{
  calls.push({name,parameters});
  if(name==='hub_reserve_rate_limit')return{data:true,error:null};
  if(name==='hub_workspace_get')return{data:structuredClone(row),error:null};
  if(name==='hub_workspace_save'||name==='hub_workspace_delete')return{data:{...row,data:parameters.p_data??row.data,version:row.version+1},error:writeError??null};
  throw new Error(`Unexpected RPC: ${name}`);
 }}),databaseError:()=>{throw new Error('Unexpected database error');}};
 const modules=new Map();
 function load(name){
  if(modules.has(name))return modules.get(name).exports;
  const module={exports:{}};modules.set(name,module);
  const filename=new URL(`../lib/workspace/${name}.ts`,import.meta.url);
  const compiled=transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ModuleKind.CommonJS,target:ScriptTarget.ES2022}}).outputText;
  runInNewContext(compiled,{module,exports:module.exports,require:specifier=>{
   if(specifier==='server-only')return{};
   if(specifier==='@/lib/hub/server')return hub;
   if(specifier==='./validation')return validation;
   if(specifier.startsWith('./'))return load(specifier.slice(2));
   if(specifier.startsWith('node:'))return builtinRequire(specifier);
   throw new Error(`Unexpected import: ${specifier}`);
  }},{filename:filename.pathname});
  return module.exports;
 }
 return{api:load('server'),calls,writes:()=>calls.filter(call=>['hub_workspace_save','hub_workspace_delete'].includes(call.name))};
}
const publishingContext={user:{id:'10000000-0000-4000-8000-000000000001'},apps:[{slug:'novanook'},{slug:'other-app'}],workspaceAccess:{marketing:{level:'write',companyLevel:'write'}}};
function marketingRow(state){
 const data=validateWorkspaceData('marketing','draft',post({platforms:['facebook','x'],contentType:'text',caption:'Approved caption'}));
 if(state)data.delivery={facebook:{state:'failed',attemptId:'old-attempt'},x:{state,attemptId:'current-attempt'}};
 return{id:'20000000-0000-4000-8000-000000000001',module:'marketing',app_slug:'novanook',title:'Post',status:'draft',data,version:4,created_by:publishingContext.user.id,created_at:'2026-11-04T12:00:00Z',updated_at:'2026-11-04T12:00:00Z'};
}
const conflict=code=>error=>error.status===409&&error.code===code;

test('generic save, cancel, move, and delete cannot mutate any channel while publishing',async()=>{
 const row=marketingRow('publishing');
 const server=mutationServer(row);
 for(const change of [{title:'Renamed'},{status:'cancelled'},{data:{...row.data,caption:'Replacement caption'}},{appSlug:'other-app'}]){
  await assert.rejects(server.api.saveWorkspaceRecord(publishingContext,{version:4,...change},row.id),conflict('DELIVERY_IN_PROGRESS'));
 }
 await assert.rejects(server.api.deleteWorkspaceRecord(publishingContext,row.id,4),conflict('DELIVERY_IN_PROGRESS'));
 assert.equal(server.writes().length,0);
});

test('generic mutations bind both stale and anticipated versions to the inspected snapshot',async()=>{
 for(const version of [3,5]){
  const row=marketingRow();const server=mutationServer(row);
  await assert.rejects(server.api.saveWorkspaceRecord(publishingContext,{version,title:'Changed'},row.id),conflict('RECORD_CHANGED'));
  await assert.rejects(server.api.deleteWorkspaceRecord(publishingContext,row.id,version),conflict('RECORD_CHANGED'));
  assert.equal(server.writes().length,0);
 }
 const row=marketingRow();const server=mutationServer(row,{code:'40001'});
 await assert.rejects(server.api.saveWorkspaceRecord(publishingContext,{version:4,title:'Changed'},row.id),conflict('RECORD_CHANGED'));
 await assert.rejects(server.api.deleteWorkspaceRecord(publishingContext,row.id,4),conflict('RECORD_CHANGED'));
 assert.equal(server.writes().length,2);
 assert.ok(server.writes().every(call=>call.parameters.p_version===4),'a later publishing claim must encounter the original checked version');
});

test('finished attempts retain their scope but allow normal edits and deletions',async()=>{
 for(const state of ['published','failed','uncertain']){
  const row=marketingRow(state);const server=mutationServer(row);
  await assert.rejects(server.api.saveWorkspaceRecord(publishingContext,{version:4,appSlug:'other-app'},row.id),conflict('DELIVERY_SCOPE_LOCKED'));
  assert.equal(server.writes().length,0);
  await server.api.saveWorkspaceRecord(publishingContext,{version:4,title:'Updated notes'},row.id);
  assert.equal((await server.api.deleteWorkspaceRecord(publishingContext,row.id,4)).deleted,true);
  assert.equal(server.writes().length,2);
 }
});

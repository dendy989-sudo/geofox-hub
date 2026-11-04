import test from 'node:test';
import assert from 'node:assert/strict';
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

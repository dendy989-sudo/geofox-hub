import {z} from 'zod';
import {apiError,json,readJson,sameOrigin} from '@/lib/security/http';
import {HubError} from '@/lib/hub/server';
import {ownerContext,getOperations,limit,rpc,db,check,syncBilling,testEmail,schedulePost,importBills,audit} from '@/lib/ops/server';
import {prepareRepair,openRepairPr,inspectRepair} from '@/lib/ops/engineering';
import {refreshPostMetrics} from '@/lib/ops/social';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=180;
export async function GET(){try{return json(await getOperations(await ownerContext()));}catch(e){return apiError(e);}}
export async function POST(request:Request){try{
 sameOrigin(request);const c=await ownerContext();await limit(c,'mutations',15);const {operation,payload}=await readJson(request,60000);let result:unknown;
 switch(operation){
 case 'configure':{const p=z.object({version:z.number().int().positive(),enabled:z.boolean(),support:z.boolean(),incidents:z.boolean(),daily:z.number().int().min(1).max(40)}).strict().parse(payload);await rpc('hub_ops_configure',{p_actor:c.user.id,p_version:p.version,p_enabled:p.enabled,p_support:p.support,p_incidents:p.incidents,p_daily:p.daily});result={message:'Workflow controls saved. Draft-only automation; exact outbound approvals are unchanged.'};break;}
 case 'billing':await limit(c,'billing',2);await syncBilling(true);result={message:'Billing connections checked. Inspect each source result and data coverage.'};break;
 case 'test_email':result=await testEmail(c,z.object({id:z.uuid()}).strict().parse(payload).id);break;
 case 'route_mail':{const p=z.object({id:z.uuid(),app:z.string().max(48),ignore:z.boolean()}).strict().parse(payload);result=await rpc('hub_ops_route_mail',{p_actor:c.user.id,p_id:p.id,p_app:p.app,p_ignore:p.ignore});break;}
 case 'schedule':result=await schedulePost(c,payload);break;
 case 'cancel_schedule':{const id=z.object({id:z.uuid()}).strict().parse(payload).id;const r=await db().from('hub_ops_jobs').update({state:'cancelled',finished_at:new Date().toISOString()}).eq('id',id).eq('actor_id',c.user.id).eq('kind','publish').eq('state','scheduled').select('id');check(r.error);if(!r.data?.length)throw new HubError(409,'ALREADY_CLAIMED','This post is no longer pending. Check its activity and native account.');await audit(c,'alfred.post.cancelled',id,'Owner cancelled a pending scheduled publication');result={message:'Pending publication cancelled.'};break;}
 case 'metrics':{const p=z.object({id:z.uuid(),platform:z.enum(['facebook','x'])}).strict().parse(payload);result=await refreshPostMetrics(c,p.id,p.platform);break;}
 case 'import_bills':result=await importBills(c,payload);break;
 case 'prepare_repair':await limit(c,'repair',2);result=await prepareRepair(c,payload);break;
 case 'approve_repair':result=await openRepairPr(c,z.object({id:z.uuid()}).strict().parse(payload).id);break;
 case 'inspect_repair':result=await inspectRepair(c,z.object({id:z.uuid()}).strict().parse(payload).id);break;
 default:throw new HubError(400,'OPERATION','Unknown operation.');}
 return json(result);
 }catch(e){return apiError(e instanceof z.ZodError?new HubError(400,'INVALID_INPUT','Check the required fields, dates and amounts. No credentials belong in these forms.'):e);}}

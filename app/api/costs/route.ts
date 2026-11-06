import { ZodError } from "zod";
import { HubError } from "@/lib/hub/server";
import { after } from 'next/server';
import { apiError,json,readJson,sameOrigin } from '@/lib/security/http';
import { costContext,costDashboard,mutateCost,syncCosts } from '@/lib/costs/server';
import { assess } from '@/lib/costs/model';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function GET(request:Request){try{const c=await costContext(),q=new URL(request.url).searchParams,data=await costDashboard(c,q.get('scope')??'all',q.get('month')??undefined);if(q.has('summary'))return json({alerts:data.alerts.filter(a=>a.active).length,gaps:data.services.filter(s=>assess(s).gap).length,lastCheck:data.monitor.lastCompletedAt,emailConfigured:data.emailConfigured});return json(data);}catch(e){return apiError(e instanceof ZodError ? new HubError(400,"INVALID_COST_INPUT","Review the service, date, amount and threshold fields.") : e);}}
export async function POST(request:Request){try{sameOrigin(request);const c=await costContext(),p=await readJson(request,20000),data=await mutateCost(c,p);if(p.operation!=='refresh')after(async()=>{try{await syncCosts(c);}catch{console.warn('cost.monitor.failed',{stage:'after-mutation'});}});return json(data);}catch(e){return apiError(e instanceof ZodError ? new HubError(400,"INVALID_COST_INPUT","Review the service, date, amount and threshold fields.") : e);}}

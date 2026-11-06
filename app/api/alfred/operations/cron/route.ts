import {apiError,json} from '@/lib/security/http';
import {authenticateCostCron} from '@/lib/costs/server';
import {runWorkflowTick} from '@/lib/ops/server';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=180;
export async function GET(request:Request){try{authenticateCostCron(request);if(process.env.VERCEL_ENV!=='production')return json({skipped:true});return json(await runWorkflowTick());}catch(e){return apiError(e);}}

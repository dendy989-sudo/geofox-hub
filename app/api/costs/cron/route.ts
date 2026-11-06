import { apiError,json } from '@/lib/security/http';
import { authenticateCostCron,syncCosts } from '@/lib/costs/server';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function GET(request:Request){try{authenticateCostCron(request);if(process.env.VERCEL_ENV!=='production')return json({skipped:true});return json(await syncCosts());}catch(e){return apiError(e);}}

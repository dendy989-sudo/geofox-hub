import {loadTaxData,requireTaxContext} from "@/lib/taxes/server";
import {apiError} from "@/lib/security/http";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(request:Request){try{const context=await requireTaxContext();const year=Number(new URL(request.url).searchParams.get("year"));const snapshot=await loadTaxData(context,year,true);return new Response(JSON.stringify({exported_at:new Date().toISOString(),format:"geofox-tax-records-v1",...snapshot},null,2),{headers:{"Content-Type":"application/json","Content-Disposition":`attachment; filename="geofox-taxes-${year}-records.json"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex"}});}catch(error){return apiError(error);}}

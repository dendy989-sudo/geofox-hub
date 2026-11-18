import {loadTaxData,mutateTax,requireTaxContext} from "@/lib/taxes/server";
import {apiError,json,readJson,sameOrigin} from "@/lib/security/http";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(request:Request){try{const context=await requireTaxContext();const year=Number(new URL(request.url).searchParams.get("year")??new Intl.DateTimeFormat("en",{timeZone:"America/Chicago",year:"numeric"}).format(new Date()));return json(await loadTaxData(context,year));}catch(error){return apiError(error);}}
export async function POST(request:Request){try{sameOrigin(request);const context=await requireTaxContext();return json(await mutateTax(context,await readJson(request,512000)));}catch(error){return apiError(error);}}

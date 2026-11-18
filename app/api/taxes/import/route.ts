import {mutateTaxImport} from "@/lib/taxes/imports";
import {requireTaxContext} from "@/lib/taxes/server";
import {apiError,json,readJson,sameOrigin} from "@/lib/security/http";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request:Request){try{sameOrigin(request);const context=await requireTaxContext();return json(await mutateTaxImport(context,await readJson(request,3500000)));}catch(error){return apiError(error);}}

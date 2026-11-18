import {askTaxAssistant} from "@/lib/taxes/assistant";
import {requireTaxContext} from "@/lib/taxes/server";
import {apiError,json,readJson,sameOrigin} from "@/lib/security/http";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request:Request){try{sameOrigin(request);const context=await requireTaxContext();return json(await askTaxAssistant(context,await readJson(request)));}catch(error){return apiError(error);}}

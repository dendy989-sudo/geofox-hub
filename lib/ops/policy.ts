import { createHash,createHmac,timingSafeEqual } from 'node:crypto';
export function stableId(value:string){const h=createHash('sha256').update(value).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
export function verifyInbound(raw:string,headers:Headers,secret:string,now=Date.now()){
 const id=headers.get('svix-id')??'',stamp=headers.get('svix-timestamp')??'',sig=headers.get('svix-signature')??'';
 if(!/^whsec_[A-Za-z0-9+/=]+$/.test(secret)||!/^[A-Za-z0-9_-]{5,120}$/.test(id)||!/^\d{10,12}$/.test(stamp)||Math.abs(now/1000-Number(stamp))>300||sig.length>2000)return false;
 const key=Buffer.from(secret.slice(6),'base64');if(key.length<16)return false;
 const expected=createHmac('sha256',key).update(`${id}.${stamp}.${raw}`).digest();
 return sig.split(' ').some(part=>{const [version,s]=part.split(',');if(version!=='v1'||!s)return false;const got=Buffer.from(s,'base64');return got.length===expected.length&&timingSafeEqual(got,expected);});
}
export function sensitiveCase(category:string,text:string){return ['billing','safety','account'].includes(category)||/\b(refund|chargeback|lawyer|legal notice|subpoena|suicid\w*|self.harm|abuse|child safety|password|delete my account|breach|hacked|stolen|credit card)\b/i.test(text);}
export function repairPath(path:string){return /^(components\/[A-Za-z0-9_\-/]+\.(?:tsx|ts|css)|app\/[A-Za-z0-9_\-/]+\.css)$/.test(path)&&!path.includes('..')&&!/(auth|billing|payment|security|secret|finance|admin|alfred|costs|ops)/i.test(path);}
function chargeAccumulator(maxRows=100000){
 let total=0,rows=0,periodStart:string|null=null,periodEnd:string|null=null;
 const products=new Map<string,{usd:number;quantity:number;unit:string}>();
 return {add(line:string){
  if(!line.trim())return;if(++rows>maxRows)throw new Error('FOCUS_REPORT_LIMIT');
  const r=JSON.parse(line);if(!r||r.BillingCurrency!=='USD'||r.BilledCost===null||r.BilledCost===undefined||typeof r.BilledCost==='boolean')throw new Error('FOCUS_SCHEMA_INVALID');
  const n=Number(r.BilledCost);if(!Number.isFinite(n))throw new Error('FOCUS_SCHEMA_INVALID');total+=n;
  for(const [name,which] of [['ChargePeriodStart','start'],['ChargePeriodEnd','end']] as const){const date=r[name];if(typeof date==='string'&&Number.isFinite(Date.parse(date))){if(which==='start'&&(!periodStart||date<periodStart))periodStart=date;if(which==='end'&&(!periodEnd||date>periodEnd))periodEnd=date;}}
  const key=String(r.ServiceName??r.SkuId??'Unallocated').slice(0,120),unit=String(r.ConsumedUnit??'').slice(0,40),q=Number(r.ConsumedQuantity??0);
  const group=key+'|'+unit,p=products.get(group)??{usd:0,quantity:0,unit};p.usd+=n;p.quantity+=Number.isFinite(q)?q:0;products.set(group,p);
  if(products.size>2000)throw new Error('FOCUS_REPORT_LIMIT');
 },finish(){return {billedUsd:Number(total.toFixed(6)),rowCount:rows,periodStart,periodEnd,serviceGroups:products.size,serviceGroupsTruncated:products.size>100,products:[...products].sort((a,b)=>b[1].usd-a[1].usd).slice(0,100).map(([name,p])=>({name,...p})),note:'Provider-reported billed charges, not proof of payment. Provider day boundaries can extend outside the requested UTC month. May overlap recorded invoices and AI credit purchases. Do not add to cash totals.'};}};
}
export function parseVercelCharges(raw:string){const a=chargeAccumulator();for(const line of raw.split('\n'))a.add(line);return a.finish();}
/** Stream and aggregate FOCUS rows rather than buffering an entire month in memory. */
export async function readVercelCharges(response:Response,maxBytes=64*1024*1024,maxRows=100000){
 const reader=response.body?.getReader();if(!reader)throw new Error('FOCUS_SCHEMA_INVALID');
 const a=chargeAccumulator(maxRows),decoder=new TextDecoder();let n=0,pending='';
 try{while(true){const part=await reader.read();if(part.done)break;n+=part.value.byteLength;if(n>maxBytes)throw new Error('FOCUS_REPORT_LIMIT');pending+=decoder.decode(part.value,{stream:true});let i:number;while((i=pending.indexOf('\n'))!==-1){const line=pending.slice(0,i);if(line.length>100000)throw new Error('FOCUS_REPORT_LIMIT');a.add(line);pending=pending.slice(i+1);}if(pending.length>100000)throw new Error('FOCUS_REPORT_LIMIT');}pending+=decoder.decode();a.add(pending);return a.finish();}catch(e){try{await reader.cancel();}catch{}throw e;}finally{reader.releaseLock();}
}
export async function boundedText(response:Response,max=2000000){const reader=response.body?.getReader();if(!reader)throw new Error('Missing response');const chunks:Uint8Array[]=[];let n=0;while(true){const p=await reader.read();if(p.done)break;n+=p.value.length;if(n>max){await reader.cancel();throw new Error('Response exceeds limit');}chunks.push(p.value);}return Buffer.concat(chunks).toString('utf8');}

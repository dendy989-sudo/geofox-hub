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
export function parseVercelCharges(raw:string){
 let total=0;let rows=0;const products=new Map<string,{usd:number;quantity:number;unit:string}>();
 for(const line of raw.split('\n').filter(s=>s.trim())){const r=JSON.parse(line);if(!r||r.BillingCurrency!=='USD')throw new Error('Unsupported billing currency');const n=Number(r.BilledCost);if(r.BilledCost==null||!Number.isFinite(n))throw new Error('Incomplete billing data');total+=n;rows++;
 const key=String(r.ServiceName??r.SkuId??'Unallocated').slice(0,120),unit=String(r.ConsumedUnit??'').slice(0,40),q=Number(r.ConsumedQuantity??0);const p=products.get(key+'|'+unit)??{usd:0,quantity:0,unit};p.usd+=n;p.quantity+=Number.isFinite(q)?q:0;products.set(key+'|'+unit,p);
 }
 return {billedUsd:Number(total.toFixed(6)),rowCount:rows,products:[...products].slice(0,100).map(([name,p])=>({name,...p})),note:'Provider-reported billed charges, not proof of payment. May overlap recorded invoices and AI credit purchases. Do not add to cash totals.'};
}
export async function boundedText(response:Response,max=2000000){const reader=response.body?.getReader();if(!reader)throw new Error('Missing response');const chunks:Uint8Array[]=[];let n=0;while(true){const p=await reader.read();if(p.done)break;n+=p.value.length;if(n>max){await reader.cancel();throw new Error('Response exceeds limit');}chunks.push(p.value);}return Buffer.concat(chunks).toString('utf8');}

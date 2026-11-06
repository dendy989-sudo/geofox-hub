import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyInbound,boundedText } from '@/lib/ops/policy';
import { db,check } from '@/lib/ops/server';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=30;
export async function POST(request:Request){
 const secret=process.env.RESEND_WEBHOOK_SECRET,key=process.env.RESEND_API_KEY,allowed=(process.env.ALFRED_INBOUND_ADDRESSES??'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 if(!secret||!key||!allowed.length)return NextResponse.json({error:'Email intake is not configured.'},{status:503});
 let raw:string;try{raw=await boundedText(new Response(request.body),65536);}catch{return NextResponse.json({error:'Payload too large.'},{status:413});}
 if(!verifyInbound(raw,request.headers,secret))return NextResponse.json({error:'Invalid webhook signature.'},{status:401});
 try{
 const event=JSON.parse(raw);if(event.type!=='email.received')return NextResponse.json({received:true,ignored:true});
 const id=z.uuid().parse(event.data?.email_id);const prior=await db().from('hub_ops_mail').select('id').eq('id',id).maybeSingle();check(prior.error);if(prior.data)return NextResponse.json({received:true,duplicate:true});
 const budget=await db().rpc('hub_reserve_rate_limit',{p_key_hash:'alfred-verified-inbound-email',p_window_seconds:300,p_limit:50});check(budget.error);if(!budget.data)return NextResponse.json({error:'Intake rate limit; provider may retry.'},{status:429});
 const response=await fetch(`https://api.resend.com/emails/receiving/${id}`,{headers:{Authorization:`Bearer ${key}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Provider unavailable');
 const mail=JSON.parse(await boundedText(response,1000000));const to=Array.isArray(mail.to)?mail.to.map((v:unknown)=>String(v).toLowerCase()):[];const recipient=to.find((v:string)=>allowed.includes(v));if(!recipient)return NextResponse.json({received:true,ignored:true});
 const from=String(mail.from??'');const sender=(from.match(/<([^<>]+)>$/)?.[1]??from).trim().toLowerCase();if(!z.email().max(254).safeParse(sender).success)return NextResponse.json({received:true,ignored:true});
 const subject=String(mail.subject??'Email inquiry').replace(/[\r\n\0]/g,' ').slice(0,180);const body=typeof mail.text==='string'&&mail.text.trim()?mail.text.replace(/\0/g,'').slice(0,11500):'[No plain-text content available. Review the original email in Resend. HTML and attachments were not imported.]';
 const r=await db().from('hub_ops_mail').upsert({id,sender,recipient,subject,body,attachment_count:Array.isArray(mail.attachments)?Math.min(mail.attachments.length,100):0},{onConflict:'id',ignoreDuplicates:true});check(r.error);
 return NextResponse.json({received:true,reviewRequired:true});
 }catch{return NextResponse.json({error:'Intake could not be confirmed; retry without creating duplicate messages.'},{status:503});}
}

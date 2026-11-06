import { ImageResponse } from 'next/og';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {apiError,json,readJson,sameOrigin} from '@/lib/security/http';
import {HubError} from '@/lib/hub/server';
import {getWorkspaceRecord,workspaceRpc,verifyWorkspaceUpload,saveWorkspaceRecord} from '@/lib/workspace/server';
import {ownerContext,limit,db,audit} from '@/lib/ops/server';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function POST(request:Request){try{
 sameOrigin(request);const c=await ownerContext();await limit(c,'graphic',4);const p=z.object({id:z.uuid(),version:z.number().int().positive(),headline:z.string().trim().min(1).max(90),subtitle:z.string().trim().max(220),format:z.enum(['square','story'])}).strict().parse(await readJson(request,10000));
 const record=await getWorkspaceRecord(c,p.id,'write');if(record.module!=='marketing'||record.data.kind!=='post'||record.status!=='draft'||record.version!==p.version)throw new HubError(409,'DRAFT_CHANGED','Choose a current unpublished marketing draft.');
 if(Array.isArray(record.data.media)&&record.data.media.length)throw new HubError(409,'MEDIA_EXISTS','This draft already has media; use its composer to avoid overwriting assets.');
 const brand=record.appSlug?c.apps.find(a=>a.slug===record.appSlug)?.name??'Geofox Apps':'Geofox Apps';const width=1080,height=p.format==='story'?1920:1080;
 const image=new ImageResponse(<div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',justifyContent:'space-between',padding:100,background:'#17162b',color:'#faf7ff',fontFamily:'sans-serif'}}><div style={{display:'flex',fontSize:32,letterSpacing:4,color:'#c9bcff'}}>GEOFOX APPS · {brand.toUpperCase()}</div><div style={{display:'flex',flexDirection:'column',gap:42}}><div style={{display:'flex',fontSize:82,fontWeight:700,lineHeight:1.12}}>{p.headline}</div><div style={{display:'flex',fontSize:38,lineHeight:1.4,color:'#ddd6f6'}}>{p.subtitle}</div></div><div style={{display:'flex',fontSize:28,color:'#ada4ca'}}>A Geofox Apps experience.</div></div>,{width,height});
 const bytes=Buffer.from(await image.arrayBuffer());if(bytes.length>5000000)throw new Error('Image too large');
 const path=`marketing/${record.appSlug??'company'}/${randomUUID()}.png`,filename='alfred-brand-card.png';
 await workspaceRpc('hub_workspace_register_upload',{p_actor:c.user.id,p_module:'marketing',p_app:record.appSlug,p_path:path,p_filename:filename,p_content_type:'image/png',p_size:bytes.length});
 const upload=await db().storage.from('hub-workspace').upload(path,bytes,{contentType:'image/png',upsert:false});if(upload.error)throw new HubError(502,'UPLOAD','Graphic could not be saved.');
 const verified=await verifyWorkspaceUpload(c,path);await saveWorkspaceRecord(c,{version:p.version,data:{...record.data,contentType:'photo',media:[{...verified,width,height}],thumbnail:{...verified,width,height}}},record.id);
 await audit(c,'alfred.graphic.created',record.id,'Owner-authored branded PNG attached to draft. No public post, AI image request or video generation.');return json({message:'Branded PNG saved to the draft. No post published. Review/download in Marketing.'});
 }catch(e){return apiError(e instanceof z.ZodError?new HubError(400,'GRAPHIC_INPUT','Review the graphic text and selected draft.'):e);}}

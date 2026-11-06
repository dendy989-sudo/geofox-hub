import 'server-only';
import {HubError,type HubContext} from '@/lib/hub/server';
import {findSocialConnection,verifySocialIdentity} from '@/lib/workspace/marketing-providers';
import {getWorkspaceRecord,workspaceRpc} from '@/lib/workspace/server';
import type {MarketingPost,SocialMetrics} from '@/lib/workspace/marketing-types';
import {socialConnections,audit} from './server';
import {boundedText} from './policy';
/** Read analytics only for a post actually published by this exact configured account. */
export async function refreshPostMetrics(c:HubContext,id:string,platform:'facebook'|'x'){
 const record=await getWorkspaceRecord(c,id,'write');if(record.module!=='marketing'||record.data.kind!=='post')throw new HubError(400,'POST','Choose a post.');
 const post=record.data as unknown as MarketingPost,connection=findSocialConnection(socialConnections(),record.appSlug,platform),published=post.delivery?.[platform];
 if(!connection||!published?.providerId||published.state!=='published'||!await verifySocialIdentity(connection))throw new HubError(409,'METRICS_NOT_CONNECTED','Provider metrics require the same verified account and a post published through its direct connection.');
 const pid=published.providerId;if(!/^\d+(?:_\d+)?$/.test(pid))throw new Error('Invalid provider id');
 const url=platform==='x'?`https://api.x.com/2/tweets/${pid}?tweet.fields=public_metrics,author_id`:`https://graph.facebook.com/${connection.apiVersion}/${pid}?fields=id,from,shares,comments.limit(0).summary(true),reactions.type(LIKE).limit(0).summary(total_count)`;
 const response=await fetch(url,{headers:{Authorization:`Bearer ${connection.accessToken}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)});if(!response.ok)throw new HubError(502,'METRICS_UNAVAILABLE',`Provider metrics returned HTTP ${response.status}. Check analytics permission/API allowance; no missing values were set to zero.`);
 const raw=JSON.parse(await boundedText(response,100000));const metrics:SocialMetrics={source:'provider',capturedAt:new Date().toISOString(),note:'Provider snapshot; absent metrics are unknown, not zero.'};
 const assign=(key:keyof SocialMetrics,n:unknown)=>{if(typeof n==='number'&&Number.isSafeInteger(n)&&n>=0)(metrics as unknown as Record<string,unknown>)[key]=n;};
 if(platform==='x'){if(raw.data?.author_id!==connection.accountId)throw new HubError(409,'ACCOUNT_MISMATCH','The post author did not match this account.');const m=raw.data.public_metrics??{};assign('likes',m.like_count);assign('comments',m.reply_count);assign('shares',m.retweet_count);assign('views',m.impression_count);assign('saves',m.bookmark_count);}
 else{if(raw.from?.id!==connection.accountId)throw new HubError(409,'ACCOUNT_MISMATCH','The post author could not be verified.');assign('likes',raw.reactions?.summary?.total_count);assign('comments',raw.comments?.summary?.total_count);assign('shares',raw.shares?.count);}
 if(Object.keys(metrics).length<=3)throw new HubError(502,'NO_METRICS','No supported metrics were returned.');
 const data={...post,publication:{...post.publication,[platform]:{...post.publication[platform],metrics}}};
 await workspaceRpc('hub_workspace_save',{p_actor:c.user.id,p_id:record.id,p_version:record.version,p_module:'marketing',p_app:record.appSlug,p_title:record.title,p_status:record.status,p_data:data,p_request:null});
 await audit(c,'alfred.marketing.metrics',id,'Provider metrics refreshed for an identity-verified published post');return {message:'Provider metrics saved with a capture time. Missing values remain unknown.'};
}

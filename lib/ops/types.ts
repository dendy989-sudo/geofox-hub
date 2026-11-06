import type {HubApp} from '@/lib/hub/types';
import type {MarketingPost} from '@/lib/workspace/marketing-types';
export interface OpsData{
 settings:{version:number;enabled:boolean;support_enabled:boolean;incidents_enabled:boolean;max_daily_runs:number};
 connections:{id:string;name:string;configured:boolean;need:string;steps:string}[];
 checks:{key:string;state:string;summary:string;data:Record<string,unknown>;checked_at:string}[];
 jobs:{id:string;kind:string;state:string;created_at:string;scheduled_at:string|null;result:{message?:string}|null;payload:{title?:string};run_id:string|null}[];
 inbound:{id:string;sender:string;subject:string;body:string;received_at:string;attachment_count:number}[];
 repairs:{id:string;repo:string;summary:string;base_sha:string;files:{path:string;before:string;content:string}[];state:string;result:{url?:string;message?:string;checks?:{name:string;status:string;conclusion:string}[];headMatches?:boolean}|null}[];
 posts:{id:string;title:string;app_slug:string|null;version:number;status:string;data:MarketingPost}[];
 accounts:{appSlug:string|null;platform:'facebook'|'x';accountId:string;handle:string}[];
 services:{id:string;app_slug:string|null;config:{name:string}}[];apps:HubApp[];
}

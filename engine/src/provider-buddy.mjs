import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createDecipheriv,randomUUID} from 'node:crypto';
import {dpapiUnprotect} from './windows-crypto.mjs';
import {runNativeHelper} from './credentials.mjs';
import {AppError,rememberSecret,atomicJson} from './util.mjs';
import {selectCliModels,prepareChatBody,declaredTools} from '../vendor/workbuddy-core.mjs';
import {providerFetch,providerJson} from './provider-http.mjs';
import {buddyChatRejection} from './provider-rate-limit.mjs';

function endpoints(c){const allowed=['www.workbuddy.ai','www.codebuddy.ai','www.codebuddy.cn','www.workbuddy.cn'];if(!allowed.includes(c.domain))throw new AppError('Buddy登录区域未识别',401,'provider_region_unknown');const global=c.domain.endsWith('.ai');return {global,billing:global?'https://'+c.domain:'https://www.codebuddy.cn',chat:global?'https://'+c.domain:'https://copilot.tencent.com'}}
export function normalizeBuddyCredential(raw,{expectedDomain,filePath,proxyUrl}={}){
  const accessToken=raw.auth?.accessToken??raw.accessToken??raw.token,uid=String(raw.account?.uid??raw.uid??raw.principal??''),domain=raw.auth?.domain??raw.domain;
  if(typeof accessToken!=='string'||!accessToken||!uid)throw new AppError('Buddy登录态待解密或已退出',401,'provider_login_required');rememberSecret(accessToken);
  if(expectedDomain&&domain!==expectedDomain)throw new AppError('Buddy登录区域与账号配置不符',401,'provider_region_mismatch');
  // The IDE stores a full refreshable pair (auth.refreshToken + auth.refreshExpiresAt); keeping it is what
  // makes silent renewal possible once the 28-day access token lapses.
  const refreshTokenRaw=raw.auth?.refreshToken??raw.refreshToken;
  const refreshToken=typeof refreshTokenRaw==='string'?refreshTokenRaw.trim():'';
  if(refreshToken)rememberSecret(refreshToken);
  const c={accessToken,refreshToken,refreshTokenPresent:refreshToken.length>0,refreshExpiresAtMs:buddyExpiryMs(raw.auth?.refreshExpiresAt??raw.refreshExpiresAt),uid,principal:uid,domain,filePath,proxyUrl,source:'desktop',billingPlatform:domain.endsWith('.cn')?'workbuddy':domain,billingPrincipal:uid,expiresAtMs:buddyExpiryMs(raw.auth?.expiresAt??raw.expiresAt)??jwtExpiryMs(accessToken)};endpoints(c);return c;
}
/** Accepts epoch seconds, epoch millis, numeric strings or ISO dates. Unknown → null. */
export function buddyExpiryMs(value){
  if(typeof value==='number'&&Number.isFinite(value))return value>1e12?value:value>1e9?value*1000:null;
  if(typeof value==='string'&&/^\d+$/.test(value.trim()))return buddyExpiryMs(Number(value.trim()));
  if(typeof value==='string'){const t=Date.parse(value);return Number.isFinite(t)?t:null}
  return null;
}
/** exp (ms) from an unverified JWT payload — used only to expose expiry, never to trust identity claims. */
export function jwtExpiryMs(token){try{const payload=JSON.parse(Buffer.from(String(token).split('.')[1]??'','base64url').toString());return Number.isFinite(payload?.exp)?payload.exp*1000:null}catch{return null}}
async function readCodeBuddy(file,edition,localState){
  const db=new DatabaseSync(file,{readOnly:true});let value;try{value=db.prepare('SELECT value FROM ItemTable WHERE key=?').get('secret://'+JSON.stringify({extensionId:'tencent-cloud.coding-copilot',key:'planning-genie.new.accessToken'+(edition==='cn'?'cn':'')}))?.value}finally{db.close()}
  if(!value)throw new AppError('CodeBuddy当前区域尚无登录态',401,'provider_login_required');
  const bytes=Buffer.from(JSON.parse(value).data??[]);if(!['v10','v11'].includes(bytes.subarray(0,3).toString()))throw new AppError('CodeBuddy凭据格式待核验',401,'provider_storage_format');
  const state=JSON.parse(await readFile(localState)),wrapped=Buffer.from(state.os_crypt?.encrypted_key??'','base64');if(wrapped.subarray(0,5).toString()!=='DPAPI')throw new AppError('CodeBuddy密钥封装格式待核验',401,'provider_storage_format');
  const key=await dpapiUnprotect(wrapped.subarray(5));let plain;
  try{const d=createDecipheriv('aes-256-gcm',key,bytes.subarray(3,15));d.setAuthTag(bytes.subarray(-16));plain=Buffer.concat([d.update(bytes.subarray(15,-16)),d.final()]);return JSON.parse(plain.toString())}catch{throw new AppError('CodeBuddy本机登录态解密失败',401,'provider_decrypt_failed')}finally{key.fill(0);plain?.fill(0)}
}
export function buddyStoragePaths(account={},config={}){
  const ai=account.platform==='workbuddyai',edition=ai?'global':account.edition,explicit=account.credentials?.file;
  const profile=account.credentials?.profileDir;const dir=profile?(config.path?config.path(profile):profile):join(process.env.APPDATA??join(homedir(),'AppData/Roaming'),'CodeBuddy'+(edition==='cn'?' CN':''));
  const file=explicit&&explicit!=='auto'?(config.path?config.path(explicit):explicit):ai?join(process.env.LOCALAPPDATA??join(homedir(),'AppData/Local'),'CodeBuddyExtension/Data/Public/auth/workbuddy-desktop-ai.info'):join(dir,'User/globalStorage/state.vscdb');
  const state=account.credentials?.localState;const localState=state?(config.path?config.path(state):state):join(dir,'Local State');
  return {dir,file,localState};
}
async function readBuddyCredential(account,config={}){
  const ai=account.platform==='workbuddyai',edition=ai?'global':account.edition;
  if(!['cn','global'].includes(edition))throw new AppError('明确选择Buddy国内或国际账号',400,'provider_region_required');
  const domain=ai?'www.workbuddy.ai':edition==='cn'?'www.codebuddy.cn':'www.codebuddy.ai';const {file,localState}=buddyStoragePaths(account,config);
  let raw;if(account.credentials?.kind==='file'||ai){raw=JSON.parse(await readFile(file));if(ai&&typeof raw.auth?.accessToken==='object'){raw.auth.accessToken=await runNativeHelper(account.credentials?.executable??'D:/WorkBuddyAI/WorkBuddyAI.exe',raw.auth.accessToken)}}else raw=await readCodeBuddy(file,edition,localState);
  return normalizeBuddyCredential(raw,{expectedDomain:domain,filePath:file,proxyUrl:account.credentials?.proxyUrl});
}
export async function resolveBuddyCredential(account,config={}){try{return await readBuddyCredential(account,config)}catch(e){if(e.code==='ENOENT'||e.code==='ERR_SQLITE_ERROR')throw new AppError('Buddy本机登录文件待就绪',401,'provider_login_required');throw e}}
function headers(c){const global=endpoints(c).global,base={Authorization:'Bearer '+c.accessToken,Accept:'application/json','Content-Type':'application/json','X-User-Id':c.uid,'X-Domain':c.domain,'X-Product':'SaaS','X-Requested-With':'XMLHttpRequest','User-Agent':global?'WorkBuddy/5.5.2':'CLI/2.63.2 CodeBuddy/2.63.2'};if(global){base['X-Conversation-ID']=randomUUID();base['X-Conversation-Request-ID']=randomUUID();base['X-Conversation-Message-ID']=randomUUID()}return base}
async function api(c,path,body,options={},surface='billing'){const data=await providerJson(endpoints(c)[surface]+path,c,{...options,body,headers:headers(c)});if(data.code!==0){const e=new AppError(`Buddy业务接口返回 ${typeof data.code==='number'?data.code:'异常'}`,502,'provider_business_error');e.upstreamCode=data.code;throw e}return data.data}
export async function buddyModels(c,options={}){const data=await api(c,'/v3/config',undefined,options,'chat');return selectCliModels(data?.models,data?.agents).map(m=>({...m,tools:m.supportsToolCall===true,multimodal:m.supportsImages===true,callable:true,source:'buddy-official-config'}))}
export async function buddyStatus(c,task='daily-checkin',options={}){
  if(task!=='daily-checkin')throw new AppError('Buddy任务未登记',400,'provider_task_unknown');const r=await api(c,'/v2/billing/meter/checkin-activity-status',{},options);
  return {known:true,active:r.active===true,supportsCheckin:r.active===true,claimable:r.active===true&&r.today_checked_in!==true,claimed:r.today_checked_in===true,principal:c.principal,day:new Date(Date.now()+8*3600000).toISOString().slice(0,10),credits:typeof r.today_credit==='number'?r.today_credit:null,details:{streakDays:r.streak_days,dailyCredit:r.daily_credit,todayCredit:r.today_credit},source:'official_checkin_status',billingIdentity:endpoints(c).billing+':'+c.principal};
}
export async function buddyCredits(c,options={}){
  const data=await api(c,'/v2/billing/meter/get-user-resource',{PageNumber:1,PageSize:100,ProductCode:'p_tcaca',Status:[0,3],PackageEndTimeRangeBegin:new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,19).replace('T',' '),PackageEndTimeRangeEnd:'2126-01-01 00:00:00'},options);
  const parseDate=x=>typeof x==='number'&&x>1e12?x:typeof x==='string'?Date.parse(x):NaN;const rows=data?.Response?.Data?.Accounts;if(!Array.isArray(rows))throw new AppError('Buddy资源包响应缺失',502,'provider_invalid_response');const packages=[];for(const a of rows){const monthly=a.CapacityType===4,remain=Math.max(0,Number(monthly?a.CycleCapacityRemain:a.CapacityRemain)||0),size=Number(monthly?a.CycleCapacitySize:a.CapacitySize)||0,expiry=parseDate(a.ExpiredTime??a.CycleEndTime);if(!monthly&&(!remain||Number.isFinite(expiry)&&expiry<=Date.now()))continue;packages.push({packageName:a.PackageName??'',monthly,remain,size,expiresAtMs:monthly?null:Number.isFinite(expiry)?expiry:null,refreshAtMs:monthly&&Number.isFinite(parseDate(a.CycleEndTime))?parseDate(a.CycleEndTime)+1000:null})}return {source:'official_resource_packages',total:packages.reduce((sum,x)=>sum+x.remain,0),packages};
}
export async function buddyHealth(c,options={}){const [sr,cr]=await Promise.allSettled([buddyStatus(c,'daily-checkin',options),buddyCredits(c,options)]);if(sr.status==='rejected'&&cr.status==='rejected')throw sr.reason;const checkin=sr.status==='fulfilled'?sr.value:{known:false,claimable:false,claimed:false,error:sr.reason.code??'provider_status_failed'},credits=cr.status==='fulfilled'?cr.value:{total:null,packages:[],error:cr.reason.code??'provider_balance_failed'};return {status:'authenticated',supportsCheckin:checkin.known?checkin.supportsCheckin===true:null,checkinKnown:checkin.known===true,checkinError:checkin.known?null:checkin.error,capabilities:{checkin:checkin.known?checkin.supportsCheckin===true:null,inference:true},checkin,credits,balance:{value:credits.total,unit:'积分',parts:credits.packages.map(x=>({name:x.packageName,value:x.remain,unit:'积分',...x})),note:!checkin.known?'签到状态读取失败，未确认活动是否开启':credits.error?'余额读取失败；签到状态独立核验':checkin.supportsCheckin?'官方资源包余额':'官方签到活动未开启',checkedIn:checkin.known?checkin.claimed:null}}}
export async function buddyClaim(c,task='daily-checkin',options={}){
  const before=await buddyStatus(c,task,options);if(!before.claimable)return {...before,submitted:false,alreadyClaimed:before.claimed};let result;
  try{result=await api(c,'/v2/billing/meter/daily-checkin',{},options)}catch(e){if(e.upstreamCode!==10001)throw e;result={already:true}}
  const [after,credits]=await Promise.all([buddyStatus(c,task,options),buddyCredits(c,options)]);
  if(!after.claimed)throw new AppError('Buddy领取结果尚未得到服务端确认',502,'provider_claim_unconfirmed');
  return {...after,claimed:true,submitted:true,alreadyClaimed:result.already===true,credit:result.credit??null,credits,rechecked:true};
}
export async function buddyChat(upstream,c,input,signal,options={}){
  const request={...input,stream:true};if(request.max_completion_tokens!==undefined&&request.max_tokens===undefined)request.max_tokens=request.max_completion_tokens;delete request.max_completion_tokens;const body=prepareChatBody(JSON.stringify(request)),tools=declaredTools(body),fetchImpl=options.fetchImpl??providerFetch;
  const response=await fetchImpl(endpoints(c).chat+'/v2/chat/completions',{method:'POST',headers:headers(c),body,signal,proxyUrl:c.proxyUrl,redirect:'error',headersTimeoutMs:90000,requestTimeoutMs:180000});
  if(!response.ok)throw await buddyChatRejection(response,{signal,errorBodyMaxBytes:options.errorBodyMaxBytes,errorBodyTimeoutMs:options.errorBodyTimeoutMs});
  return {response,recovery:tools?{declaredNames:tools.names,requiredParameters:tools.requiredParameters,pinnedToolName:tools.pinnedToolName}:undefined};
}
export const codeBuddyProvider={resolve:resolveBuddyCredential,models:buddyModels,health:buddyHealth,status:buddyStatus,claim:buddyClaim,chat:buddyChat};
export const workBuddyAIProvider=codeBuddyProvider;

// ------------------------------------------------------------------ silent renewal (token expiry)
// Endpoint and header set verified live 2026-11-16 against the official client flow (antecedents:
// anye-99/dsh-codearts-auth src/buddy-oauth.ts refreshToken + src/refresh.ts RefreshScheduler):
//   POST {billing}/v2/plugin/auth/token/refresh   body {}   → {code:0,data:{accessToken,refreshToken,expiresIn}}
// X-Refresh-Token alone is sufficient; the bearer/domain headers are what the IDE sends. A rotated pair is
// never written back into state.vscdb (the IDE owns that file); it goes to the gateway snapshot instead.
export const BUDDY_REFRESH_PATH='/v2/plugin/auth/token/refresh';
export const BUDDY_RENEW_LEAD_MS=3*24*60*60*1000;
const BUDDY_REFRESH_TERMINAL_HTTP=new Set([401,403]);
export async function refreshBuddyCredential(c,{fetchImpl,signal,now=Date.now(),timeoutMs=20000}={}){
  if(typeof now==='function')now=now();
  const token=typeof c?.refreshToken==='string'?c.refreshToken.trim():'';
  if(!token){const e=new AppError('Buddy续期凭据缺失，请先在原客户端重新登录',401,'provider_refresh_login_required');e.loginRequired=true;throw e}
  const call=fetchImpl??globalThis.fetch;if(typeof call!=='function')throw new AppError('Buddy网络请求需要显式注入fetchImpl',400,'provider_fetch_not_injected');
  const activeSignal=signal??AbortSignal.timeout(timeoutMs),global=endpoints(c).global;
  let response;
  try{
    response=await call(endpoints(c).billing+BUDDY_REFRESH_PATH,{method:'POST',body:'{}',redirect:'error',signal:activeSignal,headers:{Authorization:'Bearer '+c.accessToken,Accept:'application/json','Content-Type':'application/json','X-Refresh-Token':token,'X-Auth-Refresh-Source':'ide-main','X-Domain':c.domain,'X-User-Id':c.uid,'X-Product':'SaaS','X-Requested-With':'XMLHttpRequest','User-Agent':global?'WorkBuddy/5.5.2':'CLI/2.63.2 CodeBuddy/2.63.2'}});
  }catch(error){
    if(activeSignal.aborted)throw new AppError('Buddy续期请求已取消或超时',499,'request_cancelled');
    const lost=new AppError('Buddy续期结果未确认（网络失败），等待重新读取本机登录态',503,'provider_refresh_unconfirmed');lost.retryable=true;throw lost;
  }
  let envelope=null;try{envelope=await response.json()}catch{envelope=null}
  const code=envelope?.code;
  if(BUDDY_REFRESH_TERMINAL_HTTP.has(response.status)||code===401||code===403){
    const e=new AppError(`Buddy续期凭据已失效，请在原客户端重新登录${envelope?.msg?`: ${envelope.msg}`:''}`,401,'provider_refresh_login_required');e.loginRequired=true;e.upstreamCode=typeof code==='number'?code:null;throw e;
  }
  const accessToken=typeof envelope?.data?.accessToken==='string'?envelope.data.accessToken.trim():'';
  if(!response.ok||code!==0||!accessToken){
    const lost=new AppError(`Buddy续期结果未确认${envelope?.msg?`: ${envelope.msg}`:` (HTTP ${response.status})`}`,503,'provider_refresh_unconfirmed');lost.retryable=true;lost.upstreamCode=typeof code==='number'?code:null;throw lost;
  }
  const rotated=typeof envelope.data.refreshToken==='string'&&envelope.data.refreshToken.trim()?envelope.data.refreshToken.trim():token;
  rememberSecret(accessToken);rememberSecret(rotated);
  const accessIn=Number(envelope.data.expiresIn),refreshIn=Number(envelope.data.refreshExpiresIn);
  return {accessToken,refreshToken:rotated,rotated:rotated!==token,expiresAtMs:jwtExpiryMs(accessToken)??(accessIn>0?now+accessIn*1000:null),refreshExpiresAtMs:refreshIn>0?now+refreshIn*1000:jwtExpiryMs(rotated),refreshedAt:new Date(now).toISOString()};
}
/** Apply a rotated pair to a resolved credential (used after a successful refresh). */
export function withBuddyTokens(c,rotated){return {...c,accessToken:rotated.accessToken,refreshToken:rotated.refreshToken??c.refreshToken,refreshTokenPresent:true,expiresAtMs:rotated.expiresAtMs??c.expiresAtMs,refreshExpiresAtMs:rotated.refreshExpiresAtMs??c.refreshExpiresAtMs,source:'gateway_snapshot',renewedAt:rotated.refreshedAt}}
export function buddySnapshotPath(config,accountId){const dataDir=config?.dataDir;return dataDir&&accountId?join(dataDir,'accounts',accountId,'buddy-session.json'):null}
export async function readBuddySnapshot(file){if(!file)return null;try{const data=JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));return data&&typeof data==='object'?data:null}catch{return null}}
export async function saveBuddySnapshot(file,snapshot){if(!file)throw new AppError('未配置Buddy续期快照路径',500,'provider_snapshot_path');rememberSecret(snapshot?.accessToken);rememberSecret(snapshot?.refreshToken);await atomicJson(file,{schemaVersion:1,platform:'buddy',managedBy:'ai-credit-gateway',accessToken:snapshot.accessToken,refreshToken:snapshot.refreshToken,expiresAtMs:snapshot.expiresAtMs??null,refreshExpiresAtMs:snapshot.refreshExpiresAtMs??null,uid:snapshot.uid??null,domain:snapshot.domain??null,rotatedAt:snapshot.refreshedAt??new Date().toISOString()});return file}
export function shouldRenewBuddy({expiresAtMs,now=Date.now(),leadMs=BUDDY_RENEW_LEAD_MS}){return Number.isFinite(expiresAtMs)?expiresAtMs-now<=leadMs:false}

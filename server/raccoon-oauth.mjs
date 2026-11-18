// Raccoon (商汤小浣熊) web authorization: a loopback browser flow and a paste
// entry that both end in the same credential file. Nothing here talks to a
// user-supplied URL, prints a token, or writes outside
// <stateRoot>/private/raccoon-oauth/.
//
// The authorization URL is the single documented exception to the plugin's
// "authorizeUrl is never published" rule: it is handed back only by
// POST /hub/raccoon/oauth/begin, only while that state is still valid, and the
// client opens it directly instead of rendering it.
import {createServer} from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {hubError} from './contracts.mjs';
import {
  isRaccoonOAuthAccountId,
  raccoonOAuthAccountFile,
  raccoonOAuthAccountId,
  raccoonOAuthDirectory,
  raccoonOAuthFile,
  raccoonOAuthRelativeFile,
} from './raccoon-oauth-path.mjs';

export const RACCOON_ORIGIN='https://xiaohuanxiong.com';
export const AUTHORIZE_PATH='/code/authorize';
export const CALLBACK_PATH='/auth/callback';
export const EXCHANGE_PATH='/api/web/auth/v1/login_with_authorization_code';
export const BALANCE_PATH='/api/web/points/v1/balance';
export const AUTHORIZATION_CODE_NOT_FOUND=200035;
export const CODE_EXCHANGE_TIMEOUT_MS=20000;
export const AUTHORIZE_WINDOW_MS=600000;
export const SESSION_RETENTION_MS=1800000;
export const PROBE_THROTTLE_MS=60000;
export const PROBE_TIMEOUT_MS=5000;
export const PASTE_LIMIT=8192;
export const CALLBACK_MESSAGES=Object.freeze({
  ok:'小浣熊网页授权已完成，可以关闭此页面。',
  failed:'小浣熊网页授权未完成，请返回并重新授权。',
  rejected:'该回调不属于本次网页授权，请回到原页面重新发起。',
});
const DAY=86400000;
const digest=value=>createHash('sha256').update(String(value)).digest('hex');
const instant=value=>{
  if(value instanceof Date)return value.getTime();
  if(typeof value==='number')return value;
  const text=String(value??'').trim();
  if(!text)return NaN;
  return /^\d+$/.test(text)?Number(text):Date.parse(text);
};
export const stripBearer=value=>String(value??'').trim().replace(/^Bearer\s+/i,'').trim();
export function decodeJwtClaims(token){
  const raw=stripBearer(token),parts=raw.split('.');
  if(parts.length!==3||!parts[1])return null;
  try{const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));return claims&&typeof claims==='object'&&!Array.isArray(claims)?claims:null;}catch{return null;}
}
// Byte-identical to the desktop reader: claims.name, then claims.sub, then a
// principal already stored in the token document. Never `sid`.
export function raccoonOAuthIdentity(claims,raw){
  const identity=claims?.name??claims?.sub??raw?.principal;
  return typeof identity==='string'&&identity.trim()?identity.trim():null;
}
export function raccoonOAuthPrincipal(identity){
  return identity?'raccoon:'+digest(identity).slice(0,24):null;
}
export function remainingDaysOf(expiresAtMs,nowMs=Date.now()){
  if(!Number.isFinite(expiresAtMs))return 0;
  return Math.max(0,Math.ceil((expiresAtMs-nowMs)/DAY));
}
// N10: only the 7-day tier is announced on the event channel; the three closer
// tiers stay inline so a single credential never produces four alerts.
export function renewalLevel({expiresAtMs=NaN,nowMs=Date.now(),invalid=false}={}){
  const expired=invalid||!Number.isFinite(expiresAtMs)||expiresAtMs<=nowMs;
  if(expired)return 'expired';
  const days=remainingDaysOf(expiresAtMs,nowMs);
  if(days<=3)return 'urgent';
  if(days<=7)return 'warn';
  return 'info';
}
export function createAuthorizeState({randomBytesImpl=randomBytes}={}){
  const state=randomBytesImpl(32).toString('hex');
  if(!/^[a-f0-9]{64}$/.test(state))throw hubError('raccoon_oauth_state_invalid','Authorization state could not be generated',500);
  return state;
}
export function buildAuthorizeUrl({port,state,origin=RACCOON_ORIGIN}){
  if(!Number.isInteger(port)||port<1||port>65535)throw hubError('raccoon_oauth_listen_failed','Authorization callback port is invalid',503);
  if(!/^[a-f0-9]{64}$/.test(String(state??'')))throw hubError('raccoon_oauth_state_invalid','Authorization state is invalid',400);
  const query=new URLSearchParams();
  query.set('login_source','desktop');
  query.set('appname','办公小浣熊客户端');
  query.set('state',String(state));
  query.set('desktop_callback','loopback');
  query.set('redirect','http://127.0.0.1:'+port+CALLBACK_PATH);
  return String(origin).replace(/\/+$/,'')+AUTHORIZE_PATH+'?'+query.toString();
}
export function parsePasteInput(input){
  const text=String(input??'').trim();
  if(!text)throw hubError('raccoon_oauth_paste_invalid','请粘贴回调链接或令牌',400);
  if(text.length>PASTE_LIMIT)throw hubError('raccoon_oauth_paste_invalid','粘贴内容过长，请只粘贴回调链接或令牌',400);
  if(text.startsWith('{')){
    let parsed;try{parsed=JSON.parse(text);}catch{throw hubError('raccoon_oauth_paste_invalid','粘贴的 JSON 无法解析',400);}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw hubError('raccoon_oauth_paste_invalid','粘贴的 JSON 不是令牌对象',400);
    const accessToken=stripBearer(parsed.access_token??parsed.accessToken);
    const refreshToken=stripBearer(parsed.refresh_token??parsed.refreshToken);
    if(!accessToken)throw hubError('raccoon_oauth_paste_invalid','JSON 中缺少 access_token',400);
    return {kind:'tokens',accessToken,refreshToken};
  }
  if(!text.includes('://')&&text.split('.').length===3)return {kind:'tokens',accessToken:stripBearer(text),refreshToken:''};
  let url;
  try{url=new URL(text);}catch{throw hubError('raccoon_oauth_paste_invalid','无法识别的回调链接或令牌格式',400);}
  if(!['office-raccoon:','https:','http:'].includes(url.protocol))throw hubError('raccoon_oauth_paste_invalid','不支持的回调链接协议',400);
  const codes=url.searchParams.getAll('code'),states=url.searchParams.getAll('state');
  const code=(codes[0]??'').trim();
  if(!code)throw hubError('raccoon_oauth_callback_code_invalid','回调链接中缺少授权码 code',400);
  if(codes.length!==1||code.length>4096)throw hubError('raccoon_oauth_callback_code_invalid','回调链接中的授权码无效',400);
  return {kind:'code',code,state:states.length===1?states[0]:''};
}
function exchangeError(code,message,status){return hubError('raccoon_oauth_'+code,message,status);}
export async function exchangeAuthorizationCode({code,fetchImpl=globalThis.fetch,origin=RACCOON_ORIGIN,timeoutMs=CODE_EXCHANGE_TIMEOUT_MS}={}){
  const value=String(code??'').trim();
  if(!value)throw exchangeError('callback_code_invalid','授权码为空，请重新发起网页授权',400);
  if(typeof fetchImpl!=='function')throw exchangeError('exchange_unavailable','本机缺少网络能力，无法换取网页授权凭据',503);
  let response;
  try{
    response=await fetchImpl(String(origin).replace(/\/+$/,'')+EXCHANGE_PATH,{
      method:'POST',
      headers:{'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({authorization_code:value}),
      redirect:'error',
      signal:AbortSignal.timeout(timeoutMs),
    });
  }catch(error){
    // The code may or may not have been consumed upstream: say so plainly and
    // ask the operator to start over instead of retrying silently.
    const name=String(error?.name??'');
    if(name==='TimeoutError'||name==='AbortError')throw exchangeError('exchange_unconfirmed','授权码已提交，但厂商在超时时间内没有回应；请重新发起网页授权',503);
    throw exchangeError('exchange_unconfirmed','无法连接厂商授权服务，请检查网络后重新发起网页授权',503);
  }
  if(response.status===429)throw exchangeError('rate_limited','厂商授权服务要求稍后再试，请稍后重新发起网页授权',429);
  if(response.status>=500)throw exchangeError('exchange_unavailable','厂商授权服务暂时不可用，请稍后重新发起网页授权',503);
  let payload;try{payload=await response.json();}catch{payload=null;}
  if(!payload||typeof payload!=='object')throw exchangeError('exchange_invalid','厂商返回了无法识别的授权结果，请重新发起网页授权',502);
  if(Number(payload.code)===AUTHORIZATION_CODE_NOT_FOUND)throw exchangeError('code_expired','授权码已失效，请重新发起网页授权',400);
  if(!response.ok)throw exchangeError('exchange_rejected','厂商拒绝了本次授权请求，请重新发起网页授权',502);
  const data=payload.data??{};
  const accessToken=stripBearer(data.access_token??data.accessToken);
  const refreshToken=stripBearer(data.refresh_token??data.refreshToken);
  if(!accessToken||!refreshToken)throw exchangeError('exchange_failed','厂商未返回完整的令牌对，请重新发起网页授权',502);
  const claims=decodeJwtClaims(accessToken);
  const expiresAtMs=Number(claims?.exp)>0?Number(claims.exp)*1000:NaN;
  if(!Number.isFinite(expiresAtMs))throw exchangeError('exchange_invalid','厂商返回的访问令牌缺少有效期，请重新发起网页授权',502);
  return {accessToken,refreshToken,claims,expiresAtMs};
}
function readJsonSafe(file){
  return readFile(file,'utf8').then(text=>JSON.parse(text));
}
function credentialDocument({identity,claims,accessToken,refreshToken,expiresAtMs,via,nowMs}){
  const sub=claims?.sub?String(claims.sub):null;
  const sid=claims?.sid?String(claims.sid):null;
  return {
    schemaVersion:1,
    authKind:'oauth_iam',
    source:'raccoon_oauth_loopback',
    acquiredVia:via,
    obtainedAt:new Date(nowMs).toISOString(),
    accessExpiresAt:new Date(expiresAtMs).toISOString(),
    expiresAt:new Date(expiresAtMs).toISOString(),
    identity:{sub,subHash:sub?digest(sub).slice(0,24):null,sidHash:sid?digest(sid).slice(0,24):null,nameHash:digest(identity).slice(0,24)},
    access_token:accessToken,
    refresh_token:refreshToken??'',
    tokenPairRotatable:!!refreshToken,
    notes:'网页授权凭据。到期或失效后请使用「重新授权」在浏览器再次确认，本插件不直接调用厂商刷新接口。',
  };
}
export function createRaccoonOAuth({
  service,
  options,
  withMutation,
  settings=()=>({}),
  fetchImpl=globalThis.fetch,
  now=Date.now,
  randomBytesImpl=randomBytes,
  probeEnabled=true,
  onAccountCommitted=null,
}={}){
  const sessions=new Map(),probes=new Map();
  const enabled=()=>settings()?.enabled!==false;
  function guardEnabled(){if(!enabled())throw hubError('raccoon_oauth_disabled','网页授权已在插件设置中关闭',403);}
  const activeSession=()=>{
    for(const session of sessions.values())if(session.phase==='pending')return session;
    return null;
  };
  function accountOf(accountId){
    return (service?.config?.value?.accounts??[]).find(account=>account.id===accountId)??null;
  }
  function prune(){
    const at=now();
    for(const [id,session] of sessions)if(session.phase!=='pending'&&session.finishedAt&&at-session.finishedAt>SESSION_RETENTION_MS)sessions.delete(id);
  }
  function view(session){
    return {
      sessionId:session.id,
      phase:session.phase,
      startedAt:new Date(session.startedAt).toISOString(),
      expiresAt:new Date(session.expiresAt).toISOString(),
      remainingMs:Math.max(0,session.expiresAt-now()),
      reauth:!!session.reauth,
      accountId:session.accountId??null,
      error:session.error?{code:session.error.code,message:session.error.message}:null,
    };
  }
  function respond(res,status,body){
    try{
      res.writeHead(status,{
        'content-type':'text/plain; charset=utf-8',
        'cache-control':'no-store',
        'referrer-policy':'no-referrer',
        'content-security-policy':"default-src 'none'",
        'x-content-type-options':'nosniff',
        connection:'close',
      });
      res.end(body);
    }catch{}
  }
  function stopListening(session){
    if(session.closed)return;
    session.closed=true;
    if(session.timer){clearTimeout(session.timer);session.timer=null;}
    try{session.server.close();}catch{}
    try{session.server.closeIdleConnections?.();}catch{}
  }
  function settle(session,phase,error=null){
    if(session.phase==='pending')session.phase=phase;
    session.finishedAt=now();
    session.error=error;
    stopListening(session);
  }
  async function listen(session){
    await new Promise((resolve,reject)=>{
      const onError=error=>{session.server.removeListener('listening',onListening);reject(error);};
      const onListening=()=>{session.server.removeListener('error',onError);resolve();};
      session.server.once('error',onError);
      session.server.once('listening',onListening);
      session.server.listen(0,'127.0.0.1');
    }).catch(error=>{
      throw hubError('raccoon_oauth_listen_failed','无法在本机开启网页授权回调端口，请重试或改用粘贴回调链接',503);
    });
    session.port=session.server.address().port;
    session.host='127.0.0.1:'+session.port;
    session.authorizeUrl=buildAuthorizeUrl({port:session.port,state:session.state});
  }
  async function writeCredential(accountId,document){
    const directory=raccoonOAuthDirectory(options);
    await mkdir(directory,{recursive:true});
    const file=raccoonOAuthFile(options,accountId);
    const tmp=file+'.'+randomBytesImpl(6).toString('hex')+'.tmp';
    // W3: mode 0o600 is advisory on Windows — the ACL of the private directory is the real
    // boundary there, while POSIX gets the 0600 bit (asserted in the loopback tests off win32).
    await writeFile(tmp,JSON.stringify(document,null,2)+'\n',{mode:0o600});
    await rename(tmp,file);
    return file;
  }
  async function commitAccount(accountId,relativeFile){
    const operation=async()=>{
      if(typeof service?.config?.load==='function')await service.config.load();
      const value=structuredClone(service.config.value),upstreamId='up-'+accountId;
      let account=value.accounts.find(item=>item.id===accountId),created=false;
      if(account){
        account.platform='raccoon';
        account.credentials={...(account.credentials??{}),kind:'oauth',authKind:'oauth_iam',file:relativeFile};
      }else{
        created=true;
        value.accounts.push({
          id:accountId,
          platform:'raccoon',
          label:'小浣熊（网页授权）',
          enabled:true,
          inferenceEnabled:true,
          edition:'personal',
          credentials:{kind:'oauth',authKind:'oauth_iam',file:relativeFile},
          tasks:[{id:'daily-quota',enabled:true}],
        });
      }
      if(!value.upstreams.some(item=>item.id===upstreamId))value.upstreams.push({id:upstreamId,kind:'raccoon',accountId,enabled:true,baseUrl:RACCOON_ORIGIN+'/api/web'});
      await service.config.save(value);
      try{service.credentials?.cache?.clear?.();}catch{}
      return {created};
    };
    return typeof withMutation==='function'?withMutation(operation):operation();
  }
  async function persist({accessToken,refreshToken,claims,expiresAtMs,via,reauthTarget}){
    const identity=raccoonOAuthIdentity(claims);
    if(!identity)throw hubError('raccoon_identity_missing','授权结果里没有可识别的账号身份，请重新授权',401);
    const principal=raccoonOAuthPrincipal(identity);
    const accountId=raccoonOAuthAccountId('raccoon',principal);
    if(reauthTarget&&reauthTarget!==accountId)throw hubError('raccoon_oauth_account_mismatch','重新授权的账号与当前账号不一致，原凭据未改动',409);
    const sub=claims?.sub?String(claims.sub):null;
    if(reauthTarget){
      let prior=null;
      try{prior=await readJsonSafe(raccoonOAuthFile(options,accountId));}catch{}
      if(prior?.identity?.sub&&sub&&String(prior.identity.sub)!==sub)throw hubError('raccoon_oauth_account_mismatch','重新授权的账号与当前账号不一致，原凭据未改动',409);
    }
    const document=credentialDocument({identity,claims,accessToken,refreshToken,expiresAtMs,via,nowMs:now()});
    await writeCredential(accountId,document);
    const {created}=await commitAccount(accountId,raccoonOAuthRelativeFile(accountId));
    probes.delete(accountId);
    // Requirement A, trigger 1: the account now exists, so refresh its model routes
    // once. Best-effort — a catalog failure must not undo a completed authorization —
    // and never fatal, so `paste`/loopback results keep their shape.
    let routes=null;
    if(typeof onAccountCommitted==='function'){try{routes=await onAccountCommitted({accountId,principal,created,via});}catch{routes=null;}}
    return {accountId,principal,created,expiresAtMs,via,...(routes?{routeCount:routes.routeCount??0,catalogStatus:routes.catalogStatus??null}:{})};
  }
  async function handleCallback(session,req,res){
    let url;
    try{url=new URL(req.url??'/', 'http://127.0.0.1');}catch{return respond(res,404,CALLBACK_MESSAGES.rejected);}
    if(req.headers.host!==session.host)return respond(res,404,CALLBACK_MESSAGES.rejected);
    if(url.pathname!==CALLBACK_PATH)return respond(res,404,CALLBACK_MESSAGES.rejected);
    if(req.method!=='GET')return respond(res,405,CALLBACK_MESSAGES.rejected);
    if(session.settled||session.phase!=='pending')return respond(res,409,CALLBACK_MESSAGES.rejected);
    const states=url.searchParams.getAll('state');
    if(states.length!==1||states[0]!==session.state)return respond(res,400,CALLBACK_MESSAGES.rejected);
    if(url.searchParams.has('error')){
      settle(session,'failed',{code:'raccoon_oauth_callback_error',message:'授权被拒绝或取消，请重新发起网页授权'});
      return respond(res,400,CALLBACK_MESSAGES.failed);
    }
    const codes=url.searchParams.getAll('code'),code=(codes[0]??'').trim();
    if(codes.length!==1||!code||code.length>4096){
      settle(session,'failed',{code:'raccoon_oauth_callback_code_invalid',message:'回调链接里没有有效授权码，请重新发起网页授权'});
      return respond(res,400,CALLBACK_MESSAGES.failed);
    }
    session.settled=true;
    // Close the port before the exchange so no second callback can arrive while
    // the code is being redeemed; the in-flight response still completes.
    stopListening(session);
    try{
      const tokens=await exchangeAuthorizationCode({code,fetchImpl});
      const result=await persist({...tokens,via:'loopback',reauthTarget:session.reauth?session.accountId:null});
      session.accountId=result.accountId;
      session.phase='done';
      session.finishedAt=now();
      return respond(res,200,CALLBACK_MESSAGES.ok);
    }catch(error){
      const code=typeof error?.code==='string'?error.code:'raccoon_oauth_exchange_failed';
      const message=typeof error?.message==='string'&&error.message?error.message:'网页授权未完成，请重新发起';
      settle(session,'failed',{code,message});
      return respond(res,502,CALLBACK_MESSAGES.failed);
    }
  }
  async function begin(input={}){
    guardEnabled();
    if(!service?.config?.value)throw hubError('raccoon_oauth_unavailable','网页授权需要运行中的插件后端',503);
    prune();
    const reauth=input.reauth===true;
    const target=input.accountId?String(input.accountId):null;
    if(target){
      if(!isRaccoonOAuthAccountId(target))throw hubError('raccoon_oauth_account_invalid','网页授权账号标识无效',400);
      const account=accountOf(target);
      if(!account)throw hubError('raccoon_oauth_account_not_found','找不到要重新授权的网页授权账号',404);
      if(account.credentials?.authKind!=='oauth_iam')throw hubError('raccoon_oauth_account_invalid','该账号不是网页授权账号，请用桌面复用或重新添加',400);
    }
    const pending=activeSession();
    if(pending){
      if(pending.expiresAt>now())throw hubError('raccoon_oauth_busy','已有一个网页授权正在等待浏览器确认，请先完成或取消',409);
      settle(pending,'expired',{code:'raccoon_oauth_expired',message:'上一次网页授权等待超时，请重新发起'});
    }
    const state=createAuthorizeState({randomBytesImpl});
    const session={
      id:'oauth-'+randomBytesImpl(8).toString('hex'),
      state,
      phase:'pending',
      startedAt:now(),
      expiresAt:now()+AUTHORIZE_WINDOW_MS,
      reauth:!!(reauth||target),
      accountId:target,
      settled:false,
      closed:false,
      port:0,
      host:null,
      authorizeUrl:null,
      error:null,
      timer:null,
      finishedAt:null,
      server:null,
    };
    session.server=createServer((request,response)=>{void handleCallback(session,request,response);});
    await listen(session);
    session.timer=setTimeout(()=>{
      if(session.phase!=='pending')return;
      settle(session,'expired',{code:'raccoon_oauth_expired',message:'浏览器授权等待超过 10 分钟，请重新发起'});
    },AUTHORIZE_WINDOW_MS);
    session.timer.unref?.();
    sessions.set(session.id,session);
    // N1(b): the only response that may carry the authorization URL, and only
    // while its state is still valid. Every other surface strips `authorizeUrl`.
    return {...view(session),authorizeUrl:session.authorizeUrl,callbackHost:session.host,message:'请在浏览器完成小浣熊登录并确认授权；授权完成后回到这里查看结果。'};
  }
  async function sessionStatus(sessionId){
    guardEnabled();
    const id=String(sessionId??'');
    const session=sessions.get(id);
    if(!session)throw hubError('raccoon_oauth_session_unknown','这次网页授权会话不存在或已经结束，请重新发起',404);
    if(session.phase==='pending'&&session.expiresAt<=now())settle(session,'expired',{code:'raccoon_oauth_expired',message:'浏览器授权等待超过 10 分钟，请重新发起'});
    return view(session);
  }
  function cancel(sessionId){
    guardEnabled();
    const id=String(sessionId??'');
    const session=sessions.get(id);
    if(!session)throw hubError('raccoon_oauth_session_unknown','这次网页授权会话不存在或已经结束，请重新发起',404);
    if(session.phase==='pending')settle(session,'cancelled',{code:'raccoon_oauth_cancelled',message:'网页授权已取消'});
    return view(session);
  }
  async function probeAccount(accountId,{accessToken,expiresAtMs}){
    const at=now();
    if(!probeEnabled||typeof fetchImpl!=='function')return {invalid:false,probed:false};
    if(!Number.isFinite(expiresAtMs)||expiresAtMs<=at){
      probes.set(accountId,{at,invalid:true});
      return {invalid:true,probed:false};
    }
    const prior=probes.get(accountId);
    if(prior&&at-prior.at<PROBE_THROTTLE_MS)return {invalid:prior.invalid===true,probed:false};
    let invalid=prior?.invalid===true;
    try{
      const response=await fetchImpl(RACCOON_ORIGIN+BALANCE_PATH,{method:'GET',headers:{authorization:'Bearer '+accessToken,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(PROBE_TIMEOUT_MS)});
      try{await response.body?.cancel?.();}catch{}
      if(response.status===401||response.status===403)invalid=true;
      else if(response.ok)invalid=false;
    }catch{
      // A probe that cannot reach the vendor is not evidence of a revocation:
      // keep the previous verdict and never surface it as an error.
    }
    probes.set(accountId,{at,invalid});
    return {invalid,probed:true};
  }
  async function accountsView(){
    const at=now(),rows=[];
    for(const account of service?.config?.value?.accounts??[]){
      if(account?.credentials?.kind!=='oauth')continue;
      if(account?.credentials?.authKind!=='oauth_iam')continue;
      const base={accountId:account.id,label:account.label??'小浣熊（网页授权）',platform:account.platform,source:'raccoon_oauth_loopback',enabled:account.enabled!==false,inferenceEnabled:account.inferenceEnabled!==false};
      let document=null;
      try{document=await readJsonSafe(raccoonOAuthAccountFile(options,account));}catch{}
      if(!document||document.authKind!=='oauth_iam'||!stripBearer(document.access_token)){
        rows.push({...base,state:'missing',needsReauth:true,renewalLevel:'expired',expiresAt:null,expiresAtMs:null,remainingDays:0,acquiredVia:null,obtainedAt:null});
        continue;
      }
      const accessToken=stripBearer(document.access_token);
      const expiresAtMs=instant(document.accessExpiresAt??document.expiresAt??decodeJwtClaims(accessToken)?.exp*1000);
      const {invalid}=await probeAccount(account.id,{accessToken,expiresAtMs});
      const expired=!Number.isFinite(expiresAtMs)||expiresAtMs<=at;
      rows.push({
        ...base,
        state:expired?'expired':'ready',
        needsReauth:expired||invalid,
        renewalLevel:renewalLevel({expiresAtMs,nowMs:at,invalid}),
        expiresAt:Number.isFinite(expiresAtMs)?new Date(expiresAtMs).toISOString():null,
        expiresAtMs:Number.isFinite(expiresAtMs)?expiresAtMs:null,
        remainingDays:remainingDaysOf(expiresAtMs,at),
        acquiredVia:document.acquiredVia??null,
        obtainedAt:document.obtainedAt??null,
        serverSessionValidated:invalid?false:null,
      });
    }
    return rows;
  }
  async function overview(){
    guardEnabled();
    const pending=activeSession();
    return {
      enabled:true,
      active:pending?view(pending):null,
      accounts:await accountsView(),
      windows:{authorize:Math.round(AUTHORIZE_WINDOW_MS/1000),probeThrottle:Math.round(PROBE_THROTTLE_MS/1000)},
      reauth:{browserRequired:true,note:'续期需要你在浏览器中确认，通常一次点击；浏览器会话过期时需要重新登录'},
      sources:{desktop:'桌面复用',oauth:'网页授权'},
    };
  }
  async function paste(input={}){
    guardEnabled();
    const body=typeof input==='string'?{input}:input??{};
    const parsed=parsePasteInput(body.input);
    const target=body.accountId?String(body.accountId):null;
    if(target){
      if(!isRaccoonOAuthAccountId(target))throw hubError('raccoon_oauth_account_invalid','网页授权账号标识无效',400);
      const account=accountOf(target);
      if(!account)throw hubError('raccoon_oauth_account_not_found','找不到要重新授权的网页授权账号',404);
      if(account.credentials?.authKind!=='oauth_iam')throw hubError('raccoon_oauth_account_invalid','该账号不是网页授权账号，请用桌面复用或重新添加',400);
    }
    let tokens;
    if(parsed.kind==='tokens'){
      const claims=decodeJwtClaims(parsed.accessToken);
      const expiresAtMs=Number(claims?.exp)>=0?Number(claims.exp)*1000:NaN;
      if(!claims||!Number.isFinite(expiresAtMs)||expiresAtMs<=0)throw hubError('raccoon_oauth_token_invalid','粘贴的内容不是有效的访问令牌',400);
      if(expiresAtMs<=now())throw hubError('raccoon_oauth_token_expired','粘贴的访问令牌已经过期，请重新获取',401);
      tokens={accessToken:parsed.accessToken,refreshToken:parsed.refreshToken,claims,expiresAtMs};
    }else{
      const pending=activeSession();
      // A pasted link may carry the state this plugin issued; when it does and a
      // session is waiting, the two must agree. An unknown state never blocks a
      // paste, and an unrecognizable input never reaches the network.
      if(parsed.state&&pending&&parsed.state!==pending.state)throw hubError('raccoon_oauth_state_mismatch','这条回调不属于本次网页授权，请重新发起或重新复制',400);
      tokens=await exchangeAuthorizationCode({code:parsed.code,fetchImpl});
    }
    const result=await persist({...tokens,via:'paste',reauthTarget:target});
    return {saved:true,...result,needsReauth:false,renewalLevel:renewalLevel({expiresAtMs:result.expiresAtMs,nowMs:now()})};
  }
  function dispose(){
    for(const session of sessions.values())stopListening(session);
    sessions.clear();
  }
  return {begin,sessionStatus,cancel,paste,overview,dispose};
}

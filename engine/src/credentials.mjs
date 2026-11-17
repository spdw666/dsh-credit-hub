import {desktopProvider,desktopProviderKinds} from './provider-registry.mjs';
import {resolveFreeCredential} from './free-providers.mjs';
import {bigModelCredential} from './bigmodel.mjs';
import {readFile, writeFile, rename, stat, access, open, unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join, dirname, resolve} from 'node:path';
import {homedir, userInfo} from 'node:os';
import {createHash,createDecipheriv} from 'node:crypto';
import {AppError, rememberSecret, readJson, hash,atomicJson} from './util.mjs';
import {projectRoot} from './config.mjs';
import {parseTraeStorageDocument, readTraeIdentity} from '../vendor/trae-core.mjs';
import {refreshTraeToken, rewriteTraeStorageAuth} from './trae-refresh.mjs';
import {decryptElectronJson} from './windows-crypto.mjs';
import {parseMiniMaxCredential} from './minimax.mjs';
import {refreshQwenSession} from './qwenwork.mjs';
import {readMiniMaxDesktop,miniMaxRuntimeDir} from './minimax-desktop.mjs';
import {refreshWorkBuddyCredential} from './workbuddy-auth.mjs';
import {loomyResolve} from './provider-loomy.mjs';
import {refreshQoderDeviceToken,qoderCredentialWriteback,qoderStoragePaths} from './provider-qoder.mjs';
export function jwtClaims(token) {try{return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString())}catch{return {}}}
async function firstExisting(paths) {for(const p of paths){if(!p)continue;try{await access(p);return p}catch{}}throw new AppError('Local credential file not found',401,'credential_missing');}
function appData() {return process.env.APPDATA??(process.platform==='darwin'?join(homedir(),'Library/Application Support'):join(homedir(),'.config'));}
// Trae tokens live 7 days; refresh a day early so a desktop client never has to
// be opened just to keep the snapshot usable.
const TRAE_RENEW_LEAD_MS=24*60*60*1000;
// Qoder device tokens live about a month; renew a week early so a client that
// never runs again cannot strand the snapshot, without rotating the refresh
// family more often than it has to.
const QODER_RENEW_LEAD_MS=7*24*60*60*1000;
function localData(){return process.env.LOCALAPPDATA??(process.platform==='darwin'?join(homedir(),'Library/Application Support'):join(homedir(),'.local/share'));}
export async function resolveCredentialFile(account,config) {
  const explicit=account.credentials?.file;
  if(explicit&&explicit!=='auto')return config.path(explicit);
  if(account.platform==='nvidia')return join(homedir(),'.ai-credit-gateway/nvidia/credential.json');
  if(account.platform==='workbuddy')return firstExisting([process.env.WORKBUDDY_AUTH_FILE,join(localData(),'CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info'),join(homedir(),'.local/share/CodeBuddyExtension/Data/Public/auth/Tencent-Cloud.coding-copilot.info')]);
  if(account.platform==='trae'){
    const names={cn:['Trae CN','trae-cn'],solo:['TRAE SOLO CN','trae-solo-cn'],sg:['Trae','trae'], 'solo-sg':['TRAE SOLO','trae-solo']}[account.edition??'cn'];
    return firstExisting(names.map(name=>join(appData(),name,'User/globalStorage/storage.json')));
  }
  if(account.platform==='qwenwork')return firstExisting([join(appData(),'QwenWorkCN/auth-v2.dat'),join(appData(),'QwenWork/auth-v2.dat'),join(appData(),'QwenWorkCN/auth.dat'),join(appData(),'QwenWork/auth.dat')]);
  if(account.platform==='zcode')return firstExisting([join(homedir(),'.zcode/v2/credentials.json')]);
  if(account.platform==='minimax'&&account.credentials?.kind==='desktop')return firstExisting([join(miniMaxRuntimeDir(account,config),'auth/prod',account.region==='intl'?'en':'cn','mcode-public/auth.json')]);
  throw new AppError('Configure an account-specific credentials file',401,'credential_missing');
}
export async function resolveWorkBuddyExecutable(account,config) {
  const value=account.credentials.executable;
  if(value&&value!=='auto')return config.path(value);
  return firstExisting([process.env.WORKBUDDY_APP_EXECUTABLE,process.env.WORKBUDDY_EXE,join(localData(),'Programs/WorkBuddy/WorkBuddy.exe'), ...(process.platform==='win32'?['D:/workbuddy/WorkBuddy.exe']:[]),...(process.platform==='darwin'?['/Applications/WorkBuddy.app/Contents/MacOS/Electron']:[])]);
}
export function runNativeHelper(executable,value,{timeout=12000}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,[join(projectRoot,'vendor/wb-auth-helper.cjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:['pipe','pipe','pipe']});
    let result=Buffer.alloc(0), settled=false;
    const fail=(code)=>{if(settled)return;settled=true;clearTimeout(timer);child.kill();reject(new AppError(`WorkBuddy credential helper: ${code}`,401,code));};
    const timer=setTimeout(()=>fail('helper_timeout'),timeout);
    child.on('error',()=>fail('helper_start_failed'));
    child.stdout.on('data',chunk=>{result=Buffer.concat([result,chunk]);if(result.length>65536)fail('helper_output_limit');});
    child.stderr.on('data',()=>{}); // Never copy raw runtime stderr to a public diagnostic.
    child.on('close',()=>{
      if(settled)return;settled=true;clearTimeout(timer);
      try {const response=JSON.parse(result.toString('utf8'));result.fill(0);
        if(!response.ok||typeof response.accessToken!=='string')throw new AppError(`WorkBuddy credential helper: ${response.reason??'invalid_response'}`,401,'credential_decrypt_failed');
        resolve(response.accessToken);
      }catch(e){reject(e instanceof AppError?e:new AppError('Invalid credential helper response',401,'credential_decrypt_failed'));}
    });
    child.stdin.on('error',()=>fail('helper_input_failed'));
    child.stdin.end(JSON.stringify({version:1,operation:'decrypt',value}));
  });
}
export class CredentialManager {
  constructor(config,ledger){this.config=config;this.ledger=ledger;this.cache=new Map();this.flights=new Map();this.renewals=new Map();}
  /**
   * Last automatic renewal outcome per account, used by the account table so an
   * operator can tell "snapshot is alive" from "snapshot merely exists".
   */
  async hydrateRenewals(){const all=await readJson(join(this.config.dataDir,'credential-renewal.json')).catch(()=>null);if(all&&typeof all==='object')for(const [id,row] of Object.entries(all))if(row&&typeof row==='object')this.renewals.set(id,row);return this.renewals.size;}
  renewalState(accountId){return this.renewals.get(accountId)??null;}
  // Loomy has no refresh endpoint: the only honest signal is "when does this
  // session die". Exposed as read-only metadata so the account table can show a
  // countdown and a re-login hint before the check-in starts failing.
  async sessionLifetime(accountId){
    const account=this.config.value.accounts?.find(a=>a.id===accountId);
    if(account?.platform!=='loomy')return null;
    try{const secret=await loomyResolve(account,this.config);
      return {expiresAtMs:secret.expiresAtMs??null,renewable:false,reason:secret.expiresAtMs&&secret.expiresAtMs<=Date.now()?'credential_expired':null};
    }catch(error){return {expiresAtMs:null,renewable:false,reason:error.code??'credential_unavailable'};}
  }
  async recordRenewal(accountId,row){const next={...row,at:row.at??new Date().toISOString()};this.renewals.set(accountId,next);try{const file=join(this.config.dataDir,'credential-renewal.json');const all=await readJson(file).catch(()=>({}));all[accountId]=next;const temp=`${file}.${process.pid}.tmp`;await writeFile(temp,JSON.stringify(all,null,2),{mode:0o600});await rename(temp,file);}catch{}return next;}
  account(id) {const a=this.config.value.accounts.find(a=>a.id===id);if(!a||a.enabled===false)throw new AppError('Account missing or disabled',400,'account_disabled');return a;}
  async resolve(id,{force=false,renew=false}={}) {
    const account=this.account(id);
    if(force)this.cache.delete(id);
    if(this.flights.has(id))return this.flights.get(id);
    const p=this.read(account,{renew}).catch(e=>{if(/^(codearts|raccoon)_refresh_source_changed$/.test(e.code??''))return this.read(account,{renew});if(account.platform==='qwenwork'&&e.code==='credential_expired')return this.refreshQwen(id);if(account.platform==='trae'&&e.code==='credential_expired')return this.refreshTrae(id);
      // Desktop stores that carry a refresh token (LobsterAI, CodeBuddy) renew on an expired access token
      // instead of failing: the rotated pair lands in a gateway-owned snapshot, never in the client's files.
      if((account.platform==='lobster'||account.platform==='codebuddy'||account.platform==='workbuddyai')&&(e.code==='credential_expired'||e.code==='provider_login_required'||e.code==='provider_auth_rejected'||e.code==='credential_missing'))return this.renewDesktopSession(account,{trigger:e.code});
      // Qoder's file snapshot carries its own refresh token, so an expired access
      // token is renewed from the device-token endpoint instead of demanding a login.
      if(account.platform==='qoder'&&(e.code==='credential_expired'||e.code==='provider_login_required'||e.code==='provider_auth_rejected'||e.code==='credential_missing'))return this.renewQoder(account,{trigger:e.code});
      throw e;}).finally(()=>this.flights.delete(id));this.flights.set(id,p);return p;
  }
  /**
   * Renew a desktop session from its own refresh token. Used by the scheduler (proactive, before expiry) and
   * by resolve() as the fallback when a snapshot has already expired. A rotation always wins over the desktop
   * database until the next desktop launch, so the caller must persist it before any retry.
   */
  async renewDesktopSession(account,{force=false,trigger='schedule'}={}) {
    const id=account.id;
    if(this.renewals.get(id)?.loginRequired===true&&this.renewals.get(id)?.ok===false&&!force)return this.read(account,{renew:true});
    if(account.platform==='lobster') {
      const {readLobsterRenewalState,lobsterSnapshotPath,readLobsterSnapshot,saveLobsterSnapshot,refreshLobsterToken,lobsterResolve}=await import('./provider-lobster.mjs');
      const file=lobsterSnapshotPath(this.config,id);      const base=await lobsterResolve(account,this.config).catch(()=>null);
      const state=await readLobsterRenewalState({dbFile:base?.dbFile}).catch(()=>null);
      const snap=await readLobsterSnapshot(file);
      const refreshToken=state?.refreshToken||snap?.refreshToken||'';
      const seed={...state,refreshToken,userId:state?.userId||snap?.userId||'',uuid:state?.uuid||snap?.uuid||null,firstKeyfrom:state?.firstKeyfrom??snap?.firstKeyfrom??null,latestKeyfrom:state?.latestKeyfrom??snap?.latestKeyfrom??null};
      const rotated=await refreshLobsterToken(seed,{fetchImpl:this.fetch??globalThis.fetch}).catch(async e=>{await this.recordRenewal(id,{kind:'renew',ok:false,error:e.code??'lobster_refresh_failed',message:String(e.message??'').slice(0,160),loginRequired:e.loginRequired===true,trigger});throw e});
      await saveLobsterSnapshot(file,{...rotated,firstKeyfrom:seed.firstKeyfrom,latestKeyfrom:seed.latestKeyfrom,uuid:seed.uuid});
      await this.recordRenewal(id,{kind:'renew',ok:true,trigger,expiresAt:rotated.expiresAtMs?new Date(rotated.expiresAtMs).toISOString():null,refreshExpiresAt:rotated.refreshExpiresAtMs?new Date(rotated.refreshExpiresAtMs).toISOString():null,rotated:rotated.rotated===true,snapshot:'accounts/'+id+'/lobster-session.json'});
      const live=await lobsterResolve(account,this.config).catch(()=>null);
      if(!live)throw new AppError('LobsterAI 续期后无法读取登录态',401,'credential_missing');
      const merged={...live,accessToken:rotated.accessToken,refreshToken:rotated.refreshToken,refreshTokenPresent:true,expiresAtMs:rotated.expiresAtMs,source:'gateway_snapshot',renewedAt:rotated.refreshedAt};
      const binding=this.ledger.bind(id,account.platform,merged.principal);
      if(!binding.ok)return merged;
      return {...merged,principalHash:binding.fingerprint};
    }
    const {resolveBuddyCredential,refreshBuddyCredential,saveBuddySnapshot,buddySnapshotPath,shouldRenewBuddy}=await import('./provider-buddy.mjs');
    const base=await resolveBuddyCredential(account,this.config);
    if(!base.refreshTokenPresent)throw new AppError('Buddy续期凭据缺失，请先在原客户端重新登录',401,'provider_refresh_login_required');
    const rotated=await refreshBuddyCredential(base,{fetchImpl:this.fetch??globalThis.fetch}).catch(async e=>{await this.recordRenewal(id,{kind:'renew',ok:false,error:e.code??'buddy_refresh_failed',message:String(e.message??'').slice(0,160),loginRequired:e.loginRequired===true,trigger});throw e});
    await saveBuddySnapshot(buddySnapshotPath(this.config,id),{...rotated,uid:base.principal,domain:base.domain});
    await this.recordRenewal(id,{kind:'renew',ok:true,trigger,expiresAt:rotated.expiresAtMs?new Date(rotated.expiresAtMs).toISOString():null,refreshExpiresAt:rotated.refreshExpiresAtMs?new Date(rotated.refreshExpiresAtMs).toISOString():null,rotated:rotated.rotated===true,snapshot:'accounts/'+id+'/buddy-session.json'});
    const merged={...base,accessToken:rotated.accessToken,refreshToken:rotated.refreshToken,expiresAtMs:rotated.expiresAtMs??base.expiresAtMs,refreshExpiresAtMs:rotated.refreshExpiresAtMs??base.refreshExpiresAtMs,source:'gateway_snapshot',renewedAt:rotated.refreshedAt};
    const binding=this.ledger.bind(id,account.platform,merged.principal);
    return binding.ok?{...merged,principalHash:binding.fingerprint}:merged;
  }
  async read(account,{renew=false}={}) {
    if(account.platform==='freeapi'){const c=await resolveFreeCredential(account,this.config),binding=this.ledger.bind(account.id,'freeapi',c.principal);if(!binding.ok)throw new AppError('Provider credential identity changed; rebind this account',409,'principal_changed');return {...c,principalHash:binding.fingerprint};}
    if(desktopProviderKinds.has(account.platform)){
      const p=await desktopProvider(account.platform),c=await p.resolve(account,this.config);
      for(const value of [c?.accessToken,c?.apiKey,c?.token,c?.refreshToken,c?.accessKey,c?.secretKey,c?.securityToken])if(typeof value==='string'&&value)rememberSecret(value);
      if(!c||typeof c.accessToken!=='string'||!c.accessToken||!c.principal)throw new AppError('桌面账号登录态待就绪',401,'credential_missing');
      const binding=this.ledger.bind(account.id,account.platform,c.principal);if(!binding.ok)throw new AppError('桌面账号已切换，请重新绑定此账号',409,'principal_changed');
      if(Number.isFinite(c.expiresAtMs)&&c.expiresAtMs<=Date.now())throw new AppError('桌面登录态已过期，请在原客户端续期',401,'credential_expired');
      return {...c,principalHash:binding.fingerprint};
    }
    const file=await resolveCredentialFile(account,this.config);const info=await stat(file).catch(e=>{if(account.platform==='nvidia')throw new AppError('NVIDIA API Key 待填入本机凭据文件',401,'nvidia_credential_missing');if(account.platform==='minimax')throw new AppError('MiniMax Code 登录态待导入本机凭据文件',401,'minimax_login_required');throw e});
    const fingerprint=hash(JSON.stringify(account.credentials)+file+info.mtimeMs+info.size);
    let credential=account.platform==='minimax'&&account.credentials.kind==='desktop'||renew?undefined:this.cache.get(account.id)?.fingerprint===fingerprint?this.cache.get(account.id).credential:undefined;
    if(account.platform==='workbuddy'&&Number.isFinite(credential?.expiresAtMs)&&credential.expiresAtMs<=Date.now()+60000)credential=undefined;
    if(!credential) {
      if(account.platform==='minimax') {
        const raw=await readJson(file).catch(()=>{throw new AppError('MiniMax Code 登录态待导入本机凭据文件',401,'minimax_login_required')});
        credential=account.credentials.kind==='desktop'?await readMiniMaxDesktop(file,account,this.config):{...parseMiniMaxCredential(raw),filePath:file};
      }else if(account.platform==='nvidia'){
        const raw=await readJson(file).catch(()=>{throw new AppError('NVIDIA 本机凭据应为有效 JSON',401,'nvidia_credential_missing')});
        const key=raw.apiKey??raw.accessToken;rememberSecret(key);
        if(typeof key!=='string'||!/^nvapi-[A-Za-z0-9_-]{20,}$/.test(key))throw new AppError('NVIDIA API Key 待填入本机凭据文件',401,'nvidia_credential_missing');
        credential={accessToken:key,principal:typeof raw.principal==='string'&&raw.principal.trim()?raw.principal:hash(key),proxyUrl:raw.proxyUrl,source:'local-config',filePath:file};
      }else if(account.platform==='bigmodel'){credential={...bigModelCredential(await readJson(file),account.id),filePath:file};}else if(account.credentials.kind==='file') {
        let raw=await readJson(file);if(account.platform==='workbuddy')raw=await this.renewOwnedWorkBuddy(account,file,raw,{renew});credential={...raw,accessToken:raw.accessToken??raw.token,principal:raw.principal??raw.uid??raw.userId??jwtClaims(raw.accessToken??raw.token??'').sub,expiresAtMs:raw.expiresAtMs??jwtClaims(raw.accessToken??raw.token??'').exp*1000,source:'local-config',filePath:file};
      }else if(account.platform==='workbuddy') {
        const raw=await readJson(file);let accessToken=raw.auth?.accessToken;
        if(typeof accessToken==='object')accessToken=await runNativeHelper(await resolveWorkBuddyExecutable(account,this.config),accessToken);
        let refreshToken=raw.auth?.refreshToken??'';
        if(refreshToken&&typeof refreshToken==='object'){try{refreshToken=await runNativeHelper(await resolveWorkBuddyExecutable(account,this.config),refreshToken);}catch{refreshToken='';}}
        if(typeof refreshToken!=='string')refreshToken='';if(refreshToken)rememberSecret(refreshToken);
        const domain=raw.auth?.domain??'www.workbuddy.cn';
        credential={accessToken,refreshToken,uid:String(raw.account?.uid??''),principal:String(raw.account?.uid??''),domain,edition:account.edition??(/workbuddy\.ai$/i.test(domain)?'ai':'cn'),expiresAtMs:raw.auth?.expiresAt??jwtClaims(accessToken??'').exp*1000,profileRaw:raw.account,source:'desktop',filePath:file};
      }else if(account.platform==='trae') {
        const text=await readFile(file,'utf8');const raw=parseTraeStorageDocument(text);
        credential={accessToken:raw.token??raw.accessToken,refreshToken:typeof raw.refreshToken==='string'?raw.refreshToken:'',userId:String(raw.userId??''),principal:String(raw.userId??''),host:raw.host??'',userRegion:raw.userRegion?.region??raw.userRegion,edition:account.edition??'cn',expiresAtMs:typeof raw.expiredAt==='string'?Date.parse(raw.expiredAt):(raw.expiredAt<1e12?raw.expiredAt*1000:raw.expiredAt),source:'desktop',filePath:file};
        credential.identity=await readTraeIdentity({path:file,edition:credential.edition,source:'desktop'});
        if(!this.renewals.has(account.id)&&Number.isFinite(credential.expiresAtMs))await this.recordRenewal(account.id,{kind:'read',ok:true,expiresAt:new Date(credential.expiresAtMs).toISOString()});
        if(credential.refreshToken&&Number.isFinite(credential.expiresAtMs)&&credential.expiresAtMs<=Date.now()+TRAE_RENEW_LEAD_MS) {
          try {
            const renewed=await this.renewTraeFile(account,file,text);
            Object.assign(credential,{accessToken:renewed.accessToken,expiresAtMs:renewed.expiresAtMs,renewedAt:renewed.renewedAt,...(renewed.refreshToken?{refreshToken:renewed.refreshToken}:{})});
          }catch(error) {
            // A live token still works; a dead one must surface as re-login.
            await this.recordRenewal(account.id,{kind:'renew',ok:false,error:error.code??'trae_refresh_failed',message:String(error.message??'').slice(0,160)});
            if(Number.isFinite(credential.expiresAtMs)&&credential.expiresAtMs>Date.now()) {credential.refreshPending=true;credential.refreshError=error.code??'trae_refresh_failed';}
            else throw error;
          }
        }
      }else if(account.platform==='zcode') {
        const raw=await readJson(file);let token=raw.zcodejwttoken;
        if(token?.startsWith('enc:v1:')) {
          const [iv,tag,ct]=token.slice(7).split('.').map(v=>Buffer.from(v,'base64url'));
          const key=createHash('sha256').update(process.env.ZCODE_CREDENTIAL_SECRET??`zcode-credential-fallback:${process.platform}:${homedir()}:${userInfo().username}`).digest();
          try {const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);token=Buffer.concat([decipher.update(ct),decipher.final()]).toString('utf8');}finally{key.fill(0)}
        }
        const claims=jwtClaims(token??'');credential={accessToken:token,principal:String(claims.user_id??claims.sub??''),expiresAtMs:claims.exp*1000,source:'desktop',filePath:file};
        const nativeState=await readJson(join(dirname(file),'telemetry-state.json')).catch(()=>({}));credential.identity={deviceId:nativeState.deviceMid};
      }else if(account.platform==='qwenwork') {
        let raw=await decryptElectronJson(file,join(dirname(file),'Local State'));
        const owned=await readJson(join(this.config.dataDir,'accounts',account.id,'qwenwork-session.json')).catch(()=>null);
        if(owned?.sourceFingerprint===fingerprint&&Date.parse(owned.expiresAt)>Date.now())raw=owned;
        credential={accessToken:raw.token,principal:raw.user?.id,expiresAtMs:Date.parse(raw.expiresAt),user:raw.user,source:'desktop',filePath:file};
        if(raw.user?.isBiz!==false)throw new AppError('QwenWork account is not explicitly in personal mode; switch to 我的 AI 团队 in the client',409,'qwenwork_personal_scope_required');
        if(account.personalTeamId&&raw.user?.teamId!==account.personalTeamId)throw new AppError('QwenWork team differs from configured personalTeamId',409,'qwenwork_team_mismatch');
      }else throw new AppError('MiniMax needs persisted browser login state; no desktop credentials configured',401,'browser_login_required');
      if(typeof credential.accessToken!=='string'||!credential.accessToken||!credential.principal)throw new AppError('Credential lacks token or stable account identity',401,'invalid_credentials');
      rememberSecret(credential.accessToken);this.cache.set(account.id,{fingerprint,credential});
    }
    const binding=this.ledger.bind(account.id,account.platform,credential.principal);
    if(!binding.ok)throw new AppError('Desktop account changed; explicitly rebind this account before using it',409,'principal_changed');
    if(Number.isFinite(credential.expiresAtMs)&&credential.expiresAtMs<=Date.now())throw new AppError('Desktop token expired; reopen the client to renew login, then recheck',401,'credential_expired');
    return {...credential,principalHash:binding.fingerprint};
  }
  async renewOwnedWorkBuddy(account,file,raw,{renew=false}={}) {
    // Only gateway-owned account snapshots are writable. A native auth file or
    // an arbitrary user-selected JSON remains read-only, even if it has an RT.
    const owned=this.config.dataDir&&resolve(file)===resolve(this.config.dataDir,'accounts',account.id,'workbuddy-session.json');
    const expiry=raw.expiresAtMs??jwtClaims(raw.accessToken??raw.token??'').exp*1000;
    if(!owned||!raw.refreshToken||!renew&&(!Number.isFinite(expiry)||expiry>Date.now()+60000))return raw;
    const stateFile=file+'.refresh-state.json',fingerprint=auth=>hash(JSON.stringify([auth.principal??auth.uid,auth.accessToken??auth.token,auth.refreshToken]));
    const sourceFingerprint=fingerprint(raw),now=Date.now();let previous;
    try{previous=await readJson(stateFile);}catch(e){if(e.code!=='ENOENT')throw new AppError('WorkBuddy 续期状态需核验',409,'wb_refresh_state_invalid');}
    const blocked=state=>state?.sourceFingerprint===sourceFingerprint&&['pending','unconfirmed','rejected','deferred'].includes(state.status)&&(!state.retryAt||now<state.retryAt);
    const failure=state=>Object.assign(new AppError(state.status==='deferred'?'WorkBuddy 续期暂时限流，等待自动重试':state.status==='rejected'?'WorkBuddy 登录凭据已到期，请重新登录':'WorkBuddy 续期结果待核验，等待本机新登录态',state.status==='deferred'?429:state.status==='rejected'?401:503,state.status==='deferred'?'wb_refresh_rate_limited':state.status==='rejected'?'wb_refresh_login_required':'wb_refresh_unconfirmed'),{retryAt:state.retryAt,loginRequired:state.status==='rejected'});
    if(blocked(previous)){if(!renew&&expiry>now+5000)return {...raw,refreshPending:true};throw failure(previous);}
    let lock;try{lock=await open(stateFile+'.lock','wx',0o600);}catch{throw new AppError('WorkBuddy 登录续期正在处理',409,'wb_refresh_pending');}
    try{
      const latest=await readJson(file);
      if(fingerprint(latest)!==sourceFingerprint)return latest; // a fresh capture/login always wins
      let state;try{state=await readJson(stateFile);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(blocked(state)){if(!renew&&expiry>now+5000)return {...latest,refreshPending:true};throw failure(state);}
      await atomicJson(stateFile,{sourceFingerprint,status:'pending',attemptedAt:now});
      let next;
      try{next=await (this.workbuddyRefresh??refreshWorkBuddyCredential)(latest,{now});}
      catch(error){await atomicJson(stateFile,{sourceFingerprint,status:error.loginRequired?'rejected':error.retryable&&error.beforeSubmission?'deferred':'unconfirmed',attemptedAt:now,...(error.retryable&&error.beforeSubmission?{retryAt:error.retryAt}:{})});if(!renew&&expiry>now+5000)return {...latest,refreshPending:true};throw error;}
      const after=await readJson(file);
      if(fingerprint(after)!==sourceFingerprint)return after; // do not overwrite a concurrent new login
      next={...after,...next,managedBy:'ai-credit-gateway',platform:'workbuddy',credentialVersion:1};
      await atomicJson(file,next);await atomicJson(stateFile,{sourceFingerprint:fingerprint(next),status:'complete',completedAt:Date.now()});
      return next;
    }finally{await lock.close();await unlink(stateFile+'.lock').catch(()=>{});}
  }
  async refreshQwen(id) {
    const account=this.account(id);if(account.platform!=='qwenwork')throw new AppError('QwenWork account required',400,'invalid_account');
    const file=await resolveCredentialFile(account,this.config),info=await stat(file);
    const fingerprint=hash(JSON.stringify(account.credentials)+file+info.mtimeMs+info.size);
    const prior=await readJson(join(this.config.dataDir,'accounts',id,'qwenwork-session.json')).catch(()=>null);
    const raw=prior?.sourceFingerprint===fingerprint?prior:await decryptElectronJson(file,join(dirname(file),'Local State'));
    rememberSecret(raw.refreshToken);rememberSecret(raw.token);
    const renewed=await refreshQwenSession(raw);rememberSecret(renewed.token);rememberSecret(renewed.refreshToken);
    await atomicJson(join(this.config.dataDir,'accounts',id,'qwenwork-session.json'),{...renewed,sourceFingerprint:fingerprint});
    this.cache.delete(id);return this.read(account);
  }
  // A Qoder file snapshot carries its own device-token refresh token, so it is
  // renewable without the desktop client. Treat the refresh-token family as
  // exclusive: hold a lock and re-read the snapshot before writing, so a
  // concurrent login (or another renewal) always wins over this write.
  shouldRenewQoder(credential,now=Date.now()){
    if(!credential||typeof credential.refreshToken!=='string'||!credential.refreshToken)return false;
    const expiry=credential.expiresAtMs??Date.parse(credential.expiresAt);
    return Number.isFinite(expiry)&&expiry<=now+QODER_RENEW_LEAD_MS;
  }
  async renewQoder(account,{trigger='schedule'}={}) {
    const id=account.id,{file}=qoderStoragePaths(account,this.config);
    if(!this.config.dataDir||!resolve(file).startsWith(resolve(this.config.dataDir)+String.fromCharCode(92)))throw new AppError('Qoder凭据快照不在插件目录内，拒绝续期回写',409,'qoder_refresh_unsupported');
    let latest;try{latest=await readJson(file);}catch(e){if(e.code==='ENOENT')throw new AppError('Qoder登录快照缺失，请重新登录一次',401,'qoder_refresh_login_required');throw e}
    if(typeof latest.refreshToken!=='string'||!latest.refreshToken)throw new AppError('Qoder登录快照缺少 refreshToken，请重新登录一次',401,'qoder_refresh_login_required');
    const refreshExpiry=latest.refreshTokenExpiresAt?Date.parse(latest.refreshTokenExpiresAt):NaN;
    if(Number.isFinite(refreshExpiry)&&refreshExpiry<=Date.now())throw new AppError('Qoder refreshToken 已过期，请重新登录一次',401,'qoder_refresh_login_required');
    const fingerprint=key=>hash(JSON.stringify([key?.edition,key?.uid,key?.accessToken,key?.refreshToken]));
    const sourceFingerprint=fingerprint(latest);
    let lock;try{lock=await open(file+'.refresh.lock','wx',0o600);}catch{throw new AppError('Qoder登录续期正在处理',409,'qoder_refresh_pending');}
    try{
      const current=await readJson(file);
      if(fingerprint(current)!==sourceFingerprint)return current; // a fresh capture/login always wins
      rememberSecret(current.refreshToken);
      let renewed;
      try{renewed=await (this.qoderRefresh??refreshQoderDeviceToken)(current,{fetchImpl:this.fetch??globalThis.fetch});}
      catch(error){await this.recordRenewal(id,{kind:'renew',ok:false,error:error.code??'qoder_refresh_failed',message:String(error.message??'').slice(0,160),loginRequired:error.loginRequired===true,trigger});throw error;}
      rememberSecret(renewed.accessToken);if(renewed.refreshToken)rememberSecret(renewed.refreshToken);
      const after=await readJson(file);
      if(fingerprint(after)!==sourceFingerprint)return after; // do not overwrite a concurrent new login
      const next=qoderCredentialWriteback(current,renewed);
      await atomicJson(file,next);
      await this.recordRenewal(id,{kind:'renew',ok:true,trigger,expiresAt:renewed.expiresAt??null,refreshExpiresAt:renewed.refreshTokenExpiresAt??null,rotated:renewed.rotated===true,snapshot:'accounts/'+id+'/qoder-credential.json'});
      this.cache.delete(id);
      return this.read(account,{renew:true});
    }finally{await lock.close();await unlink(file+'.refresh.lock').catch(()=>{});}
  }
  async doctor(id){try{const c=await this.resolve(id,{force:true});return {accountId:id,status:'credential_readable',principalHash:c.principalHash.slice(0,12),source:c.source,expiresAt:c.expiresAtMs?new Date(c.expiresAtMs).toISOString():null};}catch(e){return {accountId:id,status:'error',code:e.code??'credential_read_error',message:e.message};}}
  /**
   * Renew a Trae snapshot in place. The client rotates the refresh token on every
   * exchange, so the new one must be persisted before the call returns, and the
   * write is abandoned when the file changed underneath us (a fresh capture wins).
   */
  async renewTraeFile(account,file,text,{syncClient=true}={}) {
    const raw=parseTraeStorageDocument(text);
    if(typeof raw.refreshToken!=='string'||!raw.refreshToken)throw new AppError('Trae 快照缺少 refreshToken，请在 Trae 客户端重新登录一次',401,'trae_refresh_missing');
    const next=await refreshTraeToken({host:raw.host,edition:account.edition??raw.edition??'cn',refreshToken:raw.refreshToken,userId:String(raw.userId??'')});
    const updated={...raw,token:next.accessToken,expiredAt:new Date(next.expiresAtMs).toISOString(),...(next.refreshToken?{refreshToken:next.refreshToken}:{})};
    const draft=rewriteTraeStorageAuth(text,updated);
    const check=parseTraeStorageDocument(draft);
    if(check.token!==updated.token||(next.refreshToken&&check.refreshToken!==next.refreshToken))throw new AppError('Trae 新凭据回写自检失败，已放弃写入',500,'trae_refresh_write_failed');
    const current=await readFile(file,'utf8').catch(()=>null);
    if(current!==text)throw new AppError('Trae 快照在续期期间被重新抓取，本次续期结果已丢弃',409,'trae_refresh_conflict');
    const temp=`${file}.${process.pid}.tmp`;
    await writeFile(temp,draft,{mode:0o600});
    await rename(temp,file);
    this.cache.delete(account.id);
    let synced=null;
    if(syncClient&&account.credentials?.syncClient===true)synced=await this.syncTraeClient(account,updated).catch(()=>null);
    await this.recordRenewal(account.id,{kind:'renew',ok:true,expiresAt:new Date(next.expiresAtMs).toISOString(),rotated:!!next.refreshToken,synced:synced?.synced===true});
    return {accessToken:next.accessToken,refreshToken:next.refreshToken??raw.refreshToken,expiresAtMs:next.expiresAtMs,renewedAt:new Date().toISOString(),synced:synced?.synced===true};
  }
  /**
   * Optional (opt-in per account via credentials.syncClient): write the renewed
   * record into the live client profile that holds the same userId, so opening or
   * closing Trae never resurrects a rotated-out refresh token.
   */
  async syncTraeClient(account,record) {
    const names={cn:['Trae CN','trae-cn'],solo:['TRAE SOLO CN','trae-solo-cn'],sg:['Trae','trae'],'solo-sg':['TRAE SOLO','trae-solo']}[account.edition??'cn']??[];
    const userId=String(record.userId??'');
    for(const name of names) {
      const target=join(appData(),name,'User/globalStorage/storage.json');
      let text;try{text=await readFile(target,'utf8');}catch{continue;}
      let live;try{live=parseTraeStorageDocument(text);}catch{continue;}
      if(String(live.userId??'')!==userId)continue;
      if(live.token===record.token&&live.refreshToken===record.refreshToken)return {synced:true,file:target};
      const draft=rewriteTraeStorageAuth(text,{...live,token:record.token,expiredAt:record.expiredAt,...(record.refreshToken?{refreshToken:record.refreshToken}:{})});
      if(parseTraeStorageDocument(draft).token!==record.token)continue;
      const temp=`${target}.${process.pid}.tmp`;
      try{await writeFile(temp,draft,{mode:0o600});await rename(temp,target);return {synced:true,file:target};}catch{continue;}
    }
    return {synced:false};
  }
  async refreshTrae(id) {
    const account=this.account(id);if(account.platform!=='trae')throw new AppError('Trae account required',400,'invalid_account');
    const file=await resolveCredentialFile(account,this.config);
    const text=await readFile(file,'utf8');
    try{await this.renewTraeFile(account,file,text);}catch(error){await this.recordRenewal(account.id,{kind:'renew',ok:false,error:error.code??'trae_refresh_failed',message:String(error.message??'').slice(0,160)});throw error;}
    return this.read(account,{renew:true});
  }
}

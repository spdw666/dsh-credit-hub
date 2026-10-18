// Native Agent discovery is read-only at the source. Every mutable artifact is
// owned by this plugin; model catalog discovery never submits a chat or claim.
import {readFile,writeFile,mkdir,rename,lstat,realpath,rm,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve,relative,dirname,basename,isAbsolute,sep} from 'node:path';
import {homedir,userInfo} from 'node:os';
import {pathToFileURL} from 'node:url';
import {assertInsideRoot} from '../scripts/import-local.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value,null,2)+'\n');
const problem = code => Object.assign(new Error(code),{code});
const inside = (base,target) => {const rel=relative(resolve(base),resolve(target));return !rel||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);};
const plain = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
const codeOf = error => /^[a-zA-Z0-9_.-]{1,96}$/.test(error?.code??'')?error.code:'discovery_error';
const editionOf = account => account.edition??({workbuddy:'cn',workbuddyai:'global',trae:'cn'}[account.platform]??'');
const regionOf = account => account.region??(account.platform==='minimax'?'cn':'');
const identityKey = (account,principal) => sha(JSON.stringify([account.platform,editionOf(account),regionOf(account),String(principal)]));
const compatible = (a,b) => a.platform===b.platform&&editionOf(a)===editionOf(b)&&regionOf(a)===regionOf(b);

/** Capture this in the parent BEFORE the worker redirects APPDATA/LOCALAPPDATA. */
export function captureHostEnvironment(env=process.env,{home=homedir(),username=userInfo().username}={}) {
  return Object.fromEntries(Object.entries({HOME:home,USERPROFILE:env.USERPROFILE??home,USERNAME:username,APPDATA:env.APPDATA,LOCALAPPDATA:env.LOCALAPPDATA,PUBLIC:env.PUBLIC,BOX_AGENT_CONFIG_DIR:env.BOX_AGENT_CONFIG_DIR,LOOMY_AUTH_SESSION_FILE:env.LOOMY_AUTH_SESSION_FILE,WORKBUDDY_AUTH_FILE:env.WORKBUDDY_AUTH_FILE}).filter(([,v])=>typeof v==='string'&&v));
}

/** Exact known locations only: no recursive home/profile/drive scan, no DSH or
 * gateway configuration as a native credential source. Multiple alternatives
 * represent spellings of ONE application edition, not distinct accounts. */
export function nativeCandidates(host={}) {
  const home=host.HOME??host.USERPROFILE??homedir(),app=host.APPDATA??join(home,'AppData/Roaming'),local=host.LOCALAPPDATA??join(home,'AppData/Local');
  const publicRoot=host.PUBLIC??'C:/Users/Public',username=host.USERNAME??userInfo().username;
  const make=(id,platform,label,paths,extra={})=>({id,platform,label,paths:paths.filter(Boolean),...extra});
  const rows=[
    make('workbuddy-cn','workbuddy','WorkBuddy 国内',[host.WORKBUDDY_AUTH_FILE,join(local,'CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info'),join(home,'.local/share/CodeBuddyExtension/Data/Public/auth/Tencent-Cloud.coding-copilot.info')]),
    make('workbuddy-ai','workbuddyai','WorkBuddy 国际',[join(local,'CodeBuddyExtension/Data/Public/auth/workbuddy-desktop-ai.info')]),
    ...[['cn','TraeCode 国内',['Trae CN','trae-cn']],['solo','TraeWork 国内',['TRAE SOLO CN','trae-solo-cn']],['sg','TraeCode 国际',['Trae','trae']],['solo-sg','TraeWork 国际',['TRAE SOLO','trae-solo']]].map(([edition,label,names])=>make('trae-'+edition,'trae',label,names.map(n=>join(app,n,'User/globalStorage/storage.json')),{edition,layout:'vscode'})),
    ...['QwenWorkCN','QwenWork'].map((name,index)=>make('qwenwork-'+(index?'global':'cn'),'qwenwork',index?'千问办公 国际':'千问办公 国内',[join(app,name,'auth-v2.dat'),join(app,name,'auth.dat')],{profileTag:name})),
    make('zcode-cn','zcode','ZCode 国内',[join(home,'.zcode/v2/credentials.json')]),
    ...[['cn','cn'],['intl','en']].map(([region,folder])=>make('minimax-'+region,'minimax','MiniMax Code '+(region==='cn'?'国内':'国际'),[join(home,'.minimax/auth/prod',folder,'mcode-public/auth.json')],{region,requiresSetup:'minimax_native_lease_required'})),
    ...['cn','global'].map(edition=>make('qoder-'+edition,'qoder','Qoder '+(edition==='cn'?'国内':'国际'),[join(app,edition==='cn'?'com.qodercn.app.stable':'com.qoder.app.stable','auth.v1.dat')],{edition,requiresSetup:'qoder_native_identity_required'})),
    ...['cn','global'].map(edition=>make('codebuddy-'+edition,'codebuddy','CodeBuddy '+(edition==='cn'?'国内':'国际'),[join(app,'CodeBuddy'+(edition==='cn'?' CN':''),'User/globalStorage/state.vscdb')],{edition,layout:'vscode'})),
    make('codearts','codearts','CodeArts Agent',[join(app,'codearts-agent/User/globalStorage/state.vscdb')],{layout:'vscode'}),
    make('cline','cline','Cline',[join(home,'.cline/data/settings/providers.json')]),
    make('lobster','lobster','LobsterAI',[join(app,'LobsterAI/lobsterai.sqlite')]),
    make('loomy','loomy','Loomy',[host.LOOMY_AUTH_SESSION_FILE,join(publicRoot,'Loomy',sha(username).slice(0,12),'userData/auth-session.json'),join(app,'Loomy/auth-session.json')]),
    make('raccoon','raccoon','小浣熊',[join(host.BOX_AGENT_CONFIG_DIR??join(home,'.box-agent/config'),'auth.json')]),
    make('opencode','opencode','OpenCode',[join(home,'.local/share/opencode/opencode.db')],{requiresSetup:'opencode_independent_service_required'}),
  ];
  const installedMarkers={
    'workbuddy-cn':[join(local,'Programs/WorkBuddy'),join(app,'WorkBuddy')],
    'workbuddy-ai':[join(local,'Programs/WorkBuddyAI'),join(app,'WorkBuddyAI')],
    'zcode-cn':[join(home,'.zcode')],
    'minimax-cn':[join(home,'.minimax')],
    'minimax-intl':[join(home,'.minimax')],
    'cline':[join(home,'.cline')],
    'raccoon':[join(home,'.box-agent')],
  };
  return rows.map(row=>({...row,markers:[...row.paths.map(file=>row.layout==='vscode'?dirname(dirname(dirname(file))):dirname(file)),...(installedMarkers[row.id]??[])]}));
}

function normalizeSettings(value={}) {
  return {enabled:value.enabled!==false,intervalSeconds:Number.isFinite(value.intervalSeconds)?Math.max(5,Math.min(3600,value.intervalSeconds)):60,autoEnableRoutes:value.autoEnableRoutes!==false,fetchModels:value.fetchModels!==false,modelRefreshMinutes:Number.isFinite(value.modelRefreshMinutes)?Math.max(5,Math.min(1440,value.modelRefreshMinutes)):30,maxModels:Math.max(1,Math.min(500,Number.isInteger(value.maxModels)?value.maxModels:200)),maxSnapshotBytes:Math.max(1024,Math.min(256*1024*1024,Number.isSafeInteger(value.maxSnapshotBytes)?value.maxSnapshotBytes:64*1024*1024))};
}

async function atomicOwned(root,file,value) {
  await assertInsideRoot(root,file);await mkdir(dirname(file),{recursive:true});
  const temp=await assertInsideRoot(root,file+'.'+randomUUID()+'.tmp');
  try{await writeFile(temp,json(value),{mode:0o600,flag:'wx'});await assertInsideRoot(root,file);await rename(temp,file);}finally{await rm(temp,{force:true});}
}

/** Offline-only credential parser. In particular Cline/CodeArts/Raccoon refresh
 * is disabled and WorkBuddy's encrypted native helper is never launched. */
export async function probeIsolatedCredential(account,{engineRoot,dataDir,now=Date.now(),allowExpired=false}={}) {
  const mod=name=>import(pathToFileURL(join(engineRoot,'src',name)).href);
  // A WB file under data/accounts is refreshable in normal operation. Discovery
  // must not consume its rotating RT, including when deduplicating an expired
  // migrated account. An offline-only ownership base makes that branch false.
  const config={value:{accounts:[account]},dataDir:join(dataDir,'.discovery-offline-no-refresh'),path:file=>resolve(file)};
  let value;
  if(account.platform==='cline')value=await (await mod('provider-cline.mjs')).resolveClineCredential(account,config,{refresh:false,now});
  else if(account.platform==='codearts')value=await (await mod('provider-codearts.mjs')).resolveCodeArtsCredential(account,config,{refresh:false,now});
  else if(account.platform==='raccoon')value=await (await mod('provider-raccoon.mjs')).readRaccoonNativeAuth(account.credentials.file);
  else if(account.platform==='lobster')value=await (await mod('provider-lobster.mjs')).lobsterResolve(account,config);
  else if(account.platform==='loomy')value=await (await mod('provider-loomy.mjs')).readLoomySession({file:account.credentials.file});
  else if(['codebuddy','workbuddyai'].includes(account.platform)) {
    if(account.platform==='workbuddyai'&&typeof plain(await readFile(account.credentials.file))?.auth?.accessToken==='object')throw problem('native_decryption_setup_required');
    value=await (await mod('provider-buddy.mjs')).resolveBuddyCredential(account,config);
  } else if(['qoder','minimax','opencode','antigravity'].includes(account.platform))throw problem('native_runtime_setup_required');
  else {
    const {CredentialManager}=await mod('credentials.mjs');
    const manager=new CredentialManager(config,{bind:()=>({ok:true,fingerprint:'discovery-offline'})});
    try{value=await manager.read(account,{renew:false});} // NOT resolve(): no implicit expired-Qwen refresh.
    catch(error){
      if(allowExpired&&error.code==='credential_expired'&&manager.cache.has(account.id))value=manager.cache.get(account.id).credential;
      else if(account.platform==='trae'&&/Trae (?:has multiple historical device identities|active device is not present)/.test(error.message??''))throw problem('trae_active_device_metadata_required');
      else if(account.platform==='trae'&&/has no stable machine identity/.test(error.message??''))throw problem('trae_machine_identity_missing');
      else throw error;
    }
  }
  if(typeof value?.accessToken!=='string'||!value.accessToken||value.principal===undefined||value.principal===null||!String(value.principal))throw problem('credential_not_logged_in');
  const expiry=value.expiresAtMs??(typeof value.expiresAt==='string'?Date.parse(value.expiresAt):undefined);
  if(!allowExpired&&Number.isFinite(expiry)&&expiry<=now+60000)throw problem('credential_expired_or_expiring');
  return {principal:String(value.principal),expiresAtMs:Number.isFinite(expiry)?expiry:null};
}

export function createDiscovery({service,options,hostEnvironment={},onEvent=()=>{},settings,extraCandidates=[],probeCredential=probeIsolatedCredential,fetchModels,updateConfig,hooks={},now=Date.now,setIntervalImpl=setInterval,clearIntervalImpl=clearInterval}={}) {
  if(!service?.config||!options?.taskRoot)throw problem('discovery_options_required');
  const root=resolve(options.taskRoot),stateRoot=resolve(options.stateRoot??join(root,'runtime/profile')),engineRoot=resolve(options.engineRoot??join(root,'source/engine'));
  const stateFile=join(stateRoot,'discovery-state.json');
  const candidates=[...nativeCandidates(hostEnvironment),...extraCandidates];
  const ids=new Set();for(const candidate of candidates){if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate.id??'')||ids.has(candidate.id)||!Array.isArray(candidate.paths)||!candidate.paths.length||candidate.paths.some(p=>typeof p!=='string'||!isAbsolute(p)))throw problem('discovery_candidate_invalid');ids.add(candidate.id);}
  let timer,flight,mutation=Promise.resolve(),loaded=false,state={schemaVersion:1,bindings:{}},rows=new Map(),running=false,generation=0,controller=new AbortController(),scanCount=0;
  const readSettings=()=>normalizeSettings(typeof settings==='function'?settings():settings??service.config.value.discovery??{});
  const status=()=>({running,scanning:!!flight,checkedAt:state.checkedAt??null,settings:readSettings(),scanCount,candidates:candidates.map(c=>rows.get(c.id)??{id:c.id,platform:c.platform,label:c.label,status:'missing',installed:false,reason:'not_scanned'})});
  async function load(){if(loaded)return;await assertInsideRoot(root,stateFile);try{const stored=plain(await readFile(stateFile));if(stored.schemaVersion!==1||!stored.bindings||typeof stored.bindings!=='object'||Array.isArray(stored.bindings))throw problem('discovery_state_invalid');state=stored;}catch(error){if(error.code!=='ENOENT')throw error;}loaded=true;}
  async function emit(event){try{await onEvent({...event,at:new Date(now()).toISOString()});}catch{/* sink failure never invalidates a committed native snapshot */}}
  async function publishRow(candidate,value){const previous=rows.get(candidate.id),next={id:candidate.id,platform:candidate.platform,label:candidate.label,...value};rows.set(candidate.id,next);if(previous?.status!==next.status||previous?.sourceFingerprint!==next.sourceFingerprint){await emit({type:'agent.'+next.status,candidateId:next.id,platform:next.platform,status:next.status,...(next.reason?{code:next.reason}:{}),...(next.accountId?{accountId:next.accountId}:{})});}return next;}
  async function sourceAllowed(file){
    const out=resolve(file),parts=out.replaceAll('\\','/').toLowerCase().split('/');
    if(parts.some(p=>['.dsh','dsh-data','.ai-credit-gateway','ai-credit-gateway','ai积分网关-多平台签到与dsh反代'].includes(p))||inside(stateRoot,out)||inside(join(root,'source'),out))throw problem('discovery_native_source_rejected');
    for(const blocked of options.nativeSourceDenyRoots??[])if(inside(blocked,out))throw problem('discovery_native_source_rejected');
    let cursor=out;for(;;){try{if((await lstat(cursor)).isSymbolicLink())throw problem('discovery_native_symlink_rejected');}catch(e){if(e.code!=='ENOENT')throw e;}const parent=dirname(cursor);if(parent===cursor)break;cursor=parent;}
    const canonical=await realpath(out).catch(e=>{if(e.code==='ENOENT')return out;throw e;});if(canonical.toLowerCase()!==out.toLowerCase())throw problem('discovery_native_symlink_rejected');return out;
  }
  async function primary(candidate){
    let present=false;
    for(const item of candidate.paths){const file=await sourceAllowed(item);try{const stat=await lstat(file);if(!stat.isFile())throw problem('discovery_native_file_invalid');return {file,present:true};}catch(error){if(error.code!=='ENOENT')throw error;}}
    for(const directory of candidate.markers??candidate.paths.map(dirname)){await sourceAllowed(directory);try{present||=(await lstat(directory)).isDirectory();}catch(error){if(error.code!=='ENOENT')throw error;}}
    return {file:null,present};
  }
  async function stableBundle(candidate,file,limit){
    const profile=candidate.layout==='vscode'?dirname(dirname(dirname(file))):dirname(file),name=relative(profile,file);
    const entries=[{file,name,required:true},...['Local State','machineid','auth.machine-id','telemetry-state.json'].filter(n=>n!==name).map(n=>({file:join(profile,n),name:n}))];
    if(candidate.platform==='trae'){
      // readTraeIdentity resolves historical dc records using the latest native
      // session's active-device metadata. Preserve its existing three-level
      // User/globalStorage layout and copy that log into the same profile root;
      // machineid alone is insufficient when storage retains multiple devices.
      const logs=join(profile,'logs');await sourceAllowed(logs);
      const sessions=(await readdir(logs,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;})).filter(entry=>entry.isDirectory()&&!entry.isSymbolicLink()&&/^\d{8}T\d{6}$/.test(entry.name)).map(entry=>entry.name).sort().reverse();
      if(sessions[0])entries.push({file:join(logs,sessions[0],'main.log'),name:join('logs',sessions[0],'main.log')});
    }
    if(/\.(?:sqlite|sqlite3|db|vscdb)$/i.test(file))entries.push({file:file+'-wal',name:name+'-wal'});
    // Snapshot BOTH DB and WAL twice. A writer/checkpoint changing either aborts
    // this generation; no SQLite connection ever touches the native source.
    for(let attempt=0;attempt<3;attempt++){
      let bytes=0;const bundle=[];
      for(const entry of entries){await sourceAllowed(entry.file);try{const stat=await lstat(entry.file);if(!stat.isFile()||stat.size>limit)throw problem('discovery_snapshot_limit');const data=await readFile(entry.file);bytes+=data.length;if(bytes>limit)throw problem('discovery_snapshot_limit');bundle.push({...entry,data,hash:sha(data)});}catch(error){if(error.code==='ENOENT'&&!entry.required)bundle.push({...entry,data:null,hash:'absent'});else throw error;}}
      await hooks.afterRead?.({candidateId:candidate.id,attempt});
      let same=true;for(const entry of bundle){const data=await readFile(entry.file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if((data?sha(data):'absent')!==entry.hash){same=false;break;}}
      if(same)return {bundle,profile,name,fingerprint:sha(JSON.stringify(bundle.map(e=>[e.name,e.hash]))),primaryHash:bundle[0].hash};
    }
    throw problem('discovery_source_changed');
  }
  async function verifyBundle(bundle){for(const entry of bundle){const data=await readFile(entry.file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if((data?sha(data):'absent')!==entry.hash)throw problem('discovery_source_changed');}}
  async function snapshot(candidate,bundle){
    const dataDir=resolve(service.config.dataDir??service.config.path(service.config.value.dataDir??'./data'));
    await assertInsideRoot(root,dataDir);
    const final=await assertInsideRoot(root,join(dataDir,'discovered',candidate.id,bundle.fingerprint));
    const stage=await assertInsideRoot(root,join(dataDir,'discovered','.stage-'+randomUUID()));
    const account={id:'pending-'+candidate.id,platform:candidate.platform,label:candidate.label,enabled:true,inferenceEnabled:true,...(candidate.edition?{edition:candidate.edition}:{}),...(candidate.region?{region:candidate.region}:{}),credentials:{kind:candidate.credentialKind??'desktop',file:join(final,bundle.name),profileDir:final,localState:join(final,'Local State'),autoLaunch:false,cacheFile:join(dataDir,'private-cache','discovery-'+candidate.id+'.json')},tasks:[]};
    // The gateway's owned WorkBuddy format is normalized without launching the
    // native decryptor; RTs remain local and preserve later explicit renewal.
    let workbuddy;
    if(candidate.platform==='workbuddy'){
      const raw=plain(bundle.bundle[0].data),accessToken=raw.auth?.accessToken??raw.accessToken??raw.token;
      if(typeof accessToken==='object')throw problem('native_decryption_setup_required');
      const principal=raw.account?.uid??raw.uid??raw.principal??raw.userId;
      if(typeof accessToken!=='string'||!accessToken||principal===undefined||!String(principal))throw problem('credential_not_logged_in');
      workbuddy={accessToken,principal:String(principal),uid:String(principal),refreshToken:typeof(raw.auth?.refreshToken??raw.refreshToken)==='string'?(raw.auth?.refreshToken??raw.refreshToken):'',domain:raw.auth?.domain??raw.domain??'www.workbuddy.cn',edition:raw.edition??candidate.edition??'cn',expiresAtMs:raw.auth?.expiresAt??raw.expiresAtMs,...(raw.account?{profileRaw:raw.account}:{})};
      account.credentials.kind='file';account.credentials.file=join(final,'owned-workbuddy-session.json');
    }
    try{
      await mkdir(stage,{recursive:true});for(const entry of bundle.bundle){if(entry.data===null)continue;const out=await assertInsideRoot(root,join(stage,entry.name));await mkdir(dirname(out),{recursive:true});await writeFile(out,entry.data,{mode:0o600,flag:'wx'});}
      if(workbuddy)await writeFile(join(stage,'owned-workbuddy-session.json'),json(workbuddy),{mode:0o600});
      await hooks.beforeSnapshotCommit?.({candidateId:candidate.id});await verifyBundle(bundle.bundle);
      await mkdir(dirname(final),{recursive:true});await assertInsideRoot(root,final);
      try{await rename(stage,final);}catch(error){if(!['EEXIST','ENOTEMPTY','EPERM'].includes(error.code))throw error;const stat=await lstat(final);if(!stat.isDirectory()||stat.isSymbolicLink())throw problem('discovery_snapshot_conflict');
        for(const entry of bundle.bundle){if(entry.data===null)continue;if(sha(await readFile(join(final,entry.name)))!==entry.hash)throw problem('discovery_snapshot_conflict');}
        if(workbuddy&&sha(await readFile(join(final,'owned-workbuddy-session.json')))!==sha(json(workbuddy)))throw problem('discovery_snapshot_conflict');
      }
      return {account,dataDir};
    }finally{await rm(stage,{recursive:true,force:true});}
  }
  async function commit(mutator){
    const action=async()=>{
      if(updateConfig)return updateConfig(mutator);
      // Integrators should share updateConfig's queue with all management writes.
      // This fallback rereads the latest disk document and refuses a detected CAS
      // change; it never restores an earlier stored discovery config snapshot.
      if(service.config.load)await service.config.load();
      const before=service.config.file?sha(await readFile(service.config.file)):null;
      const value=structuredClone(service.config.value),result=await mutator(value);
      if(result===false)return false;
      if(before&&sha(await readFile(service.config.file))!==before)throw problem('discovery_config_changed');
      await service.config.save(value);return result;
    };
    const pending=mutation.then(action,action);mutation=pending.catch(()=>{});return pending;
  }
  async function existingAccount(account,principal,bundle,cache){
    const key=identityKey(account,principal),binding=state.bindings[key];
    if(binding){const found=service.config.value.accounts.find(a=>a.id===binding.accountId&&compatible(a,account));if(found)return found;}
    for(const existing of service.config.value.accounts.filter(a=>compatible(a,account))){
      const file=existing.credentials?.file;if(typeof file!=='string'||file==='auto')continue;
      let resolved;try{resolved=service.config.path?service.config.path(file):resolve(file);await assertInsideRoot(root,resolved);}catch{continue;}
      let bytes;try{bytes=await readFile(resolved);}catch{continue;}
      if(sha(bytes)===bundle.primaryHash)return existing;
      const cacheKey=existing.id+':'+sha(bytes);
      try{let c=cache.get(cacheKey);if(!c){c=await probeCredential(existing,{engineRoot,dataDir:service.config.dataDir,now:now(),offline:true,allowExpired:true});cache.set(cacheKey,c);}if(identityKey(existing,c.principal)===key)return existing;}catch{/* an unready old account is not silently rebound to a different principal */}
    }
    return null;
  }
  async function connectCandidate(candidate,{connect,epoch,settings:cfg,cache}){
    const found=await primary(candidate);
    if(!found.file)return publishRow(candidate,{status:found.present?'not_logged_in':'missing',installed:found.present,reason:found.present?'native_login_file_missing':'agent_not_detected'});
    if(!connect)return publishRow(candidate,{status:'installed',installed:true,reason:'connection_not_requested'});
    if(candidate.requiresSetup)return publishRow(candidate,{status:'needs_setup',installed:true,reason:candidate.requiresSetup});
    const bundle=await stableBundle(candidate,found.file,cfg.maxSnapshotBytes);
    const prior=Object.entries(state.bindings).find(([,b])=>b.candidateId===candidate.id&&b.sourceFingerprint===bundle.fingerprint&&service.config.value.accounts.some(a=>a.id===b.accountId));
    if(prior){const account=service.config.value.accounts.find(a=>a.id===prior[1].accountId),expiry=prior[1].expiresAtMs;
      if(Number.isFinite(expiry)&&expiry<=now()+60000)return publishRow(candidate,{status:'needs_setup',installed:true,accountId:account.id,reason:'credential_expired_or_expiring',sourceFingerprint:bundle.fingerprint});
      await refreshRoutes(candidate,account,prior[1],cfg,epoch);
      return publishRow(candidate,{status:'imported',installed:true,accountId:account.id,upstreamId:prior[1].upstreamId,routeCount:prior[1].routeCount??0,sourceFingerprint:bundle.fingerprint,catalogStatus:prior[1].catalogStatus??'not_requested',...(prior[1].catalogReason?{catalogReason:prior[1].catalogReason}:{})});
    }
    const isolated=await snapshot(candidate,bundle);
    const credential=await probeCredential(isolated.account,{engineRoot,dataDir:isolated.dataDir,now:now(),offline:true});
    const expiry=credential.expiresAtMs??null;if(!credential.principal)throw problem('credential_not_logged_in');
    if(Number.isFinite(expiry)&&expiry<=now()+60000)throw problem('credential_expired_or_expiring');
    const existing=await existingAccount(isolated.account,credential.principal,bundle,cache),key=identityKey(isolated.account,credential.principal);
    const accountId=existing?.id??'discovered-'+candidate.platform+'-'+key.slice(0,20),upstreamId=service.config.value.upstreams.find(u=>u.accountId===accountId&&u.kind===candidate.platform)?.id??'discovered-up-'+key.slice(0,20);
    if(epoch!==generation)throw problem('discovery_stopped');await verifyBundle(bundle.bundle);
    await commit(value=>{
      if(epoch!==generation)throw problem('discovery_stopped');
      const current=value.accounts.find(a=>a.id===accountId);
      if(current){current.credentials={...current.credentials,...isolated.account.credentials,cacheFile:current.credentials?.cacheFile??isolated.account.credentials.cacheFile};}
      else value.accounts.push({...isolated.account,id:accountId});
      if(!value.upstreams.some(u=>u.id===upstreamId))value.upstreams.push({id:upstreamId,kind:candidate.platform,accountId,enabled:true,discovered:true});
      return true;
    });
    service.credentials?.cache?.delete(accountId);service.platforms?.catalogs?.delete(upstreamId);
    const binding={candidateId:candidate.id,accountId,upstreamId,sourceFingerprint:bundle.fingerprint,expiresAtMs:expiry,importedAt:new Date(now()).toISOString(),catalogStatus:'not_requested'};
    state.bindings[key]=binding;
    await refreshRoutes(candidate,service.config.value.accounts.find(a=>a.id===accountId),binding,cfg,epoch);
    await publishRow(candidate,{status:existing?'changed':'imported',installed:true,accountId,upstreamId,routeCount:binding.routeCount??0,sourceFingerprint:bundle.fingerprint,catalogStatus:binding.catalogStatus,...(binding.catalogReason?{catalogReason:binding.catalogReason}:{})});
    return rows.get(candidate.id);
  }
  async function refreshRoutes(candidate,account,binding,cfg,epoch){
    if(!cfg.fetchModels||account?.enabled===false||account?.inferenceEnabled===false||service.config.value.upstreams.find(u=>u.id===binding.upstreamId)?.enabled===false){binding.catalogStatus='disabled';return;}
    const last=binding.catalogCheckedAt?Date.parse(binding.catalogCheckedAt):0;
    if(last&&now()-last<cfg.modelRefreshMinutes*60000)return;
    binding.catalogCheckedAt=new Date(now()).toISOString();
    try{
      const signal=controller.signal;
      let abort;
      const cancelled=new Promise((_,reject)=>{abort=()=>reject(problem('discovery_stopped'));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});
      let models;
      try{models=await Promise.race([(fetchModels??((id,args)=>service.platforms.models(id,args)))(binding.upstreamId,{refresh:true,signal}),cancelled]);}finally{signal.removeEventListener('abort',abort);}
      if(epoch!==generation)throw problem('discovery_stopped');
      if(!Array.isArray(models))throw problem('discovery_catalog_invalid');
      const seen=new Set(),usable=models.filter(model=>{if(typeof model?.id!=='string'||!model.id||model.id.length>512||seen.has(model.id)||model.callable===false||!Number.isSafeInteger(model.contextWindow)||model.contextWindow<=0||!Number.isSafeInteger(model.maxTokens)||model.maxTokens<=0)return false;seen.add(model.id);return true;}).slice(0,cfg.maxModels);
      if(!usable.length){binding.catalogStatus='needs_setup';binding.catalogReason='catalog_no_verified_callable_models';return;}
      await commit(value=>{if(epoch!==generation)throw problem('discovery_stopped');let added=0;for(const model of usable){if(value.routes.some(r=>(r.targets??[]).some(t=>t.upstreamId===binding.upstreamId&&t.model===model.id)))continue;const id='discovered-route-'+sha(binding.upstreamId+'\0'+model.id).slice(0,24);if(value.routes.some(r=>r.id===id))continue;value.routes.push({id,name:candidate.label+' · '+String(model.name??model.id).slice(0,160),enabled:cfg.autoEnableRoutes,targets:[{upstreamId:binding.upstreamId,model:model.id}],discovered:true});added++;}return added>0;});
      binding.routeCount=service.config.value.routes.filter(r=>(r.targets??[]).some(t=>t.upstreamId===binding.upstreamId)).length;binding.catalogStatus='ready';delete binding.catalogReason;
    }catch(error){if(error.code==='discovery_stopped')throw error;binding.catalogStatus='error';binding.catalogReason=codeOf(error);await emit({type:'agent.catalog_failed',candidateId:candidate.id,platform:candidate.platform,accountId:account.id,code:codeOf(error)});}
  }
  async function doScan({connect=true,only}={}){
    await load();const cfg=readSettings(),epoch=generation,cache=new Map();scanCount++;
    for(const candidate of candidates){if(only&&candidate.id!==only)continue;if(epoch!==generation)break;
      try{await connectCandidate(candidate,{connect,epoch,settings:cfg,cache});}
      catch(error){if(error.code==='discovery_stopped')break;const code=codeOf(error),notLoggedIn=/missing|not_logged|login_required|credential_unavailable/.test(code),setup=/credential|decrypt|identity|storage|personal_scope|region|session|source_changed|snapshot_conflict|metadata_required/.test(code)||error instanceof SyntaxError;
        await publishRow(candidate,{status:notLoggedIn?'not_logged_in':setup?'needs_setup':'error',installed:code!=='discovery_native_source_rejected',reason:code});}
    }
    state.checkedAt=new Date(now()).toISOString();await atomicOwned(root,stateFile,state);return status();
  }
  function scan(input={}){
    if(flight)return flight;const pending=doScan(input);flight=pending;
    return pending.finally(()=>{if(flight===pending)flight=undefined;});
  }
  function start(){
    if(running||!readSettings().enabled)return status();running=true;controller=new AbortController();
    const run=()=>void scan().catch(async error=>{await emit({type:'agent.scan_failed',code:codeOf(error)});});run();
    timer=setIntervalImpl(run,readSettings().intervalSeconds*1000);timer?.unref?.();return status();
  }
  async function stop(){running=false;generation++;controller.abort(problem('discovery_stopped'));if(timer!==undefined)clearIntervalImpl(timer);timer=undefined;await flight?.catch(()=>{});await mutation.catch(()=>{});return status();}
  async function importCandidate(id){if(!candidates.some(c=>c.id===id))throw problem('discovery_candidate_not_found');if(flight)await flight;await scan({connect:true,only:id});return rows.get(id);}
  return {scan,status,start,stop,importCandidate,credentialMetadata:()=>Object.values(state.bindings).filter(b=>b.accountId&&Number.isFinite(b.expiresAtMs)).map(b=>({accountId:b.accountId,expiresAtMs:b.expiresAtMs,observedAtMs:Date.parse(b.importedAt)||0}))};
}

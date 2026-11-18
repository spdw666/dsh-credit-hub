// Native Agent discovery is read-only at the source. Every mutable artifact is
// owned by this plugin; model catalog discovery never submits a chat or claim.
import {readFile,writeFile,mkdir,rename,lstat,realpath,rm,readdir,access} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve,relative,dirname,basename,isAbsolute,sep} from 'node:path';
import {homedir,userInfo} from 'node:os';
import {pathToFileURL} from 'node:url';
import {assertInsideRoot,raccoonAuthCandidates} from '../scripts/import-local.mjs';
import {isRemovedAccount,removeOwnedCredentialAssets} from './account-removal.mjs';

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

/** Only registered entitlement actions become automatic tasks. A new native
 * login must not silently lose daily check-in simply because it was installed
 * after this plugin. Existing accounts are never passed through this default:
 * their task array (including explicit disables/empty arrays) is user-owned. */
export function defaultDiscoveryTasks(account={}) {
  let id;
  if(['workbuddy','workbuddyai','codebuddy','qoder','minimax','codearts','lobster'].includes(account.platform))id='daily-checkin';
  else if(['qwenwork','loomy','raccoon'].includes(account.platform))id='daily-quota';
  else if(account.platform==='trae'&&['cn','solo'].includes(editionOf(account)))id='daily-checkin';
  else if(account.platform==='zcode')id='free-plan-claim';
  return id?[{id,enabled:true}]:[];
}

/** Capture this in the parent BEFORE the worker redirects APPDATA/LOCALAPPDATA. */
export function captureHostEnvironment(env=process.env,{home=homedir(),username=userInfo().username}={}) {
  return Object.fromEntries(Object.entries({HOME:home,USERPROFILE:env.USERPROFILE??home,USERNAME:username,APPDATA:env.APPDATA,LOCALAPPDATA:env.LOCALAPPDATA,PUBLIC:env.PUBLIC,BOX_AGENT_CONFIG_DIR:env.BOX_AGENT_CONFIG_DIR,LOOMY_AUTH_SESSION_FILE:env.LOOMY_AUTH_SESSION_FILE,WORKBUDDY_AUTH_FILE:env.WORKBUDDY_AUTH_FILE}).filter(([,v])=>typeof v==='string'&&v));
}

/** An extra, independently addressable raccoon credential source for the enterprise build:
 *  `%APPDATA%\raccoon-enterprise-<id>` plus `~/.box-agent-<id>/config/auth.json`. The id cannot be
 *  derived from the environment, so callers pass the ids they know (nativeCandidates option or the
 *  createDiscovery `extraCandidates` entry point); nothing is scanned. `edition` keeps an enterprise
 *  login separate from the personal edition even when both belong to the same principal.
 *  This only guarantees that two *sources* never overwrite each other. It does not make two desktop
 *  seats usable at once: the service revokes the previous desktop session when a second account logs
 *  in on the same machine (external evidence: magpie-community/opencode-raccoon-auth README and
 *  PR #166 report 401 code 200003 for the evicted seat; not reproduced locally). */
export function raccoonEnterpriseCandidate(host={}, {enterpriseId}={}) {
  const home=host.HOME??host.USERPROFILE??homedir(),app=host.APPDATA??join(home,'AppData/Roaming');
  const slug=typeof enterpriseId==='string'?enterpriseId.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40):'';
  const key=slug||'default';
  return {id:'raccoon-enterprise-'+key,platform:'raccoon',label:'小浣熊 企业版'+(slug?' '+slug:''),edition:'enterprise',
    paths:[join(home,'.box-agent-'+key,'config','auth.json')],
    markers:[join(home,'.box-agent-'+key),join(app,'raccoon-enterprise-'+key)]};
}

/** Exact known locations only: no recursive home/profile/drive scan, no DSH or
 * gateway configuration as a native credential source. Multiple alternatives
 * represent spellings of ONE application edition, not distinct accounts.
 *  `raccoonDesktopReuse=false` (0.4.0 default) drops the personal Raccoon desktop
 *  candidate — `.office-raccoon` / `.box-agent` — so a fresh scan never adopts a
 *  client login again; web authorization is the supported path. The enumerator
 *  still returns the full list when the caller asks for it (manual import,
 *  diagnostics, tests), because only discovery owns the policy decision. */
export function nativeCandidates(host={}, {enterpriseIds=[], raccoonDesktopReuse=true}={}) {
  const home=host.HOME??host.USERPROFILE??homedir(),app=host.APPDATA??join(home,'AppData/Roaming'),local=host.LOCALAPPDATA??join(home,'AppData/Local');
  const publicRoot=host.PUBLIC??'C:/Users/Public',username=host.USERNAME??userInfo().username;
  const make=(id,platform,label,paths,extra={})=>({id,platform,label,paths:paths.filter(Boolean),...extra});
  const allRows=[
    make('workbuddy-cn','workbuddy','WorkBuddy 国内',[host.WORKBUDDY_AUTH_FILE,join(local,'CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info'),join(home,'.local/share/CodeBuddyExtension/Data/Public/auth/Tencent-Cloud.coding-copilot.info')]),
    make('workbuddy-ai','workbuddyai','WorkBuddy 国际',[join(local,'CodeBuddyExtension/Data/Public/auth/workbuddy-desktop-ai.info')]),
    ...[['cn','TraeCode 国内',['Trae CN','trae-cn']],['solo','TraeWork 国内',['TRAE SOLO CN','trae-solo-cn']],['sg','TraeCode 国际',['Trae','trae']],['solo-sg','TraeWork 国际',['TRAE SOLO','trae-solo']]].map(([edition,label,names])=>make('trae-'+edition,'trae',label,names.map(n=>join(app,n,'User/globalStorage/storage.json')),{edition,layout:'vscode'})),
    ...['QwenWorkCN','QwenWork'].map((name,index)=>make('qwenwork-'+(index?'global':'cn'),'qwenwork',index?'千问办公 国际':'千问办公 国内',[join(app,name,'auth-v2.dat'),join(app,name,'auth.dat')],{profileTag:name})),
    make('zcode-cn','zcode','ZCode 国内',[join(home,'.zcode/v2/credentials.json')]),
    ...[['cn','cn'],['intl','en']].map(([region,folder])=>make('minimax-'+region,'minimax','MiniMax Code '+(region==='cn'?'国内':'国际'),[join(home,'.minimax/auth/prod',folder,'mcode-public/auth.json')],{region,requiresSetup:'minimax_native_lease_required'})),
    ...['cn','global'].map(edition=>make('qoder-'+edition,'qoder','Qoder '+(edition==='cn'?'国内':'国际'),[join(app,edition==='cn'?'com.qodercn.app.stable':'com.qoder.app.stable','auth.v1.dat')],{edition,requiresSetup:'qoder_native_identity_required'})),
    ...['cn','global'].map(edition=>make('codebuddy-'+edition,'codebuddy','CodeBuddy '+(edition==='cn'?'国内':'国际'),[join(app,'CodeBuddy'+(edition==='cn'?' CN':''),'User/globalStorage/state.vscdb')],{edition,layout:'vscode'})),
    make('codearts','codearts','CodeArts Agent',[join(app,'codearts-agent/User/globalStorage/state.vscdb')],{layout:'vscode'}),
    // CodeArts 0.2.x DESKTOP (Electron) keeps the identical IAM session somewhere else:
    // <userData>/secretStorage/sha256('authSession:<region>').enc, wrapped by Electron
    // safeStorage (DPAPI + AES-256-GCM, base64 on disk) next to <userData>/Local State.
    // The file name is derived from the auth region, so every region of the desktop
    // product is listed; primary() picks the one this installation actually wrote.
    make('codearts-desktop','codearts','CodeArts 桌面版',['cn-north-4','cn-east-3','cn-south-1','cn-north-1','cn-east-2','ap-southeast-1','ap-southeast-3'].map(region=>join(app,'codearts/secretStorage/'+sha('authSession:'+region)+'.enc')),{layout:'electron'}),
    make('cline','cline','Cline',[join(home,'.cline/data/settings/providers.json')]),
    make('lobster','lobster','LobsterAI',[join(app,'LobsterAI/lobsterai.sqlite')]),
    make('loomy','loomy','Loomy',[host.LOOMY_AUTH_SESSION_FILE,join(publicRoot,'Loomy',sha(username).slice(0,12),'userData/auth-session.json'),join(app,'Loomy/auth-session.json')]),
    // Client 1.2.x writes %USERPROFILE%\.office-raccoon\agent\config\auth.json; the legacy
    // ~/.box-agent/config/auth.json stays as a fallback and BOX_AGENT_CONFIG_DIR keeps priority.
    // Only homedir()-derived and validated absolute paths may enter `paths`: a malformed env value
    // must never reach createDiscovery's constructor check (discovery_candidate_invalid).
    make('raccoon','raccoon','小浣熊',raccoonAuthCandidates({env:host,home})),
    ...enterpriseIds.map(enterpriseId=>raccoonEnterpriseCandidate(host,{enterpriseId})),
    make('opencode','opencode','OpenCode',[join(home,'.local/share/opencode/opencode.db')],{requiresSetup:'opencode_independent_service_required'}),
  ];
  const installedMarkers={
    'workbuddy-cn':[join(local,'Programs/WorkBuddy'),join(app,'WorkBuddy')],
    'workbuddy-ai':[join(local,'Programs/WorkBuddyAI'),join(app,'WorkBuddyAI')],
    'zcode-cn':[join(home,'.zcode')],
    'minimax-cn':[join(home,'.minimax')],
    'minimax-intl':[join(home,'.minimax')],
    'cline':[join(home,'.cline')],
    'raccoon':[join(home,'.office-raccoon'),join(home,'.box-agent')],
  };
  // N-B1: dropping the row also drops its `.office-raccoon` / `.box-agent` install
  // markers, so a machine that still has the desktop client installed reports no
  // candidate at all instead of a `not_logged_in` row nobody can act on.
  const rows=raccoonDesktopReuse?allRows:allRows.filter(row=>row.id!=='raccoon');
  return rows.map(row=>({...row,markers:[...new Set([...row.paths.map(file=>row.layout==='vscode'?dirname(dirname(dirname(file))):row.layout==='electron'?dirname(dirname(file)):dirname(file)),...(installedMarkers[row.id]??[]),...(row.markers??[])])]}));
}

function normalizeSettings(value={}) {
  // `raccoonDesktopReuse` is a strict opt-in: anything but an explicit `true` keeps
  // the desktop client unread, so a hand-edited or legacy settings document cannot
  // silently re-enable the retired path.
  return {enabled:value.enabled!==false,intervalSeconds:Number.isFinite(value.intervalSeconds)?Math.max(5,Math.min(3600,value.intervalSeconds)):60,autoEnableRoutes:value.autoEnableRoutes!==false,fetchModels:value.fetchModels!==false,modelRefreshMinutes:Number.isFinite(value.modelRefreshMinutes)?Math.max(5,Math.min(1440,value.modelRefreshMinutes)):30,maxModels:Math.max(1,Math.min(500,Number.isInteger(value.maxModels)?value.maxModels:200)),maxSnapshotBytes:Math.max(1024,Math.min(256*1024*1024,Number.isSafeInteger(value.maxSnapshotBytes)?value.maxSnapshotBytes:64*1024*1024)),raccoonDesktopReuse:value.raccoonDesktopReuse===true};
}

async function atomicOwned(root,file,value) {
  await assertInsideRoot(root,file);await mkdir(dirname(file),{recursive:true});
  const temp=await assertInsideRoot(root,file+'.'+randomUUID()+'.tmp');
  try{await writeFile(temp,json(value),{mode:0o600,flag:'wx'});await assertInsideRoot(root,file);await rename(temp,file);}finally{await rm(temp,{force:true});}
}

/** Offline-only credential parser. In particular Cline/CodeArts/Raccoon refresh
 * is disabled and no native helper is launched here: WorkBuddy login states are
 * opened once, in snapshot(), and discovery only ever reads the owned copy. */
export async function probeIsolatedCredential(account,{engineRoot,dataDir,now=Date.now(),allowExpired=false}={}) {
  // N3(d): a web-authorized account has no native auth file to adopt. Reading it
  // through the desktop reader would either fail confusingly or, worse, hand back
  // the desktop account's token. Report it as skipped instead.
  if(account?.credentials?.authKind==='oauth_iam')throw Object.assign(new Error('raccoon_oauth_excluded'),{code:'raccoon_oauth_excluded',skipped:true,status:409});
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

export function createDiscovery({service,options,hostEnvironment={},onEvent=()=>{},settings,extraCandidates=[],enterpriseIds=[],probeCredential=probeIsolatedCredential,fetchModels,updateConfig,hooks={},now=Date.now,setIntervalImpl=setInterval,clearIntervalImpl=clearInterval,decryptWorkBuddy:injectedDecryptWorkBuddy}={}) {
  if(!service?.config||!options?.taskRoot)throw problem('discovery_options_required');
  const root=resolve(options.taskRoot),stateRoot=resolve(options.stateRoot??join(root,'runtime/profile')),engineRoot=resolve(options.engineRoot??join(root,'source/engine'));
  const stateFile=join(stateRoot,'discovery-state.json');
  // W2: the enterprise candidate builder used to be unreachable — nterpriseIds was
  // never supplied by any caller. It is now a real createDiscovery parameter, so an
  // embedder that knows the ids gets %APPDATA%\\raccoon-enterprise-<id> scanned while
  // the default (no ids) keeps scanning nothing extra.
  // The full candidate list is built once so a malformed entry fails at construction,
  // but which rows a scan actually visits is decided per scan from the live settings:
  // `discovery.raccoonDesktopReuse` is a runtime toggle and must apply to the next
  // scan without restarting the worker. The desktop row is the only one gated.
  const allCandidates=[...nativeCandidates(hostEnvironment,{enterpriseIds,raccoonDesktopReuse:true}),...extraCandidates];
  const ids=new Set();for(const candidate of allCandidates){if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate.id??'')||ids.has(candidate.id)||!Array.isArray(candidate.paths)||!candidate.paths.length||candidate.paths.some(p=>typeof p!=='string'||!isAbsolute(p)))throw problem('discovery_candidate_invalid');ids.add(candidate.id);}
  // 0.4.0 — requirement B: the desktop client login is no longer read by default.
  // Web authorization (`/hub/raccoon/oauth`) is the supported path; the desktop file
  // is only inspected when an operator opts back in. Existing desktop accounts in the
  // config are untouched either way: discovery simply stops proposing new captures.
  const candidatesFor=cfg=>cfg.raccoonDesktopReuse===true?allCandidates:allCandidates.filter(candidate=>candidate.id!=='raccoon');
  // WorkBuddy seals its desktop login state with a key only its own Electron
  // runtime can unwrap. Discovery opens that seal exactly once per snapshot, in
  // the parent-owned data directory, so the runtime never needs the native file
  // (the worker's LOCALAPPDATA points at an owned sandbox) and never relaunches
  // the client for a plain read. Executable lookup must use the captured host
  // environment, not process.env, for the same reason.
  const executableCandidates=()=>{
    const hints=[options.workBuddyExecutable,hostEnvironment.WORKBUDDY_APP_EXECUTABLE,hostEnvironment.WORKBUDDY_EXE];
    for(const dir of [hostEnvironment.LOCALAPPDATA,process.env.LOCALAPPDATA])if(typeof dir==='string'&&dir)hints.push(join(dir,'Programs','WorkBuddy','WorkBuddy.exe'));
    return hints.filter(hint=>typeof hint==='string'&&hint&&hint!=='auto');
  };
  const decryptWorkBuddy=injectedDecryptWorkBuddy??(async sealed=>{
    const {runNativeHelper}=await import(pathToFileURL(join(engineRoot,'src','credentials.mjs')).href);
    const env=Object.fromEntries(Object.entries(hostEnvironment).filter(([key,v])=>typeof v==='string'&&/^(?:LOCALAPPDATA|APPDATA|HOME|USERPROFILE|USERNAME|PUBLIC)$/.test(key)));
    for(const executable of executableCandidates()){try{await access(executable);}catch{continue;}return runNativeHelper(executable,sealed,{env});}
    throw problem('native_decryption_setup_required');
  });
  const openWorkBuddySeal=async sealed=>{
    try{const value=await decryptWorkBuddy(sealed);if(typeof value!=='string'||!value)throw problem('credential_decrypt_failed');return value;}
    catch(error){if(error?.code==='native_decryption_setup_required')throw error;throw Object.assign(problem('native_decryption_setup_required'),{message:'WorkBuddy sealed login state: '+codeOf(error),cause:error});}
  };
  let timer,flight,mutation=Promise.resolve(),loaded=false,state={schemaVersion:1,bindings:{}},rows=new Map(),running=false,generation=0,controller=new AbortController(),scanCount=0;
  const readSettings=()=>normalizeSettings(typeof settings==='function'?settings():settings??service.config.value.discovery??{});
  const status=()=>({running,scanning:!!flight,checkedAt:state.checkedAt??null,settings:readSettings(),scanCount,candidates:candidatesFor(readSettings()).map(c=>rows.get(c.id)??{id:c.id,platform:c.platform,label:c.label,status:'missing',installed:false,reason:'not_scanned'}),oauthRoutes:oauthRouteStatus()});
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
    const profile=candidate.layout==='vscode'?dirname(dirname(dirname(file))):candidate.layout==='electron'?dirname(dirname(file)):dirname(file),name=relative(profile,file);
    const entries=[{file,name,required:true},...['Local State','machineid','auth.machine-id','telemetry-state.json'].filter(n=>n!==name).map(n=>({file:join(profile,n),name:n}))];
    if(candidate.layout==='electron'){
      // Desktop secret names are opaque hashes of `authSession:<region>`; snapshot every
      // sibling secret so the adapter can still locate the live session after a region
      // change (the adapter only ever trusts the file it was handed or a sibling in the
      // same owned copy, never the native directory itself).
      const dir=dirname(file);
      for(const entry of await readdir(dir,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;}))
        if(entry.isFile()&&entry.name.endsWith('.enc')&&entry.name!==basename(file))entries.push({file:join(dir,entry.name),name:join(dirname(name),entry.name)});
    }
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
    const account={id:'pending-'+candidate.id,platform:candidate.platform,label:candidate.label,enabled:true,inferenceEnabled:true,...(candidate.edition?{edition:candidate.edition}:{}),...(candidate.region?{region:candidate.region}:{}),credentials:{kind:candidate.credentialKind??'desktop',file:join(final,bundle.name),profileDir:final,localState:join(final,'Local State'),autoLaunch:false,cacheFile:join(dataDir,'private-cache','discovery-'+candidate.id+'.json')},tasks:defaultDiscoveryTasks(candidate)};
    // The gateway's owned WorkBuddy format stores readable tokens only. A sealed
    // native value is opened through the client's own runtime once, here; the
    // refresh token stays local and later explicit renewal still owns it.
    let workbuddy;
    if(candidate.platform==='workbuddy'){
      const raw=plain(bundle.bundle[0].data);let accessToken=raw.auth?.accessToken??raw.accessToken??raw.token;
      if(accessToken&&typeof accessToken==='object')accessToken=await openWorkBuddySeal(accessToken);
      let refreshToken=raw.auth?.refreshToken??raw.refreshToken;
      if(typeof refreshToken!=='string')refreshToken=refreshToken&&typeof refreshToken==='object'?(await openWorkBuddySeal(refreshToken).catch(()=>'')):'';
      const principal=raw.account?.uid??raw.uid??raw.principal??raw.userId;
      if(typeof accessToken!=='string'||!accessToken||principal===undefined||!String(principal))throw problem('credential_not_logged_in');
      workbuddy={accessToken,principal:String(principal),uid:String(principal),refreshToken,domain:raw.auth?.domain??raw.domain??'www.workbuddy.cn',edition:raw.edition??candidate.edition??'cn',expiresAtMs:raw.auth?.expiresAt??raw.expiresAtMs,...(raw.account?{profileRaw:raw.account}:{})};
      account.credentials.kind='file';account.credentials.file=join(final,'owned-workbuddy-session.json');
    }
    try{
      await mkdir(stage,{recursive:true});for(const entry of bundle.bundle){if(entry.data===null)continue;const out=await assertInsideRoot(root,join(stage,entry.name));await mkdir(dirname(out),{recursive:true});await writeFile(out,entry.data,{mode:0o600,flag:'wx'});}
      if(workbuddy)await writeFile(join(stage,'owned-workbuddy-session.json'),json(workbuddy),{mode:0o600});
      await hooks.beforeSnapshotCommit?.({candidateId:candidate.id});await verifyBundle(bundle.bundle);
      await mkdir(dirname(final),{recursive:true});await assertInsideRoot(root,final);
      try{await rename(stage,final);}catch(error){if(!['EEXIST','ENOTEMPTY','EPERM'].includes(error.code))throw error;const stat=await lstat(final);if(!stat.isDirectory()||stat.isSymbolicLink())throw problem('discovery_snapshot_conflict');
        for(const entry of bundle.bundle){if(entry.data===null)continue;if(sha(await readFile(join(final,entry.name)))!==entry.hash)throw problem('discovery_snapshot_conflict');}
        if(workbuddy&&sha(await readFile(join(final,'owned-workbuddy-session.json')))!==sha(json(workbuddy))){
          // A renewal rotates the gateway-owned copy in place. That rotation holds the
          // only live refresh token, so it outranks this read-only native capture and
          // the existing snapshot is kept instead of being reported as a conflict.
          const current=await readFile(join(final,'owned-workbuddy-session.json')).then(plain).catch(()=>null);
          if(current?.managedBy!=='ai-credit-gateway')throw problem('discovery_snapshot_conflict');
        }
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
  // N3(a): web-authorized accounts are created and owned by the authorization
  // path, never by discovery. They must be invisible to both the binding lookup
  // and the equivalent-file scan, otherwise a desktop login with the same
  // principal would silently overwrite a working web credential.
  const discoveryOwned = account => account?.credentials?.kind!=='oauth';
  async function existingAccount(account,principal,bundle,cache){
    const key=identityKey(account,principal),binding=state.bindings[key];
    if(binding){const found=service.config.value.accounts.find(a=>a.id===binding.accountId&&discoveryOwned(a)&&compatible(a,account));if(found)return found;}
    for(const existing of service.config.value.accounts.filter(a=>discoveryOwned(a)&&compatible(a,account))){
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
    const deleted=()=>publishRow(candidate,{status:'deleted',installed:true,reason:'account_explicitly_deleted'});
    if((Array.isArray(service.config.value.pluginAccountRemovals)?service.config.value.pluginAccountRemovals:[]).some(row=>(row.sourceFingerprints??[]).includes(bundle.fingerprint)))return deleted();
    // WB exposes the stable subject outside its encrypted token, so a removed
    // identity is rejected before a reusable native credential snapshot is made.
    if(candidate.platform==='workbuddy'){
      const raw=plain(bundle.bundle[0].data),principal=raw.account?.uid??raw.uid??raw.principal??raw.userId;
      if(principal!==undefined&&isRemovedAccount(service.config.value,candidate,principal))return deleted();
    }
    const prior=Object.entries(state.bindings).find(([,b])=>b.candidateId===candidate.id&&b.sourceFingerprint===bundle.fingerprint&&service.config.value.accounts.some(a=>a.id===b.accountId));
    if(prior){const account=service.config.value.accounts.find(a=>a.id===prior[1].accountId),expiry=prior[1].expiresAtMs;
      // N3(b): a web-authorized account is never discovery's to republish, even when a
      // stale binding from before the OAuth account was created still points at it.
      if(account?.credentials?.kind==='oauth')return publishRow(candidate,{status:'skipped',installed:true,accountId:account.id,reason:'raccoon_oauth_excluded'});
      if(Number.isFinite(expiry)&&expiry<=now()+60000)return publishRow(candidate,{status:'needs_setup',installed:true,accountId:account.id,reason:'credential_expired_or_expiring',sourceFingerprint:bundle.fingerprint});
      await refreshRoutes(candidate,account,prior[1],cfg,epoch);
      return publishRow(candidate,{status:'imported',installed:true,accountId:account.id,upstreamId:prior[1].upstreamId,routeCount:prior[1].routeCount??0,sourceFingerprint:bundle.fingerprint,catalogStatus:prior[1].catalogStatus??'not_requested',...(prior[1].catalogReason?{catalogReason:prior[1].catalogReason}:{})});
    }
    const isolated=await snapshot(candidate,bundle);
    const credential=await probeCredential(isolated.account,{engineRoot,dataDir:isolated.dataDir,now:now(),offline:true,allowExpired:true});
    // An Electron secret name is derived from the product, not from the account, so two
    // signed-in CodeArts accounts live in the same file name and differ only in content.
    // A candidate-wide refresh cache would hold one rotating refresh token at a time and
    // invalidate whichever account refreshed last, so scope this cache by identity.
    if(candidate.layout==='electron')isolated.account.credentials.cacheFile=join(isolated.dataDir,'private-cache','discovery-'+candidate.id+'-'+sha(identityKey(isolated.account,credential.principal)).slice(0,16)+'.json');
    if(isRemovedAccount(service.config.value,isolated.account,credential.principal)){
      await removeOwnedCredentialAssets(service,isolated.account,{taskRoot:root});return deleted();
    }
    const expiry=credential.expiresAtMs??null;if(!credential.principal)throw problem('credential_not_logged_in');
    if(Number.isFinite(expiry)&&expiry<=now()+60000)throw problem('credential_expired_or_expiring');
    const existing=await existingAccount(isolated.account,credential.principal,bundle,cache),key=identityKey(isolated.account,credential.principal);
    const accountId=existing?.id??'discovered-'+candidate.platform+'-'+key.slice(0,20),upstreamId=service.config.value.upstreams.find(u=>u.accountId===accountId&&u.kind===candidate.platform)?.id??'discovered-up-'+key.slice(0,20);
    // N3(b): depth guard for a merge that would otherwise adopt a live web
    // credential. A desktop sign-in with the same principal must never rewrite it.
    if(service.config.value.accounts.find(a=>a.id===accountId)?.credentials?.kind==='oauth')return publishRow(candidate,{status:'skipped',installed:true,reason:'raccoon_oauth_excluded'});
    let oauthExcluded=false;
    if(epoch!==generation)throw problem('discovery_stopped');await verifyBundle(bundle.bundle);
    try{await commit(value=>{
      if(epoch!==generation)throw problem('discovery_stopped');
      if(isRemovedAccount(value,isolated.account,credential.principal))throw problem('discovery_account_deleted');
      const current=value.accounts.find(a=>a.id===accountId);
      if(current?.credentials?.kind==='oauth'){oauthExcluded=true;return false;}
      if(current){current.credentials={...current.credentials,...isolated.account.credentials,cacheFile:current.credentials?.cacheFile??isolated.account.credentials.cacheFile};}
      else value.accounts.push({...isolated.account,id:accountId});
      if(!value.upstreams.some(u=>u.id===upstreamId))value.upstreams.push({id:upstreamId,kind:candidate.platform,accountId,enabled:true,discovered:true});
      return true;
    });}catch(error){if(error.code!=='discovery_account_deleted')throw error;await removeOwnedCredentialAssets(service,isolated.account,{taskRoot:root});return deleted();}
    if(oauthExcluded)return publishRow(candidate,{status:'skipped',installed:true,reason:'raccoon_oauth_excluded'});
    service.credentials?.cache?.delete(accountId);service.platforms?.catalogs?.delete(upstreamId);
    const binding={candidateId:candidate.id,accountId,upstreamId,sourceFingerprint:bundle.fingerprint,expiresAtMs:expiry,importedAt:new Date(now()).toISOString(),catalogStatus:'not_requested'};
    state.bindings[key]=binding;
    await refreshRoutes(candidate,service.config.value.accounts.find(a=>a.id===accountId),binding,cfg,epoch);
    await publishRow(candidate,{status:existing?'changed':'imported',installed:true,accountId,upstreamId,routeCount:binding.routeCount??0,sourceFingerprint:bundle.fingerprint,catalogStatus:binding.catalogStatus,...(binding.catalogReason?{catalogReason:binding.catalogReason}:{})});
    return rows.get(candidate.id);
  }
  // One cancellation-aware catalog read shared by the desktop path and the web
  // authorization path. `service.platforms.models` reaches the adapter, which picks
  // the right credential kind on its own (N3: authKind, never `kind`).
  async function catalogModels(upstreamId){
    const signal=controller.signal;
    let abort;
    const cancelled=new Promise((_,reject)=>{abort=()=>reject(problem('discovery_stopped'));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});
    try{return await Promise.race([(fetchModels??((id,args)=>service.platforms.models(id,args)))(upstreamId,{refresh:true,signal}),cancelled]);}
    finally{signal.removeEventListener('abort',abort);}
  }
  function usableModels(models,cfg){
    if(!Array.isArray(models))throw problem('discovery_catalog_invalid');
    const seen=new Set(),usable=models.filter(model=>{if(typeof model?.id!=='string'||!model.id||model.id.length>512||seen.has(model.id)||model.callable===false||!Number.isSafeInteger(model.contextWindow)||model.contextWindow<=0||!Number.isSafeInteger(model.maxTokens)||model.maxTokens<=0)return false;seen.add(model.id);return true;}).slice(0,cfg.maxModels);
    return usable;
  }
  async function refreshRoutes(candidate,account,binding,cfg,epoch){
    if(!cfg.fetchModels||account?.enabled===false||account?.inferenceEnabled===false||service.config.value.upstreams.find(u=>u.id===binding.upstreamId)?.enabled===false){binding.catalogStatus='disabled';return;}
    const last=binding.catalogCheckedAt?Date.parse(binding.catalogCheckedAt):0;
    if(last&&now()-last<cfg.modelRefreshMinutes*60000)return;
    binding.catalogCheckedAt=new Date(now()).toISOString();
    try{
      const models=await catalogModels(binding.upstreamId);
      if(epoch!==generation)throw problem('discovery_stopped');
      const usable=usableModels(models,cfg);
      if(!usable.length){binding.catalogStatus='needs_setup';binding.catalogReason='catalog_no_verified_callable_models';return;}
      await commit(value=>{if(epoch!==generation)throw problem('discovery_stopped');let added=0;for(const model of usable){if(value.routes.some(r=>(r.targets??[]).some(t=>t.upstreamId===binding.upstreamId&&t.model===model.id)))continue;const id='discovered-route-'+sha(binding.upstreamId+'\0'+model.id).slice(0,24);if(value.routes.some(r=>r.id===id))continue;value.routes.push({id,name:candidate.label+' · '+String(model.name??model.id).slice(0,160),enabled:cfg.autoEnableRoutes,targets:[{upstreamId:binding.upstreamId,model:model.id}],discovered:true});added++;}return added>0;});
      binding.routeCount=service.config.value.routes.filter(r=>(r.targets??[]).some(t=>t.upstreamId===binding.upstreamId)).length;binding.catalogStatus='ready';delete binding.catalogReason;
    }catch(error){if(error.code==='discovery_stopped')throw error;binding.catalogStatus='error';binding.catalogReason=codeOf(error);await emit({type:'agent.catalog_failed',candidateId:candidate.id,platform:candidate.platform,accountId:account.id,code:codeOf(error)});}
  }
  // Requirement A: a web-authorized Raccoon account is not a discovery candidate —
  // it has no native file, no snapshot and no binding (N3/N8) — but it still owns a
  // model upstream, so its catalog is refreshed here. Only routes are ever written:
  // credentials, tasks, bindings, identityKey and `data/discovered/` are untouched,
  // which is what keeps an OAuth account byte-identical across scans.
  const oauthCatalog=new Map();
  const oauthAccounts=()=>service.config.value.accounts.filter(account=>account?.credentials?.authKind==='oauth_iam');
  const oauthRouteStatus=()=>oauthAccounts().map(account=>{
    const catalog=oauthCatalog.get(account.id)??{},upstream=service.config.value.upstreams.find(u=>u.accountId===account.id&&u.kind==='raccoon');
    const count=upstream?service.config.value.routes.filter(r=>(r.targets??[]).some(t=>t.upstreamId===upstream.id)).length:0;
    return {accountId:account.id,upstreamId:upstream?.id??null,routeCount:count,catalogStatus:upstream?catalog.catalogStatus??'not_requested':'upstream_missing',...(catalog.catalogReason?{catalogReason:catalog.catalogReason}:{}),checkedAt:catalog.checkedAt??null};
  });
  async function refreshOauthRoutes(cfg,epoch,{accountId=null,force=false}={}){
    if(!cfg.fetchModels)return;
    for(const account of oauthAccounts()){
      if(accountId&&account.id!==accountId)continue;
      if(epoch!==generation)throw problem('discovery_stopped');
      const state=oauthCatalog.get(account.id)??{},upstream=service.config.value.upstreams.find(u=>u.accountId===account.id&&u.kind==='raccoon');
      if(!upstream){oauthCatalog.set(account.id,{...state,catalogStatus:'upstream_missing'});continue;}
      const last=state.checkedAt?Date.parse(state.checkedAt):0;
      if(!force&&last&&now()-last<cfg.modelRefreshMinutes*60000)continue;
      if(account.enabled===false||account.inferenceEnabled===false||upstream.enabled===false){oauthCatalog.set(account.id,{...state,checkedAt:new Date(now()).toISOString(),catalogStatus:'disabled'});continue;}
      const catalog={...state,checkedAt:new Date(now()).toISOString()};
      oauthCatalog.set(account.id,catalog);
      try{
        const models=await catalogModels(upstream.id);
        if(epoch!==generation)throw problem('discovery_stopped');
        const usable=usableModels(models,cfg);
        if(!usable.length){catalog.catalogStatus='needs_setup';catalog.catalogReason='catalog_no_verified_callable_models';continue;}
        // Idempotent and non-destructive: a route already covering this
        // upstream+model is never duplicated, so a user's renamed/disabled route and a
        // second identical refresh both stay exactly as they are. The one exception is
        // a title that is still the exact default this owner gave it (the pre-0.4.1
        // `小浣熊 · ` form, identical to the desktop account's routes) — that is
        // renamed to the source-tagged form so two same-model routes stay tellable
        // apart in the model list. A user's own title never matches and is untouched.
        const title=model=>'小浣熊(网页) · '+String(model.name??model.id).slice(0,160);
        await commit(value=>{
          if(epoch!==generation)throw problem('discovery_stopped');
          let changed=false;
          for(const model of usable){
            const legacy='小浣熊 · '+String(model.name??model.id).slice(0,160),name=title(model);
            const existing=value.routes.find(r=>(r.targets??[]).some(t=>t.upstreamId===upstream.id&&t.model===model.id));
            if(existing){
              if(existing.name===legacy&&legacy!==name){existing.name=name;changed=true;}
              continue;
            }
            const id='oauth-route-'+sha(upstream.id+'\0'+model.id).slice(0,24);
            if(value.routes.some(r=>r.id===id))continue;
            value.routes.push({id,name,enabled:cfg.autoEnableRoutes,targets:[{upstreamId:upstream.id,model:model.id}],discovered:true});
            changed=true;
          }
          return changed;
        });
        delete catalog.catalogReason;catalog.catalogStatus='ready';
      }catch(error){
        if(error.code==='discovery_stopped')throw error;
        catalog.catalogStatus='error';catalog.catalogReason=codeOf(error);
        await emit({type:'agent.catalog_failed',candidateId:'raccoon-oauth',platform:'raccoon',accountId:account.id,code:codeOf(error)});
      }
    }
  }
  /** Refresh exactly one web-authorized account right after its credential commit.
   *  Best-effort by contract: a catalog hiccup must never fail the authorization that
   *  already succeeded, so callers await it but it returns a summary instead of throwing
   *  (a stopped discovery still short-circuits). */
  async function refreshOauthAccount(id){
    const cfg=readSettings(),epoch=generation;
    try{await refreshOauthRoutes(cfg,epoch,{accountId:id,force:true});}catch{/* a failed catalog refresh keeps the account */ }
    return oauthRouteStatus().find(row=>row.accountId===id)??null;
  }
  async function doScan({connect=true,only}={}){
    await load();const cfg=readSettings(),epoch=generation,cache=new Map();scanCount++;
    for(const candidate of candidatesFor(cfg)){if(only&&candidate.id!==only)continue;if(epoch!==generation)break;
      try{await connectCandidate(candidate,{connect,epoch,settings:cfg,cache});}
      catch(error){if(error.code==='discovery_stopped')break;const code=codeOf(error),notLoggedIn=/missing|not_logged|login_required|credential_unavailable/.test(code),setup=/credential|decrypt|identity|storage|personal_scope|region|session|source_changed|snapshot_conflict|metadata_required/.test(code)||error instanceof SyntaxError;
        await publishRow(candidate,{status:notLoggedIn?'not_logged_in':setup?'needs_setup':'error',installed:code!=='discovery_native_source_rejected',reason:code});}
    }
    // Requirement A: web-authorized accounts are not candidates, but their model
    // catalog is refreshed on the same cadence so a desktop-less account still has
    // routes. An explicit single-candidate import does not sweep other accounts.
    if(!only)try{await refreshOauthRoutes(cfg,epoch);}catch(error){if(error.code!=='discovery_stopped')await emit({type:'agent.catalog_failed',candidateId:'raccoon-oauth',platform:'raccoon',code:codeOf(error)});}
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
  async function importCandidate(id){if(!candidatesFor(readSettings()).some(c=>c.id===id))throw problem('discovery_candidate_not_found');if(flight)await flight;await scan({connect:true,only:id});return rows.get(id);}
  return {scan,status,start,stop,importCandidate,refreshOauthAccount,credentialMetadata:()=>Object.values(state.bindings).filter(b=>b.accountId&&Number.isFinite(b.expiresAtMs)).map(b=>({accountId:b.accountId,expiresAtMs:b.expiresAtMs,observedAtMs:Date.parse(b.importedAt)||0}))};
}

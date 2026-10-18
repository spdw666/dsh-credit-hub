#!/usr/bin/env node
/** Offline, copy-only migration. This module never imports the engine or a network client. */
import {readFile, writeFile, mkdir, rename, lstat, readdir, rm, realpath} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {resolve, relative, isAbsolute, dirname, join, basename, sep} from 'node:path';
import {homedir, userInfo} from 'node:os';
import {fileURLToPath} from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const digest = data => createHash('sha256').update(data).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const exists = async file => { try { await lstat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const fail = code => { throw Object.assign(new Error(code), {code}); };
const fromJson = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));

/** The output guard rejects traversal and junction/symlink redirection, including existing parents. */
export async function assertInsideRoot(root, target) {
  const base = resolve(root), out = resolve(target), rel = relative(base, out);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) fail('output_outside_root');
  let cursor = base;
  for (const piece of ['', ...rel.split(sep)]) {
    if (piece) cursor = join(cursor, piece);
    try { if ((await lstat(cursor)).isSymbolicLink()) fail('output_symlink_rejected'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return out;
}

function safeAccountId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,127}$/.test(id) || id.includes('..')) fail('account_path_invalid');
  if (id.split('/').some(p => !p || p.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) fail('account_path_invalid');
  return id;
}

function sourcePath(value, base) {
  if (typeof value !== 'string' || !value || value === 'auto') return null;
  if (/\0/.test(value)) fail('source_path_invalid');
  const out = resolve(base, value);
  // Explicit absolute native credential files may be elsewhere; relative values may not escape their base.
  if (!isAbsolute(value)) {
    const rel = relative(resolve(base), out);
    if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) fail('source_path_traversal');
  }
  return out;
}

export function credentialCandidates(account, {sourceDir, env = process.env, home = homedir(), username = userInfo().username} = {}) {
  const c = account.credentials ?? {}, explicit = sourcePath(c.file ?? c.path, sourceDir);
  if (explicit) return [explicit];
  const app = env.APPDATA ?? join(home, 'AppData', 'Roaming');
  const local = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
  switch (account.platform) {
    case 'workbuddy': return [env.WORKBUDDY_AUTH_FILE, join(local, 'CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info'), join(home, '.local/share/CodeBuddyExtension/Data/Public/auth/Tencent-Cloud.coding-copilot.info')].filter(Boolean);
    case 'workbuddyai': return [join(local, 'CodeBuddyExtension/Data/Public/auth/workbuddy-desktop-ai.info')];
    case 'trae': return ({cn:['Trae CN','trae-cn'],solo:['TRAE SOLO CN','trae-solo-cn'],sg:['Trae','trae'],'solo-sg':['TRAE SOLO','trae-solo']}[account.edition ?? 'cn'] ?? []).map(n => join(app, n, 'User/globalStorage/storage.json'));
    case 'qwenwork': return ['QwenWorkCN/auth-v2.dat','QwenWork/auth-v2.dat','QwenWorkCN/auth.dat','QwenWork/auth.dat'].map(n => join(app, n));
    case 'zcode': return [join(home, '.zcode/v2/credentials.json')];
    case 'minimax': return [join(c.runtimeDataDir ? sourcePath(c.runtimeDataDir, sourceDir) : env.MINIMAX_DATA_DIR ?? join(home, '.minimax'), 'auth/prod', account.region === 'intl' ? 'en' : 'cn', 'mcode-public/auth.json')];
    case 'nvidia': return [join(home, '.ai-credit-gateway/nvidia/credential.json')];
    case 'antigravity': return [join(home, '.ai-credit-gateway/antigravity/gateway-credential.json')];
    case 'cline': return [join(home, '.cline/data/settings/providers.json')];
    case 'codearts': return [join(app, 'codearts-agent/User/globalStorage/state.vscdb')];
    case 'codebuddy': return [join(app, 'CodeBuddy' + (account.edition === 'cn' ? ' CN' : ''), 'User/globalStorage/state.vscdb')];
    case 'qoder': return [join(app, account.edition === 'cn' ? 'com.qodercn.app.stable' : 'com.qoder.app.stable', 'auth.v1.dat')];
    case 'lobster': return [join(app, 'LobsterAI/lobsterai.sqlite')];
    case 'loomy': return [env.LOOMY_AUTH_SESSION_FILE, join(env.PUBLIC ?? 'C:/Users/Public', 'Loomy', digest(username).slice(0,12), 'userData/auth-session.json'), join(app,'Loomy/auth-session.json')].filter(Boolean);
    case 'raccoon': return [join(env.BOX_AGENT_CONFIG_DIR ?? join(home,'.box-agent/config'), 'auth.json')];
    case 'opencode': return [join(home, '.local/share/opencode/opencode.db')];
    default: return [];
  }
}

async function filesBelow(root) {
  const all = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
      const file = join(dir, entry.name);
      if (entry.isSymbolicLink()) fail('output_symlink_rejected');
      if (entry.isDirectory()) await walk(file); else if (entry.isFile()) all.push(file); else fail('output_special_file_rejected');
    }
  }
  await walk(root); return all.sort();
}

/** A single source-file hash is rechecked at commit; neither refresh nor native helpers run. */
export async function importLocal({sourceConfig, root = DEFAULT_ROOT, port = 18742, env = process.env, home = homedir(), username = userInfo().username, hooks = {}} = {}) {
  if (!sourceConfig) fail('source_config_required');
  if (!Number.isInteger(port) || port < 1024 || port > 65533) fail('port_invalid');
  root = await realpath(resolve(root)); sourceConfig = resolve(sourceConfig);
  const sourceDir = dirname(sourceConfig), sourceBytes = await readFile(sourceConfig), sourceHash = digest(sourceBytes);
  const config = fromJson(sourceBytes);
  if (!Array.isArray(config.accounts) || !Array.isArray(config.routes) || !Array.isArray(config.upstreams)) fail('source_config_invalid');
  const ids = new Set();
  for (const account of config.accounts) { safeAccountId(account.id); const key=process.platform==='win32'?account.id.toLowerCase():account.id;if (ids.has(key)) fail('account_id_duplicate'); ids.add(key); }
  const profile = await assertInsideRoot(root, join(root, 'runtime/profile'));
  if (await exists(profile)) fail('profile_exists_use_rollback_first');
  const evidence=await assertInsideRoot(root,join(root,'evidence'));
  const manifestPath=await assertInsideRoot(root,join(evidence,'import-manifest.private.json'));
  const summaryPath=await assertInsideRoot(root,join(evidence,'import-summary.json'));
  if(await exists(manifestPath)||await exists(summaryPath))fail('migration_evidence_exists');
  const id = randomUUID(), stage = await assertInsideRoot(root, join(root, 'work', 'import-' + id));
  const stageProfile = join(stage, 'profile'), finalData = join(profile, 'data');
  const records = new Map([[sourceConfig, sourceHash]]), stats = {copiedFiles:0, credentialSnapshots:0, missingCredentials:0, metadataSnapshots:0, sqliteWalSnapshots:0};
  const accountStates = [], manualSetup = new Set();
  let committed = false;
  const stageFor = target => join(stageProfile, relative(profile, target));
  async function writeStage(target, bytes) {
    await assertInsideRoot(root, target); const staged = await assertInsideRoot(root, stageFor(target));
    await mkdir(dirname(staged), {recursive:true}); await writeFile(staged, bytes, {mode:0o600});
  }
  async function snapshot(source, target, {optional = false, metadata = false, wal = true} = {}) {
    if (!source) return false;
    let bytes;
    try { const st = await lstat(source); if (!st.isFile() || st.isSymbolicLink()) fail('source_file_type_invalid'); if (st.size > 256 * 1024 * 1024) fail('snapshot_file_too_large'); bytes = await readFile(source); }
    catch (error) { if (optional && error.code === 'ENOENT') return false; throw error; }
    const h = digest(bytes); if (records.has(source) && records.get(source) !== h) fail('source_changed'); records.set(source,h);
    await writeStage(target, bytes); stats.copiedFiles++; if (metadata) stats.metadataSnapshots++;
    // Copy stable DB + WAL bytes; opening a live SQLite source could create a source-side SHM file.
    if (wal && bytes.subarray(0,16).equals(Buffer.from('SQLite format 3\0'))) {
      if (await snapshot(source + '-wal', target + '-wal', {optional:true,metadata:true,wal:false})) stats.sqliteWalSnapshots++;
    }
    return true;
  }
  try {
    await mkdir(stageProfile,{recursive:true}); await mkdir(stageFor(finalData),{recursive:true});
    for (const [index, account] of config.accounts.entries()) {
      const c = account.credentials ??= {}, platform = account.platform;
      const base = await assertInsideRoot(root, join(finalData,'accounts',account.id));
      const native = join(base,'native');
      c.cacheFile = join(finalData,'private-cache', `${platform}-${digest(account.id).slice(0,16)}.json`);
      c.autoLaunch = false;
      let source;
      for (const candidate of credentialCandidates(account,{sourceDir,env,home,username})) if (await exists(candidate)) {source=candidate;break;}
      let target = source ? join(native,basename(source)) : join(native,'credential-not-imported.json');
      if (platform === 'trae' || platform === 'codearts' || platform === 'codebuddy') target = join(native,'User/globalStorage',source ? basename(source) : 'credential-not-imported.json');
      if (platform === 'workbuddy' && c.kind === 'file') target = join(base,'workbuddy-session.json');
      if (platform === 'minimax') {
        const r = account.region === 'intl' ? 'en' : 'cn';
        const oldProfile = c.profileDir ? sourcePath(c.profileDir,sourceDir) : join(env.APPDATA ?? join(home,'AppData/Roaming'),'MiniMax');
        c.runtimeDataDir = join(base,'minimax-runtime'); c.profileDir = join(base,'minimax-profile');
        target = join(c.runtimeDataDir,'auth/prod',r,'mcode-public/auth.json');
        const metadata = r === 'en' ? 'minimax-agent-en-config.json' : 'minimax-agent-cn-config.json';
        await snapshot(join(oldProfile,metadata),join(c.profileDir,metadata),{optional:true,metadata:true});
        manualSetup.add('minimax:isolated-runtime-auto-launch-disabled');
      }
      c.file = target; delete c.path;
      if (platform === 'freeapi' && c.kind === 'none') {delete c.file;delete c.cacheFile;}
      else if (source) {
        await snapshot(source,target); stats.credentialSnapshots++;
        if (platform === 'workbuddy') await snapshot(source+'.refresh-state.json',target+'.refresh-state.json',{optional:true,metadata:true});
        // Preserve metadata layout; cloned providers must honor profileDir/localState/serviceFile.
        let oldNative = dirname(source);
        if (['trae','codearts','codebuddy'].includes(platform)) oldNative = dirname(dirname(dirname(source)));
        if(platform!=='minimax')c.profileDir=native;c.localState = join(native,'Local State');
        await snapshot(join(oldNative,'Local State'),c.localState,{optional:true,metadata:true});
        for (const name of ['machineid','auth.machine-id','telemetry-state.json']) await snapshot(join(oldNative,name),join(native,name),{optional:true,metadata:true});
        if (platform === 'trae') {
          const logRoot=join(oldNative,'logs');
          const sessions=(await readdir(logRoot).catch(e => {if(e.code==='ENOENT')return [];throw e;})).filter(n=>/^\d{8}T\d{6}$/.test(n)).sort().reverse();
          if(sessions[0]) await snapshot(join(logRoot,sessions[0],'main.log'),join(native,'logs',sessions[0],'main.log'),{optional:true,metadata:true});
        }
        if (platform === 'lobster' || platform === 'loomy') {
          let raw; try { raw = fromJson(await readFile(source)); } catch {}
          const holder = platform === 'lobster' ? raw?.lobster ?? raw : raw?.loomy;
          const field = platform === 'lobster' ? 'dbFile' : 'authSessionFile';
          if(holder?.[field]) {
            const nestedSource = sourcePath(holder[field],sourceDir), nestedTarget = join(native,'nested',basename(nestedSource));
            await snapshot(nestedSource,nestedTarget); holder[field]=nestedTarget; await writeStage(target,jsonBytes(raw));
          }
        }
      } else if (platform !== 'freeapi') stats.missingCredentials++;
      if (platform === 'opencode') {
        c.serviceFile = join(native,'service.json'); c.sharedServiceEnabled = false;
        await snapshot(join(home,'.config/opencode/service.json'),c.serviceFile,{optional:true,metadata:true});
        manualSetup.add('opencode:shared-service-disabled');
      }
      accountStates.push({index:index+1,platform,enabled:account.enabled!==false,snapshot:platform==='freeapi'?'not-required':source?'copied':'not-found'});
    }
    for (const upstream of config.upstreams) {
      if (upstream.sidecar) {
        upstream.sidecar.autoStart=false;
        const oldConfig=sourcePath(upstream.sidecar.configFile,sourceDir), target=join(finalData,'sidecars',digest(upstream.id).slice(0,16),'config.disabled.yaml');
        if(oldConfig) await snapshot(oldConfig,target,{optional:true,metadata:true});
        upstream.sidecar.configFile=target;
      }
      if (upstream.kind === 'antigravity') {
        upstream.sidecarBaseUrl=`http://127.0.0.1:${port+1}/v1`; upstream.previewSetupRequired=true;
        manualSetup.add('antigravity:isolated-sidecar-pending');
      }
      if(upstream.kind === 'opencode') {
        // Do not carry a live shared-service/network controller into the preview config.
        if(upstream.networkProfile) {
          const networkFile=sourcePath(upstream.networkProfile,sourceDir);
          await snapshot(networkFile,join(finalData,'disabled-settings','opencode-network-profile.json'),{optional:true,metadata:true});
          delete upstream.networkProfile;
        }
        upstream.autoStart=false; upstream.sharedServiceEnabled=false; upstream.previewSetupRequired=true;
      }
    }
    config.dataDir=finalData;
    config.server={...config.server,host:'127.0.0.1',port,allowRemote:false};
    config.scheduler={...config.scheduler,enabled:false,startup:false};
    config.workbuddy={...config.workbuddy,autoMigrateSessions:false,autoTasks:false,rotation:{...config.workbuddy?.rotation,enabled:false}};
    config.pluginIsolation={version:1,mode:'local-preview',blockedUpstreamKinds:['antigravity','opencode'],manualSetup:[...manualSetup].sort(),sourceConfigSha256:sourceHash};
    const configFile=join(profile,'config.json'); await writeStage(configFile,jsonBytes(config));
    // Runtime environment paths isolate provider caches. The launcher must apply this before engine import.
    const environment={APPDATA:join(profile,'appdata/roaming'),LOCALAPPDATA:join(profile,'appdata/local'),AI_GATEWAY_PROFILE:profile,AI_GATEWAY_CONFIG:configFile,MINIMAX_DATA_DIR:join(finalData,'minimax-unconfigured'),PYTHONDONTWRITEBYTECODE:'1'};
    const qwenPython=join(root,'runtime/qwen-python',process.platform==='win32'?'Scripts/python.exe':'bin/python');if(await exists(qwenPython))environment.QWENWORK_PYTHON=qwenPython;
    await writeStage(join(profile,'environment.json'),jsonBytes(environment));
    await hooks.beforeCommit?.();
    for(const [file,h] of records) if(digest(await readFile(file))!==h) fail('source_changed');
    await assertInsideRoot(root,profile); await mkdir(dirname(profile),{recursive:true});
    if(await exists(profile))fail('profile_exists_use_rollback_first');
    await rename(stageProfile,profile); committed=true;
    const files=[];for(const file of await filesBelow(profile))files.push({path:relative(root,file).split(sep).join('/'),sha256:digest(await readFile(file))});
    await assertInsideRoot(root,manifestPath);await assertInsideRoot(root,summaryPath);await mkdir(evidence,{recursive:true});
    const summary={status:'imported-offline',sourceConfigSha256:sourceHash,targetConfigSha256:digest(await readFile(configFile)),sourceConfigUnchanged:digest(await readFile(sourceConfig))===sourceHash,accounts:config.accounts.length,enabledAccounts:config.accounts.filter(a=>a.enabled!==false).length,routes:config.routes.length,enabledRoutes:config.routes.filter(r=>r.enabled!==false).length,upstreams:config.upstreams.length,...stats,accountSnapshots:accountStates,oldLedgerCopied:false,networkCalls:0,nativeHelpersExecuted:0,scheduledTasksEnabled:false,manualSetup:[...manualSetup].sort()};
    await writeFile(manifestPath,jsonBytes({version:1,sourceConfig,sourceConfigSha256:sourceHash,profile:'runtime/profile',files,createdAt:new Date().toISOString()}),{mode:0o600,flag:'wx'});
    await writeFile(summaryPath,jsonBytes(summary),{mode:0o600,flag:'wx'});
    return {summary,profile,configFile,manifestPath,summaryPath};
  } catch(error) {
    // Never remove a committed profile after later user writes; preserve it for manifest recovery.
    if(committed) error.profileCommitted=true;
    throw error;
  } finally {await rm(stage,{recursive:true,force:true});}
}

export async function rollbackImport({root=DEFAULT_ROOT,manifestPath=join(root,'evidence/import-manifest.private.json')}={}) {
  root=await realpath(resolve(root));manifestPath=await assertInsideRoot(root,manifestPath);
  const manifest=fromJson(await readFile(manifestPath));
  if(manifest.version!==1||manifest.profile!=='runtime/profile'||!Array.isArray(manifest.files))fail('rollback_manifest_invalid');
  const profile=await assertInsideRoot(root,join(root,manifest.profile));
  const expected=new Map();
  for(const row of manifest.files) {
    if(typeof row.path!=='string'||!/^[0-9a-f]{64}$/.test(row.sha256??''))fail('rollback_manifest_invalid');
    const file=await assertInsideRoot(root,join(root,row.path));
    if(!file.startsWith(profile+sep))fail('rollback_path_invalid');
    if(expected.has(file))fail('rollback_manifest_invalid');expected.set(file,row.sha256);
  }
  const actual=await filesBelow(profile);
  if(actual.length!==expected.size)fail('rollback_profile_changed');
  for(const file of actual) if(!expected.has(file)||digest(await readFile(file))!==expected.get(file))fail('rollback_profile_changed');
  const sourceConfigUnchanged=digest(await readFile(manifest.sourceConfig))===manifest.sourceConfigSha256;
  // Preserve the private manifest for an auditable rollback record, not as an active import marker.
  const rolled=manifestPath.replace(/\.json$/,'.rolled-back.json');await assertInsideRoot(root,rolled);
  if(await exists(rolled))fail('rollback_evidence_exists');
  const summary=join(root,'evidence/import-summary.json');
  const summaryExists=await exists(summary),summaryOut=join(root,'evidence/import-summary.rolled-back.json');
  if(summaryExists){await assertInsideRoot(root,summary);await assertInsideRoot(root,summaryOut);if(await exists(summaryOut))fail('rollback_evidence_exists');}
  await rm(profile,{recursive:true});await rename(manifestPath,rolled);
  if(summaryExists)await rename(summary,summaryOut);
  return {status:'rolled_back',removedProfile:true,sourceConfigUnchanged};
}

async function main() {
  const args=process.argv.slice(2),opts={};
  for(let i=0;i<args.length;i++){
    const key=args[i];if(!['--source','--root','--port','--rollback'].includes(key)||i+1>=args.length)fail('arguments_invalid');opts[key]=args[++i];
  }
  const root=opts['--root']??DEFAULT_ROOT;
  if(opts['--rollback']) {const result=await rollbackImport({root,manifestPath:opts['--rollback']});console.log(JSON.stringify(result));return;}
  const result=await importLocal({root,sourceConfig:opts['--source'],port:opts['--port']===undefined?18742:Number(opts['--port'])});
  console.log(JSON.stringify({status:result.summary.status,accounts:result.summary.accounts,routes:result.summary.routes,enabledAccounts:result.summary.enabledAccounts,copiedCredentials:result.summary.credentialSnapshots,missingCredentials:result.summary.missingCredentials,sourceConfigUnchanged:result.summary.sourceConfigUnchanged,networkCalls:0,summaryPath:result.summaryPath}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({status:'error',code:error.code??'import_failed',profileCommitted:!!error.profileCommitted}));process.exitCode=1;});

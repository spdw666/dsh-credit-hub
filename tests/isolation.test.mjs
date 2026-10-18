import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,readdir,rm,symlink,copyFile,cp} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {importLocal,rollbackImport,assertInsideRoot,credentialCandidates} from '../scripts/import-local.mjs';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const hash=x=>createHash('sha256').update(x).digest('hex');
const parse=async p=>JSON.parse(await readFile(p,'utf8'));
async function write(p,value){await mkdir(dirname(p),{recursive:true});await writeFile(p,typeof value==='string'?value:JSON.stringify(value));}
async function fixture() {
  const dir=join(project,'work','isolation-tests',randomUUID()), root=join(dir,'TARGET'),old=join(dir,'SAMPLE_OLD'),home=join(dir,'SAMPLE_HOME');
  await Promise.all([mkdir(root,{recursive:true}),mkdir(old,{recursive:true}),mkdir(home,{recursive:true})]);
  const env={APPDATA:join(home,'APPDATA'),LOCALAPPDATA:join(home,'LOCALAPPDATA'),PUBLIC:join(home,'PUBLIC')};
  const credential=join(old,'data/accounts/SAMPLE/workbuddy-session.json');
  await write(credential,{principal:'SAMPLE_PRIVATE_PRINCIPAL',accessToken:'SAMPLE_PRIVATE_ACCESS_TOKEN',refreshToken:'SAMPLE_PRIVATE_REFRESH_TOKEN',expiresAtMs:4000000000000});
  await write(credential+'.refresh-state.json',{status:'unconfirmed',sourceFingerprint:'SAMPLE',attemptedAt:1});
  const sourceConfig=join(old,'config.local.json');
  const config={schemaVersion:1,server:{host:'127.0.0.1',port:1234},dataDir:join(old,'data'),scheduler:{enabled:true,startup:true},workbuddy:{autoTasks:true,autoMigrateSessions:true,rotation:{enabled:true}},accounts:[{id:'SAMPLE',platform:'workbuddy',label:'SAMPLE_PRIVATE_LABEL',enabled:true,credentials:{kind:'file',file:credential},tasks:['checkin','tasks']}],upstreams:[{id:'SAMPLE-UP',kind:'workbuddy',accountId:'SAMPLE',enabled:true}],routes:[{id:'SAMPLE-ROUTE',enabled:true,targets:[{upstreamId:'SAMPLE-UP',model:'SAMPLE'}]}]};
  await write(sourceConfig,config);
  await write(join(old,'data/ledger.sqlite'),'SAMPLE_LEDGER_MUST_NOT_COPY');
  return {dir,root,old,home,env,username:'SAMPLE',sourceConfig,config,credential,clean:()=>rm(dir,{recursive:true,force:true})};
}
async function list(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())out.push(...await list(p));else out.push(p);}return out;}

test('offline import preserves selections; credentials, caches and data live only in new root',async()=>{
 const f=await fixture();try{
  const oldHash=hash(await readFile(f.sourceConfig)),credentialHash=hash(await readFile(f.credential));
  const r=await importLocal(f), c=await parse(r.configFile);
  assert.equal(hash(await readFile(f.sourceConfig)),oldHash);assert.equal(hash(await readFile(f.credential)),credentialHash);
  assert.deepEqual(c.routes,f.config.routes);assert.deepEqual(c.accounts.map(a=>a.enabled),[true]);assert.deepEqual(c.accounts[0].tasks,f.config.accounts[0].tasks);
  assert.equal(c.scheduler.enabled,false);assert.equal(c.scheduler.startup,false);assert.equal(c.workbuddy.autoTasks,false);assert.equal(c.workbuddy.autoMigrateSessions,false);assert.equal(c.workbuddy.rotation.enabled,false);
  assert.equal(c.server.port,18742);assert.equal(c.dataDir,join(f.root,'runtime/profile/data'));assert.ok(c.accounts[0].credentials.file.startsWith(c.dataDir));assert.ok(c.accounts[0].credentials.cacheFile.startsWith(c.dataDir));
  assert.equal(await readFile(c.accounts[0].credentials.file,'utf8'),await readFile(f.credential,'utf8'));
  await write(c.accounts[0].credentials.file,{accessToken:'SAMPLE_NEW_ONLY'});assert.equal(hash(await readFile(f.credential)),credentialHash);
  assert.ok(!(await list(r.profile)).some(p=>p.endsWith('ledger.sqlite')));assert.equal(r.summary.oldLedgerCopied,false);assert.equal(r.summary.networkCalls,0);assert.equal(r.summary.nativeHelpersExecuted,0);
  const summary=await readFile(r.summaryPath,'utf8');for(const secret of ['SAMPLE_PRIVATE_PRINCIPAL','SAMPLE_PRIVATE_ACCESS_TOKEN','SAMPLE_PRIVATE_REFRESH_TOKEN','SAMPLE_PRIVATE_LABEL','SAMPLE-UP','SAMPLE-ROUTE'])assert.ok(!summary.includes(secret));
  const environment=await parse(join(r.profile,'environment.json'));assert.ok(environment.LOCALAPPDATA.startsWith(r.profile));assert.ok(environment.APPDATA.startsWith(r.profile));
 }finally{await f.clean();}
});

test('account and source path traversal fail before publishing a profile',async()=>{
 for(const id of ['../SAMPLE','SAMPLE/../../OUT','CON','SAMPLE//OUT']){
  const f=await fixture();try{f.config.accounts[0].id=id;await write(f.sourceConfig,f.config);await assert.rejects(importLocal(f),{code:'account_path_invalid'});assert.deepEqual(await readdir(f.root),[]);}finally{await f.clean();}
 }
 const f=await fixture();try{f.config.accounts[0].credentials.file='../SAMPLE_OUTSIDE';await write(f.sourceConfig,f.config);await assert.rejects(importLocal(f),{code:'source_path_traversal'});assert.ok(!(await list(f.root)).some(p=>p.endsWith('config.json')));}finally{await f.clean();}
});

test('output guard rejects traversal and a junction/symlink escape',async()=>{
 const f=await fixture();try{
  await assert.rejects(assertInsideRoot(f.root,join(f.root,'..','OUT')),{code:'output_outside_root'});
  const linked=join(f.root,'runtime');await symlink(f.old,linked,process.platform==='win32'?'junction':'dir');
  await assert.rejects(importLocal(f),{code:'output_symlink_rejected'});assert.ok(!(await readdir(f.old)).includes('profile'));
 }finally{await f.clean();}
});

test('CAS detects source config or credential replacement without writing old state',async()=>{
 for(const field of ['sourceConfig','credential']){
  const f=await fixture();try{
   await assert.rejects(importLocal({...f,hooks:{beforeCommit:async()=>write(f[field],{SAMPLE_CHANGED:true})}}),{code:'source_changed'});
   assert.ok(!(await list(f.root)).some(p=>p.endsWith('config.json')));assert.equal((await parse(f[field])).SAMPLE_CHANGED,true);
  }finally{await f.clean();}
 }
});

test('independent copy rollback removes only its own profile; original migrated profile stays changed',async()=>{
 const f=await fixture();try{
  const r=await importLocal(f),root2=join(f.dir,'ROLLBACK_COPY');await mkdir(root2);await cp(r.profile,join(root2,'runtime/profile'),{recursive:true});await mkdir(join(root2,'evidence'));await copyFile(r.manifestPath,join(root2,'evidence/import-manifest.private.json'));await copyFile(r.summaryPath,join(root2,'evidence/import-summary.json'));
  assert.deepEqual(await rollbackImport({root:root2}),{status:'rolled_back',removedProfile:true,sourceConfigUnchanged:true});
  assert.ok((await readdir(join(root2,'runtime'))).length===0);assert.ok((await readFile(r.configFile)).length>0);assert.equal((await parse(r.configFile)).scheduler.enabled,false);assert.ok((await readdir(join(root2,'evidence'))).includes('import-manifest.private.rolled-back.json'));
 }finally{await f.clean();}
});

test('rollback rejects concurrent changes and forged out-of-root manifest paths',async()=>{
 const f=await fixture();try{
  const r=await importLocal(f);await write(join(r.profile,'SAMPLE_NEW_FILE'),'SAMPLE');await assert.rejects(rollbackImport({root:f.root}),{code:'rollback_profile_changed'});await rm(join(r.profile,'SAMPLE_NEW_FILE'));
  const manifest=await parse(r.manifestPath);manifest.files.push({path:'../SAMPLE_OLD/config.local.json',sha256:hash(await readFile(f.sourceConfig))});await write(r.manifestPath,manifest);
  await assert.rejects(rollbackImport({root:f.root}),{code:'output_outside_root'});assert.ok((await readFile(f.sourceConfig)).length>0);
 }finally{await f.clean();}
});

test('native metadata, stable SQLite WAL and MiniMax runtime files are cloned; no original IPC lease is copied',async()=>{
 const f=await fixture();try{
  const entries=[['qwenwork',join(f.env.APPDATA,'QwenWorkCN/auth-v2.dat')],['trae',join(f.env.APPDATA,'Trae CN/User/globalStorage/storage.json')],['minimax',join(f.home,'.minimax/auth/prod/cn/mcode-public/auth.json')],['codearts',join(f.env.APPDATA,'codearts-agent/User/globalStorage/state.vscdb')],['zcode',join(f.home,'.zcode/v2/credentials.json')]];
  f.config.accounts=entries.map(([platform],i)=>({id:'SAMPLE-'+i,platform,enabled:i%2===0,credentials:{kind:'desktop',file:'auto',autoLaunch:true}}));
  for(const [platform,file]of entries){await write(file,platform==='codearts'?'SQLite format 3\0SAMPLE_DB':{SAMPLE_CREDENTIAL:platform});}
  await write(entries[3][1]+'-wal','SAMPLE_WAL');await write(join(f.env.APPDATA,'QwenWorkCN/Local State'),{SAMPLE_DPAPI:'SAMPLE'});await write(join(f.env.APPDATA,'Trae CN/machineid'),'SAMPLE_MACHINE');await write(join(f.env.APPDATA,'Trae CN/logs/20261018T120000/main.log'),'SAMPLE_LOG');await write(join(f.home,'.zcode/v2/telemetry-state.json'),{deviceMid:'SAMPLE_DEVICE'});await write(join(f.env.APPDATA,'MiniMax/minimax-agent-cn-config.json'),{user:{realUserID:'SAMPLE',deviceID:'SAMPLE'}});await write(join(f.home,'.minimax/run/mcode-auth-lease-v1.cap'),'SAMPLE_LEASE_MUST_NOT_COPY');await write(f.sourceConfig,f.config);
  const r=await importLocal(f),c=await parse(r.configFile);assert.equal(r.summary.credentialSnapshots,5);assert.equal(r.summary.sqliteWalSnapshots,1);assert.equal(r.summary.missingCredentials,0);
  const mini=c.accounts.find(a=>a.platform==='minimax');assert.equal(mini.credentials.autoLaunch,false);assert.ok(mini.credentials.runtimeDataDir.startsWith(c.dataDir));assert.ok(mini.credentials.profileDir.startsWith(c.dataDir));assert.ok((await list(r.profile)).every(p=>!p.endsWith('.cap')));
  const trae=c.accounts.find(a=>a.platform==='trae');assert.equal(await readFile(join(trae.credentials.profileDir,'machineid'),'utf8'),'SAMPLE_MACHINE');const qwen=c.accounts.find(a=>a.platform==='qwenwork');assert.equal((await parse(qwen.credentials.localState)).SAMPLE_DPAPI,'SAMPLE');
 }finally{await f.clean();}
});

test('OpenCode and Antigravity retain enabled choices but do not reuse old service/network launch configuration',async()=>{
 const f=await fixture();try{
  f.config.accounts.push({id:'SAMPLE-OPENCODE',platform:'opencode',enabled:true,credentials:{kind:'auto'}},{id:'SAMPLE-ANTIGRAVITY',platform:'antigravity',enabled:true,credentials:{kind:'file',file:f.credential}});
  const network=join(f.old,'network.json'),sidecar=join(f.old,'sidecar.yaml');await write(network,{controllerToken:'SAMPLE_PRIVATE_CONTROLLER'});await write(sidecar,'auth-dir: SAMPLE_OLD');
  f.config.upstreams.push({id:'SAMPLE-OPENCODE',kind:'opencode',accountId:'SAMPLE-OPENCODE',enabled:true,networkProfile:network,baseUrl:'http://127.0.0.1:12345'},{id:'SAMPLE-ANTIGRAVITY',kind:'antigravity',accountId:'SAMPLE-ANTIGRAVITY',enabled:true,sidecarBaseUrl:'http://127.0.0.1:8080',sidecar:{autoStart:true,executable:'SAMPLE',configFile:sidecar}});await write(f.sourceConfig,f.config);
  const r=await importLocal(f),c=await parse(r.configFile),op=c.upstreams.find(u=>u.kind==='opencode'),ag=c.upstreams.find(u=>u.kind==='antigravity');
  assert.equal(op.enabled,true);assert.equal(op.networkProfile,undefined);assert.equal(op.autoStart,false);assert.equal(op.sharedServiceEnabled,false);assert.equal(op.previewSetupRequired,true);assert.equal(ag.enabled,true);assert.equal(ag.sidecar.autoStart,false);assert.equal(ag.sidecarBaseUrl,'http://127.0.0.1:18743/v1');assert.ok(c.pluginIsolation.blockedUpstreamKinds.includes('opencode'));assert.ok(!(await readFile(r.summaryPath,'utf8')).includes('SAMPLE_PRIVATE_CONTROLLER'));
 }finally{await f.clean();}
});

test('module import is side-effect free and explicit file discovery uses only SAMPLE fixture inputs',async()=>{
 const f=await fixture();try{const candidates=credentialCandidates(f.config.accounts[0],{sourceDir:f.old,env:f.env,home:f.home,username:'SAMPLE'});assert.deepEqual(candidates,[f.credential]);assert.deepEqual(await readdir(f.root),[]);}finally{await f.clean();}
});

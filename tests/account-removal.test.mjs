import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,dirname,resolve,sep} from 'node:path';import {fileURLToPath} from 'node:url';
import {removeHubAccount,isRemovedAccount,accountPrincipalHash,pruneAccount} from '../server/account-removal.mjs';
import {createDiscovery} from '../server/discovery.mjs';import {parseManagementRequest} from '../server/contracts.mjs';
import {createHubRuntime} from '../server/runtime.mjs';
const json=async file=>JSON.parse(await readFile(file,'utf8'));const put=async(file,value)=>{await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value));};
const fixtureRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../work/account-removal-tests');
const principal='SAMPLE_REMOVED_PERSON',token='SAMPLE_DELETED_TOKEN',nativeAuth=(p=principal,t=token)=>({account:{uid:p},auth:{accessToken:t,refreshToken:'SAMPLE_REFRESH',domain:'www.workbuddy.cn',expiresAt:4102444800000}});
async function fixture(t){
 await mkdir(fixtureRoot,{recursive:true});const dir=await mkdtemp(join(fixtureRoot,'dsh-remove-')),root=join(dir,'TARGET'),stateRoot=join(root,'runtime/profile'),dataDir=join(stateRoot,'data'),file=join(dataDir,'accounts/SAMPLE/workbuddy-session.json'),configFile=join(stateRoot,'config.json'),native=join(dir,'NATIVE/Agent/auth.info');
 await put(file,{principal,accessToken:token,refreshToken:'SAMPLE_REFRESH'});
 const a={id:'SAMPLE',platform:'workbuddy',enabled:true,inferenceEnabled:false,credentials:{kind:'file',file},tasks:[{id:'daily-checkin',enabled:true}]};
 const value={accounts:[a],upstreams:[{id:'UP_SAMPLE',kind:'workbuddy',accountId:'SAMPLE'}],routes:[{id:'ROUTE_SAMPLE',enabled:false,targets:[{upstreamId:'UP_SAMPLE',model:'SAMPLE_MODEL'}]}]};
 await put(configFile,value);const config={file:configFile,dataDir,value,path:p=>resolve(stateRoot,p),async load(){this.value=await json(configFile);},async save(v){await put(configFile+'.backup.json',this.value);await put(configFile,v);this.value=structuredClone(v);}};
 const service={config,credentials:{cache:new Map([['SAMPLE',{value:token}]])},balanceCache:new Map([['SAMPLE',{}]]),platforms:{catalogs:new Map([['UP_SAMPLE',[]]])},ledger:{principalHash:()=>accountPrincipalHash('workbuddy',principal),get:()=>undefined,unbind(){}}};
 const options={taskRoot:root,stateRoot,engineRoot:fileURLToPath(new URL('../engine/',import.meta.url))},hostEnvironment={HOME:join(dir,'NATIVE/HOME'),USERPROFILE:join(dir,'NATIVE/HOME'),APPDATA:join(dir,'NATIVE/Roaming'),LOCALAPPDATA:join(dir,'NATIVE/Local'),PUBLIC:join(dir,'NATIVE/Public'),USERNAME:'SAMPLE'};
 const extraCandidates=[{id:'sample-agent',platform:'workbuddy',label:'SAMPLE',paths:[native]}];
 t.after(async()=>{const actual=resolve(dir);if(!actual.startsWith(fixtureRoot+sep)||!actual.split(sep).at(-1).startsWith('dsh-remove-'))throw Error('cleanup target');await rm(actual,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
 return {dir,root,stateRoot,dataDir,file,configFile,config,service,options,hostEnvironment,extraCandidates,native,a};
}
test('delete requires explicit confirmation and leaves all account state untouched otherwise',async t=>{
 const f=await fixture(t),before=await readFile(f.configFile);await assert.rejects(removeHubAccount(f.service,'SAMPLE',{taskRoot:f.root}),{code:'account_delete_confirmation_required'});assert.deepEqual(await readFile(f.configFile),before);assert.equal((await json(f.file)).accessToken,token);
});
test('explicit delete clears references, owned credentials and refresh files; no deleted before-image survives',async t=>{
 const f=await fixture(t);await put(f.file+'.refresh-state.json',{accessToken:token});await put(f.file+'.refresh-state.json.lock',{marker:true});
 const r=await removeHubAccount(f.service,'SAMPLE',{taskRoot:f.root,confirm:true});assert.equal(r.deleted,true);assert.deepEqual(r.removed,{accounts:1,upstreams:1,routes:1});assert.equal(r.credentialBackupCreated,false);assert.equal(r.retainedAssets.length,0);assert.equal(f.service.credentials.cache.size,0);assert.equal(f.service.balanceCache.size,0);
 for(const file of [f.file,f.file+'.refresh-state.json',f.file+'.refresh-state.json.lock'])await assert.rejects(access(file),{code:'ENOENT'});
 const config=await json(f.configFile),backup=await json(f.configFile+'.backup.json');assert.equal(config.accounts.length,0);assert.deepEqual(backup,config);const tombstone=JSON.stringify(config.pluginAccountRemovals);for(const v of [principal,token,'SAMPLE_REFRESH','SAMPLE'])assert.equal(tombstone.includes(v),false);assert.equal(isRemovedAccount(config,f.a,principal),true);assert.equal(isRemovedAccount(config,f.a,'SAMPLE_OTHER_PERSON'),false);
});
test('pool removal chooses a viable successor and keeps unrelated toggles and targets',()=>{
 const a={id:'A',platform:'workbuddy'},b={id:'B',platform:'workbuddy',enabled:true},v={accounts:[a,b],upstreams:[{id:'UA',kind:'workbuddy',accountId:'A'},{id:'UB',kind:'workbuddy',accountId:'B'}],routes:[{id:'POOL',enabled:false,targets:[{upstreamId:'UA',model:'m'}],accountPool:{accountIds:['A','B'],cooldownSeconds:600}}]};
 const r=pruneAccount(v,'A');assert.equal(r.routes,0);assert.equal(v.routes[0].enabled,false);assert.equal(v.routes[0].targets[0].upstreamId,'UB');assert.deepEqual(v.routes[0].accountPool.accountIds,['B']);
});
test('shared or native credential assets are retained instead of deleting another account or client',async t=>{
 const f=await fixture(t);f.config.value.accounts.push({...f.a,id:'SAMPLE_OTHER',credentials:{...f.a.credentials,file:process.platform==='win32'?f.file.toUpperCase():f.file}});await f.config.save(f.config.value);let r=await removeHubAccount(f.service,'SAMPLE',{taskRoot:f.root,confirm:true});assert.ok(r.retainedAssets.some(a=>a.reason==='shared'));assert.equal((await json(f.file)).accessToken,token);
 const second=await fixture(t);await put(second.native,{principal,accessToken:token});second.config.value.accounts[0].credentials.file=second.native;await second.config.save(second.config.value);r=await removeHubAccount(second.service,'SAMPLE',{taskRoot:second.root,confirm:true});assert.ok(r.retainedAssets.some(a=>a.reason==='not_private_data'));assert.equal((await json(second.native)).accessToken,token);
});
test('identity can be obtained by offline parser when no ledger binding has ever been made',async t=>{
 const f=await fixture(t);f.service.ledger.principalHash=()=>undefined;let calls=0;await removeHubAccount(f.service,'SAMPLE',{taskRoot:f.root,confirm:true,resolvePrincipal:async a=>{calls++;return json(a.credentials.file);}});assert.equal(calls,1);assert.equal(isRemovedAccount(f.config.value,f.a,principal),true);
});
test('private-looking paths redirected through a junction never delete the native target',async t=>{
 const f=await fixture(t),link=join(f.dataDir,'linked');await put(f.native,{principal,accessToken:token});await symlink(dirname(f.native),link,'junction');
 f.config.value.accounts[0].credentials.file=join(link,'auth.info');await f.config.save(f.config.value);
 const r=await removeHubAccount(f.service,'SAMPLE',{taskRoot:f.root,confirm:true});assert.ok(r.retainedAssets.some(a=>a.reason==='link_rejected'));assert.equal((await json(f.native)).accessToken,token);
});
test('delete drains an existing credential writer behind a disabled gate before erasing its last write',async t=>{
 const f=await fixture(t);let release;const gate=new Promise(r=>{release=r;});
 f.service.credentials.flights=new Map([['SAMPLE',gate.then(()=>put(f.file,{principal,accessToken:'SAMPLE_LATE_WRITE'}))]]);
 const deleting=removeHubAccount(f.service,'SAMPLE',{taskRoot:f.root,confirm:true});
 for(let n=0;n<30;n++){if((await json(f.configFile)).accounts[0].enabled===false)break;await new Promise(r=>setTimeout(r,5));}
 assert.equal((await json(f.configFile)).accounts[0].enabled,false);release();await deleting;await assert.rejects(access(f.file),{code:'ENOENT'});assert.equal(f.config.value.accounts.length,0);
});
test('delete suppression survives repeated scans, token rotation and discovery restart; different identity still imports',async t=>{
 const f=await fixture(t);f.config.value.accounts=[];f.config.value.upstreams=[];f.config.value.routes=[];await f.config.save(f.config.value);await put(f.native,nativeAuth());
 const input={service:f.service,options:f.options,hostEnvironment:f.hostEnvironment,extraCandidates:f.extraCandidates,settings:{fetchModels:false}};
 const d=createDiscovery(input);t.after(()=>d.stop());const initial=await d.scan();assert.equal(f.config.value.accounts.length,1,JSON.stringify(initial));const account=f.config.value.accounts[0];const snapshot=account.credentials.profileDir;
 await removeHubAccount(f.service,account.id,{taskRoot:f.root,confirm:true});await assert.rejects(access(snapshot),{code:'ENOENT'});
 for(let n=0;n<2;n++){const s=await d.scan();assert.equal(s.candidates.find(c=>c.id==='sample-agent').status,'deleted');assert.equal(f.config.value.accounts.length,0);}
 await put(f.native,nativeAuth(principal,'SAMPLE_ROTATED_TOKEN'));await d.stop();const restarted=createDiscovery(input);try{await restarted.scan();assert.equal(f.config.value.accounts.length,0);await put(f.native,nativeAuth('SAMPLE_NEW_PERSON','SAMPLE_NEW_TOKEN'));await restarted.scan();assert.equal(f.config.value.accounts.length,1);assert.notEqual((await json(f.config.value.accounts[0].credentials.file)).principal,principal);}finally{await restarted.stop();}
});
test('management allowlist exposes only POST removal, not unauthenticated GET or predecessor control',()=>{
 assert.equal(parseManagementRequest({method:'POST',path:'/hub/accounts/remove',body:{accountId:'account-SAMPLE',confirm:true}}).local,true);assert.throws(()=>parseManagementRequest({method:'GET',path:'/hub/accounts/remove'}),{code:'management_operation_not_allowed'});
});
test('real worker removes an opaque handle and its native discovery cannot resurrect the deleted identity',async t=>{
 const f=await fixture(t);await f.config.save({...f.config.value,schemaVersion:1,dataDir:'./data',server:{host:'127.0.0.1',port:0},scheduler:{enabled:false,startup:false,timezone:'Asia/Shanghai',hour:0,minute:5,jitterSeconds:0}});
 await put(f.native,nativeAuth());const hub=await createHubRuntime({...f.options,nodeExecutable:process.execPath,enableBackgroundOperations:false,hostEnvironment:{...f.hostEnvironment,WORKBUDDY_AUTH_FILE:f.native}});
 try{
  const snapshot=await hub.snapshot();const handle=snapshot.accounts[0].id;assert.match(handle,/^account-/);
  const response=await hub.request({method:'POST',path:'/hub/accounts/remove',body:{accountId:handle,confirm:true}});assert.equal(response.status,200);assert.equal(response.body.deleted,true);assert.equal(JSON.stringify(response).includes(principal),false);assert.equal(JSON.stringify(response).includes(token),false);assert.equal((await hub.snapshot()).counts.accounts,0);await assert.rejects(access(f.file),{code:'ENOENT'});
  await hub.request({method:'POST',path:'/hub/operations',body:{discovery:{fetchModels:false}}});
  const scan=await hub.request({method:'POST',path:'/hub/discovery',body:{connect:true}});assert.equal(scan.status,200);assert.equal((await hub.snapshot()).counts.accounts,0);
  await put(f.native,nativeAuth('SAMPLE_DIFFERENT_PERSON','SAMPLE_DIFFERENT_TOKEN'));await hub.request({method:'POST',path:'/hub/discovery',body:{connect:true}});assert.equal((await hub.snapshot()).counts.accounts,1);
 }finally{await hub.close();}
});

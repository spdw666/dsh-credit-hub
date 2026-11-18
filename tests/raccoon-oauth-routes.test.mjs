import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHubRuntime} from '../server/runtime.mjs';
import {localGetPaths,localPostPaths,operationPaths} from '../server/contracts.mjs';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const ROUTES={get:['/hub/raccoon/oauth','/hub/raccoon/oauth/status'],post:['/hub/raccoon/oauth/begin','/hub/raccoon/oauth/paste','/hub/raccoon/oauth/cancel','/hub/raccoon/oauth/reauth']};

async function fixture(t){
  const parent=join(project,'work','raccoon-oauth-routes');
  await mkdir(parent,{recursive:true});
  const root=await mkdtemp(join(parent,'case-')),engine=join(root,'source','engine'),src=join(engine,'src'),profile=join(root,'runtime','profile');
  await mkdir(src,{recursive:true});await mkdir(profile,{recursive:true});
  await writeFile(join(engine,'package.json'),JSON.stringify({type:'module',version:'0.6.0'}));
  await writeFile(join(src,'service.mjs'),`
import {readFile,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
export async function createService(file,{schedule}={}){
 const config={file,value:JSON.parse(await readFile(file,'utf8')),dataDir:resolve(file,'..','data'),path:p=>resolve(file,'..',p),async load(){this.value=JSON.parse(await readFile(file,'utf8'));return this.value;},async save(value){this.value=value;await writeFile(file,JSON.stringify(value));}};
 const scheduler={stopped:true,start(){this.stopped=false},async stop(){this.stopped=true}};
 const ledger={get(){},records(){return []},usage(){return {records:[],totals:{calls:0}}}};
 return {config,scheduler,ledger,keys:{apiKey:'SAMPLE_PUBLIC_KEY',adminKey:'SAMPLE_PERSISTED_ADMIN'},credentials:{cache:new Map(),account:id=>config.value.accounts.find(a=>a.id===id),async resolve(){throw Error('SHOULD_NOT_RESOLVE_CREDENTIALS')}},platforms:{catalogs:new Map(),models:async(id,opts)=>{opts?.signal;return String(id).startsWith('up-raccoon-oauth')?[{id:'SAMPLE_OAUTH_MODEL',name:'OAuth model',callable:true,contextWindow:32000,maxTokens:4096}]:[];}},router:{models:async()=>({data:[]}),async *chat(){yield {}},relay:{status:()=>({settings:{enabled:true},generationRequests:0})}},async close(){await scheduler.stop()}};
}`);
  await writeFile(join(src,'server.mjs'),`
import http from 'node:http';
export async function startServer(){const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end('{}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {key:'SAMPLE',baseUrl:'http://127.0.0.1:'+server.address().port,async close(){server.closeAllConnections();await new Promise(r=>server.close(r));}};}`);
  for(const name of ['activity-context.mjs','model-directory.mjs','credentials.mjs'])await writeFile(join(src,name),'export {};');
  await writeFile(join(profile,'config.json'),JSON.stringify({schemaVersion:1,dataDir:'./data',accounts:[],upstreams:[],routes:[],server:{host:'127.0.0.1',port:0,allowRemote:false},scheduler:{enabled:false,startup:false,hour:0,minute:5,timezone:'Asia/Shanghai',jitterSeconds:60,maxConcurrency:2,windows:{}},workbuddy:{autoTasks:false,autoMigrateSessions:false}}));
  const hub=await createHubRuntime({taskRoot:root,engineRoot:engine,nodeExecutable:process.execPath,enableBackgroundOperations:false,hostEnvironment:{HOME:join(root,'home'),USERPROFILE:join(root,'home'),USERNAME:'SAMPLE',APPDATA:join(root,'appdata'),LOCALAPPDATA:join(root,'local'),PUBLIC:join(root,'public')}});
  t.after(async()=>{await hub.close();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
  await hub.waitUntilReady({timeoutMs:10000});
  return {hub,root,profile};
}
const call=(hub,method,path,body)=>hub.request({method,path,...(body===undefined?{}:{body})});
const codeOf=async promise=>{try{await promise;return null;}catch(error){return error.code??null;}};

test('N4-A the three registries carry exactly the six web-authorization routes',async t=>{
  assert.deepEqual([...ROUTES.get,...ROUTES.post].sort(),['/hub/raccoon/oauth','/hub/raccoon/oauth/begin','/hub/raccoon/oauth/cancel','/hub/raccoon/oauth/paste','/hub/raccoon/oauth/reauth','/hub/raccoon/oauth/status']);
  for(const path of ROUTES.get)assert.ok(localGetPaths.includes(path),`GET allow-list is missing ${path}`);
  for(const path of ROUTES.post)assert.ok(localPostPaths.includes(path),`POST allow-list is missing ${path}`);
  for(const path of [...ROUTES.get,...ROUTES.post])assert.ok(operationPaths.includes(path),`worker forwarding list is missing ${path}`);
  // The forwarding list is the only place a local operation can disappear from
  // without a visible error: everything else is asserted above.
  assert.deepEqual([...operationPaths].sort(),['/hub/discovery','/hub/events','/hub/events/ack','/hub/events/pending','/hub/events/test','/hub/forecast','/hub/operations','/hub/raccoon/oauth','/hub/raccoon/oauth/begin','/hub/raccoon/oauth/cancel','/hub/raccoon/oauth/paste','/hub/raccoon/oauth/reauth','/hub/raccoon/oauth/status','/hub/scheduler-status','/hub/scheduler/manual','/hub/updates']);
  const {hub}=await fixture(t);
  for(const path of ROUTES.get){const code=await codeOf(call(hub,'GET',path));assert.notEqual(code,'management_operation_not_allowed',`GET ${path} is blocked by the allow-list`);assert.notEqual(code,'unknown_operation',`GET ${path} has no operations handler`);}
  for(const path of ROUTES.post){const code=await codeOf(call(hub,'POST',path,{}));assert.notEqual(code,'management_operation_not_allowed',`POST ${path} is blocked by the allow-list`);assert.notEqual(code,'unknown_operation',`POST ${path} has no operations handler`);assert.notEqual(code,'invalid_account_update',`POST ${path} fell through to the account-update branch`);}
});
test('N4-B the status surface is a GET route; a POST to it and a GET to begin are refused',async t=>{
  const {hub}=await fixture(t);
  assert.equal(await codeOf(call(hub,'GET','/hub/raccoon/oauth/status?sessionId=oauth-0000000000000000')),'raccoon_oauth_session_unknown');
  assert.equal(await codeOf(call(hub,'POST','/hub/raccoon/oauth/status',{})),'management_operation_not_allowed');
  assert.equal(await codeOf(call(hub,'GET','/hub/raccoon/oauth/begin')),'management_operation_not_allowed');
  assert.equal(await codeOf(call(hub,'GET','/hub/raccoon/oauth/paste')),'management_operation_not_allowed');
});
test('N4-C disabling the switch turns every web-authorization route into a 403 through the real worker',async t=>{
  const {hub}=await fixture(t);
  const enabled=await call(hub,'GET','/hub/raccoon/oauth');
  assert.equal(enabled.body?.enabled??enabled.body?.enabled,true);
  await call(hub,'POST','/hub/operations',{raccoonOauth:{enabled:false}});
  for(const path of ROUTES.get)assert.equal(await codeOf(call(hub,'GET',path+(path.endsWith('/status')?'?sessionId=x':''))),'raccoon_oauth_disabled',`GET ${path} was not disabled`);
  for(const path of ROUTES.post)assert.equal(await codeOf(call(hub,'POST',path,{})),'raccoon_oauth_disabled',`POST ${path} was not disabled`);
  await call(hub,'POST','/hub/operations',{raccoonOauth:{enabled:true}});
  assert.equal(await codeOf(call(hub,'GET','/hub/raccoon/oauth')),null);
});
test('N5 the web-authorization switch round-trips through the operations document',async t=>{
  const {hub}=await fixture(t);
  const saved=await call(hub,'POST','/hub/operations',{raccoonOauth:{enabled:false}});
  assert.equal(saved.body.saved??saved.body?.saved,true);
  assert.equal((await call(hub,'GET','/hub/operations')).body?.settings?.raccoonOauth?.enabled,false);
  await call(hub,'POST','/hub/operations',{events:{credentialWarnDays:3}});
  const settings=(await call(hub,'GET','/hub/operations')).body?.settings;
  assert.equal(settings.raccoonOauth.enabled,false,'a shallow merge must not reset the switch');
  assert.equal(settings.events.credentialWarnDays,3);
  assert.equal(await codeOf(call(hub,'POST','/hub/operations',{raccoonOauth:{enabled:'no'}})),'invalid_operations_settings');
  assert.equal(await codeOf(call(hub,'POST','/hub/operations',{raccoonOauth:{enabled:true,bogus:1}})),'invalid_operations_settings');
  assert.equal(await codeOf(call(hub,'POST','/hub/operations',{raccoonOauth:{enabled:true}})),null);
});
test('N1-C no snapshot, status or operations response carries an authorize state or a token',async t=>{
  const {hub}=await fixture(t);
  const begun=await call(hub,'POST','/hub/raccoon/oauth/begin',{});
  const body=begun.body?.body??begun.body;
  assert.ok(typeof body?.authorizeUrl==='string','begin must expose the URL: '+JSON.stringify(begun).slice(0,400));
  assert.match(body.authorizeUrl,/state=[a-f0-9]{64}/);
  const sessionId=body.sessionId;
  const snapshot=JSON.stringify(await hub.snapshot());
  const overview=JSON.stringify((await call(hub,'GET','/hub/raccoon/oauth')).body);
  const status=JSON.stringify((await call(hub,'GET','/hub/raccoon/oauth/status?sessionId='+encodeURIComponent(sessionId))).body);
  for(const payload of [snapshot,overview,status]){
    assert.doesNotMatch(payload,/state=[0-9a-f]{64}/);
    assert.doesNotMatch(payload,/eyJ[A-Za-z0-9_-]{10,}/);
  }
  assert.equal(overview.includes('authorizeUrl'),false);
  assert.equal(status.includes('authorizeUrl'),false);
  await call(hub,'POST','/hub/raccoon/oauth/cancel',{sessionId});
});

test('A-0 a committed web authorization builds its model routes through the real worker',async t=>{
  const {hub,profile}=await fixture(t);
  const claims={name:'SAMPLE 网页授权',sub:'SAMPLE-OAUTH-SUB',exp:Math.floor(Date.now()/1000)+30*86400};
  const token=['SAMPLEHEADER',Buffer.from(JSON.stringify(claims)).toString('base64url'),'SAMPLESIGNATURE'].join('.');
  const saved=(await call(hub,'POST','/hub/raccoon/oauth/paste',{input:token})).body;
  assert.equal(saved.saved,true);
  assert.equal(saved.routeCount,1,'the commit hook refreshes routes before paste returns');
  assert.equal(saved.catalogStatus,'ready');
  const config=JSON.parse(await readFile(join(profile,'config.json'),'utf8'));
  const account=config.accounts.find(item=>item.credentials?.kind==='oauth');
  assert.match(account.id,/^raccoon-oauth-[a-f0-9]{12}$/,'the persisted account keeps its own identifier');
  assert.equal(account.credentials.authKind,'oauth_iam');
  const routes=config.routes.filter(route=>String(route.id).startsWith('oauth-route-'));
  assert.equal(routes.length,1);
  assert.deepEqual(routes[0].targets,[{upstreamId:'up-'+account.id,model:'SAMPLE_OAUTH_MODEL'}]);
  assert.equal(routes[0].name,'小浣熊 · OAuth model');
  const snapshot=await hub.snapshot();
  const summaries=snapshot.operations.discovery.oauthRoutes;
  assert.equal(summaries.length,1,'exactly the committed account is summarised');
  const summary=summaries[0];
  assert.deepEqual({routeCount:summary.routeCount,catalogStatus:summary.catalogStatus},{routeCount:1,catalogStatus:'ready'});
  const settings=(await call(hub,'GET','/hub/operations')).body?.settings;
  assert.equal(settings.discovery.raccoonDesktopReuse,false,'the desktop switch is registered and off by default');
  assert.equal(await codeOf(call(hub,'POST','/hub/operations',{discovery:{raccoonDesktopReuse:'yes'}})),'invalid_discovery_settings');
  assert.equal(await codeOf(call(hub,'POST','/hub/operations',{discovery:{raccoonDesktopReuse:true}})),null);
  const adopted=(await call(hub,'GET','/hub/operations')).body?.settings;
  assert.equal(adopted.discovery.raccoonDesktopReuse,true);
  assert.equal(adopted.raccoonOauth.enabled,true,'saving the discovery section leaves the authorization switch alone');
});

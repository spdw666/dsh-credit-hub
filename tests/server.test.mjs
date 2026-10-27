import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeOptions,assertIsolatedConfig,assertCredentialIsolation,parseManagementRequest,publicValue,boundedPublic,MAX_RPC_BYTES,createHandleMaps,translateIds,publicAccount} from '../server/contracts.mjs';
import {createHubRuntime} from '../server/runtime.mjs';

const taskRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
test('all writable defaults migrate with the independent task root',()=>{
  const root=join(taskRoot,'work','relocated'),o=normalizeOptions({},root);
  assert.equal(o.stateRoot,join(root,'runtime','profile'));assert.equal(o.configFile,join(o.stateRoot,'config.json'));assert.equal(o.engineRoot,join(root,'source','engine'));assert.equal(o.memoryRoot,join(root,'memory'));assert.equal(o.allowScheduler,false);
});
test('predecessor paths and escaped data/credential paths are rejected before writing',()=>{
  const o=normalizeOptions({},taskRoot);
  assert.throws(()=>normalizeOptions({configFile:'D:/AI Memory/AI积分网关-多平台签到与DSH反代/config.json'},taskRoot),{code:'state_path_outside_project'});
  assert.throws(()=>normalizeOptions({memoryRoot:'D:/AI Memory/AI积分网关-多平台签到与DSH反代'},taskRoot),{code:'state_path_outside_project'});
  assert.throws(()=>assertIsolatedConfig({dataDir:'../../../../predecessor-data'},o),{code:'state_path_outside_project'});
  assert.throws(()=>assertIsolatedConfig({dataDir:'./data',accounts:[{credentials:{kind:'file',file:'D:/OLD/account.json'}}]},o),{code:'state_path_outside_project'});
  assert.throws(()=>assertCredentialIsolation({credentials:{file:'auto'}},{},taskRoot),{code:'credential_snapshot_required'});
});
test('only exact management allowlist routes pass; original-client control stays hidden',()=>{
  for(const path of ['/admin/restart-dsh','/admin/shutdown','/admin/workbuddy/accounts/SAMPLE/switch','/admin/workbuddy/sessions/merge','/admin/config','/v1/chat/completions','//evil.example/admin/models','/admin/../admin/models','/admin/%2e%2e/models'])assert.throws(()=>parseManagementRequest({method:'POST',path}));
  assert.equal(parseManagementRequest({path:'/hub/snapshot'}).local,true);
  assert.equal(parseManagementRequest({path:'/admin/models'}).local,false);
  assert.equal(parseManagementRequest({method:'POST',path:'/hub/routes',body:{routeId:'SAMPLE',enabled:false}}).local,true);
  assert.equal(parseManagementRequest({path:'/admin/workbuddy/task-jobs/01234567-0123-0123-0123-0123456789ab'}).local,false);
});
test('public responses omit credential fields and mask identity-bearing text',()=>{
  const value=publicValue({credentials:{file:'secret'},accessToken:'SAMPLE_TOKEN',profile:{uid:'12345678',email:'person@example.com'},label:'person@example.com 13812348000',authorization:'Bearer SAMPLE',safe:{status:'completed'}});
  assert.deepEqual(value.safe,{status:'completed'});const text=JSON.stringify(value);
  for(const secret of ['SAMPLE_TOKEN','person@example.com','13812348000','12345678','Bearer SAMPLE','secret'])assert.equal(text.includes(secret),false);
});
test('RPC request and response sizes are bounded',()=>{
  assert.throws(()=>boundedPublic({text:'x'.repeat(MAX_RPC_BYTES+1)}),{code:'rpc_response_too_large'});
  assert.throws(()=>parseManagementRequest({method:'POST',path:'/admin/claim',body:{text:'x'.repeat(4*1024*1024+1)}}),{code:'rpc_request_too_large'});
});
test('opaque handles preserve identifier roundtrips without translating arbitrary text',()=>{
  const config={accounts:[{id:'13800138000'}],routes:[{id:'route/13800138000/deepseek'}],upstreams:[{id:'upstream/13800138000'}]},maps=createHandleMaps(config);
  const view=translateIds({accountId:config.accounts[0].id,routeId:config.routes[0].id,upstreamId:config.upstreams[0].id},maps);
  assert.match(view.accountId,/^account-[a-f0-9]{12}$/);assert.equal(JSON.stringify(view).includes('13800138000'),false);
  assert.deepEqual(translateIds(view,maps,{toInternal:true}),{accountId:config.accounts[0].id,routeId:config.routes[0].id,upstreamId:config.upstreams[0].id});
  assert.equal(translateIds({label:view.accountId},maps,{toInternal:true}).label,view.accountId);
});
test('account setup states come only from isolated setup and credential snapshot metadata',()=>{
  const file={kind:'file',file:'./data/SAMPLE.json'};
  for(const platform of ['antigravity','opencode']){const a=publicAccount({id:'SAMPLE',platform,credentials:file},0);assert.equal(a.setupRequired,true);assert.equal(a.connectionState,'setup_required');}
  const missing=publicAccount({id:'SAMPLE',platform:'workbuddy',credentials:{kind:'desktop',file:'auto'}},0);assert.equal(missing.setupRequired,true);assert.equal(missing.connectionState,'snapshot_required');
  const copied=publicAccount({id:'SAMPLE',platform:'workbuddy',credentials:file},0);assert.equal(copied.setupRequired,false);assert.equal(copied.connectionState,'not_checked');
  assert.equal(publicAccount({id:'SAMPLE',platform:'freeapi',credentials:{kind:'none'}},0).setupRequired,false);
  assert.equal(publicAccount({id:'SAMPLE',platform:'opencode',credentials:file},0,{blockedKinds:[]}).connectionState,'not_checked');
});

async function fixture(t,{missingEngine=false}={}){
  const parent=join(taskRoot,'work','server-tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'case-'));
  t.after(async()=>{assert.ok(root.startsWith(parent));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  const engine=join(root,'source','engine'),src=join(engine,'src');await mkdir(src,{recursive:true});
  await writeFile(join(engine,'package.json'),JSON.stringify({type:'module',version:'0.6.0'}));
  if(!missingEngine){
    await writeFile(join(src,'service.mjs'),`
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {dirname,resolve} from 'node:path';
export async function createService(file,{schedule}={}){
 const nativeFetch=globalThis.fetch;globalThis.fetch=(url,options)=>{if(String(url).startsWith('http://127.0.0.1:'))return nativeFetch(url,options);throw new Error('UPSTREAM_NETWORK_FORBIDDEN_IN_FIXTURE')};
 const config={file,value:JSON.parse(await readFile(file,'utf8')),dataDir:resolve(file,'..','data'),path:p=>resolve(file,'..',p),async save(value){this.value=value;await writeFile(file,JSON.stringify(value));}};
 const scheduler={stopped:true,start(){this.stopped=false},async stop(){this.stopped=true}};
 const ledger={get(){},records(){return [{status:'already',result:{email:'person@example.com',token:'SAMPLE_LEAK'}}]},usage(){return {records:[],totals:{calls:0}}}};
 return {config,scheduler,ledger,keys:{apiKey:'SAMPLE_PUBLIC_KEY',adminKey:'SAMPLE_PERSISTED_ADMIN'},credentials:{cache:new Map(),account:id=>config.value.accounts.find(a=>a.id===id),async resolve(){throw Error('SHOULD_NOT_RESOLVE_CREDENTIALS')}},platforms:{catalogs:new Map()},router:{models:async()=>({data:config.value.routes.map(r=>({id:r.id,name:r.name}))}),async *chat(input){yield {model:input.model,echoedMessages:input.messages}},relay:{status:()=>({settings:{enabled:true},generationRequests:0})}},async close(){await scheduler.stop()}};
}`);
    await writeFile(join(src,'server.mjs'),`
import http from 'node:http';
export async function startServer(service,{host,port,key,adminKey}){
 const server=http.createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer '+(req.url.startsWith('/v1/')?key:adminKey)){res.writeHead(401);res.end('{}');return;}
  let data='';for await(const c of req)data+=c;
  let body=req.url==='/admin/models'?{data:[{id:'SAMPLE/model'}],token:'SAMPLE_LEAK'}:{observed:true,input:data?JSON.parse(data):null};
  if(req.url==='/v1/chat/completions'){const chunks=[];for await(const chunk of service.router.chat(JSON.parse(data)))chunks.push(chunk);body={chunks};}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));
 });await new Promise(r=>server.listen(port,host,r));return {key,baseUrl:'http://'+host+':'+server.address().port,async close(){server.closeAllConnections();await new Promise(r=>server.close(r))}};
}`);
    await writeFile(join(src,'activity-context.mjs'),`export function buildActivityContext(service){return {schema:1,kpis:{requests:0},items:[]}}`);
  }
  return {root,options:{taskRoot:root,nodeExecutable:process.execPath,startupTimeoutMs:3000,requestTimeoutMs:3000}};
}
test('real standalone worker snapshot is local-only, scheduler is idle, proxy uses private admin key',async t=>{
  const f=await fixture(t),hub=await createHubRuntime(f.options);t.after(()=>hub.close());
  const s=await hub.snapshot();assert.equal(s.title,'积分中枢');assert.equal(s.version,'0.6.0');assert.equal(s.pluginVersion,'0.2.6');assert.equal(s.schedulerRunning,false);assert.deepEqual(s.counts,{accounts:0,platforms:0,routes:0,enabledRoutes:0});assert.equal(JSON.stringify(s).includes('SAMPLE_LEAK'),false);
  const activity=await hub.request({path:'/hub/activity'});assert.equal(activity.body.kpis.requests,0);
  const models=await hub.request({path:'/admin/models'});assert.equal(models.status,200);assert.equal(models.body.data[0].id,'SAMPLE/model');assert.equal('token' in models.body,false);
  const claim=await hub.request({method:'POST',path:'/admin/claim',body:{accountId:'SAMPLE'}});assert.equal(claim.body.observed,true);
  const sched=await hub.request({method:'POST',path:'/hub/scheduler',body:{enabled:true,startup:false}});assert.equal(sched.body.running,true);
  await hub.request({method:'POST',path:'/hub/scheduler',body:{enabled:false}});assert.equal((await hub.snapshot()).schedulerRunning,false);
  await hub.close();assert.equal(hub.status().status,'stopped');assert.equal(hub.runtime.baseUrl,'');
  const config=JSON.parse(await readFile(join(f.root,'runtime','profile','config.json'),'utf8'));assert.equal(config.scheduler.enabled,false);
});
test('startup failure rejects observably instead of returning a successful empty runtime',async t=>{
  const f=await fixture(t,{missingEngine:true});await assert.rejects(createHubRuntime(f.options),{code:'engine_code_invalid',status:424});
});
test('installed read-only engine code may live outside the independent writable state root',async t=>{
  const f=await fixture(t),engineRoot=join(f.root,'source','engine'),stateTaskRoot=join(f.root,'dsh-home','plugins','credit-hub');
  const hub=await createHubRuntime({...f.options,taskRoot:stateTaskRoot,engineRoot});t.after(()=>hub.close());
  assert.equal(hub.options.engineRoot,engineRoot);assert.equal(hub.options.stateRoot,join(stateTaskRoot,'runtime','profile'));
  const s=await hub.snapshot();assert.equal(s.version,'0.6.0');assert.equal(s.schedulerRunning,false);
  await hub.close();
});
test('numeric identity account and route handles update the original configuration and model mapping remains lossless',async t=>{
  const f=await fixture(t),profile=join(f.root,'runtime','profile');await mkdir(profile,{recursive:true});
  const accountId='13800138000',routeId='route/13800138000/deepseek',upstreamId='upstream/13800138000';
  const initial={schemaVersion:1,dataDir:'./data',userFutureSettings:{keep:'unchanged',revision:7},server:{host:'127.0.0.1',port:0,modelRequestTimeouts:{SAMPLE:600000}},scheduler:{enabled:false,startup:false},accounts:[{id:accountId,label:'13800138000 person@example.com',notes:'PRESERVED_USER_NOTE',platform:'workbuddy',enabled:true,credentials:{kind:'file',file:'./data/accounts/SAMPLE.json'}}],routes:[{id:routeId,enabled:true,customFutureField:'PRESERVED_ROUTE_FIELD',targets:[{upstreamId,model:'deepseek'}]}],upstreams:[{id:upstreamId,kind:'workbuddy',accountId}]};
  await writeFile(join(profile,'config.json'),JSON.stringify(initial));const hub=await createHubRuntime(f.options);t.after(()=>hub.close());
  const s=await hub.snapshot();assert.equal(JSON.stringify(s).includes(accountId),false);assert.equal(JSON.stringify(s).includes('person@example.com'),false);
  assert.match(s.accounts[0].id,/^account-/);assert.match(s.routes[0].id,/^route-/);assert.match(s.routes[0].targets[0].upstreamId,/^upstream-/);
  const update=await hub.request({method:'POST',path:'/hub/accounts',body:{accountId:s.accounts[0].id,inferenceEnabled:false}});assert.equal(update.body.account.id,s.accounts[0].id);
  await hub.request({method:'POST',path:'/hub/routes',body:{routeId:s.routes[0].id,enabled:false}});
  const onDisk=JSON.parse(await readFile(join(profile,'config.json'),'utf8'));assert.equal(onDisk.accounts[0].id,accountId);assert.equal(onDisk.accounts[0].inferenceEnabled,false);assert.equal(onDisk.routes[0].id,routeId);assert.equal(onDisk.routes[0].enabled,false);
  assert.deepEqual(onDisk.userFutureSettings,initial.userFutureSettings);assert.deepEqual(onDisk.server,initial.server);assert.equal(onDisk.accounts[0].notes,initial.accounts[0].notes);assert.equal(onDisk.routes[0].customFutureField,initial.routes[0].customFutureField);assert.deepEqual(onDisk.upstreams,initial.upstreams);
  const manual=await hub.request({method:'POST',path:'/admin/claim',body:{accountId:s.accounts[0].id}});assert.equal(manual.body.input.accountId,s.accounts[0].id);
  const messages=[{role:'user',content:s.accounts[0].id},{role:'tool',tool_call_id:'call_'+accountId,content:'PRESERVE_'+accountId}];
  const response=await fetch(hub.runtime.baseUrl+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+hub.runtime.key,'Content-Type':'application/json'},body:JSON.stringify({model:s.routes[0].id,messages})});
  const result=await response.json();assert.equal(result.chunks[0].model,s.routes[0].id);assert.deepEqual(result.chunks[0].echoedMessages,messages);
  await hub.close();
});



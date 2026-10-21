// This module runs only under a standalone Node process, never in Electron.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {attachRuntimeMemory} from './memory.mjs';
import {PLUGIN_VERSION,MAX_RPC_BYTES,assertIsolatedConfig,assertCredentialIsolation,boundedPublic,publicAccount,hubError,normalizeOptions,requireWithin,createHandleMaps,translateIds,validateEngineRoot} from './contracts.mjs';
import {isAccountExportRequest,validateAccountExportRequest,engineAccountExportResponse} from './transfer.mjs';
import {createHubOperations} from './operations.mjs';
import {schedulerActivation,shouldStartScheduler} from './scheduler-activation.mjs';
import {removeHubAccount} from './account-removal.mjs';
import {probeIsolatedCredential} from './discovery.mjs';

const incoming=JSON.parse(process.argv[2]??'{}');
const options=normalizeOptions(incoming,incoming.taskRoot);
// Set before dynamic import: model-audit captures this value at module load.
process.env.AI_CREDIT_MEMORY=options.memoryRoot;
delete process.env.ELECTRON_RUN_AS_NODE;delete process.env.NODE_OPTIONS;delete process.env.DSH_DESKTOP_NODE_EXECUTABLE;
let service,listener,closing=false,workerReady=false,coreVersion,buildActivityContext,privateAdminKey,stopMemory,operations,cleanupFlight=Promise.resolve();
const maps=()=>createHandleMaps(service.config.value);
const publish=value=>boundedPublic(translateIds(value,maps()));
const send=message=>{if(process.connected)process.send?.(message);};
const problem=error=>({code:error.code??'hub_worker_error',message:error.message??'Worker operation failed',status:error.status??500});
function defaultConfig(){return {schemaVersion:1,dataDir:'./data',server:{host:'127.0.0.1',port:0,allowRemote:false,requestTimeoutMs:180000,bodyLimitBytes:67108864},scheduler:{enabled:false,startup:false,timezone:'Asia/Shanghai',hour:10,minute:0,jitterSeconds:600,retryMinutes:60},workbuddy:{autoMigrateSessions:false,autoTasks:false},clientUpdates:{enabled:false},accounts:[],upstreams:[],routes:[]};}
function routeView(route){return {id:route.id,name:route.name??route.id,enabled:route.enabled!==false,targetCount:route.targets?.length??0,targets:(route.targets??[]).map(({model,upstreamId})=>({model,upstreamId}))};}
const accountView=(account,index)=>publicAccount(account,index,{blockedKinds:service.config.value.pluginIsolation?.blockedUpstreamKinds??['antigravity','opencode']});
function snapshot(){
  const c=service.config.value,accounts=c.accounts.map(accountView),routes=c.routes.map(routeView),usage=service.ledger.usage({limit:100});
  const cache=service.balanceCache instanceof Map?[...service.balanceCache.entries()].map(([accountId,value])=>({accountId,...value})):[];
  return publish({title:'积分中枢',version:coreVersion,pluginVersion:PLUGIN_VERSION,checkedAt:new Date().toISOString(),counts:{accounts:accounts.length,platforms:new Set(accounts.map(a=>a.platform)).size,routes:routes.length,enabledRoutes:routes.filter(r=>r.enabled).length},accounts,routes,audit:service.ledger.get('model-audit')??{status:'not_started',results:[]},records:service.ledger.records({limit:100}),usage,relay:service.router.relay.status(),balances:cache,schedule:{settings:c.scheduler,plan:service.ledger.get('schedule-plan')??null,lastRun:service.ledger.get('schedule-last')??null,status:service.scheduler.status?.()??null},operations:operations?.snapshot()??null,schedulerRunning:!service.scheduler.stopped,worker:{pid:process.pid,nodeVersion:process.version}});
}
async function mutate(operation,body){
  if(!body||typeof body!=='object'||Array.isArray(body))throw hubError('invalid_management_body','An object is required');
  if(operation==='/hub/accounts/remove'){
    if(Object.keys(body).some(k=>!['accountId','confirm'].includes(k))||typeof body.accountId!=='string')throw hubError('invalid_account_delete','accountId and confirm are required');
    return removeHubAccount(service,body.accountId,{confirm:body.confirm,taskRoot:options.taskRoot,resolvePrincipal:account=>probeIsolatedCredential(account,{engineRoot:options.engineRoot,dataDir:service.config.dataDir,allowExpired:true})});
  }
  const value=structuredClone(service.config.value);
  if(operation==='/hub/scheduler'){
    const allowed=new Set(['enabled','startup','timezone','hour','minute','jitterSeconds','retryMinutes','windows','maxConcurrency','startupSpreadSeconds']);
    if(Object.keys(body).some(k=>!allowed.has(k)))throw hubError('invalid_scheduler_setting','Unknown scheduler setting');
    value.scheduler=schedulerActivation(value.scheduler,body);await service.config.save(value);
    if(value.scheduler.enabled)service.scheduler.start();else await service.scheduler.stop();
    return {saved:true,settings:service.config.value.scheduler,running:!service.scheduler.stopped};
  }
  if(operation==='/hub/routes'){
    if(Object.keys(body).some(k=>!['routeId','enabled'].includes(k))||typeof body.enabled!=='boolean')throw hubError('invalid_route_update','routeId and boolean enabled are required');
    const route=value.routes.find(r=>r.id===body.routeId);if(!route)throw hubError('route_not_found','Route not found',404);route.enabled=body.enabled;await service.config.save(value);service.platforms.catalogs.clear();return {saved:true,route:routeView(route)};
  }
  if(Object.keys(body).some(k=>!['accountId','enabled','inferenceEnabled','label'].includes(k)))throw hubError('invalid_account_update','Unknown account setting');
  const account=value.accounts.find(a=>a.id===body.accountId);if(!account)throw hubError('account_not_found','Account not found',404);
  for(const key of ['enabled','inferenceEnabled'])if(body[key]!==undefined){if(typeof body[key]!=='boolean')throw hubError('invalid_account_update',key+' must be boolean');account[key]=body[key];}
  if(body.label!==undefined){if(typeof body.label!=='string'||!body.label.trim()||body.label.length>128)throw hubError('invalid_account_update','label must contain 1-128 characters');account.label=body.label.trim();}
  await service.config.save(value);service.credentials.cache.clear();service.platforms.catalogs.clear();return {saved:true,account:accountView(account,value.accounts.indexOf(account))};
}
async function localRequest(request){
  if(['/hub/operations','/hub/discovery','/hub/updates','/hub/events','/hub/events/pending','/hub/events/ack','/hub/events/test','/hub/forecast','/hub/scheduler-status','/hub/scheduler/manual'].includes(request.pathname))return {status:200,body:publish(await operations.request({...request,body:translateIds(request.body,maps(),{toInternal:true})}))};
  if(request.method==='POST')return {status:200,body:publish(await operations.withMutation(()=>mutate(request.pathname,translateIds(request.body,maps(),{toInternal:true}))))};
  const current=snapshot();let body;
  switch(request.pathname){case '/hub/accounts':body={accounts:current.accounts};break;case '/hub/routes':body={routes:current.routes};break;case '/hub/audit':body=current.audit;break;case '/hub/activity':body=buildActivityContext(service,request.query);break;case '/hub/scheduler':body={...current.schedule,running:current.schedulerRunning};break;default:body=current;}
  return {status:200,body:publish(body)};
}
async function managementRequest(request){
  const handles=maps(),url=new URL(request.path,'http://hub.local');
  const exporting=isAccountExportRequest(request);
  if(exporting){const selection=validateAccountExportRequest(request.body);for(const handle of selection.accountIds){const internal=handles.reverse.get(handle),account=service.config.value.accounts.find(item=>item.id===internal&&item.platform==='workbuddy');if(!account)throw hubError('account_not_found','The export selection contains an unknown WorkBuddy account',404);assertCredentialIsolation(account,service.config,options.taskRoot);}}
  url.pathname=url.pathname.split('/').map(part=>handles.reverse.get(part)??part).map(encodeURIComponent).join('/');
  for(const [key,value] of url.searchParams)url.searchParams.set(key,translateIds(value,handles,{toInternal:true,key}));
  const body=translateIds(request.body,handles,{toInternal:true});
  if(request.method==='POST'&&request.pathname==='/admin/claim'&&typeof service.scheduler.manual==='function')return {status:200,body:publish(await service.scheduler.manual({accountIds:body?.accountId?[body.accountId]:body?.accountIds,taskId:body?.taskId,missingOnly:false}))};
  const response=await fetch(listener.baseUrl+url.pathname+url.search,{method:request.method,headers:{Authorization:'Bearer '+privateAdminKey,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(options.requestTimeoutMs),redirect:'error'});
  let bytes=0;const chunks=[];for await(const chunk of response.body){bytes+=chunk.length;if(bytes>MAX_RPC_BYTES)throw hubError('rpc_response_too_large','Management response exceeds the 2 MiB limit',413);chunks.push(chunk);}
  let result;try{result=JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));}catch{throw hubError('invalid_worker_response','Plugin worker returned invalid JSON',502);}
  if(exporting&&response.status===200)return engineAccountExportResponse(result,request);
  return {status:response.status,body:publish(result)};
}
const assertStarting=()=>{if(closing)throw hubError('worker_stopped','Plugin worker stopped during startup',503);};
function cleanupResources(){
  // A factory awaited during startup can finish after shutdown began. Drain
  // again when that factory returns, without closing any resource twice.
  cleanupFlight=cleanupFlight.catch(()=>{}).then(async()=>{
    let failure;const finish=async operation=>{try{await operation?.();}catch(error){failure??=error;}};
    const memory=stopMemory;stopMemory=null;await finish(memory);
    const ops=operations;operations=null;await finish(ops?()=>ops.close():null);
    const server=listener;listener=null;await finish(server?()=>server.close():null);
    const core=service;service=null;await finish(core?()=>core.close():null);
    if(failure)throw failure;
  });
  return cleanupFlight;
}
async function close(code=0){if(closing)return;closing=true;workerReady=false;try{await cleanupResources();process.exitCode=code;}catch{process.exitCode=1;}finally{if(process.connected)process.disconnect?.();}}
process.on('disconnect',()=>void close());process.on('SIGTERM',()=>void close());
process.on('message',message=>{
  if(message?.type==='shutdown'){void close();return;}
  // The host watchdog probes only this local event loop. Do not touch account
  // state or any upstream, and never echo arbitrary IPC fields or credentials.
  if(message?.type==='heartbeat'){
    const id=message.id,validId=typeof id==='string'&&id.length>0&&id.length<=128||Number.isSafeInteger(id)&&id>=0;
    if(workerReady&&service&&listener&&!closing&&validId)send({type:'heartbeat',id,ready:true});
    return;
  }
  if(message?.type!=='request'||!service||closing)return;
  void(async()=>{try{const result=message.operation==='snapshot'?snapshot():message.operation==='models'?publish(await service.router.models()):message.operation==='managementRequest'?await managementRequest(message.request):await localRequest(message.request);send({type:'response',id:message.id,result});}catch(error){send({type:'response',id:message.id,error:boundedPublic(problem(error))});}})();
});
try{
  await validateEngineRoot(options.engineRoot);assertStarting();
  await Promise.all([mkdir(options.stateRoot,{recursive:true}),mkdir(options.memoryRoot,{recursive:true}),mkdir(options.logRoot,{recursive:true}),mkdir(dirname(options.configFile),{recursive:true})]);assertStarting();
  let raw;try{raw=JSON.parse(await readFile(options.configFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;assertStarting();raw=defaultConfig();await writeFile(options.configFile,JSON.stringify(raw,null,2)+'\n',{flag:'wx',mode:0o600});}assertStarting();
  assertIsolatedConfig(raw,options);
  let environment={};try{environment=JSON.parse(await readFile(join(options.stateRoot,'environment.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}assertStarting();
  for(const [key,fallback] of [['APPDATA',join(options.stateRoot,'appdata','roaming')],['LOCALAPPDATA',join(options.stateRoot,'appdata','local')]]){
    const directory=requireWithin(options.taskRoot,environment[key]??fallback,key);await mkdir(directory,{recursive:true});assertStarting();process.env[key]=directory;
  }
  if(environment.QWENWORK_PYTHON)process.env.QWENWORK_PYTHON=requireWithin(options.taskRoot,environment.QWENWORK_PYTHON,'QWENWORK_PYTHON');
  process.env.PYTHONDONTWRITEBYTECODE='1';
  const modulePath=name=>pathToFileURL(join(options.engineRoot,'src',name)).href;
  const [{createService},{startServer},activity]=await Promise.all([import(modulePath('service.mjs')),import(modulePath('server.mjs')),import(modulePath('activity-context.mjs'))]);assertStarting();buildActivityContext=activity.buildActivityContext;
  coreVersion=JSON.parse(await readFile(join(options.engineRoot,'package.json'),'utf8')).version;assertStarting();
  service=await createService(options.configFile,{schedule:false});assertStarting();
  const save=service.config.save.bind(service.config);service.config.save=async value=>save(assertIsolatedConfig(value,options));
  const guardKind=kind=>{if((service.config.value.pluginIsolation?.blockedUpstreamKinds??['antigravity','opencode']).includes(kind))throw hubError('isolated_upstream_setup_required','This upstream needs independent plugin setup before use',409);};
  const guardAccount=id=>{const account=service.credentials.account(id);guardKind(account?.platform);assertCredentialIsolation(account,service.config,options.taskRoot);return account;};
  const resolveCredential=service.credentials.resolve.bind(service.credentials);service.credentials.resolve=(id,...args)=>{guardAccount(id);return resolveCredential(id,...args);};
  for(const name of ['models','fetchModels'])if(typeof service.platforms[name]==='function'){const original=service.platforms[name].bind(service.platforms);service.platforms[name]=(id,...args)=>{guardKind(service.config.value.upstreams.find(u=>u.id===id)?.kind);return original(id,...args);};}
  for(const name of ['health','status','claim'])if(typeof service.platforms[name]==='function'){const original=service.platforms[name].bind(service.platforms);service.platforms[name]=(id,...args)=>{guardAccount(id);return original(id,...args);};}
  if(typeof service.platforms.chat==='function'){const chat=service.platforms.chat.bind(service.platforms);service.platforms.chat=(target,...args)=>{guardKind(service.config.value.upstreams.find(u=>u.id===target.upstreamId)?.kind);return chat(target,...args);};}
  // Public model selectors use opaque route handles; only the top-level model
  // identifier is translated. Messages, tools and tool results remain untouched.
  if(typeof service.router.chat==='function'){const chat=service.router.chat.bind(service.router);service.router.chat=async function*(input,...args){const current=maps(),original=current.reverse.get(input.model)??input.model;for await(const chunk of chat({...input,model:original},...args))yield {...chunk,...(chunk.model?{model:current.routes.get(chunk.model)??chunk.model}:{})};};}
  privateAdminKey=randomBytes(32).toString('hex');
  listener=await startServer(service,{host:'127.0.0.1',port:0,key:randomBytes(32).toString('hex'),adminKey:privateAdminKey,admin:true});assertStarting();
  let descriptor={};try{descriptor=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));}catch{}assertStarting();
  operations=await createHubOperations({service,options,descriptor,hostEnvironment:options.hostEnvironment??{}});assertStarting();
  operations.start();
  // The independent plugin owns its scheduler. Installation remains idle.
  if(shouldStartScheduler(options,service.config.value.scheduler))service.scheduler.start();
  stopMemory=await attachRuntimeMemory({taskRoot:options.taskRoot,memoryRoot:options.memoryRoot,configFile:options.configFile,summary:()=>{const s=snapshot();return {pluginVersion:PLUGIN_VERSION,coreVersion,counts:s.counts,schedulerRunning:s.schedulerRunning,workerPid:process.pid}}});assertStarting();
  // A shutdown received during asynchronous startup must not advertise a new
  // ready generation or answer a heartbeat after its closing transition.
  if(!closing){workerReady=true;send({type:'ready',baseUrl:listener.baseUrl,key:listener.key,adminKey:privateAdminKey,coreVersion,pluginVersion:PLUGIN_VERSION,pid:process.pid,nodeVersion:process.version});}
  // startServer's provided admin key is distinct from persisted service keys.
}catch(error){
  if(closing){try{await cleanupResources();}catch{process.exitCode=1;}}
  else{send({type:'error',error:boundedPublic(problem(error))});console.error(JSON.stringify(problem(error)));await close(1);}
}

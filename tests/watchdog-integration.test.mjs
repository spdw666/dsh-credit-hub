import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHubRuntime} from '../server/runtime.mjs';
import {createCreditHubAdapter,providerId} from '../plugin/provider.mjs';

const modelId='SAMPLE/integration-model';
const sampleOptions=()=>({provider:providerId,model:modelId,messages:[{role:'user',content:[{type:'text',text:'SAMPLE integration request'}]}],maxTokens:31});
const collect=async stream=>{
  const chunks=await Array.fromAsync(stream),finish=chunks.find(chunk=>chunk.type==='finish');
  assert.ok(finish,'a SAMPLE generation must settle');assert.equal(finish.reason?.failure,undefined);
  return chunks.filter(chunk=>chunk.type==='text-delta').map(chunk=>chunk.text).join('');
};
async function lines(file){try{return (await readFile(file,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))}catch(error){if(error.code==='ENOENT')return [];throw error}}
function nextGeneration(hub,generation,{timeoutMs=10000}={}){
  if(hub.runtime.generation>generation)return Promise.resolve({...hub.runtime});
  return new Promise((resolve,reject)=>{
    const unsubscribe=hub.onReady(runtime=>{if(runtime.generation>generation){clearTimeout(timer);unsubscribe();resolve(runtime)}});
    const timer=setTimeout(()=>{unsubscribe();reject(Error('SAMPLE integration generation recovery timeout: '+JSON.stringify(hub.status())))},timeoutMs);
  });
}
async function fixture(t,{failFirst=false}={}){
  const parent=fileURLToPath(new URL('../work/watchdog-integration-tests/',import.meta.url));await mkdir(parent,{recursive:true});
  const root=await mkdtemp(join(parent,'SAMPLE-')),engine=join(root,'source/engine'),src=join(engine,'src');await mkdir(src,{recursive:true});
  let hub,native;
  t.after(async()=>{
    native?.dispose();await hub?.close();
    const actual=await realpath(root),base=await realpath(parent),inside=relative(base,actual);
    assert.ok(inside&&inside!=='..'&&!inside.startsWith('..\\')&&!inside.startsWith('../')&&!isAbsolute(inside));
    await rm(actual,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  });
  await writeFile(join(engine,'package.json'),JSON.stringify({type:'module',version:'0.0.0'}));
  await writeFile(join(src,'service.mjs'),`
import {readFile,writeFile,appendFile} from 'node:fs/promises';import {resolve,dirname,join} from 'node:path';
export async function createService(file){
 const nativeFetch=globalThis.fetch;globalThis.fetch=(url,options)=>{if(String(url).startsWith('http://127.0.0.1:'))return nativeFetch(url,options);throw Error('SAMPLE_UPSTREAM_NETWORK_FORBIDDEN')};
 const attemptsFile=join(dirname(file),'SAMPLE-startups.jsonl'),callsFile=join(dirname(file),'SAMPLE-generations.jsonl');
 let prior='';try{prior=await readFile(attemptsFile,'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
 const attempt=prior.trim().split('\\n').filter(Boolean).length+1;
 await appendFile(attemptsFile,JSON.stringify({pid:process.pid,attempt,firstFailure:${failFirst}&&attempt===1})+'\\n');
 if(${failFirst}&&attempt===1)throw Object.assign(Error('SAMPLE first engine startup fails once'),{code:'SAMPLE_FIRST_STARTUP_FAILURE'});
 const config={file,value:JSON.parse(await readFile(file,'utf8')),dataDir:resolve(file,'..','data'),path:p=>resolve(file,'..',p),async save(value){this.value=value;await writeFile(file,JSON.stringify(value))}};
 const scheduler={stopped:true,start(){throw Error('SAMPLE_SCHEDULER_FORBIDDEN')},async stop(){this.stopped=true}};
 return {config,scheduler,ledger:{get(){},records(){return []},usage(){return {records:[],totals:{calls:0}}}},credentials:{cache:new Map(),account(){throw Error('SAMPLE_NO_ACCOUNTS')},async resolve(){throw Error('SAMPLE_CREDENTIAL_ACCESS_FORBIDDEN')}},platforms:{catalogs:new Map()},router:{
  models:async()=>({data:[{id:${JSON.stringify(modelId)},name:'SAMPLE integration model',contextWindow:32768,maxTokens:4096}]}),
  async *chat(input){
   await appendFile(callsFile,JSON.stringify({pid:process.pid,model:input.model,messages:input.messages,maxTokens:input.max_completion_tokens??input.max_tokens})+'\\n');
   const common={id:'SAMPLE-response-'+process.pid,object:'chat.completion.chunk',created:1,model:input.model};
   yield {...common,choices:[{index:0,delta:{role:'assistant',content:'SAMPLE worker '+process.pid},finish_reason:null}]};
   yield {...common,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};
  },relay:{status:()=>({})}
 },async close(){await scheduler.stop()}};
}`);
  await writeFile(join(src,'server.mjs'),`
import http from 'node:http';
export async function startServer(service,{host,port,key,adminKey}){
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.headers.authorization!=='Bearer '+(req.url.startsWith('/v1/')?key:adminKey)){res.writeHead(401);res.end('{}');return}
   if(req.method==='POST'&&req.url==='/__SAMPLE__/hang'){
    res.writeHead(200,{'content-type':'text/plain'});res.end('SAMPLE_HANG_ARMED');
    // This private fixture endpoint exists only in this mkdtemp SAMPLE engine.
    // It stalls the real worker event loop; the host watchdog must replace it.
    setTimeout(()=>{for(;;){}},30);return;
   }
   if(req.method==='GET'&&req.url==='/admin/models'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(await service.router.models()));return}
   if(req.method==='POST'&&req.url==='/v1/chat/completions'){
    let text='';for await(const part of req)text+=part;
    res.writeHead(200,{'content-type':'text/event-stream'});
    for await(const chunk of service.router.chat(JSON.parse(text)))res.write('data: '+JSON.stringify(chunk)+'\\n\\n');
    res.end('data: [DONE]\\n\\n');return;
   }
   res.writeHead(404);res.end('{}');
  }catch{if(!res.headersSent)res.writeHead(500);res.end('{}')}
 });
 await new Promise(resolve=>server.listen(port,host,resolve));
 return {key,baseUrl:'http://'+host+':'+server.address().port,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}};
}`);
  await writeFile(join(src,'activity-context.mjs'),'export function buildActivityContext(){return {items:[]}}');
  hub=await createHubRuntime({taskRoot:root,engineRoot:engine,nodeExecutable:process.execPath,startupTimeoutMs:5000,requestTimeoutMs:5000,readyWaitTimeoutMs:10000,allowScheduler:false,enableBackgroundOperations:false,hostEnvironment:{HOME:join(root,'SAMPLE-home'),USERPROFILE:join(root,'SAMPLE-home'),USERNAME:'SAMPLE',APPDATA:join(root,'SAMPLE-appdata'),LOCALAPPDATA:join(root,'SAMPLE-local'),PUBLIC:join(root,'SAMPLE-public')},watchdog:{heartbeatIntervalMs:120,heartbeatTimeoutMs:350,heartbeatFailures:3,restartBaseMs:20,restartMaxMs:100,jitterRatio:0,stableResetMs:1000,restartWindowMs:10000,maxRestarts:10,cooldownMs:100,shutdownGraceMs:150,resumeGraceMs:250}});
  native=createCreditHubAdapter({hub,minimumRefreshMs:3600000,readyTimeoutMs:10000});
  return {root,hub,native,startups:()=>lines(join(root,'runtime/profile/SAMPLE-startups.jsonl')),calls:()=>lines(join(root,'runtime/profile/SAMPLE-generations.jsonl'))};
}

test('real runtime + real worker + native provider recover first startup failure and a killed child without replay', {timeout:25000},async t=>{
  const f=await fixture(t,{failFirst:true}),{hub,native}=f;
  const prepared=await native.adapter.prepareCall(providerId,modelId),first={...hub.runtime},firstPid=hub.workerPid;
  assert.equal(await collect(prepared.stream(sampleOptions())),'SAMPLE worker '+firstPid);
  const startups=await f.startups();assert.ok(startups.length>=2);assert.equal(startups[0].firstFailure,true);assert.ok(startups.some(row=>row.pid===firstPid));
  assert.ok(hub.status().startupAttempts>=2);assert.equal(hub.status().status,'ready');
  const oldPrepared=await native.adapter.prepareCall(providerId,modelId),ready=nextGeneration(hub,first.generation);
  assert.equal(hub.status().pid,firstPid);assert.ok(Number.isSafeInteger(firstPid)&&firstPid>0&&firstPid!==process.pid);
  // Only this runtime's recorded fixture child is killed, never a host process.
  process.kill(firstPid,'SIGKILL');
  const second=await ready,secondPid=hub.workerPid;assert.ok(second.generation>first.generation);assert.notEqual(secondPid,firstPid);assert.notEqual(second.key,first.key);
  await assert.rejects(Array.fromAsync(oldPrepared.stream(sampleOptions())),error=>error.code==='hub_call_stale'&&error.status===503&&error.beforeUpstream===true);
  assert.equal((await f.calls()).length,1,'stale prepared call must not hit either worker');
  const reconnected=await native.adapter.prepareCall(providerId,modelId);
  assert.equal(await collect(reconnected.stream(sampleOptions())),'SAMPLE worker '+secondPid);
  assert.equal(native.adapter.config.profiles().get(providerId).piProvider.getModels()[0].baseUrl,second.baseUrl+'/v1');
  const calls=await f.calls();assert.equal(calls.length,2);assert.deepEqual(calls.map(call=>call.pid),[firstPid,secondPid]);assert.ok(calls.every(call=>call.model===modelId&&call.maxTokens===31));
  assert.equal(hub.status().status,'ready');assert.ok(hub.status().restarts>=2);
});

test('real worker event-loop hang is detected by local heartbeat and new SAMPLE streams reconnect automatically', {timeout:25000},async t=>{
  const f=await fixture(t),{hub,native}=f;
  assert.equal(await collect(native.adapter.stream(sampleOptions())),'SAMPLE worker '+hub.workerPid);
  const before={...hub.runtime},beforePid=hub.workerPid,oldPrepared=await native.adapter.prepareCall(providerId,modelId),ready=nextGeneration(hub,before.generation);
  const response=await fetch(before.baseUrl+'/__SAMPLE__/hang',{method:'POST',headers:{Authorization:'Bearer '+before.adminKey},signal:AbortSignal.timeout(5000)});
  assert.equal(response.status,200);assert.equal(await response.text(),'SAMPLE_HANG_ARMED');
  const after=await ready,afterPid=hub.workerPid;assert.ok(after.generation>before.generation);assert.notEqual(afterPid,beforePid);assert.notEqual(after.key,before.key);
  await assert.rejects(Array.fromAsync(oldPrepared.stream(sampleOptions())),error=>error.code==='hub_call_stale'&&error.status===503);
  assert.equal(await collect(native.adapter.stream(sampleOptions())),'SAMPLE worker '+afterPid);
  const calls=await f.calls();assert.equal(calls.length,2);assert.deepEqual(calls.map(call=>call.pid),[beforePid,afterPid]);
  const log=await readFile(join(f.root,'runtime/logs/credit-hub-worker.log'),'utf8');assert.match(log,/worker_heartbeat_timeout/);
  const snapshot=await hub.snapshot();assert.equal(snapshot.counts.accounts,0);assert.equal(snapshot.schedulerRunning,false);assert.equal(hub.status().status,'ready');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const worker=fileURLToPath(new URL('../server/worker.mjs',import.meta.url));

// The real worker runs against a local-only SAMPLE engine. The fixture has no
// accounts, discovery is stopped, and its fetch guard rejects every network call.
async function fixture(t,{holdStartup=false,startupDelayMs=0,listenerDelayMs=0}={}){
  const parent=join(project,'work/watchdog-worker-tests');await mkdir(parent,{recursive:true});
  const root=await mkdtemp(join(parent,'SAMPLE-')),engine=join(root,'source/engine'),src=join(engine,'src');await mkdir(src,{recursive:true});
  await writeFile(join(engine,'package.json'),JSON.stringify({type:'module',version:'0.0.0'}));
  await writeFile(join(src,'service.mjs'),`
import {readFile,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
export async function createService(file){
 globalThis.fetch=()=>{throw Error('SAMPLE_NETWORK_FORBIDDEN')};
 if(${holdStartup})await new Promise(resolve=>{const resume=message=>{if(message?.type==='SAMPLE-resume-startup'){process.off('message',resume);resolve();}};process.on('message',resume);process.send?.({type:'SAMPLE-starting'});});
 if(${startupDelayMs}){process.send?.({type:'SAMPLE-starting'});await new Promise(r=>setTimeout(r,${startupDelayMs}));}
 const config={file,value:JSON.parse(await readFile(file,'utf8')),dataDir:resolve(file,'..','data'),path:p=>resolve(file,'..',p),async save(value){this.value=value;await writeFile(file,JSON.stringify(value));}};
 const scheduler={stopped:true,start(){throw Error('SAMPLE_SCHEDULER_FORBIDDEN')},async stop(){this.stopped=true}};
 let closes=0;return {config,scheduler,ledger:{get(){},records(){return []},usage(){return {records:[],totals:{calls:0}}}},credentials:{cache:new Map(),account(){throw Error('SAMPLE_NO_ACCOUNTS')},resolve(){throw Error('SAMPLE_CREDENTIAL_ACCESS_FORBIDDEN')}},platforms:{catalogs:new Map()},router:{models:async()=>({data:[]}),relay:{status:()=>({})}},async close(){await scheduler.stop();await writeFile(${JSON.stringify(join(root,'SAMPLE-service-close.json'))},JSON.stringify({closes:++closes}));}};
}`);
  await writeFile(join(src,'server.mjs'),`
import http from 'node:http';import {writeFile} from 'node:fs/promises';
export async function startServer(_service,{host,port,key}){
 const server=http.createServer((_req,res)=>{res.writeHead(503);res.end('SAMPLE_NO_REQUESTS')});
 await new Promise(r=>server.listen(port,host,r));
 const baseUrl='http://'+host+':'+server.address().port;
 if(${listenerDelayMs}){process.send?.({type:'SAMPLE-listening',baseUrl});await new Promise(r=>setTimeout(r,${listenerDelayMs}));}
 let closes=0;return {key,baseUrl,async close(){server.closeAllConnections();await new Promise(r=>server.close(r));await writeFile(${JSON.stringify(join(root,'SAMPLE-listener-close.json'))},JSON.stringify({closes:++closes}));}};
}`);
  await writeFile(join(src,'activity-context.mjs'),'export function buildActivityContext(){return {items:[]}}');
  const options={taskRoot:root,engineRoot:engine,enableBackgroundOperations:false,allowScheduler:false,hostEnvironment:{HOME:join(root,'SAMPLE-home'),USERPROFILE:join(root,'SAMPLE-home'),USERNAME:'SAMPLE',APPDATA:join(root,'SAMPLE-appdata'),LOCALAPPDATA:join(root,'SAMPLE-local'),PUBLIC:join(root,'SAMPLE-public')}};
  const child=fork(worker,[JSON.stringify(options)],{execPath:process.execPath,execArgv:[],stdio:['ignore','pipe','pipe','ipc']});
  const messages=[];let stderr='';child.on('message',message=>messages.push(message));child.stderr.on('data',chunk=>stderr+=chunk);child.stdout.resume();
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  const send=message=>new Promise(resolve=>{if(!child.connected)return resolve();child.send(message,()=>resolve());});
  async function waitFor(predicate){
    const found=messages.find(predicate);if(found)return found;
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);child.off('message',receive);child.off('exit',exit);};
      const receive=message=>{if(predicate(message)){cleanup();resolve(message);}};
      const exit=()=>{cleanup();reject(Error('SAMPLE_WORKER_EXITED_BEFORE_RESPONSE: '+stderr));};
      const timer=setTimeout(()=>{cleanup();reject(Error('SAMPLE_WORKER_RESPONSE_TIMEOUT: '+stderr));},5000);
      child.on('message',receive);child.on('exit',exit);
    });
  }
  t.after(async()=>{
    if(child.exitCode===null&&child.signalCode===null){await send({type:'shutdown'});await Promise.race([exited,new Promise(r=>setTimeout(r,1000))]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
    assert.ok(relative(parent,root)&&!relative(parent,root).startsWith('..'));
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  });
  return {root,child,messages,send,waitFor,exited,get stderr(){return stderr}};
}

const exitWithin=async f=>{let timer;try{return await Promise.race([f.exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('SAMPLE_WORKER_DID_NOT_CLOSE_AFTER_STARTUP_CANCELLATION')),1500);})]);}finally{clearTimeout(timer);}};

test('real worker heartbeats are silent before readiness and echo exact IDs only after readiness',async t=>{
  const f=await fixture(t,{holdStartup:true});await f.waitFor(message=>message.type==='SAMPLE-starting');
  await f.send({type:'heartbeat',id:'SAMPLE-before-ready'});
  await f.send({type:'SAMPLE-resume-startup'});
  await f.waitFor(message=>message.type==='ready');
  assert.equal(f.messages.some(message=>message.type==='heartbeat'),false);
  for(const id of ['SAMPLE-heartbeat-1',0,Number.MAX_SAFE_INTEGER,'x'.repeat(128)]){
    await f.send({type:'heartbeat',id,key:'SAMPLE_NOT_ECHOED',adminKey:'SAMPLE_NOT_ECHOED'});
    assert.deepEqual(await f.waitFor(message=>message.type==='heartbeat'&&message.id===id),{type:'heartbeat',id,ready:true});
  }
});

test('real worker ignores malformed or oversized heartbeat IDs without echoing private fields',async t=>{
  const f=await fixture(t);await f.waitFor(message=>message.type==='ready');
  for(const id of [null,{},[],true,'','x'.repeat(129),-1,0.25,Number.MAX_SAFE_INTEGER+1])await f.send({type:'heartbeat',id});
  await f.send({type:'heartbeat'});await f.send({type:'heartbeat',id:'SAMPLE-barrier',authorization:'SAMPLE_NOT_ECHOED'});
  await f.waitFor(message=>message.type==='heartbeat'&&message.id==='SAMPLE-barrier');
  assert.deepEqual(f.messages.filter(message=>message.type==='heartbeat'),[{type:'heartbeat',id:'SAMPLE-barrier',ready:true}]);
});

test('real worker stops reporting heartbeat readiness after shutdown and closes normally',async t=>{
  const f=await fixture(t);await f.waitFor(message=>message.type==='ready');
  await f.send({type:'shutdown'});await f.send({type:'heartbeat',id:'SAMPLE-after-shutdown'});
  assert.deepEqual(await f.exited,{code:0,signal:null});
  assert.equal(f.messages.some(message=>message.type==='heartbeat'&&message.id==='SAMPLE-after-shutdown'),false);
  assert.equal(f.stderr,'');
});

test('real worker closes when its host IPC disconnects without a second disconnect error',async t=>{
  const f=await fixture(t);await f.waitFor(message=>message.type==='ready');
  f.child.disconnect();
  assert.deepEqual(await f.exited,{code:0,signal:null});
  assert.equal(f.stderr,'');
});

test('shutdown while the service factory awaits closes its later resource once and never starts a listener',async t=>{
  const f=await fixture(t,{startupDelayMs:150});await f.waitFor(message=>message.type==='SAMPLE-starting');
  await f.send({type:'shutdown'});
  assert.deepEqual(await exitWithin(f),{code:0,signal:null});
  assert.deepEqual(JSON.parse(await readFile(join(f.root,'SAMPLE-service-close.json'),'utf8')),{closes:1});
  await assert.rejects(readFile(join(f.root,'SAMPLE-listener-close.json')),{code:'ENOENT'});
  assert.equal(f.messages.some(message=>message.type==='ready'||message.type==='error'),false);
  assert.equal(f.stderr,'');
});

test('shutdown while the listener factory awaits drains its late listener and closes each resource once',async t=>{
  const f=await fixture(t,{listenerDelayMs:150}),opened=await f.waitFor(message=>message.type==='SAMPLE-listening');
  await f.send({type:'shutdown'});
  assert.deepEqual(await exitWithin(f),{code:0,signal:null});
  assert.deepEqual(JSON.parse(await readFile(join(f.root,'SAMPLE-service-close.json'),'utf8')),{closes:1});
  assert.deepEqual(JSON.parse(await readFile(join(f.root,'SAMPLE-listener-close.json'),'utf8')),{closes:1});
  await assert.rejects(fetch(opened.baseUrl,{signal:AbortSignal.timeout(200)}));
  assert.equal(f.messages.some(message=>message.type==='ready'||message.type==='error'),false);
  assert.equal(f.stderr,'');
});

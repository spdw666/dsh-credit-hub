import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,dirname,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {createHubRuntime} from '../server/runtime.mjs';

// All fault injections target child processes created by this test. The worker
// binds only loopback, accepts only SAMPLE keys, and never imports the engine or
// reads account files. No actual DSH host process is started or terminated.
const sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const parent=join(sourceRoot,'work','watchdog-tests');
const workerSource=String.raw`
import http from 'node:http';
const spec=JSON.parse(process.argv[2]);
const key='SAMPLE_KEY_'+spec.sequence,adminKey='SAMPLE_ADMIN_'+spec.sequence;
let httpHealthy=true,heartbeatMode='normal',closing=false,baseUrl='';
const send=value=>{if(process.connected)process.send(value,()=>{});};
const server=http.createServer((req,res)=>{
  if(!httpHealthy)return;
  if(req.url==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,status:'ready',ready:true}));return;}
  if(req.headers.authorization!=='Bearer '+key){res.writeHead(401);res.end('{}');return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({generation:spec.sequence,localOnly:true}));
});
function stop(code=0){if(closing)return;closing=true;server.closeAllConnections();server.close(()=>process.exit(code));setTimeout(()=>process.exit(code),100).unref();}
process.on('message',message=>{
  if(message?.type==='shutdown'){if(spec.ignoreShutdown)return;setTimeout(()=>stop(),spec.shutdownDelayMs??0);return;}
  if(message?.type==='heartbeat'){
    if(heartbeatMode==='ignore')return;
    send({type:'SAMPLE-heartbeat-observed',id:message.id});
    setTimeout(()=>send({type:'heartbeat',id:heartbeatMode==='wrong'?'SAMPLE_WRONG_ID':message.id,ready:true}),spec.heartbeatDelayMs??0);return;
  }
  if(message?.type==='request'){
    send({type:'SAMPLE-request-observed',id:message.id,operation:message.operation});
    if(spec.ignoreRequests)return;
    if(spec.requestError){send({type:'response',id:message.id,error:{code:'SAMPLE_UPSTREAM_LIMIT',status:429,message:'SAMPLE upstream quota limit'}});return;}
    const result=message.operation==='snapshot'?{generation:spec.sequence,localOnly:true}:message.operation==='models'?{data:[{id:'SAMPLE/model'}]}:{status:200,body:{generation:spec.sequence,localOnly:true}};
    setTimeout(()=>send({type:'response',id:message.id,result}),spec.responseDelayMs??0);return;
  }
  if(message?.type!=='test')return;
  if(message.action==='exit'){stop(17);return;}
  if(message.action==='hang'){while(true){} }
  if(message.action==='disconnect'){process.disconnect();return;}
  if(message.action==='ignore-heartbeat'){heartbeatMode='ignore';return;}
  if(message.action==='wrong-heartbeat'){heartbeatMode='wrong';return;}
  if(message.action==='http-hang'){httpHealthy=false;return;}
});
process.on('SIGTERM',()=>stop());
if(spec.startupFailure){setTimeout(()=>process.exit(19),20);}else{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));baseUrl='http://127.0.0.1:'+server.address().port;
  setTimeout(()=>{
    send({type:'ready',baseUrl,key,adminKey,coreVersion:'SAMPLE',nodeVersion:process.version});
    if(spec.exitAfterReadyMs!==undefined)setTimeout(()=>stop(23),spec.exitAfterReadyMs);
  },spec.readyDelayMs??0);
}
`;

const defaults={heartbeatIntervalMs:50,heartbeatTimeoutMs:40,heartbeatFailures:3,restartBaseMs:15,restartMaxMs:40,jitterRatio:0,stableResetMs:1000,restartWindowMs:3000,maxRestarts:20,cooldownMs:250,shutdownGraceMs:150,resumeGraceMs:500};

async function until(check,{timeoutMs=7000,message='condition did not become true'}={}){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){const value=await check();if(value)return value;await sleep(10);}
  assert.fail(message);
}
async function fixture(t,{spec={},watchdog={},options={},spawnOverride}={}){
  await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'case-'));
  const file=join(root,'SAMPLE-worker.mjs');await writeFile(file,workerSource);
  const spawned=[],active=new Set();let maxActive=0,hub;
  const spawnWorkerImpl=(executable,args,spawnOptions)=>{
    const sequence=spawned.length+1,value={sequence,...(typeof spec==='function'?spec(sequence):spec)};
    const proc=spawnOverride?.({sequence,executable,args,spawnOptions,file,value})??spawn(executable,[file,JSON.stringify(value)],spawnOptions);
    const item={proc,sequence,startedAt:Date.now(),exitAt:null};spawned.push(item);active.add(proc);maxActive=Math.max(maxActive,active.size);
    const finished=()=>{item.exitAt=Date.now();active.delete(proc);};proc.once('exit',finished);proc.once('close',finished);
    return proc;
  };
  t.after(async()=>{
    await hub?.close();
    // A failing test still cleans up only its own recorded child PIDs.
    for(const {proc} of spawned)if(proc.exitCode===null&&proc.signalCode===null)proc.kill();
    await until(()=>active.size===0,{timeoutMs:2000,message:'test-owned worker process was left running'});
    const within=relative(parent,root);assert.ok(within&&!within.startsWith('..')&&!isAbsolute(within));
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  });
  const startedAt=Date.now();
  hub=await createHubRuntime({taskRoot:root,engineRoot:join(sourceRoot,'engine'),nodeExecutable:process.execPath,startupTimeoutMs:500,requestTimeoutMs:700,watchdog:{...defaults,...watchdog},spawnWorkerImpl,...options});
  return {root,hub,spawned,active,get maxActive(){return maxActive},creationMs:Date.now()-startedAt};
}
const ready=(f,timeoutMs=7000)=>f.hub.waitUntilReady({timeoutMs});
const nextGeneration=async(f,previous)=>until(()=>{const s=f.hub.status();return s.status==='ready'&&s.generation>previous?s:null;},{message:'worker did not recover to a later ready generation'});
const inject=(f,action)=>{const item=f.spawned.at(-1);assert.ok(item?.proc.connected,'SAMPLE worker IPC must be connected before fault injection');item.proc.send({type:'test',action});};

test('watchdog: controller returns before startup and retries a failed first launch', {timeout:12000},async t=>{
  const f=await fixture(t,{spec:n=>n===1?{startupFailure:true}:{readyDelayMs:80}});
  assert.equal(typeof f.hub.waitUntilReady,'function');assert.equal(typeof f.hub.onReady,'function');
  const observed=[];f.hub.onReady(value=>observed.push(value));
  // Request starts during the failed first launch and must wait for recovery.
  const response=f.hub.request({path:'/hub/snapshot'});
  await ready(f);assert.equal((await response).body.generation,2);assert.ok(f.hub.status().generation>0);
  assert.equal(f.spawned.length,2);assert.equal(observed.length,1);assert.ok(f.hub.status().restarts>=1);assert.equal(f.maxActive,1);
});

test('watchdog: successful heartbeats keep one worker and management calls remain local', {timeout:12000},async t=>{
  const f=await fixture(t);await ready(f);const first=f.hub.status();await sleep(350);
  assert.equal(f.hub.status().status,'ready');assert.equal(f.hub.status().heartbeatMisses,0);assert.equal(f.hub.status().generation,first.generation);
  assert.equal(f.spawned.length,1);assert.equal(f.maxActive,1);const snapshot=await f.hub.snapshot();assert.equal(snapshot.generation,1);assert.equal(snapshot.localOnly,true);assert.equal(snapshot.worker.status,'ready');
});

test('watchdog: exited worker recovers with new address and keys and fires onReady again', {timeout:12000},async t=>{
  const f=await fixture(t);let callbacks=0;f.hub.onReady(()=>callbacks++);await ready(f);
  const first={...f.hub.runtime},generation=f.hub.status().generation;inject(f,'exit');await nextGeneration(f,generation);
  assert.notEqual(f.hub.runtime.baseUrl,first.baseUrl);assert.notEqual(f.hub.runtime.key,first.key);assert.notEqual(f.hub.runtime.adminKey,first.adminKey);
  const current=await fetch(f.hub.runtime.baseUrl+'/v1/models',{headers:{Authorization:'Bearer '+f.hub.runtime.key},signal:AbortSignal.timeout(1000)});
  assert.equal(current.status,200);assert.equal((await current.json()).generation,2);
  const staleKey=await fetch(f.hub.runtime.baseUrl+'/v1/models',{headers:{Authorization:'Bearer '+first.key},signal:AbortSignal.timeout(1000)});
  assert.equal(staleKey.status,401);assert.equal(callbacks,2);assert.equal(f.maxActive,1);
});

test('watchdog: live but event-loop-frozen worker is detected and replaced', {timeout:12000},async t=>{
  const f=await fixture(t);await ready(f);const generation=f.hub.status().generation;inject(f,'hang');
  await nextGeneration(f,generation);assert.equal(f.maxActive,1);assert.ok(f.spawned[0].exitAt<=f.spawned[1].startedAt);
  assert.equal((await f.hub.snapshot()).generation,2);
});

test('watchdog: host event-loop suspension gives a healthy child a resume grace period', {timeout:12000},async t=>{
  const f=await fixture(t,{spec:{heartbeatDelayMs:20},watchdog:{heartbeatIntervalMs:40,heartbeatTimeoutMs:70,heartbeatFailures:1,resumeGraceMs:100}});await ready(f);
  const generation=f.hub.status().generation;
  await new Promise((resolve,reject)=>{
    const proc=f.spawned[0].proc,timer=setTimeout(()=>{proc.off('message',observe);reject(new Error('SAMPLE heartbeat was not observed'));},1500);
    function observe(message){if(message?.type!=='SAMPLE-heartbeat-observed')return;proc.off('message',observe);clearTimeout(timer);
      // This suspends only the test parent. The independently spawned child
      // stays healthy and its matching response waits in the parent IPC queue.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,300);resolve();
    }
    proc.on('message',observe);
  });
  await sleep(300);assert.equal(f.hub.status().status,'ready');assert.equal(f.hub.status().generation,generation);assert.equal(f.spawned.length,1);assert.equal(f.hub.status().heartbeatMisses,0);
});

test('watchdog: IPC disconnect replaces old still-running worker before spawning another', {timeout:12000},async t=>{
  const f=await fixture(t);await ready(f);const generation=f.hub.status().generation;inject(f,'disconnect');
  await nextGeneration(f,generation);assert.equal(f.maxActive,1);assert.ok(f.spawned[0].exitAt<=f.spawned[1].startedAt);
  assert.equal((await f.hub.request({path:'/admin/models'})).body.generation,2);
});

test('watchdog: mismatched heartbeat IDs do not acknowledge a stalled generation', {timeout:12000},async t=>{
  const f=await fixture(t);await ready(f);const generation=f.hub.status().generation;inject(f,'wrong-heartbeat');
  await nextGeneration(f,generation);assert.equal(f.spawned.length,2);assert.equal(f.maxActive,1);
});

test('watchdog: child error event after ready is handled and recovery remains single-instance', {timeout:12000},async t=>{
  const f=await fixture(t);await ready(f);const generation=f.hub.status().generation;
  assert.doesNotThrow(()=>f.spawned[0].proc.emit('error',Object.assign(new Error('SAMPLE_CHILD_ERROR'),{code:'SAMPLE_ERROR'})));
  await nextGeneration(f,generation);assert.equal(f.maxActive,1);assert.equal((await f.hub.snapshot()).generation,2);
});

test('watchdog: real spawn ENOENT on first attempt is retried without unhandled errors', {timeout:12000},async t=>{
  const f=await fixture(t,{spawnOverride:({sequence,executable,spawnOptions,file,value})=>spawn(sequence===1?join(parent,'SAMPLE_DOES_NOT_EXIST_NODE.exe'):executable,[file,JSON.stringify(value)],spawnOptions)});
  await ready(f);assert.equal(f.spawned.length,2);assert.equal((await f.hub.snapshot()).generation,2);
});

test('watchdog: late messages and lifecycle events from an old generation cannot clear current readiness', {timeout:12000},async t=>{
  const f=await fixture(t);await ready(f);const old=f.spawned[0].proc,generation=f.hub.status().generation;inject(f,'exit');await nextGeneration(f,generation);
  const current={...f.hub.runtime},currentGeneration=f.hub.status().generation;
  assert.doesNotThrow(()=>{
    old.emit('message',{type:'ready',baseUrl:'http://127.0.0.1:1',key:'SAMPLE_OLD',adminKey:'SAMPLE_OLD_ADMIN'});
    old.emit('message',{type:'heartbeat',id:'SAMPLE_OLD_ID',ready:true});
    old.emit('error',new Error('SAMPLE_LATE_OLD_ERROR'));old.emit('disconnect');old.emit('exit',99,null);
  });
  await sleep(100);assert.deepEqual(f.hub.runtime,current);assert.equal(f.hub.status().generation,currentGeneration);assert.equal(f.hub.status().status,'ready');
  assert.equal((await f.hub.snapshot()).generation,2);assert.equal(f.maxActive,1);
});

test('watchdog: concurrent close during startup rejects waiters and never restarts', {timeout:12000},async t=>{
  const f=await fixture(t,{spec:{readyDelayMs:400}});
  const waiting=f.hub.waitUntilReady({timeoutMs:2000});const management=f.hub.snapshot();
  const rejected=Promise.all([assert.rejects(waiting,{code:'worker_stopped'}),assert.rejects(management,{code:'worker_stopped'})]);
  await Promise.all([f.hub.close(),f.hub.close(),f.hub.close()]);await rejected;await sleep(250);
  assert.equal(f.hub.status().status,'stopped');assert.equal(f.hub.runtime.baseUrl,'');assert.equal(f.active.size,0);assert.ok(f.spawned.length<=1);assert.equal(f.maxActive<=1,true);
});

test('watchdog: readiness deadlines and caller cancellation do not stop automatic recovery', {timeout:12000},async t=>{
  const f=await fixture(t,{spec:{readyDelayMs:300}});
  const controller=new AbortController();const aborted=f.hub.waitUntilReady({timeoutMs:2000,signal:controller.signal});
  const cancellation=assert.rejects(aborted,error=>error.name==='AbortError'||error.code==='ABORT_ERR'||error.code==='worker_wait_aborted');controller.abort();await cancellation;
  await assert.rejects(f.hub.waitUntilReady({timeoutMs:30}),{code:'worker_not_ready',status:503});
  await ready(f);assert.equal(f.hub.status().status,'ready');assert.equal(f.spawned.length,1);
});

test('watchdog: management readiness wait is bounded while every startup keeps failing', {timeout:12000},async t=>{
  const f=await fixture(t,{spec:{startupFailure:true},options:{requestTimeoutMs:120}}),start=Date.now();
  await assert.rejects(f.hub.snapshot(),{code:'worker_not_ready',status:503});
  assert.ok(Date.now()-start<1500,'management readiness wait exceeded its configured bound');
  assert.notEqual(f.hub.status().status,'stopped');await f.hub.close();assert.equal(f.hub.status().status,'stopped');
});

test('watchdog: startup timeout retires the first worker before recovery launches another', {timeout:12000},async t=>{
  const f=await fixture(t,{spec:n=>n===1?{readyDelayMs:2000}:{},options:{startupTimeoutMs:200}});await ready(f);
  assert.equal(f.spawned.length,2);assert.ok(f.spawned[0].exitAt<=f.spawned[1].startedAt);assert.equal(f.maxActive,1);assert.equal((await f.hub.snapshot()).generation,2);
});

test('watchdog: management timeout and upstream errors do not restart a healthy backend', {timeout:12000},async t=>{
  const f=await fixture(t,{spec:{responseDelayMs:300},options:{requestTimeoutMs:100}});await ready(f);const generation=f.hub.status().generation;
  await assert.rejects(f.hub.snapshot(),{code:'worker_request_timeout',status:504});await sleep(350);
  assert.equal(f.hub.status().generation,generation);assert.equal(f.hub.status().status,'ready');assert.equal(f.spawned.length,1);
  const limited=await fixture(t,{spec:{requestError:true}});await ready(limited);const limitedGeneration=limited.hub.status().generation;
  await assert.rejects(limited.hub.request({path:'/admin/models'}),{code:'SAMPLE_UPSTREAM_LIMIT',status:429});await sleep(150);
  assert.equal(limited.hub.status().generation,limitedGeneration);assert.equal(limited.hub.status().status,'ready');assert.equal(limited.spawned.length,1);
});

test('watchdog: already-dispatched RPC fails on a generation loss instead of being replayed', {timeout:12000},async t=>{
  const f=await fixture(t,{spec:n=>({ignoreRequests:n===1})});await ready(f);const observed=[];
  for(const {proc} of f.spawned)proc.on('message',m=>{if(m?.type==='SAMPLE-request-observed')observed.push(m);});
  const generation=f.hub.status().generation,request=f.hub.snapshot();
  const rejected=assert.rejects(request,{code:'worker_restarted'});
  await until(()=>observed.length===1,{message:'SAMPLE RPC was not dispatched before the fault'});inject(f,'exit');await rejected;await nextGeneration(f,generation);
  const replacementObserved=[];f.spawned.at(-1).proc.on('message',m=>{if(m?.type==='SAMPLE-request-observed')replacementObserved.push(m);});
  await sleep(100);assert.equal(replacementObserved.length,0);assert.equal((await f.hub.snapshot()).generation,2);assert.equal(replacementObserved.length,1);
});

test('watchdog: crash storm enters bounded cooldown instead of rapidly respawning forever', {timeout:15000},async t=>{
  const f=await fixture(t,{spec:n=>n<=4?{exitAfterReadyMs:20}:{},watchdog:{restartWindowMs:2000,maxRestarts:2,cooldownMs:300,restartBaseMs:10,restartMaxMs:10}});
  const cooldown=await until(()=>{const s=f.hub.status(),retryAt=typeof s.nextRetryAt==='string'?Date.parse(s.nextRetryAt):s.nextRetryAt;return retryAt&&retryAt-Date.now()>=150?s:null;},{message:'crash storm never exposed its cooldown retry time'});
  assert.notEqual(cooldown.status,'ready');await until(()=>f.spawned.length>=5,{timeoutMs:9000,message:'watchdog did not resume after cooldown'});await ready(f);
  assert.ok(f.spawned.some((v,i)=>i>0&&v.startedAt-f.spawned[i-1].exitAt>=260),'no real cooldown gap was observed');assert.equal(f.maxActive,1);
  await f.hub.close();const count=f.spawned.length;await sleep(400);assert.equal(f.spawned.length,count);assert.equal(f.active.size,0);
});

test('watchdog: failed first Node preflight is retried before the only successful worker spawns', {timeout:12000},async t=>{
  let resolves=0;const signals=[];
  const f=await fixture(t,{options:{resolveNodeImpl:async({signal})=>{
    resolves++;signals.push(signal);assert.equal(signal.aborted,false);
    if(resolves===1)throw Object.assign(new Error('SAMPLE_NODE_TEMPORARILY_UNAVAILABLE'),{code:'SAMPLE_NODE_PREFLIGHT_FAILED'});
    return process.execPath;
  }}});
  await ready(f);assert.equal(resolves,2);assert.equal(f.spawned.length,1);assert.equal(f.maxActive,1);
  assert.equal(f.hub.status().generation,1);assert.ok(f.hub.status().restarts>=1);assert.equal(f.hub.status().lastError,null);
  assert.equal((await f.hub.snapshot()).generation,1);assert.equal(f.hub.options.nodeExecutable,process.execPath);
  assert.ok(signals.every(signal=>signal instanceof AbortSignal));
});

test('watchdog: close aborts a pending Node preflight without spawning or scheduling recovery', {timeout:12000},async t=>{
  let resolves=0,preflightSignal,aborted=false,guardFired=false;
  const f=await fixture(t,{options:{resolveNodeImpl:({signal})=>{
    resolves++;preflightSignal=signal;
    return new Promise((resolve,reject)=>{
      // This guard keeps a broken cancellation implementation from hanging the
      // whole test runner; successful close cancels it through the signal.
      const guard=setTimeout(()=>{guardFired=true;reject(new Error('SAMPLE_PREFLIGHT_ABORT_GUARD'));},2500);
      signal.addEventListener('abort',()=>{aborted=true;clearTimeout(guard);reject(signal.reason);},{once:true});
    });
  }}});
  await until(()=>preflightSignal,{message:'Node preflight was not entered'});assert.equal(preflightSignal.aborted,false);assert.equal(f.spawned.length,0);
  const waiting=assert.rejects(f.hub.waitUntilReady({timeoutMs:5000}),{code:'worker_stopped'}),start=Date.now();
  await Promise.all([f.hub.close(),f.hub.close()]);await waiting;
  assert.ok(Date.now()-start<1000,'close did not promptly abort the resolver');assert.equal(aborted,true);assert.equal(preflightSignal.aborted,true);assert.equal(preflightSignal.reason.code,'worker_stopped');assert.equal(guardFired,false);
  await sleep(250);assert.equal(resolves,1);assert.equal(f.spawned.length,0);assert.equal(f.active.size,0);assert.equal(f.hub.status().status,'stopped');assert.equal(f.hub.status().nextRetryAt,null);
});

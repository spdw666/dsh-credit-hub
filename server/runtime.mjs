import {spawn} from 'node:child_process';
import {mkdir,appendFile,access} from 'node:fs/promises';
import {dirname,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {PLUGIN_VERSION,normalizeOptions,parseManagementRequest,boundedPublic,hubError,maskText,validateEngineRoot} from './contracts.mjs';
import {isAccountExportRequest,validateAccountExportResponse} from './transfer.mjs';
import {homedir,userInfo} from 'node:os';

const taskRoot=dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export {PLUGIN_VERSION,parseManagementRequest,normalizeOptions} from './contracts.mjs';
export const watchdogDefaults=Object.freeze({heartbeatIntervalMs:5000,heartbeatTimeoutMs:3000,heartbeatFailures:3,restartBaseMs:500,restartMaxMs:30000,jitterRatio:.2,stableResetMs:60000,restartWindowMs:300000,maxRestarts:5,cooldownMs:60000,shutdownGraceMs:3000,resumeGraceMs:15000});
function watchdogPolicy(value={}){
  const next={...watchdogDefaults,...value};
  for(const [key,v]of Object.entries(next))if(!Object.hasOwn(watchdogDefaults,key)||!Number.isFinite(v)||(key==='jitterRatio'?(v<0||v>.5):(v<1||v>3600000)))throw hubError('invalid_watchdog_settings','Invalid watchdog setting: '+key);
  for(const key of ['heartbeatFailures','maxRestarts'])if(!Number.isInteger(next[key]))throw hubError('invalid_watchdog_settings','An integer is required: '+key);
  if(next.restartMaxMs<next.restartBaseMs)throw hubError('invalid_watchdog_settings','Restart maximum must not be below its base');
  return next;
}

export async function createHubRuntime(input={}){
  const originalEnvironment={HOME:homedir(),USERPROFILE:process.env.USERPROFILE??homedir(),USERNAME:userInfo().username,...Object.fromEntries(['APPDATA','LOCALAPPDATA','PUBLIC','WORKBUDDY_AUTH_FILE','LOOMY_AUTH_SESSION_FILE','BOX_AGENT_CONFIG_DIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))};
  const options=normalizeOptions({...input,hostEnvironment:input.hostEnvironment??originalEnvironment},taskRoot),policy=watchdogPolicy(input.watchdog);
  await validateEngineRoot(options.engineRoot);
  const checkNode=async file=>{if(!/^node(?:\.exe)?$/i.test(basename(file)))throw hubError('standalone_node_required','A standalone Node executable is required',424);await access(file);return file;};
  if(typeof input.resolveNodeImpl!=='function')await checkNode(options.nodeExecutable);
  await mkdir(options.logRoot,{recursive:true});
  const logfile=join(options.logRoot,'credit-hub-worker.log');
  const log=async message=>{try{await appendFile(logfile,new Date().toISOString()+' '+maskText(message).slice(0,12000)+'\n','utf8');}catch{}};
  const runtime={baseUrl:'',key:'',adminKey:'',generation:0};
  const pending=new Map(),waiters=new Set(),listeners=new Set(),lifetime=new AbortController();
  let record,closing=false,closeFlight,attemptFlight,restartTimer,heartbeatTimer,heartbeatFlight,phase='starting',attempts=0,restarts=0,failedStarts=0,readyAt=0,lastError=null,coreVersion=null,nodeVersion=null,nextRetryAt=null,heartbeatMisses=0,lastHeartbeatAt=null,lastHeartbeatLatencyMs=null,lastTickAt=0,graceUntil=0,cooldownUntil=0,restartHistory=[];
  const env={...process.env,AI_CREDIT_MEMORY:options.memoryRoot};for(const key of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','DSH_DESKTOP_NODE_EXECUTABLE'])delete env[key];
  const status=()=>({status:closing?'stopped':phase,pid:record?.proc.pid??null,pluginVersion:PLUGIN_VERSION,coreVersion,nodeVersion,generation:runtime.generation,restarts,startupAttempts:attempts,lastError,nextRetryAt,heartbeatMisses,lastHeartbeatAt,lastHeartbeatLatencyMs,watchdog:{...policy},uptimeMs:phase==='ready'?Math.max(0,Date.now()-readyAt):0});
  const stopHeartbeat=()=>{clearInterval(heartbeatTimer);heartbeatTimer=null;if(heartbeatFlight)clearTimeout(heartbeatFlight.timer);heartbeatFlight=null;};
  const rejectPending=error=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();};
  const clearConnection=()=>{runtime.baseUrl='';runtime.key='';runtime.adminKey='';stopHeartbeat();};
  const isReady=()=>!closing&&phase==='ready'&&record?.proc.connected&&!record.failed&&!record.closed&&!!runtime.baseUrl;
  const aborted=signal=>signal?.reason instanceof Error?signal.reason:hubError('request_aborted','The request was cancelled',499);
  function waitUntilReady({timeoutMs=options.readyWaitTimeoutMs??10000,signal}={}){
    if(signal?.aborted)return Promise.reject(aborted(signal));
    if(closing)return Promise.reject(hubError('worker_stopped','Plugin worker is stopped',503));
    if(isReady())return Promise.resolve({...runtime});
    if(waiters.size>=100)return Promise.reject(hubError('worker_wait_queue_full','Plugin recovery wait queue is full',503));
    if(!Number.isFinite(timeoutMs)||timeoutMs<0)return Promise.reject(hubError('invalid_ready_timeout','A bounded readiness timeout is required'));
    return new Promise((resolve,reject)=>{
      const waiter={finish(error,value){clearTimeout(waiter.timer);signal?.removeEventListener('abort',waiter.cancel);waiters.delete(waiter);error?reject(error):resolve(value);},cancel:()=>waiter.finish(aborted(signal))};
      waiter.timer=setTimeout(()=>waiter.finish(hubError('worker_not_ready','Plugin worker is recovering; try again after it is ready',503)),Math.min(timeoutMs,180000));
      waiters.add(waiter);signal?.addEventListener('abort',waiter.cancel,{once:true});
    });
  }
  function fail(rec,error){
    if(closing||rec&&rec!==record||rec?.failed)return;
    if(rec){rec.failed=true;rec.rejectReady?.(error);}
    if(readyAt&&Date.now()-readyAt>=policy.stableResetMs)failedStarts=0;
    readyAt=0;phase='restarting';clearConnection();
    lastError={code:error.code??'worker_failed',message:maskText(error.message)};
    rejectPending(hubError('worker_restarted','The plugin backend changed; the interrupted request was not replayed',503));
    void log('WORKER_FAILURE '+lastError.code+' '+lastError.message);
    if(!attemptFlight)scheduleRestart();
  }
  function scheduleRestart(){
    if(closing||restartTimer)return;
    const now=Date.now();restartHistory=restartHistory.filter(at=>now-at<policy.restartWindowMs);
    let delay=Math.min(policy.restartMaxMs,policy.restartBaseMs*2**Math.min(failedStarts++,16));
    delay=Math.min(policy.restartMaxMs,Math.max(1,Math.round(delay*(1+(Math.random()*2-1)*policy.jitterRatio))));
    if(restartHistory.length>=policy.maxRestarts){cooldownUntil=now+policy.cooldownMs;delay=Math.max(delay,policy.cooldownMs);phase='cooldown';}else phase='restarting';
    nextRetryAt=new Date(now+delay).toISOString();
    restartTimer=setTimeout(()=>{restartTimer=null;nextRetryAt=null;launch();},delay);restartTimer.unref?.();
  }
  async function stopRecord(rec,{graceful=false}={}){
    if(!rec||rec.closed)return;
    if(graceful&&rec.proc.connected){try{rec.proc.send({type:'shutdown'},()=>{});}catch{}}
    else try{rec.proc.kill();}catch{}
    let timer;
    const wait=ms=>Promise.race([rec.closedPromise,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),ms);})]).finally(()=>clearTimeout(timer));
    if(await wait(policy.shutdownGraceMs)!==false)return;
    try{rec.proc.kill('SIGKILL');}catch{}
    if(await wait(policy.shutdownGraceMs)===false)throw hubError('worker_termination_timeout','Previous worker has not exited; a second instance was not started',503);
  }
  function startHeartbeat(rec){
    stopHeartbeat();lastTickAt=Date.now();
    const miss=ping=>{
      if(heartbeatFlight!==ping||record!==rec||rec.failed||closing)return;
      heartbeatFlight=null;
      // A suspended/blocked host must resume observation before judging its child.
      if(Date.now()-ping.at>policy.heartbeatTimeoutMs+Math.max(policy.resumeGraceMs,policy.heartbeatIntervalMs*3)){graceUntil=Date.now()+policy.resumeGraceMs;heartbeatMisses=0;return;}
      if(Date.now()<graceUntil)return;
      heartbeatMisses++;
      if(heartbeatMisses>=policy.heartbeatFailures)fail(rec,hubError('worker_heartbeat_timeout','Plugin worker stopped answering local heartbeats',503));
    };
    heartbeatTimer=setInterval(()=>{
      if(!isReady()||record!==rec)return;
      const now=Date.now();if(now-lastTickAt>Math.max(policy.heartbeatIntervalMs*3,10000)){graceUntil=now+policy.resumeGraceMs;heartbeatMisses=0;}lastTickAt=now;
      if(heartbeatFlight)return;
      const ping={id:randomUUID(),at:now,rec};heartbeatFlight=ping;
      ping.timer=setTimeout(()=>miss(ping),policy.heartbeatTimeoutMs);ping.timer.unref?.();
      try{rec.proc.send({type:'heartbeat',id:ping.id},error=>{if(error)fail(rec,hubError('worker_disconnected','Local worker IPC disconnected',503));});}catch{fail(rec,hubError('worker_disconnected','Local worker IPC disconnected',503));}
    },policy.heartbeatIntervalMs);heartbeatTimer.unref?.();
  }
  async function attempt(){
    let rec;
    try{
      await stopRecord(record);
      if(closing)return;
      if(cooldownUntil&&Date.now()>=cooldownUntil){restartHistory=[];cooldownUntil=0;}
      phase=attempts?'restarting':'starting';clearConnection();
      if(attempts++){restarts++;restartHistory.push(Date.now());}
      if(typeof input.resolveNodeImpl==='function')options.nodeExecutable=await checkNode(await input.resolveNodeImpl({signal:lifetime.signal}));
      if(closing)return;
      const proc=(input.spawnWorkerImpl??spawn)(options.nodeExecutable,[fileURLToPath(new URL('./worker.mjs',import.meta.url)),JSON.stringify({...options,spawnWorkerImpl:undefined,resolveNodeImpl:undefined,watchdog:policy})],{cwd:options.taskRoot,env,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
      rec={proc,failed:false,closed:false};rec.closedPromise=new Promise(resolve=>{rec.resolveClosed=resolve;});record=rec;
      const ready=new Promise((resolve,reject)=>{rec.resolveReady=resolve;rec.rejectReady=reject;});
      proc.stderr?.on('data',chunk=>void log('STDERR '+String(chunk)));
      proc.on('error',error=>fail(rec,hubError('worker_spawn_failed',error.message,503)));
      proc.once('exit',(code,signal)=>fail(rec,hubError('worker_exited',`Worker exited (${code??signal})`,503)));
      proc.once('close',()=>{rec.closed=true;rec.resolveClosed(true);if(!rec.failed&&!closing)fail(rec,hubError('worker_closed','Local worker closed',503));});
      proc.once('disconnect',()=>fail(rec,hubError('worker_disconnected','Local worker IPC disconnected',503)));
      proc.on('message',message=>{
        if(record!==rec||rec.failed||closing)return;
        if(message?.type==='error'&&!rec.ready){fail(rec,Object.assign(new Error(message.error?.message??'Worker startup failed'),message.error));return;}
        if(message?.type==='ready'&&!rec.ready){rec.resolveReady(message);return;}
        if(message?.type==='heartbeat'){
          const ping=heartbeatFlight;if(ping?.rec!==rec||message.id!==ping.id||message.ready!==true)return;
          clearTimeout(ping.timer);heartbeatFlight=null;heartbeatMisses=0;lastHeartbeatAt=new Date().toISOString();lastHeartbeatLatencyMs=Math.max(0,Date.now()-ping.at);return;
        }
        if(message?.type!=='response')return;
        const item=pending.get(message.id);if(!item||item.rec!==rec)return;
        pending.delete(message.id);clearTimeout(item.timer);
        if(message.error)item.reject(Object.assign(new Error(message.error.message),message.error));
        else try{item.resolve(item.operation==='managementRequest'&&isAccountExportRequest(item.request)&&message.result?.status===200?validateAccountExportResponse(message.result,item.request):boundedPublic(message.result));}catch(error){item.reject(error);}
      });
      const timer=setTimeout(()=>fail(rec,hubError('worker_startup_timeout','Plugin worker startup timed out',504)),options.startupTimeoutMs);timer.unref?.();
      let hello;try{hello=await ready;}finally{clearTimeout(timer);rec.rejectReady=null;}
      if(closing||rec.failed||rec.closed)return;
      if(typeof hello.key!=='string'||!hello.key||typeof hello.adminKey!=='string'||!hello.adminKey||!/^http:\/\/127\.0\.0\.1:\d+$/.test(hello.baseUrl))throw hubError('invalid_worker_handshake','Invalid worker handshake',503);
      rec.ready=true;Object.assign(runtime,{baseUrl:hello.baseUrl,key:hello.key,adminKey:hello.adminKey,generation:runtime.generation+1});coreVersion=hello.coreVersion;nodeVersion=hello.nodeVersion;readyAt=Date.now();phase='ready';lastError=null;nextRetryAt=null;heartbeatMisses=0;lastHeartbeatAt=null;lastHeartbeatLatencyMs=null;graceUntil=0;
      startHeartbeat(rec);
      for(const waiter of [...waiters])waiter.finish(null,{...runtime});
      for(const listener of listeners)try{Promise.resolve(listener({...runtime})).catch(error=>void log('READY_LISTENER_FAILED '+error.message));}catch(error){void log('READY_LISTENER_FAILED '+error.message);}
      void log(`READY pid=${proc.pid} core=${coreVersion} plugin=${PLUGIN_VERSION} generation=${runtime.generation}`);
    }catch(error){
      if(!closing){if(rec&&!rec.failed)fail(rec,error);else if(!rec)fail(null,error);}
      try{await stopRecord(rec);}catch(error){lastError={code:error.code,message:maskText(error.message)};void log('CLEANUP_FAILED '+lastError.message);}
    }
  }
  function launch(){
    if(closing||attemptFlight)return;
    attemptFlight=attempt().finally(()=>{attemptFlight=null;if(!closing&&phase!=='ready')scheduleRestart();});
  }
  async function ipc(operation,request){
    const startedAt=Date.now();
    await waitUntilReady({timeoutMs:Math.min(options.readyWaitTimeoutMs??10000,options.requestTimeoutMs)});
    const rec=record;
    return new Promise((resolve,reject)=>{
      if(!isReady())return reject(hubError('worker_not_ready','Plugin worker is recovering',503));
      const remainingMs=options.requestTimeoutMs-(Date.now()-startedAt);
      if(remainingMs<=0)return reject(hubError('worker_request_timeout','Plugin management request timed out before dispatch',504));
      const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(hubError('worker_request_timeout','Plugin management request timed out',504));},remainingMs);
      pending.set(id,{resolve,reject,timer,operation,request,rec});
      const failed=()=>{const item=pending.get(id);if(item){pending.delete(id);clearTimeout(timer);reject(hubError('worker_disconnected','Plugin worker disconnected; the request was not replayed',503));}fail(rec,hubError('worker_disconnected','Local worker IPC disconnected',503));};
      try{rec.proc.send({type:'request',id,operation,request},error=>{if(error)failed();});}catch{failed();}
    });
  }
  async function request(input){const parsed=parseManagementRequest(input);return ipc(parsed.local?'localRequest':'managementRequest',parsed);}
  function close(){
    if(closeFlight)return closeFlight;
    closing=true;phase='stopped';lifetime.abort(hubError('worker_stopped','Plugin worker is stopped',503));clearTimeout(restartTimer);restartTimer=null;nextRetryAt=null;clearConnection();
    const error=hubError('worker_stopped','Plugin worker is stopped',503);rejectPending(error);for(const waiter of [...waiters])waiter.finish(error);listeners.clear();record?.rejectReady?.(error);
    closeFlight=(async()=>{await stopRecord(record,{graceful:true});await attemptFlight;await log('STOPPED');})();return closeFlight;
  }
  const controller={runtime,options,status,request,waitUntilReady,onReady(listener){if(typeof listener!=='function')throw new TypeError('Ready listener must be a function');listeners.add(listener);return()=>listeners.delete(listener);},async snapshot(){const value=await ipc('snapshot');return {...value,worker:{...value.worker,...status()}};},models:()=>ipc('models'),get workerPid(){return record?.proc.pid;},close};
  launch();return controller;
}

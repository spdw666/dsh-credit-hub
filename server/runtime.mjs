import {spawn} from 'node:child_process';
import {mkdir,appendFile,access} from 'node:fs/promises';
import {dirname,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {MAX_RPC_BYTES,PLUGIN_VERSION,normalizeOptions,parseManagementRequest,boundedPublic,hubError,maskText,validateEngineRoot} from './contracts.mjs';
import {isAccountExportRequest,validateAccountExportResponse} from './transfer.mjs';
import {homedir,userInfo} from 'node:os';

const taskRoot=dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export {PLUGIN_VERSION,parseManagementRequest,normalizeOptions} from './contracts.mjs';
export async function createHubRuntime(input={}){
  // Keep the host half independent of node:sqlite/native adapters on older DSH.
  const originalEnvironment={HOME:homedir(),USERPROFILE:process.env.USERPROFILE??homedir(),USERNAME:userInfo().username,...Object.fromEntries(['APPDATA','LOCALAPPDATA','PUBLIC','WORKBUDDY_AUTH_FILE','LOOMY_AUTH_SESSION_FILE','BOX_AGENT_CONFIG_DIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))};
  const options=normalizeOptions({...input,hostEnvironment:input.hostEnvironment??originalEnvironment},taskRoot);
  await validateEngineRoot(options.engineRoot);
  if(!/^node(?:\.exe)?$/i.test(basename(options.nodeExecutable)))throw hubError('standalone_node_required','A standalone Node executable is required',424);
  await access(options.nodeExecutable);
  await mkdir(options.logRoot,{recursive:true});
  const logfile=join(options.logRoot,'credit-hub-worker.log');
  const log=async message=>{try{await appendFile(logfile,new Date().toISOString()+' '+maskText(message).slice(0,12000)+'\n','utf8');}catch{}};
  const runtime={baseUrl:'',key:'',adminKey:''};
  let child,closing=false,restartTimer,failedStarts=0,restarts=0,readyAt=0,lastError=null,coreVersion=null,nodeVersion=null;
  const pending=new Map();
  const rejectPending=error=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();};
  const status=()=>({status:closing?'stopped':child?.exitCode===null&&runtime.baseUrl?'ready':'restarting',pid:child?.pid??null,pluginVersion:PLUGIN_VERSION,coreVersion,nodeVersion,restarts,lastError});
  const env={...process.env,AI_CREDIT_MEMORY:options.memoryRoot};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;delete env.DSH_DESKTOP_NODE_EXECUTABLE;
  const scheduleRestart=()=>{
    if(closing||restartTimer)return;
    const delay=Math.min(30000,500*2**Math.min(failedStarts++,6));
    restartTimer=setTimeout(()=>{restartTimer=null;void start().catch(error=>{lastError={code:error.code??'worker_restart_failed',message:maskText(error.message)};void log('RESTART_FAILED '+lastError.message);scheduleRestart();});},delay);restartTimer.unref?.();
  };
  async function start(){
    if(closing)throw hubError('worker_stopped','Plugin worker is stopped',503);
    runtime.baseUrl='';runtime.key='';runtime.adminKey='';
    const proc=spawn(options.nodeExecutable,[fileURLToPath(new URL('./worker.mjs',import.meta.url)),JSON.stringify(options)],{cwd:options.taskRoot,env,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});child=proc;
    proc.stderr.on('data',chunk=>void log('STDERR '+String(chunk)));
    const ready=await new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);proc.off('error',onError);proc.off('exit',onExit);proc.off('message',onReady);error?reject(error):resolve(value);};
      const onError=error=>finish(hubError('worker_spawn_failed',error.message,503));
      const onExit=(code,signal)=>finish(hubError('worker_startup_failed',`Worker exited before ready (${code??signal})`,503));
      const onReady=message=>{if(message?.type==='error')finish(Object.assign(new Error(message.error?.message??'Worker startup failed'),message.error));if(message?.type==='ready')finish(null,message);};
      const timer=setTimeout(()=>{proc.kill();finish(hubError('worker_startup_timeout','Plugin worker startup timed out',504));},options.startupTimeoutMs);
      proc.once('error',onError);proc.once('exit',onExit);proc.on('message',onReady);
    });
    if(closing){proc.kill();throw hubError('worker_stopped','Plugin worker stopped during startup',503);}
    if(typeof ready.key!=='string'||typeof ready.adminKey!=='string'||!/^http:\/\/127\.0\.0\.1:\d+$/.test(ready.baseUrl)){proc.kill();throw hubError('invalid_worker_handshake','Invalid worker handshake',503);}
    Object.assign(runtime,{baseUrl:ready.baseUrl,key:ready.key,adminKey:ready.adminKey});coreVersion=ready.coreVersion;nodeVersion=ready.nodeVersion;readyAt=Date.now();lastError=null;
    proc.on('message',message=>{if(message?.type!=='response')return;const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);if(message.error)item.reject(Object.assign(new Error(message.error.message),message.error));else {try{item.resolve(item.operation==='managementRequest'&&isAccountExportRequest(item.request)&&message.result?.status===200?validateAccountExportResponse(message.result,item.request):boundedPublic(message.result));}catch(error){item.reject(error);}}});
    proc.once('exit',(code,signal)=>{
      if(proc!==child)return;runtime.baseUrl='';runtime.key='';runtime.adminKey='';rejectPending(hubError('worker_restarted','The plugin worker restarted; reopen its current status',503));
      if(closing)return;if(Date.now()-readyAt>=60000)failedStarts=0;restarts++;lastError={code:'worker_exited',message:`Worker exited (${code??signal})`};void log(lastError.message);scheduleRestart();
    });
    void log(`READY pid=${proc.pid} core=${coreVersion} plugin=${PLUGIN_VERSION}`);
  }
  try{await start();}catch(error){
    closing=true;const failed=child;
    if(failed&&failed.exitCode===null)await new Promise(resolve=>{const timer=setTimeout(resolve,3000);failed.once('exit',()=>{clearTimeout(timer);resolve();});failed.kill();});
    await log('START_FAILED '+(error.code??'error')+' '+error.message);throw error;
  }
  const ipc=(operation,request)=>new Promise((resolve,reject)=>{
    if(closing||!child?.connected||!runtime.baseUrl)return reject(hubError('worker_not_ready','The plugin worker is not ready',503));
    const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(hubError('worker_request_timeout','Plugin management request timed out',504));},options.requestTimeoutMs);
    pending.set(id,{resolve,reject,timer,operation,request});child.send({type:'request',id,operation,request},error=>{if(!error)return;const current=pending.get(id);if(current){pending.delete(id);clearTimeout(timer);reject(hubError('worker_disconnected','Plugin worker disconnected',503));}});
  });
  async function request(input){
    const parsed=parseManagementRequest(input);
    if(parsed.local)return ipc('localRequest',parsed);
    return ipc('managementRequest',parsed);
  }
  return {runtime,options,status,request,snapshot:()=>ipc('snapshot'),models:()=>ipc('models'),get workerPid(){return child?.pid;},async close(){
    if(closing)return;closing=true;clearTimeout(restartTimer);rejectPending(hubError('worker_stopped','Plugin worker stopped',503));
    const proc=child;if(!proc||proc.exitCode!==null)return;
    await new Promise(resolve=>{const timeout=setTimeout(()=>{proc.kill();resolve();},5000);proc.once('exit',()=>{clearTimeout(timeout);resolve();});if(proc.connected)proc.send({type:'shutdown'});else proc.kill();});
    runtime.baseUrl='';runtime.key='';runtime.adminKey='';void log('STOPPED');
  }};
}

import {execFile} from 'node:child_process';
import {win32,posix} from 'node:path';
import {promisify} from 'node:util';

const execute=promisify(execFile);
export const MINIMUM_WORKER_NODE='22.23.3';
const probeSource=`import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(':memory:');
const row=db.prepare('SELECT 1 AS ready').get();db.close();
console.log(JSON.stringify({protocol:'credit-hub-node-probe-v1',version:process.versions.node,sqlite:row.ready===1,electron:Boolean(process.versions.electron)}));`;
const failure=(code,message,details)=>Object.assign(new Error(message),{code,...(details?{details}:{})});
const pathsFor=platform=>platform==='win32'?win32:posix;
const executableName=(file,platform)=>platform==='win32'?/^node\.exe$/i.test(win32.basename(file)):/^node$/.test(posix.basename(file));
export function isSupportedWorkerProbe(result){
  if(!result||result.sqlite!==true||result.electron!==false)return false;
  const version=/^(\d+)\.(\d+)\.(\d+)$/.exec(String(result.version??''));
  if(!version)return false;
  const [major,minor,patch]=version.slice(1).map(Number);
  return major>22||major===22&&(minor>23||minor===23&&patch>=3);
}

/** Execute the candidate itself: a version label or Electron Node-mode shim is insufficient. */
export async function probeWorkerNode(executable,{env=process.env,timeoutMs=6000}={}){
  const cleanEnv={...env};
  for(const key of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','DSH_DESKTOP_NODE_EXECUTABLE'])delete cleanEnv[key];
  const {stdout}=await execute(executable,['--input-type=module','-e',probeSource],{
    env:cleanEnv,timeout:timeoutMs,windowsHide:true,maxBuffer:16384,encoding:'utf8',
  });
  let result;try{result=JSON.parse(stdout.trim())}catch{throw failure('worker_node_invalid_probe','The candidate did not return a valid standalone Node capability probe')}
  if(result.protocol!=='credit-hub-node-probe-v1'||!isSupportedWorkerProbe(result))throw failure('worker_node_unsupported',`A standalone Node >=${MINIMUM_WORKER_NODE} with working node:sqlite is required (found Node ${result.version??'unknown'}, node:sqlite ${result.sqlite===true?'available':'unavailable'})`,{version:result.version??null,sqlite:result.sqlite===true});
  return result;
}

/** No downloads or installation writes. Explicit configuration errors never fall through. */
export async function resolveWorkerNode({
  explicit,env=process.env,execPath=process.execPath,taskRoot,
  platform=process.platform,cwd=process.cwd(),resourcesPath,probe=probeWorkerNode,
}={}){
  const path=pathsFor(platform),name=platform==='win32'?'node.exe':'node';
  const absolute=value=>path.resolve(cwd,String(value));
  async function configured(value,source){
    if(typeof value!=='string'||!value.trim())throw failure('worker_node_configuration_invalid',`${source} must name a standalone Node executable`);
    const file=absolute(value.trim());
    if(!executableName(file,platform))throw failure('worker_node_configuration_invalid',`${source} must name ${name}, not an Electron executable or command shim`);
    try{
      const result=await probe(file,{env});
      if(!isSupportedWorkerProbe(result))throw failure('worker_node_unsupported','The configured Node version or SQLite capability is unsupported');
      return file;
    }catch(error){throw failure('worker_node_configuration_invalid',`${source} failed its standalone Node >=22.23.3 / node:sqlite probe`,{source,cause:error.code??'probe_failed'})}
  }
  if(explicit!==undefined&&explicit!==null&&explicit!=='')return configured(explicit,'nodeExecutable');
  if(env.DSH_CREDIT_HUB_NODE!==undefined&&env.DSH_CREDIT_HUB_NODE!=='')return configured(env.DSH_CREDIT_HUB_NODE,'DSH_CREDIT_HUB_NODE');
  const candidates=[];
  const add=(file,source)=>{if(file)candidates.push({file:absolute(file),source})};
  if(execPath&&executableName(execPath,platform))add(execPath,'host-standalone-node');
  if(taskRoot)add(path.join(taskRoot,'runtime',name),'plugin-runtime');
  const executableDirectory=execPath?path.dirname(absolute(execPath)):null;
  const officialRoots=[
    resourcesPath&&path.join(resourcesPath,'app'),
    resourcesPath,
    executableDirectory&&path.join(executableDirectory,'resources','app'),
    executableDirectory&&path.join(executableDirectory,'resources'),
    // macOS Electron lives in Contents/MacOS, and its resources are the sibling Resources.
    platform==='darwin'&&executableDirectory&&path.join(executableDirectory,'..','Resources','app'),
    platform==='darwin'&&executableDirectory&&path.join(executableDirectory,'..','Resources'),
  ].filter(Boolean);
  for(const root of officialRoots)add(path.join(root,'runtime','primary-runtime','dependencies','node','bin',name),'dsh-primary-runtime');
  const searchPath=Object.entries(env).find(([key])=>key.toUpperCase()==='PATH')?.[1]??'';
  for(const directory of String(searchPath).split(platform==='win32'?';':':')){
    const value=directory.trim().replace(/^"(.*)"$/,'$1');
    if(value)add(path.join(value,name),'path');
  }
  const seen=new Set(),attempts=[];
  for(const {file,source} of candidates){
    const key=platform==='win32'?file.toLowerCase():file;
    if(seen.has(key)||!executableName(file,platform))continue;
    seen.add(key);
    try{
      const result=await probe(file,{env});
      if(isSupportedWorkerProbe(result))return file;
      attempts.push({source,result:'unsupported',version:result.version??null});
    }catch(error){attempts.push({source,result:error.code??'probe_failed',...(error.details?.version?{version:error.details.version}:{})})}
  }
  const detected=attempts.length?attempts.map(a=>`${a.source}=${a.version??a.result}`).join(', '):'no candidates';
  throw failure('worker_node_unavailable',`No standalone Node >=${MINIMUM_WORKER_NODE} with working node:sqlite was found (${detected}); set nodeExecutable or DSH_CREDIT_HUB_NODE`,{attempts,minimum:MINIMUM_WORKER_NODE});
}

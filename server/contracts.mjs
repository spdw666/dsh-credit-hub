import {resolve,relative,isAbsolute,join} from 'node:path';
import {createHash} from 'node:crypto';
import {stat,readFile} from 'node:fs/promises';
import {ACCOUNT_EXPORT_PATH,validateAccountExportRequest} from './transfer.mjs';

export const PLUGIN_VERSION='0.2.3';
export const MAX_RPC_BYTES=2*1024*1024;
export const MAX_INPUT_BYTES=4*1024*1024;
export function hubError(code,message,status=400){return Object.assign(new Error(message),{code,status});}
export function isWithin(root,path){const p=relative(resolve(root),resolve(path));return p===''||(!isAbsolute(p)&&p!=='..'&&!p.startsWith('..\\')&&!p.startsWith('../'));}
export function requireWithin(root,path,field){if(!isWithin(root,path))throw hubError('state_path_outside_project',`${field} must remain in the independent plugin directory`);return resolve(path);}
export function normalizeOptions(input,defaultTaskRoot){
  const taskRoot=resolve(input.taskRoot??defaultTaskRoot),stateRoot=requireWithin(taskRoot,input.stateRoot??join(taskRoot,'runtime','profile'),'stateRoot');
  return {...input,taskRoot,stateRoot,configFile:requireWithin(stateRoot,input.configFile??join(stateRoot,'config.json'),'configFile'),engineRoot:resolve(input.engineRoot??join(taskRoot,'source','engine')),memoryRoot:requireWithin(taskRoot,input.memoryRoot??join(taskRoot,'memory'),'memoryRoot'),logRoot:requireWithin(taskRoot,input.logRoot??join(taskRoot,'runtime','logs'),'logRoot'),nodeExecutable:input.nodeExecutable??join(taskRoot,'runtime','node.exe'),startupTimeoutMs:input.startupTimeoutMs??30000,requestTimeoutMs:input.requestTimeoutMs??180000,allowScheduler:input.allowScheduler===true};
}
export async function validateEngineRoot(engineRoot){
  try{
    if(!(await stat(engineRoot)).isDirectory())throw Error('not a directory');
    const descriptor=JSON.parse(await readFile(join(engineRoot,'package.json'),'utf8'));
    if(descriptor.type!=='module'||typeof descriptor.version!=='string')throw Error('invalid engine descriptor');
    for(const name of ['service.mjs','server.mjs','activity-context.mjs'])if(!(await stat(join(engineRoot,'src',name))).isFile())throw Error('missing engine module');
    return resolve(engineRoot);
  }catch{throw hubError('engine_code_invalid','The read-only engine directory is missing its package descriptor or required modules',424);}
}
export function assertIsolatedConfig(config,{taskRoot,stateRoot,configFile}){
  const data=resolve(configFile,'..',config.dataDir??'./data');requireWithin(stateRoot,data,'dataDir');
  // Snapshots and account imports are owned by this project. No configuration
  // edit may quietly restore a reference to the predecessor's writable files.
  for(const account of config.accounts??[])for(const [name,value] of Object.entries(account.credentials??{})){
    if(typeof value==='string'&&value!=='auto'&&/(?:file|path|dir|root|db)$/i.test(name)&&!/(?:executable|python)$/i.test(name))requireWithin(taskRoot,resolve(configFile,'..',value),'account credential '+name);
  }
  return config;
}
export function assertCredentialIsolation(account,config,taskRoot){
  if(account?.platform==='freeapi'&&account.credentials?.kind==='none')return;
  const file=account?.credentials?.file;
  if(typeof file!=='string'||file==='auto')throw hubError('credential_snapshot_required','This account needs an independent local credential snapshot',409);
  requireWithin(taskRoot,config.path(file),'account credential file');
}
const secretKeys=/^(?:credentials|authorization|accessToken|refreshToken|apiKey|adminKey|accessKey|secretKey|securityToken|machineToken|clientSecret|privateKey|secretAccessKey|sessionToken|bearerToken|idToken|token|secret|password|cookie|auth_raw|profile_raw|filePath|keysFile|configFile|dataDir|credentialFile|download|contentBase64)$/i;
const identityKeys=/^(?:uid|userId|principal|enterpriseId|machineId|deviceId|deviceCenterId|email|phone|mobile|accountNumber)$/i;
export function maskText(value){let s=String(value);if(/^(?:(?:account|route|upstream)-[a-f0-9]{12}|event-[a-f0-9]{24}|delivery-[a-f0-9-]{36}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(s))return s;s=s.replace(/Bearer\s+[^\s,;]+/gi,'Bearer [hidden]');if(s.includes('@'))s=s.replace(/[A-Z0-9._%+-]{1,128}@(?:[A-Z0-9-]{1,63}\.){1,5}[A-Z]{2,16}/gi,'[邮箱已隐藏]');return s.replace(/(?<!\d)(\d{3})\d{4,}(\d{2,4})(?!\d)/g,'$1****$2');}
function maskIdentity(value){const s=String(value??'');return s.length>4?s.slice(0,2)+'***'+s.slice(-2):'***';}
export function publicValue(value,depth=0){
  if(depth>15)return '[depth limited]';
  if(typeof value==='string')return maskText(value);
  if(value===null||typeof value!=='object')return value;
  if(Array.isArray(value))return value.slice(0,2000).map(v=>publicValue(v,depth+1));
  const out={};for(const [key,item] of Object.entries(value)){if(secretKeys.test(key))continue;out[key]=identityKeys.test(key)?maskIdentity(item):publicValue(item,depth+1);}return out;
}
export function boundedPublic(value){if(Buffer.byteLength(JSON.stringify(value))>MAX_RPC_BYTES)throw hubError('rpc_response_too_large','Management response exceeds the 2 MiB limit',413);const body=publicValue(value);if(Buffer.byteLength(JSON.stringify(body))>MAX_RPC_BYTES)throw hubError('rpc_response_too_large','Management response exceeds the 2 MiB limit',413);return body;}
export function publicAccount(account,index,{blockedKinds=['antigravity','opencode']}={}){const snapshotReady=account.platform==='freeapi'&&account.credentials?.kind==='none'||typeof account.credentials?.file==='string'&&account.credentials.file!=='auto',blocked=blockedKinds.includes(account.platform),setupRequired=blocked||!snapshotReady;return {id:account.id,label:maskText(account.label??account.name??`账户${String(index+1).padStart(2,'0')}`),platform:account.platform,enabled:account.enabled!==false,inferenceEnabled:account.inferenceEnabled!==false,credentialMode:account.credentials?.kind??account.credentials?.mode??'unconfigured',snapshotReady,setupRequired,connectionState:blocked?'setup_required':!snapshotReady?'snapshot_required':'not_checked'};}
export function createHandleMaps(config){
  const maps={accounts:new Map(),routes:new Map(),upstreams:new Map(),reverse:new Map()};
  for(const [kind,prefix] of [['accounts','account'],['routes','route'],['upstreams','upstream']])for(const {id} of config[kind]??[]){const handle=prefix+'-'+createHash('sha256').update(prefix+'\0'+id).digest('hex').slice(0,12);maps[kind].set(id,handle);maps.reverse.set(handle,id);}
  return maps;
}
const idField=key=>key==='id'||/^(?:model|accountId|accountIds|routeId|routeIds|upstreamId|upstreamIds|fromAccountId|toAccountId|candidateAccountId|selectedAccountId)$/.test(key);
export function translateIds(value,maps,{toInternal=false,key='',owner=null}={}){
  if(typeof value==='string'){
    if(!idField(key))return value;if(toInternal)return maps.reverse.get(value)??value;
    const order=/account/i.test(key)||key==='id'&&owner?.platform?['accounts','routes','upstreams']:/upstream/i.test(key)?['upstreams','routes','accounts']:['routes','accounts','upstreams'];
    for(const kind of order)if(maps[kind].has(value))return maps[kind].get(value);return value;
  }
  if(Array.isArray(value))return value.map(v=>translateIds(v,maps,{toInternal,key,owner}));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,translateIds(v,maps,{toInternal,key:k,owner:value})]));
  return value;
}
const gets=new Set(['/admin/models','/admin/model-tests','/admin/model-directory','/admin/workbuddy/summary','/admin/workbuddy/tasks','/admin/workbuddy/task-jobs','/admin/workbuddy/pools','/admin/workbuddy/rotation','/admin/usage','/admin/records','/admin/activity-context','/admin/model-relay','/admin/balances','/admin/client-updates','/admin/free-providers']);
const posts=new Set(['/admin/model-tests','/admin/model-import','/admin/model-export','/admin/claim','/admin/catalog','/admin/doctor','/admin/health','/admin/free-provider-add','/admin/model-relay','/admin/client-updates/check','/admin/workbuddy/task-jobs','/admin/workbuddy/tasks','/admin/workbuddy/capture','/admin/workbuddy/settings','/admin/workbuddy/pool','/admin/workbuddy/pool/normalize','/admin/workbuddy/rotation','/admin/workbuddy/rotation/evaluate','/admin/workbuddy/accounts/import/preview','/admin/workbuddy/accounts/import/commit','/admin/workbuddy/accounts/import','/admin/workbuddy/accounts/export']);
export function parseManagementRequest(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw hubError('invalid_management_request','Management request must be an object');
  const method=String(input.method??'GET').toUpperCase(),path=input.path;
  if(typeof path!=='string'||path.length>4096||!path.startsWith('/')||path.startsWith('//')||path.includes('\\')||path.includes('#')||/[\x00-\x20]/.test(path))throw hubError('invalid_management_path','Invalid management path');
  const url=new URL(path,'http://hub.local');if(url.origin!=='http://hub.local'||url.pathname.includes('%')||url.pathname!==path.split('?')[0])throw hubError('invalid_management_path','Encoded or normalized management paths are not accepted');
  if(input.body!==undefined&&Buffer.byteLength(JSON.stringify(input.body))>MAX_INPUT_BYTES)throw hubError('rpc_request_too_large','Management request exceeds the 4 MiB limit',413);
  if(method==='POST'&&url.pathname===ACCOUNT_EXPORT_PATH){if(url.search)throw hubError('invalid_account_export_request','Account export does not accept query parameters');validateAccountExportRequest(input.body);}
  const local=['/hub/snapshot','/hub/accounts','/hub/routes','/hub/audit','/hub/activity','/hub/scheduler','/hub/operations','/hub/discovery','/hub/updates','/hub/events','/hub/events/pending','/hub/forecast','/hub/scheduler-status'];
  if(local.includes(url.pathname)&&method==='GET'||['/hub/accounts','/hub/routes','/hub/scheduler','/hub/operations','/hub/discovery','/hub/updates','/hub/events/ack','/hub/events/test','/hub/scheduler/manual'].includes(url.pathname)&&method==='POST')return {method,path,pathname:url.pathname,query:Object.fromEntries(url.searchParams),body:input.body,local:true};
  const dynamicGet=/^\/admin\/workbuddy\/(?:accounts\/[a-zA-Z0-9_.-]+\/details|task-jobs\/[a-f0-9-]{36})$/.test(url.pathname);
  const dynamicPost=/^\/admin\/workbuddy\/(?:accounts\/[a-zA-Z0-9_.-]+\/(?:profile|inference|mark-status)|task-jobs\/[a-f0-9-]{36}\/cancel)$/.test(url.pathname);
  if(!(method==='GET'&&(gets.has(url.pathname)||dynamicGet)||method==='POST'&&(posts.has(url.pathname)||dynamicPost)))throw hubError('management_operation_not_allowed','This management operation is not exposed by the plugin',403);
  return {method,path,pathname:url.pathname,query:Object.fromEntries(url.searchParams),body:input.body,local:false};
}

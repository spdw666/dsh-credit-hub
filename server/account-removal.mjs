import {readFile,writeFile,rename,mkdir,rm,lstat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,dirname,relative,sep,isAbsolute} from 'node:path';
import {assertInsideRoot} from '../scripts/import-local.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const error=(code,status=400)=>Object.assign(new Error(code),{code,status});
const inside=(base,file)=>{const r=relative(resolve(base),resolve(file));return r===''||r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r);};
const edition=a=>a.edition??({workbuddy:'cn',workbuddyai:'global',trae:'cn'}[a.platform]??'');
const region=a=>a.region??(a.platform==='minimax'?'cn':'');
export const accountPrincipalHash=(platform,principal)=>sha(platform+'\0'+String(principal));
export const accountRemovalKey=(account,principalHash)=>sha(JSON.stringify([account.platform,edition(account),region(account),principalHash]));
export function isRemovedAccount(config,account,principal){
  const key=accountRemovalKey(account,accountPrincipalHash(account.platform,principal));
  return (Array.isArray(config.pluginAccountRemovals)?config.pluginAccountRemovals:[]).some(row=>row?.identityKey===key);
}
async function writeOwned(root,file,value){
  await assertInsideRoot(root,file);await mkdir(dirname(file),{recursive:true});
  const temp=await assertInsideRoot(root,file+'.'+randomUUID()+'.tmp');
  try{await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,file);}finally{await rm(temp,{force:true});}
}
function credentialPaths(config,account){return Object.entries(account.credentials??{}).filter(([key,value])=>typeof value==='string'&&value&&value!=='auto'&&/(?:file|path|dir|root|db)$/i.test(key)&&!/(?:executable|python)$/i.test(key)).map(([key,value])=>({key,file:config.path?config.path(value):resolve(value)}));}
function sharedWithOthers(config,account,path,{directory=false}={}){
  return config.value.accounts.some(other=>other.id!==account.id&&credentialPaths(config,other).some(({key,file})=>relative(resolve(file),resolve(path))===''||directory&&inside(path,file)||/(?:dir|root)$/i.test(key)&&inside(file,path)));
}
/** Delete only known files or an exact private discovery snapshot. Never follow
 * links or remove a shared/native directory. Historical token-free ledgers stay. */
export async function removeOwnedCredentialAssets(service,account,{taskRoot}={}){
  const root=resolve(taskRoot),dataDir=resolve(service.config.dataDir),removed=[],retained=[];
  for(const {key,file} of credentialPaths(service.config,account)){
    const r=relative(dataDir,file).split(sep).join('/');
    const directory=/^(?:profileDir|runtimeDataDir)$/i.test(key);
    const discoveryDirectory=directory&&/^discovered\/[a-z0-9-]+\/[a-f0-9]{64}$/.test(r);
    if(directory&&!discoveryDirectory)continue;
    const files=discoveryDirectory?[file]:[file,file+'.refresh-state.json',file+'.refresh-state.json.lock',file+'.lock'];
    for(const target of files){
      if(!inside(dataDir,target)||target===dataDir){retained.push({kind:key,reason:'not_private_data'});continue;}
      if(sharedWithOthers(service.config,account,target,{directory:discoveryDirectory})){retained.push({kind:key,reason:'shared'});continue;}
      try{
        await assertInsideRoot(root,target);const stat=await lstat(target);
        if(stat.isSymbolicLink()||(discoveryDirectory?!stat.isDirectory():!stat.isFile())){retained.push({kind:key,reason:'unexpected_type'});continue;}
        // assertInsideRoot checks the final absolute target and all existing parents.
        await rm(target,{force:true,...(discoveryDirectory?{recursive:true}:{})});removed.push(key);
      }catch(e){if(e.code==='ENOENT')continue;retained.push({kind:key,reason:/symlink/.test(e.code??'')?'link_rejected':'cleanup_failed'});}
    }
  }
  return {removedCredentialAssets:removed.length,retainedAssets:retained};
}
export function pruneAccount(value,accountId){
  const before=value.routes.length,account=value.accounts.find(a=>a.id===accountId),upstreams=new Set(value.upstreams.filter(u=>u.accountId===accountId).map(u=>u.id));
  for(const route of value.routes){
    if(route.accountPool){route.accountPool.accountIds=route.accountPool.accountIds.filter(id=>id!==accountId);if(!route.accountPool.accountIds.length)delete route.accountPool;}
    if(upstreams.has(route.targets[0]?.upstreamId)&&route.accountPool?.accountIds.length){
      const replacement=route.accountPool.accountIds.map(id=>{
        const a=value.accounts.find(a=>a.id===id&&a.platform===account.platform&&edition(a)===edition(account)&&a.enabled!==false&&a.inferenceEnabled!==false);
        return a&&value.upstreams.find(u=>u.accountId===id&&u.kind===a.platform&&u.enabled!==false);
      }).find(Boolean);
      if(replacement)route.targets[0]={...route.targets[0],upstreamId:replacement.id};
    }
    route.targets=route.targets.filter(t=>!upstreams.has(t.upstreamId));
  }
  value.accounts=value.accounts.filter(a=>a.id!==accountId);value.upstreams=value.upstreams.filter(u=>!upstreams.has(u.id));value.routes=value.routes.filter(r=>r.targets.length);
  return {accounts:1,upstreams:upstreams.size,routes:before-value.routes.length};
}
/** Called under the management mutation queue. A deliberate delete persists a
 * credential-free identity tombstone in the SAME config commit before cleanup. */
export async function removeHubAccount(service,accountId,{confirm,taskRoot,resolvePrincipal}={}){
  if(confirm!==true)throw error('account_delete_confirmation_required');
  await service.config.load?.();
  let account=service.config.value.accounts.find(a=>a.id===accountId);if(!account)throw error('account_not_found',404);
  let principalHash=service.ledger?.principalHash?.(accountId);
  if(!principalHash&&resolvePrincipal){const value=await resolvePrincipal(account);if(value?.principal!==undefined)principalHash=accountPrincipalHash(account.platform,value.principal);}
  if(!principalHash)throw error('account_delete_identity_required',409);
  const drains=[service.credentials?.flights?.get?.(accountId),...[...(service.scheduler?.active?.values?.()??[])].filter(job=>job.accountId===accountId).map(job=>job.promise)].filter(Boolean);
  if(drains.length){
    // Persist a disabled gate before draining an already running refresh/claim.
    // Its final write completes BEFORE the private credential files are erased.
    const paused=structuredClone(service.config.value);paused.accounts.find(a=>a.id===accountId).enabled=false;
    await service.config.save(paused);await Promise.allSettled(drains);await service.config.load?.();
    account=service.config.value.accounts.find(a=>a.id===accountId);if(!account)throw error('account_not_found',404);
  }
  const value=structuredClone(service.config.value),identityKey=accountRemovalKey(account,principalHash);
  value.pluginAccountRemovals=(value.pluginAccountRemovals??[]).filter(row=>row.identityKey!==identityKey);
  const fingerprints=[];
  if(service.config.file){try{const file=join(dirname(service.config.file),'discovery-state.json');await assertInsideRoot(taskRoot,file);const state=JSON.parse(await readFile(file,'utf8'));for(const b of Object.values(state.bindings??{}))if(b.accountId===accountId&&/^[a-f0-9]{64}$/.test(b.sourceFingerprint??''))fingerprints.push(b.sourceFingerprint);}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}}
  value.pluginAccountRemovals.push({identityKey,platform:account.platform,deletedAt:new Date().toISOString(),...(fingerprints.length?{sourceFingerprints:[...new Set(fingerprints)]}:{})});
  const removed=pruneAccount(value,accountId);await service.config.save(value);
  // ConfigStore normally creates a before-image. Explicit deletion must not
  // leave a new undelete-ready account record in that conventional backup.
  if(service.config.file)await writeOwned(taskRoot,service.config.file+'.backup.json',value);
  service.credentials?.cache?.delete(accountId);service.balanceCache?.delete(accountId);service.balanceCacheKeys?.delete(accountId);
  service.platforms?.catalogs?.clear?.();service.platforms?.catalogFlights?.clear?.();
  if(service.ledger?.get?.('wb-management-current')?.accountId===accountId)service.ledger.set('wb-management-current',null);
  const assets=await removeOwnedCredentialAssets(service,account,{taskRoot});
  service.ledger?.unbind?.(accountId);
  return {deleted:true,removed,suppressed:true,...assets,credentialBackupCreated:false,historyPreserved:true};
}

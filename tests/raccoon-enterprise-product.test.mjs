import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHubRuntime} from '../server/runtime.mjs';
import {normalizeEnterpriseIds} from '../server/contracts.mjs';

// W2 (round 3): the enterprise candidate builder is only real if a *product*
// caller can reach it. These cases start from the plugin configuration value and
// go through createHubRuntime → worker → createHubOperations → createDiscovery →
// nativeCandidates, then read the result back over the public discovery routes.
// They would fail if the config key were dropped anywhere along that chain.
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const token=claims=>['SAMPLEHEADER',Buffer.from(JSON.stringify(claims)).toString('base64url'),'SAMPLESIGNATURE'].join('.');

async function fixture(t,{enterpriseIds}={}){
  const parent=join(project,'work','raccoon-enterprise-product');
  await mkdir(parent,{recursive:true});
  const root=await mkdtemp(join(parent,'case-')),engine=join(root,'source','engine'),src=join(engine,'src'),profile=join(root,'runtime','profile'),home=join(root,'home');
  await mkdir(profile,{recursive:true});await mkdir(home,{recursive:true});
  // The discovery probe imports engine/src/provider-raccoon.mjs, so the real
  // modules are copied and only the service/server seams are replaced.
  await cp(join(project,'engine','src'),src,{recursive:true});
  await writeFile(join(engine,'package.json'),JSON.stringify({type:'module',version:'0.6.0'}));
  await writeFile(join(src,'service.mjs'),`
import {readFile,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
export async function createService(file,{schedule}={}){
 const config={file,value:JSON.parse(await readFile(file,'utf8')),dataDir:resolve(file,'..','data'),path:p=>resolve(file,'..',p),async load(){this.value=JSON.parse(await readFile(file,'utf8'));return this.value;},async save(value){this.value=value;await writeFile(file,JSON.stringify(value));}};
 const scheduler={stopped:true,start(){this.stopped=false},async stop(){this.stopped=true}};
 const ledger={get(){},records(){return []},usage(){return {records:[],totals:{calls:0}}}};
 return {config,scheduler,ledger,keys:{apiKey:'SAMPLE_PUBLIC_KEY',adminKey:'SAMPLE_PERSISTED_ADMIN'},credentials:{cache:new Map(),account:id=>config.value.accounts.find(a=>a.id===id),async resolve(){throw Error('SHOULD_NOT_RESOLVE_CREDENTIALS')}},platforms:{catalogs:new Map(),models:async()=>[]},router:{models:async()=>({data:[]}),async *chat(){yield {}},relay:{status:()=>({settings:{enabled:true},generationRequests:0})}},async close(){await scheduler.stop()}};
}`);
  await writeFile(join(src,'server.mjs'),`
import http from 'node:http';
export async function startServer(){const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end('{}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {key:'SAMPLE',baseUrl:'http://127.0.0.1:'+server.address().port,async close(){server.closeAllConnections();await new Promise(r=>server.close(r));}};}`);
  await writeFile(join(profile,'config.json'),JSON.stringify({schemaVersion:1,dataDir:'./data',accounts:[],upstreams:[],routes:[],server:{host:'127.0.0.1',port:0,allowRemote:false},scheduler:{enabled:false,startup:false,hour:0,minute:5,timezone:'Asia/Shanghai',jitterSeconds:60,maxConcurrency:2,windows:{}},workbuddy:{autoTasks:false,autoMigrateSessions:false}}));
  const enterpriseFile=join(home,'.box-agent-acme','config','auth.json');
  await mkdir(dirname(enterpriseFile),{recursive:true});
  await writeFile(enterpriseFile,JSON.stringify({access_token:token({name:'SAMPLE_ENTERPRISE',sub:'SAMPLE_ENTERPRISE_SUB',exp:4102444800}),refresh_token:'SAMPLE_REFRESH'}));
  const hub=await createHubRuntime({taskRoot:root,engineRoot:engine,nodeExecutable:process.execPath,enableBackgroundOperations:false,...(enterpriseIds===undefined?{}:{raccoonEnterpriseIds:enterpriseIds}),hostEnvironment:{HOME:home,USERPROFILE:home,USERNAME:'SAMPLE',APPDATA:join(home,'AppData','Roaming'),LOCALAPPDATA:join(home,'AppData','Local'),PUBLIC:join(root,'public')}});
  t.after(async()=>{await hub.close();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
  await hub.waitUntilReady({timeoutMs:10000});
  return {hub,root,profile,home,enterpriseFile};
}
const status=async hub=>(await hub.request({method:'GET',path:'/hub/discovery'})).body;

test('W2 an enterprise id from the plugin config is sanitized, reaches discovery through the real worker, and imports an enterprise account',async t=>{
  const f=await fixture(t,{enterpriseIds:['acme','second','../evil','con','OFFICE-RACCOON','.box-agent','ok.two']});
  assert.deepEqual(f.hub.options.raccoonEnterpriseIds,['acme','second'],'only the well-formed ids may survive the config boundary');
  await f.hub.request({method:'POST',path:'/hub/discovery',body:{connect:true}});
  const snapshot=await status(f.hub);
  const ids=snapshot.candidates.map(row=>row.id);
  assert.ok(ids.includes('raccoon-enterprise-acme'),'the configured enterprise id must produce a candidate');
  assert.ok(ids.includes('raccoon-enterprise-second'),'every configured id produces its own candidate');
  for(const bad of ['evil','con','office-raccoon','box-agent'])assert.equal(ids.includes('raccoon-enterprise-'+bad),false,`${bad} must never become a candidate`);
  const row=snapshot.candidates.find(entry=>entry.id==='raccoon-enterprise-acme');
  assert.equal(row.status,'imported','the seeded enterprise credential file is imported, not just listed');
  const config=JSON.parse(await readFile(join(f.profile,'config.json'),'utf8'));
  const account=config.accounts.find(entry=>entry.platform==='raccoon'&&entry.edition==='enterprise');
  assert.ok(account,'the imported enterprise login becomes its own account');
  assert.match(account.label,/企业版/);
  assert.ok(String(account.credentials.file).endsWith('auth.json'),'the account points at an isolated credential snapshot');
  // The enterprise source file is only ever read: it must not be rewritten.
  const source=JSON.parse(await readFile(f.enterpriseFile,'utf8'));
  assert.equal(source.refresh_token,'SAMPLE_REFRESH','the original enterprise credential file is untouched');
});

test('W2 without a configured id no enterprise directory is scanned at all',async t=>{
  const f=await fixture(t);
  assert.deepEqual(f.hub.options.raccoonEnterpriseIds,[]);
  await f.hub.request({method:'POST',path:'/hub/discovery',body:{connect:true}});
  const snapshot=await status(f.hub);
  assert.equal(snapshot.candidates.filter(row=>String(row.id).startsWith('raccoon-enterprise')).length,0,'nothing may be guessed from the file system');
});

test('W2 the id normalizer refuses traversal, separators, device names and the personal directories',async()=>{
  assert.deepEqual(normalizeEnterpriseIds(['Acme','acme',' second ','..','../evil','..\\evil','con','NUL','office-raccoon','.office-raccoon','.box-agent','com7','lpt9','a.b','acme.','<acme>','a/b','a\\b','a<b','',null,42,'x'.repeat(49),'x'.repeat(48)]),['acme','second','x'.repeat(48)]);
  assert.deepEqual(normalizeEnterpriseIds(undefined),[]);
  assert.deepEqual(normalizeEnterpriseIds('acme'),[]);
});

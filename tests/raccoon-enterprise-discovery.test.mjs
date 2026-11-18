import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createDiscovery,nativeCandidates,raccoonEnterpriseCandidate} from '../server/discovery.mjs';

// W2: raccoonEnterpriseCandidate used to be a builder no caller could reach — the
// `enterpriseIds` option of nativeCandidates had no origin. This proves the option now
// travels through createDiscovery: an id produces a real candidate, a scan of its
// credential file imports an enterprise account, and no id means no extra candidate.

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const write=async(file,value)=>{await mkdir(dirname(file),{recursive:true});await writeFile(file,typeof value==='string'?value:JSON.stringify(value));};
const parse=async file=>JSON.parse(await readFile(file,'utf8'));
const raccoonToken=name=>'SAMPLEHEADER.'+Buffer.from(JSON.stringify({name,exp:4102444800})).toString('base64url')+'.SAMPLESIGNATURE';
const sampleModels=[{id:'SAMPLE_MODEL',name:'Sample model',callable:true,contextWindow:32000,maxTokens:8192}];

async function fixture(t,{enterpriseIds,settings}={}){
  const dir=join(repo,'work/raccoon-enterprise',randomUUID()),root=join(dir,'TARGET'),home=join(dir,'HOME');
  const stateRoot=join(root,'runtime/profile'),dataDir=join(stateRoot,'data'),configFile=join(stateRoot,'config.json');
  await mkdir(dataDir,{recursive:true});
  const value={schemaVersion:1,dataDir,scheduler:{enabled:false,startup:false,hour:10,minute:0,jitterSeconds:600,timezone:'Asia/Shanghai'},server:{host:'127.0.0.1',port:0},accounts:[],upstreams:[],routes:[]};
  await write(configFile,value);
  const config={file:configFile,value,dataDir,path:p=>resolve(stateRoot,p),async load(){this.value=await parse(configFile);return this.value;},async save(next){await write(configFile,next);this.value=structuredClone(next);}};
  const service={config,credentials:{cache:new Map()},platforms:{catalogs:new Map(),async models(){return sampleModels;}},ledger:{get:()=>null,set(){},unbind(){},principalHash:()=>undefined}};
  const options={taskRoot:root,stateRoot,configFile,engineRoot:join(repo,'engine')};
  const hostEnvironment={HOME:home,USERPROFILE:home,USERNAME:'SAMPLE',APPDATA:join(home,'Roaming'),LOCALAPPDATA:join(home,'Local'),PUBLIC:join(home,'Public')};
  const discovery=createDiscovery({service,options,hostEnvironment,...(enterpriseIds?{enterpriseIds}:{}),...(settings?{settings}:{})});
  const enterpriseFile=join(home,'.box-agent-acme','config','auth.json');
  t.after(async()=>{await discovery.stop();await rm(dir,{recursive:true,force:true,maxRetries:5});});
  return {dir,home,stateRoot,config,service,discovery,enterpriseFile};
}

test('W2 an enterprise id reaches createDiscovery as a candidate instead of dying in a builder',async t=>{
  const f=await fixture(t,{enterpriseIds:['acme'],settings:()=>({raccoonDesktopReuse:true})});
  const rows=f.discovery.status().candidates??[];
  const ids=rows.map(row=>row.id);
  assert.ok(ids.includes('raccoon-enterprise-acme'),'the enterprise candidate must exist once its id is supplied');
  assert.ok(ids.includes('raccoon'),'the personal edition keeps its own candidate when desktop reuse is opted back in');
});

test('W2 a personal desktop candidate is absent by default while the enterprise candidate remains',async t=>{
  const f=await fixture(t,{enterpriseIds:['acme']});
  const ids=(f.discovery.status().candidates??[]).map(row=>row.id);
  assert.ok(ids.includes('raccoon-enterprise-acme'),'0.4.0 turns off the personal client read, not the enterprise opt-in');
  assert.equal(ids.includes('raccoon'),false,'the personal desktop login is not scanned unless discovery.raccoonDesktopReuse is true');
});

test('W2 without an enterprise id nothing enterprise-shaped is scanned',async t=>{
  const f=await fixture(t);
  const ids=(f.discovery.status().candidates??[]).map(row=>row.id);
  assert.equal(ids.filter(id=>id.startsWith('raccoon-enterprise')).length,0,'no implicit enterprise scan may be invented');
});

test('W2 an enterprise credential file is imported with the enterprise edition',async t=>{
  const f=await fixture(t,{enterpriseIds:['acme']});
  await write(f.enterpriseFile,{access_token:raccoonToken('SAMPLE_ACCOUNT'),refresh_token:'SAMPLE_REFRESH'});
  const status=await f.discovery.scan();
  const account=f.service.config.value.accounts.find(row=>row.platform==='raccoon'&&row.edition==='enterprise');
  assert.ok(account,'the enterprise login must land as its own account');
  assert.equal(account.platform,'raccoon');
  assert.equal(f.service.config.value.accounts.filter(row=>row.platform==='raccoon').length,1,'the personal edition has no file here, so exactly one raccoon account exists');
  const row=status.candidates.find(entry=>entry.id==='raccoon-enterprise-acme');
  assert.equal(row?.status,'imported');
  assert.equal(row?.accountId,account.id);
});

test('W2 the builder and the discovery candidate agree on the same source path',async t=>{
  const home=join(repo,'work/raccoon-enterprise','shape-'+randomUUID());
  const host={HOME:home,USERPROFILE:home,APPDATA:join(home,'Roaming')};
  const builder=raccoonEnterpriseCandidate(host,{enterpriseId:'Acme 42'});
  const fromList=nativeCandidates(host,{enterpriseIds:['Acme 42']}).find(row=>row.id==='raccoon-enterprise-acme-42');
  assert.ok(fromList,'the id must produce the candidate in the list');
  assert.equal(fromList.id,builder.id);
  assert.equal(fromList.label,builder.label);
  assert.deepEqual(fromList.paths,builder.paths);
  assert.ok(builder.markers.every(marker=>fromList.markers.includes(marker)),'the list keeps the builder markers, plus the installed-marker derived ones');
  assert.equal(builder.edition,'enterprise');
  assert.equal(builder.id,'raccoon-enterprise-acme-42');
});

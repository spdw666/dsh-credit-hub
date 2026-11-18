import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createDiscovery,nativeCandidates} from '../server/discovery.mjs';
import {validateOperationSettings,operationDefaults} from '../server/operations.mjs';

// Requirement A (0.4.0): a web-authorized Raccoon account is not a discovery
// candidate — no native file, no snapshot, no binding — yet it owns a model
// upstream, so discovery must still build its routes. Requirement B: the desktop
// client read is off by default and restored only by `discovery.raccoonDesktopReuse`.
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const write=async(file,value)=>{await mkdir(dirname(file),{recursive:true});await writeFile(file,typeof value==='string'?value:JSON.stringify(value));};
const parse=async file=>JSON.parse(await readFile(file,'utf8'));
const sampleModels=[
  {id:'SAMPLE_MODEL',name:'Sample model',callable:true,contextWindow:32000,maxTokens:8192},
  {id:'SAMPLE_OTHER',name:'Second model',callable:true,contextWindow:128000,maxTokens:4096},
  {id:'SAMPLE_NOT_CALLABLE',name:'Hidden model',callable:false,contextWindow:8000,maxTokens:1024},
];
const ACCOUNT='raccoon-oauth-6f1e2d3c4b5a',UPSTREAM='up-'+ACCOUNT,CREDENTIAL='private/raccoon-oauth/'+ACCOUNT+'.json';

async function fixture(overrides={}){
  const dir=join(project,'work/discovery-oauth-routes',randomUUID()),root=join(dir,'TARGET'),home=join(dir,'HOME');
  const stateRoot=join(root,'runtime/profile'),dataDir=join(stateRoot,'data'),configFile=join(stateRoot,'config.json');
  await mkdir(dataDir,{recursive:true});
  const value={schemaVersion:1,dataDir,scheduler:{enabled:false,startup:false,hour:10,minute:0,jitterSeconds:600,timezone:'Asia/Shanghai'},server:{host:'127.0.0.1',port:0},accounts:[{id:ACCOUNT,platform:'raccoon',label:'小浣熊（网页授权）',enabled:true,inferenceEnabled:true,edition:'personal',credentials:{kind:'oauth',authKind:'oauth_iam',file:CREDENTIAL},tasks:[{id:'daily-quota',enabled:true}]}],upstreams:[{id:UPSTREAM,kind:'raccoon',accountId:ACCOUNT,enabled:true}],routes:[]};
  await write(configFile,value);
  const config={file:configFile,value,dataDir,path:p=>resolve(stateRoot,p),async load(){this.value=await parse(configFile);return this.value;},async save(next){await write(configFile,next);this.value=structuredClone(next);}};
  const catalogs=[],failures=new Map();
  const service={config,credentials:{cache:new Map()},platforms:{catalogs:new Map(),async models(id){catalogs.push(id);const failure=failures.get(id);if(failure)throw failure;return sampleModels;}}};
  const options={taskRoot:root,stateRoot,configFile,engineRoot:join(project,'engine')};
  const hostEnvironment={HOME:home,USERPROFILE:home,USERNAME:'SAMPLE',APPDATA:join(home,'Roaming'),LOCALAPPDATA:join(home,'Local'),PUBLIC:join(home,'Public')};
  let clock=Date.parse('2026-11-18T08:00:00.000Z');
  const d=createDiscovery({service,options,hostEnvironment,extraCandidates:[],onEvent:()=>{},now:()=>clock,...(overrides.settings?{settings:overrides.settings}:{}),...(overrides.fetchModels?{fetchModels:overrides.fetchModels}:{})});
  const credentialFile=()=>join(stateRoot,CREDENTIAL);
  const hour=()=>{clock+=3600000;};
  const clean=async()=>{await d.stop();await rm(dir,{recursive:true,force:true,maxRetries:5});};
  return {dir,root,home,stateRoot,dataDir,configFile,config,service,options,hostEnvironment,d,catalogs,failures,credentialFile,hour,clean};
}

test('A-1 a web-authorized account gets oauth routes that call its own upstream',async()=>{
  const f=await fixture();try{
    const status=await f.d.scan();
    const routes=f.config.value.routes;
    assert.equal(routes.length,2,'one route per callable catalog model');
    assert.ok(f.catalogs.includes(UPSTREAM),'the catalog is fetched through the account upstream, so the adapter picks the OAuth bearer');
    const route=routes.find(r=>r.targets[0].model==='SAMPLE_MODEL');
    assert.match(route.id,/^oauth-route-[a-f0-9]{24}$/,'oauth routes stay distinguishable from discovered-route-* ids');
    assert.equal(route.name,'小浣熊 · Sample model');
    assert.deepEqual(route.targets,[{upstreamId:UPSTREAM,model:'SAMPLE_MODEL'}]);
    assert.equal(route.enabled,true);
    assert.equal(route.discovered,true);
    assert.ok(routes.every(r=>r.targets.every(t=>t.upstreamId===UPSTREAM)));
    assert.equal(routes.some(r=>r.targets[0].model==='SAMPLE_NOT_CALLABLE'),false,'non-callable models never become routes');
    const summary=status.oauthRoutes.find(row=>row.accountId===ACCOUNT);
    assert.deepEqual({routeCount:summary.routeCount,catalogStatus:summary.catalogStatus},{routeCount:2,catalogStatus:'ready'});
    assert.equal(summary.upstreamId,UPSTREAM);
    // The account itself is not a candidate: no row, no binding, no snapshot.
    assert.equal((status.candidates??[]).some(row=>row.id===ACCOUNT),false,'web authorization never enters the candidate table');
    assert.equal(status.oauthRoutes.length,1,'exactly one web-authorized account is summarised');
    assert.equal(typeof summary.checkedAt,'string','the refresh timestamp is surfaced');
  }finally{await f.clean();}
});

test('A-2 a second refresh is idempotent and never overwrites a user-edited route',async()=>{
  const f=await fixture();try{
    await f.d.scan();
    const route=f.config.value.routes.find(r=>r.targets[0].model==='SAMPLE_MODEL');
    // The user renames and disables a generated route; discovery must not "repair" it.
    route.name='我的主力模型';route.enabled=false;
    await f.config.save(structuredClone(f.config.value));
    f.hour();
    const status=await f.d.scan();
    const routes=f.config.value.routes;
    assert.equal(routes.length,2,'a repeated refresh adds no duplicate route');
    const kept=routes.find(r=>r.id===route.id);
    assert.equal(kept.name,'我的主力模型');
    assert.equal(kept.enabled,false);
    assert.equal(status.oauthRoutes.find(row=>row.accountId===ACCOUNT).routeCount,2);
    assert.equal(f.catalogs.filter(id=>id===UPSTREAM).length,2,'the second scan really refreshed the catalog');
  }finally{await f.clean();}
});

test('A-3 oauth credentials and data/discovered stay byte-identical across route refreshes',async()=>{
  const f=await fixture();try{
    const document={schemaVersion:1,authKind:'oauth_iam',source:'raccoon_oauth_loopback',access_token:'SAMPLE_HEADER.SAMPLE_PAYLOAD.SAMPLE_SIGNATURE',refresh_token:'SAMPLE_REFRESH_TOKEN'};
    await write(f.credentialFile(),document);
    const before=await readFile(f.credentialFile());
    const accountBefore=JSON.stringify(f.config.value.accounts.find(a=>a.id===ACCOUNT));
    for(let n=0;n<3;n++){f.hour();await f.d.scan();}
    assert.deepEqual(await readFile(f.credentialFile()),before,'requirement A must never rewrite the OAuth credential file');
    assert.equal(JSON.stringify(f.config.value.accounts.find(a=>a.id===ACCOUNT)),accountBefore,'credentials.file/kind/authKind and tasks are untouched');
    assert.equal(f.config.value.accounts.length,1,'no second account is created for the same principal');
    const discovered=await readdir(f.dataDir).catch(()=>[]);
    assert.equal(discovered.includes('discovered'),false,'discovery never writes a snapshot for a web-authorized account');
    // The private directory still holds exactly the file the authorization wrote — no
    // staging copy, no second file, no rename churn from the route refreshes.
    assert.deepEqual(await readdir(join(f.stateRoot,'private','raccoon-oauth')),['raccoon-oauth-6f1e2d3c4b5a.json']);
  }finally{await f.clean();}
});

test('A-4 refreshOauthAccount builds routes immediately for a just-committed account',async()=>{
  const f=await fixture();try{
    const summary=await f.d.refreshOauthAccount(ACCOUNT);
    assert.equal(summary.routeCount,2);
    assert.equal(summary.catalogStatus,'ready');
    assert.equal(f.config.value.routes.length,2,'the post-authorization trigger does not wait for the next interval');
    assert.equal(f.config.value.routes[0].enabled,true);
    assert.equal(await f.d.refreshOauthAccount('raccoon-oauth-000000000000'),null,'an unknown account is a no-op');
  }finally{await f.clean();}
});

test('A-5 a failing catalog is reported without deleting or duplicating routes',async()=>{
  const f=await fixture();try{
    await f.d.scan();
    const count=f.config.value.routes.length;
    f.failures.set(UPSTREAM,Object.assign(new Error('catalog offline'),{code:'raccoon_catalog_unreachable'}));
    f.hour();
    const status=await f.d.scan();
    assert.equal(f.config.value.routes.length,count,'an unreachable catalog keeps the routes that already exist');
    const summary=status.oauthRoutes.find(row=>row.accountId===ACCOUNT);
    assert.equal(summary.catalogStatus,'error');
    assert.equal(summary.catalogReason,'raccoon_catalog_unreachable');
  }finally{await f.clean();}
});

test('A-6 autoEnableRoutes=false creates the routes disabled',async()=>{
  const f=await fixture({settings:()=>({autoEnableRoutes:false})});try{
    await f.d.scan();
    assert.equal(f.config.value.routes.length,2);
    assert.ok(f.config.value.routes.every(route=>route.enabled===false));
  }finally{await f.clean();}
});

test('B-1 the desktop client is not scanned by default',async()=>{
  const f=await fixture({
    settings:()=>({}),
  });try{
    // Even with a signed-in desktop client on disk, the default scan must not adopt it.
    await write(join(f.home,'.office-raccoon','agent','config','auth.json'),{access_token:'SAMPLE_HEADER.SAMPLE_PAYLOAD.SAMPLE_SIGNATURE'});
    const status=await f.d.scan();
    assert.equal(status.settings.raccoonDesktopReuse,false,'the default is an explicit false, not an absent key');
    assert.equal((status.candidates??[]).some(row=>row.id==='raccoon'),false,'no desktop raccoon row is reported');
    assert.equal(f.config.value.accounts.filter(a=>a.platform==='raccoon').length,1,'the only raccoon account is the web-authorized one');
    assert.equal(f.config.value.accounts.some(a=>a.credentials?.kind==='desktop'),false,'no desktop credential is copied');
    assert.deepEqual(await readdir(f.dataDir).then(names=>names.sort()),[],'nothing is staged under data/');
  }finally{await f.clean();}
});

test('B-2 raccoonDesktopReuse=true restores the desktop candidate and its import',async()=>{
  const f=await fixture({settings:()=>({raccoonDesktopReuse:true})});try{
    const token='SAMPLEHEADER.'+Buffer.from(JSON.stringify({name:'SAMPLE_ACCOUNT',exp:4102444800})).toString('base64url')+'.SAMPLESIGNATURE';
    await write(join(f.home,'.office-raccoon','agent','config','auth.json'),{access_token:token});
    const status=await f.d.scan();
    assert.equal(status.settings.raccoonDesktopReuse,true);
    const row=(status.candidates??[]).find(item=>item.id==='raccoon');
    assert.ok(row,'the opt-in brings the personal candidate back');
    assert.equal(row.status,'imported');
    assert.equal(row.accountId,f.config.value.accounts.find(a=>a.credentials?.kind==='desktop')?.id);
    assert.equal(f.config.value.accounts.length,2,'web-authorized and desktop accounts coexist');
    assert.equal(f.config.value.routes.filter(r=>String(r.id).startsWith('oauth-route-')).length,2,'the web-authorized routes are unaffected by the desktop import');
  }finally{await f.clean();}
});

test('B-3 the desktop enumerator keeps its full list for manual import and diagnostics',()=>{
  const host={HOME:'D:/SAMPLE/HOME',USERPROFILE:'D:/SAMPLE/HOME',APPDATA:'D:/SAMPLE/Roaming'};
  assert.ok(nativeCandidates(host).some(c=>c.id==='raccoon'),'scripts/import-local.mjs and diagnostics still see the desktop entry');
  assert.ok(nativeCandidates(host,{raccoonDesktopReuse:true}).some(c=>c.id==='raccoon'));
  assert.equal(nativeCandidates(host,{raccoonDesktopReuse:false}).some(c=>c.id==='raccoon'),false);
  assert.ok(nativeCandidates(host,{raccoonDesktopReuse:false}).length>0,'only the raccoon row is gated');
});

test('B-4 operations settings register the switch and keep the document valid',()=>{
  assert.equal(operationDefaults.discovery.raccoonDesktopReuse,false);
  const next=validateOperationSettings({discovery:{raccoonDesktopReuse:true}});
  assert.equal(next.discovery.raccoonDesktopReuse,true);
  assert.equal(next.discovery.enabled,true,'a single-key PATCH keeps every other discovery default');
  assert.equal(next.discovery.intervalSeconds,operationDefaults.discovery.intervalSeconds);
  // A non-boolean is a discovery error, never an unknown-section 400 and never a silent coerce.
  assert.throws(()=>validateOperationSettings({discovery:{raccoonDesktopReuse:'yes'}}),{code:'invalid_discovery_settings'});
  assert.throws(()=>validateOperationSettings({discovery:{raccoonDesktopReuse:1}}),{code:'invalid_discovery_settings'});
  assert.throws(()=>validateOperationSettings({discoveryDesktopReuse:true}),{code:'invalid_operations_settings'});
});

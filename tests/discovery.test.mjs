import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,rm,readdir,symlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {createDiscovery,nativeCandidates,captureHostEnvironment} from '../server/discovery.mjs';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const digest=value=>createHash('sha256').update(value).digest('hex');
const write=async(file,value)=>{await mkdir(dirname(file),{recursive:true});await writeFile(file,typeof value==='string'?value:JSON.stringify(value));};
const parse=async file=>JSON.parse(await readFile(file,'utf8'));
const auth=(principal='SAMPLE_ACCOUNT',token='SAMPLE_TOKEN_1')=>({auth:{accessToken:token,refreshToken:'SAMPLE_REFRESH',domain:'www.workbuddy.cn',expiresAt:4000000000000},account:{uid:principal}});
const sampleModels=[{id:'SAMPLE_MODEL',name:'Sample model',callable:true,contextWindow:32000,maxTokens:8192}];
async function fixture(overrides={}) {
  const dir=join(project,'work/discovery-tests',randomUUID()),root=join(dir,'TARGET'),native=join(dir,'SAMPLE_NATIVE');
  const home=join(native,'HOME'),stateRoot=join(root,'runtime/profile'),dataDir=join(stateRoot,'data'),configFile=join(stateRoot,'config.json'),file=join(native,'Agent/auth.info');
  await mkdir(dataDir,{recursive:true});
  const value={schemaVersion:1,dataDir,scheduler:{enabled:false,startup:false,hour:10,minute:0,jitterSeconds:600,timezone:'Asia/Shanghai'},server:{host:'127.0.0.1',port:0},accounts:[],upstreams:[],routes:[]};
  await write(configFile,value);
  const events=[],saves=[],catalogs=[];
  const config={file:configFile,value,dataDir,path:p=>resolve(stateRoot,p),async load(){this.value=await parse(configFile);return this.value;},async save(next){saves.push(structuredClone(next));await write(configFile,next);this.value=structuredClone(next);}};
  const service={config,credentials:{cache:new Map()},platforms:{catalogs:new Map(),async models(id,args){catalogs.push(id);return sampleModels;}}};
  const options={taskRoot:root,stateRoot,configFile,engineRoot:fileURLToPath(new URL('../engine/',import.meta.url))};
  const hostEnvironment={HOME:home,USERPROFILE:home,USERNAME:'SAMPLE',APPDATA:join(home,'Roaming'),LOCALAPPDATA:join(home,'Local'),PUBLIC:join(home,'Public')};
  const extraCandidates=[{id:'sample-agent',platform:'workbuddy',label:'SAMPLE Agent',paths:[file],markers:[dirname(file)]}];
  const d=createDiscovery({service,options,hostEnvironment,extraCandidates,onEvent:event=>events.push(event),...overrides});
  return {dir,root,native,home,file,stateRoot,dataDir,configFile,config,service,options,hostEnvironment,extraCandidates,d,events,saves,catalogs,clean:async()=>{await d.stop();await rm(dir,{recursive:true,force:true});}};
}
const row=(status,id='sample-agent')=>status.candidates.find(c=>c.id===id);

test('host environment capture and exact candidates exclude gateway/DSH stores',()=>{
  const host=captureHostEnvironment({APPDATA:'D:/SAMPLE/Roaming',LOCALAPPDATA:'D:/SAMPLE/Local',USERPROFILE:'D:/SAMPLE',PUBLIC:'D:/Public'},{home:'D:/SAMPLE',username:'SAMPLE'});
  assert.equal(host.APPDATA,'D:/SAMPLE/Roaming');assert.equal(host.HOME,'D:/SAMPLE');
  const candidates=nativeCandidates(host);assert.ok(candidates.length>=20);assert.ok(candidates.some(c=>c.platform==='raccoon'));assert.ok(candidates.some(c=>c.platform==='codearts'));
  assert.ok(!JSON.stringify(candidates).includes('.ai-credit-gateway'));assert.ok(!JSON.stringify(candidates).includes('.dsh'));
});

test('late install -> missing/login required -> real offline import -> upstream and verified route',async()=>{
  const f=await fixture();try{
    assert.equal(row(await f.d.scan()).status,'missing');
    await mkdir(dirname(f.file),{recursive:true});assert.equal(row(await f.d.scan()).status,'not_logged_in');
    await write(f.file,auth());const before=digest(await readFile(f.file));
    const imported=row(await f.d.scan());assert.equal(imported.status,'imported');assert.equal(imported.catalogStatus,'ready');assert.equal(imported.routeCount,1);
    assert.equal(f.config.value.accounts.length,1);assert.equal(f.config.value.upstreams.length,1);assert.equal(f.config.value.routes.length,1);assert.equal(f.config.value.routes[0].enabled,true);
    const account=f.config.value.accounts[0];assert.equal(account.credentials.kind,'file');assert.equal(account.credentials.autoLaunch,false);assert.ok(account.credentials.file.startsWith(f.dataDir));assert.deepEqual(account.tasks,[{id:'daily-checkin',enabled:true}]);
    assert.equal((await parse(account.credentials.file)).accessToken,'SAMPLE_TOKEN_1');assert.equal(digest(await readFile(f.file)),before);
    const summary=JSON.stringify(f.d.status());for(const secret of ['SAMPLE_TOKEN_1','SAMPLE_REFRESH','SAMPLE_ACCOUNT',f.file])assert.ok(!summary.includes(secret));
    await f.d.scan();assert.equal(f.config.value.accounts.length,1);assert.equal(f.catalogs.length,1);assert.equal(digest(await readFile(f.file)),before);
  }finally{await f.clean();}
});

test('discovery polling catches files appearing after startup and stop clears its timer',async()=>{
  let tick,cleared=0;const f=await fixture({setIntervalImpl:fn=>{tick=fn;return {unref(){}};},clearIntervalImpl:()=>cleared++});
  try{f.d.start();await f.d.scan();assert.equal(row(f.d.status()).status,'missing');await write(f.file,auth());tick();await f.d.scan();assert.equal(row(f.d.status()).status,'imported');const count=f.d.status().scanCount;await f.d.stop();assert.equal(cleared,1);assert.equal(f.d.status().running,false);assert.equal(f.d.status().scanCount,count);}finally{await f.clean();}
});

test('same-principal native credential rotation preserves every existing toggle and label',async()=>{
  const f=await fixture();try{
    await write(f.file,auth());await f.d.scan();
    const a=f.config.value.accounts[0],oldFile=a.credentials.file;a.enabled=false;a.inferenceEnabled=false;a.label='SAMPLE user choice';a.tasks=[{id:'daily-checkin',enabled:false}];f.config.value.upstreams[0].enabled=false;f.config.value.routes[0].enabled=false;await f.config.save(f.config.value);
    await write(f.file,auth('SAMPLE_ACCOUNT','SAMPLE_ROTATED_TOKEN'));const result=row(await f.d.scan());
    assert.equal(result.status,'changed');assert.equal(f.config.value.accounts.length,1);assert.equal(f.config.value.accounts[0].enabled,false);assert.equal(f.config.value.accounts[0].inferenceEnabled,false);assert.equal(f.config.value.accounts[0].label,'SAMPLE user choice');assert.deepEqual(f.config.value.accounts[0].tasks,[{id:'daily-checkin',enabled:false}]);assert.equal(f.config.value.upstreams[0].enabled,false);assert.equal(f.config.value.routes[0].enabled,false);
    assert.notEqual(f.config.value.accounts[0].credentials.file,oldFile);assert.equal((await parse(oldFile)).accessToken,'SAMPLE_TOKEN_1');assert.equal((await parse(f.config.value.accounts[0].credentials.file)).accessToken,'SAMPLE_ROTATED_TOKEN');assert.equal(f.catalogs.length,1);
  }finally{await f.clean();}
});

test('native account switch creates a different binding without rebinding the previous account',async()=>{
  const f=await fixture();try{await write(f.file,auth());await f.d.scan();const first=structuredClone(f.config.value.accounts[0]);await write(f.file,auth('SAMPLE_SECOND_ACCOUNT','SAMPLE_SECOND_TOKEN'));await f.d.scan();assert.equal(f.config.value.accounts.length,2);assert.deepEqual(f.config.value.accounts[0],first);assert.equal((await parse(first.credentials.file)).principal,'SAMPLE_ACCOUNT');assert.equal(f.config.value.routes.length,2);}finally{await f.clean();}
});

test('already migrated native identity is deduplicated even when JSON layout and edition defaults differ',async()=>{
  const f=await fixture();try{
    await write(f.file,auth());const owned=join(f.dataDir,'accounts/SAMPLE/workbuddy-session.json');await write(owned,{principal:'SAMPLE_ACCOUNT',accessToken:'SAMPLE_OLDER_TOKEN',refreshToken:'SAMPLE_REFRESH',expiresAtMs:4000000000000});
    f.config.value.accounts.push({id:'SAMPLE',platform:'workbuddy',edition:'cn',label:'SAMPLE existing',enabled:true,inferenceEnabled:false,credentials:{kind:'file',file:owned}});await f.config.save(f.config.value);
    assert.equal(row(await f.d.scan()).status,'changed');assert.equal(f.config.value.accounts.length,1);assert.equal(f.config.value.accounts[0].id,'SAMPLE');assert.equal(f.config.value.accounts[0].inferenceEnabled,false);assert.equal(f.config.value.accounts[0].tasks,undefined,'credential refresh does not silently migrate existing task choices');assert.equal(f.catalogs.length,0);
  }finally{await f.clean();}
});

test('deduplicating expired migrated WB identity never consumes its refresh token',async()=>{
  const f=await fixture();const originalFetch=globalThis.fetch;let requests=0;
  try{globalThis.fetch=async()=>{requests++;throw Error('SAMPLE_NETWORK_MUST_NOT_RUN');};await write(f.file,auth());const owned=join(f.dataDir,'accounts/SAMPLE/workbuddy-session.json');await write(owned,{principal:'SAMPLE_ACCOUNT',accessToken:'SAMPLE_EXPIRED_TOKEN',refreshToken:'SAMPLE_REFRESH',expiresAtMs:1});
    f.config.value.accounts.push({id:'SAMPLE',platform:'workbuddy',enabled:true,inferenceEnabled:false,credentials:{kind:'file',file:owned}});await f.config.save(f.config.value);
    await f.d.scan();assert.equal(f.config.value.accounts.length,1);assert.equal(f.config.value.accounts[0].id,'SAMPLE');assert.equal(requests,0);assert.equal((await parse(owned)).accessToken,'SAMPLE_EXPIRED_TOKEN');
  }finally{globalThis.fetch=originalFetch;await f.clean();}
});

test('parallel scans are single-flight; recreated discovery uses persisted identity bindings',async()=>{
  const f=await fixture();try{await write(f.file,auth());await Promise.all(Array.from({length:12},()=>f.d.scan()));assert.equal(f.d.status().scanCount,1);assert.equal(f.config.value.accounts.length,1);const count=f.catalogs.length;const d2=createDiscovery({service:f.service,options:f.options,hostEnvironment:f.hostEnvironment,extraCandidates:f.extraCandidates});await d2.scan();assert.equal(f.config.value.accounts.length,1);assert.equal(f.catalogs.length,count);await d2.stop();}finally{await f.clean();}
});

test('disabling auto routes creates disabled routes; changing policy never overwrites existing selections',async()=>{
  let settings={autoEnableRoutes:false};const f=await fixture({settings:()=>settings});try{await write(f.file,auth());await f.d.scan();assert.equal(f.config.value.routes[0].enabled,false);settings={autoEnableRoutes:true};await f.d.scan();assert.equal(f.config.value.routes[0].enabled,false);assert.equal(row(f.d.status()).catalogStatus,'ready');}finally{await f.clean();}
});

test('native source CAS changes abort import without partial configuration',async()=>{
  let flip=1;const f=await fixture({hooks:{afterRead:async()=>{await write(f.file,auth('SAMPLE_ACCOUNT','SAMPLE_TOKEN_'+(++flip)));}}});try{await write(f.file,auth());const result=row(await f.d.scan());assert.equal(result.status,'needs_setup');assert.equal(result.reason,'discovery_source_changed');assert.equal(f.config.value.accounts.length,0);}finally{await f.clean();}
});

test('source changed just before snapshot publication aborts configuration and cleans staging',async()=>{
  const f=await fixture({hooks:{beforeSnapshotCommit:async()=>write(f.file,auth('SAMPLE_ACCOUNT','SAMPLE_LATER_TOKEN'))}});try{await write(f.file,auth());assert.equal(row(await f.d.scan()).reason,'discovery_source_changed');assert.equal(f.config.value.accounts.length,0);const dirs=await readdir(join(f.dataDir,'discovered'));assert.ok(!dirs.some(n=>n.startsWith('.stage-')));}finally{await f.clean();}
});

test('original gateway/DSH paths are rejected as native sources',async()=>{
  const f=await fixture();try{const forbidden=join(f.native,'.dsh/auth.json');await write(forbidden,auth());const d=createDiscovery({service:f.service,options:f.options,hostEnvironment:f.hostEnvironment,extraCandidates:[{id:'forbidden',platform:'workbuddy',label:'SAMPLE',paths:[forbidden]}]});const result=row(await d.scan(),'forbidden');assert.equal(result.status,'error');assert.equal(result.reason,'discovery_native_source_rejected');assert.equal(f.config.value.accounts.length,0);await d.stop();}finally{await f.clean();}
});

test('output junction cannot redirect credential snapshots outside taskRoot',async()=>{
  const f=await fixture();try{await write(f.file,auth());const other=join(f.dir,'SAMPLE_OUTSIDE');await mkdir(other);await symlink(other,join(f.dataDir,'discovered'),process.platform==='win32'?'junction':'dir');const result=row(await f.d.scan());assert.equal(result.status,'error');assert.equal(result.reason,'output_symlink_rejected');assert.deepEqual(await readdir(other),[]);assert.equal(f.config.value.accounts.length,0);}finally{await f.clean();}
});

test('SQLite + WAL snapshots are readable without opening or changing native database',async()=>{
  const {DatabaseSync}=await import('node:sqlite');const f=await fixture();let db;try{
    const file=join(f.native,'LobsterAI/lobsterai.sqlite');await mkdir(dirname(file),{recursive:true});db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE kv (key TEXT PRIMARY KEY,value TEXT);');const stmt=db.prepare('INSERT INTO kv VALUES (?,?)');stmt.run('auth_tokens',JSON.stringify({accessToken:'SAMPLE_DB_TOKEN'}));stmt.run('auth_user',JSON.stringify({yid:'SAMPLE_DB_ACCOUNT'}));
    const before=await Promise.all([file,file+'-wal'].map(async p=>digest(await readFile(p))));
    const d=createDiscovery({service:f.service,options:f.options,hostEnvironment:f.hostEnvironment,extraCandidates:[{id:'sqlite-agent',platform:'lobster',label:'SAMPLE SQLite',paths:[file]}]});
    const result=row(await d.scan(),'sqlite-agent');assert.equal(result.status,'imported');assert.equal(result.catalogStatus,'ready');const owned=f.config.value.accounts[0].credentials.file;assert.notEqual(owned,file);assert.ok((await readFile(owned+'-wal')).length>0);assert.deepEqual(await Promise.all([file,file+'-wal'].map(async p=>digest(await readFile(p)))),before);await d.stop();
  }finally{db?.close();await f.clean();}
});

test('late installed Cline and ZCode use their actual offline parsers without generation/refresh calls',async()=>{
  const f=await fixture();const originalFetch=globalThis.fetch;let network=0;
  try{globalThis.fetch=async()=>{network++;throw Error('SAMPLE_NO_NETWORK');};const jwt='eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify({sub:'SAMPLE_STABLE_SUB',user_id:'SAMPLE_STABLE_SUB',exp:4000000000})).toString('base64url')+'.SAMPLE';
    const cline=join(f.native,'Cline/providers.json'),zcode=join(f.native,'ZCode/credentials.json');
    await write(cline,{providers:{cline:{settings:{auth:{accessToken:jwt,refreshToken:'SAMPLE_RT',expiresAt:4000000000000}}}}});await write(zcode,{zcodejwttoken:jwt});await write(join(dirname(zcode),'telemetry-state.json'),{deviceMid:'SAMPLE_DEVICE'});
    const d=createDiscovery({service:f.service,options:f.options,hostEnvironment:f.hostEnvironment,extraCandidates:[{id:'sample-cline',platform:'cline',label:'SAMPLE Cline',paths:[cline]},{id:'sample-zcode',platform:'zcode',label:'SAMPLE ZCode',paths:[zcode]}]});const result=await d.scan();assert.equal(row(result,'sample-cline').status,'imported');assert.equal(row(result,'sample-zcode').status,'imported');assert.equal(f.config.value.accounts.length,2);assert.equal(f.config.value.routes.length,2);assert.equal(network,0);assert.equal((await parse(zcode)).zcodejwttoken,jwt);await d.stop();
  }finally{globalThis.fetch=originalFetch;await f.clean();}
});

test('Trae retains User/globalStorage layout, machineid and latest active-device log for multiple historical identities',async()=>{
  const f=await fixture();try{
    const profile=join(f.hostEnvironment.APPDATA,'Trae CN'),file=join(profile,'User/globalStorage/storage.json'),machine=join(profile,'machineid'),oldLog=join(profile,'logs/20261017T120000/main.log'),log=join(profile,'logs/20261018T120000/main.log');
    const raw={'iCubeAuthInfo://icube.cloudide':JSON.stringify({token:'SAMPLE_TRAE_TOKEN',userId:'SAMPLE_TRAE_USER',expiredAt:4000000000000}), 'iCubeAuthInfo://icube-dc:123450001':{},'iCubeAuthInfo://icube-dc:123450002':{}};
    await write(file,raw);await write(machine,'SAMPLE_STABLE_MACHINE');await write(oldLog,'[ICDRS] (init) initialization done, did: 123450001, SAMPLE\n');await write(log,'[ICDRS] (init) initialization done, did: 123450002, SAMPLE\n');
    const sources=[file,machine,oldLog,log],before=await Promise.all(sources.map(async p=>digest(await readFile(p))));
    const result=row(await f.d.scan(),'trae-cn');assert.equal(result.status,'imported');assert.equal(result.catalogStatus,'ready');
    const account=f.config.value.accounts.find(a=>a.platform==='trae');assert.ok(account.credentials.file.endsWith(join('User/globalStorage','storage.json')));assert.equal(await readFile(join(account.credentials.profileDir,'machineid'),'utf8'),'SAMPLE_STABLE_MACHINE');assert.equal(await readFile(join(account.credentials.profileDir,'logs/20261018T120000/main.log'),'utf8'),await readFile(log,'utf8'));assert.deepEqual(await readdir(join(account.credentials.profileDir,'logs')),['20261018T120000']);
    const {readTraeIdentity}=await import('../engine/vendor/trae-core.mjs');const identity=await readTraeIdentity({path:account.credentials.file,edition:'cn'});assert.equal(identity.machineId,'SAMPLE_STABLE_MACHINE');assert.equal(identity.deviceId,'123450002');
    assert.deepEqual(await Promise.all(sources.map(async p=>digest(await readFile(p)))),before);
  }finally{await f.clean();}
});

test('Trae ambiguous historical identities without active-device log have explicit setup status',async()=>{
  const f=await fixture();try{const profile=join(f.hostEnvironment.APPDATA,'TRAE SOLO CN');await write(join(profile,'User/globalStorage/storage.json'),{'iCubeAuthInfo://icube.cloudide':JSON.stringify({token:'SAMPLE_TRAE_TOKEN',userId:'SAMPLE_TRAE_USER',expiredAt:4000000000000}),'iCubeAuthInfo://icube-dc:123450001':{},'iCubeAuthInfo://icube-dc:123450002':{}});await write(join(profile,'machineid'),'SAMPLE_STABLE_MACHINE');const result=row(await f.d.scan(),'trae-solo');assert.equal(result.status,'needs_setup');assert.equal(result.reason,'trae_active_device_metadata_required');assert.equal(f.config.value.accounts.length,0);}finally{await f.clean();}
});

test('expired, encrypted, incomplete and blocked native formats remain explicit setup/login states',async()=>{
  const f=await fixture();try{
    await write(f.file,{auth:{accessToken:{$wbEncrypted:1,envelope:'SAMPLE'}},account:{uid:'SAMPLE'}});assert.equal(row(await f.d.scan()).status,'needs_setup');assert.equal(f.config.value.accounts.length,0);
    await write(f.file,{auth:{accessToken:'SAMPLE_EXPIRED',expiresAt:1},account:{uid:'SAMPLE'}});assert.match(row(await f.d.scan()).reason,/^credential_expired/);assert.equal(f.config.value.accounts.length,0);
    await write(f.file,{});assert.equal(row(await f.d.scan()).status,'not_logged_in');assert.equal(f.config.value.accounts.length,0);
    const path=nativeCandidates(f.hostEnvironment).find(c=>c.id==='qoder-cn').paths[0];await write(path,'SAMPLE_ENCRYPTED');assert.equal(row(await f.d.scan(),'qoder-cn').reason,'qoder_native_identity_required');assert.equal(f.config.value.accounts.length,0);
  }finally{await f.clean();}
});

test('catalog failure imports credentials once, emits a bounded event and retries only after throttle',async()=>{
  let clock=2000000000000,calls=0;const f=await fixture({now:()=>clock,fetchModels:async()=>{calls++;throw Object.assign(new Error('SAMPLE_TOKEN_NEVER_PUBLIC'),{code:'SAMPLE_CATALOG_FAILED'});}});try{await write(f.file,auth());const result=row(await f.d.scan());assert.equal(result.status,'imported');assert.equal(result.catalogStatus,'error');assert.equal(f.config.value.accounts.length,1);assert.equal(f.config.value.routes.length,0);await f.d.scan();assert.equal(calls,1);clock+=31*60000;await f.d.scan();assert.equal(calls,2);assert.ok(!JSON.stringify(f.events).includes('SAMPLE_TOKEN_NEVER_PUBLIC'));}finally{await f.clean();}
});

test('stop during catalog prevents late route writes and isolates sink failures',async()=>{
  let finish,started;const waiting=new Promise(resolve=>started=resolve);const f=await fixture({fetchModels:async()=>{started();return new Promise(resolve=>finish=resolve);},onEvent:()=>{throw Error('SAMPLE sink offline');}});try{await write(f.file,auth());const scanning=f.d.scan();await waiting;const stopping=f.d.stop();finish(sampleModels);await Promise.all([scanning,stopping]);assert.equal(f.config.value.routes.length,0);assert.equal(f.d.status().running,false);}finally{await f.clean();}
});

test('explicit updateConfig callback merges a concurrent latest user edit',async()=>{
  let f;f=await fixture({updateConfig:async mutator=>{await f.config.load();f.config.value.userChoice='SAMPLE_LATEST_USER_EDIT';const next=structuredClone(f.config.value);const changed=await mutator(next);if(changed!==false)await f.config.save(next);}});try{await write(f.file,auth());await f.d.scan();assert.equal(f.config.value.userChoice,'SAMPLE_LATEST_USER_EDIT');assert.equal(f.config.value.accounts.length,1);assert.equal(f.config.value.routes.length,1);}finally{await f.clean();}
});

test('manual scan without connect is detection only and targeted import returns its candidate',async()=>{
  const f=await fixture();try{await write(f.file,auth());assert.equal(row(await f.d.scan({connect:false})).status,'installed');assert.equal(f.config.value.accounts.length,0);assert.equal(f.catalogs.length,0);assert.equal((await f.d.importCandidate('sample-agent')).status,'imported');await assert.rejects(f.d.importCandidate('missing-id'),{code:'discovery_candidate_not_found'});}finally{await f.clean();}
});

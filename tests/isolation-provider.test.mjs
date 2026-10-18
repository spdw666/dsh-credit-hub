import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm,readdir,access} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const baseline=process.env.ISOLATION_PROVIDER_BASELINE==='1';
const source=process.env.ISOLATION_PROVIDER_SOURCE??(baseline?join(root,'work/isolation-provider-baseline'):fileURLToPath(new URL('../engine/src/',import.meta.url)));
const hash=x=>createHash('sha256').update(x).digest('hex');
const read=n=>readFile(join(source,n),'utf8');
const jwt=(sub,exp,tag)=>'SAMPLE.'+Buffer.from(JSON.stringify({sub,exp,tag})).toString('base64url')+'.SAMPLE';
const write=async(p,x)=>{await mkdir(dirname(p),{recursive:true});await writeFile(p,typeof x==='string'?x:JSON.stringify(x));};
const dynamic=async name=>import(pathToFileURL(join(source,name)).href);
async function sample(){const dir=join(root,'work/isolation-provider-tests',randomUUID());await mkdir(dir,{recursive:true});return {dir,config:{path:p=>resolve(dir,p)},clean:async()=>{assert.ok(dir.startsWith(join(root,'work')+ '\\')||dir.startsWith(join(root,'work')+'/'));await rm(dir,{recursive:true,force:true});}};}

test('static explicit references replace only profile/cache/memory fallback branches',async()=>{
 const buddy=await read('provider-buddy.mjs'),qoder=await read('provider-qoder.mjs'),cline=await read('provider-cline.mjs'),codearts=await read('provider-codearts.mjs'),raccoon=await read('provider-raccoon.mjs'),audit=await read('model-audit.mjs');
 assert.ok(/credentials\?\.profileDir/.test(buddy),'buddy profileDir override missing');assert.match(buddy,/credentials\?\.localState/);
 assert.match(qoder,/credentials\?\.profileDir/);assert.match(qoder,/credentials\?\.localState/);
 assert.match(cline,/credentials\?\.cacheFile/);assert.match(cline,/flightKey/);assert.match(codearts,/\['cacheFile','localState'\]/);assert.match(codearts,/flightKey/);assert.match(raccoon,/credentials\?\.cacheFile/);
 assert.match(audit,/fileURLToPath/);assert.ok(!audit.includes('D:/AI Memory/AI积分网关-多平台签到与DSH反代'));
});

test('Buddy and Qoder explicit profile + localState take priority; old automatic defaults remain', {skip:baseline},async()=>{
 const f=await sample();try{
  const {buddyStoragePaths,resolveBuddyCredential}=await dynamic('provider-buddy.mjs'),{qoderStoragePaths,resolveQoderCredential}=await dynamic('provider-qoder.mjs');
  const c={profileDir:'SAMPLE_PROFILE',localState:'SAMPLE_METADATA',file:'SAMPLE_EXPLICIT.json',kind:'file'};
  for(const fn of [buddyStoragePaths,qoderStoragePaths]){const p=fn({platform:'codebuddy',edition:'cn',credentials:c},f.config);assert.equal(p.dir,join(f.dir,'SAMPLE_PROFILE'));assert.equal(p.file,join(f.dir,'SAMPLE_EXPLICIT.json'));assert.equal(p.localState,join(f.dir,'SAMPLE_METADATA'));}
  const paths=buddyStoragePaths({platform:'codebuddy',edition:'cn',credentials:{profileDir:'SAMPLE_PROFILE'}},f.config);assert.equal(paths.file,join(f.dir,'SAMPLE_PROFILE/User/globalStorage/state.vscdb'));assert.ok(buddyStoragePaths({edition:'cn'}).dir.endsWith('CodeBuddy CN'));assert.ok(qoderStoragePaths({edition:'cn'}).dir.endsWith('com.qodercn.app.stable'));
  await write(join(f.dir,'SAMPLE_EXPLICIT.json'),{accessToken:'SAMPLE_TOKEN',uid:'SAMPLE_UID',domain:'www.codebuddy.cn'});const buddy=await resolveBuddyCredential({platform:'codebuddy',edition:'cn',credentials:c},f.config);assert.equal(buddy.filePath,join(f.dir,'SAMPLE_EXPLICIT.json'));
  await write(join(f.dir,'SAMPLE_EXPLICIT.json'),{edition:'cn',accessToken:'SAMPLE_TOKEN',uid:'SAMPLE_UID',machineId:'SAMPLE_MACHINE',identity:{machineToken:'SAMPLE_MACHINE_TOKEN',machineCode:'SAMPLE_CODE'}});const qoder=await resolveQoderCredential({edition:'cn',credentials:c},f.config);assert.equal(qoder.filePath,join(f.dir,'SAMPLE_EXPLICIT.json'));
 }finally{await f.clean();}
});

test('Cline explicit cache paths isolate concurrent resolutions of the same snapshot', {skip:baseline},async()=>{
 const f=await sample();try{
  const {resolveClineCredential}=await dynamic('provider-cline.mjs'),now=2000000000000;
  const original=JSON.stringify({accessToken:jwt('SAMPLE',1999999900,'OLD'),refreshToken:'SAMPLE_REFRESH',expiresAt:now-100000});await write(join(f.dir,'SAMPLE.json'),original);
  for(const tag of ['A','B'])await write(join(f.dir,tag+'.json'),{accessToken:jwt('SAMPLE',2000001000,tag),refreshToken:'SAMPLE_REFRESH',expiresAt:now+1000000,sourceHash:hash(original)});
  const result=await Promise.all(['A','B'].map(tag=>resolveClineCredential({credentials:{file:'SAMPLE.json',cacheFile:tag+'.json'}},f.config,{refresh:false,now,cacheFile:join(f.dir,'WRONG_CACHE')})));
  assert.notEqual(result[0].accessToken,result[1].accessToken);assert.equal(hash(await readFile(join(f.dir,'SAMPLE.json'))),hash(original));assert.deepEqual((await readdir(f.dir)).sort(),['A.json','B.json','SAMPLE.json']);
 }finally{await f.clean();}
});

test('CodeArts explicit localState/cache references are honored without DPAPI or upstream calls', {skip:baseline},async()=>{
 const f=await sample();try{
  const {resolveCodeArtsCredential}=await dynamic('provider-codearts.mjs'),dbFile=join(f.dir,'SAMPLE.vscdb'),now=2000000000000,stored=JSON.stringify({data:[1,2,3]});
  const db=new DatabaseSync(dbFile);db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY,value TEXT)');const put=db.prepare('INSERT INTO ItemTable(key,value)VALUES(?,?)');put.run('huaweicloud.codearts-snap',JSON.stringify({userInfoKey:{originData:{id:'SAMPLE',accessKey:'SAMPLE_AK',secretKey:'SAMPLE_SK',securityToken:'SAMPLE_ST',expiresAt:new Date(now-100000).toISOString()}}}));put.run('secret://'+JSON.stringify({extensionId:'huaweicloud.authentication',key:'HuaweiCloudSession'}),stored);db.close();
  for(const tag of ['A','B'])await write(join(f.dir,tag+'.json'),{sourceHash:hash(stored),auth:{accessKey:'SAMPLE_AK_'+tag,secretKey:'SAMPLE_SK',securitytoken:'SAMPLE_ST_'+tag,expires_at:new Date(now+1000000).toISOString()}});
  let decryptCalls=0;const result=await Promise.all(['A','B'].map(tag=>resolveCodeArtsCredential({credentials:{file:'SAMPLE.vscdb',cacheFile:tag+'.json',localState:'SAMPLE_LOCAL_STATE'}},f.config,{refresh:false,now,decryptAuthImpl:async(_stored,state)=>{assert.equal(state,join(f.dir,'SAMPLE_LOCAL_STATE'));decryptCalls++;return {accessKey:'SAMPLE_OLD_AK',secretKey:'SAMPLE_SK',securitytoken:'SAMPLE_OLD_ST',expires_at:new Date(now-100000).toISOString()};}})));
  assert.equal(decryptCalls,2);assert.equal(result[0].accessToken,'SAMPLE_ST_A');assert.equal(result[1].accessToken,'SAMPLE_ST_B');assert.deepEqual((await readdir(f.dir)).sort(),['A.json','B.json','SAMPLE.vscdb']);
 }finally{await f.clean();}
});

test('Raccoon explicit cache isolates concurrent resolutions of one native auth snapshot', {skip:baseline},async()=>{
 const f=await sample();try{
  const {raccoonResolve}=await dynamic('provider-raccoon.mjs'),now=2000000000000,original=JSON.stringify({access_token:jwt('SAMPLE',1999999900,'OLD'),refresh_token:'SAMPLE_REFRESH'});await write(join(f.dir,'SAMPLE.json'),original);
  for(const tag of ['A','B'])await write(join(f.dir,tag+'.json'),{sourceHash:hash(original),auth:{access_token:jwt('SAMPLE',2000001000,tag),refresh_token:'SAMPLE_REFRESH'}});
  const result=await Promise.all(['A','B'].map(tag=>raccoonResolve({credentials:{file:'SAMPLE.json',cacheFile:tag+'.json'}},f.config,{refresh:false,now,cacheFile:join(f.dir,'WRONG_CACHE')})));
  assert.notEqual(result[0].accessToken,result[1].accessToken);assert.equal(hash(await readFile(join(f.dir,'SAMPLE.json'))),hash(original));assert.deepEqual((await readdir(f.dir)).sort(),['A.json','B.json','SAMPLE.json']);
 }finally{await f.clean();}
});

test('model-audit derives independent memory root and keeps explicit environment override', {skip:baseline},async()=>{
 const module=pathToFileURL(join(source,'model-audit.mjs')).href,env={...process.env};delete env.AI_CREDIT_MEMORY;
 const command="import("+JSON.stringify(module)+").then(m=>console.log(m.memoryRoot))";
 const result=execFileSync(process.execPath,['--input-type=module','-e',command],{env,windowsHide:true,encoding:'utf8'}).trim();assert.equal(result,join(root,'memory'));
 const override=join(root,'work/SAMPLE_MEMORY');const overridden=execFileSync(process.execPath,['--input-type=module','-e',command],{env:{...env,AI_CREDIT_MEMORY:override},windowsHide:true,encoding:'utf8'}).trim();assert.equal(overridden,override);
});

test('isolated Qwen Python and official WASM encode SAMPLE input without network calls', {skip:baseline},async t=>{
 const python=process.env.CREDIT_HUB_TEST_PYTHON||join(root,'runtime/qwen-python',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 if(!process.env.CREDIT_HUB_TEST_PYTHON){try{await access(python)}catch{t.skip('Set CREDIT_HUB_TEST_PYTHON to a Python with cryptography and wasmtime to run the offline WASM encoder test');return}}
 const code="import sys,json;sys.path.insert(0,"+JSON.stringify(fileURLToPath(new URL('../engine/vendor/',import.meta.url)))+");from qwenwork_ref.encode import prepare_infer;from dataclasses import asdict;p=asdict(prepare_infer(body=json.dumps({'messages':[{'role':'user','content':'SAMPLE'}]}),model_key='flash',machine_id='SAMPLE_DEVICE',uid='SAMPLE_UID',name='SAMPLE',email='sample@example.invalid',access_token='SAMPLE_TOKEN'));print(json.dumps({'status':'SAMPLE_OFFLINE_ENCODER_PASSED','bodyNonempty':bool(p.get('body')),'headerCount':len(p.get('headers',{})),'networkCalls':0}))";
 const out=JSON.parse(execFileSync(python,['-B','-c',code],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},windowsHide:true,encoding:'utf8'}));assert.equal(out.status,'SAMPLE_OFFLINE_ENCODER_PASSED');assert.equal(out.bodyNonempty,true);assert.equal(out.headerCount,20);assert.equal(out.networkCalls,0);
});

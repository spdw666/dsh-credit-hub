import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {join,dirname,resolve} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHubRuntime} from '../server/runtime.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
async function fixture(t){
 await mkdir(join(root,'work/enhance-0.2.0'),{recursive:true});
 const base=await mkdtemp(join(root,'work/enhance-0.2.0/integration-')),dir=join(base,'TARGET'),engine=join(dir,'engine'),src=join(engine,'src'),profile=join(dir,'runtime/profile');await mkdir(src,{recursive:true});await mkdir(profile,{recursive:true});
 const native=join(base,'native/wb.json');await mkdir(dirname(native),{recursive:true});
 const credentials={account:{uid:'SAMPLE_LATE_ACCOUNT',nickname:'SAMPLE 后装'},auth:{accessToken:'SAMPLE_ACCESS_12345678901234567890',refreshToken:'SAMPLE_REFRESH_12345678901234567890',domain:'www.workbuddy.cn',expiresAt:4102444800000}};
 await writeFile(native,JSON.stringify(credentials));
 const accounts=[];for(let n=1;n<=3;n++){const file=join(profile,`seed-${n}.json`);await writeFile(file,JSON.stringify({uid:'SAMPLE_SEED_'+n,accessToken:'SAMPLE_TOKEN_SEED',expiresAtMs:4102444800000}));accounts.push({id:'SAMPLE-'+n,label:'SAMPLE '+n,platform:'workbuddy',credentials:{kind:'file',file},enabled:true,inferenceEnabled:false,tasks:[{id:'daily-checkin',enabled:true}]});}
 await writeFile(join(profile,'config.json'),JSON.stringify({schemaVersion:1,dataDir:'./data',accounts,upstreams:[],routes:[],server:{host:'127.0.0.1',port:0,allowRemote:false},scheduler:{enabled:false,startup:false,hour:0,minute:5,timezone:'Asia/Shanghai',jitterSeconds:60,maxConcurrency:2,windows:{workbuddy:{start:'00:05',end:'00:40'}}},workbuddy:{autoTasks:false,autoMigrateSessions:false}}));
 const module=name=>JSON.stringify(new URL('../engine/src/'+name,import.meta.url).href);
 await writeFile(join(engine,'package.json'),JSON.stringify({type:'module',version:'0.6.0'}));
 await writeFile(join(src,'service.mjs'),`import {createService as real} from ${module('service.mjs')};const nativeFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(typeof input==="string"?input:input.url);if(url.hostname==="127.0.0.1")return nativeFetch(input,init);if(url.href==="https://api.github.com/repos/SAMPLE/fixture/contents/package.json")return Promise.resolve(new Response(JSON.stringify({version:"0.0.0"}),{status:200,headers:{"Content-Type":"application/json"}}));throw Error("UPSTREAM_NETWORK_FORBIDDEN_IN_OPERATIONS_FIXTURE")};export async function createService(...args){const s=await real(...args);s.platforms.models=async()=>[{id:'SAMPLE-model',name:'SAMPLE model',contextWindow:32000,maxTokens:4096,callable:true}];let active=0,max=0;s.claims.run=async(accountId,task)=>{active++;max=Math.max(max,active);s.ledger.set('SAMPLE:max-active',max);await new Promise(r=>setTimeout(r,15));active--;s.ledger.record({day:new Date().toISOString().slice(0,10),platform:'workbuddy',accountId,task,status:'success'});return {accountId,task,status:'success'};};s.balanceCache=new Map([['SAMPLE-1',{accountId:'SAMPLE-1',value:168,unit:'credits',total:1000,checkedAt:new Date().toISOString()}]]);for(let n=7;n>=0;n--){const startedAt=new Date(Date.now()-n*86400000).toISOString();const id=s.ledger.beginUsage({accountId:'SAMPLE-1',model:'SAMPLE-model',startedAt});s.ledger.finishUsage(id,{accountId:'SAMPLE-1',startedAt,status:'completed',credits:24,requestId:'SAMPLE-usage-'+n,requestOutcome:{state:'completed'}});}return s;}`);
 for(const name of ['server.mjs','activity-context.mjs','model-directory.mjs','credentials.mjs'])await writeFile(join(src,name),`export * from ${module(name)};`);
 const hub=await createHubRuntime({taskRoot:dir,engineRoot:engine,nodeExecutable:process.execPath,hostEnvironment:{HOME:join(dir,'home'),USERPROFILE:join(dir,'home'),USERNAME:'SAMPLE',PUBLIC:join(dir,'public'),APPDATA:join(dir,'appdata'),LOCALAPPDATA:join(dir,'local')},discoveryCandidates:[{id:'sample-late',platform:'workbuddy',label:'SAMPLE 后装',paths:[native]}]});
 // Runtime construction now returns its supervisor before the child is ready.
 t.after(async()=>{await hub.close();await rm(base,{recursive:true,force:true,maxRetries:5,retryDelay:50});});await hub.waitUntilReady({timeoutMs:5000});return {hub,dir,profile,native};
}
const post=(hub,path,body={})=>hub.request({method:'POST',path,body});
test('failed settings rename does not activate new runtime event/update settings',async t=>{const {hub,profile}=await fixture(t);await mkdir(join(profile,'hub-settings.json'));await assert.rejects(post(hub,'/hub/operations',{events:{enabled:false},updates:{intervalHours:2}}));const current=(await hub.snapshot()).operations;assert.equal(current.settings.events.enabled,true);assert.equal(current.settings.updates.intervalHours,1);});
test('real worker exposes discovery, forecast and bounded scheduler; native sources stay unchanged',async t=>{
 const f=await fixture(t),before=await readFile(f.native),first=await f.hub.snapshot();assert.equal(first.pluginVersion,'0.2.3');assert.equal(first.counts.accounts,3);assert.equal(first.operations.forecast.accounts[0].status,'estimated');assert.ok(first.operations.forecast.accounts[0].estimatedHours>0);assert.equal(first.operations.forecast.accounts[0].reservePercent,null);
 const scan=await post(f.hub,'/hub/discovery',{connect:true});assert.equal(scan.status,200);const after=await f.hub.snapshot();assert.equal(after.counts.accounts,4,JSON.stringify(scan.body));assert.equal(after.counts.enabledRoutes,1);assert.deepEqual(await readFile(f.native),before);
 await post(f.hub,'/hub/discovery',{connect:true});assert.equal((await f.hub.snapshot()).counts.accounts,4);
 const missing=await f.hub.request({path:'/hub/scheduler-status'});assert.equal(missing.body.todayMissing.length,3);const manual=await post(f.hub,'/hub/scheduler/manual',{missingOnly:true});assert.equal(manual.body.results.length,3);assert.equal((await f.hub.request({path:'/hub/scheduler-status'})).body.todayMissing.length,0);const config=JSON.parse(await readFile(join(f.profile,'config.json'),'utf8'));assert.equal(config.scheduler.enabled,false);
});
test('native delivery persists until actual client acknowledgement; hidden webhook survives partial settings save',async t=>{
 const {hub,profile}=await fixture(t);
 await post(hub,'/hub/operations',{events:{sinks:{webhook:{kind:'webhook',enabled:false,url:'https://example.invalid/SAMPLE-PRIVATE'}}}});
 await post(hub,'/hub/operations',{events:{credentialWarnDays:3,sinks:{webhook:{enabled:false}}}});
 const privateSettings=JSON.parse(await readFile(join(profile,'hub-settings.json'),'utf8'));assert.equal(privateSettings.events.sinks.webhook.url,'https://example.invalid/SAMPLE-PRIVATE');const publicSettings=await hub.request({path:'/hub/operations'});assert.equal(JSON.stringify(publicSettings).includes('SAMPLE-PRIVATE'),false);
 const emitted=await post(hub,'/hub/events/test');assert.ok(emitted.body.queued>0);let inbox;for(let n=0;n<30;n++){inbox=await hub.request({path:'/hub/events/pending'});if(inbox.body.items.length)break;await new Promise(r=>setTimeout(r,20));}assert.equal(inbox.body.items.length,1);
 await post(hub,'/hub/events/ack',{deliveryIds:[inbox.body.items[0].deliveryId]});assert.equal((await hub.request({path:'/hub/events/pending'})).body.items.length,0);
 await post(hub,'/hub/operations',{updates:{repository:'SAMPLE/fixture'}});
 const updates=await post(hub,'/hub/updates');assert.equal(updates.body.status,'up_to_date');assert.equal(updates.body.availableVersion,'0.0.0');
});




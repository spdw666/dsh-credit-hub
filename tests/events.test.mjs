import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createEventRouter,EVENT_TYPES} from '../server/events.mjs';
import {Ledger} from '../engine/src/store.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),NOW=Date.parse('2026-10-18T10:00:00Z'),DAY=86400000;
const at=offset=>new Date(NOW+offset).toISOString();
const memory=()=>{const map=new Map();return {get:key=>structuredClone(map.get(key)),set:(key,value)=>map.set(key,structuredClone(value))};};
const account={id:'SAMPLE_PRIVATE_ACCOUNT_123456789',label:'SAMPLE 工作账户 person@example.com 13812345678',platform:'workbuddy'};
test('real CodeArts CREDIT balance triggers low-balance event with normalized credit unit',()=>{const router=createEventRouter({ledger:memory(),now:()=>NOW});router.evaluate({accounts:[{...account,platform:'codearts'}],balances:[{accountId:account.id,value:5,unit:'CREDIT',checkedAt:at(-1000)}]});assert.equal(router.status().pending,1);assert.equal(router.status().recent.length,0);return router.close();});
const claim=(id,status='error')=>({id,time:at(-1000+id),account_id:account.id,platform:'workbuddy',task:'daily-checkin',status,result:{reason:'provider_timeout',token:'SAMPLE_SECRET_TOKEN',error:{message:'Bearer SAMPLE_SECRET_TOKEN'}}});
async function server(t,handler){const instance=createServer(handler);instance.listen(0,'127.0.0.1');await once(instance,'listening');t.after(()=>new Promise(resolve=>instance.close(resolve)));return {instance,url:'http://127.0.0.1:'+instance.address().port};}

test('event payload whitelist masks identifiers and never emits credentials, URLs or upstream bodies',async t=>{
  const received=[];const router=createEventRouter({ledger:memory(),now:()=>NOW,onNativeEvent:(event,delivery)=>{received.push({event,delivery});return {ack:true};}});t.after(()=>router.close());
  const result=router.emit({type:'checkin.failed',id:'SAMPLE_EVENT',accountId:account.id,accountLabel:account.label,platform:'workbuddy',accessToken:'SAMPLE_SECRET_TOKEN',url:'https://secret.example',error:{message:'SAMPLE_SECRET_TOKEN'},data:{reasonCode:'provider_timeout',secret:'SAMPLE_SECRET_TOKEN',uid:'SAMPLE_UID',routeId:'SAMPLE_PRIVATE_ROUTE'}});
  assert.equal(result.queued,1);await router.flush();assert.equal(received.length,1);const serialized=JSON.stringify(received);
  for(const hidden of [account.id,'SAMPLE_SECRET_TOKEN','person@example.com','13812345678','secret.example','SAMPLE_PRIVATE_ROUTE','SAMPLE_UID'])assert.equal(serialized.includes(hidden),false,hidden);
  assert.match(received[0].event.accountId,/^account-[a-f0-9]{12}$/);assert.match(received[0].event.data.routeId,/^route-[a-f0-9]{12}$/);assert.equal(router.status().recent[0].status,'delivered');
  assert.equal(router.emit({type:'checkin.failed',id:'SAMPLE_EVENT',accountId:account.id}).reason,'duplicate');
});

test('five operational event families and update.available are mapped; stale observations do not reset low-balance edge',async t=>{
  const delivered=[],router=createEventRouter({ledger:memory(),now:()=>NOW,settings:{cooldownSeconds:0},onNativeEvent:event=>delivered.push(event)});t.after(()=>router.close());
  const balances=[{accountId:account.id,value:5,total:100,unit:'积分',checkedAt:at(-1000)}],credentials=[{accountId:account.id,expiresAtMs:NOW+2*DAY}],records=[claim(1),{id:2,time:at(-500),account_id:account.id,task:'model-relay',status:'switched',result:{routeId:'SAMPLE_ROUTE',reasonCode:'credits_exhausted'}}];
  router.evaluate({accounts:[account],balances,credentials,records});await router.flush();assert.deepEqual(delivered.map(e=>e.type).sort(),['balance.low','checkin.failed','credential.expiring','relay.triggered']);
  router.evaluate({accounts:[account],balances:[{...balances[0],stale:true}],credentials,records});router.evaluate({accounts:[account],balances,credentials,records});await router.flush();assert.equal(delivered.length,4);
  router.evaluate({accounts:[account],balances:[{...balances[0],value:200}],credentials:[{accountId:account.id,expiresAtMs:NOW+30*DAY}]});
  router.evaluate({accounts:[account],balances:[{...balances[0],checkedAt:at(0)}],credentials:[{accountId:account.id,expiresAtMs:NOW+DAY}]});await router.flush();assert.equal(delivered.filter(e=>e.type==='balance.low').length,2);assert.equal(delivered.filter(e=>e.type==='credential.expiring').length,2);
  router.emit({type:'update.available',id:'release-0.2.0',data:{currentVersion:'0.1.1',latestVersion:'0.2.0',url:'SAMPLE_PRIVATE_URL'}});await router.flush();assert.equal(delivered.at(-1).type,'update.available');assert.equal(delivered.at(-1).data.latestVersion,'0.2.0');assert.equal('url' in delivered.at(-1).data,false);
  assert.equal(EVENT_TYPES.length,6);
});

test('logical request streak alerts once at three, ignores retries/audits/cancellation, and resets after success',async t=>{
  const received=[],router=createEventRouter({ledger:memory(),now:()=>NOW,settings:{cooldownSeconds:0},onNativeEvent:event=>received.push(event)});t.after(()=>router.close());
  const usage=[];const add=(id,status,extra={})=>usage.push({id,requestId:'SAMPLE_REQUEST_'+id,startedAt:at(-1000+id),finishedAt:at(-900+id),routeId:'SAMPLE_ROUTE',accountId:account.id,status,requestOutcome:{state:status==='completed'?'completed':'failed'},...extra});
  add(1,'failed');add(2,'failed',{requestId:'SAMPLE_REQUEST_1',requestOutcome:{state:'ongoing'}});add(3,'failed',{source:'audit'});add(4,'cancelled');add(5,'failed');
  router.evaluate({accounts:[account],usage});await router.flush();assert.equal(received.length,0);
  add(6,'failed');router.evaluate({accounts:[account],usage});await router.flush();assert.equal(received.length,1);assert.equal(received[0].data.streak,3);
  add(7,'failed');router.evaluate({accounts:[account],usage});await router.flush();assert.equal(received.length,1);
  add(8,'completed');add(9,'failed');add(10,'failed');add(11,'failed');router.evaluate({accounts:[account],usage});await router.flush();assert.equal(received.length,2);
  router.evaluate({accounts:[account],usage});await router.flush();assert.equal(received.length,2);
});

test('SQLite persisted outbox survives worker recreation; delivery acknowledgement and seen IDs survive another restart',async t=>{
  const parent=join(ROOT,'work','events-tests');await mkdir(parent,{recursive:true});const dir=await mkdtemp(join(parent,'case-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let ledger=new Ledger(dir),router=createEventRouter({ledger,now:()=>NOW,onNativeEvent:()=>({ack:true})});router.evaluate({accounts:[account],records:[claim(1)]});assert.equal(router.status().pending,1);await router.close();ledger.close();
  const sent=[];ledger=new Ledger(dir);router=createEventRouter({ledger,now:()=>NOW,onNativeEvent:event=>sent.push(event)});await router.flush();assert.equal(sent.length,1);router.evaluate({accounts:[account],records:[claim(1)]});assert.equal(router.status().pending,0);await router.close();ledger.close();
  ledger=new Ledger(dir);router=createEventRouter({ledger,now:()=>NOW,onNativeEvent:event=>sent.push(event)});router.evaluate({accounts:[account],records:[claim(1)]});await router.flush();assert.equal(sent.length,1);await router.close();ledger.close();
});

test('webhook performs real local SAMPLE POST with private headers and opaque payload; public status hides destination',async t=>{
  const received=[];const endpoint=await server(t,(req,res)=>{let raw='';req.on('data',chunk=>{raw+=chunk});req.on('end',()=>{received.push({method:req.method,headers:req.headers,raw,body:JSON.parse(raw)});res.writeHead(204);res.end();});});
  const router=createEventRouter({ledger:memory(),now:()=>NOW,settings:{sinks:{hook:{kind:'webhook',url:endpoint.url+'/SAMPLE_PRIVATE_PATH',headers:{Authorization:'Bearer SAMPLE_PRIVATE_WEBHOOK_TOKEN'}}},mappings:{'checkin.failed':['hook']} }});t.after(()=>router.close());
  router.emit({type:'checkin.failed',id:'SAMPLE_LOCAL_POST',accountId:account.id,accountLabel:'SAMPLE 本地测试'});await router.flush();assert.equal(received.length,1);assert.equal(received[0].method,'POST');assert.equal(received[0].headers.authorization,'Bearer SAMPLE_PRIVATE_WEBHOOK_TOKEN');assert.match(received[0].headers['x-credit-hub-delivery'],/^[a-f0-9-]{36}$/);assert.ok(Buffer.byteLength(received[0].raw)<8192);assert.equal(received[0].body.type,'checkin.failed');assert.equal(received[0].raw.includes(account.id),false);
  const publicStatus=JSON.stringify(router.status());for(const secret of [endpoint.url,'SAMPLE_PRIVATE_PATH','SAMPLE_PRIVATE_WEBHOOK_TOKEN'])assert.equal(publicStatus.includes(secret),false);assert.equal(router.status().recent[0].status,'delivered');
});

test('redirects are rejected rather than delivering credentials to a second origin',async t=>{
  let forwarded=0;const target=await server(t,(_req,res)=>{forwarded++;res.end('SAMPLE');}),redirect=await server(t,(_req,res)=>{res.writeHead(302,{Location:target.url});res.end();});
  const router=createEventRouter({ledger:memory(),now:()=>NOW,settings:{maxAttempts:1,sinks:{hook:{kind:'webhook',url:redirect.url,headers:{Authorization:'Bearer SAMPLE_HEADER'}}},mappings:{'checkin.failed':['hook']}}});t.after(()=>router.close());
  router.emit({type:'checkin.failed'});await router.flush();assert.equal(forwarded,0);assert.equal(router.status().recent[0].status,'failed');assert.equal(router.status().pending,0);
});

test('unacknowledged native sinks retry with stable delivery ID and stop after finite attempts without rejecting the producer',async t=>{
  let now=NOW;const deliveries=[],router=createEventRouter({ledger:memory(),now:()=>now,settings:{maxAttempts:3,retryBaseMs:100},onNativeEvent:(_event,meta)=>{deliveries.push(meta.deliveryId);return {ack:false};}});t.after(()=>router.close());
  assert.equal(router.emit({type:'checkin.failed',id:'SAMPLE_FAILURE'}).queued,1);await router.flush();assert.equal(router.status().pending,1);
  now+=100;await router.flush();assert.equal(router.status().pending,1);now+=200;await router.flush();assert.equal(router.status().pending,0);assert.equal(router.status().recent[0].attempts,3);assert.equal(router.status().recent[0].code,'native_not_acknowledged');assert.equal(new Set(deliveries).size,1);
});

test('hanging transport has a bounded timeout; non-credit quotas do not trigger credit thresholds',async t=>{
  const router=createEventRouter({ledger:memory(),now:()=>NOW,fetch:()=>new Promise(()=>{}),settings:{maxAttempts:1,timeoutMs:100,sinks:{hook:{kind:'webhook',url:'http://127.0.0.1:1'}},mappings:{'checkin.failed':['hook']}}});t.after(()=>router.close());
  router.emit({type:'checkin.failed'});const began=Date.now();await router.flush();assert.ok(Date.now()-began<2000);assert.equal(router.status().recent[0].code,'sink_timeout');
  router.evaluate({accounts:[account],balances:[{accountId:account.id,value:0,unit:'Token',checkedAt:at(0)}],credentials:[{accountId:account.id}]});assert.equal(router.status().pending,0);
});

test('settings reject ambiguous mappings, URL credentials, unsafe headers and unknown protocols',()=>{
  for(const settings of [{sinks:{hook:{url:'file:///SAMPLE'}}},{sinks:{hook:{url:'https://user:pass@example.com'}}},{sinks:{hook:{url:'https://example.com',headers:{Authorization:'a\r\nb'}}}},{sinks:{hook:{url:'https://example.com',headers:{Host:'example.com'}}}},{mappings:{'checkin.failed':['missing']}}])assert.throws(()=>createEventRouter({settings}));
  const router=createEventRouter({settings:{enabled:false}});assert.equal(router.emit({type:'checkin.failed'}).reason,'disabled');return router.close();
});

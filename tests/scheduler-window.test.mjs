import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {Scheduler} from '../engine/src/scheduler.mjs';
import {windowPlan,wallDay,parseWindowTime} from '../engine/src/scheduler-windows.mjs';
import {validateConfig} from '../engine/src/config.mjs';
import {Ledger} from '../engine/src/store.mjs';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('forecast never treats an already-attempted checkin as a later same-day replenishment',async()=>{const f=fixture({accounts:2,now:'2026-10-18T00:01:00+08:00'});f.scheduler.stopped=false;f.ledger.set(f.scheduler.attemptKey('2026-10-18',{accountId:'SAMPLE-0',task:'daily-checkin'}),{status:'success',attemptedAt:'2026-10-18T00:00:00+08:00'});const next=f.scheduler.nextReplenishment();assert.equal(wallDay(Date.parse(next['SAMPLE-0']),'Asia/Shanghai'),'2026-10-19');assert.equal(wallDay(Date.parse(next['SAMPLE-1']),'Asia/Shanghai'),'2026-10-18');await f.scheduler.stop();assert.deepEqual(f.scheduler.nextReplenishment(),{});});
function fixture({accounts=4,now='2026-10-18T00:50:00+08:00',random=()=>0.5,scheduler={},records=[]}={}){
  let time=Date.parse(now),calls=[],active=0,peak=0,hold=null,status='success';const values=new Map(),timers=new Map();let timerId=0;
  const ledger={get:k=>values.get(k),set:(k,v)=>values.set(k,structuredClone(v)),records:()=>records};
  const config={value:{scheduler:{enabled:true,startup:true,timezone:'Asia/Shanghai',hour:0,minute:5,jitterSeconds:0,windows:{sample:{start:'00:05',end:'00:40'}},startupSpreadSeconds:120,maxConcurrency:2,...scheduler},accounts:Array.from({length:accounts},(_,i)=>({id:'SAMPLE-'+i,platform:'sample',enabled:true,tasks:[{id:'daily-checkin',enabled:true}]}))}};
  const claims={async run(accountId,task){calls.push({accountId,task,at:time});active++;peak=Math.max(peak,active);try{if(hold)await hold;return {accountId,task,status};}finally{active--;}}};
  const options={clock:()=>time,random,setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,at:time+delay});return id;},clearTimeout:id=>timers.delete(id)};
  const make=()=>new Scheduler(config,claims,ledger,options);let instance=make();
  return {config,ledger,claims,make,get scheduler(){return instance;},get calls(){return calls;},get peak(){return peak;},set time(v){time=typeof v==='number'?v:Date.parse(v);},get time(){return time;},hold(p){hold=p;},result(v){status=v;},async advance(ms){time+=ms;for(let i=0;i<20;i++){const due=[...timers.entries()].filter(([,t])=>t.at<=time);if(!due.length)break;for(const [id,t] of due){timers.delete(id);t.fn();}await settle();}await settle();}};
}

test('startup plans only missing work and spreads catch-up instead of claims.all',async()=>{
  let n=0;const f=fixture({random:()=>[0.1,0.3,0.7,0.9][n++%4],records:[{day:'2026-10-18',account_id:'SAMPLE-0',task:'daily-checkin',status:'success',time:'2026-10-18T00:06:00+08:00'},{day:'2026-10-18',account_id:'SAMPLE-1',task:'daily-checkin',status:'error',time:'2026-10-18T00:06:00+08:00'}]});
  f.scheduler.start();await settle();assert.equal(f.calls.length,0);const state=f.scheduler.status();assert.equal(state.queue.length,2);assert.equal(state.todayAttempted.length,2);assert.equal(state.todayMissing.length,3);assert.equal(state.todayMissing.find(r=>r.accountId==='SAMPLE-1').automaticEligible,false);assert.notEqual(state.queue[0].dueAt,state.queue[1].dueAt);assert.ok(state.queue.every(j=>j.dueAt>f.time&&j.dueAt<=f.time+120000));
  await f.advance(121000);assert.deepEqual(f.calls.map(c=>c.accountId).sort(),['SAMPLE-2','SAMPLE-3']);await f.scheduler.stop();
});

test('persisted failed uncertain and running attempts never replay on restart',async()=>{
  const f=fixture({accounts:3,scheduler:{startupSpreadSeconds:0}});for(const [i,status]of ['error','uncertain','running'].entries())f.ledger.set(f.scheduler.attemptKey('2026-10-18',{accountId:'SAMPLE-'+i,task:'daily-checkin'}),{status,attemptedAt:'2026-10-18T00:06:00+08:00'});
  f.scheduler.start();await settle();await f.advance(121000);assert.equal(f.calls.length,0);await f.scheduler.stop();const next=f.make();next.start();await settle();assert.equal(f.calls.length,0);assert.equal(next.status().todayAttempted.length,3);await next.stop();
});

test('window jitter persists across restart and account/inference changes do not shift existing plan',async()=>{
  const f=fixture({now:'2026-10-18T00:00:00+08:00'}),first=f.scheduler.status().plan.map(r=>r.at);const next=f.make();assert.deepEqual(next.status().plan.map(r=>r.at),first);f.config.value.accounts[0].inferenceEnabled=false;assert.deepEqual(next.status().plan.map(r=>r.at),first);f.config.value.accounts.push({id:'SAMPLE-new',platform:'sample',tasks:[{id:'daily-checkin',enabled:true}]});assert.deepEqual(next.status().plan.slice(0,4).map(r=>r.at),first);await f.scheduler.stop();await next.stop();
});

test('global maxConcurrency applies jointly to manual and automatic work; account tasks stay sequential',async()=>{
  const f=fixture({accounts:5,scheduler:{startup:false}});f.config.value.accounts[0].tasks.push({id:'daily-quota',enabled:true});let release;f.hold(new Promise(r=>{release=r;}));f.scheduler.stopped=false;const tick=f.scheduler.tick();await settle();assert.equal(f.calls.length,2);const manual=f.scheduler.manual({accountIds:['SAMPLE-0','SAMPLE-4'],missingOnly:false});await settle();assert.equal(f.calls.length,2);assert.equal(f.peak,2);release();await tick;await manual;assert.equal(f.peak,2);assert.equal(f.calls.filter(c=>c.accountId==='SAMPLE-0').length,2);assert.equal(f.scheduler.status().todayAttempted.length,6);await f.scheduler.stop();
});

test('manual missing-only skips completed rows and explicitly retries failed rows through the same queue',async()=>{
  const f=fixture({accounts:3,scheduler:{enabled:false},records:[{day:'2026-10-18',account_id:'SAMPLE-0',task:'daily-checkin',status:'already',time:'2026-10-18T00:06:00+08:00'},{day:'2026-10-18',account_id:'SAMPLE-1',task:'daily-checkin',status:'error',time:'2026-10-18T00:06:00+08:00'}]});
  const result=await f.scheduler.manual({missingOnly:true});assert.equal(result.queued,2);assert.equal(result.skipped.length,1);assert.deepEqual(f.calls.map(r=>r.accountId),['SAMPLE-1','SAMPLE-2']);assert.equal(f.scheduler.stopped,true,'manual does not start automatic scheduler');await f.scheduler.stop();
});

test('stop cancels queued work without writing an attempt and waits for active work',async()=>{
  const f=fixture({accounts:4,scheduler:{enabled:false,maxConcurrency:1}});let release;f.hold(new Promise(r=>{release=r;}));const manual=f.scheduler.manual({missingOnly:false});await settle();assert.equal(f.calls.length,1);const stopped=f.scheduler.stop();await settle();assert.equal(f.calls.length,1);release();await stopped;const result=await manual;assert.equal(result.results.filter(r=>r.status==='cancelled').length,3);assert.equal(f.scheduler.status().todayAttempted.length,1);
});

test('overnight windows, DST gaps/folds and timezone day boundaries use real local instants',()=>{
  const s={timezone:'Asia/Shanghai',windows:{sample:{start:'23:00',end:'01:00'}}};for(const random of [()=>0,()=>0.49,()=>0.99]){const p=windowPlan('2026-10-18',s,'sample',random),hour=Number(new Intl.DateTimeFormat('en',{timeZone:s.timezone,hour:'numeric',hourCycle:'h23'}).format(p.at));assert.ok(hour===0||hour===23);assert.equal(wallDay(p.at,s.timezone),'2026-10-18');}
  const gap=windowPlan('2026-03-08',{timezone:'America/New_York',windows:{sample:{start:'02:10',end:'02:30'}}},'sample',()=>0);assert.equal(gap.dstAdjusted,true);assert.equal(new Date(gap.at).toISOString(),'2026-03-08T07:00:00.000Z');
  const fold=windowPlan('2026-11-01',{timezone:'America/New_York',windows:{sample:{start:'01:00',end:'02:00'}}},'sample',()=>0.75);assert.equal(new Date(fold.at).toISOString(),'2026-11-01T06:30:00.000Z');assert.equal(wallDay('2026-10-17T16:01:00Z','Asia/Shanghai'),'2026-10-18');
});

test('new scheduler settings reject invalid time/type/range without dropping unrelated settings',async()=>{
  const base=JSON.parse(await readFile(new URL('../engine/config.example.json',import.meta.url),'utf8'));base.scheduler.windows={sample:{start:'00:05',end:'00:40',extension:'preserved'}};base.scheduler.maxConcurrency=2;base.scheduler.startupSpreadSeconds=120;base.pluginExtension={value:true};assert.equal(validateConfig(structuredClone(base)).pluginExtension.value,true);assert.equal(validateConfig(structuredClone(base)).scheduler.windows.sample.extension,'preserved');
  for(const edit of [s=>s.windows.sample.start='24:00',s=>s.windows.sample.end='1:40',s=>s.windows.sample.end='00:05',s=>s.maxConcurrency=0,s=>s.maxConcurrency='2',s=>s.startupSpreadSeconds=-1,s=>s.startup='true']){const c=structuredClone(base);edit(c.scheduler);assert.throws(()=>validateConfig(c));}assert.throws(()=>parseWindowTime('23:60'));
});

test('missing attempts are persisted before network work, even when the claim throws',async()=>{
  const f=fixture({accounts:1,scheduler:{enabled:false}});f.claims.run=async()=>{assert.equal(f.scheduler.status().todayAttempted[0].status,'running');throw Object.assign(new Error('SAMPLE'),{code:'SAMPLE_transport'});};const result=await f.scheduler.manual({missingOnly:true});assert.equal(result.results[0].status,'error');assert.equal(f.scheduler.status().todayAttempted[0].reason,'SAMPLE_transport');await f.scheduler.stop();const next=f.make();next.config.value.scheduler.enabled=true;next.config.value.scheduler.startupSpreadSeconds=0;next.start();await settle();assert.equal(next.status().queue.length,0);await next.stop();
});

test('disabling auto scheduling still permits a later manual request, while service shutdown does not',async()=>{
  const f=fixture({accounts:1,scheduler:{enabled:false}});await f.scheduler.stop();assert.equal((await f.scheduler.manual({missingOnly:false})).results[0].status,'success');assert.equal(f.scheduler.stopped,true);await f.scheduler.stop();f.scheduler.service={workbuddyTaskJobsClosing:true};assert.equal((await f.scheduler.manual({missingOnly:false})).results[0].status,'cancelled');assert.equal(f.calls.length,1);
});

test('editing a platform window updates queued instants without reshuffling unchanged accounts',async()=>{
  const f=fixture({now:'2026-10-18T00:00:00+08:00',accounts:2});f.scheduler.stopped=false;await f.scheduler.tick();const old=f.scheduler.status().queue.map(j=>j.dueAt);f.config.value.scheduler.windows.sample={start:'02:00',end:'02:40'};await f.scheduler.tick();const next=f.scheduler.status().queue.map(j=>j.dueAt);assert.equal(next.length,2);assert.ok(next.every((t,i)=>t>old[i]));assert.ok(next.every(t=>new Date(t).toISOString().startsWith('2026-10-17T18:')));assert.equal(JSON.stringify(f.scheduler.status()).includes('promise'),false);await f.scheduler.stop();
});

test('SQLite close/reopen retains random plan and pre-submission attempt alongside old claim records',async()=>{
  const work=fileURLToPath(new URL('../../work/',import.meta.url));await mkdir(work,{recursive:true});const dir=await mkdtemp(join(work,'scheduler-ledger-')),f=fixture({accounts:2,scheduler:{enabled:false}});let ledger=new Ledger(dir),scheduler=new Scheduler(f.config,{run:async(accountId,task)=>({accountId,task,status:'error',reason:'SAMPLE_offline'})},ledger,{clock:()=>f.time,random:()=>0.4});
  try{ledger.record({day:'2026-10-18',platform:'sample',accountId:'SAMPLE-0',task:'daily-checkin',status:'already'});const before=scheduler.status().plan.map(r=>r.at);await scheduler.manual({accountIds:['SAMPLE-1'],missingOnly:true});await scheduler.stop();ledger.close();ledger=new Ledger(dir);let calls=0;scheduler=new Scheduler(f.config,{run:async()=>{calls++;return {status:'success'};}},ledger,{clock:()=>f.time,random:()=>0.9});assert.deepEqual(scheduler.status().plan.map(r=>r.at),before);assert.equal(scheduler.status().todayAttempted.length,2);f.config.value.scheduler.enabled=true;f.config.value.scheduler.startupSpreadSeconds=0;scheduler.start();await settle();assert.equal(calls,0);assert.equal(scheduler.status().queue.length,0);}finally{await scheduler.stop();ledger.close();await rm(dir,{recursive:true,force:true});}
});

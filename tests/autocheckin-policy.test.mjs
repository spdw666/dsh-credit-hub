import test from 'node:test';
import assert from 'node:assert/strict';
import {Scheduler,automaticRetryAt} from '../engine/src/scheduler.mjs';
import {defaultDiscoveryTasks} from '../server/discovery.mjs';
import {ClaimService} from '../engine/src/claims.mjs';

const day='2026-10-21';
function fixture(){
  let now=Date.parse(day+'T09:00:00+08:00'),calls=0;
  const values=new Map(),history=[];
  const config={value:{scheduler:{enabled:true,startup:true,timezone:'Asia/Shanghai',hour:0,minute:5,jitterSeconds:0,retryMinutes:60,maxConcurrency:2,startupSpreadSeconds:0},accounts:[{id:'SAMPLE',platform:'sample',tasks:[{id:'daily-checkin',enabled:true}]}]}};
  const ledger={get:key=>values.get(key),set:(key,value)=>values.set(key,structuredClone(value)),records:()=>history};
  const claims={async run(){calls++;return {status:'error',reason:'SAMPLE_TRANSIENT',beforeSubmission:true,retryable:true};}};
  const options={clock:()=>now,random:()=>0.5,setTimeout:()=>({unref(){}}),clearTimeout(){}};
  const make=()=>{const scheduler=new Scheduler(config,claims,ledger,options);scheduler.stopped=false;return scheduler;};
  return {config,ledger,history,claims,make,get now(){return now;},set now(value){now=value;},get calls(){return calls;}};
}

test('newly discovered supported agents get entitlement tasks; no unsupported or international Trae fake check-in',()=>{
  for(const platform of ['workbuddy','workbuddyai','codebuddy','qoder','minimax','codearts','lobster'])assert.deepEqual(defaultDiscoveryTasks({platform}),[{id:'daily-checkin',enabled:true}],platform);
  for(const platform of ['qwenwork','loomy','raccoon'])assert.deepEqual(defaultDiscoveryTasks({platform}),[{id:'daily-quota',enabled:true}],platform);
  for(const edition of ['cn','solo'])assert.deepEqual(defaultDiscoveryTasks({platform:'trae',edition}),[{id:'daily-checkin',enabled:true}]);
  for(const edition of ['sg','solo-sg'])assert.deepEqual(defaultDiscoveryTasks({platform:'trae',edition}),[]);
  assert.deepEqual(defaultDiscoveryTasks({platform:'zcode'}),[{id:'free-plan-claim',enabled:true}]);
  for(const platform of ['bigmodel','antigravity','nvidia','freeapi','cline','opencode','unknown'])assert.deepEqual(defaultDiscoveryTasks({platform}),[],platform);
  const tasks=defaultDiscoveryTasks({platform:'lobster'});tasks[0].enabled=false;assert.equal(defaultDiscoveryTasks({platform:'lobster'})[0].enabled,true);
});

test('retry policy requires positive before-submission evidence and never replays uncertain/running/legacy errors',()=>{
  const s={retryMinutes:60},at=day+'T09:00:00+08:00',base={status:'error',attemptedAt:at,retryable:true,beforeSubmission:true};
  assert.equal(automaticRetryAt(base,s),Date.parse(at)+3600000);
  for(const status of ['success','already','observed','uncertain','busy','running','rejected','device_occupied'])assert.equal(automaticRetryAt({...base,status},s),null,status);
  assert.equal(automaticRetryAt({...base,beforeSubmission:false},s),null);
  assert.equal(automaticRetryAt({...base,retryable:false},s),null);
  assert.equal(automaticRetryAt({status:'error',attemptedAt:at},s),null);
  assert.equal(automaticRetryAt({...base,attemptedAt:'invalid'},s),null);
  assert.equal(automaticRetryAt({...base,nextClaimAt:day+'T11:00:00+08:00'},s),Date.parse(day+'T11:00:00+08:00'));
  assert.equal(automaticRetryAt({...base,retryAt:day+'T11:15:00+08:00'},s),Date.parse(day+'T11:15:00+08:00'));
});

test('pre-submission failure retries after configured delay across restart, not on every tick or startup',async()=>{
  const f=fixture(),s=f.make();
  try{
    await s.tick();assert.equal(f.calls,1);const missing=s.status().todayMissing[0];assert.equal(missing.automaticEligible,true);assert.equal(Date.parse(missing.nextRetryAt),f.now+3600000);
    await s.tick();assert.equal(f.calls,1);await s.stop();
    const next=f.make();try{await next.tick();assert.equal(f.calls,1);assert.equal(next.status().queue[0].source,'retry');f.now+=3599999;await next.tick();assert.equal(f.calls,1);f.now++;await next.tick();assert.equal(f.calls,2);f.claims.run=async()=>{return {status:'success',serverConfirmed:true};};f.now+=3600000;await next.tick();assert.equal(next.status().todayMissing.length,0);f.now+=3600000;await next.tick();assert.equal(next.status().queue.length,0);}finally{await next.stop();}
  }finally{await s.stop();}
});

test('legacy/ambiguous errors stay manual-only and a later ambiguous response closes retry eligibility',async()=>{
  const f=fixture(),s=f.make(),key=s.attemptKey(day,{accountId:'SAMPLE',task:'daily-checkin'});
  try{for(const status of ['uncertain','running','error']){f.ledger.set(key,{status,attemptedAt:day+'T01:00:00+08:00'});await s.tick();assert.equal(f.calls,0);assert.equal(s.status().todayMissing[0].automaticEligible,false);}
    f.ledger.set(key,{status:'error',attemptedAt:day+'T01:00:00+08:00',retryable:true,beforeSubmission:true});f.claims.run=async()=>({status:'uncertain',reason:'claim_response_not_confirmed',retryable:true,beforeSubmission:true});await s.tick();assert.equal(s.status().todayMissing[0].automaticEligible,false);await s.tick();assert.equal(s.status().queue.length,0);
  }finally{await s.stop();}
});

test('historical claim-result retry metadata survives absent scheduler meta and honors account/task disables',async()=>{
  const f=fixture();f.history.push({day,account_id:'SAMPLE',task:'daily-checkin',status:'error',time:day+'T01:00:00+08:00',result:JSON.stringify({reason:'SAMPLE_BEFORE_SUBMIT',retryable:true,beforeSubmission:true})});const s=f.make();
  try{assert.equal(s.status().todayMissing[0].automaticEligible,true);f.config.value.accounts[0].tasks[0].enabled=false;await s.tick();assert.equal(f.calls,0);f.config.value.accounts[0].tasks[0].enabled=true;f.config.value.accounts[0].enabled=false;await s.tick();assert.equal(f.calls,0);f.config.value.accounts[0].enabled=true;await s.tick();assert.equal(f.calls,1);}finally{await s.stop();}
});

test('late-day retry never executes a stale appointment in tomorrow new window',async()=>{
  const f=fixture();f.now=Date.parse(day+'T23:30:00+08:00');const s=f.make();
  try{await s.tick();assert.equal(f.calls,1);await s.tick();assert.equal(s.status().queue.length,0);const next=Date.parse(s.nextReplenishment().SAMPLE);assert.ok(next>f.now);const job={accountId:'SAMPLE',platform:'sample',task:'daily-checkin',source:'retry',day};f.now=Date.parse('2026-10-22T00:01:00+08:00');assert.equal((await s.execute(job)).reason,'schedule_day_changed');assert.equal(f.calls,1);}finally{await s.stop();}
});

test('Qoder completed earlier campaign reopens only at official next boundary, honoring configured window',async()=>{
  const f=fixture();f.config.value.accounts[0].platform='qoder';f.config.value.scheduler.hour=10;f.config.value.scheduler.minute=5;const s=f.make(),key=s.attemptKey(day,{accountId:'SAMPLE',task:'daily-checkin'}),nextClaimAt=day+'T10:00:00+08:00';
  try{
    f.ledger.set(key,{platform:'qoder',status:'success',campaignWindowId:'SAMPLE_OLD_CAMPAIGN',nextClaimAt,attemptedAt:day+'T08:00:00+08:00'});
    f.claims.run=async()=>({status:'success',campaignWindowId:'SAMPLE_NEW_CAMPAIGN',nextClaimAt:'2026-10-22T10:00:00+08:00'});
    assert.equal(s.status().todayMissing.length,0);await s.tick();assert.equal(s.status().queue[0].dueAt,Date.parse(day+'T10:05:00+08:00'));f.now=Date.parse(nextClaimAt);assert.equal(s.status().todayMissing[0].status,'next_window_due');await s.tick();assert.equal(s.status().queue.length,1);f.now+=5*60000;await s.tick();assert.equal(s.status().todayMissing.length,0);assert.equal(f.ledger.get(key).campaignWindowId,'SAMPLE_NEW_CAMPAIGN');await s.tick();assert.equal(s.status().queue.length,0);
    for(const status of ['uncertain','running','rejected'])assert.equal(automaticRetryAt({platform:'qoder',status,campaignWindowId:'SAMPLE_OLD_CAMPAIGN',nextClaimAt,attemptedAt:day+'T08:00:00+08:00'},f.config.value.scheduler),null);
    assert.equal(automaticRetryAt({platform:'qoder',status:'success',nextClaimAt,attemptedAt:day+'T08:00:00+08:00'},f.config.value.scheduler),null);
  }finally{await s.stop();}
});

test('ClaimService transient preflight error supplies retry metadata, while a later sent timeout stays fenced',async()=>{
  const f=fixture(),claimRows=new Map();let phase='preflight',posts=0;
  Object.assign(f.ledger,{claimKey:(...parts)=>JSON.stringify(parts),reserve:key=>{const old=claimRows.get(key);if(old?.status==='success')return {acquired:false,done:true,status:'success',result:old.result};claimRows.set(key,{status:'running'});return {acquired:true,uncertain:old?.status==='uncertain'||old?.status==='running'};},finish:(key,status,result)=>claimRows.set(key,{status,result}),record:row=>f.history.unshift({...row,time:new Date(f.now).toISOString()})});
  const claims=new ClaimService(f.config,{resolve:async()=>({principalHash:'SAMPLE'})},{status:async()=>{if(phase==='preflight')throw Object.assign(new Error('SAMPLE_UNAVAILABLE'),{status:503,code:'SAMPLE_503'});return {known:true,active:true,claimed:false};},claim:async()=>{posts++;throw Object.assign(new Error('SAMPLE_SENT_TIMEOUT'),{code:'ETIMEDOUT'});}},f.ledger);
  const s=new Scheduler(f.config,claims,f.ledger,{clock:()=>f.now,random:()=>0.5,setTimeout:()=>({unref(){}}),clearTimeout(){}});s.stopped=false;
  try{await s.tick();assert.equal(posts,0);assert.equal(s.status().todayMissing[0].automaticEligible,true);phase='submitted';f.now+=3600000;await s.tick();assert.equal(posts,1);assert.equal(s.status().todayMissing[0].status,'uncertain');assert.equal(s.status().todayMissing[0].automaticEligible,false);f.now+=3600000;await s.tick();assert.equal(posts,1);}finally{await s.stop();}
});

test('ClaimService Qoder campaign identity remains end-to-end idempotent across a same-calendar-day boundary',async()=>{
  const f=fixture(),claimRows=new Map();f.config.value.accounts[0].platform='qoder';let posts=0,claimed=false;
  Object.assign(f.ledger,{claimKey:(...parts)=>JSON.stringify(parts),reserve:key=>{const old=claimRows.get(key);if(['already','success'].includes(old?.status))return {acquired:false,done:true,status:old.status,result:old.result};claimRows.set(key,{status:'running'});return {acquired:true};},finish:(key,status,result)=>claimRows.set(key,{status,result}),record:row=>f.history.unshift({...row,time:new Date(f.now).toISOString()})});
  const boundary=Date.parse(day+'T10:00:00+08:00'),platforms={status:async()=>({known:true,active:true,claimed:f.now<boundary||claimed,day:f.now<boundary?'2026-10-20':day,campaignWindowId:f.now<boundary?'SAMPLE_OLD':'SAMPLE_NEW',nextClaimAt:f.now<boundary?new Date(boundary).toISOString():'2026-10-22T10:00:00+08:00'}),claim:async()=>{posts++;claimed=true;return {credit:1,submitted:true};}};
  const claims=new ClaimService(f.config,{resolve:async()=>({principalHash:'SAMPLE'})},platforms,f.ledger),s=new Scheduler(f.config,claims,f.ledger,{clock:()=>f.now,random:()=>0.5,setTimeout:()=>({unref(){}}),clearTimeout(){}});s.stopped=false;
  try{await s.tick();assert.equal(posts,0);assert.equal(s.status().todayAttempted[0].status,'already');await s.tick();assert.equal(posts,0);f.now=boundary;await s.tick();assert.equal(posts,1);assert.equal(s.status().todayAttempted[0].status,'success');assert.match(s.status().todayAttempted[0].campaignWindowId,/SAMPLE_NEW/);await s.tick();assert.equal(posts,1);assert.equal(claimRows.size,2);}finally{await s.stop();}
});

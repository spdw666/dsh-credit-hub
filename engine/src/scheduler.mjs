import {randomInt} from 'node:crypto';
import {dayIn} from './util.mjs';
import {runAutomaticWorkBuddyTasks} from './workbuddy-management.mjs';
import {evaluateWorkBuddyRotation} from './workbuddy-rotation.mjs';
import {clientUpdateDue,runClientUpdateCheck,cancelClientUpdateCheck} from './client-updates.mjs';
import {wallDay,windowPlan} from './scheduler-windows.mjs';
export function dailyPlan(now,schedule,jitter=0) {
  // Search local wall-clock minutes. This also handles DST folds/gaps on a future VPS timezone.
  const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:schedule.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const start=Math.floor(now.getTime()/60000)*60000;
  for(let minute=0;minute<3000;minute++){const at=new Date(start+minute*60000);const parts=Object.fromEntries(fmt.formatToParts(at).map(p=>[p.type,p.value]));
    if(Number(parts.hour)===schedule.hour&&Number(parts.minute)===schedule.minute){const target=at.getTime()+jitter*1000;if(target>now.getTime())return target;}
  }
  throw new Error('Schedule has no next daily time');
}
/** Retry only a positively classified pre-submission failure. Legacy errors,
 * running leases and ambiguous/uncertain submissions retain no-replay behavior.
 * The stored finish timestamp makes the delay survive worker/DSH restarts. */
export function automaticRetryAt(attempt,schedule) {
  // Qoder's official campaign day changes at 10:00 CST. A success before that
  // boundary belongs to the previous campaign, even on the same calendar day.
  // Only an adapter-provided campaign identity plus a later official boundary
  // may reopen a completed entry; generic completed/uncertain rows never do.
  if(attempt?.platform==='qoder'&&['success','already'].includes(attempt.status)&&typeof attempt.campaignWindowId==='string'&&attempt.campaignWindowId){
    const next=Date.parse(attempt.nextClaimAt),finished=Date.parse(attempt.finishedAt??attempt.attemptedAt);
    if(Number.isFinite(next)&&Number.isFinite(finished)&&next>finished)return next;
  }
  if(!attempt||!['error','not_available','action_required'].includes(attempt.status)||attempt.retryable!==true||attempt.beforeSubmission!==true)return null;
  const finished=Date.parse(attempt.finishedAt??attempt.attemptedAt);
  if(!Number.isFinite(finished))return null;
  const delay=Math.max(1,Number(schedule.retryMinutes)||60)*60000;
  const next=Date.parse(attempt.nextClaimAt),retry=typeof attempt.retryAt==='number'?attempt.retryAt:Date.parse(attempt.retryAt);
  return Math.max(finished+delay,Number.isFinite(next)?next:0,Number.isFinite(retry)?retry:0);
}
export class Scheduler {
  constructor(config,claims,ledger,options={}){Object.assign(this,{config,claims,ledger});this.timer=null;this.running=false;this.stopped=true;this.jobs=new Set();this.clock=options.clock??(()=>Date.now());this.random=options.random??(()=>randomInt(0,2147483647)/2147483647);this.setTimer=options.setTimeout??setTimeout;this.clearTimer=options.clearTimeout??clearTimeout;this.pending=[];this.active=new Map();this.sequence=0;this.closing=false;}
  track(promise){this.jobs.add(promise);void promise.finally(()=>this.jobs.delete(promise)).catch(()=>{});return promise;}
  now(){return Number(this.clock());}
  candidates(){return (this.config.value.accounts??[]).filter(a=>a.enabled!==false).flatMap(a=>(a.tasks??[]).filter(t=>t.enabled).map(t=>({accountId:a.id,platform:a.platform??'unknown',task:t.id})));}
  attemptKey(day,row){return 'checkin-attempt:'+JSON.stringify([day,row.accountId,row.task]);}
  historical(day){
    let rows=[];if(this.ledger.db?.prepare){rows=this.ledger.db.prepare('SELECT account_id,platform,task,status,time,result FROM records WHERE day=? ORDER BY id DESC').all(day);}else if(typeof this.ledger.records==='function')rows=this.ledger.records({limit:1000}).filter(r=>r.day===day);
    const map=new Map();for(const r of rows){const key=JSON.stringify([r.accountId??r.account_id,r.task]);if(!map.has(key)){let result=r.result;try{if(typeof result==='string')result=JSON.parse(result);}catch{result=null;}map.set(key,{status:r.status,platform:r.platform,attemptedAt:r.time??r.at,source:'claim-record',...(result&&typeof result==='object'?{reason:result.reason,retryable:result.retryable===true,beforeSubmission:result.beforeSubmission===true,...(result.retryAt?{retryAt:result.retryAt}:{}),...(result.campaignWindowId?{campaignWindowId:result.campaignWindowId}:{}),...(result.nextClaimAt?{nextClaimAt:result.nextClaimAt}:{})}:{})});}}return map;
  }
  attempts(day){const history=this.historical(day),map=new Map();for(const row of this.candidates()){const key=JSON.stringify([row.accountId,row.task]),stored=this.ledger.get(this.attemptKey(day,row)),record=history.get(key);const value=record&&(!stored||Date.parse(record.attemptedAt)>Date.parse(stored.finishedAt??stored.attemptedAt))?record:stored??record;if(value)map.set(key,value);}return map;}
  plans(now=this.now(),{startup=false}={}){
    const s=this.config.value.scheduler,day=wallDay(now,s.timezone),candidates=this.candidates(),signature=JSON.stringify([s.timezone,s.hour,s.minute,s.jitterSeconds,s.windows??{},candidates]);
    const key='checkin-plan:'+day,prior=this.ledger.get(key),old=new Map((prior?.entries??[]).map(r=>[JSON.stringify([r.accountId,r.task]),r])),entries=[];
    for(const row of candidates){const id=JSON.stringify([row.accountId,row.task]),windowSignature=JSON.stringify([s.timezone,s.windows?.[row.platform]??s.windows?.default??null,s.hour,s.minute,s.jitterSeconds]);let p=old.get(id);if(!p||p.windowSignature!==windowSignature)p={...row,...windowPlan(day,s,row.platform,this.random),windowSignature};else p={...p,platform:row.platform};
      if(startup&&s.startup===true&&p.at<now){const spread=s.startupSpreadSeconds??120;const unit=Math.min(1-Number.EPSILON,Math.max(0,Number(this.random())||0));p={...p,catchupAt:now+Math.floor(unit*(spread*1000+1)),catchupPlannedAt:now};}
      entries.push(p);
    }
    const plan={day,signature,entries};if(JSON.stringify(prior)!==JSON.stringify(plan))this.ledger.set(key,plan);
    this.ledger.set('schedule-plan',{day,signature,at:entries.length?Math.min(...entries.map(p=>p.catchupAt??p.at)):null,jitterSeconds:entries[0]?.jitterSeconds??0,entries});return plan;
  }
  status(now=this.now()){
    now=now instanceof Date?now.getTime():Number(now);const s=this.config.value.scheduler,plan=this.plans(now),attempts=this.attempts(plan.day),todayAttempted=[],todayMissing=[];
    for(const row of plan.entries){const attempt=attempts.get(JSON.stringify([row.accountId,row.task])),retryAt=automaticRetryAt(attempt,s),nextWindowDue=attempt?.platform==='qoder'&&['success','already'].includes(attempt.status)&&retryAt!==null&&now>=retryAt,base={accountId:row.accountId,platform:row.platform,task:row.task,plannedAt:row.catchupAt??row.at,window:row.window};if(attempt)todayAttempted.push({...base,...attempt});if(!attempt||!['success','already','observed'].includes(attempt.status)||nextWindowDue)todayMissing.push({...base,status:nextWindowDue?'next_window_due':attempt?.status??'missing',attemptedToday:!!attempt,automaticEligible:!attempt||retryAt!==null,...(retryAt!==null?{nextRetryAt:new Date(retryAt).toISOString()}:{}),...(attempt?.reason?{reason:attempt.reason}:{})});}
    return {enabled:s.enabled===true,timezone:s.timezone,day:plan.day,maxConcurrency:s.maxConcurrency??2,todayMissing,todayAttempted,queue:this.pending.map(({resolve,promise,id,sequence,...p})=>p),running:[...this.active.values()].map(({resolve,promise,id,sequence,...p})=>p),plan:plan.entries};
  }
  nextReplenishment(now=this.now()){
    const s=this.config.value.scheduler;if(this.stopped||!s.enabled)return {};
    const plan=this.plans(now),attempts=this.attempts(plan.day),nextDay=new Date(Date.parse(plan.day+'T00:00:00Z')+86400000).toISOString().slice(0,10),result={};
    for(const row of plan.entries){
      if(!['daily-checkin','daily-quota'].includes(row.task))continue;
      const attempt=attempts.get(JSON.stringify([row.accountId,row.task])),attempted=!!attempt,retryAt=automaticRetryAt(attempt,s);
      // Confirmed pre-submission failures and official next campaigns may have
      // a same-day appointment. Other completed/failed/running attempts use
      // tomorrow's latest real wall-window instant (DST-aware), not +24h.
      const retryCandidate=retryAt===null?null:Math.max(now+30000,retryAt,row.catchupAt??row.at),at=retryCandidate!==null&&wallDay(retryCandidate,s.timezone)===plan.day?retryCandidate:attempted?windowPlan(nextDay,s,row.platform,()=>1-Number.EPSILON).at:Math.max(now+30000,row.catchupAt??row.at);
      if(!result[row.accountId]||at<Date.parse(result[row.accountId]))result[row.accountId]=new Date(at).toISOString();
    }return result;
  }
  enqueue(row,{source='manual',dueAt=this.now(),missingOnly=false}={}){
    const day=wallDay(this.now(),this.config.value.scheduler.timezone),id=JSON.stringify([day,row.accountId,row.task]),existing=this.pending.find(p=>p.id===id)??this.active.get(id);if(existing){if(source!=='manual'&&existing.source!=='manual'&&!this.active.has(id)){Object.assign(existing,{...row,source,dueAt});this.pending.sort((a,b)=>a.dueAt-b.dueAt||a.sequence-b.sequence);this.arm();}return existing.promise;}
    if(this.closing)return Promise.resolve({...row,status:'cancelled',reason:'scheduler_stopped'});
    let resolve;const promise=new Promise(r=>{resolve=r;}),job={...row,id,day,source,dueAt,missingOnly,sequence:++this.sequence,resolve,promise};this.pending.push(job);this.pending.sort((a,b)=>a.dueAt-b.dueAt||a.sequence-b.sequence);this.arm();return promise;
  }
  arm(){
    this.clearTimer(this.queueTimer);this.queueTimer=null;if(this.closing||this.active.size>=(this.config.value.scheduler.maxConcurrency??2))return;
    const next=this.pending.find(p=>![...this.active.values()].some(a=>a.accountId===p.accountId));if(!next)return;
    this.queueTimer=this.setTimer(()=>{this.queueTimer=null;void this.pump();},Math.min(2147483647,Math.max(1,next.dueAt-this.now())));this.queueTimer?.unref?.();
  }
  async execute(job){
    const day=wallDay(this.now(),this.config.value.scheduler.timezone),base={accountId:job.accountId,platform:job.platform,task:job.task},attemptedAt=new Date(this.now()).toISOString(),key=this.attemptKey(day,job);
    if(job.source!=='manual'&&job.day!==day)return {...base,status:'cancelled',reason:'schedule_day_changed'};
    if(!this.candidates().some(r=>r.accountId===job.accountId&&r.task===job.task))return {...base,status:'skipped',reason:'account_or_task_disabled'};
    const previous=this.attempts(day).get(JSON.stringify([job.accountId,job.task]));
    const retryAt=automaticRetryAt(previous,this.config.value.scheduler);
    if(job.source!=='manual'&&previous&&(retryAt===null||this.now()<retryAt))return {...base,status:'skipped',reason:'already_attempted_today'};
    if(job.missingOnly&&previous&&['success','already','observed'].includes(previous.status)&&(retryAt===null||this.now()<retryAt))return {...base,status:'skipped',reason:'already_completed_today'};
    // Commit before touching credentials or the upstream. A crash, uncertain
    // response, busy state or exception therefore cannot become a startup replay.
    const attempt={status:'running',platform:job.platform,attemptedAt,source:job.source};this.ledger.set(key,attempt);
    let result;try{result=await this.claims.run(job.accountId,job.task);}catch(error){result={...base,status:'error',reason:error?.code??'scheduler_claim_error'};}
    result={...base,...result,status:result?.status??'error'};this.ledger.set(key,{...attempt,status:result.status,reason:result.reason??null,retryable:result.retryable===true,beforeSubmission:result.beforeSubmission===true,...(result.retryAt?{retryAt:result.retryAt}:{}),...(result.campaignWindowId?{campaignWindowId:result.campaignWindowId}:{}),...(result.nextClaimAt?{nextClaimAt:result.nextClaimAt}:{}),finishedAt:new Date(this.now()).toISOString()});return result;
  }
  async pump(){
    if(this.closing)return;const max=this.config.value.scheduler.maxConcurrency??2,started=[];
    while(this.active.size<max&&this.pending.length){
      const index=this.pending.findIndex(p=>p.dueAt<=this.now()&&![...this.active.values()].some(a=>a.accountId===p.accountId));if(index<0)break;
      const [job]=this.pending.splice(index,1);this.active.set(job.id,job);
      const flight=this.track(this.execute(job).then(result=>{job.resolve(result);return result;},error=>{const result={accountId:job.accountId,task:job.task,status:'error',reason:error?.code??'scheduler_queue_error'};job.resolve(result);return result;}).finally(()=>{this.active.delete(job.id);this.arm();}));job.promise=flight;started.push(flight);
    }
    this.arm();
    if(started.length){await Promise.all(started);if(!this.closing&&this.pending.some(p=>p.dueAt<=this.now()&&![...this.active.values()].some(a=>a.accountId===p.accountId)))await this.pump();}
  }
  async manual({accountIds,taskId,missingOnly=true}={}){
    if(accountIds!==undefined&&(!Array.isArray(accountIds)||accountIds.length>10000||accountIds.some(id=>typeof id!=='string')))throw new TypeError('accountIds must be an array of account IDs');
    // Disabling automatic scheduling cancels its pending work, but a later
    // explicit manual request may still use the bounded queue. Service.close()
    // sets this flag before stop(), and never permits such a reopen.
    if(this.stopped&&this.closing&&!this.service?.workbuddyTaskJobsClosing)this.closing=false;
    const selected=accountIds?new Set(accountIds):null,candidates=this.candidates().filter(r=>(!selected||selected.has(r.accountId))&&(!taskId||r.task===taskId)),day=wallDay(this.now(),this.config.value.scheduler.timezone),attempts=this.attempts(day),skipped=[],eligible=[];
    for(const row of candidates){const a=attempts.get(JSON.stringify([row.accountId,row.task])),retryAt=automaticRetryAt(a,this.config.value.scheduler);if(missingOnly&&a&&['success','already','observed'].includes(a.status)&&(retryAt===null||this.now()<retryAt))skipped.push({...row,status:'skipped',reason:'already_completed_today'});else eligible.push(row);}
    const requests=eligible.map(row=>this.enqueue(row,{source:'manual',missingOnly}));await this.pump();return {results:await Promise.all(requests),queued:eligible.length,skipped};
  }
  async tick() {
    if(this.stopped||this.tickFlight)return;
    this.tickFlight=this.performTick();try{return await this.tickFlight;}finally{this.tickFlight=null;}
  }
  async performTick() {
    if(this.service&&clientUpdateDue(this.service)){
      this.track(runClientUpdateCheck(this.service).catch(error=>{this.ledger.set('client-updates',{status:'error',error:error.message,checkedAt:new Date().toISOString()});}));
    }
    // WB automatic tasks are a separate user toggle from the daily check-in
    // schedule. Reuse this scheduler's lifecycle and tracked shutdown jobs.
    if(this.service?.config?.value?.workbuddy?.autoTasks===true&&Date.now()-(this.automaticWorkBuddyTasksAt??0)>=1800000){
      this.automaticWorkBuddyTasksAt=Date.now();
      this.track(runAutomaticWorkBuddyTasks(this.service).then(result=>{if(result.enabled)this.ledger.set('wb-automatic-tasks-last',{at:Date.now(),...result});}).catch(error=>{this.ledger.set('wb-automatic-tasks-last',{at:Date.now(),status:'error',code:error.code??'wb_auto_tasks_error'});}));
    }
    if(this.service?.config?.value?.workbuddy?.rotation?.enabled===true){this.track(evaluateWorkBuddyRotation(this.service,{dryRun:false},{scheduled:true}).catch(error=>{this.ledger.set('wb-rotation-last-error',{at:Date.now(),code:error.code??'wb_rotation_error'});}));}
    const s=this.config.value.scheduler;if(!s.enabled)return;
    // Compatibility for integrations exposing only a batch claim API. Native
    // ClaimService always has run(); its automatic and manual requests take the
    // bounded per-account queue below instead of this legacy adapter.
    if(typeof this.claims.run!=='function')return this.legacyTick();
    const now=this.now(),plan=this.plans(now),attempts=this.attempts(plan.day);
    const valid=new Set(plan.entries.map(row=>JSON.stringify([row.accountId,row.task])));this.pending=this.pending.filter(job=>{if(job.source==='manual'||job.day===plan.day&&valid.has(JSON.stringify([job.accountId,job.task])))return true;job.resolve({accountId:job.accountId,task:job.task,status:'cancelled',reason:'schedule_changed'});return false;});
    for(const row of plan.entries){const attempt=attempts.get(JSON.stringify([row.accountId,row.task])),retryAt=automaticRetryAt(attempt,s);if(attempt&&retryAt===null)continue;const dueAt=retryAt!==null?Math.max(retryAt,row.catchupAt??row.at):row.catchupAt??row.at;if(wallDay(dueAt,s.timezone)!==plan.day)continue;void this.enqueue(row,{source:retryAt!==null?'retry':row.catchupAt!==undefined?'startup':'window',dueAt});}
    await this.pump(); // Drain due jobs, but never await future appointments.
    const status=this.status(now);this.ledger.set('schedule-last',{day:plan.day,signature:plan.signature,at:now,complete:status.todayMissing.length===0,attempted:status.todayAttempted.length,queued:status.queue.length,results:status.todayAttempted.map(r=>({accountId:r.accountId,task:r.task,status:r.status}))});
  }
  async legacyTick(){
    const s=this.config.value.scheduler;if(typeof this.claims.all!=='function')return;
    const day=dayIn(new Date(),s.timezone);const signature=JSON.stringify([s.timezone,s.hour,s.minute,s.jitterSeconds,(this.config.value.accounts??[]).map(a=>[a.id,a.enabled,a.tasks])]);let plan=this.ledger.get('schedule-plan');
    if(!plan||plan.day!==day||plan.signature!==signature){const jitter=randomInt(0,s.jitterSeconds+1);const now=new Date();
      const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:s.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
      let target;const start=Math.floor(now.getTime()/60000)*60000-26*3600000;
      for(let i=0;i<52*60;i++){const at=new Date(start+i*60000);if(dayIn(at,s.timezone)!==day)continue;const parts=Object.fromEntries(fmt.formatToParts(at).map(p=>[p.type,p.value]));if(Number(parts.hour)===s.hour&&Number(parts.minute)===s.minute){target=at.getTime()+jitter*1000;break}}
      // A skipped DST wall-clock minute is deferred to the next valid daily time.
      target??=dailyPlan(now,s,jitter);plan={day,signature,at:target,jitterSeconds:jitter};this.ledger.set('schedule-plan',plan);
    }
    const last=this.ledger.get('schedule-last');
    const windowDue=Number.isFinite(last?.nextClaimAt)&&Date.now()>=last.nextClaimAt;
    if(Date.now()<plan.at||last?.day===day&&last.signature===signature&&!windowDue&&(last.complete||Date.now()-last.at<(s.retryMinutes??60)*60000))return;
    this.running=true;try{const results=await this.claims.all();const windows=results.map(r=>Date.parse(r.nextClaimAt)).filter(t=>Number.isFinite(t)&&t>Date.now());this.ledger.set('schedule-last',{day,signature,at:Date.now(),nextClaimAt:windows.length?Math.min(...windows):null,complete:results.every(r=>!['error','uncertain','busy','action_required'].includes(r.status)),results:results.map(r=>({accountId:r.accountId,task:r.task,status:r.status,nextClaimAt:r.nextClaimAt}))});}finally{this.running=false;}
  }
  start(){if(!this.stopped)return;this.stopped=false;this.closing=false;const tick=()=>this.track(this.tick()).catch(()=>{});this.timer=setInterval(tick,30000);this.timer.unref();if(typeof this.claims.run==='function'){if(this.config.value.scheduler.enabled)this.plans(this.now(),{startup:true});void tick();}else void this.track((async()=>{if(this.config.value.scheduler.startup&&typeof this.claims.all==='function'){this.running=true;try{await this.claims.all();}finally{this.running=false;}}await this.tick()})()).catch(()=>{});}
  stop(){this.stopped=true;this.closing=true;clearInterval(this.timer);this.clearTimer(this.queueTimer);for(const job of this.pending.splice(0))job.resolve({accountId:job.accountId,task:job.task,status:'cancelled',reason:'scheduler_stopped'});const monitor=this.service&&cancelClientUpdateCheck(this.service);return Promise.allSettled([...this.jobs,...(monitor?[monitor]:[])]);}
}

import {createHash,randomUUID} from 'node:crypto';
import {normalizeBalanceUnit} from './units.mjs';

export const EVENT_TYPES=Object.freeze(['checkin.failed','credential.expiring','balance.low','relay.triggered','request.failure_streak','update.available']);
const TITLES={'checkin.failed':'签到失败','credential.expiring':'登录凭据即将过期','balance.low':'余额低于预留线','relay.triggered':'已触发模型接力','request.failure_streak':'连续 3 次请求失败','update.available':'积分中枢有新版本'};
const STATE_KEY='credit-hub:events:v1',DAY=86400000,MAX_OUTBOX=256,MAX_SEEN=2048,MAX_RECENT=40;
const finite=v=>typeof v==='number'&&Number.isFinite(v),number=(v,fallback,min,max)=>finite(v)?Math.max(min,Math.min(max,v)):fallback;
const hash=v=>createHash('sha256').update(String(v)).digest('hex');
const instant=v=>v instanceof Date?v.getTime():typeof v==='number'?v:Date.parse(v);
const timeOf=(v,fallback)=>{const n=instant(v);return Number.isFinite(n)?n:fallback;};
const clock=now=>()=>timeOf(typeof now==='function'?now():now,Date.now());
const list=value=>value instanceof Map?[...value.entries()].map(([accountId,row])=>({accountId,...row})):Array.isArray(value)?value:value?.accounts??[];
const opaque=(kind,value)=>typeof value==='string'&&new RegExp('^'+kind+'-[a-f0-9]{12}$').test(value)?value:kind+'-'+hash(kind+'\0'+String(value??'unknown')).slice(0,12);
const accountKey=row=>String(row?.accountId??row?.account_id??row?.id??'');
const safeCode=value=>typeof value==='string'&&/^[a-z][a-z0-9_.-]{0,63}$/i.test(value)?value:undefined;
function label(value){return String(value??'账户').replace(/https?:\/\/\S+|Bearer\s+\S+|(?:access[_-]?token|api[_-]?key|password)\s*[:=]\s*\S+/gi,'[隐藏]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[邮箱隐藏]').replace(/\d{5,}/g,'[数字隐藏]').replace(/[A-Za-z0-9_-]{24,}/g,'[标识隐藏]').replace(/[\x00-\x1f\x7f]/g,'').slice(0,90);}
function eventPayload(input,at){
  if(!input||!EVENT_TYPES.includes(input.type))throw Object.assign(new TypeError('Unknown event type'),{code:'invalid_event_type'});
  const data={},source=input.data??input;
  for(const key of ['value','total','threshold','thresholdPercent','remainingDays','streak','reservePercent'])if(finite(source[key]))data[key]=source[key];
  if(['credits','CNY','USD','tokens','请求'].includes(normalizeBalanceUnit(source.unit)))data.unit=normalizeBalanceUnit(source.unit);
  for(const key of ['expiresAt','nextReplenishAt']){const n=instant(source[key]);if(Number.isFinite(n))data[key]=new Date(n).toISOString();}
  for(const key of ['currentVersion','latestVersion'])if(typeof source[key]==='string'&&/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(source[key]))data[key]=source[key];
  const reason=safeCode(source.reasonCode);if(reason)data.reasonCode=reason;
  if(source.routeId)data.routeId=opaque('route',source.routeId);
  const key=String(input.accountId??input.account_id??''),accountId=key?opaque('account',key):null;
  const payload={schemaVersion:1,id:'event-'+hash(input.id??[input.type,accountId,at,JSON.stringify(data)].join('\0')).slice(0,24),type:input.type,at:new Date(at).toISOString(),severity:['checkin.failed','request.failure_streak'].includes(input.type)?'error':'warning',title:TITLES[input.type],...(accountId?{accountId,accountLabel:label(input.accountLabel??input.label)}:{}),...(safeCode(input.platform)?{platform:input.platform}:{}),data};
  if(Buffer.byteLength(JSON.stringify(payload))>8192)throw new RangeError('Event payload exceeds 8 KiB');
  return payload;
}
export function validateEventSettings(input={}){
  const sinks={};
  for(const [id,sink] of Object.entries(input.sinks??{})){
    if(!/^[a-zA-Z0-9_-]{1,48}$/.test(id)||!sink||typeof sink!=='object')throw Object.assign(new TypeError('Invalid event sink'),{code:'invalid_event_sink'});
    const kind=sink.kind??(id==='native'?'native':'webhook');
    if(!['native','webhook','im'].includes(kind))throw Object.assign(new TypeError('Unsupported event sink'),{code:'invalid_event_sink'});
    if(kind==='native'){sinks[id]={kind,enabled:sink.enabled!==false};continue;}
    let url;try{url=new URL(sink.url);}catch{throw Object.assign(new TypeError('A webhook URL is required'),{code:'invalid_webhook_url'});}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||url.href.length>2048)throw Object.assign(new TypeError('Invalid webhook URL'),{code:'invalid_webhook_url'});
    const headers={};
    for(const [key,value] of Object.entries(sink.headers??{})){
      if(!/^[!#$%&'*+.^_`|~0-9a-z-]{1,80}$/i.test(key)||typeof value!=='string'||value.length>2048||/[\r\n]/.test(value)||/^(?:host|content-length|transfer-encoding|connection|cookie|proxy-authorization)$/i.test(key))throw Object.assign(new TypeError('Invalid webhook header'),{code:'invalid_webhook_header'});
      headers[key]=value;
    }
    if(Object.keys(headers).length>12)throw new RangeError('Too many webhook headers');
    sinks[id]={kind,enabled:sink.enabled!==false,url:url.href,headers};
  }
  // Native is the zero-configuration default. A missing host bridge is recorded
  // as a delivery failure, not as a successful notification.
  if(!Object.keys(sinks).length)sinks.native={kind:'native',enabled:true};
  const mappings={};
  for(const type of EVENT_TYPES){const targets=input.mappings?.[type]??(sinks.native?['native']:[]);if(!Array.isArray(targets)||targets.length>12||targets.some(id=>typeof id!=='string'||!sinks[id]))throw Object.assign(new TypeError('Event mapping refers to an unknown sink'),{code:'invalid_event_mapping'});mappings[type]=[...new Set(targets)];}
  const threshold=input.balanceThreshold??{};
  return {enabled:input.enabled!==false,mappings,sinks,credentialWarnDays:number(input.credentialWarnDays,7,0,90),balanceThreshold:{credits:number(threshold.credits,100,0,1000000000),percent:number(threshold.percent,10,0,100)},balanceMaxAgeSeconds:number(input.balanceMaxAgeSeconds,3600,5,86400),cooldownSeconds:number(input.cooldownSeconds,3600,0,604800),timeoutMs:number(input.timeoutMs,5000,100,15000),maxAttempts:Math.floor(number(input.maxAttempts,3,1,5)),retryBaseMs:number(input.retryBaseMs,30000,10,3600000)};
}
const settingsView=validateEventSettings;
function newState(){return {schemaVersion:1,outbox:[],seen:[],edges:{},lastEmit:{},streaks:{},requests:[],recent:[],dropped:0};}

/** Persistent, at-least-once event → sink router. emit/evaluate never wait for
 * network delivery. flush is an explicit bounded drain of currently-due work.
 * Native bridge callback resolves after host acknowledgement; return ack:false
 * or throw to retain a retry. Delivery id is stable across retries/restarts. */
export function createEventRouter({ledger,settings={},now=Date.now,fetch:fetcher=globalThis.fetch,onNativeEvent}={}){
  let config=settingsView(settings),state=newState(),closed=false,timer=null,flight=null,storageError=false;
  const tick=clock(now);
  try{const saved=ledger?.get?.(STATE_KEY);if(saved?.schemaVersion===1)state={...state,...saved,outbox:Array.isArray(saved.outbox)?saved.outbox.slice(-MAX_OUTBOX):[],seen:Array.isArray(saved.seen)?saved.seen.slice(-MAX_SEEN):[],requests:Array.isArray(saved.requests)?saved.requests.slice(-MAX_SEEN):[],recent:Array.isArray(saved.recent)?saved.recent.slice(-MAX_RECENT):[]};}catch{storageError=true;}
  const persist=()=>{try{ledger?.set?.(STATE_KEY,structuredClone(state));storageError=false;return true;}catch{storageError=true;return false;}};
  const remember=(key,array='seen')=>{state[array].push(key);state[array]=state[array].slice(-MAX_SEEN);};
  function schedule(){
    if(closed||timer||!config.enabled||!state.outbox.length)return;
    const next=Math.min(...state.outbox.map(item=>item.nextAt));
    timer=setTimeout(()=>{timer=null;void flush();},Math.max(0,Math.min(2147483647,next-tick())));timer.unref?.();
  }
  function emit(input){
    if(closed||!config.enabled)return {queued:0,reason:closed?'closed':'disabled'};
    let payload;try{payload=eventPayload(input,timeOf(input.at,tick()));}catch(error){return {queued:0,reason:error.code??'invalid_event'};}
    const seen='event:'+payload.id;if(state.seen.includes(seen))return {queued:0,reason:'duplicate'};
    const subject=payload.type==='update.available'?(payload.data.latestVersion??'global'):payload.accountId??payload.data.routeId??'global',key=payload.type+':'+subject,at=tick(),last=state.lastEmit[key];
    if(finite(last)&&at-last<config.cooldownSeconds*1000&&!input.force)return {queued:0,reason:'cooldown'};
    const sinks=config.mappings[payload.type].filter(id=>config.sinks[id]?.enabled!==false);
    if(!sinks.length)return {queued:0,reason:'unmapped'};
    if(state.outbox.length+sinks.length>MAX_OUTBOX){state.dropped++;persist();return {queued:0,reason:'outbox_full'};}
    remember(seen);state.lastEmit[key]=at;
    const queued=sinks.map(sinkId=>({deliveryId:randomUUID(),sinkId,event:payload,attempts:0,nextAt:at}));state.outbox.push(...queued);
    // Durable before delivery. A broken store does not falsely claim a durable
    // queue; in-memory work remains visible and can be retried once storage heals.
    const persisted=persist();schedule();return {queued:queued.length,eventId:payload.id,persisted};
  }
  function edge(key,active,make){
    const previous=state.edges[key]===true;state.edges[key]=active;
    if(active&&!previous){const result=emit(make());if(!result.queued&&['outbox_full','disabled'].includes(result.reason))state.edges[key]=false;}
  }
  function evaluate({accounts=[],balances=[],records=[],credentials=[],usage=[]}={}){
    if(closed||!config.enabled)return status();
    const at=tick(),byId=new Map(accounts.map(a=>[accountKey(a),a]));
    const context=id=>{const a=byId.get(String(id))??{};return {accountId:id,accountLabel:a.label??a.name,platform:a.platform};};
    for(const row of list(balances)){
      const id=accountKey(row),age=at-instant(row.checkedAt),fresh=finite(row.value)&&row.value>=0&&!row.stale&&!row.error&&Number.isFinite(age)&&age>=0&&age<=config.balanceMaxAgeSeconds*1000;
      const supported=normalizeBalanceUnit(row.unit)==='credits',total=finite(row.total)&&row.total>0?row.total:finite(row.totalValue)&&row.totalValue>0?row.totalValue:null;
      const low=fresh&&supported&&(row.value<=config.balanceThreshold.credits||total!==null&&row.value/total*100<=config.balanceThreshold.percent);
      // Unknown/stale is not evidence of recovery. Only a fresh observation can
      // reset the edge, otherwise an expired cache would create repeated alerts.
      if(fresh&&supported)edge('balance:'+opaque('account',id),low,()=>({...context(id),type:'balance.low',id:'balance:'+id+':'+row.checkedAt,data:{value:row.value,total,unit:row.unit,threshold:config.balanceThreshold.credits,thresholdPercent:config.balanceThreshold.percent}}));
    }
    for(const row of list(credentials)){
      const id=accountKey(row),expiry=instant(row.expiresAtMs??row.expiresAt??row.credentialExpiresAt),known=Number.isFinite(expiry);
      if(known)edge('credential:'+opaque('account',id),expiry-at<=config.credentialWarnDays*DAY,()=>({...context(id),type:'credential.expiring',id:'credential:'+id+':'+expiry,data:{expiresAt:new Date(expiry).toISOString(),remainingDays:Math.max(0,(expiry-at)/DAY)}}));
    }
    const ordered=(Array.isArray(records)?records:records.records??[]).slice().sort((a,b)=>timeOf(a.time??a.at,0)-timeOf(b.time??b.at,0)||Number(a.id??0)-Number(b.id??0));
    for(const row of ordered){
      const happened=timeOf(row.time??row.at,0);if(happened<at-DAY||happened>at+60000)continue;
      const fingerprint='record:'+hash(JSON.stringify([row.id,row.time,row.account_id??row.accountId,row.task,row.status]));if(state.seen.includes(fingerprint))continue;
      const id=accountKey(row),data=row.result??{};
      if(/^daily-(?:checkin|quota)$/.test(row.task??'')&&['error','uncertain','rejected','action_required','device_occupied'].includes(row.status))emit({...context(id),type:'checkin.failed',at:happened,id:fingerprint,data:{reasonCode:safeCode(data.reason??data.error?.code)??row.status}});
      if(row.task==='model-relay'&&row.status==='switched')emit({...context(id),type:'relay.triggered',at:happened,id:fingerprint,data:{routeId:data.routeId??row.routeId,reasonCode:data.reasonCode??row.reasonCode}});
      remember(fingerprint);
    }
    // Count logical terminal requests, not provider retry attempts. The engine
    // rewrites only its final attempt to requestOutcome.state failed/completed.
    const calls=Array.isArray(usage)?usage:usage.records??[],grouped=new Map();
    for(const row of calls){if(row.source==='audit'||row.status==='running'||row.status==='skipped'||row.status==='cancelled')continue;const terminal=row.requestOutcome?.state;if(terminal&& !['failed','completed'].includes(terminal))continue;if(!terminal&&row.requestId&&row.attempt>1)continue;if(row.requestId==null&&row.id==null)continue;const id=row.requestId??'usage:'+row.id;const prev=grouped.get(id);if(!prev||row.status==='completed'||Number(row.id??0)>Number(prev.id??0))grouped.set(id,row);}
    for(const [requestId,row] of [...grouped].sort((a,b)=>timeOf(a[1].finishedAt??a[1].startedAt,0)-timeOf(b[1].finishedAt??b[1].startedAt,0)||Number(a[1].id??0)-Number(b[1].id??0))){
      const atRow=timeOf(row.finishedAt??row.startedAt,0);if(atRow<at-DAY||atRow>at+60000)continue;
      const seen=hash(requestId);if(state.requests.includes(seen))continue;remember(seen,'requests');
      const scope=opaque('route',row.routeId??'gateway'),success=row.requestOutcome?.state==='completed'||row.status==='completed';
      const n=success?0:(state.streaks[scope]??0)+1;state.streaks[scope]=n;
      if(n===3)emit({...context(accountKey(row)),type:'request.failure_streak',id:'streak:'+seen,data:{streak:n,routeId:row.routeId,reasonCode:row.error?.code}});
    }
    // Bound local edge/streak keys even if configurations churn for months.
    for(const key of ['edges','lastEmit','streaks']){const entries=Object.entries(state[key]);if(entries.length>4096)state[key]=Object.fromEntries(entries.slice(-4096));}
    persist();schedule();return status();
  }
  async function deliver(item){
    const sink=config.sinks[item.sinkId];if(!sink||!sink.enabled)return {skipped:true};
    let deadline;
    const timed=new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Object.assign(new Error('Event delivery timed out'),{code:'sink_timeout'})),config.timeoutMs);});
    try{
      const operation=(async()=>{
        if(sink.kind==='native'){
          if(typeof onNativeEvent!=='function')throw Object.assign(new Error('Native notification bridge is unavailable'),{code:'native_unavailable'});
          const result=await onNativeEvent(structuredClone(item.event),{deliveryId:item.deliveryId});if(result===false||result?.ack===false)throw Object.assign(new Error('Native notification was not acknowledged'),{code:'native_not_acknowledged'});return;
        }
        if(typeof fetcher!=='function')throw Object.assign(new Error('Webhook transport is unavailable'),{code:'transport_unavailable'});
        const response=await fetcher(sink.url,{method:'POST',headers:{...sink.headers,'content-type':'application/json','x-credit-hub-delivery':item.deliveryId},body:JSON.stringify(item.event),redirect:'error',signal:AbortSignal.timeout(config.timeoutMs)});
        // Do not read/log remote response bodies or redirect to another origin.
        try{await response.body?.cancel?.();}catch{}
        if(!response.ok)throw Object.assign(new Error('Webhook rejected notification'),{code:'webhook_http_error'});
      })();
      await Promise.race([operation,timed]);return {delivered:true};
    }finally{clearTimeout(deadline);}
  }
  function flush(){
    if(flight)return flight;if(closed||!config.enabled)return Promise.resolve(status());
    flight=(async()=>{
      if(timer){clearTimeout(timer);timer=null;}
      // Each flush attempts each due delivery once, max two in parallel. A slow
      // sink never pauses chat/claim calls or retries forever in one turn.
      const due=state.outbox.filter(item=>item.nextAt<=tick()).slice(0,MAX_OUTBOX);let index=0;
      const work=async()=>{while(index<due.length&&!closed){const item=due[index++];let result;try{result=await deliver(item);}catch(error){result={failed:true,code:['sink_timeout','native_unavailable','native_not_acknowledged','transport_unavailable','webhook_http_error'].includes(error.code)?error.code:'sink_delivery_failed'};}
        item.attempts++;const complete=result.delivered||result.skipped||item.attempts>=config.maxAttempts;
        if(complete){state.outbox=state.outbox.filter(x=>x.deliveryId!==item.deliveryId);state.recent.unshift({deliveryId:item.deliveryId,eventId:item.event.id,type:item.event.type,sinkId:item.sinkId,at:new Date(tick()).toISOString(),attempts:item.attempts,status:result.delivered?'delivered':result.skipped?'disabled':'failed',...(result.code?{code:result.code}:{})});state.recent=state.recent.slice(0,MAX_RECENT);}
        else{item.nextAt=tick()+config.retryBaseMs*2**(item.attempts-1);item.lastCode=result.code;}
        persist();
      }};
      await Promise.all([work(),work()]);return status();
    })().finally(()=>{flight=null;schedule();});return flight;
  }
  function status(){return {enabled:config.enabled,pending:state.outbox.length,dropped:state.dropped,storageError,mappings:structuredClone(config.mappings),sinks:Object.fromEntries(Object.entries(config.sinks).map(([id,sink])=>[id,{kind:sink.kind,enabled:sink.enabled}])),credentialWarnDays:config.credentialWarnDays,balanceThreshold:{...config.balanceThreshold},cooldownSeconds:config.cooldownSeconds,recent:structuredClone(state.recent),deliverySemantics:'at_least_once',maxAttempts:config.maxAttempts};}
  function configure(next){config=settingsView(next);persist();if(timer){clearTimeout(timer);timer=null;}schedule();return status();}
  async function close(){closed=true;if(timer){clearTimeout(timer);timer=null;}await flight;persist();}
  schedule();return {emit,evaluate,status,configure,flush,close};
}

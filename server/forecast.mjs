import {createHash} from 'node:crypto';
import {normalizeBalanceUnit as normalizeUnit} from './units.mjs';

const DAY=86400000,HOUR=3600000,WINDOW_DAYS=7,HISTORY_KEY='credit-hub:balance-history:v1';
const finite=v=>typeof v==='number'&&Number.isFinite(v),positive=v=>finite(v)&&v>=0;
const time=v=>v instanceof Date?v.getTime():typeof v==='number'?v:Date.parse(v);
const idOf=row=>String(row?.accountId??row?.account_id??row?.id??'');
const opaque=id=>/^account-[a-f0-9]{12}$/.test(id)?id:'account-'+createHash('sha256').update('account\0'+id).digest('hex').slice(0,12);
const iso=v=>Number.isFinite(v)?new Date(v).toISOString():null;
const list=value=>value instanceof Map?[...value.entries()].map(([accountId,row])=>({accountId,...row})):Array.isArray(value)?value:value?.accounts??[];
const safeLabel=v=>String(v??'账户').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[邮箱隐藏]').replace(/\d{5,}/g,'[数字隐藏]').replace(/Bearer\s+\S+|https?:\/\/\S+|[A-Za-z0-9_-]{24,}/gi,'[标识隐藏]').slice(0,90);
const elapsedHours=(a,b)=>Math.max(0,b-a)/HOUR;

/** Capture only already-observed balances. This never fetches health, resolves
 * credentials, starts a claim, or writes an account/relay setting. */
export function captureBalanceHistory({ledger,balances=[],now=Date.now(),retentionDays=8}={}){
  const at=time(typeof now==='function'?now():now),cutoff=at-Math.max(7,Math.min(30,retentionDays))*DAY;
  let previous;try{previous=ledger?.get?.(HISTORY_KEY);}catch{}
  const rows=(Array.isArray(previous?.samples)?previous.samples:[]).filter(row=>time(row.checkedAt)>=cutoff&&time(row.checkedAt)<=at);
  const latest=new Map();for(const row of rows)latest.set(idOf(row),row);
  for(const row of list(balances)){
    const checked=time(row.checkedAt);if(!positive(row.value)||row.stale||row.error||!Number.isFinite(checked)||checked<cutoff||checked>at||typeof row.unit!=='string')continue;
    const id=idOf(row),old=latest.get(id);if(!id||old&&time(old.checkedAt)>=checked)continue;
    // The cache's observation time (not polling time) is retained; repeated
    // snapshots of one unchanged cache entry are not fabricated measurements.
    rows.push({accountId:id,checkedAt:iso(checked),value:row.value,unit:row.unit,...(positive(row.total)?{total:row.total}:{}),...(row.expiresAt?{expiresAt:row.expiresAt}:{})});latest.set(id,row);
  }
  const byAccount=new Map();for(const row of rows){const id=idOf(row);if(!byAccount.has(id))byAccount.set(id,[]);byAccount.get(id).push(row);}
  const samples=[...byAccount.values()].flatMap(items=>items.sort((a,b)=>time(a.checkedAt)-time(b.checkedAt)).slice(-4000));
  const output={schemaVersion:1,startedAt:previous?.startedAt??iso(at),capturedAt:iso(at),samples};
  try{ledger?.set?.(HISTORY_KEY,output);}catch{output.storageError=true;}
  return output;
}

function historySamples(history,id){
  const raw=history instanceof Map?history.get(id):history?.[id]??history?.samples??history;
  const rows=Array.isArray(raw)?raw:raw?.samples??[];const out=[];
  for(const row of rows){if(idOf(row)&&idOf(row)!==id)continue;const at=time(row.checkedAt??row.checked_at??row.at);if(Number.isFinite(at)&&positive(row.value)&&!row.stale&&!row.error)out.push({at,value:row.value,unit:normalizeUnit(row.unit)});
    // ledger.balanceChanges records a verified predecessor; preserve it even
    // when callers fetched only the last N changed observations.
    const prior=time(row.previous_at);if(Number.isFinite(prior)&&positive(row.previous_value))out.push({at:prior,value:row.previous_value,unit:normalizeUnit(row.unit)});
  }
  return [...new Map(out.map(row=>[row.at+'\0'+row.unit,row])).values()].sort((a,b)=>a.at-b.at);
}
function nextReplenishment(account,schedule,at){
  const choices=[];
  for(const value of [account.renewAt,account.renewalAt,account.nextReplenishAt,account.nextCheckinAt,schedule?.nextReplenishAt?.[account.id],schedule?.nextByAccount?.[account.id]]){const n=time(value);if(Number.isFinite(n)&&n>at)choices.push({at:n,source:'explicit'});}
  const candidates=schedule?.todayMissing??schedule?.plan?.accounts??schedule?.accounts??schedule?.plan?.entries??[];
  for(const row of candidates)if(idOf(row)===String(account.id)){const n=time(row.scheduledAt??row.dueAt??row.nextAt??row.at);if(Number.isFinite(n)&&n>at)choices.push({at:n,source:'scheduled_checkin'});}
  if(schedule?.running!==false&&schedule?.settings?.enabled!==false){
    const n=time(schedule?.nextRunAt??schedule?.plan?.nextAt??schedule?.plan?.at);if(Number.isFinite(n)&&n>at)choices.push({at:n,source:'scheduler_plan'});
  }
  return choices.sort((a,b)=>a.at-b.at)[0]??null;
}

/** Forecast is a transparent extrapolation, not a promise of future pricing.
 * usage coverage must describe the actual ledger recording interval. Absent
 * coverage is inferred only between the first/last measured rows, never from
 * "no rows" or the requested SQL filter. Token counters are never credits. */
export function buildForecast({usage=[],balances=[],accounts=[],schedule={},now=Date.now(),history=[]}={}){
  const at=time(typeof now==='function'?now():now),from=at-WINDOW_DAYS*DAY,rows=Array.isArray(usage)?usage:usage.records??[],balanceRows=list(balances),byBalance=new Map(balanceRows.map(row=>[idOf(row),row]));
  const safetyMultiplier=finite(schedule.safetyMultiplier)?Math.max(1,Math.min(5,schedule.safetyMultiplier)):1.2;
  const assumptions=['最近 7 天同单位可测消费 / 有效观测小时；不把缺失计费值当 0，不把 Token 换算成积分。','usage 仅包含启用记录后的网关调用，不含客户端绕过网关的消费；预测不是完整官方账单。','余额下降法排除充值上升区间，但同一区间消费与入账抵消仍可能低估；到期扣减也可能被计为净减少。','预留建议 = 每小时消耗 × 距下次补充小时 × 配置的余量系数；百分比 = 建议预留 / 已知总额度 × 100。','消费速率和未来补充时刻均假设保持；建议不自动修改接力策略；原引擎 reservePercent 上限 50%。'];
  const result=[];
  for(const account of accounts){
    const id=String(account.id??account.accountId??''),balance=byBalance.get(id)??{},unit=normalizeUnit(balance.unit),checked=time(balance.checkedAt),maxAge=positive(account.forecastBalanceMaxAgeSeconds)?account.forecastBalanceMaxAgeSeconds:positive(schedule.maxBalanceAgeHours)?schedule.maxBalanceAgeHours*3600:3600;
    const validBalance=positive(balance.value)&&!balance.stale&&!balance.error&&Number.isFinite(checked)&&at-checked>=0&&at-checked<=maxAge*1000;
    const expiration=time(balance.expiresAt),expired=Number.isFinite(expiration)&&expiration<=at;
    const value=positive(balance.value)?balance.value:null,total=positive(balance.total)&&balance.total>0?balance.total:positive(balance.totalValue)&&balance.totalValue>0?balance.totalValue:positive(account.capacity)?account.capacity:null;
    const base={accountId:opaque(id),label:safeLabel(account.label??account.name),platform:account.platform,unit:unit??null,remaining:value,capacity:total,balanceCheckedAt:iso(checked),balanceFresh:validBalance,source:null,status:'insufficient_data',reason:'measurement_history_required',burnRatePerHour:null,estimatedHours:null,exhaustAt:null,nextReplenishAt:null,reserveCredits:null,reservePercent:null,canApplyReservePercent:false,coverage:{windowHours:168,observedHours:0,ratio:0,from:null,to:null,measuredRows:0,missingRows:0,complete:false},assumptions:[...assumptions]};
    if(!['credits','CNY','USD','tokens'].includes(unit)){base.reason='unsupported_or_unknown_unit';result.push(base);continue;}
    const calls=rows.filter(row=>idOf(row)===id&&time(row.startedAt??row.started_at)>=from&&time(row.startedAt??row.started_at)<=at&&row.source!=='audit'&&row.status!=='skipped'&&row.status!=='running'&&row.rowType!=='request_outcome');
    const measured=[];let missing=0;
    for(const row of calls){const amount=unit==='credits'?row.credits:unit==='CNY'||unit==='USD'?normalizeUnit(row.costUnit)===unit?row.cost:null:null;if(positive(amount))measured.push({at:time(row.startedAt??row.started_at),amount});else missing++;}
    const paginated=!Array.isArray(usage)&&!usage.nextBeforeId&&(!finite(usage.total)||usage.total===rows.length),coverage=usage.coverage??{},coverageFrom=time(coverage.from),coverageTo=time(coverage.to);
    let usableCalls=measured.length>=3&&missing===0,measuredFrom=measured.length?Math.min(...measured.map(r=>r.at)):NaN,measuredTo=measured.length?Math.max(...measured.map(r=>r.at)):NaN;
    usableCalls=usableCalls&&elapsedHours(measuredFrom,measuredTo)>=24;
    const explicitCoverage=coverage.complete===true&&paginated&&Number.isFinite(coverageFrom)&&Number.isFinite(coverageTo)&&coverageTo>=measuredTo&&coverageFrom<=measuredFrom;
    // Global plugin history does not prove that a newly-added account was
    // observed during the preceding quiet days. Never prepend that history.
    if(explicitCoverage){measuredFrom=Math.max(from,coverageFrom,measuredFrom);measuredTo=Math.min(at,coverageTo);}
    let duration=elapsedHours(measuredFrom,measuredTo),amount=measured.reduce((n,row)=>n+row.amount,0),pointCount=measured.length,censored=0;
    if(usableCalls&&duration>=24){base.source=unit==='credits'?'upstream_credits':'upstream_cost';base.confidence=explicitCoverage?'measured':'partial';base.coverage={...base.coverage,observedHours:duration,ratio:Math.min(1,duration/168),from:iso(measuredFrom),to:iso(measuredTo),measuredRows:measured.length,missingRows:missing,complete:explicitCoverage&&duration>=168};}
    else{
      const samples=historySamples(history,id).filter(row=>row.unit===unit&&row.at>=from&&row.at<=at);
      if(validBalance)samples.push({at:checked,value:balance.value,unit});
      const points=[...new Map(samples.map(row=>[row.at,row])).values()].sort((a,b)=>a.at-b.at);
      duration=0;amount=0;pointCount=points.length;
      let first=NaN,last=NaN,intervals=0;
      for(let i=1;i<points.length;i++){
        const previous=points[i-1],current=points[i],hours=elapsedHours(previous.at,current.at);if(hours<=0)continue;
        if(current.value>previous.value){censored++;continue;}
        // Long unobserved gaps and unit changes do not silently become known
        // zero-consumption periods. At most 48 h per comparable interval.
        if(hours>48){censored++;continue;}
        duration+=hours;amount+=previous.value-current.value;intervals++;if(!Number.isFinite(first))first=previous.at;last=current.at;
      }
      base.source='balance_net_decrease';base.confidence='limited';
      base.coverage={...base.coverage,observedHours:duration,ratio:Math.min(1,duration/168),from:iso(first),to:iso(last),measuredRows:pointCount,missingRows:missing,censoredIntervals:censored,complete:false};
      usableCalls=intervals>=2&&pointCount>=3&&duration>=24;
    }
    if(!usableCalls||!Number.isFinite(duration)||duration<24){base.reason=missing?'billing_values_missing_and_balance_history_sparse':'less_than_24h_or_3_measurements';result.push(base);continue;}
    const rate=amount/duration;base.burnRatePerHour=rate;base.measuredConsumption=amount;
    if(!validBalance){base.status='balance_stale';base.reason='refresh_balance_before_forecast';result.push(base);continue;}
    if(expired){base.status='balance_expired';base.reason='balance_expiration_passed';result.push(base);continue;}
    base.status=rate>0?'estimated':'no_measured_burn';base.reason=rate>0?null:'zero_observed_consumption_not_infinite_entitlement';
    if(rate>0){base.estimatedHours=value/rate;base.exhaustAt=iso(at+base.estimatedHours*HOUR);if(Number.isFinite(expiration)&&expiration<time(base.exhaustAt)){base.balanceExpiresBeforeEstimate=true;base.effectiveLimitAt=iso(expiration);}}
    const next=nextReplenishment(account,schedule,at);base.nextReplenishAt=next?iso(next.at):null;base.nextReplenishSource=next?.source??null;
    if(next&&rate>0){const hours=elapsedHours(at,next.at);base.reserveCredits=Math.ceil(rate*hours*safetyMultiplier*100)/100;base.reserveUnit=balance.unit;base.reserveHours=hours;base.reserveSafetyFactor=safetyMultiplier;base.reserveFormula=`burnRatePerHour * hoursUntilNextReplenishment * ${safetyMultiplier}`;base.reservePercent=total?Math.ceil(base.reserveCredits/total*10000)/100:null;base.canApplyReservePercent=unit==='credits'&&base.reservePercent!==null&&base.reservePercent<=50;base.reserveReason=unit!=='credits'?'not_a_credit_relay_balance':!total?'capacity_unknown':base.reservePercent>50?'engine_reserve_percent_limit_50':'suggestion_only';base.insufficientUntilReplenishment=base.reserveCredits>value;}
    else base.reserveReason=!next?'next_replenishment_unknown':rate===0?'no_measured_burn':'insufficient_measurements';
    result.push(base);
  }
  return {generatedAt:iso(at),window:{from:iso(from),to:iso(at),days:WINDOW_DAYS},accounts:result,assumptions};
}

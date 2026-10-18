import test from 'node:test';
import assert from 'node:assert/strict';
import {buildForecast,captureBalanceHistory} from '../server/forecast.mjs';

const NOW=Date.parse('2026-10-18T10:00:00Z'),HOUR=3600000,DAY=24*HOUR,ID='SAMPLE_PRIVATE_ACCOUNT';
const at=offset=>new Date(NOW+offset).toISOString();
const account={id:ID,label:'SAMPLE 账户',platform:'workbuddy',renewAt:at(DAY)};
const balance={accountId:ID,value:24,total:1000,unit:'积分',checkedAt:at(-1000),stale:false};
const usage={records:Array.from({length:8},(_,i)=>({id:i+1,accountId:ID,startedAt:at((i-7)*DAY),status:'completed',credits:21,totalTokens:99999,chargeSource:'upstream_usage'})),total:8,nextBeforeId:null,coverage:{from:at(-7*DAY),to:at(0),complete:true}};
const run=options=>buildForecast({accounts:[account],balances:[balance],usage,now:NOW,...options}).accounts[0];
test('real CodeArts CREDIT unit is measured as credits, while unknown capacity remains unknown',()=>{const result=run({balances:[{...balance,unit:'CREDIT',total:null}]});assert.equal(result.status,'estimated');assert.equal(result.unit,'credits');assert.equal(result.estimatedHours,24);assert.equal(result.reservePercent,null);});
test('new account one-hour samples do not inherit seven days of global plugin coverage',()=>{const recent={...usage,records:[0,1,2].map((i)=>({...usage.records[i],startedAt:at((-1+i/2)*HOUR),credits:10})),total:3};const result=run({usage:recent});assert.equal(result.status,'insufficient_data');assert.equal(result.estimatedHours,null);});

test('known complete seven-day measured credits produce hours-to-empty and reserve recommendation with transparent units/formula',()=>{
  const result=run();assert.equal(result.status,'estimated');assert.equal(result.source,'upstream_credits');assert.equal(result.burnRatePerHour,1);assert.equal(result.estimatedHours,24);assert.equal(result.exhaustAt,at(DAY));assert.equal(result.reserveCredits,28.8);assert.equal(result.reservePercent,2.88);assert.equal(result.canApplyReservePercent,true);assert.equal(result.coverage.observedHours,168);assert.equal(result.coverage.complete,true);assert.equal(result.insufficientUntilReplenishment,true);assert.equal(result.nextReplenishAt,at(DAY));assert.equal(result.reserveFormula,'burnRatePerHour * hoursUntilNextReplenishment * 1.2');assert.match(result.accountId,/^account-[a-f0-9]{12}$/);assert.equal(JSON.stringify(result).includes(ID),false);
});

test('token counters and null credit fields never turn into fabricated zero-credit consumption or precise forecasts',()=>{
  const tokenOnly={...usage,records:usage.records.map(row=>({...row,credits:null,totalTokens:1000000}))};const result=run({usage:tokenOnly});assert.equal(result.status,'insufficient_data');assert.equal(result.estimatedHours,null);assert.equal(result.burnRatePerHour,null);assert.equal(result.coverage.missingRows,8);
  const sparse=run({usage:[usage.records[0]]});assert.equal(sparse.status,'insufficient_data');assert.equal(sparse.estimatedHours,null);
});

test('balance differences exclude top-ups rather than making negative consumption, and report censored intervals',()=>{
  const values=[300,276,252,500,476,452,428,404];const history=values.map((value,i)=>({accountId:ID,checkedAt:at((i-7)*DAY),unit:'积分',value}));
  const result=run({usage:[],history,balances:[{...balance,value:404}]});assert.equal(result.status,'estimated');assert.equal(result.source,'balance_net_decrease');assert.equal(result.burnRatePerHour,1);assert.equal(result.measuredConsumption,144);assert.equal(result.coverage.censoredIntervals,1);assert.equal(result.coverage.observedHours,144);assert.equal(result.coverage.complete,false);assert.equal(result.confidence,'limited');
});

test('stale or expired balances keep measured rate but suppress hours-to-empty and recommendation',()=>{
  for(const balances of [[{...balance,stale:true}],[{...balance,checkedAt:at(-2*HOUR)}],[{...balance,error:{code:'balance_timeout'}}]]){const result=run({balances});assert.equal(result.status,'balance_stale');assert.equal(result.burnRatePerHour,1);assert.equal(result.estimatedHours,null);assert.equal(result.reserveCredits,null);}
  const expired=run({balances:[{...balance,expiresAt:at(-1)}]});assert.equal(expired.status,'balance_expired');assert.equal(expired.estimatedHours,null);
  const expiresSoon=run({balances:[{...balance,expiresAt:at(HOUR)}]});assert.equal(expiresSoon.balanceExpiresBeforeEstimate,true);assert.equal(expiresSoon.effectiveLimitAt,at(HOUR));
});

test('capacity unknown and over-50-percent suggestions remain explicit and never auto-apply policy',()=>{
  const input=structuredClone({accounts:[account],balances:[balance],usage,now:NOW}),before=JSON.stringify(input);buildForecast(input);assert.equal(JSON.stringify(input),before);
  const unknown=run({balances:[{...balance,total:null}]});assert.equal(unknown.reserveCredits,28.8);assert.equal(unknown.reservePercent,null);assert.equal(unknown.reserveReason,'capacity_unknown');assert.equal(unknown.canApplyReservePercent,false);
  const high=run({balances:[{...balance,total:30}]});assert.equal(high.reservePercent,96);assert.equal(high.canApplyReservePercent,false);assert.equal(high.reserveReason,'engine_reserve_percent_limit_50');
  const noNext=run({accounts:[{id:ID}]});assert.equal(noNext.reserveCredits,null);assert.equal(noNext.reserveReason,'next_replenishment_unknown');
});

test('money, token and unsupported units remain segregated; token deltas never imply relay credit reserve',()=>{
  const mixed=usage.records.map(row=>({...row,credits:1000000,cost:21,costUnit:'CNY'})),money=run({balances:[{...balance,unit:'元'}],usage:{...usage,records:mixed}});assert.equal(money.burnRatePerHour,1);assert.equal(money.source,'upstream_cost');assert.equal(money.canApplyReservePercent,false);assert.equal(money.reserveReason,'not_a_credit_relay_balance');
  const wrongCurrency=run({balances:[{...balance,unit:'元'}],usage:{...usage,records:mixed.map(row=>({...row,costUnit:'USD'}))}});assert.equal(wrongCurrency.status,'insufficient_data');
  const tokens=run({balances:[{...balance,unit:'Token',value:52,checkedAt:at(0)}],history:[0,1,2].map(i=>({accountId:ID,checkedAt:at((i-2)*DAY),unit:'Token',value:100-i*24}))});assert.equal(tokens.burnRatePerHour,1);assert.equal(tokens.reserveReason,'not_a_credit_relay_balance');
  assert.equal(run({balances:[{...balance,unit:'免费API',value:null}]}).reason,'unsupported_or_unknown_unit');
});

test('pagination and gaps do not claim complete seven-day coverage; missing billing values can use independent balance history',()=>{
  const truncated=run({usage:{...usage,nextBeforeId:10,total:99}});assert.equal(truncated.coverage.complete,false);assert.equal(truncated.confidence,'partial');
  const history=[{account_id:ID,checked_at:at(-6*DAY),previous_at:at(-7*DAY),previous_value:200,value:176,unit:'积分'},{account_id:ID,checked_at:at(-5*DAY),previous_at:at(-6*DAY),previous_value:176,value:152,unit:'积分'}];
  const result=run({usage:usage.records.map(row=>({...row,credits:null})),history});assert.equal(result.source,'balance_net_decrease');assert.equal(result.burnRatePerHour,1);assert.equal(result.coverage.observedHours,48);assert.equal(result.coverage.censoredIntervals,1);
  const tiny=run({usage:[],history:[{accountId:ID,checkedAt:at(-2*HOUR),value:50,unit:'积分'},{accountId:ID,checkedAt:at(-HOUR),value:40,unit:'积分'}]});assert.equal(tiny.status,'insufficient_data');
});

test('cached balance capture is durable, pruned, timestamp-deduplicated and excludes stale/error observations',()=>{
  const map=new Map(),ledger={get:key=>structuredClone(map.get(key)),set:(key,value)=>map.set(key,structuredClone(value))};
  const first=captureBalanceHistory({ledger,balances:[balance],now:NOW});assert.equal(first.samples.length,1);assert.equal(first.samples[0].checkedAt,balance.checkedAt);
  const repeated=captureBalanceHistory({ledger,balances:[balance,{...balance,accountId:'SAMPLE_STALE',stale:true},{...balance,accountId:'SAMPLE_ERROR',error:{}},{...balance,accountId:'SAMPLE_TOKEN',value:null}],now:NOW+HOUR});assert.equal(repeated.samples.length,1);
  const later=captureBalanceHistory({ledger,balances:[{...balance,checkedAt:at(HOUR),value:23}],now:NOW+HOUR});assert.equal(later.samples.length,2);const pruned=captureBalanceHistory({ledger,balances:[],now:NOW+10*DAY});assert.equal(pruned.samples.length,0);assert.equal(pruned.startedAt,at(0));
});

test('known zero measured burn is not an infinite entitlement; future and different-account measurements are excluded',()=>{
  const zero=run({usage:{...usage,records:usage.records.map(row=>({...row,credits:0}))}});assert.equal(zero.status,'no_measured_burn');assert.equal(zero.burnRatePerHour,0);assert.equal(zero.estimatedHours,null);assert.equal(zero.reserveCredits,null);
  const noMatch=run({usage:usage.records.map(row=>({...row,accountId:'SAMPLE_OTHER'}))});assert.equal(noMatch.status,'insufficient_data');
  const future=run({usage:usage.records.map(row=>({...row,startedAt:at(DAY)}))});assert.equal(future.status,'insufficient_data');
});

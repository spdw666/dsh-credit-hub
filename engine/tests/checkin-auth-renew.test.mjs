import test from 'node:test';import assert from 'node:assert/strict';
import {Platforms} from '../src/platforms.mjs';import {AppError} from '../src/util.mjs';
test('read-only daily status renews an owned rejected credential once',async()=>{
 const a={id:'SAMPLE',platform:'workbuddy'},options=[],seen=[];
 const p=new Platforms({}, {account:()=>a,resolve:async(id,o)=>{options.push(o);return {accessToken:o?.renew?'SAMPLE_NEW':'SAMPLE_OLD'};}});
 p.wb={fetchCheckinStatus:async c=>{seen.push(c.accessToken);if(c.accessToken==='SAMPLE_OLD')throw new AppError('rejected',401,'WORKBUDDY_CREDENTIAL_REJECTED');return {active:true,todayCheckedIn:true,todayCredit:100};}};
 assert.equal((await p.status(a.id,'daily-checkin')).claimed,true);assert.deepEqual(seen,['SAMPLE_OLD','SAMPLE_NEW']);assert.deepEqual(options[1],{force:true,renew:true});
});
test('unchanged rejected credential is not replayed and no claim is sent',async()=>{
 const a={id:'SAMPLE',platform:'workbuddy'};let reads=0;
 const p=new Platforms({}, {account:()=>a,resolve:async()=>({accessToken:'SAMPLE_OLD'})});
 p.wb={fetchCheckinStatus:async()=>{reads++;throw new AppError('rejected',401,'credential_expired');}};
 await assert.rejects(p.status(a.id,'daily-checkin'),{code:'credential_expired'});assert.equal(reads,1);
});

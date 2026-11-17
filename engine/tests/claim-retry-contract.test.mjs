import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ClaimService} from '../src/claims.mjs';import {Ledger} from '../src/store.mjs';import {AppError} from '../src/util.mjs';
async function fixture(t,{errorAt='status',error=new AppError('transient',503,'busy'),status}={}){
 const dir=await mkdtemp(join(tmpdir(),'claim-retry-'));const ledger=new Ledger(dir);t.after(async()=>{ledger.close();await rm(dir,{recursive:true,force:true});});
 const config={value:{scheduler:{timezone:'Asia/Shanghai'},accounts:[{id:'SAMPLE',platform:'lobster',tasks:[{id:'daily-checkin',enabled:true}]}]}};
 const platforms={status:async()=>{if(errorAt==='status')throw error;return status??{known:true,active:true,claimed:false};},claim:async()=>{throw error;}};
 return new ClaimService(config,{resolve:async()=>({principalHash:'SAMPLE'})},platforms,ledger);
}
test('pre-submission transport failures carry retry metadata',async t=>{const s=await fixture(t);const r=await s.run('SAMPLE');assert.equal(r.status,'error');assert.equal(r.beforeSubmission,true);assert.equal(r.retryable,true);});
test('unknown official state can retry but never submits',async t=>{const s=await fixture(t,{errorAt:'none',status:{known:false}});const r=await s.run('SAMPLE');assert.equal(r.status,'error');assert.equal(r.retryable,true);});
test('post-submission timeout stays uncertain and not retryable',async t=>{const s=await fixture(t,{errorAt:'claim'});const r=await s.run('SAMPLE');assert.equal(r.status,'uncertain');assert.equal(r.beforeSubmission,false);assert.equal(r.retryable,false);});
test('definitive temporary pre-submission refusal can retry',async t=>{const error=Object.assign(new AppError('congested',503,'claim_temporarily_busy'),{beforeSubmission:true,retryable:true});const s=await fixture(t,{errorAt:'claim',error});const r=await s.run('SAMPLE');assert.equal(r.status,'error');assert.equal(r.beforeSubmission,true);assert.equal(r.retryable,true);});
test('expired credentials stay actionable and get only scheduled pre-submission rechecks',async t=>{const s=await fixture(t,{error:new AppError('login',401,'credential_expired')});const r=await s.run('SAMPLE');assert.equal(r.status,'action_required');assert.equal(r.beforeSubmission,true);assert.equal(r.retryable,true);});
test('a failing read cannot erase an earlier uncertain submission fence',async t=>{
 const s=await fixture(t,{errorAt:'none'});let posts=0;
 s.platforms.claim=async()=>{posts++;return {submitted:true,claimed:false};};
 assert.equal((await s.run('SAMPLE')).status,'uncertain');
 s.platforms.status=async()=>{throw new AppError('read unavailable',503,'busy');};
 const failed=await s.run('SAMPLE');assert.equal(failed.status,'uncertain');assert.equal(failed.retryable,false);
 s.platforms.status=async()=>({known:true,active:true,claimed:false});
 assert.equal((await s.run('SAMPLE')).reason,'previous_submission_unconfirmed');assert.equal(posts,1);
});
// A deterministic envelope rejection is an ANSWER (the server validated and discarded the request,
// claiming nothing), so it is safe to resend later the same day and cannot double-credit. Distinct
// from a post-submission timeout, which stays uncertain forever. LobsterAI 51103 previously locked
// the account for the whole day; it now reports not_available + retryable so the scheduler replays it.
test('deterministic rejection is retryable while a timeout stays fenced',async t=>{
 const s=await fixture(t,{errorAt:'none'});let posts=0;
 s.platforms.claim=async()=>{posts++;if(posts===1)throw Object.assign(new AppError('refused',503,'lobster_action_invalid'),{definitiveRejection:true,beforeSubmission:true,retryable:true});return {submitted:true,claimed:true};};
 s.platforms.status=async()=>({known:true,active:true,claimed:posts>=2});
 const first=await s.run('SAMPLE');assert.equal(first.status,'error');assert.equal(first.retryable,true);assert.equal(first.beforeSubmission,true);
 const second=await s.run('SAMPLE');assert.equal(second.status,'success');assert.equal(posts,2);
});
test('a deterministic rejection never escapes an earlier uncertain fence',async t=>{
 const s=await fixture(t,{errorAt:'none'});let posts=0;
 s.platforms.claim=async()=>{posts++;if(posts===1)return {submitted:true,claimed:false};throw Object.assign(new AppError('refused',502,'lobster_action_invalid'),{definitiveRejection:true});};
 assert.equal((await s.run('SAMPLE')).status,'uncertain');
 const fenced=await s.run('SAMPLE');assert.equal(fenced.status,'uncertain');assert.equal(fenced.reason,'previous_submission_unconfirmed');assert.equal(posts,1);
});

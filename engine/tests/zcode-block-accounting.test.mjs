import test from 'node:test';
import assert from 'node:assert/strict';
import {zcodeChat} from '../src/zcode-models.mjs';
import {Router} from '../src/router.mjs';
import {collectChat} from '../src/openai.mjs';
import {hash,AppError,errorView,zcodeFailureMetadata} from '../src/util.mjs';
import {RequestPlan} from '../src/request-plan.mjs';
import {UsageAttempt} from '../src/usage.mjs';
const c={principal:'SAMPLE_PRINCIPAL',accessToken:'SAMPLE_TOKEN',identity:{deviceId:'SAMPLE_DEVICE'}};
const id='glm-5.3-flash',req={model:'zcode-native/'+id,messages:[{role:'user',content:'SAMPLE'}],max_completion_tokens:128000};
const blocked=sent=>Object.assign(new AppError('SAMPLE_BLOCK',503,'zcode_upstream_blocked'),{upstreamRequestSent:sent,upstreamCode:3012,upstreamStatus:405,retryable:false,actionRequired:true,retryAfterSeconds:900,retryAfterSource:'local_default'});
function fixture({relay=true,count=1,chat}={}){
 const meta=new Map(),usages=[],ledger={get:k=>meta.get(k),set:(k,v)=>meta.set(k,v),beginUsage:r=>(usages.push(structuredClone(r)),usages.length-1),finishUsage:(i,r)=>usages[i]=structuredClone(r)};
 const config={value:{accounts:Array.from({length:count},(_,i)=>({id:'a'+i})),upstreams:Array.from({length:count},(_,i)=>({id:'z'+i,kind:'zcode',accountId:'a'+i})),routes:[{id:req.model,targets:Array.from({length:count},(_,i)=>({upstreamId:'z'+i,model:id})),fallbackStatuses:[405,503]}],modelRelay:{enabled:relay,reservePercent:10,reserveCredits:100,balanceMaxAgeSeconds:60}}};
 const platforms={models:async()=>[{id,tools:true,multimodal:true,contextWindow:1000000,maxTokens:128000}],chat:chat??(async(_t,r,s)=>zcodeChat(c,r,s,ledger))};return {meta,usages,ledger,router:new Router(config,platforms,{ledger,relayNetworkRetryDelayMs:0})};
}
async function mockFetch(t,fn){const old=globalThis.fetch;globalThis.fetch=fn;t.after(()=>{globalThis.fetch=old;});}

test('persisted local3012 gate has zero fetches, zero candidate sends, zero request attempts',async t=>{
 const f=fixture(),until=Date.now()+120000,key='proxy-block/zcode/'+hash(c.principal);f.meta.set(key,{until,code:3012,http:405});let hits=0;await mockFetch(t,async()=>{hits++;throw Error('SAMPLE_UNEXPECTED');});let e;
 try{await collectChat(f.router.chat(req));}catch(error){e=error;}
 assert.equal(hits,0);assert.equal(e.code,'zcode_upstream_blocked');assert.equal(e.upstreamRequestSent,false);assert.equal(e.relayFailure.attemptCount,0);assert.equal(f.usages[0].dispatched,false);assert.equal(f.usages[0].dispatchCount,0);assert.equal(f.usages[0].requestOutcome.attemptCount,0);assert.equal(f.usages[0].requestOutcome.dispatchCount,0);assert.equal(f.usages[0].error.upstreamRequestSent,false);assert.equal(f.usages[0].error.upstreamCode,3012);assert.equal(f.meta.get(key).until,until);
 assert.equal([...f.meta.keys()].some(k=>k.startsWith('relay-cooldown:')),false);
});
for(const status of [200,405])test('fresh official3012 HTTP'+status+' stays one real dispatch with original status',async t=>{
 const f=fixture();let hits=0;await mockFetch(t,async()=>{hits++;return status===200?new Response('data: {"code":3012,"msg":"SAMPLE_PRIVATE"}\n\n',{headers:{'content-type':'text/event-stream'}}):new Response('{"code":3012,"msg":"SAMPLE_PRIVATE"}',{status});});let e;
 try{await collectChat(f.router.chat(req));}catch(error){e=error;}
 assert.equal(hits,1);assert.equal(e.upstreamRequestSent,true);assert.equal(e.upstreamStatus,status);assert.equal(e.relayFailure.attemptCount,1);assert.equal(f.usages[0].dispatched,true);assert.equal(f.usages[0].dispatchCount,1);assert.equal(f.usages[0].requestOutcome.attemptCount,1);assert.equal(f.usages[0].requestOutcome.dispatchCount,1);assert.equal(f.usages[0].error.upstreamStatus,status);assert.equal(f.usages[0].error.upstreamRequestSent,true);assert.doesNotMatch(JSON.stringify(f.usages),/SAMPLE_PRIVATE/);
 assert.equal([...f.meta.keys()].some(k=>k.startsWith('relay-cooldown:')),false);
});

for(const relay of [false,true])for(const sent of [false,true])test('3012 does not switch supplier/model despite fallback503; relay='+relay+' sent='+sent,async()=>{
 const calls=[],f=fixture({relay,count:2,chat:async target=>{calls.push(target.upstreamId);throw blocked(sent);}});await assert.rejects(collectChat(f.router.chat(req)),e=>e.code==='zcode_upstream_blocked');assert.deepEqual(calls,['z0']);assert.equal(f.usages.length,1);assert.equal(f.usages[0].dispatchCount,sent?1:0);assert.equal(f.meta.size,0);
});
test('local second candidate only retracts itself; an adjacent genuinely sent candidate remains counted',async()=>{
 const calls=[],f=fixture({count:3,chat:async target=>{calls.push(target.upstreamId);if(target.upstreamId==='z0')throw new AppError('SAMPLE_SENT_FAILURE',503,'provider_http_error');throw blocked(false);}});let error;
 try{await collectChat(f.router.chat(req));}catch(e){error=e;}
 assert.deepEqual(calls,['z0','z1']);assert.equal(f.usages.length,2);assert.equal(f.usages[0].dispatched,true);assert.equal(f.usages[0].dispatchCount,1);assert.equal(f.usages[1].dispatched,false);assert.equal(f.usages[1].dispatchCount,0);assert.equal(f.usages[1].requestOutcome.dispatchCount,1);assert.equal(f.usages[1].requestOutcome.attemptCount,1);assert.equal(error.relayFailure.attemptCount,1);
});
test('a real transport send in the same usage row is not erased by later local-block evidence',async()=>{
 let calls=0;const f=fixture({chat:async()=>{calls++;if(calls===1)throw new AppError('SAMPLE_SENT_NETWORK_ERROR',502,'provider_network_error');throw blocked(false);}});await assert.rejects(collectChat(f.router.chat(req)),e=>e.code==='zcode_upstream_blocked');assert.equal(calls,2);assert.equal(f.usages[0].dispatched,true);assert.equal(f.usages[0].dispatchCount,2);assert.equal(f.usages[0].requestOutcome.attemptCount,1);
});
for(const value of [null,'false',0,undefined])test('unverified sent flag '+String(value)+' never retracts a send',async()=>{
 const f=fixture({chat:async()=>{throw blocked(value);}});await assert.rejects(collectChat(f.router.chat(req)));assert.equal(f.usages[0].dispatched,true);assert.equal(f.usages[0].dispatchCount,1);assert.equal(f.usages[0].requestOutcome.attemptCount,1);
});
test('another error code with a false send flag never enters ZCode retraction',async()=>{
 const f=fixture({relay:false,chat:async()=>{throw Object.assign(new AppError('SAMPLE',503,'provider_http_error'),{upstreamRequestSent:false});}});await assert.rejects(collectChat(f.router.chat(req)));assert.equal(f.usages[0].dispatched,true);assert.equal(f.usages[0].dispatchCount,1);
});
test('retraction is bounded and same usage guard is idempotent',()=>{
 const p=new RequestPlan(req,{upstreams:[]}),u=new UsageAttempt(null,{upstreams:[]},req,{upstreamId:'SAMPLE',model:id});assert.equal(p.retractUnsentDispatch(),false);assert.equal(u.retractUnsentDispatch(),false);p.dispatched(true);u.dispatched();assert.equal(u.retractUnsentDispatch(),true);assert.equal(p.retractUnsentDispatch(),true);assert.equal(u.retractUnsentDispatch(),false);assert.equal(p.retractUnsentDispatch(),false);assert.equal(p.dispatchCount,0);assert.equal(p.attemptCount,0);assert.equal(u.row.dispatchCount,0);
 p.dispatched(true);u.dispatched();u.dispatched();assert.equal(u.retractUnsentDispatch(),false);assert.equal(u.row.dispatched,true);assert.equal(u.row.dispatchCount,2);
});
test('ZCode errorView exports only bounded typed fields, never arbitrary payload or credential fields',()=>{
 const e=Object.assign(blocked(false),{headers:{authorization:'SAMPLE_PRIVATE_TOKEN'},accessToken:'SAMPLE_PRIVATE_TOKEN',deviceId:'SAMPLE_PRIVATE_DEVICE',request:{messages:['SAMPLE_PRIVATE_PROMPT']},arbitrary:'SAMPLE_PRIVATE_FIELD'}),view=errorView(e);
 assert.deepEqual(view,{code:e.code,message:'SAMPLE_BLOCK',status:503,upstreamCode:3012,upstreamStatus:405,upstreamRequestSent:false,retryable:false,actionRequired:true,retryAfterSeconds:900,retryAfterSource:'local_default'});assert.doesNotMatch(JSON.stringify(view),/SAMPLE_PRIVATE/);
});
test('HTTP200 official metadata is accepted but out-of-range or mistyped fields are dropped',()=>{
 assert.equal(zcodeFailureMetadata({...blocked(true),upstreamStatus:200}).upstreamStatus,200);
 const out=zcodeFailureMetadata({...blocked(true),upstreamCode:'3012',upstreamStatus:'405',upstreamRequestSent:'false',retryable:0,actionRequired:'true',retryAfterSeconds:90001,retryAfterSource:'SAMPLE_PRIVATE'});assert.deepEqual(out,{});
 for(const upstreamStatus of [0,99,600,NaN,Infinity])assert.equal(zcodeFailureMetadata({...blocked(true),upstreamStatus}).upstreamStatus,undefined);
 for(const retryAfterSeconds of [-1,NaN,Infinity,1.5,'900'])assert.equal(zcodeFailureMetadata({...blocked(true),retryAfterSeconds}).retryAfterSeconds,undefined);
 assert.deepEqual(zcodeFailureMetadata({...blocked(true),code:'provider_http_error'}),{});assert.deepEqual(zcodeFailureMetadata(null),{});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from '../src/server.mjs';
import {AppError} from '../src/util.mjs';
import {gatewayFailureContract,relayFailureMetadata} from '../src/client-contract.mjs';
const context={requestId:'aigw-00000000-0000-4000-8000-000000000000'};
function block({sent=false,upstreamStatus=405,...extra}={}){return Object.assign(new AppError('SAMPLE_TYPED_BLOCK',503,'zcode_upstream_blocked'),{upstreamCode:3012,upstreamStatus,upstreamRequestSent:sent,retryable:false,actionRequired:true,retryAfterSeconds:900,retryAfterSource:'local_default',relayFailure:{root:{platform:'zcode',code:'zcode_upstream_blocked',status:503},last:{code:'zcode_upstream_blocked',status:503},attemptCount:sent?1:0,skippedCount:0},...extra});}
async function query(error,{stream=false,emitFirst=false}={}){
 const config={value:{server:{host:'127.0.0.1',port:0,requestTimeoutMs:5000},routes:[]}};
 const router={async*chat(){if(emitFirst)yield {id:'SAMPLE',choices:[{index:0,delta:{content:'SAMPLE_PREFIX'},finish_reason:null}]};throw error;}};
 const server=await startServer({config,router,keys:{apiKey:'SAMPLE_KEY',adminKey:'SAMPLE_ADMIN'}},{port:0});
 try{const response=await fetch(server.baseUrl+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer SAMPLE_KEY','Content-Type':'application/json'},body:JSON.stringify({model:'SAMPLE_MODEL',messages:[{role:'user',content:'SAMPLE_REQUEST'}],stream})});return {status:response.status,headers:response.headers,text:await response.text()};}finally{await server.close();}
}
for(const upstreamStatus of [200,405])for(const sent of [false,true])test('public JSON3012 retains HTTP'+upstreamStatus+' sent='+sent+' and gateway retry owner',async()=>{
 const result=await query(block({upstreamStatus,sent,headers:{authorization:'SAMPLE_PRIVATE_AUTH'},accessToken:'SAMPLE_PRIVATE_TOKEN',request:{messages:['SAMPLE_PRIVATE_PROMPT']}})),body=JSON.parse(result.text).error;
 assert.equal(result.status,503);assert.equal(body.type,'zcode_upstream_blocked');assert.equal(body.code,'zcode_upstream_blocked');assert.equal(body.upstreamCode,3012);assert.equal(body.upstreamStatus,upstreamStatus);assert.equal(body.upstreamRequestSent,sent);assert.equal(body.retryable,false);assert.equal(body.gatewayManagedRetry,true);assert.equal(body.gatewayRetryOwner,'gateway');assert.match(body.gatewayRequestId,/^aigw-/);assert.equal(body.actionRequired,true);assert.equal(body.retryAfterSeconds,900);assert.equal(body.retryAfterSource,'local_default');assert.equal(body.relayFailure.root.platform,'zcode');assert.equal(body.relayFailure.root.code,'zcode_upstream_blocked');assert.equal(body.relayFailure.attemptCount,sent?1:0);assert.equal(result.headers.get('x-ai-credit-retry-owner'),'gateway');assert.equal(result.headers.get('x-should-retry'),'false');assert.equal(result.headers.get('retry-after'),'900');assert.doesNotMatch(result.text,/SAMPLE_PRIVATE/);
});
test('public SSE error after first answer chunk preserves HTTP200 official evidence without promoting retry',async()=>{
 const result=await query(block({upstreamStatus:200,sent:true}),{stream:true,emitFirst:true});assert.equal(result.status,200);assert.match(result.text,/SAMPLE_PREFIX/);assert.match(result.text,/event: error/);
 const lines=result.text.split(/\r?\n/).filter(s=>s.startsWith('data: ')&&s.includes('"error"')),body=JSON.parse(lines.at(-1).slice(6)).error;
 assert.equal(body.code,'zcode_upstream_blocked');assert.equal(body.upstreamStatus,200);assert.equal(body.upstreamCode,3012);assert.equal(body.upstreamRequestSent,true);assert.equal(body.retryable,false);assert.equal(body.gatewayRetryOwner,'gateway');
});
test('contract rejects arbitrary/mistyped metadata and pins retryable false',()=>{
 const result=gatewayFailureContract(block({upstreamStatus:'SAMPLE_PRIVATE',sent:'false',upstreamCode:'3012',retryable:true,actionRequired:'true',retryAfterSeconds:'900',retryAfterSource:'SAMPLE_PRIVATE',headers:{authorization:'SAMPLE_PRIVATE'}}),context);
 assert.equal(result.retryable,false);for(const key of ['upstreamStatus','upstreamRequestSent','upstreamCode','actionRequired','retryAfterSeconds','retryAfterSource','headers'])assert.equal(Object.hasOwn(result,key),false);assert.doesNotMatch(JSON.stringify(result),/SAMPLE_PRIVATE/);
});
test('ordinary supplier error does not gain ZCode-only metadata',async()=>{
 const error=Object.assign(new AppError('SAMPLE_OTHER',503,'provider_http_error'),{upstreamCode:3012,upstreamStatus:200,upstreamRequestSent:false,actionRequired:true,headers:{authorization:'SAMPLE_PRIVATE'}});
 const result=await query(error),body=JSON.parse(result.text).error;assert.equal(body.code,'provider_http_error');for(const key of ['upstreamCode','upstreamStatus','upstreamRequestSent','actionRequired','headers'])assert.equal(Object.hasOwn(body,key),false);assert.equal(body.gatewayRetryOwner,'gateway');assert.equal(body.retryable,false);
});
test('relay metadata recognises only exact ZCode typed diagnosis, never arbitrary new code',()=>{
 const m=relayFailureMetadata({root:{platform:'zcode',code:'zcode_upstream_blocked',status:503},last:{code:'SAMPLE_PRIVATE',status:503},attemptCount:0,skippedCount:0});assert.deepEqual(m.root,{code:'zcode_upstream_blocked',status:503,platform:'zcode'});assert.deepEqual(m.last,{status:503});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Platforms} from '../src/platforms.mjs';
import {zcodeChat} from '../src/zcode-models.mjs';
import {zcodeStandardProxy} from '../src/zcode-standard-proxy.mjs';
import {collectChat,normalizeChat} from '../src/openai.mjs';
import {hash} from '../src/util.mjs';
const c={principal:'SAMPLE_PRINCIPAL',accessToken:'SAMPLE_TOKEN',identity:{deviceId:'SAMPLE_DEVICE'}};
const localKey='SAMPLE_LOCAL_KEY_012345678901234567890123456789';
const runtime={enabled:true,baseUrl:'http://127.0.0.1:27851/v1/chat/completions',localKey};
const req=model=>({model,messages:[{role:'system',content:'SAMPLE_SYSTEM'},{role:'user',content:'SAMPLE_USER'},
 {role:'assistant',content:null,tool_calls:[{id:'SAMPLE_TOOL_CALL',type:'function',function:{name:'sample_0',arguments:'{"value":"SAMPLE"}'}}]},
 {role:'tool',tool_call_id:'SAMPLE_TOOL_CALL',content:'SAMPLE_RESULT'}],
 tools:Array.from({length:331},(_,i)=>({type:'function',function:{name:'sample_'+i,parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}})),
 stream:true,tool_choice:'auto',parallel_tool_calls:false,reasoning_effort:'max',max_completion_tokens:128000});
const ledger=()=>{const values=new Map();return {get:k=>values.get(k),set:(k,v)=>values.set(k,v)};};
const sse=parts=>new Response(parts.map(x=>'data: '+(typeof x==='string'?x:JSON.stringify(x))+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
function complete(){return sse([{choices:[{index:0,delta:{role:'assistant',content:'SAMPLE_OK'},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'stop'}]},{choices:[],usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}},'[DONE]']);}
const options=fetchImpl=>({readRuntime:async()=>JSON.stringify(runtime),fetchImpl});

for(const model of ['glm-5.3','glm-5.3-flash','SAMPLE_FUTURE_ENTITLED'])test(model+' complete standard branch preserves full request and stream',async()=>{
 const input=req(model),saved=JSON.stringify(input);let hits=0;
 const result=await zcodeChat(c,input,undefined,ledger(),options(async(url,init)=>{hits++;assert.equal(url,runtime.baseUrl);assert.equal(init.body,saved);return complete();}));
 const answer=await collectChat(normalizeChat(result.response,{model}));assert.equal(answer.choices[0].message.content,'SAMPLE_OK');assert.equal(answer.usage.total_tokens,3);assert.equal(hits,1);assert.equal(JSON.stringify(input),saved);
});

test('Platforms passes only ConfigStore.dataDir private runtime, retains alias-target and all tools',async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'credit-hub-zcode-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
 const file=join(dataDir,'zcode-standard-proxy','runtime.json');await mkdir(join(dataDir,'zcode-standard-proxy'));await writeFile(file,JSON.stringify(runtime));
 const l=ledger(),p=new Platforms({dataDir,value:{upstreams:[{id:'SAMPLE_UPSTREAM',kind:'zcode',accountId:'SAMPLE_ACCOUNT'}]}},{resolve:async()=>c,ledger:l});
 const input=req('SAMPLE_PUBLIC_ALIAS'),saved=JSON.stringify(input),old=globalThis.fetch;let hits=0;
 globalThis.fetch=async(url,init)=>{hits++;assert.equal(url,runtime.baseUrl);assert.deepEqual(JSON.parse(init.body),{...input,model:'glm-5.3'});return complete();};t.after(()=>{globalThis.fetch=old;});
 const result=await p.chat({upstreamId:'SAMPLE_UPSTREAM',model:'glm-5.3'},input);assert.equal((await collectChat(normalizeChat(result.response))).choices[0].message.content,'SAMPLE_OK');assert.equal(hits,1);assert.equal(JSON.stringify(input),saved);
});

test('runtime is supplied explicitly; no runtime beside package is consulted',async()=>{
 let hits=0;assert.equal(await zcodeStandardProxy(c,req('glm-5.3'),undefined,{fetchImpl:async()=>{hits++;throw Error('SAMPLE_UNEXPECTED');}}),null);assert.equal(hits,0);
});
test('UTF8 BOM private runtime remains readable',async()=>{
 const result=await zcodeStandardProxy(c,req('glm-5.3'),undefined,{readRuntime:async()=>'\uFEFF'+JSON.stringify(runtime),fetchImpl:async()=>complete()});assert.equal(result.upstreamStatus,200);await result.response.body.cancel();
});
for(const raw of ['null','[]','"SAMPLE"',JSON.stringify({...runtime,baseUrl:'SAMPLE_INVALID_URL'})])test('invalid runtime shape '+raw+' is typed without leaking configuration',async()=>{
 await assert.rejects(zcodeStandardProxy(c,req('glm-5.3'),undefined,{readRuntime:async()=>raw,fetchImpl:async()=>{throw Error('SAMPLE_UNEXPECTED');}}),e=>e.code==='zcode_proxy_config'&&e.status===503&&!e.message.includes('SAMPLE'));
});

for(const http of [200,405])test('standard response3012 HTTP'+http+' persists one official block, then zero dispatch',async()=>{
 const l=ledger();let hits=0;
 const config=options(async()=>{hits++;return new Response('SAMPLE_PRIVATE',{status:502,headers:{'x-gateway-upstream-status':String(http),'x-gateway-upstream-code':'3012'}});});
 await assert.rejects(zcodeChat(c,req('glm-5.3'),undefined,l,config),e=>e.code==='zcode_upstream_blocked'&&e.upstreamStatus===http&&e.upstreamRequestSent===true&&e.retryable===false&&!e.message.includes('SAMPLE_PRIVATE'));
 const key='proxy-block/zcode/'+hash(c.principal),until=l.get(key).until;
 await assert.rejects(zcodeChat(c,req('glm-5.3-flash'),undefined,l,config),e=>e.code==='zcode_upstream_blocked'&&e.upstreamStatus===http&&e.upstreamRequestSent===false);assert.equal(hits,1);assert.equal(l.get(key).until,until);
});
test('standard stream3012 after HTTP200 changes block without replaying model request',async()=>{
 const l=ledger();let hits=0;const config=options(async()=>{hits++;return sse([{choices:[{delta:{role:'assistant'}}]},{error:{upstreamCode:3012,upstreamStatus:200,message:'SAMPLE_PRIVATE'}}]);});
 const result=await zcodeChat(c,req('glm-5.3'),undefined,l,config);await assert.rejects(collectChat(normalizeChat(result.response)),e=>e.code==='zcode_upstream_blocked'&&e.upstreamStatus===200&&e.upstreamRequestSent===true&&!e.message.includes('SAMPLE_PRIVATE'));
 await assert.rejects(zcodeChat(c,req('glm-5.3'),undefined,l,config),e=>e.upstreamRequestSent===false);assert.equal(hits,1);
});
test('failed readiness or invalid runtime never falls through to direct official transport',async()=>{
 let hits=0;await assert.rejects(zcodeChat(c,req('glm-5.3'),undefined,ledger(),{readRuntime:async()=>'{SAMPLE_INVALID',fetchImpl:async()=>{hits++;throw Error('SAMPLE_UNEXPECTED');}}),e=>e.code==='zcode_proxy_config');assert.equal(hits,0);
});

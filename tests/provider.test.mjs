import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreditHubAdapter,providerId} from '../plugin/provider.mjs';
import {resolveRetryPolicy} from '@deepseek-ai/dsh-llm';
import {Context} from '@deepseek-ai/cordis';
import {remoteMethods} from '@deepseek-ai/dsh-typert-protocol';
import {CreditHubRemote} from '../plugin/index.mjs';
const model={id:'route-SAMPLE',name:'SAMPLE 模型',contextWindow:1000000,maxTokens:64000,capabilities:{multimodal:true,tools:true},modelRelay:{deliveryMode:'verified_request_buffer',requestTimeoutMs:180000}};
function fixture(){let count=0;const hub={runtime:{baseUrl:'http://127.0.0.1:1',key:'SAMPLE_PRIVATE_KEY'},async request(input){count++;assert.deepEqual(input,{method:'GET',path:'/admin/models'});return {status:200,body:{data:[model]}}}};return {hub,count:()=>count}}
test('native provider construction is local-only and does not replace the official retry defaults',()=>{
 const f=fixture(),native=createCreditHubAdapter({hub:f.hub});assert.equal(f.count(),0);assert.equal(providerId,'credit-hub');
 const profile=native.adapter.config.profiles().get(providerId);assert.equal(profile.displayName,'积分中枢');assert.equal(profile.retryPolicy.maxRetries,1);assert.equal(resolveRetryPolicy().maxRetries,5);assert.equal(native.models().length,0);
});
test('explicit model discovery is single-flight and preserves real metadata and attribution headers',async()=>{
 const f=fixture(),native=createCreditHubAdapter({hub:f.hub});const [a,b]=await Promise.all([native.refresh({force:true}),native.refresh({force:true})]);assert.equal(f.count(),1);assert.deepEqual(a,b);
 const listed=await native.adapter.listModels(providerId);assert.equal(f.count(),1);assert.equal(listed[0].id,model.id);
 const actual=await native.adapter.resolveModel(providerId,model.id);assert.equal(actual.context.contextWindow,1000000);
 const raw=native.adapter.config.profiles().get(providerId).piProvider.getModels()[0];assert.equal(raw.provider,providerId);assert.equal(raw.headers['X-AI-Credit-Source'],'dsh');assert.ok(Object.keys(raw.headers).length>1);assert.equal(raw.maxTokens,64000);
});
test('capability refresh retains large contexts without fabricating an output default',async()=>{
 const f=fixture(),native=createCreditHubAdapter({hub:f.hub,models:[model]});assert.equal((await native.adapter.resolveModel(providerId,model.id)).defaultMaxTokens,undefined);
 assert.equal(native.adapter.config.profiles().get(providerId).streamIdleTimeoutMs,190000);
 native.update([{...model,contextWindow:2000000,modelRelay:undefined}]);assert.equal((await native.adapter.resolveModel(providerId,model.id)).context.contextWindow,2000000);assert.equal(native.adapter.config.profiles().get(providerId).retryPolicy.maxRetries,1);
});
test('official Typert source descriptors expose exactly the native snapshot and named-input request methods',async()=>{
 const ctx=new Context();const expected={counts:{accounts:1}};let seen;
 const remote=new CreditHubRemote(ctx,Promise.resolve({async snapshot(){return expected},async request(input){seen=input;return {status:200,body:{ok:true}}}}));
 assert.deepEqual(remoteMethods(remote).map(m=>m.method),['snapshot','request']);assert.deepEqual(await remote.snapshot(),expected);
 const input={method:'GET',path:'/hub/snapshot'};await remote.request(input);assert.equal(seen,input);
});

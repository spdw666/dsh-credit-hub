import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreditHubAdapter,providerId} from '../plugin/provider.mjs';

const models=['glm-5.3','glm-5.3-flash'].map(model=>({id:'zcode-native/'+model,name:'ZCode / '+model,contextWindow:1000000,maxTokens:128000,defaultMaxTokens:128000,capabilities:{tools:true,multimodal:false},reasoningEfforts:{low:'low',high:'high',max:'max'}}));
function native(runtime={}){return createCreditHubAdapter({hub:{runtime:{baseUrl:'http://127.0.0.1:1',key:'SAMPLE_PRIVATE_KEY',...runtime},async request(){return {status:200,body:{data:models}}}},models});}

test('both ZCode model profiles preserve declared 1M context, 128000 request default, and exact low/high/max levels',async()=>{
 const n=native();
 for(const m of models){
  const actual=await n.adapter.resolveModel(providerId,m.id);
  assert.equal(actual.context.contextWindow,1000000);
  assert.equal(actual.defaultMaxTokens,128000);
  assert.deepEqual(actual.reasoning.efforts.map(x=>x.id),['low','high','max']);
  const raw=n.adapter.config.profiles().get(providerId).piProvider.getModels().find(x=>x.id===m.id);
  assert.equal(raw.maxTokens,128000);assert.deepEqual(raw.input,['text']);
  assert.equal(raw.thinkingLevelMap.low,'low');assert.equal(raw.thinkingLevelMap.high,'high');assert.equal(raw.thinkingLevelMap.max,'max');assert.equal(raw.thinkingLevelMap.medium,null);
 }
 n.dispose();
});

test('deployment output default stays authoritative and catalog defaults never fabricate generic limits',async()=>{
 const n=native({maxOutputTokens:64000});
 assert.equal((await n.adapter.resolveModel(providerId,models[0].id)).defaultMaxTokens,64000);
 n.dispose();
 const other=native();other.update([{...models[0],defaultMaxTokens:undefined},{...models[1],defaultMaxTokens:200000}]);
 assert.equal((await other.adapter.resolveModel(providerId,models[0].id)).defaultMaxTokens,undefined);
 assert.equal((await other.adapter.resolveModel(providerId,models[1].id)).defaultMaxTokens,128000);
 other.dispose();
});

test('catalog refresh republishes exact ZCode request defaults in the prepared native call',async()=>{
 const n=native();
 await n.refresh({force:true});
 const call=await n.adapter.prepareCall(providerId,models[1].id);
 assert.equal(call.model.defaultMaxTokens,128000);
 assert.deepEqual(call.model.reasoning.efforts.map(x=>x.id),['low','high','max']);
 n.dispose();
});

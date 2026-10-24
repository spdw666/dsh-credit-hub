import test from 'node:test';
import assert from 'node:assert/strict';
import {zcodeModels} from '../engine/src/zcode-models.mjs';
import {Router} from '../engine/src/router.mjs';
import {startServer} from '../engine/src/server.mjs';
import {createHandleMaps,translateIds,boundedPublic} from '../server/contracts.mjs';
import {createCreditHubAdapter,providerId} from '../plugin/provider.mjs';
test('official model metadata documentation keeps its commit hash while private/lookalike strings retain masking',()=>{
 const pinned='https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/config/provider/zcode-builtin.json';
 const publicRow=boundedPublic({reasoningSource:pinned,metadataSources:[pinned,'https://docs.z.ai/guides/llm/glm-5.3'],label:pinned,phone:'13812345678',credentials:{token:'SAMPLE_PRIVATE'}});
 assert.equal(publicRow.reasoningSource,pinned);assert.equal(publicRow.metadataSources[0],pinned);assert.notEqual(publicRow.label,pinned);assert.notEqual(publicRow.phone,'13812345678');assert.equal(publicRow.credentials,undefined);
 for(const reasoningSource of [pinned+'?phone=13812345678',pinned.replace('github.com','github.com.invalid'),pinned.replace('https://','https://user:pass@'),pinned.replace('/zai-org/','/SAMPLE/'),'https://github.com/SAMPLE/13812345678'])assert.notEqual(boundedPublic({reasoningSource}).reasoningSource,reasoningSource);
});

test('real engine HTTP directory → hub opaque handles → native provider preserves declared128K/1M/reasoning',async()=>{
 const ids=['glm-5.3','glm-5.3-flash','SAMPLE_FUTURE_ENTITLED'],models=await zcodeModels({},{now:1000,fetchBalance:async()=>({balances:[{available_units:1,expires_at:2,capabilities:ids.map(id=>'model:'+id)}]})});
 const config={value:{accounts:[{id:'SAMPLE_PRIVATE_ACCOUNT',platform:'zcode'}],upstreams:[{id:'SAMPLE_PRIVATE_UPSTREAM',kind:'zcode',accountId:'SAMPLE_PRIVATE_ACCOUNT'}],routes:models.map(m=>({id:'SAMPLE_PRIVATE_ROUTE/'+m.id,name:m.id,targets:[{upstreamId:'SAMPLE_PRIVATE_UPSTREAM',model:m.id}]})),modelRelay:{enabled:false},server:{host:'127.0.0.1',port:0}}};
 const maps=createHandleMaps(config.value),router=new Router(config,{models:async()=>models}),server=await startServer({config,router,keys:{apiKey:'SAMPLE_API_KEY',adminKey:'SAMPLE_ADMIN_KEY'}},{port:0});let native,hits=0;
 try{
  const hub={runtime:{baseUrl:server.baseUrl,key:'SAMPLE_API_KEY',generation:1},async request(input){hits++;assert.deepEqual(input,{method:'GET',path:'/admin/models'});const response=await fetch(server.baseUrl+input.path,{headers:{authorization:'Bearer SAMPLE_ADMIN_KEY'}});return {status:response.status,body:boundedPublic(translateIds(await response.json(),maps))};}};
  native=createCreditHubAdapter({hub});await native.refresh({force:true});assert.equal(hits,1);
  for(let i=0;i<2;i++){
   const opaque=maps.routes.get(config.value.routes[i].id);assert.match(opaque,/^route-[a-f0-9]{12}$/);
   const hubModel=native.models().find(x=>x.id===opaque);assert.equal(hubModel.defaultMaxTokens,128000);assert.equal(hubModel.defaultMaxTokensSource,models[i].defaultMaxTokensSource);assert.equal(hubModel.officialMaxTokens,128000);assert.deepEqual(hubModel.metadataSources,models[i].metadataSources);assert.equal(hubModel.reasoningSource,models[i].reasoningSource);
   const resolved=await native.adapter.resolveModel(providerId,opaque);assert.equal(resolved.defaultMaxTokens,128000);assert.equal(resolved.context.contextWindow,1000000);assert.deepEqual(resolved.reasoning.efforts.map(x=>x.id),['low','high','max']);
   const raw=native.adapter.config.profiles().get(providerId).piProvider.getModels().find(x=>x.id===opaque);assert.equal(raw.maxTokens,128000);assert.equal(raw.contextWindow,1000000);assert.deepEqual(raw.input,i===0?['text']:['text','image']);
   const prepared=await native.adapter.prepareCall(providerId,opaque);assert.equal(prepared.model.defaultMaxTokens,128000);assert.equal(prepared.model.context.contextWindow,1000000);
  }
  const unknown=maps.routes.get(config.value.routes[2].id),resolved=await native.adapter.resolveModel(providerId,unknown);assert.equal(resolved.defaultMaxTokens,undefined);assert.equal(resolved.context.contextWindow,32768);assert.equal(native.adapter.config.profiles().get(providerId).configuredMaxTokens.has(unknown),false);assert.doesNotMatch(JSON.stringify(native.models()),/SAMPLE_PRIVATE_ACCOUNT|SAMPLE_PRIVATE_ROUTE/);
 }finally{native?.dispose();await server.close();}
});

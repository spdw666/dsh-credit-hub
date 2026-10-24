import test from 'node:test';
import assert from 'node:assert/strict';
import {zcodeModels} from '../src/zcode-models.mjs';
import {Router} from '../src/router.mjs';
import {startServer} from '../src/server.mjs';
async function directory(rows){
 const config={value:{accounts:[{id:'SAMPLE_ACCOUNT',platform:'zcode'}],upstreams:[{id:'SAMPLE_UPSTREAM',kind:'zcode',accountId:'SAMPLE_ACCOUNT'}],routes:rows.map((m,i)=>({id:'SAMPLE_ROUTE_'+i,targets:[{upstreamId:'SAMPLE_UPSTREAM',model:m.id}]})),modelRelay:{enabled:false},server:{host:'127.0.0.1',port:0}}};
 const router=new Router(config,{models:async()=>rows}),server=await startServer({config,router,keys:{apiKey:'SAMPLE_API',adminKey:'SAMPLE_ADMIN'}},{port:0});
 try{const response=await fetch(server.baseUrl+'/admin/models',{headers:{authorization:'Bearer SAMPLE_ADMIN'}});assert.equal(response.status,200);return (await response.json()).data;}finally{await server.close();}
}
const catalog=ids=>zcodeModels({},{now:1000,fetchBalance:async()=>({balances:[{available_units:1,expires_at:2,capabilities:ids.map(id=>'model:'+id)}]})});
test('actual /admin/models retains exact ZCode declared request defaults, capacities, sources and reasoning',async()=>{
 const raw=await catalog(['glm-5.3','glm-5.3-flash']),rows=await directory(raw);assert.equal(rows.length,2);
 for(let i=0;i<rows.length;i++){const row=rows[i],m=raw[i];assert.equal(row.contextWindow,1000000);assert.equal(row.maxTokens,128000);assert.equal(row.defaultMaxTokens,128000);assert.equal(row.officialMaxTokens,128000);for(const key of ['defaultMaxTokensSource','contextWindowSource','maxTokensSource','reasoningSource'])assert.equal(row[key],m[key]);assert.deepEqual(row.metadataSources,m.metadataSources);assert.deepEqual(row.reasoning,m.reasoning);assert.deepEqual(row.reasoningEfforts,{low:'low',high:'high',max:'max'});assert.equal(row.capabilities.multimodal,i===1);}
});
test('unknown exact entitled model obtains neither the known-model default nor invented provenance',async()=>{
 const [row]=await directory(await catalog(['SAMPLE_FUTURE_MODEL']));assert.equal(row.contextWindow,32768);assert.equal(row.maxTokens,4096);for(const key of ['defaultMaxTokens','defaultMaxTokensSource','officialMaxTokens','contextWindowSource','maxTokensSource','metadataSources','reasoningSource'])assert.equal(Object.hasOwn(row,key),false,key);
});
test('only an explicit positive safe integer default is transmitted; no ceiling-to-default inference',async()=>{
 const values=[undefined,0,-1,NaN,Infinity,1.5,'128000',Number.MAX_SAFE_INTEGER+1];
 const rows=await directory(values.map((value,i)=>({id:'SAMPLE_'+i,tools:true,maxTokens:128000,defaultMaxTokens:value,defaultMaxTokensSource:'official_docs_snapshot_2026-10-24'})));
 for(const row of rows){assert.equal(Object.hasOwn(row,'defaultMaxTokens'),false);assert.equal(Object.hasOwn(row,'defaultMaxTokensSource'),false);assert.equal(row.maxTokens,128000);}
});
test('declared default is bounded by verified ceiling while independent capacity provenance is retained',async()=>{
 const [row]=await directory([{id:'SAMPLE',tools:true,maxTokens:128000,officialMaxTokens:128000,defaultMaxTokens:200000,defaultMaxTokensSource:'official_docs_snapshot_2026-10-24',contextWindowSource:'SAMPLE\nPRIVATE',maxTokensSource:'https://invalid.example/?token=SAMPLE_PRIVATE',metadataSources:['https://docs.z.ai/guides/llm/glm-5.3','file:///SAMPLE_PRIVATE','https://user:pass@example.test/SAMPLE_PRIVATE'],reasoningSource:'https://example.test/?token=SAMPLE_PRIVATE'}]);
 assert.equal(row.defaultMaxTokens,128000);assert.equal(row.officialMaxTokens,128000);assert.equal(row.defaultMaxTokensSource,'official_docs_snapshot_2026-10-24');assert.equal(row.contextWindowSource,undefined);assert.equal(row.maxTokensSource,undefined);assert.deepEqual(row.metadataSources,['https://docs.z.ai/guides/llm/glm-5.3']);assert.equal(row.reasoningSource,undefined);assert.doesNotMatch(JSON.stringify(row),/SAMPLE_PRIVATE/);
});

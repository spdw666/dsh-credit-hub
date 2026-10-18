import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {detectHostCapabilities,registerNativeProviderCompatibility,buildDshCompatibilityRange} from '../plugin/compatibility.mjs';

const adapter={async*stream(request){yield request},async listModels(){return []}};
function fixture({directory=true,discovery=true}={}){
  const calls=[],released=[];
  const llm={registerAdapter(providers,value){calls.push(['adapter',providers,value]);return ()=>released.push('adapter')}};
  if(directory)llm.registerConfigurableProviders=providers=>{calls.push(['directory',providers]);return {dispose(){released.push('directory')}}};
  if(discovery)llm.registerModelDiscovery=(ns,callback)=>{calls.push(['discovery',ns,callback]);return ()=>released.push('discovery')};
  return {ctx:{llm,effect(){},get(){},logger:{warn(){}}},calls,released};
}
const settings={providerId:'credit-hub',adapter,settingsNs:'dsh-credit-hub',discoverModels:async()=>[]};

test('modern host registers unchanged adapter, settings and lazy discovery; disposes once in reverse order',()=>{
  const f=fixture(),handle=registerNativeProviderCompatibility(f.ctx,settings);
  assert.deepEqual(handle.status.registered,{adapter:true,configurableProviders:true,modelDiscovery:true});
  assert.equal(f.calls[0][2],adapter);
  assert.equal(f.calls[2][2],settings.discoverModels);
  handle.dispose();handle.dispose();assert.deepEqual(f.released,['discovery','directory','adapter']);
});
test('host without optional provider directory and discovery still owns its native route',()=>{
  const f=fixture({directory:false,discovery:false});
  const handle=registerNativeProviderCompatibility(f.ctx,settings);
  assert.equal(handle.status.mode,'native-provider');
  assert.equal(f.calls.length,1);
  assert.deepEqual(handle.status.diagnostics.map(i=>i.code),['HOST_PROVIDER_DIRECTORY_UNAVAILABLE','HOST_MODEL_DISCOVERY_UNAVAILABLE']);
});
test('missing LLM seam preserves management-only operation and visible typed diagnostics',()=>{
  const handle=registerNativeProviderCompatibility({},settings);
  assert.equal(handle.status.mode,'management-only');
  assert.equal(handle.status.registered.adapter,false);
  assert.equal(handle.status.diagnostics[0].code,'HOST_LLM_REGISTRATION_MISSING');
  handle.dispose();assert.equal(handle.status.disposed,true);
});
test('throwing optional registration does not cancel working provider; errors never echo SDK/account data',()=>{
  const f=fixture();
  f.ctx.llm.registerConfigurableProviders=()=>{throw new Error('SAMPLE_PRIVATE_TOKEN')};
  const handle=registerNativeProviderCompatibility(f.ctx,settings);
  assert.deepEqual(handle.status.registered,{adapter:true,configurableProviders:false,modelDiscovery:true});
  assert.equal(handle.status.diagnostics[0].code,'HOST_PROVIDER_DIRECTORY_REGISTRATION_FAILED');
  assert.ok(!JSON.stringify(handle.status).includes('SAMPLE_PRIVATE_TOKEN'));
});
test('adapter registration failure prevents orphan directory/discovery registrations',()=>{
  const f=fixture();f.ctx.llm.registerAdapter=()=>{throw Error('SAMPLE')};
  const handle=registerNativeProviderCompatibility(f.ctx,settings);
  assert.equal(handle.status.mode,'management-only');assert.equal(f.calls.length,0);
  assert.equal(handle.status.diagnostics.at(-1).code,'HOST_ADAPTER_REGISTRATION_FAILED');
});
test('legacy stream and modern snapshot stream are separate detected SDK capabilities',()=>{
  assert.equal(detectHostCapabilities({llm:{registerAdapter(){}}},{adapter}).capabilities.snapshotStream,false);
  const modern={...adapter,streamWithSnapshot(){},prepareCall(){}};
  const r=detectHostCapabilities({llm:{registerAdapter(){}}},{adapter:modern});
  assert.equal(r.capabilities.snapshotStream,true);assert.equal(r.capabilities.preparedCalls,true);
});
test('registration layer preserves complete request identity including messages, tools, output budget and signal',async()=>{
  const f=fixture(),handle=registerNativeProviderCompatibility(f.ctx,settings);
  const request={provider:'credit-hub',model:'route-SAMPLE',messages:[{role:'assistant',toolCalls:[{id:'SAMPLE-tool',name:'read',arguments:{path:'SAMPLE'}}]},{role:'tool',toolCallId:'SAMPLE-tool',content:'SAMPLE result'}],tools:[{name:'read',parameters:{type:'object'}}],maxTokens:64000,signal:new AbortController().signal};
  const [seen]=await Array.fromAsync(f.calls[0][2].stream(request));assert.equal(seen,request);
  assert.equal(seen.tools,request.tools);assert.equal(seen.messages,request.messages);handle.dispose();
});
test('audited release range includes every available official tag rather than dropping prereleases',async()=>{
  const tags=JSON.parse(await readFile(new URL('../test-fixtures/dsh-tags.json',import.meta.url),'utf8'));
  const range=buildDshCompatibilityRange(tags.map(t=>t.name));
  assert.equal(tags.length,32);assert.equal(range.split(' || ').length,32);
  assert.ok(range.includes('0.1.0-rc.7'));assert.ok(range.includes('0.2.1-alpha.1'));
  assert.ok(!range.includes('*'));assert.throws(()=>buildDshCompatibilityRange(['SAMPLE-invalid']),/Invalid/);
});
test('official source matrix preserves all stable RPC and settings seams and reports legacy layout honestly',async()=>{
  const matrix=JSON.parse(await readFile(new URL('../test-fixtures/compatibility-matrix.json',import.meta.url),'utf8'));
  for(const row of matrix.releases){
    for(const key of ['rpcFourArguments','rpcResultEnvelope','rpcNamedArgs','rpcOkValue','slotInject','settingsSection','clientConnection'])assert.equal(row.features[key],true,`${row.tag} ${key}`);
    assert.deepEqual(Object.values(row.sdk.clientPackages),matrix.manifestRecommendations.clientInject);
    assert.equal(row.verification.fullHistoricalHostRuntime,false);
  }
  assert.equal(matrix.releases.filter(r=>r.features.keyedMain).length,19);
  assert.equal(matrix.releases.filter(r=>!r.features.keyedMain).length,13);
});

import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,dirname,join,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {buildDshCompatibilityRange,registerNativeProviderCompatibility} from '../plugin/compatibility.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const research=join(root,'research/enhance');
const fixtures=join(research,'compatibility-fixtures');
const matrixPath=join(research,'compatibility-matrix.json');
const tags=JSON.parse(await readFile(join(root,'research/dsh/tags-20261018.json'),'utf8'));
const paths={llm:'packages/llm/llm/src/index.ts',adapter:'packages/llm/llm-pi-ai/src/adapter.ts',typert:'packages/typert/protocol/src/index.ts',llmPackage:'packages/llm/llm/package.json',adapterPackage:'packages/llm/llm-pi-ai/package.json',typertPackage:'packages/typert/protocol/package.json',cordis:'vendor/cordis/package.json',schemastery:'vendor/schemastery/package.json',rootPackage:'package.json',connection:'packages/client/connection/src/index.ts',slots:'packages/client/ui-slots/src/index.ts',sidebar:'packages/client/ui-sidebar/src/client/index.ts',settings:'packages/client/ui-settings/src/client/index.ts',layout:'packages/client/ui-layout/src/client/index.ts',clientRpc:'packages/client/connection/src/client/rpc.ts',clientWebApi:'packages/client/connection/src/client/web-api-client.ts'};
Object.assign(paths,{slotsRuntime:'packages/client/runtime/src/client/slots.ts',settingsContract:'packages/client/ui-settings/src/client/contract/slots.ts',layoutService:'packages/client/ui-layout/src/client/service.ts',gateway:'packages/api/gateway/src/index.ts'});
Object.assign(paths,{connectionPackage:'packages/client/connection/package.json',layoutPackage:'packages/client/ui-layout/package.json',sidebarPackage:'packages/client/ui-sidebar/package.json',settingsGeneralPackage:'packages/client/ui-settings-general/package.json',clientConnection:'packages/client/connection/src/client/index.ts'});
const sha256=value=>createHash('sha256').update(value).digest('hex');
let active=0;const queue=[];
async function limited(work){if(active>=12)await new Promise(r=>queue.push(r));active++;try{return await work()}finally{active--;queue.shift()?.()}}
async function download(url){return limited(async()=>{let cause;for(let i=0;i<3;i++){try{const response=await fetch(url);if(!response.ok)throw Error(`HTTP ${response.status}: ${url}`);return await response.text()}catch(e){cause=e;if(String(e.message).startsWith('HTTP 404'))throw e;await new Promise(r=>setTimeout(r,200*(i+1)))}}throw cause})}
async function historicalSource(tag,path){
  const file=join(fixtures,tag.name,path);
  try{return await readFile(file,'utf8')}catch{}
  const text=await download(`https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/${tag.sha}/${path}`);
  await mkdir(dirname(file),{recursive:true});await writeFile(file,text);return text;
}
async function collect(){
  const rows=await Promise.all(tags.map(async tag=>{
    const resolvedPaths={...paths};
    const sources=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([key,path])=>{
      try{return [key,await historicalSource(tag,path)]}catch(e){
        if(!['clientWebApi','slotsRuntime'].includes(key)||!String(e.message).startsWith('HTTP 404'))throw e;
        resolvedPaths[key]=key==='clientWebApi'?'packages/client/connection/src/client/api.ts':'packages/client/ui-renderer/src/client/registry.ts';
        return [key,await historicalSource(tag,resolvedPaths[key])];
      }
    })));
    const pkg=key=>JSON.parse(sources[key]);
    const clientFeatures={rpcFourArguments:/async call\(channel, endpoint, payload, signal\)/.test(sources.clientRpc),rpcResultEnvelope:/return full\.result/.test(sources.clientRpc),rpcNamedArgs:/Object\.hasOwn\(payload, 'args'\)/.test(sources.gateway),rpcOkValue:/return \{ ok: true, value(?:\s*\}|:)/.test(sources.gateway),slotInject:/\binject\(key:/.test(sources.slotsRuntime),settingsSection:/['"]settings\.section['"]:\s*\{ kind: 'list'/.test(sources.settingsContract),keyedMain:/['"]main['"]:\s*\{ kind: 'keyed'/.test(sources.layout),sidebarPanelList:/['"]sidebar\.panellist['"]:\s*\{ kind: 'list'/.test(sources.sidebar),selectPanel:/\bselectPanel\s*\(/.test(sources.layoutService),clientConnection:/ctx\.provide\('connection', handle\)/.test(sources.clientConnection)};
    return {tag:tag.name,version:tag.name.replace(/^dsh-v/,''),sha:tag.sha,sourceEvidence:Object.fromEntries(Object.entries(resolvedPaths).map(([key,path])=>[key,{path,sha256:sha256(sources[key]),url:`https://github.com/deepseek-ai/deepseek-harness/blob/${tag.sha}/${path}`}])),sdk:{llm:pkg('llmPackage').version,adapter:pkg('adapterPackage').version,typert:pkg('typertPackage').version,piAi:pkg('adapterPackage').dependencies?.['@earendil-works/pi-ai'],cordis:pkg('cordis').version,schemastery:pkg('schemastery').version,hostNode:pkg('rootPackage').engines?.node??null},features:{registerAdapter:/\bregisterAdapter\s*\(/.test(sources.llm),registerConfigurableProviders:/\bregisterConfigurableProviders\s*\(/.test(sources.llm),registerModelDiscovery:/\bregisterModelDiscovery\s*\(/.test(sources.llm),stream:/\bstream\s*\(/.test(sources.adapter),streamWithSnapshot:/\bstreamWithSnapshot\s*\(/.test(sources.adapter),prepareCall:/\bprepareCall\s*\(/.test(sources.adapter),typertRemote:/export function Remote\b/.test(sources.typert),typertService:/export (?:abstract )?class TypertRemoteService\b/.test(sources.typert),...clientFeatures},verification:{sourceAudit:true,registrationFixture:false,officialModuleFixture:false,fullHistoricalHostRuntime:false}};
  }));
  for(const row of rows){row.sdk.clientPackages={};for(const key of ['connectionPackage','layoutPackage','sidebarPackage','settingsGeneralPackage'])row.sdk.clientPackages[key]=JSON.parse(await historicalSource(tags.find(t=>t.name===row.tag),paths[key])).name;}
  const unique=key=>[...new Set(rows.map(r=>r.sdk[key]))];
  const matrix={schemaVersion:1,collectedAt:new Date().toISOString(),scope:'All 32 official release tags present in the saved 2026-10-18 GitHub tag inventory; source and module contract checks, not 32 installed desktop runtimes.',firstTag:tags.at(-1).name,lastTag:tags[0].name,exactDshRange:buildDshCompatibilityRange(tags.map(t=>t.name)),workerNodeMinimum:'22.23.3',manifestRecommendations:{hostNode:unique('hostNode')[0],dshSdk:buildDshCompatibilityRange(tags.map(t=>t.name)),cordis:unique('cordis').join(' || '),schemastery:unique('schemastery').join(' || '),piAi:unique('piAi').join(' || '),clientInject:Object.values(rows[0].sdk.clientPackages)},releases:rows};
  await writeFile(matrixPath,JSON.stringify(matrix,null,2)+'\n');
  console.log(`COMPATIBILITY_SOURCE_AUDIT_PASS tags=${rows.length} source_files=${rows.length*Object.keys(paths).length}`);
  return matrix;
}

const packageRequire=createRequire(import.meta.resolve('@deepseek-ai/dsh-llm-pi-ai'));
const piRequire=createRequire(import.meta.resolve('@earendil-works/pi-ai'));
function externalPackage(specifier){
  try{return import.meta.resolve(specifier)}catch{}
  try{return pathToFileURL(packageRequire.resolve(specifier)).href}catch{return pathToFileURL(piRequire.resolve(specifier)).href}
}
async function compileHistorical(tag,path,overrides={}){
  const {build}=await import('esbuild');
  const out=join(fixtures,tag.name,'compiled',path.includes('llm-pi-ai')?'adapter.mjs':path.includes('typert')?'typert.mjs':'llm.mjs');
  await mkdir(dirname(out),{recursive:true});
  await build({entryPoints:[path],bundle:true,platform:'node',format:'esm',target:'node22',outfile:out,logLevel:'silent',plugins:[{name:'official-historical-source',setup(build){
    build.onResolve({filter:/.*/},async args=>{
      if(args.path.startsWith('node:'))return {path:args.path,external:true};
      if(args.path.startsWith('@earendil-works/pi-ai/')&&overrides.piVersion)return {path:pathToFileURL(await compilePiPart(overrides.piVersion,args.path.slice('@earendil-works/pi-ai/'.length))).href,external:true};
      if(args.path.startsWith('@'))return {path:overrides[args.path]?pathToFileURL(overrides[args.path]).href:externalPackage(args.path),external:true};
      const path=args.kind==='entry-point'?args.path:join(dirname(args.importer),args.path).replaceAll('\\','/');
      if(path.startsWith('../')||path.startsWith('/'))throw Error('Historical source path escaped repository');
      return {path,namespace:'official'};
    });
    build.onLoad({filter:/.*/,namespace:'official'},async args=>({contents:await historicalSource(tag,args.path),loader:'ts'}));
  }}]});
  return {module:await import(pathToFileURL(out).href),file:out};
}
async function ensurePi(version){
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid fixture pi-ai version');
  const dir=join(fixtures,`pi-ai-${version}`),entry=join(dir,'package/dist/index.js');
  try{await access(entry);return dir}catch{}
  const metadata=JSON.parse(await download(`https://registry.npmjs.org/@earendil-works%2Fpi-ai/${version}`));
  const response=await fetch(metadata.dist.tarball);assert.equal(response.ok,true);
  const bytes=Buffer.from(await response.arrayBuffer());
  const [algorithm,expected]=metadata.dist.integrity.split('-');
  assert.equal(createHash(algorithm).update(bytes).digest('base64'),expected);
  await mkdir(dir,{recursive:true});const archive=join(dir,'package.tgz');await writeFile(archive,bytes);
  const members=execFileSync('tar',['-tf',archive],{encoding:'utf8'}).trim().split(/\r?\n/);
  assert.ok(members.every(p=>p.startsWith('package/')&&!p.split('/').includes('..')));
  execFileSync('tar',['-xf',archive,'-C',dir]);
  await writeFile(join(dir,'INTEGRITY.json'),JSON.stringify({name:metadata.name,version,tarball:metadata.dist.tarball,integrity:metadata.dist.integrity,sha256:sha256(bytes)},null,2)+'\n');
  return dir;
}
const piCompiled=new Map();
async function compilePiPart(version,part='index'){
  const key=version+':'+part;
  if(piCompiled.has(key))return piCompiled.get(key);
  const pending=(async()=>{
  const dir=await ensurePi(version);
  const {build}=await import('esbuild');
  assert.ok(!part.includes('..'));
  const entry=join(dir,'package/dist',part+'.js');
  await access(entry);
  const outfile=join(dir,'compiled',part.replaceAll('/','-'),'index.mjs');
  await build({entryPoints:[entry],outdir:dirname(outfile),entryNames:'index',outExtension:{'.js':'.mjs'},splitting:true,bundle:true,platform:'node',format:'esm',target:'node22',logLevel:'silent',plugins:[{name:'shared-dependencies',setup(build){build.onResolve({filter:/^[^./]/},args=>{
    if(args.kind==='entry-point')return;
    if(args.path.startsWith('node:'))return {path:args.path,external:true};
    try{return {path:pathToFileURL(piRequire.resolve(args.path)).href,external:true}}catch{return {path:args.path,external:true}}
  })}}]});
  return outfile;
  })();piCompiled.set(key,pending);return pending;
}
async function compilePi(version){
  const outfile=await compilePiPart(version);
  const pi=await import(pathToFileURL(outfile).href);
  assert.equal(typeof pi.createProvider,'function');assert.equal(typeof pi.createModels,'function');
  const {openAICompletionsApi}=await import(pathToFileURL(await compilePiPart(version,'api/openai-completions.lazy')).href);
  assert.equal(typeof openAICompletionsApi().streamSimple,'function');
  return {pi,outfile};
}
async function moduleFixtures(matrix){
  const {Context}=await import('@deepseek-ai/cordis');
  const picked=process.argv.includes('--all-module-fixtures')?[...tags].reverse():[tags.at(-1),tags[0]];
  for(const tag of picked){
    const entry=matrix.releases.find(r=>r.tag===tag.name);
    const piVersion=entry.sdk.piAi.replace(/^\^/,'');
    const {pi,outfile}=await compilePi(piVersion);
    const protocol=await compileHistorical(tag,paths.typert);
    const typert=protocol.module;
    const llm=await compileHistorical(tag,paths.llm,{'@deepseek-ai/dsh-typert-protocol':protocol.file});
    const {PiAiAdapter}=(await compileHistorical(tag,paths.adapter,{'@earendil-works/pi-ai':outfile,'@deepseek-ai/dsh-llm':llm.file,'@deepseek-ai/dsh-typert-protocol':protocol.file,piVersion})).module;
    const ctx=new Context(),initializers=[];
    class RemoteFixture extends typert.TypertRemoteService{
      constructor(ctx){super(ctx,'creditHubCompatibilityFixture');for(const fn of initializers)fn.call(this)}
      async request(input){return input}
    }
    typert.Remote(RemoteFixture.prototype.request,{kind:'method',name:'request',private:false,static:false,addInitializer(fn){initializers.push(fn)}});
    const remote=new RemoteFixture(ctx);
    assert.deepEqual(typert.remoteMethods(remote).map(m=>m.method),['request']);
    const namedInput={method:'GET',path:'/hub/snapshot'};assert.equal(await remote.request(namedInput),namedInput);
    const model={id:'route-SAMPLE',provider:'credit-hub',api:'openai-completions',name:'SAMPLE',baseUrl:'http://127.0.0.1:1',input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:1000000,maxTokens:64000};
    let wire;
    const usage={input:12,output:3,cacheRead:0,cacheWrite:0,totalTokens:15,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
    const fakeStream=(chosen,context,options)=>{
      wire={chosen,context,options};
      return (async function*(){yield {type:'done',reason:'stop',message:{role:'assistant',api:chosen.api,provider:chosen.provider,model:chosen.id,content:[{type:'text',text:'SAMPLE complete'}],usage,stopReason:'stop',timestamp:0}}})();
    };
    const base=pi.createProvider({id:'credit-hub',name:'积分中枢',models:[model],auth:{apiKey:{name:'SAMPLE fixture',async resolve({credential}){return {auth:{apiKey:credential?.key??'SAMPLE'},source:'fixture'}}}},api:{streamSimple:fakeStream,stream:fakeStream}});
    const retryPolicy=llm.module.resolveRetryPolicy({mode:'normal',maxRetries:1},'compatibility fixture');
    const profiles=new Map([['credit-hub',{provider:'credit-hub',displayName:'积分中枢',piProvider:base,retryPolicy,modelErrors:new Map(),configuredMaxTokens:new Map(),defaultContextWindow:32768,streamIdleTimeoutMs:300000,maxRequestImageBytes:20971520,requestImagePixelBudget:4194304,requestImageMaxBytes:1048576}]]);
    const adapter=new PiAiAdapter({profiles:()=>profiles,auth:{credentials:{async read(){},async list(){return []}},authContext:{async env(){}}},resolveApiKey:async()=> 'SAMPLE'});
    const listed=await adapter.listModels('credit-hub');assert.equal(listed[0].id,model.id);
    const resolved=await adapter.resolveModel('credit-hub',model.id);assert.equal(resolved.context.contextWindow,1000000);
    assert.equal(adapter.providerRetryPolicy('credit-hub').maxRetries,1);
    const longText='SAMPLE完整上下文'.repeat(4096);
    const input={provider:'credit-hub',model:model.id,system:'SAMPLE system instructions',messages:[{id:'message-SAMPLE-1',role:'user',source:{kind:'user'},content:[{type:'text',text:longText}]},{id:'message-SAMPLE-2',role:'assistant',source:{kind:'model',provider:'credit-hub',model:model.id},content:[{type:'tool-call',id:'tool-SAMPLE',name:'read_sample',arguments:'{"path":"SAMPLE"}'}]},{id:'message-SAMPLE-3',role:'user',source:{kind:'user'},content:[{type:'tool-result',toolCallId:'tool-SAMPLE',content:[{type:'text',text:'SAMPLE result'}]}]}],tools:[{name:'read_sample',description:'SAMPLE tool',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}],maxTokens:64000,signal:new AbortController().signal};
    const roleTool=/function toolResultOf\(/.test(await historicalSource(tag,'packages/llm/llm-pi-ai/src/context.ts'));
    if(roleTool)input.messages[2]={id:'message-SAMPLE-3',role:'tool',toolCallId:'tool-SAMPLE',content:[{type:'text',text:'SAMPLE result'}],isError:false};
    const unchanged=JSON.stringify(input);
    const chunks=await Array.fromAsync(adapter.stream(input));
    assert.equal(chunks.at(-1)?.reason?.kind,'stop',JSON.stringify(chunks.at(-1)));
    assert.equal(JSON.stringify(input),unchanged);
    const systemMessage=wire.context.messages[0]?.role==='system'?wire.context.messages[0]:null;
    const history=systemMessage?wire.context.messages.slice(1):wire.context.messages;
    assert.equal(wire.context.systemPrompt??systemMessage?.content,input.system);
    assert.equal(history[0].content,longText);
    assert.equal(history[1].content[0].id,'tool-SAMPLE');
    assert.equal(history[2].toolCallId,'tool-SAMPLE');
    assert.equal(history[2].content[0].text,'SAMPLE result');
    assert.deepEqual(wire.context.tools??systemMessage?.toolsAdded,input.tools);
    assert.equal(wire.options.maxTokens,64000);
    entry.verification.officialModuleFixture=true;entry.moduleFixture={piAi:piVersion+' (actual npm library)',llm:'same official tag source',cordisDependency:'installed 4.0.5 library',typertDescriptor:true,listModels:true,resolveModel:true,providerRetryPolicy:true,streamFixture:{completeContext:true,toolDefinition:true,toolCallId:true,toolResult:true,toolVocabulary:roleTool?'tool-role-message':'user-nested-tool-result',outputBudget:64000,upstreamNetwork:false},upstreamNetwork:false,fullHistoricalHostRuntime:false};
    console.log(`OFFICIAL_MODULE_CONTRACT_PASS tag=${tag.name} typert=true models=true context=1000000 retry=1 tools=true maxTokens=64000`);
  }
}
async function verify(matrix){
  assert.equal(matrix.releases.length,tags.length);
  for(const row of matrix.releases){
    const methods={};for(const key of ['registerAdapter','registerConfigurableProviders','registerModelDiscovery'])if(row.features[key])methods[key]=()=>()=>{};
    const adapter={async*stream(input){yield input}};
    const handle=registerNativeProviderCompatibility({llm:methods},{providerId:'credit-hub',adapter,settingsNs:'dsh-credit-hub',discoverModels:async()=>[],hostVersion:row.version});
    assert.equal(handle.status.registered.adapter,true);
    assert.equal(row.features.typertRemote,true);assert.equal(row.features.typertService,true);
    row.verification.registrationFixture=true;handle.dispose();
  }
  console.log(`COMPATIBILITY_REGISTRATION_PASS tags=${matrix.releases.length} optional_api_fallback=true request_rewrite=false`);
}
await mkdir(research,{recursive:true});
const matrix=process.argv.includes('--collect')?await collect():JSON.parse(await readFile(matrixPath,'utf8'));
await verify(matrix);
if(process.argv.includes('--fixtures')||process.argv.includes('--all-module-fixtures'))await moduleFixtures(matrix);
await writeFile(matrixPath,JSON.stringify(matrix,null,2)+'\n');
console.log(`COMPATIBILITY_PASS source_audited=${matrix.releases.length} module_contracts=${matrix.releases.filter(r=>r.verification.officialModuleFixture).length} historical_desktop_runtimes=0`);

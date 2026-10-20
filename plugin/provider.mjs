// Independently assembled native provider. MIT-derived policy helpers retain upstream notices.
import {createProvider} from '@earendil-works/pi-ai';
import {openAICompletionsApi} from '@earendil-works/pi-ai/api/openai-completions.lazy';
import {resolveRetryPolicy,attributionHeaders} from '@deepseek-ai/dsh-llm';
import {PiAiAdapter} from '@deepseek-ai/dsh-llm-pi-ai';
import {thinkingMetadata} from '../engine/src/reasoning.mjs';
import {gatewayRequestPolicy} from '../engine/bundle/request-policy.mjs';
import {wrapGatewayRetryMetadata,registerGatewayRetryRecovery} from './retry-metadata.mjs';

export const providerId='credit-hub';
const inertAuth={credentials:{async read(){},async list(){return []},async modify(){throw new Error('Private worker credentials are managed by the host')},async delete(){}},authContext:{async env(){},async fileExists(){return false}}};
const sameWorker=(a,b)=>a&&b&&a.generation===b.generation&&a.baseUrl===b.baseUrl&&a.key===b.key;
const unavailable=(code,message)=>Object.assign(new Error(message),{code,status:503,beforeUpstream:true});
function throwIfAborted(signal){if(signal?.aborted)throw signal.reason??new DOMException('The operation was aborted','AbortError')}
function abortable(promise,signal){
  if(!signal)return promise;
  return new Promise((resolve,reject)=>{
    const abort=()=>{cleanup();reject(signal.reason??new DOMException('The operation was aborted','AbortError'))};
    const cleanup=()=>signal.removeEventListener('abort',abort);
    Promise.resolve(promise).then(value=>{cleanup();resolve(value)},error=>{cleanup();reject(error)});
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  });
}

export function createCreditHubAdapter({hub,models=[],resolveAttachments,minimumRefreshMs=1500,readyTimeoutMs=10000}) {
  let current=models.filter(m=>m&&typeof m.id==='string'),flight,lastRefresh=0,refreshedWorker,disposed=false;
  const lifetime=new AbortController(),profileWorkers=new WeakMap();
  const workerNow=()=>({...hub.runtime,generation:hub.runtime?.generation??0});
  const signalFor=signal=>signal?AbortSignal.any([lifetime.signal,signal]):lifetime.signal;
  const assertUsable=()=>{if(disposed)throw unavailable('hub_provider_disposed','积分中枢模型提供方已停止')};
  const assertCurrent=worker=>{
    assertUsable();
    if(!sameWorker(worker,workerNow())||(typeof hub.waitUntilReady==='function'&&typeof hub.status==='function'&&hub.status().status!=='ready'))
      throw unavailable('hub_generation_changed','积分中枢后台已切换；当前准备操作尚未发送到上游');
  };
  const ready=async signal=>{
    assertUsable();throwIfAborted(signal);
    const value=typeof hub.waitUntilReady==='function'?await abortable(Promise.resolve(hub.waitUntilReady({timeoutMs:readyTimeoutMs,signal})),signal):hub.runtime;
    throwIfAborted(signal);assertUsable();
    const worker={...hub.runtime,...value,generation:value?.generation??hub.runtime?.generation??0};
    assertCurrent(worker);return worker;
  };
  const base=createProvider({id:providerId,name:'积分中枢',auth:{apiKey:{name:'Private native worker',async resolve({credential}){return credential?.key?{auth:{apiKey:credential.key},source:'loopback'}:undefined}}},models:[],api:openAICompletionsApi()});
  let profiles;
  const publish=(next,worker)=>{
    current=next.filter(m=>m&&typeof m.id==='string');
    // A prepared PiAiAdapter call owns an immutable collection. In particular,
    // never pair its old loopback address with a key from a replacement worker.
    const raw=current.map(m=>({id:m.id,name:m.name??m.id,api:'openai-completions',provider:providerId,baseUrl:worker.baseUrl+'/v1',headers:{...attributionHeaders(),'X-AI-Credit-Source':'dsh'},input:m.capabilities?.multimodal?['text','image']:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:m.contextWindow??32768,maxTokens:m.maxTokens??4096,...thinkingMetadata(m)}));
    const profile={provider:providerId,displayName:'积分中枢',...gatewayRequestPolicy(worker,current),retryPolicy:resolveRetryPolicy({mode:'normal',maxRetries:1},'credit-hub retry policy'),modelErrors:new Map(),defaultContextWindow:32768,maxRequestImageBytes:20971520,requestImagePixelBudget:4194304,requestImageMaxBytes:1048576,piProvider:{...base,getModels:()=>raw}};
    profileWorkers.set(profile,worker);
    profiles=new Map([[providerId,profile]]);
  };
  publish(current,workerNow());
  const adapter=wrapGatewayRetryMetadata(new PiAiAdapter({profiles:()=>profiles,auth:inertAuth,resolveApiKey:async(_provider,profile)=>{
    const worker=profileWorkers.get(profile);assertCurrent(worker);return worker.key;
  },...(resolveAttachments?{resolveAttachments}:{})}),{models:()=>current,ownedGateway:true});
  const update=next=>publish(next,workerNow());
  const refresh=async({force=false,signal}={})=>{
    const effective=signalFor(signal),worker=await ready(effective);
    if(!force&&sameWorker(refreshedWorker,worker)&&Date.now()-lastRefresh<minimumRefreshMs)return current;
    if(flight&&sameWorker(flight.worker,worker))return abortable(flight.promise,effective);
    const entry={worker,promise:undefined};
    entry.promise=(async()=>{
      const r=await hub.request({method:'GET',path:'/admin/models'});
      assertCurrent(worker);
      if(r.status!==200)throw unavailable('hub_catalog_unavailable','模型目录刷新失败 HTTP '+r.status);
      publish(r.body.data??[],worker);refreshedWorker=worker;lastRefresh=Date.now();return current;
    })().finally(()=>{if(flight===entry)flight=undefined});
    flight=entry;
    return abortable(entry.promise,effective);
  };
  const ensureCall=async(model,signal)=>{
    const effective=signalFor(signal),worker=await ready(effective);
    // A generation change must bypass catalog throttling even for a known model.
    if(!sameWorker(refreshedWorker,worker)||!current.some(m=>m.id===model))await refresh({force:true,signal:effective});
    const live=await ready(effective);
    if(!sameWorker(refreshedWorker,live))throw unavailable('hub_generation_changed','积分中枢后台已切换；请重新准备本次调用');
    return live;
  };
  const validatePrepared=async(worker,signal)=>{
    const live=await ready(signalFor(signal));
    if(!sameWorker(worker,live))throw Object.assign(unavailable('hub_call_stale','积分中枢后台已重连；旧调用尚未发送，请重新准备调用'),{generation:worker?.generation,currentGeneration:live.generation});
  };
  const listModels=adapter.listModels.bind(adapter);
  adapter.listModels=async provider=>{await refresh();return listModels(provider)};
  // Both modern prepared calls and older direct-stream hosts pass this seam.
  if(typeof adapter.streamWithSnapshot==='function'){
    const streamWithSnapshot=adapter.streamWithSnapshot;
    adapter.streamWithSnapshot=async function*(options,snapshot){
      const worker=profileWorkers.get(snapshot?.profiles?.get(options.provider));
      await validatePrepared(worker,options.signal);
      yield* streamWithSnapshot.call(this,options,snapshot);
    };
  }
  const stream=adapter.stream;
  if(typeof stream==='function')adapter.stream=async function*(options){
    await ensureCall(options.model,options.signal);
    yield* stream.call(this,options);
  };
  if(typeof adapter.prepareCall==='function'){
    const prepareCall=adapter.prepareCall.bind(adapter);
    adapter.prepareCall=async(provider,model,signal)=>{
      const worker=await ensureCall(model,signal),call=await prepareCall(provider,model,signal);
      assertCurrent(worker);
      return {...call,stream:async function*(options){
        if(options.provider!==provider||options.model!==model)throw unavailable('hub_call_stale','积分中枢准备调用的模型与请求不一致');
        await validatePrepared(worker,options.signal??signal);
        yield* call.stream(options);
      }};
    };
  }
  const unsubscribe=typeof hub.onReady==='function'?hub.onReady(()=>{
    lastRefresh=0;refreshedWorker=undefined;
    // Ready notifications are advisory. Readiness remains enforced at each call,
    // including hosts without this event API, and a failed catalog fetch is not a
    // reason to replay a generation request or restart an otherwise healthy worker.
    void refresh({force:true}).catch(()=>{});
  }):undefined;
  const dispose=()=>{
    if(disposed)return;
    disposed=true;unsubscribe?.();lifetime.abort(unavailable('hub_provider_disposed','积分中枢模型提供方已停止'));
  };
  return {adapter,update,refresh,models:()=>current,dispose};
}
export {registerGatewayRetryRecovery};

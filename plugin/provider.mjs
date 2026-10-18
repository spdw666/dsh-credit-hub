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

export function createCreditHubAdapter({hub,models=[],resolveAttachments,minimumRefreshMs=1500}) {
  let current=models,flight,lastRefresh=0;
  const runtime=hub.runtime;
  const buildModels=()=>current.map(m=>({id:m.id,name:m.name??m.id,api:'openai-completions',provider:providerId,baseUrl:runtime.baseUrl+'/v1',headers:{...attributionHeaders(),'X-AI-Credit-Source':'dsh'},input:m.capabilities?.multimodal?['text','image']:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:m.contextWindow??32768,maxTokens:m.maxTokens??4096,...thinkingMetadata(m)}));
  const base=createProvider({id:providerId,name:'积分中枢',auth:{apiKey:{name:'Private native worker',async resolve({credential}){return credential?.key?{auth:{apiKey:credential.key},source:'loopback'}:undefined}}},models:buildModels(),api:openAICompletionsApi()});
  const profile={provider:providerId,displayName:'积分中枢',...gatewayRequestPolicy(runtime,current),retryPolicy:resolveRetryPolicy({mode:'normal',maxRetries:1},'credit-hub retry policy'),modelErrors:new Map(),defaultContextWindow:32768,maxRequestImageBytes:20971520,requestImagePixelBudget:4194304,requestImageMaxBytes:1048576,piProvider:{...base,getModels:buildModels}};
  let profiles=new Map([[providerId,profile]]);
  const adapter=wrapGatewayRetryMetadata(new PiAiAdapter({profiles:()=>profiles,auth:inertAuth,resolveApiKey:async()=>runtime.key,...(resolveAttachments?{resolveAttachments}:{})}),{models:()=>current,ownedGateway:true});
  const update=models=>{
    current=models.filter(m=>m&&typeof m.id==='string');
    Object.assign(profile,gatewayRequestPolicy(runtime,current));
    profiles=new Map([[providerId,profile]]);
  };
  const refresh=async({force=false}={})=>{
    if(!force&&Date.now()-lastRefresh<minimumRefreshMs)return current;
    if(flight)return flight;
    flight=(async()=>{const r=await hub.request({method:'GET',path:'/admin/models'});if(r.status!==200)throw new Error('模型目录刷新失败 HTTP '+r.status);update(r.body.data??[]);lastRefresh=Date.now();return current;})().finally(()=>{flight=undefined;});
    return flight;
  };
  const listModels=adapter.listModels.bind(adapter);
  adapter.listModels=async provider=>{await refresh();return listModels(provider)};
  if(typeof adapter.prepareCall==='function'){
    const prepareCall=adapter.prepareCall.bind(adapter);
    adapter.prepareCall=async(provider,model,signal)=>{if(!current.some(m=>m.id===model))await refresh({force:true});return prepareCall(provider,model,signal)};
  }
  return {adapter,update,refresh,models:()=>current};
}
export {registerGatewayRetryRecovery};

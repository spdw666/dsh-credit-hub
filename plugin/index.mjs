import z from '@deepseek-ai/schemastery';
import {TypertRemoteService,Remote} from '@deepseek-ai/dsh-typert-protocol';
import {join,resolve,dirname,basename} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHubRuntime,PLUGIN_VERSION} from '../server/runtime.mjs';
import {createCreditHubAdapter,providerId,registerGatewayRetryRecovery} from './provider.mjs';
import {registerNativeProviderCompatibility} from './compatibility.mjs';
import {resolveWorkerNode} from './node-runtime.mjs';

export const name='dsh-credit-hub';
export const inject=['llm'];
const rootDefault=join(process.env.DSH_HOME??join(homedir(),'.dsh'),'plugins','credit-hub');
export const Config=z.object({taskRoot:z.string().default(rootDefault),configFile:z.string().default(''),nodeExecutable:z.string().default(''),allowScheduler:z.boolean().default(false)});
const unwrap=v=>v&&typeof v.get==='function'?v.get():v;
const initializers=[];
export class CreditHubRemote extends TypertRemoteService {
  constructor(ctx,ready){super(ctx,'creditHub');this.ready=ready;for(const fn of initializers)fn.call(this)}
  async snapshot(){const hub=await this.ready;const snapshot=await hub.snapshot();return hub.compatibility?{...snapshot,compatibility:hub.compatibility}:snapshot}
  async request(input){return (await this.ready).request(input)}
}
for(const name of ['snapshot','request'])Remote(CreditHubRemote.prototype[name],{kind:'method',name,private:false,static:false,addInitializer(fn){initializers.push(fn)}});

export function apply(ctx,config={}) {
  const taskRoot=resolve(unwrap(config.taskRoot)||rootDefault);
  const configFile=unwrap(config.configFile)||join(taskRoot,'runtime/profile/config.json');
  const explicitNode=unwrap(config.nodeExecutable);
  let stopped=false,hub,compatibility,native;
  const ready=createHubRuntime({taskRoot,stateRoot:dirname(configFile),configFile,resolveNodeImpl:({signal})=>resolveWorkerNode({explicit:explicitNode,taskRoot,signal}),engineRoot:fileURLToPath(new URL('../engine/',import.meta.url)),memoryRoot:join(taskRoot,'memory'),logRoot:join(taskRoot,'runtime/logs'),allowScheduler:unwrap(config.allowScheduler)===true,enableBackgroundOperations:true});
  new CreditHubRemote(ctx,ready);
  registerGatewayRetryRecovery(ctx);
  ctx.effect(()=>()=>{stopped=true;native?.dispose?.();compatibility?.dispose();void hub?.close().catch(e=>ctx.logger.error('积分中枢后台退出异常：'+e.code));});
  void ready.then(async runtime=>{
    hub=runtime;if(stopped){await hub.close();return}
    native=createCreditHubAdapter({hub,resolveAttachments:()=>ctx.get('attachments')});
    const settingsNs=ctx.fiber?.entry?.options?.id??name;
    compatibility=registerNativeProviderCompatibility(ctx,{providerId,adapter:native.adapter,settingsNs,displayName:'积分中枢',discoverModels:async()=>{
      const models=await native.refresh({force:true});
      return models.map(m=>({id:m.id,name:m.name??m.id,contextWindow:m.contextWindow,maxTokens:m.maxTokens,inputModalities:m.capabilities?.multimodal?['text','image']:['text']}));
    }});
    hub.compatibility=compatibility.status;
    const reportReady=state=>ctx.logger.info(`积分中枢 ${PLUGIN_VERSION} 后台已连接：generation=${state.generation}；宿主守护已启用；自动调度默认关闭。`);
    const removeReady=hub.onReady(reportReady);ctx.effect(()=>removeReady);
    if(hub.status().status==='ready')reportReady(hub.status());
  }).catch(e=>ctx.logger.error('积分中枢启动失败：'+[e.code??'startup_error',e.message].filter(Boolean).join(' · ')));
}

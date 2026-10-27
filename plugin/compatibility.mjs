/**
 * Capability-based host integration. DSH release numbers do not substitute for
 * checking the APIs actually mounted by the user's profile. Optional directory
 * and discovery services must never take down the independent management UI.
 */
export const FIRST_AUDITED_DSH_VERSION='0.1.0-rc.7';
export const LAST_AUDITED_DSH_VERSION='0.2.1-rc.3';
export const WORKER_NODE_MINIMUM='22.23.3';
const isFunction=value=>typeof value==='function';
const issue=(code,feature,severity='notice')=>Object.freeze({code,feature,severity});

export function detectHostCapabilities(ctx={}, {adapter,hostVersion}={}) {
  const llm=ctx.llm;
  const capabilities={
    providerRegistration:isFunction(llm?.registerAdapter),
    configurableProviders:isFunction(llm?.registerConfigurableProviders),
    modelDiscovery:isFunction(llm?.registerModelDiscovery),
    stream:isFunction(adapter?.stream),
    snapshotStream:isFunction(adapter?.streamWithSnapshot),
    preparedCalls:isFunction(adapter?.prepareCall),
    modelListing:isFunction(adapter?.listModels),
    lifecycle:isFunction(ctx.effect),
    attachments:isFunction(ctx.get),
  };
  const diagnostics=[];
  if(!capabilities.providerRegistration)diagnostics.push(issue('HOST_LLM_REGISTRATION_MISSING','providerRegistration','error'));
  if(!capabilities.stream&&!capabilities.snapshotStream)diagnostics.push(issue('ADAPTER_STREAM_MISSING','stream','error'));
  if(!capabilities.configurableProviders)diagnostics.push(issue('HOST_PROVIDER_DIRECTORY_UNAVAILABLE','configurableProviders'));
  if(!capabilities.modelDiscovery)diagnostics.push(issue('HOST_MODEL_DISCOVERY_UNAVAILABLE','modelDiscovery'));
  return {hostVersion:hostVersion??'unknown',mode:capabilities.providerRegistration&&(capabilities.stream||capabilities.snapshotStream)?'native-provider':'management-only',capabilities,diagnostics};
}

function disposer(handle) {
  if(isFunction(handle))return handle;
  if(isFunction(handle?.dispose))return ()=>handle.dispose();
  return ()=>{};
}

/**
 * Register the unchanged native adapter first. Metadata/discovery are optional
 * and have separate failures/disposers. No fallback serializes or rewrites a
 * request; messages, tools and cancellation are still owned by the SDK adapter.
 */
export function registerNativeProviderCompatibility(ctx,{providerId,adapter,settingsNs,displayName='积分中枢',discoverModels,hostVersion}={}) {
  const probe=detectHostCapabilities(ctx,{adapter,hostVersion});
  const diagnostics=[...probe.diagnostics],handles=[];
  const registered={adapter:false,configurableProviders:false,modelDiscovery:false};
  let disposed=false;
  const notify=item=>{
    diagnostics.push(item);
    try {ctx.logger?.warn?.(`积分中枢兼容诊断：${item.code}`)}catch{}
  };
  if(probe.mode==='native-provider'){
    try{
      handles.push(disposer(ctx.llm.registerAdapter([providerId],adapter)));
      registered.adapter=true;
    }catch{
      notify(issue('HOST_ADAPTER_REGISTRATION_FAILED','providerRegistration','error'));
    }
  }
  if(registered.adapter&&probe.capabilities.configurableProviders){
    try{
      handles.push(disposer(ctx.llm.registerConfigurableProviders([{provider:providerId,displayName,settingsNs,settingsPath:[],declared:false}])));
      registered.configurableProviders=true;
    }catch{
      notify(issue('HOST_PROVIDER_DIRECTORY_REGISTRATION_FAILED','configurableProviders'));
    }
  }
  if(registered.adapter&&probe.capabilities.modelDiscovery&&isFunction(discoverModels)){
    try{
      handles.push(disposer(ctx.llm.registerModelDiscovery(settingsNs,discoverModels)));
      registered.modelDiscovery=true;
    }catch{
      notify(issue('HOST_MODEL_DISCOVERY_REGISTRATION_FAILED','modelDiscovery'));
    }
  }
  for(const item of probe.diagnostics){try{ctx.logger?.warn?.(`积分中枢兼容诊断：${item.code}`)}catch{}}
  return {
    get status(){return {hostVersion:probe.hostVersion,mode:registered.adapter?'native-provider':'management-only',capabilities:{...probe.capabilities},registered:{...registered},diagnostics:[...diagnostics],disposed}},
    dispose(){
      if(disposed)return;
      disposed=true;
      for(const release of handles.reverse()){
        try{release()}catch{notify(issue('HOST_REGISTRATION_DISPOSE_FAILED','lifecycle'))}
      }
    },
  };
}

/** A prerelease-aware union, not `*` or a silently widened future-version claim. */
export function buildDshCompatibilityRange(versions) {
  const families=new Map();
  for(const input of versions){
    const version=String(input).replace(/^dsh-v/,'');
    const match=/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
    if(!match)throw new TypeError('Invalid audited DSH version');
    const family=`${match[1]}.${match[2]}.${match[3]}`;
    if(!families.has(family))families.set(family,[]);
    families.get(family).push(version);
  }
  // Exact versions ensure alpha/rc releases from a different patch do not fall
  // into an accidental gap in npm's prerelease range semantics.
  return [...families.values()].flat().join(' || ');
}

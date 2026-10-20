import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export function compareReleaseVersions(a,b){
  const parse=value=>{const m=String(value).trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);if(!m)throw new Error('invalid_release_version');return {numbers:m.slice(1,4).map(Number),pre:m[4]?.split('.')};};
  const x=parse(a),y=parse(b);for(let i=0;i<3;i++)if(x.numbers[i]!==y.numbers[i])return Math.sign(x.numbers[i]-y.numbers[i]);
  if(!x.pre&&!y.pre)return 0;if(!x.pre)return 1;if(!y.pre)return -1;
  for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++){const a=x.pre[i],b=y.pre[i];if(a===undefined)return -1;if(b===undefined)return 1;if(a===b)continue;const an=/^\d+$/.test(a),bn=/^\d+$/.test(b);return an&&bn?Math.sign(Number(a)-Number(b)):an?-1:bn?1:a<b?-1:1;}return 0;
}
export function releaseSource(settings={},descriptor={}){
  if(settings.feedUrl){const url=new URL(settings.feedUrl);if(url.protocol!=='https:'&&!(settings.allowLocalTest===true&&url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('update_feed_requires_https');if(url.username||url.password||url.hash)throw new Error('invalid_update_feed');return {kind:'feed',url:url.href};}
  let repository=settings.repository??descriptor.repository?.url??descriptor.repository;
  if(typeof repository==='string')repository=repository.replace(/^git\+/,'').replace(/\.git$/,'').replace(/^https:\/\/github.com\//,'');
  if(repository&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))return {kind:'github',url:`https://api.github.com/repos/${repository}/contents/package.json`,repository};
  if(settings.npmPackage){if(!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(settings.npmPackage))throw new Error('invalid_update_package');return {kind:'npm',url:`https://registry.npmjs.org/${encodeURIComponent(settings.npmPackage)}/latest`};}
  return null;
}
export function createUpdateMonitor({ledger,version,descriptor={},settings={},fetch:fetcher=globalThis.fetch,now=Date.now,onEvent=()=>{}}){
  let config={enabled:true,intervalHours:1,includePrerelease:false,...settings},timer,flight,stopped=false;
  const key='credit-hub:update-monitor:v1';let state=ledger.get(key)??{status:'never_checked',availableVersion:null,updateAvailable:false};
  const persist=()=>ledger.set(key,state),status=()=>({...state,installedVersion:version,enabled:config.enabled!==false,configured:!!releaseSource(config,descriptor),intervalHours:config.intervalHours});
  async function check({force=false}={}){
    if(flight)return flight;
    const source=releaseSource(config,descriptor);
    if(!source){state={...state,status:'not_published',updateAvailable:false,availableVersion:null};persist();return status();}
    if(config.enabled===false&&!force)return status();
    if(!force&&now()-(state.checkedAtMs??0)<config.intervalHours*3600000)return status();
    flight=(async()=>{
      try{
        const response=await fetcher(source.url,{headers:{accept:source.kind==='github'?'application/vnd.github.raw+json':'application/json','User-Agent':'dsh-credit-hub-update-check'},signal:AbortSignal.timeout(12000),redirect:'error'});
        if(!response.ok)throw Object.assign(new Error('update_feed_http_error'),{code:'update_feed_http_'+response.status});
        let bytes=0;const chunks=[];for await(const chunk of response.body){bytes+=chunk.length;if(bytes>256*1024)throw new Error('update_feed_too_large');chunks.push(chunk);}
        let data=JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));
        if(source.kind==='github'&&data.encoding==='base64'&&typeof data.content==='string')data=JSON.parse(Buffer.from(data.content,'base64').toString('utf8'));
        const latest=data.version??data.tag_name;
        compareReleaseVersions(latest,version);
        if(data.draft===true||(!config.includePrerelease&&(data.prerelease===true||String(latest).includes('-')))){state={...state,status:'prerelease_ignored',checkedAtMs:now()};persist();return status();}
        const available=compareReleaseVersions(latest,version)>0;
        const releaseUrl=source.kind==='github'?`https://github.com/${source.repository}`:typeof data.releaseUrl==='string'?data.releaseUrl:null;
        const safeUrl=releaseUrl&&/^https:\/\//.test(releaseUrl)&&!new URL(releaseUrl).username?releaseUrl:null;
        state={...state,status:available?'update_available':'up_to_date',source:source.kind,checkedAtMs:now(),checkedAt:new Date(now()).toISOString(),availableVersion:latest.replace(/^v/,''),updateAvailable:available,releaseUrl:safeUrl,errorCode:null};
        if(available&&state.notifiedVersion!==latest){const receipt=await onEvent({type:'update.available',key:'update:'+latest,title:'积分中枢有新版本',message:`已安装 ${version}，版本源显示 ${latest}。请查看发布说明与完整安装包；市场更新状态以实际市场为准。`,version:latest});if(receipt?.queued>0&&receipt.persisted!==false)state.notifiedVersion=latest;}
        persist();return status();
      }catch(error){state={...state,status:'check_failed',checkedAtMs:now(),errorCode:/^[a-z0-9_]+$/.test(error.code??error.message)?error.code??error.message:'update_check_failed'};persist();return status();}
    })().finally(()=>{flight=null;});return flight;
  }
  return {check,status,configure(value){const next={...config,...value};if(!Number.isFinite(next.intervalHours)||next.intervalHours<.25||next.intervalHours>168)throw new Error('update_interval_out_of_range');releaseSource(next,descriptor);config=next;state={...state,checkedAtMs:0};persist();return status();},start(){if(timer)return;stopped=false;void check();timer=setInterval(()=>{if(!stopped)void check();},60000);timer.unref?.();},async close(){stopped=true;clearInterval(timer);timer=null;await flight;}};
}

// Development/CI only. Production receives these interfaces from its DSH host.
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {mkdir,writeFile,lstat,realpath,rm,unlink,symlink} from 'node:fs/promises';import {join,resolve,sep} from 'node:path';
const npm=process.env.npm_execpath??process.argv[2];if(!npm)throw Error('Run npm run sdk:install, or pass the absolute npm-cli.js path');
// Each host release vendors its own cordis/schemastery/loader and pi-ai versions;
// borrowing another release's mix would prove nothing about the host under test.
const legacy={cordis:'4.0.5',schemastery:'3.18.5',loader:'1.0.6',piAi:'1.1.0'};
const HOST_SDK={'0.2.1-rc.2':legacy,'0.2.1-rc.3':legacy,'0.2.1-rc.4':legacy,'0.2.1-rc.5':legacy,'0.2.2-rc.1':{cordis:'4.1.0',schemastery:'3.19.0',loader:'1.1.0',piAi:'1.3.0'},'0.2.2-rc.2':{cordis:'4.1.0',schemastery:'3.19.0',loader:'1.1.0',piAi:'1.3.0'}};
const hostVersion=process.env.CREDIT_HUB_TEST_DSH_VERSION??'0.2.2-rc.2';
if(!(hostVersion in HOST_SDK))throw Error('Unsupported development SDK version: '+hostVersion);
const pinned=HOST_SDK[hostVersion];
// Host packages that only some releases publish. 0.2.2-rc.2 is the first release
// to ship @deepseek-ai/dsh-error at all, and its dsh-llm/dsh-attachment/dsh-fs/
// dsh-llm-retry/dsh-session declare these as required peers; earlier releases must
// not request them or npm fails with ETARGET.
const EXTRA_PEERS={'0.2.2-rc.2':['dsh-error','dsh-sandbox','dsh-agent','dsh-session','dsh-session-projection','dsh-scope','dsh-system-prompt']};
const sdk=[`@deepseek-ai/cordis@${pinned.cordis}`,`@deepseek-ai/schemastery@${pinned.schemastery}`,`@deepseek-ai/cordis-plugin-loader@${pinned.loader}`,'@deepseek-ai/dsh-llm@HOST_VERSION','@deepseek-ai/dsh-llm-retry@HOST_VERSION','@deepseek-ai/dsh-llm-pi-ai@HOST_VERSION','@deepseek-ai/dsh-typert-protocol@HOST_VERSION','@deepseek-ai/dsh-attachment@HOST_VERSION','@deepseek-ai/dsh-authorization@HOST_VERSION','@deepseek-ai/dsh-credentials@HOST_VERSION','@deepseek-ai/dsh-fs@HOST_VERSION','@deepseek-ai/dsh-launch-environment@HOST_VERSION','@deepseek-ai/dsh-timeout@HOST_VERSION',...(EXTRA_PEERS[hostVersion]??[]).map(name=>`@deepseek-ai/${name}@HOST_VERSION`),`@earendil-works/pi-ai@${pinned.piAi}`].map(spec=>spec.replace('@HOST_VERSION','@'+hostVersion));
const root=fileURLToPath(new URL('../',import.meta.url)),development=join(root,'work/dev-sdk'),modules=resolve(root,'node_modules');await mkdir(development,{recursive:true});const dependencies=Object.fromEntries(sdk.map(spec=>{const at=spec.lastIndexOf('@');return [spec.slice(0,at),spec.slice(at+1)];}));await writeFile(join(development,'package.json'),JSON.stringify({name:'credit-hub-development-sdk',version:'0.0.0',private:true,dependencies},null,2)+'\n');
// Root peers are intentionally optional for production; install the SDK as
// actual dependencies of an isolated dev workspace, then link those roots.
execFileSync(process.execPath,[npm,'install','--prefix',development,'--package-lock=false','--ignore-scripts','--legacy-peer-deps','--registry=https://registry.npmjs.org'],{cwd:development,stdio:'inherit',windowsHide:true});
for(const name of Object.keys(dependencies)){const target=resolve(modules,name),source=join(development,'node_modules',name);if(!target.startsWith(modules+sep))throw Error('Development SDK target escaped node_modules');await mkdir(join(target,'..'),{recursive:true});let info;try{info=await lstat(target);}catch(e){if(e.code!=='ENOENT')throw e;}if(info?.isSymbolicLink())await unlink(target);else if(info){const resolved=await realpath(target);if(!resolved.startsWith(modules+sep))throw Error('Development SDK target escaped node_modules');await rm(target,{recursive:true});}await symlink(source,target,process.platform==='win32'?'junction':'dir');}
console.log('DEVELOPMENT_SDK_READY pinned_host='+hostVersion+' isolated=true');

import {watch} from 'node:fs';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname,basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import {requireWithin} from './contracts.mjs';

// Runtime state only: no transcript following, credentials or account identities.
export async function attachRuntimeMemory({taskRoot,memoryRoot,configFile,summary,intervalMs=5000}) {
  requireWithin(taskRoot,memoryRoot,'runtime memory');
  await mkdir(memoryRoot,{recursive:true});
  let stopped=false,debounce,chain=Promise.resolve();
  const update=(status='running')=>chain=chain.catch(()=>{}).then(async()=>{
    if(stopped&&status!=='stopped')return;
    const raw=await readFile(configFile);
    const value={updatedAt:new Date().toISOString(),status,configSha256:createHash('sha256').update(raw).digest('hex'),...summary()};
    const file=join(memoryRoot,'RUNTIME_STATE.json'),tmp=file+'.tmp';
    await writeFile(tmp,JSON.stringify(value,null,2)+'\n');await rename(tmp,file);
    await writeFile(join(memoryRoot,'RUNTIME_STATUS.md'),`# 积分中枢实时运行状态\n\n更新：${value.updatedAt}\n\n状态：${status}；插件 ${value.pluginVersion}；核心 ${value.coreVersion}。\n\n账户 ${value.counts.accounts}；平台 ${value.counts.platforms}；路由 ${value.counts.routes}，启用 ${value.counts.enabledRoutes}；自动排程 ${value.schedulerRunning?'启用':'关闭'}。\n\n本文件仅记录新插件本地运行状态，不读取其他会话，不把配置存在当作上游调用成功。\n`);
  });
  await update();
  const watcher=watch(dirname(configFile),(_event,file)=>{if(file&&String(file)!==basename(configFile))return;clearTimeout(debounce);debounce=setTimeout(()=>{void update().catch(()=>{})},200)});watcher.unref();
  const timer=setInterval(()=>{void update().catch(()=>{})},intervalMs);timer.unref();
  return async()=>{if(stopped)return;stopped=true;watcher.close();clearTimeout(debounce);clearInterval(timer);await update('stopped')};
}

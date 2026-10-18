import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {attachRuntimeMemory} from '../server/memory.mjs';
test('live memory records only the independent plugin state and closes its watcher',async t=>{
 const parent=fileURLToPath(new URL('../../work/',import.meta.url));await mkdir(parent,{recursive:true});const taskRoot=await mkdtemp(join(parent,'memory-test-'));t.after(()=>rm(taskRoot,{recursive:true,force:true}));
 const configFile=join(taskRoot,'config.json'),memoryRoot=join(taskRoot,'memory');await writeFile(configFile,'{}');
 const summary=()=>({pluginVersion:'0.1.0',coreVersion:'0.6.0',counts:{accounts:1,platforms:1,routes:2,enabledRoutes:1},schedulerRunning:false,workerPid:123});
 const stop=await attachRuntimeMemory({taskRoot,memoryRoot,configFile,summary,intervalMs:25});
 const first=JSON.parse(await readFile(join(memoryRoot,'RUNTIME_STATE.json'),'utf8'));assert.equal(first.counts.accounts,1);assert.equal(first.status,'running');assert.equal(JSON.stringify(first).includes('credential'),false);
 await writeFile(configFile,'{"SAMPLE":1}');
 let after;for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,15));after=JSON.parse(await readFile(join(memoryRoot,'RUNTIME_STATE.json'),'utf8'));if(after.configSha256!==first.configSha256)break}
 assert.notEqual(after.configSha256,first.configSha256);await stop();assert.equal(JSON.parse(await readFile(join(memoryRoot,'RUNTIME_STATE.json'),'utf8')).status,'stopped');
});
test('runtime memory rejects a predecessor/outside directory before creating files',async()=>{
 await assert.rejects(attachRuntimeMemory({taskRoot:'D:/SAMPLE/new',memoryRoot:'D:/SAMPLE/old',configFile:'D:/SAMPLE/new/config.json',summary:()=>({})}),/outside|within|root|memory/i);
});

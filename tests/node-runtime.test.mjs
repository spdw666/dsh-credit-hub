import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {win32,posix} from 'node:path';
import {resolveWorkerNode,probeWorkerNode,isSupportedWorkerProbe} from '../plugin/node-runtime.mjs';

const good={version:'22.23.3',sqlite:true,electron:false};
const missing=()=>Object.assign(new Error('SAMPLE missing'),{code:'ENOENT'});
test('capability predicate requires real SQLite, a stable supported version and a non-Electron process',()=>{
  for(const version of ['22.23.3','22.24.0','24.0.0','24.21.0'])assert.equal(isSupportedWorkerProbe({...good,version}),true);
  for(const version of ['20.99.9','22.23.2','22.19.0','v24.0.0','24.0.0-rc.1','SAMPLE'])assert.equal(isSupportedWorkerProbe({...good,version}),false);
  assert.equal(isSupportedWorkerProbe({...good,electron:true}),false);
  assert.equal(isSupportedWorkerProbe({...good,sqlite:false}),false);
});
test('explicit configured executable wins and is resolved absolutely',async()=>{
  const seen=[];
  const result=await resolveWorkerNode({explicit:'.\\tools\\node.exe',cwd:'C:\\SAMPLE',platform:'win32',taskRoot:'C:\\SAMPLE\\hub',execPath:'C:\\DSH\\DeepSeek Harness.exe',env:{DSH_CREDIT_HUB_NODE:'C:\\ignored\\node.exe'},probe:async file=>{seen.push(file);return good}});
  assert.equal(result,'C:\\SAMPLE\\tools\\node.exe');assert.deepEqual(seen,[result]);
});
test('bad explicit executable or environment setting fails without a hidden fallback',async()=>{
  let attempts=0;
  for(const explicit of ['C:\\SAMPLE\\DeepSeek Harness.exe','C:\\SAMPLE\\node.cmd']){
    await assert.rejects(resolveWorkerNode({explicit,platform:'win32',env:{PATH:'C:\\SAMPLE'},probe:async()=>{attempts++;return good}}),{code:'worker_node_configuration_invalid'});
  }
  assert.equal(attempts,0);
  await assert.rejects(resolveWorkerNode({explicit:'C:\\SAMPLE\\node.exe',platform:'win32',env:{},probe:async()=>{attempts++;throw missing()}}),{code:'worker_node_configuration_invalid'});
  assert.equal(attempts,1);
  await assert.rejects(resolveWorkerNode({platform:'win32',env:{DSH_CREDIT_HUB_NODE:'C:\\SAMPLE\\node.exe',PATH:'C:\\other'},probe:async()=>({...good,sqlite:false})}),{code:'worker_node_configuration_invalid'});
});
test('Electron host discovers the official DSH standalone Node without downloading anything',async()=>{
  const expected='C:\\SAMPLE\\DeepSeek Harness\\resources\\app\\runtime\\primary-runtime\\dependencies\\node\\bin\\node.exe',seen=[];
  const result=await resolveWorkerNode({platform:'win32',cwd:'C:\\SAMPLE',execPath:'C:\\SAMPLE\\DeepSeek Harness\\DeepSeek Harness.exe',taskRoot:'C:\\SAMPLE\\hub',env:{PATH:'C:\\SAMPLE\\fallback'},probe:async file=>{seen.push(file);if(file===expected)return {...good,version:'24.21.0'};throw missing()}});
  assert.equal(result,expected);assert.equal(seen.some(f=>f.endsWith('Harness.exe')),false);assert.equal(seen.some(f=>f.endsWith('.cmd')),false);
});
test('host standalone Node and task-local runtime precede PATH candidates',async()=>{
  const seen=[];
  const result=await resolveWorkerNode({platform:'linux',cwd:'/SAMPLE',execPath:'/SAMPLE/old/node',taskRoot:'/SAMPLE/hub',env:{PATH:'/SAMPLE/path'},probe:async file=>{seen.push(file);return file==='/SAMPLE/old/node'?{...good,version:'22.19.0'}:good}});
  assert.equal(result,'/SAMPLE/hub/runtime/node');assert.deepEqual(seen,['/SAMPLE/old/node','/SAMPLE/hub/runtime/node']);
});
test('PATH candidates are absolute, deduplicated and command shims are never executed',async()=>{
  const seen=[];
  const result=await resolveWorkerNode({platform:'win32',cwd:'C:\\SAMPLE',execPath:'C:\\SAMPLE\\DeepSeek Harness.exe',env:{Path:';"C:\\SAMPLE\\old";C:\\SAMPLE\\OLD;C:\\SAMPLE\\new;'},probe:async file=>{seen.push(file);if(file==='C:\\SAMPLE\\new\\node.exe')return good;throw missing()}});
  assert.equal(result,'C:\\SAMPLE\\new\\node.exe');assert.equal(seen.filter(f=>/\\old\\node.exe$/i.test(f)).length,1);
  assert.ok(seen.every(f=>win32.isAbsolute(f)&&f.toLowerCase().endsWith('node.exe')));
});
test('macOS packaged Electron finds its sibling Resources primary runtime',async()=>{
  const expected='/Applications/SAMPLE.app/Contents/Resources/app/runtime/primary-runtime/dependencies/node/bin/node';
  const result=await resolveWorkerNode({platform:'darwin',cwd:'/SAMPLE',execPath:'/Applications/SAMPLE.app/Contents/MacOS/SAMPLE',env:{},probe:async file=>{if(file===expected)return good;throw missing()}});
  assert.equal(result,expected);assert.equal(posix.isAbsolute(result),true);
});
test('unsupported candidates produce typed diagnostics without executing another application',async()=>{
  await assert.rejects(resolveWorkerNode({platform:'linux',cwd:'/SAMPLE',execPath:'/SAMPLE/electron',env:{},probe:async()=>{throw missing()}}),e=>e.code==='worker_node_unavailable'&&Array.isArray(e.details.attempts));
});
test('current test runtime passes the actual version and in-memory SQLite probe',async()=>{
  if(!/^node(?:\.exe)?$/i.test(process.execPath.split(/[\\/]/).at(-1)))return;
  assert.equal(isSupportedWorkerProbe(await probeWorkerNode(process.execPath)),true);
});
test('installed DSH official standalone Node passes the actual capability probe when present',async t=>{
  if(process.platform!=='win32'){t.skip('The local installed DSH runtime probe is Windows-specific');return}
  const file=win32.join(process.env.LOCALAPPDATA??'C:\\SAMPLE','Programs','DeepSeek Harness','resources','app','runtime','primary-runtime','dependencies','node','bin','node.exe');
  try{await access(file)}catch{t.skip('No existing DSH desktop install at the official local path');return}
  const result=await probeWorkerNode(file);assert.equal(isSupportedWorkerProbe(result),true);assert.equal(result.electron,false);
});

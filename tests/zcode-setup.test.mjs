import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseSetupArgs, setupZcodeStandardProxy, reference} from '../scripts/setup-zcode-standard-proxy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sample = () => ({schemaVersion: 1, server: {host: '127.0.0.1', port: 0}, dataDir: './profile data', scheduler: {enabled: false, startup: false, timezone: 'Asia/Shanghai', hour: 0, minute: 5, jitterSeconds: 0}, accounts: [{id: 'sample', platform: 'zcode', credentials: {kind: 'file', file: './unused-sample.json'}, tasks: []}], upstreams: [{id: 'sample-upstream', kind: 'zcode', accountId: 'sample'}], routes: [{id: 'sample-a', enabled: true, targets: [{upstreamId: 'sample-upstream', model: 'SAMPLE-model-a'}]}, {id: 'sample-b', enabled: false, targets: [{upstreamId: 'sample-upstream', model: 'SAMPLE-model-b'}]}]});
function fixture(t) {
  const fixtureRoot = path.join(root, '..', 'work', 'zcode-setup-fixtures');
  fs.mkdirSync(fixtureRoot, {recursive: true});
  const dir = fs.mkdtempSync(path.join(fixtureRoot, 'dsh zcode SAMPLE 空格 '));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) await new Promise(resolve => {child.once('exit', resolve); child.kill();});
    fs.rmSync(dir, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  });
  const configFile = path.join(dir, 'sample.json');
  fs.writeFileSync(configFile, JSON.stringify(sample()));
  return {dir, configFile, ownChild: value => {child = value;}};
}

test('ZCode setup parser requires explicit unique flags and preserves paths with spaces', () => {
  assert.deepEqual(parseSetupArgs(['--config', 'SAMPLE profile/config.json', '--app-version', '1.2.3', '--source', 'SAMPLE source']), {configFile: 'SAMPLE profile/config.json', appVersion: '1.2.3', sourceDir: 'SAMPLE source'});
  assert.throws(() => parseSetupArgs(['--app-version', '1.2.3', '--app-version', '2.0.0']), /unique/);
  assert.throws(() => parseSetupArgs(['--target-root', 'SAMPLE']), /Expected/);
  assert.throws(() => parseSetupArgs(['--config']), /Expected/);
});

test('ZCode setup never uses an example native version or implicit source config', async () => {
  await assert.rejects(setupZcodeStandardProxy({configFile: 'SAMPLE'}), /current installed/);
  await assert.rejects(setupZcodeStandardProxy({appVersion: '1.2.3'}), /--config/);
});

test('ZCode setup preserves unknown runtime rather than overwriting it', async t => {
  const {dir, configFile} = fixture(t);
  const runtime = path.join(dir, 'profile data', 'zcode-standard-proxy', 'runtime');
  fs.mkdirSync(runtime, {recursive: true});
  const sentinel = path.join(runtime, 'SAMPLE.txt');
  fs.writeFileSync(sentinel, 'keep');
  await assert.rejects(setupZcodeStandardProxy({configFile, appVersion: '1.2.3'}, {run: () => process.execPath, choosePort: async () => 19426}), /provenance/);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
  assert.equal(fs.existsSync(path.join(dir, 'profile data', 'zcode-standard-proxy', 'runtime.json')), false);
});

test('ZCode setup rejects invalid ports before cloning or writing a key', async t => {
  const {dir, configFile} = fixture(t);
  let calls = 0;
  await assert.rejects(setupZcodeStandardProxy({configFile, appVersion: '1.2.3', port: '80'}, {run: () => {calls++; return process.execPath;}}), /--port/);
  assert.equal(calls, 1);
  assert.equal(fs.existsSync(path.join(dir, 'profile data', 'zcode-standard-proxy', 'bridge-private.json')), false);
});

test('ZCode setup license, bridge and pin retain isolation and upstream attribution', () => {
  const dir = path.join(root, 'integrations/zcode-standard-proxy');
  const text = fs.readFileSync(path.join(dir, 'LICENSE.zcode-api'), 'utf8');
  assert.match(text, /Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International/);
  assert.match(text, /TriDefender/);
  assert.equal(reference.commit, '9880d91579fdb9d3e59c2bb900add3ab86722003');
  const bridge = fs.readFileSync(path.join(dir, 'bridge.ts'), 'utf8');
  assert.match(bridge, /ZCODE_PROXY_STORE_DIR=path.join\(root,'profile'\)/);
  assert.match(bridge, /hostname:'127.0.0.1'/);
  assert.match(bridge, /timingSafeEqual/);
  assert.match(bridge, /config\.mcp\.enabled/);
  assert.doesNotMatch(bridge, /from ['"].*index\.ts/);
});

test('ZCode optional pinned runtime install is isolated, idempotent and health-only', {skip: !process.env.ZCODE_PROXY_TEST_SOURCE || !process.env.ZCODE_PROXY_TEST_BUN}, async t => {
  const {dir, configFile, ownChild} = fixture(t);
  const options = {configFile, appVersion: '1.2.3', sourceDir: process.env.ZCODE_PROXY_TEST_SOURCE, bunCommand: process.env.ZCODE_PROXY_TEST_BUN};
  const before = fs.readFileSync(configFile);
  const first = await setupZcodeStandardProxy(options);
  assert.deepEqual(first.models, ['SAMPLE-model-a', 'SAMPLE-model-b']);
  assert.equal(first.generationRequests, 0);
  assert.equal(first.claimRequests, 0);
  assert.equal(first.keyPrinted, false);
  const privateFile = path.join(first.runtime, 'bridge-private.json');
  const privateFirst = JSON.parse(fs.readFileSync(privateFile, 'utf8'));
  const localFirst = JSON.parse(fs.readFileSync(first.runtimeFile, 'utf8'));
  const second = await setupZcodeStandardProxy(options);
  const privateSecond = JSON.parse(fs.readFileSync(privateFile, 'utf8'));
  assert.equal(privateSecond.localKey, privateFirst.localKey);
  assert.equal(privateSecond.port, privateFirst.port);
  assert.equal(second.runtimeFile, first.runtimeFile);
  assert.deepEqual(fs.readFileSync(configFile), before);
  assert.equal(path.dirname(first.runtimeFile), first.runtime);
  const cfg = JSON.parse(fs.readFileSync(path.join(first.runtime, 'config.json'), 'utf8'));
  assert.equal(cfg.identity.appVersion, '1.2.3');
  assert.equal(cfg.claim.enabled, false); assert.equal(cfg.claim.auto, false);
  assert.equal(cfg.async.enabled, false); assert.equal(cfg.highspeed.enabled, false);
  assert.equal(cfg.mcp.enabled, false); assert.equal(cfg.mcp.gateway.enabled, false);
  const child = spawn(localFirst.launch.command, [localFirst.launch.script], {cwd: first.runtime, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, ZCODE_CLAIM_AUTO: 'true', ZCODE_PROVIDER: 'bigmodel', ZCODE_PROXY_STORE_DIR: 'SAMPLE-shared-store'}});
  ownChild(child);
  let output = '';
  child.stdout.on('data', x => {output += x;}); child.stderr.on('data', x => {output += x;});
  const health = localFirst.baseUrl.replace('/v1/chat/completions', '/health');
  let ready;
  for (let i = 0; i < 100; i++) {
    try {ready = await fetch(health, {headers: {authorization: 'Bearer ' + localFirst.localKey}}); break;} catch {await new Promise(resolve => setTimeout(resolve, 100));}
  }
  assert.ok(ready, 'bridge must start without any official request: ' + output);
  assert.equal(ready.status, 200);
  const data = await ready.json();
  assert.equal(data.commit, reference.commit); assert.equal(data.backgroundFeatures, false); assert.equal(data.nativeAppVersion, '1.2.3');
  assert.equal((await fetch(health)).status, 401);
  assert.equal((await fetch(health, {headers: {authorization: 'Bearer SAMPLE-WRONG'}})).status, 401);
  assert.equal((await fetch(localFirst.baseUrl, {method: 'POST', headers: {authorization: 'Bearer ' + localFirst.localKey, 'content-type': 'application/json'}, body: JSON.stringify({model: 'SAMPLE-model-a', messages: []})})).status, 401);
  assert.equal(fs.existsSync(path.join(first.runtime, 'bridge-trace.jsonl')), false);
  assert.equal(fs.existsSync(path.join(dir, 'SAMPLE-shared-store')), false);
});

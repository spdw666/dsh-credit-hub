import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {ConfigStore} from '../engine/src/config.mjs';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
const integration = path.join(pluginRoot, 'integrations/zcode-standard-proxy');
export const reference = JSON.parse(fs.readFileSync(path.join(integration, 'reference.json'), 'utf8'));
const digest = text => createHash('sha256').update(text).digest('hex');
const execute = (command, args, options = {}) => execFileSync(command, args, {
  ...options, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024,
});

export function parseSetupArgs(args) {
  const result = {};
  const names = {'--config': 'configFile', '--app-version': 'appVersion', '--bun': 'bunCommand', '--source': 'sourceDir', '--port': 'port'};
  for (let i = 0; i < args.length; i++) {
    const key = names[args[i]], value = args[++i];
    if (!key || !value || value.startsWith('--') || result[key] !== undefined) throw Error('Expected unique --config, --app-version, --bun, --source or --port followed by a value');
    result[key] = value;
  }
  return result;
}

function atomic(file, body) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = file + '.setup-' + process.pid;
  fs.writeFileSync(temp, body, {mode: 0o600});
  fs.renameSync(temp, file);
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const {port} = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

// Installation never loads a login store or makes a model/claim request. The
// optional upstream is fetched separately and retains its own complete license.
export async function setupZcodeStandardProxy(options = {}, {run = execute, choosePort = unusedPort} = {}) {
  const {appVersion} = options;
  if (!/^\d+\.\d+\.\d+(?:[.-][a-zA-Z0-9.]+)?$/.test(appVersion ?? '')) throw Error('--app-version must match the current installed ZCode application version');
  if (!options.configFile) throw Error('--config must point to this plugin profile configuration');
  const config = new ConfigStore(path.resolve(options.configFile));
  await config.load();
  const upstreams = new Set(config.value.upstreams.filter(x => x.kind === 'zcode').map(x => x.id));
  const models = [...new Set(config.value.routes.flatMap(x => x.targets.filter(t => upstreams.has(t.upstreamId)).map(t => t.model)))].sort();
  if (!models.length) throw Error('Import the current account entitlement model directory into this plugin before setup');
  const bun = run(options.bunCommand ?? 'bun', ['-p', 'process.execPath']).trim();
  if (!path.isAbsolute(bun) || !fs.existsSync(bun)) throw Error('--bun did not resolve an absolute Bun executable');
  const folder = path.join(config.dataDir, 'zcode-standard-proxy');
  const runtime = path.join(folder, 'runtime'), marker = path.join(runtime, '.credit-hub-reference.json');
  const privateFile = path.join(folder, 'bridge-private.json');
  const prior = fs.existsSync(privateFile) ? JSON.parse(fs.readFileSync(privateFile, 'utf8')) : null;
  if (prior && (typeof prior.localKey !== 'string' || prior.localKey.length < 32)) throw Error('Existing local bridge key is invalid');
  const port = Number(options.port ?? prior?.port ?? await choosePort());
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('--port must be an integer from 1024 through 65535');
  fs.mkdirSync(folder, {recursive: true});
  if (!fs.existsSync(marker)) {
    if (fs.existsSync(runtime)) throw Error('Existing runtime has no plugin installer provenance; preserve it and use a clean plugin data directory');
    if (options.sourceDir) {
      const source = path.resolve(options.sourceDir);
      if (run('git', ['-C', source, 'rev-parse', 'HEAD']).trim() !== reference.commit) throw Error('--source is not the pinned reference commit');
      run('git', ['-C', source, 'diff', '--quiet', 'HEAD', '--']);
      const files = run('git', ['-C', source, 'ls-tree', '-rz', '--name-only', reference.commit]).split('\0').filter(Boolean);
      fs.mkdirSync(runtime, {recursive: true});
      for (const file of files) {
        const from = path.join(source, file), to = path.join(runtime, file);
        if (!fs.lstatSync(from).isFile()) throw Error('Pinned source contains a non-regular file');
        fs.mkdirSync(path.dirname(to), {recursive: true});
        fs.copyFileSync(from, to);
      }
    } else {
      run('git', ['clone', '--no-checkout', reference.repository, runtime]);
      run('git', ['-C', runtime, 'checkout', '--detach', reference.commit]);
      if (run('git', ['-C', runtime, 'rev-parse', 'HEAD']).trim() !== reference.commit) throw Error('Reference checkout mismatch');
    }
    atomic(marker, JSON.stringify({commit: reference.commit, version: reference.version, installer: 'dsh-credit-hub'}) + '\n');
  }
  if (JSON.parse(fs.readFileSync(marker, 'utf8')).commit !== reference.commit) throw Error('Installed reference commit mismatch');
  const license = fs.readFileSync(path.join(runtime, 'LICENSE'), 'utf8').replace(/\r\n?/g, '\n');
  const expectedLicense = fs.readFileSync(path.join(integration, 'LICENSE.zcode-api'), 'utf8').replace(/\r\n?/g, '\n');
  if (license !== expectedLicense) throw Error('Pinned runtime complete LICENSE mismatch');
  const handler = path.join(runtime, 'src/proxy/handler.ts');
  const text = fs.readFileSync(handler, 'utf8').replace(/\r\n?/g, '\n');
  atomic(handler, text);
  if (digest(text) === reference.handlerSha256) run('git', ['apply', '--no-index', path.join(integration, 'upstream-response.patch')], {cwd: runtime});
  const patched = fs.readFileSync(handler, 'utf8').replace(/\r\n?/g, '\n');
  atomic(handler, patched);
  if (digest(patched) !== reference.patchedHandlerSha256) throw Error('Reference response-observer patch hash mismatch');
  run(bun, ['install', '--frozen-lockfile', '--ignore-scripts'], {cwd: runtime});
  run(bun, ['run', 'scripts/build-fork-worker.ts'], {cwd: runtime});
  const secret = {enabled: true, port, localKey: prior?.localKey ?? randomBytes(32).toString('base64url'), nativeAppVersion: appVersion};
  const bridge = path.join(folder, 'bridge.ts');
  const template = JSON.parse(fs.readFileSync(path.join(integration, 'config.example.json'), 'utf8'));
  atomic(bridge, fs.readFileSync(path.join(integration, 'bridge.ts')));
  atomic(path.join(folder, 'config.json'), JSON.stringify({...template, defaultModel: models[0], models, server: {host: '127.0.0.1', port}, identity: {...template.identity, appVersion}}, null, 2) + '\n');
  atomic(privateFile, JSON.stringify(secret) + '\n');
  atomic(path.join(folder, 'reference.json'), JSON.stringify(reference, null, 2) + '\n');
  const local = {enabled: true, baseUrl: 'http://127.0.0.1:' + port + '/v1/chat/completions', localKey: secret.localKey, launch: {command: bun, script: bridge}};
  const runtimeFile = path.join(folder, 'runtime.json');
  atomic(runtimeFile, JSON.stringify(local) + '\n');
  return {models, runtime: folder, runtimeFile, referenceCommit: reference.commit, restartRequired: true, generationRequests: 0, claimRequests: 0, keyPrinted: false};
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const result = await setupZcodeStandardProxy(parseSetupArgs(process.argv.slice(2)));
  console.log('ZCODE_STANDARD_PROXY_SETUP_OK models=' + result.models.join(',') + ' reference=' + result.referenceCommit + ' restart_required=true generation_calls=0 claim_calls=0 key_printed=false');
}

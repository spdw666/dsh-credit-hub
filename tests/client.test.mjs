import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

async function loadClient() {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../client/index.jsx', import.meta.url))], bundle: true, platform: 'browser', format: 'cjs', external: ['react', 'react/jsx-runtime'], write: false });
  const react = { createElement: (type, props, ...children) => ({ type, props, children }), useCallback: fn => fn, useEffect() {}, useId: () => 'hub-test', useRef: value => ({ current: value }), useState: value => [value, () => {}] };
  const module = { exports: {} };
  const styles = [];
  const sandbox = { module, exports: module.exports, require: () => react, document: { createElement: () => ({ dataset: {}, remove() { this.removed = true; } }), head: { append: element => styles.push(element) } }, console, setInterval, clearInterval, Date, Intl };
  vm.runInNewContext(result.outputFiles[0].text, sandbox, { filename: 'credit-hub-client.bundle.cjs' });
  return { api: module.exports, styles };
}

test('client sends exact native Connection RPC route and named input', async () => {
  const { api } = await loadClient();
  const calls = [];
  const native = api.createCreditHubApi({ connection: { rpc: { async call(...args) {
    calls.push(args);
    // Exact installed Gateway.remoteRequest() payload shape, before business args.
    const payload = args[2];
    assert.equal(Object.keys(payload).join(','), 'args');
    assert.equal(typeof payload.args, 'object');
    assert.ok(payload.args && !Array.isArray(payload.args));
    return { ok: true, value: args[1].endsWith('/snapshot') ? { counts: { accounts: 2 } } : { status: 200, body: { saved: true } } };
  } } } });
  const snapshot = await native.snapshot();
  assert.equal(snapshot.counts.accounts, 2);
  const input = { method: 'POST', path: '/hub/routes', body: { routeId: 'SAMPLE', enabled: false } };
  await native.request(input);
  assert.equal(calls[0][0], '/api');
  assert.equal(calls[0][1], 'creditHub/snapshot');
  assert.equal(JSON.stringify(calls[0][2]), '{"args":{}}');
  assert.equal(calls[1][0], '/api');
  assert.equal(calls[1][1], 'creditHub/request');
  assert.equal(JSON.stringify(calls[1][2]), JSON.stringify({ args: { input } }));
});

test('client unwraps both transport and command errors without reporting success', async () => {
  const { api } = await loadClient();
  const transport = api.createCreditHubApi({ connection: { rpc: { call: async () => ({ ok: false, error: { message: 'SAMPLE transport error' } }) } } });
  await assert.rejects(transport.snapshot(), /SAMPLE transport error/);
  const command = api.createCreditHubApi({ connection: { rpc: { call: async () => ({ ok: true, value: { status: 409, body: { message: 'SAMPLE conflict' } } }) } } });
  await assert.rejects(command.request({ method: 'POST', path: '/hub/routes' }), /SAMPLE conflict/);
});

test('apply registers native sidebar, keyed main panel, settings and reversible styles; no upstream I/O', async () => {
  const { api, styles } = await loadClient();
  const registrations = [];
  const disposers = [];
  let calls = 0;
  let selected = 'credit-hub';
  const ctx = {
    effect(fn) { const dispose = fn(); if (dispose) disposers.push(dispose); },
    connection: { rpc: { call() { calls++; throw new Error('activation must not call upstream'); } } },
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId: selected }) }, selectPanel: value => { selected = value; } },
    slots: { inject(slot, fn) { return fn(); }, register(options, render) { registrations.push({ options, render }); return () => {}; } },
  };
  api.apply(ctx);
  assert.equal(calls, 0);
  assert.equal(registrations.length, 3);
  const main = registrations.find(entry => entry.options.name === 'main');
  assert.equal(main.options.key, 'credit-hub');
  const row = registrations.find(entry => entry.options.name === 'sidebar.panellist');
  assert.equal(row.options.id, 'credit-hub');
  assert.equal(row.options.label(), '积分中枢');
  const settings = registrations.find(entry => entry.options.name === 'settings.section');
  assert.equal(settings.options.id, 'credit-hub');
  assert.equal(settings.options.label(), '积分中枢');
  assert.equal(main.render().type, api.HubView);
  assert.equal(settings.render({}).type, api.HubView);
  assert.equal(styles.length, 1);
  assert.match(styles[0].textContent, /--dsw-alias-bg-base/);
  for (const dispose of disposers.reverse()) dispose();
  assert.equal(selected, null);
  assert.equal(styles[0].removed, true);
});

test('management uses native React components, scoped host tokens, six tabs and no iframe/direct fetch', async () => {
  const source = await readFile(new URL('../client/index.jsx', import.meta.url), 'utf8');
  for (const label of ['账户', '模型路由', '签到任务', '用量记录', '接力策略', '设置']) assert.ok(source.includes(label));
  assert.doesNotMatch(source, /<iframe|\bfetch\s*\(/i);
  assert.ok(source.includes("'/hub/accounts'"));
  assert.ok(source.includes("'/hub/routes'"));
  assert.ok(source.includes("'/hub/scheduler'"));
  assert.ok(source.includes('inferenceEnabled'));
});

test('account generation rejects stale refresh/submit/cancel responses, including A-B-A and unmount', async () => {
  const { api } = await loadClient();
  const guard = api.createAccountResponseGuard('account-A');
  let resolveRefresh, resolveSubmit, resolveCancel;
  const response = new Promise(resolve => { resolveRefresh = resolve; });
  const submission = new Promise(resolve => { resolveSubmit = resolve; });
  const cancellation = new Promise(resolve => { resolveCancel = resolve; });
  const commits = [];
  const refreshCurrent = guard.capture(), submitCurrent = guard.capture(), cancelCurrent = guard.capture();
  const refresh = response.then(value => { if (refreshCurrent()) commits.push(value); });
  const submit = submission.then(value => { if (submitCurrent()) commits.push(value); });
  const cancel = cancellation.then(value => { if (cancelCurrent()) commits.push(value); });
  guard.select('account-B');
  const accountB = guard.capture();
  resolveRefresh('stale-A-refresh'); resolveSubmit('stale-A-submit'); resolveCancel('stale-A-cancel');
  await Promise.all([refresh, submit, cancel]);
  assert.deepEqual(commits, []);
  assert.equal(accountB(), true);
  guard.select('account-A');
  assert.equal(refreshCurrent(), false);
  assert.equal(submitCurrent(), false);
  assert.equal(cancelCurrent(), false);
  assert.equal(accountB(), false);
  const freshA = guard.capture();
  assert.equal(freshA(), true);
  guard.dispose();
  assert.equal(freshA(), false);
  guard.select('account-A');
  assert.equal(freshA(), false);
  assert.equal(guard.capture()(), true);
});

test('narrow settings panels use container width and retain readable table identities', async () => {
  const css = await readFile(new URL('../client/styles.js', import.meta.url), 'utf8');
  assert.match(css, /container-name:\s*credit-hub;\s*container-type:\s*inline-size/);
  assert.match(css, /@container credit-hub \(max-width: 680px\)/);
  assert.match(css, /credit-hub__tabs \{ flex-wrap: wrap; overflow: visible/);
  assert.match(css, /min-width: 150px; width: 185px/);
  assert.match(css, /min-width: 660px/);
});

test('enabled accounts do not imply connected: independent setup and snapshot requirements stay explicit', async () => {
  const { api } = await loadClient();
  assert.equal(api.accountConnectionLabel({ enabled: true, setupRequired: true, connectionState: 'setup_required' }), '待独立配置');
  assert.equal(api.accountConnectionLabel({ enabled: true, connectionState: 'snapshot_required' }), '待凭据快照');
  assert.equal(api.accountConnectionLabel({ enabled: true, snapshotReady: true, connectionState: 'not_checked' }), '未核验');
  assert.equal(api.accountConnectionLabel({ enabled: true }), '未核验');
});

test('row action checkbox names include account or route identity', async () => {
  const source = await readFile(new URL('../client/index.jsx', import.meta.url), 'utf8');
  assert.match(source, /aria-label=\{ariaLabel\}/);
  assert.match(source, /ariaLabel=\{`\$\{account\.label[\s\S]*? · 模型调用`\}/);
  assert.match(source, /ariaLabel=\{`\$\{account\.label[\s\S]*? · 账户状态`\}/);
  assert.match(source, /ariaLabel=\{`\$\{route\.name \|\| route\.id\} · 路由启用`\}/);
});

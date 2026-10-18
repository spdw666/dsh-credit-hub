import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const entry = fileURLToPath(new URL('../client/operations.jsx', import.meta.url));
let bundled;
const plain = value => JSON.parse(JSON.stringify(value));
async function client() {
  bundled ??= build({ entryPoints: [entry], bundle: true, platform: 'browser', format: 'cjs', external: ['react'], write: false });
  const result = await bundled, hooks = [], effects = [], cleanups = [];
  let cursor = 0, dirty = false;
  const hook = (kind, init) => { const index = cursor++; if (!hooks[index]) hooks[index] = { kind, value: init() }; assert.equal(hooks[index].kind, kind); return [hooks[index], index]; };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false) }),
    Fragment: 'fragment',
    useState(initial) { const [state] = hook('state', () => typeof initial === 'function' ? initial() : initial); return [state.value, value => { const next = typeof value === 'function' ? value(state.value) : value; if (!Object.is(next, state.value)) { state.value = next; dirty = true; } }]; },
    useRef(value) { return hook('ref', () => ({ current: value }))[0].value; },
    useId() { return hook('id', () => `operations-test-${cursor}`)[0].value; },
    useEffect(fn, deps) {
      const [state, index] = hook('effect', () => ({ deps: null }));
      if (!state.value.deps || deps.some((dep, i) => !Object.is(dep, state.value.deps[i]))) { state.value.deps = deps; effects.push(() => { cleanups[index]?.(); cleanups[index] = fn(); }); }
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: () => react, URL, Intl, Date, console }, { filename: 'operations-client.cjs' });
  const expand = node => {
    if (node === null || node === undefined || node === false) return null;
    if (typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.flatMap(item => [expand(item)]).filter(Boolean);
    if (typeof node.type === 'function') return expand(node.type({ ...node.props, children: node.children }));
    return { ...node, children: node.children.flatMap(item => { const child = expand(item); return Array.isArray(child) ? child : child === null ? [] : [child]; }) };
  };
  return {
    api: module.exports,
    render(Component, props) { let tree; for (let pass = 0; pass < 8; pass++) { dirty = false; cursor = 0; tree = expand(Component(props)); while (effects.length) effects.shift()(); if (!dirty) return tree; } throw new Error('Unstable hooks'); },
    unmount() { cleanups.forEach(cleanup => cleanup?.()); },
  };
}
function nodes(tree, predicate) { return !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...(tree.children || []).flatMap(child => nodes(child, predicate))]; }
function text(tree) { return tree === undefined || tree === null ? '' : typeof tree === 'object' ? (tree.children || []).map(text).join('') : String(tree); }
const button = (tree, label) => nodes(tree, node => node.type === 'button' && text(node) === label)[0];
const input = (tree, suffix) => nodes(tree, node => node.type === 'input' && String(node.props.id || '').endsWith(suffix))[0];
const initial = () => ({ enabled: true, nativeEnabled: true, webhookEnabled: false, webhookConfigured: false, credentialWarnDays: 7, balanceCredits: 100, balancePercent: 10, cooldownMinutes: 60, mappings: { 'checkin.failed': ['native'], 'update.available': ['native'] } });

test('operation generations reject stale edits, selection A-B-A and unmount responses', async () => {
  const { api } = await client(), guard = api.createOperationGuard('A');
  const a = guard.capture(); guard.select('B'); const b = guard.capture(); guard.select('A');
  assert.equal(a(), false); assert.equal(b(), false);
  const edited = guard.capture(); guard.change(); assert.equal(edited(), false);
  const current = guard.capture(); assert.equal(current(), true); guard.dispose(); assert.equal(current(), false);
  guard.select('A'); assert.equal(current(), false); assert.equal(guard.capture()(), true);
});

test('notification mapping uses exact routed event names and true backend units', async () => {
  const { api } = await client(), draft = initial(); draft.mappings['balance.low'] = ['native', 'im-team'];
  const result = plain(api.buildNotificationPatch(draft));
  assert.equal(result.events.credentialWarnDays, 7);
  assert.equal(result.events.cooldownSeconds, 3600);
  assert.deepEqual(result.events.balanceThreshold, { credits: 100, percent: 10 });
  assert.deepEqual(result.events.mappings['balance.low'], ['native', 'im-team']);
  assert.equal(Object.hasOwn(result.events, 'credentialExpiryDays'), false);
  assert.equal(Object.hasOwn(result.events, 'cooldownMinutes'), false);
  assert.deepEqual(Object.keys(result.events.mappings), ['checkin.failed', 'credential.expiring', 'balance.low', 'relay.triggered', 'request.failure_streak', 'update.available']);
});

test('saving native notifications does not introduce an invalid empty webhook or erase hidden URL/header', async () => {
  const { api } = await client(), draft = initial();
  assert.equal(Object.hasOwn(api.buildNotificationPatch(draft).events.sinks, 'webhook'), false);
  draft.webhookConfigured = true; draft.webhookEnabled = true;
  const result = api.buildNotificationPatch(draft, '   ');
  assert.deepEqual(plain(result.events.sinks.webhook), { kind: 'webhook', enabled: true });
  assert.equal(Object.hasOwn(result.events.sinks.webhook, 'url'), false);
  assert.equal(Object.hasOwn(result.events.sinks.webhook, 'headers'), false);
  const set = api.buildNotificationPatch(draft, 'https://hooks.example.test/notify?token=SAMPLE');
  assert.equal(set.events.sinks.webhook.url, 'https://hooks.example.test/notify?token=SAMPLE');
  assert.throws(() => api.buildNotificationPatch({ ...draft, credentialWarnDays: 91 }), /0–90/);
  assert.throws(() => api.buildNotificationPatch({ ...draft, balancePercent: 101 }), /0–100/);
  assert.throws(() => api.buildNotificationPatch({ ...draft, webhookConfigured: false }), /Webhook/);
  assert.throws(() => api.buildNotificationPatch(draft, 'http://remote.example.test/hook'), /HTTPS/);
});

test('update patch preserves hidden feed when blank, supports explicit clearing and validates real intervalHours', async () => {
  const { api } = await client(), draft = { enabled: true, repository: 'OWNER/REPO', feedUrl: '', intervalHours: .25 };
  const result = plain(api.buildUpdatePatch(draft));
  assert.deepEqual(result, { updates: { enabled: true, repository: 'OWNER/REPO', intervalHours: .25 } });
  assert.equal(Object.hasOwn(result.updates, 'feedUrl'), false);
  assert.equal(api.buildUpdatePatch({ ...draft, clearFeed: true }).updates.feedUrl, '');
    assert.equal(api.buildUpdatePatch({ ...draft, clearFeed: true, feedUrl: 'SAMPLE_INVALID' }).updates.feedUrl, '');
  assert.equal(api.buildUpdatePatch({ ...draft, feedUrl: 'https://releases.example.test/plugin.json?token=SAMPLE' }).updates.feedUrl, 'https://releases.example.test/plugin.json?token=SAMPLE');
  assert.throws(() => api.buildUpdatePatch({ ...draft, intervalHours: 0 }), /0.25–168/);
  assert.throws(() => api.buildUpdatePatch({ ...draft, repository: 'https://github.com/OWNER/REPO' }), /OWNER\/REPO/);
  assert.throws(() => api.buildUpdatePatch({ ...draft, feedUrl: 'http://releases.example.test/plugin.json' }), /HTTPS/);
});

test('release links omit sensitive query and fragment, reject credential-bearing or executable URLs', async () => {
  const { api } = await client();
  assert.equal(api.publicReleaseLink('https://releases.example.test/plugin?token=SAMPLE#SAMPLE'), 'https://releases.example.test/plugin');
  assert.equal(api.publicReleaseLink('https://SAMPLE:SECRET@releases.example.test/plugin'), null);
  assert.equal(api.publicReleaseLink('javascript:alert(1)'), null);
  assert.equal(api.publicReleaseLink(undefined), null);
});

test('window settings preserve overnight HH:MM, omit deleted overrides and never change scheduler enabled/hour', async () => {
  const { api } = await client();
  const patch = plain(api.buildSchedulerPatch({ windows: { workbuddy: { start: '23:50', end: '00:40' }, deleted: null }, maxConcurrency: '2', startupSpreadSeconds: '300', startup: true }));
  assert.deepEqual(patch, { windows: { workbuddy: { start: '23:50', end: '00:40' } }, maxConcurrency: 2, startupSpreadSeconds: 300, startup: true });
  assert.equal(Object.hasOwn(patch, 'enabled'), false);
  assert.equal(Object.hasOwn(patch, 'hour'), false);
  assert.throws(() => api.buildSchedulerPatch({ ...patch, maxConcurrency: 0 }), /并发/);
  assert.throws(() => api.buildSchedulerPatch({ ...patch, windows: { a: { start: '00:05', end: '00:05' } } }), /窗口/);
  assert.throws(() => api.buildSchedulerPatch({ ...patch, windows: { a: { start: '25:05', end: '00:40' } } }), /窗口/);
});

test('missing-account selection removes stale IDs and duplicate tasks, never sends empty IDs', async () => {
  const { api } = await client(), rows = [{ accountId: 'A' }, { accountId: 'A', task: 'another' }, { accountId: 'B' }, {}];
  assert.deepEqual(plain(api.missingAccountIds(rows, ['A', 'A', 'stale', '', 'B'])), ['A', 'B']);
  assert.deepEqual(plain(api.missingAccountIds(rows, [])), []);
});

test('forecast preserves unknown/zero distinction and does not silently cap impossible reserve advice', async () => {
  const { api } = await client();
  assert.equal(api.forecastHours(null), '数据不足'); assert.equal(api.forecastHours(undefined), '数据不足');
  assert.equal(api.forecastHours(0), '已到耗尽线'); assert.equal(api.forecastHours(.5), '约 30 分钟');
  assert.match(api.reserveSuggestionText({ reserveCredits: 120, reservePercent: null, unit: '积分' }), /总额度未知/);
  assert.match(api.reserveSuggestionText({ reserveCredits: 120, reservePercent: 60, unit: '积分', reserveReason: 'engine_reserve_percent_limit_50', canApplyReservePercent: false }), /60%.*50%/);
  assert.match(api.reserveSuggestionText({}), /样本不足或补充时间未知/);
});

test('discovery rendering distinguishes background running from an active scan and calls real connect endpoint', async () => {
  const fixture = await client(), calls = [], props = { snapshot: { operations: { discovery: { running: true, scanning: false, candidates: [{ id: 'one', platform: 'workbuddy', label: 'SAMPLE', status: 'imported', accountId: 'A', routeCount: 2, catalogStatus: 'ready' }, { id: 'two', platform: 'qoder', status: 'not_logged_in' }] }, settings: { discovery: { enabled: true, autoEnableRoutes: true, fetchModels: true, intervalSeconds: 60 } } } }, busy: false, perform: async (...args) => { calls.push(args); return true; } };
  const tree = fixture.render(fixture.api.DiscoveryPanel, props), scan = button(tree, '立即扫描并接入');
  assert.equal(scan.props.disabled, false); assert.match(text(tree), /后台发现运行中/); assert.match(text(tree), /已接入/); assert.match(text(tree), /等待客户端登录/);
  await scan.props.onClick(); assert.deepEqual(plain(calls[0][1]), { method: 'POST', path: '/hub/discovery', body: { connect: true } });
  const scanning = fixture.render(fixture.api.DiscoveryPanel, { ...props, snapshot: { ...props.snapshot, operations: { ...props.snapshot.operations, discovery: { ...props.snapshot.operations.discovery, scanning: true } } } });
  assert.equal(button(scanning, '正在扫描接入…').props.disabled, true);
});

test('discovery settings callback does not discard edits made while save is in flight', async () => {
  const fixture = await client(), calls = [], props = { snapshot: { operations: { settings: { discovery: { enabled: true, autoEnableRoutes: true, fetchModels: true, intervalSeconds: 60 } } } }, busy: false, perform: (...args) => { calls.push(args); return Promise.resolve(true); } };
  let tree = fixture.render(fixture.api.DiscoveryPanel, props);
  input(tree, '-interval').props.onChange({ target: { value: '120' } }); tree = fixture.render(fixture.api.DiscoveryPanel, props);
  await button(tree, '保存发现设置').props.onClick();
  assert.equal(calls[0][1].body.discovery.intervalSeconds, 120);
  input(tree, '-interval').props.onChange({ target: { value: '180' } });
  calls[0][2]({ status: 200, body: { saved: true } }); tree = fixture.render(fixture.api.DiscoveryPanel, props);
  assert.equal(input(tree, '-interval').props.value, '180'); assert.equal(button(tree, '保存发现设置').props.disabled, false);
  fixture.unmount(); assert.doesNotThrow(() => calls[0][2]({ status: 200 }));
});

test('forecast UI shows measured coverage and actual margin, recalculation does not mutate global relay', async () => {
  const fixture = await client(), calls = [], props = { snapshot: { operations: { forecast: { accounts: [{ accountId: 'A', label: 'SAMPLE', burnRatePerHour: 10, estimatedHours: 12, reserveCredits: 100, reservePercent: 20, canApplyReservePercent: true, reserveSafetyFactor: 1.25, unit: '积分', source: 'upstream_credits', coverage: { observedHours: 48, ratio: 2 / 7, measuredRows: 4, missingRows: 1 }, assumptions: ['SAMPLE 实测假设'] }, { accountId: 'B', label: 'Sparse', estimatedHours: null, coverage: { observedHours: 0, measuredRows: 0 }, status: 'insufficient_data' }] } } }, busy: false, perform: (...args) => { calls.push(args); } };
  const tree = fixture.render(fixture.api.ForecastPanel, props);
  assert.match(text(tree), /48 小时观测/); assert.match(text(tree), /4 个测量/); assert.match(text(tree), /1 条计费缺失/); assert.match(text(tree), /1.25/); assert.match(text(tree), /SAMPLE 实测假设/); assert.match(text(tree), /数据不足/);
  assert.equal(button(tree, '保存预测参数').props.disabled, true);
  button(tree, '重算本地预测').props.onClick(); assert.deepEqual(plain(calls[0][1]), { method: 'GET', path: '/hub/forecast' });
  assert.doesNotMatch(JSON.stringify(calls), /admin\/model-relay/);
});

test('forecast settings send only edited opaque account renewal IDs and explicit clears, never a relay mutation', async () => {
  const fixture = await client(), calls = [], accountId = 'account-aabbccddeeff', otherId = 'account-0123456789ab';
  const props = { snapshot: { operations: { forecast: { accounts: [{ accountId, label: 'SAMPLE' }] }, settings: { forecast: { safetyMultiplier: 1.25, renewAtByAccount: { [otherId]: '2030-01-01T00:00:00.000Z' } } } } }, busy: false, perform: (...args) => { calls.push(args); return Promise.resolve(true); } };
  let tree = fixture.render(fixture.api.ForecastPanel, props);
  const renewal = nodes(tree, node => node.type === 'input' && node.props.type === 'datetime-local')[0];
  assert.equal(renewal.props.value, ''); assert.equal(renewal.props.disabled, false);
  renewal.props.onChange({ target: { value: '2030-01-02T12:00' } }); tree = fixture.render(fixture.api.ForecastPanel, props);
  input(tree, '-safety').props.onChange({ target: { value: '1.5' } }); tree = fixture.render(fixture.api.ForecastPanel, props);
  await button(tree, '保存预测参数').props.onClick();
  assert.deepEqual(plain(calls[0][1]), { method: 'POST', path: '/hub/operations', body: { forecast: { safetyMultiplier: 1.5, renewAtByAccount: { [accountId]: new Date('2030-01-02T12:00').toISOString() } } } });
  assert.equal(Object.hasOwn(calls[0][1].body.forecast.renewAtByAccount, otherId), false);
  assert.match(text(tree), /不自动套用全局接力阈值/);
  button(tree, '清除续费时间').props.onClick(); tree = fixture.render(fixture.api.ForecastPanel, props);
  await button(tree, '保存预测参数').props.onClick();
  assert.equal(calls[1][1].body.forecast.renewAtByAccount[accountId], null);
  assert.doesNotMatch(JSON.stringify(calls), /model-relay|reservePercent|reserveCredits/);
});

test('forecast settings validate margin and real account handle without fabricating missing dates', async () => {
  const { api } = await client(), accountId = 'account-aabbccddeeff';
  assert.throws(() => api.buildForecastPatch({ safetyMultiplier: .9 }), /1–5/);
  assert.throws(() => api.buildForecastPatch({ safetyMultiplier: 1.25, renewAtByAccount: { 'internal-account': '2030-01-01' } }), /账号引用/);
  assert.throws(() => api.buildForecastPatch({ safetyMultiplier: 1.25, renewAtByAccount: { [accountId]: 'not-a-date' } }), /时间格式/);
  assert.equal(api.renewalInputValue(null), ''); assert.equal(api.renewalInputValue('not-a-date'), '');
  assert.deepEqual(plain(api.buildForecastPatch({ safetyMultiplier: 1.25, renewAtByAccount: {}, changedRenewalIds: [] })), { forecast: { safetyMultiplier: 1.25, renewAtByAccount: {} } });
});

test('notification UI never reflects URL or headers and does not claim empty sink delivered', async () => {
  const fixture = await client(), props = { snapshot: { operations: { events: { enabled: true, pending: 2, nativePending: 1, sinks: { native: { kind: 'native', enabled: true }, webhook: { kind: 'webhook', enabled: false, url: 'https://SAMPLE.invalid/?secret=SAMPLE', headers: { authorization: 'SAMPLE_SECRET' } } }, mappings: { 'checkin.failed': ['native'] } } } }, busy: false, perform() {} };
  const tree = fixture.render(fixture.api.NotificationSettings, props);
  assert.doesNotMatch(text(tree), /SAMPLE_SECRET|secret=SAMPLE/);
  assert.equal(input(tree, '-webhook').props.value, ''); assert.equal(input(tree, '-webhook').props.type, 'password');
  assert.match(input(tree, '-webhook').props.placeholder, /留空保留/);
  assert.match(text(tree), /等待投递 2/); assert.match(text(tree), /等待宿主接收 1/);
  assert.match(text(tree), /签到失败/); assert.match(text(tree), /连续 3 次失败/);
});

test('manual supplement requests current missing opaque account IDs, keeps missingOnly and bounded queue semantics', async () => {
  const fixture = await client(), calls = [], props = { snapshot: { accounts: [{ id: 'account-a', label: 'SAMPLE' }], schedule: { settings: { timezone: 'Asia/Shanghai', windows: {}, maxConcurrency: 2 }, status: { todayMissing: [{ accountId: 'account-a', platform: 'workbuddy', task: 'checkin', attemptedToday: true, status: 'failed', plannedAt: 1792335600000 }], todayAttempted: [{ accountId: 'account-a' }], queue: [], running: [] } } }, busy: false, perform: (...args) => { calls.push(args); return Promise.resolve(true); } };
  let tree = fixture.render(fixture.api.SchedulerControls, props);
  assert.match(text(tree), /今日已尝试，尚未成功/);
  await button(tree, '补签此账号').props.onClick(); assert.deepEqual(plain(calls[0][1]), { method: 'POST', path: '/hub/scheduler/manual', body: { accountIds: ['account-a'], missingOnly: true } });
  button(tree, '全选未签到账号').props.onClick(); tree = fixture.render(fixture.api.SchedulerControls, props);
  assert.equal(button(tree, '补签已选（1）').props.disabled, false);
  await button(tree, '补签全部未完成').props.onClick(); assert.deepEqual(plain(calls[1][1].body), { missingOnly: true });
  props.snapshot.schedule.status.todayMissing = [];
  tree = fixture.render(fixture.api.SchedulerControls, props);
  assert.match(text(tree), /今日没有待补签账号/); assert.equal(button(tree, '补签已选（1）'), undefined);
});

test('operations UI uses scoped existing components, local horizontal scroll and no direct upstream fetch', async () => {
  const source = await readFile(entry, 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|<iframe|localStorage|sessionStorage|innerHTML/);
  assert.match(source, /credit-hub__table-wrap/); assert.match(source, /role="region"/); assert.match(source, /tabIndex=\{0\}/);
  assert.match(source, /credit-hub__button--primary/); assert.match(source, /aria-label=/);
  assert.doesNotMatch(source, /style=\{|#[\da-fA-F]{6}\b/);
});

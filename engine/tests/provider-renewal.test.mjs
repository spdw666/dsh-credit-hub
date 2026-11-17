// provider-renewal.test.mjs — silent renewal for the two desktop platforms that really have a refresh token
// (LobsterAI: /api/auth/refresh, 30d access / 180d refresh; CodeBuddy: /v2/plugin/auth/token/refresh). Every
// network path goes through an injected fetchImpl; no real credentials, no ambient network.
//
// Contract pinned here (learned from live A/B probes and the official clients):
//  - the rotation is stored in a GATEWAY snapshot, never written back into lobsterai.sqlite / state.vscdb,
//    because overwriting the client's refresh token signs that client out;
//  - a terminal "re-login required" verdict (401/403 or 40100/40101, 12153) is never retried in a loop;
//  - a lost/ambiguous answer is retryable but NOT beforeSubmission (nothing was consumed for sure).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, writeFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {
  lobsterRefreshBody, refreshLobsterToken, chooseLobsterTokens, shouldRenewLobster,
  lobsterSnapshotPath, saveLobsterSnapshot, readLobsterSnapshot, LOBSTER_RENEW_LEAD_MS,
  LOBSTER_REFRESH_PATH,
} from '../src/provider-lobster.mjs';
import {
  buddyExpiryMs, jwtExpiryMs, refreshBuddyCredential, withBuddyTokens, shouldRenewBuddy,
  buddySnapshotPath, saveBuddySnapshot, readBuddySnapshot, BUDDY_REFRESH_PATH, BUDDY_RENEW_LEAD_MS,
  normalizeBuddyCredential, chooseBuddyCredential,
} from '../src/provider-buddy.mjs';
import {loomySessionExpiry, LOOMY_SESSION_TTL_MS} from '../src/provider-loomy.mjs';
import {CredentialManager} from '../src/credentials.mjs';
import {encryptTraeAuthValue} from '../src/trae-refresh.mjs';

const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json'}});
const jwt = (claims) => ['h', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.');
const now = Date.parse('2026-11-16T12:00:00Z');

// ------------------------------------------------------------------ LobsterAI

test('lobster: refresh body mirrors the official keyfrom envelope and omits empty identity fields', () => {
  const body = lobsterRefreshBody({refreshToken: 'rt', firstKeyfrom: 'official', latestKeyfrom: 'official', uuid: 'u-1', userId: '159991'});
  assert.deepEqual(body, {firstKeyfrom: 'official', latestKeyfrom: 'official', version: '0.1.0', uuid: 'u-1', userId: '159991', refreshToken: 'rt'});
  const minimal = lobsterRefreshBody({refreshToken: 'rt'});
  assert.equal('uuid' in minimal, false, 'empty uuid is omitted, never sent as an empty string');
  assert.equal('userId' in minimal, false);
  assert.equal(minimal.firstKeyfrom, 'official');
});

test('lobster: a successful rotation rotates both tokens and reports the new deadlines', async () => {
  let captured;
  const access = jwt({exp: now / 1000 + 30 * 86400}), refresh = jwt({exp: now / 1000 + 180 * 86400});
  const result = await refreshLobsterToken({refreshToken: 'old-rt', userId: '159991'}, {
    now: () => now,
    fetchImpl: async (url, init) => {
      captured = {url, init};
      return jsonResponse({code: 0, message: 'success', data: {accessToken: access, refreshToken: refresh, userId: 159991}});
    },
  });
  assert.equal(captured.url, 'https://lobsterai-server.youdao.com' + LOBSTER_REFRESH_PATH);
  assert.equal(captured.init.method, 'POST');
  assert.equal(JSON.parse(captured.init.body).refreshToken, 'old-rt');
  assert.equal(captured.init.headers.authorization, undefined, 'refresh is unauthenticated: no bearer header');
  assert.equal(result.accessToken, access);
  assert.equal(result.refreshToken, refresh);
  assert.equal(result.rotated, true);
  assert.equal(result.expiresAtMs, (now / 1000 + 30 * 86400) * 1000);
  assert.equal(result.refreshExpiresAtMs, (now / 1000 + 180 * 86400) * 1000);
});

test('lobster: a dead refresh token is terminal (loginRequired) and never a retry loop', async () => {
  await assert.rejects(
    refreshLobsterToken({refreshToken: 'dead'}, {now: () => now, fetchImpl: async () => jsonResponse({code: 40100, message: '登录已过期，请重新登录'}, 401)}),
    (error) => {assert.equal(error.code, 'lobster_refresh_login_required'); assert.equal(error.status, 401); assert.equal(error.loginRequired, true); assert.equal(error.retryable, undefined); return true;},
  );
  // 40101 is the same terminal class even when the transport reports 200.
  await assert.rejects(
    refreshLobsterToken({refreshToken: 'dead'}, {now: () => now, fetchImpl: async () => jsonResponse({code: 40101, message: 'session dead'})}),
    (error) => error.loginRequired === true,
  );
});

test('lobster: a lost answer is retryable but not beforeSubmission; a missing refresh token needs a login', async () => {
  await assert.rejects(
    refreshLobsterToken({refreshToken: 'rt'}, {now: () => now, fetchImpl: async () => jsonResponse({code: -1, message: '系统繁忙'}, 500)}),
    (error) => {assert.equal(error.code, 'lobster_refresh_unconfirmed'); assert.equal(error.retryable, true); assert.equal(error.beforeSubmission, undefined); return true;},
  );
  await assert.rejects(
    refreshLobsterToken({refreshToken: 'rt'}, {now: () => now, fetchImpl: async () => {throw new Error('ECONNRESET');}}),
    (error) => {assert.equal(error.code, 'lobster_refresh_unconfirmed'); assert.equal(error.retryable, true); return true;},
  );
  await assert.rejects(refreshLobsterToken({}, {now: () => now, fetchImpl: async () => jsonResponse({})}), (error) => error.loginRequired === true && error.status === 401);
});

test('lobster: renewal lead window and token-source precedence', () => {
  assert.equal(LOBSTER_RENEW_LEAD_MS, 7 * 24 * 3600 * 1000);
  assert.equal(shouldRenewLobster({expiresAtMs: now + LOBSTER_RENEW_LEAD_MS + 1000, now}), false);
  assert.equal(shouldRenewLobster({expiresAtMs: now + LOBSTER_RENEW_LEAD_MS - 1000, now}), true);
  assert.equal(shouldRenewLobster({expiresAtMs: null, now}), false, 'unknown expiry never triggers a speculative rotation');
  // A fresh desktop token with a later expiry beats a snapshot whose expiry is earlier (or unknown).
  assert.equal(chooseLobsterTokens({desktop: {accessToken: 'a', expiresAtMs: now + 5000}, snapshot: {accessToken: 's', expiresAtMs: now + 1000}, now}).source, 'desktop_sqlite_kv');
  assert.equal(chooseLobsterTokens({desktop: {accessToken: 'a', expiresAtMs: now + 5000}, snapshot: {accessToken: 's'}, now}).source, 'desktop_sqlite_kv');
  // The snapshot wins only when its expiry is strictly later than the desktop token's.
  assert.equal(chooseLobsterTokens({desktop: {accessToken: 'a', expiresAtMs: now + 1000}, snapshot: {accessToken: 's', expiresAtMs: now + 5000}, now}).source, 'gateway_snapshot');
  // A desktop token with no recoverable expiry never beats a snapshot with a known one.
  assert.equal(chooseLobsterTokens({desktop: {accessToken: 'a'}, snapshot: {accessToken: 's', expiresAtMs: now + 5000}, now}).source, 'gateway_snapshot');
  assert.equal(chooseLobsterTokens({desktop: {accessToken: ''}, snapshot: {accessToken: 's'}, now}).source, 'gateway_snapshot');
  assert.equal(chooseLobsterTokens({desktop: null, snapshot: null, now}).source, null);
  // Identity guard: a snapshot from a different principal never overrides a fresh desktop login, even when
  // its numeric expiry is later (account switch must not leak the old account's token).
  assert.equal(chooseLobsterTokens({desktop: {accessToken: 'a', expiresAtMs: now + 1000, principal: 'account-A'}, snapshot: {accessToken: 's', expiresAtMs: now + 2000, principal: 'account-B'}, now}).source, 'desktop_sqlite_kv');
});

test('lobster: a rotated snapshot outlives the desktop token, so the next resolve selects it and no renewal is due', () => {
  // Simulate: desktop still holds an (older) token; a rotation landed a later-expiring snapshot.
  const snapshot = {accessToken: 'rotated', refreshToken: 'rt2', expiresAtMs: now + 30 * 86400e3};
  const desktop = {accessToken: 'stale', expiresAtMs: now + 1000};
  const choice = chooseLobsterTokens({desktop, snapshot, now});
  assert.equal(choice.source, 'gateway_snapshot');
  assert.equal(choice.accessToken, 'rotated');
  // After that rotation the snapshot's expiry is far beyond the lead window → no renewal.
  assert.equal(shouldRenewLobster({expiresAtMs: choice.expiresAtMs, now}), false);
  assert.equal(shouldRenewLobster({expiresAtMs: desktop.expiresAtMs, now}), true, 'the stale desktop token alone would be renewed');
});

test('lobster: the snapshot round-trips and stays outside the desktop store', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lobster-renew-'));
  try {
    const file = lobsterSnapshotPath({dataDir: dir}, 'acct-1');
    assert.equal(file, join(dir, 'accounts', 'acct-1', 'lobster-session.json'));
    await saveLobsterSnapshot(file, {accessToken: 'a1', refreshToken: 'r1', expiresAtMs: now + 1000, refreshExpiresAtMs: now + 2000, userId: '159991', refreshedAt: new Date(now).toISOString()});
    const back = await readLobsterSnapshot(file);
    assert.equal(back.accessToken, 'a1');
    assert.equal(back.refreshToken, 'r1');
    assert.equal(back.managedBy, 'ai-credit-gateway');
    assert.equal(back.schemaVersion, 1);
    assert.equal(await readLobsterSnapshot(join(dir, 'missing.json')), null);
  } finally { await rm(dir, {recursive: true, force: true}); }
});

// ------------------------------------------------------------------ CodeBuddy

test('buddy: expiry accepts epoch seconds, millis, numeric strings and ISO dates', () => {
  assert.equal(buddyExpiryMs(now), now);
  assert.equal(buddyExpiryMs(now / 1000), now);
  assert.equal(buddyExpiryMs(String(now / 1000)), now);
  assert.equal(buddyExpiryMs(new Date(now).toISOString()), now);
  assert.equal(buddyExpiryMs(null), null);
  assert.equal(buddyExpiryMs('nonsense'), null);
  assert.equal(jwtExpiryMs(jwt({exp: now / 1000})), now);
  assert.equal(jwtExpiryMs('not-a-jwt'), null);
});

test('buddy: the refresh token stored by the IDE is kept, not dropped while normalizing', () => {
  const credential = normalizeBuddyCredential({auth: {accessToken: jwt({exp: now / 1000}), refreshToken: 'rt-1', refreshExpiresAt: now + 86400e3, domain: 'www.codebuddy.cn'}, account: {uid: 'u-1'}});
  assert.equal(credential.refreshToken, 'rt-1');
  assert.equal(credential.refreshTokenPresent, true);
  assert.equal(credential.refreshExpiresAtMs, now + 86400e3);
  assert.equal(credential.expiresAtMs, now);
  const legacy = normalizeBuddyCredential({auth: {accessToken: jwt({exp: now / 1000}), domain: 'www.codebuddy.cn'}, account: {uid: 'u-1'}});
  assert.equal(legacy.refreshTokenPresent, false, 'an access-only credential stays honest about renewal');
});

test('buddy: refresh sends the IDE header set and rotates both tokens', async () => {
  let captured;
  const access = jwt({exp: now / 1000 + 28 * 86400}), rotated = 'rt-2';
  const result = await refreshBuddyCredential({accessToken: 'old', refreshToken: 'rt-1', uid: 'u-1', domain: 'www.codebuddy.cn'}, {
    now: () => now,
    fetchImpl: async (url, init) => { captured = {url, init}; return jsonResponse({code: 0, msg: 'OK', data: {accessToken: access, refreshToken: rotated, expiresIn: 2419200, refreshExpiresIn: 2591999}}); },
  });
  assert.equal(captured.url, 'https://www.codebuddy.cn' + BUDDY_REFRESH_PATH);
  assert.equal(captured.init.headers['X-Refresh-Token'], 'rt-1');
  assert.equal(captured.init.headers['X-Auth-Refresh-Source'], 'ide-main');
  assert.equal(captured.init.headers['X-Domain'], 'www.codebuddy.cn');
  assert.equal(captured.init.method, 'POST');
  assert.equal(result.accessToken, access);
  assert.equal(result.refreshToken, rotated);
  assert.equal(result.rotated, true);
  assert.equal(result.expiresAtMs, (now / 1000 + 28 * 86400) * 1000);
  assert.equal(withBuddyTokens({accessToken: 'old', principal: 'u-1'}, result).accessToken, access);
});

test('buddy: terminal failures and lost answers are separated', async () => {
  await assert.rejects(
    refreshBuddyCredential({accessToken: 'a', refreshToken: 'r', uid: 'u', domain: 'www.codebuddy.cn'}, {now: () => now, fetchImpl: async () => jsonResponse({code: 12153, msg: 'refresh token failed'}, 401)}),
    (error) => {assert.equal(error.code, 'provider_refresh_login_required'); assert.equal(error.loginRequired, true); return true;},
  );
  await assert.rejects(
    refreshBuddyCredential({accessToken: 'a', refreshToken: 'r', uid: 'u', domain: 'www.codebuddy.cn'}, {now: () => now, fetchImpl: async () => jsonResponse({code: 500, msg: 'busy'}, 502)}),
    (error) => {assert.equal(error.code, 'provider_refresh_unconfirmed'); assert.equal(error.retryable, true); assert.equal(error.beforeSubmission, undefined); return true;},
  );
  await assert.rejects(
    refreshBuddyCredential({accessToken: 'a', uid: 'u', domain: 'www.codebuddy.cn'}, {now: () => now, fetchImpl: async () => jsonResponse({})}),
    (error) => error.loginRequired === true,
  );
});

test('buddy: lead window, snapshot path and round-trip', async () => {
  assert.equal(BUDDY_RENEW_LEAD_MS, 3 * 24 * 3600 * 1000);
  assert.equal(shouldRenewBuddy({expiresAtMs: now + BUDDY_RENEW_LEAD_MS - 1, now}), true);
  assert.equal(shouldRenewBuddy({expiresAtMs: now + BUDDY_RENEW_LEAD_MS + 1, now}), false);
  const dir = await mkdtemp(join(tmpdir(), 'buddy-renew-'));
  try {
    const file = buddySnapshotPath({dataDir: dir}, 'acct-2');
    assert.equal(file, join(dir, 'accounts', 'acct-2', 'buddy-session.json'));
    await saveBuddySnapshot(file, {accessToken: 'a2', refreshToken: 'r2', expiresAtMs: now, uid: 'u-1', domain: 'www.codebuddy.cn'});
    const back = await readBuddySnapshot(file);
    assert.equal(back.accessToken, 'a2');
    assert.equal(back.uid, 'u-1');
    assert.equal(back.managedBy, 'ai-credit-gateway');
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('buddy: chooseBuddyCredential honours the same strict-later expiry rule and reports a clean source', () => {
  assert.equal(chooseBuddyCredential({desktop: {accessToken: 'd', expiresAtMs: now + 5000}, snapshot: {accessToken: 's', expiresAtMs: now + 1000}, now}).source, 'desktop');
  assert.equal(chooseBuddyCredential({desktop: {accessToken: 'd', expiresAtMs: now + 1000}, snapshot: {accessToken: 's', expiresAtMs: now + 5000}, now}).source, 'gateway_snapshot');
  assert.equal(chooseBuddyCredential({desktop: {accessToken: 'd'}, snapshot: {accessToken: 's', expiresAtMs: now + 5000}, now}).source, 'gateway_snapshot');
  assert.equal(chooseBuddyCredential({desktop: {accessToken: 'd', expiresAtMs: now + 5000}, snapshot: {accessToken: 's'}, now}).source, 'desktop');
  assert.equal(chooseBuddyCredential({desktop: null, snapshot: {accessToken: 's', expiresAtMs: now + 5000}, now}).source, 'gateway_snapshot');
  assert.equal(chooseBuddyCredential({desktop: {accessToken: 'd', expiresAtMs: now + 5000}, snapshot: null, now}).source, 'desktop');
  assert.equal(chooseBuddyCredential({desktop: null, snapshot: null, now}).source, null);
  // Identity guard: a snapshot from a different uid never overrides a fresh desktop login, even when its
  // numeric expiry is later (account switch must not leak the old account's token).
  assert.equal(chooseBuddyCredential({desktop: {accessToken: 'd', expiresAtMs: now + 1000, uid: 'account-A'}, snapshot: {accessToken: 's', expiresAtMs: now + 2000, uid: 'account-B'}, now}).source, 'desktop');
});

test('buddy: a rotated snapshot outlives the desktop token, so the next resolve selects it and no renewal is due', () => {
  const snapshot = {accessToken: 'rotated', refreshToken: 'rt2', expiresAtMs: now + 30 * 86400e3, uid: 'u-1', domain: 'www.codebuddy.cn'};
  const desktop = {accessToken: 'stale', expiresAtMs: now + 1000};
  const choice = chooseBuddyCredential({desktop, snapshot, now});
  assert.equal(choice.source, 'gateway_snapshot');
  assert.equal(choice.snapshot.accessToken, 'rotated');
  assert.equal(shouldRenewBuddy({expiresAtMs: choice.expiresAtMs, now}), false);
  assert.equal(shouldRenewBuddy({expiresAtMs: desktop.expiresAtMs, now}), true, 'the stale desktop token alone would be renewed');
});

// ------------------------------------------------------------------ LobsterAI integration: real renewDesktopSession

test('lobster: renewDesktopSession rotates into the snapshot, cleans its lock, and the next read selects the snapshot without a renewal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lobster-integration-'));
  try {
    // 1. A real desktop SQLite store: an old (expired) access token + refresh token, and an auth_user row
    //    that carries the stable identity (yid). No JWT exp on the old token → its expiry is unknown.
    const dbPath = join(dir, 'lobsterai.sqlite');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)');
    const insert = db.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)');
    insert.run('auth_tokens', JSON.stringify({accessToken: 'old-access', refreshToken: 'old-refresh'}), 1);
    insert.run('auth_user', JSON.stringify({yid: 'fixture-account-id-987654321', nickname: 'FixtureUser', accountMode: 'personal'}), 1);
    db.close();

    const account = {id: 'lb', platform: 'lobster', credentials: {kind: 'file', file: dbPath}};
    const config = {dataDir: dir, value: {accounts: [account]}, path: (x) => x};
    const ledger = {bind: (id, platform, principal) => ({ok: true, fingerprint: 'fp:' + principal})};
    const manager = new CredentialManager(config, ledger);
    // The refresh request body names the refresh token it rotated FROM; C1 required that the second
    // renewal use the snapshot's RT1, never the desktop DB's stale RT0.
    const seenRefreshTokens = [];
    manager.fetch = async (_url, init) => {
      const rt = JSON.parse(init.body).refreshToken;
      seenRefreshTokens.push(rt);
      return rt === 'old-refresh'
        ? jsonResponse({code: 0, message: 'success', data: {accessToken: 'new-access-1', refreshToken: 'new-refresh-1', expiresIn: 2592000, userId: 'fixture-user'}})
        : jsonResponse({code: 0, message: 'success', data: {accessToken: 'new-access-2', refreshToken: 'new-refresh-2', expiresIn: 2592000, userId: 'fixture-user'}});
    };

    // 2. Rotate through the real renewDesktopSession path (the code path that previously crashed with
    //    `ReferenceError: rotated is not defined`).
    const result = await manager.renewDesktopSession(account, {trigger: 'schedule'});
    assert.equal(result.accessToken, 'new-access-1');
    assert.equal(result.refreshToken, 'new-refresh-1');
    assert.ok(result.principal, 'renewed credential must carry a stable principal');
    assert.equal(result.source, 'gateway_snapshot');

    // 3. The snapshot is persisted with a non-null principal, and the per-account lock is cleaned up.
    const snapFile = lobsterSnapshotPath(config, 'lb');
    const snap = await readLobsterSnapshot(snapFile);
    assert.equal(snap.accessToken, 'new-access-1');
    assert.equal(snap.refreshToken, 'new-refresh-1');
    assert.ok(snap.principal, 'snapshot principal must be non-empty');
    await assert.rejects(stat(snapFile + '.refresh.lock'), (e) => e.code === 'ENOENT');

    // 4. The next read selects the snapshot (its expiry is strictly later than the desktop token's unknown
    //    expiry) and no renewal is due within the lead window.
    const live = await manager.read(account);
    assert.equal(live.accessToken, 'new-access-1');
    assert.equal(live.source, 'gateway_snapshot');
    assert.ok(live.principal);
    assert.equal(shouldRenewLobster({expiresAtMs: live.expiresAtMs}), false);

    // 5. C1 regression: a SECOND renewal must rotate from the snapshot's RT1, not the desktop DB's stale RT0.
    const second = await manager.renewDesktopSession(account, {trigger: 'schedule'});
    assert.equal(second.accessToken, 'new-access-2');
    assert.equal(second.refreshToken, 'new-refresh-2');
    const snap2 = await readLobsterSnapshot(snapFile);
    assert.equal(snap2.accessToken, 'new-access-2');
    assert.equal(snap2.refreshToken, 'new-refresh-2');
    assert.deepEqual(seenRefreshTokens, ['old-refresh', 'new-refresh-1'], 'second renewal must send the snapshot RT, not the stale DB RT');
  } finally { await rm(dir, {recursive: true, force: true}); }
});

// ------------------------------------------------------------------ Trae (inline renewal through read())

test('trae: a cached expired credential re-routes through read() inline renewal instead of surfacing credential_expired', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'trae-renewal-'));
  try {
    const file = join(dir, 'storage.json');
    const account = {id: 'trae-1', platform: 'trae', edition: 'cn', credentials: {kind: 'desktop', file}};
    const config = {dataDir: dir, value: {accounts: [account]}, path: (x) => x};
    const ledger = {bind: () => ({ok: true, fingerprint: 'fp'})};
    const manager = new CredentialManager(config, ledger);

    // The refresh exchange is exercised through global fetch (refreshTraeToken uses it directly).
    let refreshCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      refreshCalls++;
      return new Response(JSON.stringify({Result: {Token: 'new-access', TokenExpireAt: Date.parse('2027-01-01T00:00:00Z'), RefreshToken: 'rt-1'}}), {status: 200, headers: {'content-type': 'application/json'}});
    };

    t.mock.timers.enable({apis: ['Date']});
    const T0 = Date.parse('2026-11-16T12:00:00Z');
    // A real Trae storage.json: the auth record is encrypted like the client stores it, and the identity
    // block carries a machine id + device id so readTraeIdentity can resolve.
    // The token is 30h out: farther than the 24h lead, so the first read caches it WITHOUT an eager renewal.
    const record2 = {token: 'old-access', refreshToken: 'rt-0', userId: 'trae-user', host: 'https://trae.example', expiredAt: T0 + 30 * 3600 * 1000};
    const doc2 = {
      'iCubeAuthInfo://icube.cloudide': encryptTraeAuthValue(JSON.stringify(record2)),
      'telemetry.machineId': 'machine-123',
      'telemetry.devDeviceId': 'device-456',
    };
    await writeFile(file, JSON.stringify(doc2));

    try {
      t.mock.timers.setTime(T0);
      const first = await manager.read(account);
      assert.equal(first.accessToken, 'old-access');
      assert.equal(refreshCalls, 0, 'a token 30h out must not renew eagerly');

      // 48h later the cached credential is expired but the file (and its fingerprint) is unchanged:
      // resolve() must re-route through read({renew:true})'s inline renewal, not surface credential_expired.
      t.mock.timers.setTime(T0 + 48 * 3600 * 1000);
      const second = await manager.resolve('trae-1');
      assert.equal(second.accessToken, 'new-access');
      assert.equal(refreshCalls, 1);
    } finally {
      globalThis.fetch = realFetch;
      t.mock.timers.reset();
    }
  } finally { await rm(dir, {recursive: true, force: true}); }
});

// ------------------------------------------------------------------ Loomy (no renewal exists)

test('loomy: session deadline is derived from updatedAt with the official 14-day TTL', () => {
  assert.equal(LOOMY_SESSION_TTL_MS, 1209600 * 1000);
  const state = loomySessionExpiry({updatedAt: new Date(now).toISOString()});
  assert.equal(state.expiresAtMs, now + LOOMY_SESSION_TTL_MS);
  assert.equal(state.renewable, false, 'Loomy has no refresh endpoint — never pretend otherwise');
  assert.equal(loomySessionExpiry({}).expiresAtMs, null);
});

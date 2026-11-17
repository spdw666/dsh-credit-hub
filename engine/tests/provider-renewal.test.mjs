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
import {mkdtemp, rm, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  lobsterRefreshBody, refreshLobsterToken, chooseLobsterTokens, shouldRenewLobster,
  lobsterSnapshotPath, saveLobsterSnapshot, readLobsterSnapshot, LOBSTER_RENEW_LEAD_MS,
  LOBSTER_REFRESH_PATH,
} from '../src/provider-lobster.mjs';
import {
  buddyExpiryMs, jwtExpiryMs, refreshBuddyCredential, withBuddyTokens, shouldRenewBuddy,
  buddySnapshotPath, saveBuddySnapshot, readBuddySnapshot, BUDDY_REFRESH_PATH, BUDDY_RENEW_LEAD_MS,
  normalizeBuddyCredential,
} from '../src/provider-buddy.mjs';
import {loomySessionExpiry, LOOMY_SESSION_TTL_MS} from '../src/provider-loomy.mjs';

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
  // The desktop database always wins while it holds a token: a fresh desktop login supersedes our rotation.
  assert.equal(chooseLobsterTokens({desktop: {accessToken: 'a'}, snapshot: {accessToken: 's'}, now}).source, 'desktop_sqlite_kv');
  assert.equal(chooseLobsterTokens({desktop: {accessToken: ''}, snapshot: {accessToken: 's'}, now}).source, 'gateway_snapshot');
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

// ------------------------------------------------------------------ Loomy (no renewal exists)

test('loomy: session deadline is derived from updatedAt with the official 14-day TTL', () => {
  assert.equal(LOOMY_SESSION_TTL_MS, 1209600 * 1000);
  const state = loomySessionExpiry({updatedAt: new Date(now).toISOString()});
  assert.equal(state.expiresAtMs, now + LOOMY_SESSION_TTL_MS);
  assert.equal(state.renewable, false, 'Loomy has no refresh endpoint — never pretend otherwise');
  assert.equal(loomySessionExpiry({}).expiresAtMs, null);
});

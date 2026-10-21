import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ClaimService} from '../src/claims.mjs';
import {Ledger} from '../src/store.mjs';
import {lobsterStatus, lobsterClaimCheckin} from '../src/provider-lobster.mjs';
import {loomyStatus, loomyClaim} from '../src/provider-loomy.mjs';

const secret = {accessToken: 'fixture-not-a-live-token', principal: 'fixture-principal', principalHash: 'fixture-principal'};
const json = (data, code = 0) => new Response(JSON.stringify({code, data}), {headers: {'content-type': 'application/json'}});
function lobsterFixture({lifecycleState = 'active', authenticated = true, offered = true, initiallyClaimed = false} = {}) {
  let claimed = initiallyClaimed, posts = 0;
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/slot')) return json({slotState: 'available', activity: {activityCode: 'fixture-daily', configRevision: 7}});
    if (path.endsWith('/context')) return json({lifecycleState, authenticated, state: {claimedToday: claimed, completed: false, rewardCredits: 100}, actions: !claimed && offered ? ['check_in'] : []});
    assert.equal(init.method, 'POST');
    assert.equal(path, '/api/client-activities/fixture-daily/actions/check_in');
    assert.equal(JSON.parse(init.body).configRevision, 7);
    posts++; claimed = true;
    return json({});
  };
  return {fetchImpl, posts: () => posts};
}
async function withClaim(platform, task, adapter, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'checkin-contract-'));
  const ledger = new Ledger(dir);
  const config = {value: {accounts: [{id: 'fixture-account', platform, enabled: true, tasks: [{id: task, enabled: true}]}], scheduler: {timezone: 'Asia/Shanghai'}}};
  const service = new ClaimService(config, {resolve: async () => secret}, adapter, ledger);
  try { return await fn(service); } finally { ledger.close(); await rm(dir, {recursive: true, force: true}); }
}

test('Lobster status exposes active and credits to the generic scheduled claim contract', async () => {
  const fixture = lobsterFixture();
  const status = await lobsterStatus(secret, 'daily-checkin', fixture);
  assert.equal(status.known, true);
  assert.equal(status.claimable, true);
  assert.equal(status.active, true);
  assert.equal(status.credits, 100);
  assert.equal(fixture.posts(), 0);
});
for (const [name, state] of [['inactive', {lifecycleState: 'ended'}], ['login required', {authenticated: false}], ['no official action', {offered: false}]]) {
  test(`Lobster ${name} is not an automatic claim invitation`, async () => {
    const fixture = lobsterFixture(state);
    const status = await lobsterStatus(secret, 'daily-checkin', fixture);
    assert.equal(status.active, false);
    assert.equal(status.claimable, false);
    await lobsterClaimCheckin(secret, 'daily-checkin', fixture);
    assert.equal(fixture.posts(), 0);
  });
}
test('Lobster scheduled ClaimService reaches official action, verifies state, and sends once', async () => {
  const fixture = lobsterFixture();
  await withClaim('lobster', 'daily-checkin', {
    status: () => lobsterStatus(secret, 'daily-checkin', fixture),
    claim: () => lobsterClaimCheckin(secret, 'daily-checkin', fixture),
  }, async service => {
    const first = await service.run('fixture-account', 'daily-checkin');
    assert.equal(first.status, 'success');
    assert.equal(first.serverConfirmed, true);
    assert.equal(first.credits, 100);
    assert.equal((await service.run('fixture-account', 'daily-checkin')).status, 'already');
    assert.equal(fixture.posts(), 1);
  });
});
for (const [platform, task, claim] of [['lobster', 'daily-checkin', lobsterClaimCheckin], ['loomy', 'pet-work', loomyClaim]]) {
  test(`${platform} preflight GET failure is marked before submission for scheduler retry`, async () => {
    let posts = 0;
    await assert.rejects(claim(secret, task, {fetchImpl: async (url, init) => {
      if (init.method === 'POST') posts++;
      throw new Error('fixture connection failed before action');
    }}), error => error.beforeSubmission === true && error.status >= 500);
    assert.equal(posts, 0);
  });
}
test('Loomy eligible pet-work also exposes active to scheduled ClaimService', async () => {
  let claimed = false, posts = 0;
  const options = {fetchImpl: async (url, init) => {
    if (init.method === 'POST') { posts++; claimed = true; }
    return json({businessDate: '2026-10-21', configVersion: 'fixture-version', reachedTierId: 'tier-1', claimedToday: claimed}, '000000');
  }};
  assert.equal((await loomyStatus(secret, 'pet-work', options)).active, true);
  await withClaim('loomy', 'pet-work', {status: () => loomyStatus(secret, 'pet-work', options), claim: () => loomyClaim(secret, 'pet-work', options)}, async service => {
    assert.equal((await service.run('fixture-account', 'pet-work')).status, 'success');
    assert.equal(posts, 1);
  });
});
for (const [name, reply, balance] of [
  ['missing receipt date', {dailyQuota: 5000, dailyBalance: 5000, currentBalance: 6000}, {dailyBalance: 5000, availableBalance: 6000}],
  ['stale receipt day', {dailyCycleDate: '2026-10-20', dailyQuota: 5000, dailyBalance: 5000, currentBalance: 6000}, {dailyBalance: 5000, availableBalance: 6000}],
  ['unmatched balance', {dailyCycleDate: '2026-10-21', dailyQuota: 5000, dailyBalance: 5000, currentBalance: 6000}, {dailyBalance: 4000, availableBalance: 5000}],
]) {
  test(`Loomy daily refresh does not report observed for ${name}`, async () => {
    const options = {now: '2026-10-21T04:00:00Z', fetchImpl: async (url, init) => json(init.method === 'POST' ? reply : balance, '000000')};
    const result = await loomyClaim({...secret, principal: 'fixture-' + name}, 'daily-quota', options);
    assert.equal(result.observed, false);
    assert.equal(result.dailyQuotaObserved, false);
    assert.equal(result.reason, 'daily_quota_receipt_unverified');
    assert.equal(result.claimed, false);
  });
}
test('Loomy daily refresh reports observation only for the same-day matched official receipt', async () => {
  const options = {now: '2026-10-21T04:00:00Z', fetchImpl: async (url, init) => json(init.method === 'POST'
    ? {dailyCycleDate: '2026-10-21', dailyQuota: 5000, dailyBalance: 5000, currentBalance: 6000}
    : {dailyBalance: 5000, availableBalance: 6000}, '000000')};
  const result = await loomyClaim({...secret, principal: 'fixture-valid'}, 'daily-quota', options);
  assert.equal(result.observed, true);
  assert.equal(result.dailyQuotaObserved, true);
  assert.equal(result.rechecked, true);
  assert.equal(result.claimed, false);
  assert.equal((await loomyStatus({...secret, principal: 'fixture-valid'}, 'daily-quota', options)).observed, true);
});

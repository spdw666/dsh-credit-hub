import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {EVENT_TYPES,createEventRouter} from '../server/events.mjs';

// N10: the event channel keeps exactly one credential notification per expiry — the
// seven-day one — and reuses the existing deduplication identity of that edge. The
// 3-day/1-day/already-expired steps are UI inlining only and must stay silent here.

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fixtureRoot=join(repo,'work','raccoon-oauth-events-tests');
const DAY=86400000;
const ACCOUNT='raccoon-oauth-0123456789ab';
const STATE_KEY='credit-hub:events:v1';

async function fixture(t){
  await mkdir(fixtureRoot,{recursive:true});
  const root=await mkdtemp(join(fixtureRoot,'events-'));
  const store=new Map();
  const ledger={get:key=>store.get(key),set:(key,value)=>{store.set(key,structuredClone(value));},unbind(){},record(){},finishUsage(){}};
  const deliveries=[];
  const settings={sinks:{native:{kind:'native',enabled:true}},mappings:{'credential.expiring':['native']}};
  const make=clock=>createEventRouter({
    ledger,
    settings,
    now:clock,
    onNativeEvent:event=>{deliveries.push(event);return {ack:true};}
  });
  t.after(async()=>{await rm(root,{recursive:true,force:true,maxRetries:5});});
  // status() intentionally exposes no outbox, so the durable record is the assertion
  // surface: this is exactly what a restarted worker would read back.
  const queued=()=>{const saved=ledger.get(STATE_KEY);return (saved?.outbox??[]).map(item=>item.event);};
  return {root,deliveries,make,queued};
}

const oauthRow=(expiresAtMs,extra={})=>({accountId:ACCOUNT,platform:'raccoon',authKind:'oauth_iam',source:'raccoon_oauth_loopback',expiresAtMs,...extra});
const accounts=[{id:ACCOUNT,platform:'raccoon',label:'小浣熊（网页授权）'}];

test('N10-A one expiry produces exactly one event no matter how often the scan repeats',async t=>{
  const f=await fixture(t);
  let clock=Date.parse('2026-06-01T00:00:00.000Z');
  const router=f.make(()=>clock);
  const expiry=clock+2*DAY; // inside the seven-day window
  for(let i=0;i<10;i++){
    router.evaluate({accounts,credentials:[oauthRow(expiry)]});
    clock+=60000; // ten consecutive minute scans of the very same expiry
  }
  const notices=f.queued().filter(event=>event.type==='credential.expiring');
  assert.equal(notices.length,1,'the seven-day notice must be emitted once, not once per scan');
  assert.equal(notices[0].data.reasonCode,'raccoon_oauth_expiring');
  assert.equal(notices[0].data.expiresAt,new Date(expiry).toISOString());
  await router.close();
});

test('N10-A eight days out is still silent, and crossing into seven days emits once',async t=>{
  const f=await fixture(t);
  let clock=Date.parse('2026-06-01T00:00:00.000Z');
  const router=f.make(()=>clock);
  const expiry=clock+8*DAY;
  router.evaluate({accounts,credentials:[oauthRow(expiry)]});
  assert.equal(f.queued().length,0,'eight days remaining is outside the single notification tier');
  clock+=1*DAY; // now exactly seven days remain
  router.evaluate({accounts,credentials:[oauthRow(expiry)]});
  const first=f.queued().filter(event=>event.type==='credential.expiring');
  assert.equal(first.length,1);
  // The 3-day, 1-day and expired steps are inline UI levels; they must not queue more.
  for(const days of [3,1,0]){
    clock=expiry-days*DAY;
    router.evaluate({accounts,credentials:[oauthRow(expiry)]});
  }
  const after=f.queued().filter(event=>event.type==='credential.expiring');
  assert.equal(after.length,1,'the 3/1/expired ladder belongs to status.renewalLevel, not to the event channel');
  await router.close();
});

test('N10-C the OAuth notice reuses the existing type and deduplication identity',async t=>{
  const f=await fixture(t);
  let clock=Date.parse('2026-06-01T00:00:00.000Z');
  const expiry=clock+2*DAY;
  const router=f.make(()=>clock);
  router.evaluate({accounts,credentials:[oauthRow(expiry)]});
    const [item]=f.queued().filter(event=>event.type==='credential.expiring');
  assert.ok(EVENT_TYPES.includes(item.type),'no new event type may be introduced for OAuth');
  assert.equal(EVENT_TYPES.length,6);
  // A second router over the same ledger must recognise the same edge: the
  // durability of the deduplication identity is what keeps restarts quiet.
  await router.close();
  const restarted=f.make(()=>clock);
  restarted.evaluate({accounts,credentials:[oauthRow(expiry)]});
  assert.equal(f.queued().filter(event=>event.type==='credential.expiring').length,1,'a restarted worker must not re-announce the same expiry');
  await restarted.close();
});

test('N10 the OAuth notice carries ceil days and never a fractional one',async t=>{
  const f=await fixture(t);
  let clock=Date.parse('2026-06-01T00:00:00.000Z');
  const router=f.make(()=>clock);
  // 1.2 days remaining: a floor would say 1, the UI ladder needs 2.
  router.evaluate({accounts,credentials:[oauthRow(clock+Math.round(1.2*DAY))]});
  const [item]=f.queued().filter(event=>event.type==='credential.expiring');
  assert.ok(item,'1.2 days remaining is inside the seven-day window');
  assert.equal(item.data.remainingDays,2);
  await router.close();
});

test('N10 a desktop credential keeps the pre-existing behaviour and warn-day setting',async t=>{
  const f=await fixture(t);
  let clock=Date.parse('2026-06-01T00:00:00.000Z');
  const router=f.make(()=>clock);
  const row={accountId:'account-desktop0001',platform:'raccoon',authKind:'native_bearer_token',source:'native_auth_file',expiresAtMs:clock+30*DAY,renewable:false};
  router.evaluate({accounts:[{id:'account-desktop0001',platform:'raccoon'}],credentials:[row]});
  assert.equal(f.queued().length,0,'a 30-day desktop credential is not yet inside the seven-day window');
  await router.close();
});

import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,rm,mkdir,open} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {CredentialManager} from '../src/credentials.mjs';

async function fixture(t,{expiresAt='2026-12-16T00:00:00Z',accessToken='dt-old',refreshToken='drt-old'}={}){
  const dir=await mkdtemp(join(tmpdir(),'qoder-renew-'));t.after(async()=>{await rm(dir,{recursive:true,force:true})});
  const file=join(dir,'private','qoder','creds.json');await mkdir(join(file,'..'),{recursive:true});
  await writeFile(file,JSON.stringify({edition:'global',accessToken,uid:'qo-uid',principal:'qo-uid',expiresAt,refreshToken,refreshTokenExpiresAt:'2027-11-11T00:00:00Z',machineId:'qo-machine',identity:{machineToken:'qo-mt',machineCode:'qo-mc',machineType:'qo-type'}}));
  const account={id:'qo',platform:'qoder',edition:'global',enabled:true,tasks:[{id:'daily-checkin',enabled:true}],credentials:{kind:'file',file}};
  const config={value:{accounts:[account]},dataDir:dir,path:x=>x};
  const manager=new CredentialManager(config,{bind:()=>({ok:true,fingerprint:'qo-fixture-hash'})});
  return {dir,file,account,config,manager};
}
const renewal=(accessToken,refreshToken)=>({accessToken,refreshToken,rotated:true,expiresAt:'2026-12-20T00:00:00Z',refreshTokenExpiresAt:'2027-11-20T00:00:00Z'});

test('Qoder renewal lead is decided by the snapshot expiry, never a fabricated level',async t=>{
  const {manager}=await fixture(t);
  const day=86400000;
  assert.equal(manager.shouldRenewQoder({refreshToken:'drt',expiresAtMs:Date.now()+6*day}),true);
  assert.equal(manager.shouldRenewQoder({refreshToken:'drt',expiresAtMs:Date.now()+8*day}),false);
  assert.equal(manager.shouldRenewQoder({refreshToken:'drt',expiresAt:new Date(Date.now()+6*day).toISOString()}),true);
  assert.equal(manager.shouldRenewQoder({expiresAtMs:Date.now()+8*day}),false);
  assert.equal(manager.shouldRenewQoder({refreshToken:'drt',expiresAt:'not-a-date'}),false);
});

test('Qoder renewal rotates the snapshot in place and keeps identity fields',async t=>{
  const {file,account,manager}=await fixture(t);
  manager.qoderRefresh=async()=>renewal('dt-new','drt-new');
  const c=await manager.renewQoder(account,{trigger:'schedule'});
  assert.equal(c.accessToken,'dt-new');
  const written=JSON.parse(await readFile(file,'utf8'));
  assert.equal(written.accessToken,'dt-new');assert.equal(written.refreshToken,'drt-new');
  assert.equal(written.expiresAt,'2026-12-20T00:00:00Z');assert.equal(written.renewalSource,'deviceToken_refresh_api');
  assert.deepEqual(written.identity,{machineToken:'qo-mt',machineCode:'qo-mc',machineType:'qo-type'});assert.equal(written.machineId,'qo-machine');
  const row=manager.renewalState('qo');assert.equal(row?.ok,true);assert.equal(row?.rotated,true);assert.equal(row?.trigger,'schedule');
});

test('Qoder expired snapshot is renewed by resolve() before failing the caller',async t=>{
  const {file,account,manager}=await fixture(t,{expiresAt:'2020-01-01T00:00:00Z'});
  manager.qoderRefresh=async()=>renewal('dt-healed','drt-healed');
  const c=await manager.resolve('qo');
  assert.equal(c.accessToken,'dt-healed');
  const written=JSON.parse(await readFile(file,'utf8'));assert.equal(written.accessToken,'dt-healed');assert.equal(written.refreshToken,'drt-healed');
});

test('Qoder renewal without a refresh token asks for a login and never writes',async t=>{
  const {file,account,manager}=await fixture(t);
  const before=await readFile(file,'utf8');
  await rm(file).catch(()=>{});
  await assert.rejects(manager.renewQoder(account),{code:'qoder_refresh_login_required'});
  await writeFile(file,JSON.stringify({edition:'global',accessToken:'dt-old',uid:'qo-uid',expiresAt:'2026-12-16T00:00:00Z',machineId:'qo-machine',identity:{machineToken:'qo-mt',machineCode:'qo-mc',machineType:'qo-type'}}));
  await assert.rejects(manager.renewQoder(account),{code:'qoder_refresh_login_required'});
  assert.equal(manager.renewalState('qo'),null);
});

test('Qoder renewal is exclusive: a held lock reports pending, a concurrent login wins the write',async t=>{
  const {file,account,manager}=await fixture(t);
  let lock;try{lock=await open(file+'.refresh.lock','wx',0o600);}catch{throw new Error('lock precondition failed')}
  try{await assert.rejects(manager.renewQoder(account),{code:'qoder_refresh_pending'});}finally{await lock.close();await rm(file+'.refresh.lock')}
  manager.qoderRefresh=async()=>{await writeFile(file,JSON.stringify({edition:'global',accessToken:'concurrent-login',uid:'qo-uid',principal:'qo-uid',expiresAt:'2026-12-16T00:00:00Z',refreshToken:'drt-other',refreshTokenExpiresAt:'2027-11-11T00:00:00Z',machineId:'qo-machine',identity:{machineToken:'qo-mt',machineCode:'qo-mc',machineType:'qo-type'}}));return renewal('dt-would-overwrite','drt-would-overwrite')};
  const c=await manager.renewQoder(account,{trigger:'schedule'});
  assert.equal(c.accessToken,'concurrent-login');
  assert.equal(JSON.parse(await readFile(file,'utf8')).accessToken,'concurrent-login');
});

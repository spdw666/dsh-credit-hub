import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {
  raccoonResolve,
  readRaccoonNativeAuth,
  readRaccoonOAuthAuth,
  raccoonCredentialView,
  raccoonRemainingDays,
  raccoonRenewalLevel,
  refreshRaccoonAuth,
  raccoonProvider,
} from '../src/provider-raccoon.mjs';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const digest=value=>createHash('sha256').update(value).digest('hex');
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt=claims=>'SAMPLEHEADER.'+b64(claims)+'.SAMPLESIGNATURE';
const DAY=86400000;

async function fixture(t,{claims={name:'raccoon-test',sub:'SAMPLE_SUB'},access=null,expiresAt=null,authKind='oauth_iam'}={}){
  const dir=join(project,'work/raccoon-oauth-provider-tests',randomUUID());
  await mkdir(dir,{recursive:true});
  t.after(async()=>{await rm(dir,{recursive:true,force:true,maxRetries:5});});
  const expires=expiresAt??Date.now()+30*DAY;
  const token=access??jwt({...claims,exp:Math.floor(expires/1000)});
  const file=join(dir,'raccoon-oauth-0123456789ab.json');
  const document={schemaVersion:1,authKind,source:'raccoon_oauth_loopback',obtainedAt:new Date().toISOString(),acquiredVia:'loopback',identity:{sub:claims.sub??null},access_token:token,refresh_token:'SAMPLE_REFRESH_TOKEN',accessExpiresAt:new Date(expires).toISOString(),expiresAt:new Date(expires).toISOString()};
  await writeFile(file,JSON.stringify(document,null,2),{mode:0o600});
  const config={path:value=>join(dir,value)};
  const account={id:'raccoon-oauth-0123456789ab',platform:'raccoon',credentials:{kind:'oauth',authKind:'oauth_iam',file:'raccoon-oauth-0123456789ab.json'}};
  return {dir,file,token,config,account,document};
}

test('N12-A the web-authorization reader derives the exact same principal as the desktop reader',async t=>{
  const f=await fixture(t);
  const native=await readRaccoonNativeAuth(f.file);
  const oauth=await readRaccoonOAuthAuth(f.file);
  assert.equal(oauth.principal,native.principal);
  assert.equal(oauth.principal,'raccoon:'+digest('raccoon-test').slice(0,24));
});

test('N12-B a named claim wins over sub for the principal while sub stays the stable identity',async t=>{
  const f=await fixture(t,{claims:{name:'SAMPLE_DISPLAY_NAME',sub:'SAMPLE_SUB_VALUE'}});
  const oauth=await readRaccoonOAuthAuth(f.file);
  assert.equal(oauth.principal,'raccoon:'+digest('SAMPLE_DISPLAY_NAME').slice(0,24));
  assert.notEqual(oauth.principal,'raccoon:'+digest('SAMPLE_SUB_VALUE').slice(0,24));
});

test('N3-C a corrupted display kind still resolves through the OAuth branch and never asks for a desktop login',async t=>{
  const f=await fixture(t);
  // `kind` is a display/discovery hint that discovery snapshots rewrite; corrupting
  // it must not move a web-authorized account onto the desktop reader.
  const account={...f.account,credentials:{...f.account.credentials,kind:'desktop'}};
  const secret=await raccoonResolve(account,f.config,{fetchImpl:()=>{throw new Error('network must not be used');}});
  assert.equal(secret.authKind,'oauth_iam');
  assert.equal(secret.source,'raccoon_oauth_loopback');
  assert.equal(secret.principal,'raccoon:'+digest('raccoon-test').slice(0,24));
});

test('N6-B an expired web authorization asks for re-authorization and never mentions the desktop client',async t=>{
  const f=await fixture(t,{expiresAt:Date.now()-60000});
  const account={...f.account,credentials:{...f.account.credentials,kind:'desktop'}};
  const failure=await raccoonResolve(account,f.config).then(()=>null,error=>error);
  assert.ok(failure,'an expired web authorization must not resolve');
  assert.equal(failure.code,'raccoon_oauth_reauth_required');
  assert.notEqual(failure.code,'raccoon_refresh_needs_login');
  assert.match(failure.message,/重新授权/);
  assert.equal(failure.message.includes('客户端'),false);
});

test('N6-D resolving a web-authorized account performs no network call at all',async t=>{
  const f=await fixture(t);
  const calls=[];
  const fetchImpl=(...args)=>{calls.push(args);throw new Error('unexpected fetch');};
  await raccoonResolve(f.account,f.config,{fetchImpl});
  assert.equal(calls.length,0);
});

test('E4 the expiry boundary uses a strict greater-than comparison',async t=>{
  const live=await fixture(t,{expiresAt:Date.now()+2000});
  const resolved=await raccoonResolve(live.account,live.config);
  assert.equal(resolved.authKind,'oauth_iam');
  const dead=await fixture(t,{expiresAt:Date.now()});
  const failure=await raccoonResolve(dead.account,dead.config).then(()=>null,error=>error);
  assert.equal(failure?.code,'raccoon_oauth_reauth_required');
});

test('N9 the credential view exposes inline renewal state instead of an event per tier',async t=>{
  const f=await fixture(t,{expiresAt:Date.now()-1000});
  const secret=await readRaccoonOAuthAuth(f.file);
  const view=raccoonCredentialView(secret);
  assert.equal(view.authKind,'raccoon_oauth_iam');
  assert.equal(view.sourceLabel,'网页授权');
  assert.equal(view.needsReauth,true);
  assert.equal(view.renewalLevel,'expired');
  assert.equal(view.remainingDays,0);
  const healthy=raccoonCredentialView({...secret,expiresAtMs:Date.now()+5*DAY,expiresAt:new Date(Date.now()+5*DAY).toISOString()});
  assert.equal(healthy.needsReauth,false);
  assert.equal(healthy.renewalLevel,'warn');
  assert.equal(healthy.remainingDays,5);
});

test('E2 remaining days round up so a partially spent day still counts',()=>{
  const now=0;
  assert.equal(raccoonRemainingDays(now+DAY*1.2,now),2);
  assert.equal(raccoonRemainingDays(now+DAY,now),1);
  assert.equal(raccoonRemainingDays(now,now),0);
  assert.equal(raccoonRemainingDays(Number.NaN,now),0);
});

test('N10-B the four inline tiers map to info, warn, urgent and expired',()=>{
  const now=0,at=days=>now+days*DAY;
  assert.equal(raccoonRenewalLevel(at(8),now),'info');
  assert.equal(raccoonRenewalLevel(at(5),now),'warn');
  assert.equal(raccoonRenewalLevel(at(2),now),'urgent');
  assert.equal(raccoonRenewalLevel(at(0),now),'expired');
  assert.equal(raccoonRenewalLevel(Number.NaN,now),'expired');
});

test('N6-C a byte-identical refresh response is rejected and never counts as a renewal',async t=>{
  const f=await fixture(t);
  const before=await readFile(f.file);
  const at=Date.parse(f.document.accessExpiresAt);
  const fetchImpl=async()=>new Response(JSON.stringify({code:0,data:{access_token:f.token,refresh_token:'SAMPLE_REFRESH_TOKEN'}}),{status:200,headers:{'content-type':'application/json'}});
  const failure=await refreshRaccoonAuth(f.document,{fetchImpl,now:at}).then(()=>null,error=>error);
  assert.equal(failure?.code,'raccoon_refresh_invalid');
  assert.deepEqual(await readFile(f.file),before,'the credential file must not be rewritten');
});

test('N6 a web-authorized credential is refused by the desktop refresh path before any network call',async t=>{
  const f=await fixture(t);
  const calls=[];
  const fetchImpl=()=>{calls.push(1);throw new Error('unexpected fetch');};
  const failure=await raccoonProvider.resolve(f.account,f.config,{fetchImpl}).then(()=>null,error=>error);
  assert.equal(failure,null,'a valid credential resolves');
  const expired=await fixture(t,{expiresAt:Date.now()-1000});
  const blocked=await raccoonProvider.resolve(expired.account,expired.config,{fetchImpl}).then(()=>null,error=>error);
  assert.equal(blocked?.code,'raccoon_oauth_reauth_required');
  assert.equal(calls.length,0);
});

test('X2 a damaged credential file yields a readable code and is never deleted',async t=>{
  const f=await fixture(t);
  const truncated='{"schemaVersion":1,"authKind":"oauth_iam",';
  await writeFile(f.file,truncated,{mode:0o600});
  assert.equal((await readRaccoonOAuthAuth(f.file).then(()=>null,e=>e))?.code,'raccoon_oauth_reauth_required');
  assert.equal((await raccoonResolve(f.account,f.config,{}).then(()=>null,e=>e))?.code,'raccoon_oauth_reauth_required');
  assert.equal(await readFile(f.file,'utf8'),truncated,'a truncated file is repaired by re-authorizing, never silently dropped');
  const missingToken='{"schemaVersion":1,"authKind":"oauth_iam","identity":{"sub":"SAMPLE_SUB"}}';
  await writeFile(f.file,missingToken,{mode:0o600});
  assert.equal((await readRaccoonOAuthAuth(f.file).then(()=>null,e=>e))?.code,'raccoon_oauth_reauth_required');
  assert.equal(await readFile(f.file,'utf8'),missingToken);
  const anonymous=JSON.stringify({schemaVersion:1,authKind:'oauth_iam',access_token:jwt({exp:Math.floor((Date.now()+DAY)/1000)}),refresh_token:'SAMPLE_REFRESH_TOKEN'});
  await writeFile(f.file,anonymous,{mode:0o600});
  assert.equal((await readRaccoonOAuthAuth(f.file).then(()=>null,e=>e))?.code,'raccoon_identity_missing');
  assert.equal(await readFile(f.file,'utf8'),anonymous,'an unidentifiable token stays on disk so the user can re-authorize over it');
});

test('A-models a web-authorized credential reads the official catalog instead of the desktop table',async t=>{
  const f=await fixture(t);
  const secret=await raccoonProvider.resolve(f.account,f.config,{});
  const urls=[];
  const catalog={code:0,data:{categories:[{type:'chat',models:[{model_name:'SAMPLE_OAUTH_MODEL',description:'网页授权模型',params:{context_window:32000,max_tokens:4096},tags:['vision']}]}]}};
  const models=await raccoonProvider.models(secret,{fetchImpl:async(url,opts)=>{urls.push(String(url));assert.equal(opts.headers.authorization,'Bearer '+f.token);return new Response(JSON.stringify(catalog),{status:200,headers:{'content-type':'application/json'}});}});
  assert.equal(urls.length,1,'a web authorization reads its own catalog once');
  assert.match(urls[0],/\/api\/web\/llm\/v2\/model_catalog$/);
  assert.equal(models.length,1);
  assert.equal(models[0].id,'SAMPLE_OAUTH_MODEL');
  assert.equal(models[0].name,'网页授权模型');
  assert.equal(models[0].contextWindow,32000);
  assert.equal(models[0].maxTokens,4096);
  assert.equal(models[0].callable,true);
  assert.equal(models[0].source,'official_model_catalog');
  let fetched=0;
  const desktop=await raccoonProvider.models({authKind:'desktop'},{fetchImpl:async()=>{fetched++;throw new Error('the desktop table must not touch the network');}});
  assert.equal(fetched,0,'the desktop table stays a local read');
  assert.ok(Array.isArray(desktop));
  const corruptedAccount={...f.account,credentials:{...f.account.credentials,kind:'desktop'}};
  const corruptedSecret=await raccoonProvider.resolve(corruptedAccount,f.config,{});
  assert.equal(corruptedSecret.authKind,'oauth_iam','a corrupted display kind still resolves through the OAuth branch');
  const seen=[];
  await raccoonProvider.models(corruptedSecret,{fetchImpl:async url=>{seen.push(String(url));return new Response(JSON.stringify(catalog),{status:200,headers:{'content-type':'application/json'}});}});
  assert.match(seen[0],/\/api\/web\/llm\/v2\/model_catalog$/,'the OAuth branch is chosen from the credential file, not the display kind');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {request as httpRequest} from 'node:http';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {createRaccoonOAuth,buildAuthorizeUrl,createAuthorizeState,parsePasteInput,exchangeAuthorizationCode,raccoonOAuthPrincipal,raccoonOAuthIdentity,remainingDaysOf,renewalLevel,decodeJwtClaims} from '../server/raccoon-oauth.mjs';
import {raccoonOAuthAccountId,raccoonOAuthFile,raccoonOAuthRelativeFile} from '../server/raccoon-oauth-path.mjs';
import {readRaccoonNativeAuth} from '../engine/src/provider-raccoon.mjs';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const digest=value=>createHash('sha256').update(String(value)).digest('hex');
const jwt=claims=>['SAMPLEHEADER',Buffer.from(JSON.stringify(claims)).toString('base64url'),'SAMPLESIGNATURE'].join('.');
const DAY=86400000;

async function fixture(t,overrides={}){
  await mkdir(join(project,'work/raccoon-oauth-tests'),{recursive:true});
  const dir=await mkdtemp(join(project,'work/raccoon-oauth-tests','oauth-')),stateRoot=join(dir,'runtime/profile'),dataDir=join(stateRoot,'data');
  await mkdir(dataDir,{recursive:true});
  const value={schemaVersion:1,dataDir:'./data',accounts:[],upstreams:[],routes:[]};
  const configFile=join(stateRoot,'config.json');
  await writeFile(configFile,JSON.stringify(value));
  const config={
    file:configFile,value,dataDir,
    path:file=>resolve(stateRoot,file),
    async load(){this.value=JSON.parse(await readFile(this.file,'utf8'));return this.value;},
    async save(next){await mkdir(dirname(this.file),{recursive:true});await writeFile(this.file,JSON.stringify(next,null,2));this.value=structuredClone(next);},
  };
  const service={config,credentials:{cache:new Map()},platforms:{catalogs:new Map()}};
  const options={taskRoot:dir,stateRoot,configFile,engineRoot:join(project,'engine')};
  const calls=[];
  const fetchImpl=async(...args)=>{calls.push(args);throw new Error('NETWORK_NOT_STUBBED');};
  const oauth=createRaccoonOAuth({service,options,settings:()=>({enabled:true}),fetchImpl,...overrides});
  t.after(async()=>{oauth.dispose();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
  return {dir,stateRoot,dataDir,configFile,config,service,options,oauth,calls,fetchImpl};
}

// The authorization page is opened by the browser; only the loopback listener is
// exercised here. This talks to it exactly like the vendor redirect does.
function callback({port,path='/auth/callback',method='GET',host}={}){
  return new Promise((resolve,reject)=>{
    const req=httpRequest({host:'127.0.0.1',port,path,method,headers:{host:host??('127.0.0.1:'+port)}},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));
      response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error',reject);req.end();
  });
}
const portOf=url=>Number(new URL(url).searchParams.get('redirect').match(/:(\d+)\//)[1]);
const stateOf=url=>new URL(url).searchParams.get('state');
const tokenResponse=(accessToken,refreshToken=accessToken)=>new Response(JSON.stringify({code:0,data:{access_token:accessToken,refresh_token:refreshToken}}),{status:200,headers:{'content-type':'application/json'}});

test('A1 the authorization URL carries the vendor parameters in the documented order',()=>{
  const state=createAuthorizeState();
  const url=buildAuthorizeUrl({port:54321,state});
  const parsed=new URL(url);
  assert.equal(parsed.origin,'https://xiaohuanxiong.com');
  assert.equal(parsed.pathname,'/code/authorize');
  assert.deepEqual([...parsed.searchParams.keys()],['login_source','appname','state','desktop_callback','redirect']);
  assert.equal(parsed.searchParams.get('login_source'),'desktop');
  assert.equal(parsed.searchParams.get('appname'),'办公小浣熊客户端');
  assert.equal(parsed.searchParams.get('state'),state);
  assert.equal(parsed.searchParams.get('desktop_callback'),'loopback');
  assert.equal(parsed.searchParams.get('redirect'),'http://127.0.0.1:54321/auth/callback');
});
test('A2 the authorize state is 64 hex characters and never repeats',()=>{
  const seen=new Set();
  for(let n=0;n<50;n++){const state=createAuthorizeState();assert.match(state,/^[a-f0-9]{64}$/);assert.equal(seen.has(state),false);seen.add(state);}
});
test('A3 paste parsing accepts a callback link, a bare token and a token pair without any network use',()=>{
  const token=jwt({name:'SAMPLE',sub:'SAMPLE-SUB',exp:4102444800});
  assert.deepEqual(parsePasteInput('office-raccoon://auth/callback?code=SAMPLE_CODE&state='+('a'.repeat(64))),{kind:'code',code:'SAMPLE_CODE',state:'a'.repeat(64)});
  assert.deepEqual(parsePasteInput('http://127.0.0.1:1234/auth/callback?code=SAMPLE_CODE'),{kind:'code',code:'SAMPLE_CODE',state:''});
  assert.deepEqual(parsePasteInput(token),{kind:'tokens',accessToken:token,refreshToken:''});
  assert.deepEqual(parsePasteInput(JSON.stringify({access_token:token,refresh_token:'SAMPLE_REFRESH'})),{kind:'tokens',accessToken:token,refreshToken:'SAMPLE_REFRESH'});
  assert.deepEqual(parsePasteInput(JSON.stringify({accessToken:token,refreshToken:'SAMPLE_REFRESH'})),{kind:'tokens',accessToken:token,refreshToken:'SAMPLE_REFRESH'});
});
test('A4 unrecognizable paste input is refused before any network call',async()=>{
  for(const input of ['', '   ', 'hello world', '{\"nope\":1}', 'ftp://example.com/auth/callback?code=x']){
    const failure=await new Promise(resolve=>{try{parsePasteInput(input);resolve(null);}catch(error){resolve(error);}});
    assert.ok(failure,`expected ${JSON.stringify(input)} to be refused`);assert.equal(failure.code,'raccoon_oauth_paste_invalid');
  }
  const missingCode=await new Promise(resolve=>{try{parsePasteInput('office-raccoon://auth/callback?state=abc');}catch(error){resolve(error);}});
  assert.equal(missingCode.code,'raccoon_oauth_callback_code_invalid');
  const f=await fixture(test);const count=f.calls.length;
  await assert.rejects(f.oauth.paste({input:'not a link'}),{code:'raccoon_oauth_paste_invalid'});
  assert.equal(f.calls.length,count);
});
test('A5 the web authorization principal equals the desktop reader principal byte for byte',async()=>{
  const claims={name:'SAMPLE 用户',sub:'SAMPLE-SUB-1',exp:4102444800};
  const token=jwt(claims);
  await mkdir(join(project,'work/raccoon-oauth-tests'),{recursive:true});
  const file=join(await mkdtemp(join(project,'work/raccoon-oauth-tests','principal-')),'auth.json');
  await writeFile(file,JSON.stringify({access_token:token}));
  const native=await readRaccoonNativeAuth(file);
  assert.equal(native.principal,'raccoon:'+digest('SAMPLE 用户').slice(0,24));
  assert.equal(raccoonOAuthPrincipal(raccoonOAuthIdentity(decodeJwtClaims(token))),native.principal);
  await rm(dirname(file),{recursive:true,force:true,maxRetries:5});
});
test('E2 remaining days always rounds up so a partial day is never reported as zero',()=>{
  const at=Date.UTC(2027,0,1);
  assert.equal(remainingDaysOf(at+1.2*DAY,at),2);
  assert.equal(remainingDaysOf(at+1.0*DAY,at),1);
  assert.equal(remainingDaysOf(at+0.4*DAY,at),1);
  assert.equal(remainingDaysOf(at-DAY,at),0);
});
test('N10-B renewal levels separate 8, 5, 2 and 0 days into info, warn, urgent and expired',()=>{
  const at=Date.UTC(2027,0,1);
  assert.equal(renewalLevel({expiresAtMs:at+8*DAY,nowMs:at}),'info');
  assert.equal(renewalLevel({expiresAtMs:at+5*DAY,nowMs:at}),'warn');
  assert.equal(renewalLevel({expiresAtMs:at+2*DAY,nowMs:at}),'urgent');
  assert.equal(renewalLevel({expiresAtMs:at,nowMs:at}),'expired');
  assert.equal(renewalLevel({expiresAtMs:at+30*DAY,nowMs:at,invalid:true}),'expired');
});
test('B1 the callback rejects a foreign Host header with 404 and leaves the session pending',async t=>{
  const f=await fixture(t),started=await f.oauth.begin();const port=portOf(started.authorizeUrl),state=stateOf(started.authorizeUrl);
  const answer=await callback({port,path:'/auth/callback?state='+state+'&code=SAMPLE',host:'evil.example'});
  assert.equal(answer.status,404);
  assert.equal((await f.oauth.sessionStatus(started.sessionId)).phase,'pending');
});
test('B2 the callback rejects a wrong path with 404',async t=>{
  const f=await fixture(t),started=await f.oauth.begin();const port=portOf(started.authorizeUrl),state=stateOf(started.authorizeUrl);
  assert.equal((await callback({port,path:'/wrong?state='+state+'&code=SAMPLE'})).status,404);
  assert.equal((await callback({port,path:'/auth/callback/extra?state='+state+'&code=SAMPLE'})).status,404);
});
test('B3 the callback rejects methods other than GET with 405',async t=>{
  const f=await fixture(t),started=await f.oauth.begin();const port=portOf(started.authorizeUrl),state=stateOf(started.authorizeUrl);
  assert.equal((await callback({port,path:'/auth/callback?state='+state+'&code=SAMPLE',method:'POST'})).status,405);
  assert.equal((await f.oauth.sessionStatus(started.sessionId)).phase,'pending');
});
test('B4 a mismatched state is rejected with 400, keeps the session pending and never touches the network',async t=>{
  const f=await fixture(t),started=await f.oauth.begin();const port=portOf(started.authorizeUrl);
  const answer=await callback({port,path:'/auth/callback?state='+('b'.repeat(64))+'&code=SAMPLE'});
  assert.equal(answer.status,400);
  const session=await f.oauth.sessionStatus(started.sessionId);
  assert.equal(session.phase,'pending');
  assert.equal(f.calls.length,0);
  assert.equal((await callback({port,path:'/auth/callback?state='+stateOf(started.authorizeUrl)+'&state='+stateOf(started.authorizeUrl)+'&code=SAMPLE'})).status,400);
});
test('B5 a replayed callback cannot be redeemed twice: the listener is already closed',async t=>{
  const token=jwt({name:'SAMPLE',sub:'SAMPLE-SUB',exp:Math.floor(Date.now()/1000)+30*86400});
  const f=await fixture(t,{fetchImpl:async()=>tokenResponse(token)});
  const started=await f.oauth.begin();const port=portOf(started.authorizeUrl),state=stateOf(started.authorizeUrl);
  const first=await callback({port,path:'/auth/callback?state='+state+'&code=SAMPLE_CODE'});
  assert.equal(first.status,200);
  assert.equal((await f.oauth.sessionStatus(started.sessionId)).phase,'done');
  const replay=await callback({port,path:'/auth/callback?state='+state+'&code=SAMPLE_CODE'}).catch(error=>error);
  assert.ok(replay instanceof Error&&replay.code==='ECONNREFUSED'||replay.status===409,`replay must be refused, got ${replay.status??replay.code}`);
  const config=JSON.parse(await readFile(f.configFile,'utf8'));
  assert.equal(config.accounts.filter(item=>item.credentials?.authKind==='oauth_iam').length,1);
});
test('B6 an error callback fails the session and asks the operator to start over',async t=>{
  const f=await fixture(t),started=await f.oauth.begin();const port=portOf(started.authorizeUrl),state=stateOf(started.authorizeUrl);
  const answer=await callback({port,path:'/auth/callback?state='+state+'&error=access_denied'});
  assert.equal(answer.status,400);assert.equal(f.calls.length,0);
  const session=await f.oauth.sessionStatus(started.sessionId);
  assert.equal(session.phase,'failed');assert.equal(session.error.code,'raccoon_oauth_callback_error');
});
test('B7 a callback without a usable code is rejected and the session fails',async t=>{
  const f=await fixture(t),started=await f.oauth.begin();const port=portOf(started.authorizeUrl),state=stateOf(started.authorizeUrl);
  const answer=await callback({port,path:'/auth/callback?state='+state});
  assert.equal(answer.status,400);
  const session=await f.oauth.sessionStatus(started.sessionId);
  assert.equal(session.phase,'failed');assert.equal(session.error.code,'raccoon_oauth_callback_code_invalid');
  assert.equal(f.calls.length,0);
});
test('C1 the vendor expired-code number becomes raccoon_oauth_code_expired',async()=>{
  await assert.rejects(exchangeAuthorizationCode({code:'SAMPLE',fetchImpl:async()=>new Response(JSON.stringify({code:200035,message:'expired'}),{status:200,headers:{'content-type':'application/json'}})}),{code:'raccoon_oauth_code_expired',status:400});
});
test('C2 a 5xx answer is unavailable while a transport failure is explicitly unconfirmed',async()=>{
  await assert.rejects(exchangeAuthorizationCode({code:'SAMPLE',fetchImpl:async()=>new Response('boom',{status:503})}),{code:'raccoon_oauth_exchange_unavailable',status:503});
  await assert.rejects(exchangeAuthorizationCode({code:'SAMPLE',fetchImpl:async()=>{throw new Error('ECONNRESET');}}),{code:'raccoon_oauth_exchange_unconfirmed',status:503});
  const timeout=Object.assign(new Error('timed out'),{name:'TimeoutError'});
  await assert.rejects(exchangeAuthorizationCode({code:'SAMPLE',fetchImpl:async()=>{throw timeout;}}),{code:'raccoon_oauth_exchange_unconfirmed',status:503});
  await assert.rejects(exchangeAuthorizationCode({code:'SAMPLE',fetchImpl:async()=>new Response('not json',{status:200})}),{code:'raccoon_oauth_exchange_invalid',status:502});
  await assert.rejects(exchangeAuthorizationCode({code:'SAMPLE',fetchImpl:async()=>new Response(JSON.stringify({code:0,data:{}}),{status:200,headers:{'content-type':'application/json'}})}),{code:'raccoon_oauth_exchange_failed',status:502});
});
test('C3 a completed loopback authorization lands one account, one private credential file and no tokens in any snapshot',async t=>{
  const claims={name:'SAMPLE 授权用户',sub:'SAMPLE-SUB-42',sid:'SAMPLE-SID',exp:Math.floor(Date.now()/1000)+30*86400};
  const accessToken=jwt(claims),refreshToken=jwt({...claims,exp:claims.exp+86400});
  const f=await fixture(t,{fetchImpl:async()=>tokenResponse(accessToken,refreshToken)});
  const started=await f.oauth.begin();const port=portOf(started.authorizeUrl),state=stateOf(started.authorizeUrl);
  const answer=await callback({port,path:'/auth/callback?state='+state+'&code=SAMPLE_CODE'});
  assert.equal(answer.status,200);
  assert.equal(answer.headers['cache-control'],'no-store');
  assert.equal(answer.headers['referrer-policy'],'no-referrer');
  assert.equal(answer.headers['x-content-type-options'],'nosniff');
  assert.match(String(answer.headers['content-security-policy']),/default-src 'none'/);
  assert.equal(answer.body.includes('access_token'),false);
  const session=await f.oauth.sessionStatus(started.sessionId);
  assert.equal(session.phase,'done');
  const principal='raccoon:'+digest('SAMPLE 授权用户').slice(0,24);
  const accountId=raccoonOAuthAccountId('raccoon',principal);
  assert.match(accountId,/^raccoon-oauth-[a-f0-9]{12}$/);
  assert.equal(session.accountId,accountId);
  const file=raccoonOAuthFile(f.options,accountId);
  assert.equal(file,join(f.stateRoot,'private','raccoon-oauth',accountId+'.json'));
  const document=JSON.parse(await readFile(file,'utf8'));
  assert.equal(document.schemaVersion,1);
  assert.equal(document.authKind,'oauth_iam');
  assert.equal(document.source,'raccoon_oauth_loopback');
  assert.equal(document.acquiredVia,'loopback');
  assert.equal(document.access_token,accessToken);
  assert.equal(document.refresh_token,refreshToken);
  assert.equal(document.identity.sub,'SAMPLE-SUB-42');
  assert.equal(document.filePath,undefined);
  if(process.platform!=='win32')assert.equal((await stat(file)).mode&0o777,0o600);
  const config=JSON.parse(await readFile(f.configFile,'utf8'));
  const account=config.accounts.find(item=>item.id===accountId);
  assert.ok(account,'the authorized account must be persisted');
  assert.equal(account.platform,'raccoon');
  assert.equal(account.credentials.kind,'oauth');
  assert.equal(account.credentials.authKind,'oauth_iam');
  assert.equal(account.credentials.file,'private/raccoon-oauth/'+accountId+'.json');
  assert.equal(account.credentials.file,raccoonOAuthRelativeFile(accountId));
  assert.equal(JSON.stringify(account).includes(accessToken),false);
  assert.equal(config.upstreams.some(item=>item.accountId===accountId&&item.kind==='raccoon'),true);
  const overview=JSON.stringify(await f.oauth.overview());
  assert.doesNotMatch(overview,/eyJ[A-Za-z0-9_-]{10,}/);
  assert.doesNotMatch(overview,/state=[0-9a-f]{64}/);
});
test('N1-B only the begin response may carry the authorization URL',async t=>{
  const f=await fixture(t),started=await f.oauth.begin();
  assert.match(started.authorizeUrl,/^https:\/\/xiaohuanxiong\.com\/code\/authorize\?/);
  const status=await f.oauth.sessionStatus(started.sessionId);
  assert.equal('authorizeUrl' in status,false);
  const overview=await f.oauth.overview();
  assert.equal(JSON.stringify(overview).includes('authorizeUrl'),false);
  assert.equal(JSON.stringify(overview).includes('state='),false);
});
test('N4-C the disabled switch rejects every web-authorization surface',async t=>{
  const f=await fixture(t),oauth=createRaccoonOAuth({service:f.service,options:f.options,settings:()=>({enabled:false}),fetchImpl:f.fetchImpl});
  t.after(()=>oauth.dispose());
  await assert.rejects(oauth.overview(),{code:'raccoon_oauth_disabled',status:403});
  await assert.rejects(oauth.begin(),{code:'raccoon_oauth_disabled',status:403});
  await assert.rejects(oauth.sessionStatus('oauth-unknown'),{code:'raccoon_oauth_disabled',status:403});
  await assert.rejects(oauth.paste({input:'office-raccoon://auth/callback?code=x'}),{code:'raccoon_oauth_disabled',status:403});
  assert.throws(()=>oauth.cancel('oauth-unknown'),{code:'raccoon_oauth_disabled',status:403});
});
test('D2 a pasted token pair is stored without any network call and marks the account ready',async t=>{
  const claims={name:'SAMPLE 粘贴用户',sub:'SAMPLE-PASTE-SUB',exp:Math.floor(Date.now()/1000)+10*86400};
  const token=jwt(claims);
  const f=await fixture(t);
  const result=await f.oauth.paste({input:JSON.stringify({access_token:token,refresh_token:token})});
  assert.equal(result.saved,true);
  assert.equal(result.needsReauth,false);
  assert.equal(f.calls.length,0);
  const document=JSON.parse(await readFile(raccoonOAuthFile(f.options,result.accountId),'utf8'));
  assert.equal(document.acquiredVia,'paste');
  assert.equal(document.access_token,token);
  const overview=await f.oauth.overview();
  assert.equal(overview.accounts.length,1);
  assert.equal(overview.accounts[0].state,'ready');
  assert.equal(overview.accounts[0].needsReauth,false);
});
test('D3 a pasted link carrying a foreign state is refused before the code is redeemed',async t=>{
  const f=await fixture(t);
  await f.oauth.begin();
  await assert.rejects(f.oauth.paste({input:'office-raccoon://auth/callback?code=SAMPLE&state='+('c'.repeat(64))}),{code:'raccoon_oauth_state_mismatch',status:400});
  assert.equal(f.calls.length,0);
});
test('D4 an expired pasted token is refused instead of stored',async t=>{
  const f=await fixture(t);
  const expired=jwt({name:'SAMPLE',sub:'SAMPLE-SUB',exp:Math.floor(Date.now()/1000)-60});
  await assert.rejects(f.oauth.paste({input:expired}),{code:'raccoon_oauth_token_expired',status:401});
  const config=JSON.parse(await readFile(f.configFile,'utf8'));
  assert.equal(config.accounts.length,0);
});
test('N12-C reauthorizing as a different subject is refused and leaves the original file byte identical',async t=>{
  const first={name:'SAMPLE 甲',sub:'SAMPLE-SUB-A',exp:Math.floor(Date.now()/1000)+20*86400};
  const token=jwt(first);
  const f=await fixture(t);
  const created=await f.oauth.paste({input:token});
  const file=raccoonOAuthFile(f.options,created.accountId),before=await readFile(file);
  const other=jwt({name:'SAMPLE 甲',sub:'SAMPLE-SUB-B',exp:Math.floor(Date.now()/1000)+20*86400});
  await assert.rejects(f.oauth.paste({accountId:created.accountId,input:other}),{code:'raccoon_oauth_account_mismatch',status:409});
  assert.deepEqual(await readFile(file),before);
  assert.equal(JSON.parse(await readFile(file,'utf8')).identity.sub,'SAMPLE-SUB-A');
  assert.equal(JSON.parse(await readFile(f.configFile,'utf8')).accounts.length,1);
});
test('N9 a revoked session flips needsReauth once and the probe stays throttled for a minute',async t=>{
  const claims={name:'SAMPLE 探测',sub:'SAMPLE-PROBE',exp:Math.floor(Date.now()/1000)+5*86400};
  let probes=0;
  const f=await fixture(t,{fetchImpl:async url=>{probes++;return new Response('{}',{status:401,headers:{'content-type':'application/json'}});}});
  await f.oauth.paste({input:jwt(claims)});
  const first=await f.oauth.overview();
  assert.equal(probes,1);
  assert.equal(first.accounts[0].needsReauth,true);
  assert.equal(first.accounts[0].renewalLevel,'expired');
  const second=await f.oauth.overview();
  assert.equal(probes,1);
  assert.equal(second.accounts[0].needsReauth,true);
});
test('N9 a probe that cannot reach the vendor keeps the previous verdict and is not retried in a storm',async t=>{
  const claims={name:'SAMPLE 探测',sub:'SAMPLE-PROBE-2',exp:Math.floor(Date.now()/1000)+5*86400};
  let probes=0;
  const f=await fixture(t,{fetchImpl:async()=>{probes++;throw new Error('ENETUNREACH');}});
  await f.oauth.paste({input:jwt(claims)});
  const overview=await f.oauth.overview();
  assert.equal(probes,1);
  assert.equal(overview.accounts[0].needsReauth,false);
  assert.equal(overview.accounts[0].state,'ready');
});
test('C-begin the loopback listener is closed after a completed authorization so nothing keeps the port open',async t=>{
  const token=jwt({name:'SAMPLE',sub:'SAMPLE-SUB',exp:Math.floor(Date.now()/1000)+30*86400});
  const f=await fixture(t,{fetchImpl:async()=>tokenResponse(token)});
  const started=await f.oauth.begin();const port=portOf(started.authorizeUrl),state=stateOf(started.authorizeUrl);
  await callback({port,path:'/auth/callback?state='+state+'&code=SAMPLE_CODE'});
  await new Promise(resolve=>setTimeout(resolve,50));
  await assert.rejects(callback({port}),error=>error.code==='ECONNREFUSED');
});
test('C-begin a busy session is reported while the previous one is still waiting',async t=>{
  const f=await fixture(t);
  await f.oauth.begin();
  await assert.rejects(f.oauth.begin(),{code:'raccoon_oauth_busy',status:409});
  const started=await f.oauth.overview();
  assert.equal(started.active.phase,'pending');
  assert.match(started.active.startedAt,/^\d{4}-\d{2}-\d{2}T/);
});

test('A-hook a committed authorization asks discovery for its routes once',async t=>{
  const calls=[];
  const f=await fixture(t,{onAccountCommitted:async info=>{calls.push(info);return {routeCount:2,catalogStatus:'ready'};}});
  const claims={name:'SAMPLE HOOK',sub:'SAMPLE-HOOK-SUB',exp:Math.floor(Date.now()/1000)+30*86400};
  const result=await f.oauth.paste({input:jwt(claims)});
  assert.equal(result.saved,true);
  assert.equal(calls.length,1,'the commit hook runs exactly once per authorization');
  assert.equal(calls[0].accountId,result.accountId);
  assert.equal(calls[0].created,true);
  assert.equal(typeof calls[0].principal,'string');
  assert.equal(result.routeCount,2,'the route count is reported back to the caller');
  assert.equal(result.catalogStatus,'ready');
});
test('A-hook a failing route refresh never rolls back a finished authorization',async t=>{
  const f=await fixture(t,{onAccountCommitted:async()=>{throw new Error('discovery offline');}});
  const claims={name:'SAMPLE HOOK 2',sub:'SAMPLE-HOOK-SUB-2',exp:Math.floor(Date.now()/1000)+30*86400};
  const result=await f.oauth.paste({input:jwt(claims)});
  assert.equal(result.saved,true);
  assert.equal('routeCount' in result,false,'a failed refresh simply omits the hint');
  const document=JSON.parse(await readFile(raccoonOAuthFile(f.options,result.accountId),'utf8'));
  assert.equal(document.authKind,'oauth_iam','the credential survives a catalog failure');
  assert.equal(f.service.config.value.accounts.some(item=>item.id===result.accountId),true);
});

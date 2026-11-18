import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,rm,access,readdir,symlink,lstat} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createDiscovery,probeIsolatedCredential} from '../server/discovery.mjs';
import {removeHubAccount,removeOwnedCredentialAssets} from '../server/account-removal.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=value=>createHash('sha256').update(value).digest('hex');
const write=async(file,value)=>{await mkdir(dirname(file),{recursive:true});await writeFile(file,typeof value==='string'?value:JSON.stringify(value));};
const parse=async file=>JSON.parse(await readFile(file,'utf8'));
const exists=async file=>{try{await access(file);return true;}catch{return false;}};
const raccoonToken=(name,exp=4102444800)=>'SAMPLEHEADER.'+Buffer.from(JSON.stringify({name,exp})).toString('base64url')+'.SAMPLESIGNATURE';
const sampleModels=[{id:'SAMPLE_MODEL',name:'Sample model',callable:true,contextWindow:32000,maxTokens:8192}];

async function fixture(t,{accounts=[],settings=null}={}){
  const dir=join(repo,'work/raccoon-oauth-isolation',randomUUID()),root=join(dir,'TARGET'),home=join(dir,'HOME');
  const stateRoot=join(root,'runtime/profile'),dataDir=join(stateRoot,'data'),configFile=join(stateRoot,'config.json');
  await mkdir(dataDir,{recursive:true});
  const value={schemaVersion:1,dataDir,scheduler:{enabled:false,startup:false,hour:10,minute:0,jitterSeconds:600,timezone:'Asia/Shanghai'},server:{host:'127.0.0.1',port:0},accounts:structuredClone(accounts),upstreams:[],routes:[]};
  await write(configFile,value);
  const config={file:configFile,value,dataDir,path:p=>resolve(stateRoot,p),async load(){this.value=await parse(configFile);return this.value;},async save(next){await write(configFile,next);this.value=structuredClone(next);}};
  const unbound=[];
  const ledger={principalHash:()=>undefined,unbind:id=>unbound.push(id),get:()=>null,set(){}};
  const service={config,credentials:{cache:new Map()},platforms:{catalogs:new Map(),async models(){return sampleModels;}},ledger};
  const options={taskRoot:root,stateRoot,configFile,engineRoot:join(repo,'engine')};
  const hostEnvironment={HOME:home,USERPROFILE:home,USERNAME:'SAMPLE',APPDATA:join(home,'Roaming'),LOCALAPPDATA:join(home,'Local'),PUBLIC:join(home,'Public')};
  const events=[];
  const discovery=createDiscovery({service,options,hostEnvironment,onEvent:event=>events.push(event),...(settings?{settings}:{})});
  const nativeFile=join(home,'.office-raccoon','agent','config','auth.json');
  t.after(async()=>{await discovery.stop();await rm(dir,{recursive:true,force:true,maxRetries:5});});
  const clean=async()=>{await discovery.stop();};
  return {dir,root,home,stateRoot,dataDir,configFile,config,service,options,hostEnvironment,discovery,events,nativeFile,ledger,unbound,clean};
}

const oauthFile=(f,id)=>join(f.stateRoot,'private','raccoon-oauth',id+'.json');
const oauthAccount=(id,{kind='oauth',principal='raccoon:'+sha('SAMPLE_ACCOUNT').slice(0,24)}={})=>({id,platform:'raccoon',label:'小浣熊（网页授权）',enabled:true,inferenceEnabled:true,edition:'personal',credentials:{kind,authKind:'oauth_iam',file:'private/raccoon-oauth/'+id+'.json'},tasks:[{id:'daily-quota',enabled:true}]});
const seedOAuthFile=async(f,id,token)=>{const file=oauthFile(f,id);await write(file,{schemaVersion:1,authKind:'oauth_iam',source:'raccoon_oauth_loopback',obtainedAt:'2026-01-01T00:00:00.000Z',acquiredVia:'loopback',identity:{sub:'SAMPLE_SUB'},access_token:token,refresh_token:'SAMPLE_REFRESH_TOKEN'});return file;};

test('N3-B probing a web-authorized account is refused instead of reading the desktop client file',async t=>{
  const f=await fixture(t);
  const id='raccoon-oauth-aaaaaaaaaaaa',file=await seedOAuthFile(f,id,raccoonToken('SAMPLE_ACCOUNT'));
  const failure=await probeIsolatedCredential({...oauthAccount(id),credentials:{...oauthAccount(id).credentials,file}},{engineRoot:join(repo,'engine'),dataDir:f.dataDir}).then(()=>null,error=>error);
  assert.equal(failure?.code,'raccoon_oauth_excluded');
});

test('N2-A deleting a web-authorized account removes exactly its credential file',async t=>{
  const id='raccoon-oauth-cccccccccccc';
  const f=await fixture(t,{accounts:[oauthAccount(id)]});
  const file=await seedOAuthFile(f,id,raccoonToken('SAMPLE_ACCOUNT'));
  f.ledger.principalHash=()=>sha('raccoon\0'+'raccoon:'+sha('SAMPLE_ACCOUNT').slice(0,24));
  const result=await removeHubAccount(f.service,id,{confirm:true,taskRoot:f.root,stateRoot:f.stateRoot});
  assert.equal(await exists(file),false,'the credential file must be gone');
  assert.ok(result.removedCredentialAssets>=1);
  assert.equal(result.retainedAssets.some(row=>row.reason==='not_private_data'&&row.kind==='oauth'),false);
  assert.equal(f.service.config.value.accounts.length,0);
  assert.deepEqual(f.unbound,[id]);
});

test('N2-B an out-of-root name and a shared file are retained, never deleted',async t=>{
  const id='raccoon-oauth-dddddddddddd';
  const f=await fixture(t,{accounts:[oauthAccount(id),{id:'account-SharedFile01',platform:'raccoon',label:'shared',credentials:{kind:'file',file:'data/shared.json'}}]});
  const sharedFile=join(f.dataDir,'shared.json');
  await write(sharedFile,{access_token:'SAMPLE_SHARED'});
  await write(join(f.stateRoot,'private','raccoon-oauth','evil.json'),{access_token:'SAMPLE_EVIL'});
  const traversal={...oauthAccount(id),credentials:{kind:'oauth',authKind:'oauth_iam',file:'../escape/evil.json'}};
  const assets=await removeOwnedCredentialAssets(f.service,traversal,{taskRoot:f.root,stateRoot:f.stateRoot});
  assert.equal(assets.removedCredentialAssets,0);
  assert.equal(await exists(join(f.stateRoot,'private','raccoon-oauth','evil.json')),true,'a file outside the deterministic name must survive');
  assert.equal(await exists(sharedFile),true,'a file another account references must survive');
  // A hand-written identifier that is not the canonical shape cannot be turned into a
  // deletion target at all: it is reported as retained instead of guessed at.
  const rogue={id:'raccoon-oauth-nothex',platform:'raccoon',label:'rogue',credentials:{kind:'oauth',authKind:'oauth_iam',file:'private/raccoon-oauth/nothex.json'}};
  const rogueFile=join(f.stateRoot,'private','raccoon-oauth','nothex.json');
  await write(rogueFile,{access_token:'SAMPLE_ROGUE'});
  const rogueAssets=await removeOwnedCredentialAssets(f.service,rogue,{taskRoot:f.root,stateRoot:f.stateRoot});
  assert.equal(rogueAssets.removedCredentialAssets,0);
  assert.ok(rogueAssets.retainedAssets.some(row=>row.reason==='not_private_data'&&row.kind==='oauth'));
  assert.equal(await exists(rogueFile),true,'an unverifiable name is never deleted');
});

test('N2-C another web-authorized account in the same directory keeps its file',async t=>{
  const keep='raccoon-oauth-eeeeeeeeeeee',doomed='raccoon-oauth-ffffffffffff';
  const f=await fixture(t,{accounts:[oauthAccount(keep),oauthAccount(doomed)]});
  const kept=await seedOAuthFile(f,keep,raccoonToken('SAMPLE_KEEP'));
  const removed=await seedOAuthFile(f,doomed,raccoonToken('SAMPLE_DOOMED'));
  f.ledger.principalHash=()=>sha('x'.repeat(64));
  await removeHubAccount(f.service,doomed,{confirm:true,taskRoot:f.root,stateRoot:f.stateRoot});
  assert.equal(await exists(removed),false);
  assert.equal(await exists(kept),true,'a sibling account file must not be swept up');
});

test('N8-A and N8-C web authorization and a desktop login with the same principal coexist without touching each other',async t=>{
  const id='raccoon-oauth-111111111111';
  const token=raccoonToken('SAMPLE_ACCOUNT');
  const f=await fixture(t,{accounts:[oauthAccount(id)],settings:()=>({raccoonDesktopReuse:true})});
  const oauthPath=await seedOAuthFile(f,id,token);
  // The desktop client holds a byte-identical credential: the adversarial case in
  // which a hash-only equivalence check would silently adopt the OAuth account.
  await write(join(f.home,'.office-raccoon','agent','config','auth.json'),{access_token:token,refresh_token:'SAMPLE_REFRESH'});
  const before=await readFile(oauthPath);
  const status=await f.discovery.scan();
  const rows=status.candidates.filter(c=>c.platform==='raccoon');
  assert.ok(rows.length>=1);
  const accounts=f.service.config.value.accounts;
  assert.equal(accounts.length,2,'the desktop login becomes its own account, it does not replace the web one');
  const web=accounts.find(a=>a.id===id);
  assert.ok(web,'the web-authorized account keeps its identifier');
  assert.equal(web.credentials.kind,'oauth');
  assert.equal(web.credentials.authKind,'oauth_iam');
  assert.equal(web.credentials.file,'private/raccoon-oauth/'+id+'.json');
  assert.deepEqual(await readFile(oauthPath),before,'the credential bytes must not change');
  const desktop=accounts.find(a=>a.id!==id);
  assert.equal(desktop.credentials.kind,'desktop');
  const state=await parse(join(f.stateRoot,'discovery-state.json'));
  const bindings=Object.values(state.bindings??{});
  assert.equal(bindings.length,1);
  assert.equal(bindings[0].accountId,desktop.id,'only the desktop account is bound by discovery');
  for(let i=0;i<4;i++)await f.discovery.scan();
  assert.equal(f.service.config.value.accounts.filter(a=>a.id===id).length,1);
  assert.equal(f.service.config.value.accounts.find(a=>a.id===id).credentials.file,'private/raccoon-oauth/'+id+'.json');
  assert.deepEqual(await readFile(oauthPath),before);
});

test('N3-A a web-authorized record that discovery once created is skipped, not overwritten',async t=>{
  const f=await fixture(t,{settings:()=>({raccoonDesktopReuse:true})});
  await write(join(f.home,'.office-raccoon','agent','config','auth.json'),{access_token:raccoonToken('SAMPLE_ACCOUNT'),refresh_token:'SAMPLE_REFRESH'});
  await f.discovery.scan();
  const created=f.service.config.value.accounts[0];
  assert.ok(created,'the first scan imports the desktop login');
  // Simulate a legacy record: the same identifier now carries a web credential.
  const file='private/raccoon-oauth/raccoon-oauth-999999999999.json';
  created.credentials={kind:'oauth',authKind:'oauth_iam',file};
  await f.config.save(structuredClone(f.service.config.value));
  const count=f.service.config.value.accounts.length;
  const snapshots=async()=>{try{return (await readdir(f.dataDir,{recursive:true})).map(String).filter(name=>name.includes('discovered')).sort();}catch{return [];}};
  const discoveredBefore=await snapshots();
  const status=await f.discovery.scan();
  const row=status.candidates.find(c=>c.platform==='raccoon');
  assert.equal(row.status,'skipped');
  assert.equal(row.reason,'raccoon_oauth_excluded');
  assert.equal(f.service.config.value.accounts.length,count,'no second account may be created');
  // Direct assertions on the record that a rescan must never rewrite (D2 round 2).
  const account=f.service.config.value.accounts[0];
  assert.equal(account.credentials.kind,'oauth','the display kind stays oauth');
  assert.equal(account.credentials.authKind,'oauth_iam','the dispatch flag must survive a rescan');
  assert.equal(account.credentials.file,file,'the credential file reference is byte-for-byte unchanged');
  assert.deepEqual(await snapshots(),discoveredBefore,'discovery must not copy a web credential into data/discovered/');
});

test('X3 a symlinked credential file is retained and never followed for deletion',async t=>{
  // Windows needs SeCreateSymbolicLinkPrivilege (or Developer Mode) to create a
  // symlink; CI and this machine cannot, so the case is skipped by platform, not
  // dropped: on a POSIX host it runs and proves the deletion path refuses links.
  if(process.platform==='win32'){t.skip('symlink creation requires privilege on Windows');return;}
  const id='raccoon-oauth-888888888888';
  const f=await fixture(t,{accounts:[oauthAccount(id)]});
  const target=join(f.dir,'outside-target.json');
  await write(target,{schemaVersion:1,authKind:'oauth_iam',access_token:raccoonToken('SAMPLE_LINKED'),refresh_token:'SAMPLE_REFRESH'});
  const link=oauthFile(f,id);
  await mkdir(dirname(link),{recursive:true});
  await symlink(target,link);
  assert.equal((await lstat(link)).isSymbolicLink(),true);
  const assets=await removeOwnedCredentialAssets(f.service,oauthAccount(id),{taskRoot:f.root,stateRoot:f.stateRoot});
  assert.equal(assets.removedCredentialAssets,0,'a link is never deleted');
  const kept=assets.retainedAssets.find(row=>row.kind==='oauth');
  assert.ok(kept,'the link is reported as retained');
  assert.ok(['unexpected_type','link_rejected'].includes(kept.reason),`unexpected retention reason ${kept.reason}`);
  assert.equal((await lstat(link)).isSymbolicLink(),true,'the link itself survives');
  assert.equal(JSON.parse(await readFile(target,'utf8')).refresh_token,'SAMPLE_REFRESH','the link target is untouched');
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {raccoonAuthCandidates as engineCandidates,defaultRaccoonAuthPath,defaultRaccoonPaths} from '../engine/src/provider-raccoon.mjs';
import {raccoonAuthCandidates as scriptCandidates,credentialCandidates} from '../scripts/import-local.mjs';
import {nativeCandidates} from '../server/discovery.mjs';

const scratch=async t=>{const dir=await mkdtemp(join(tmpdir(),'raccoon-paths-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'HOME');};
const profileAuth=home=>join(home,'.office-raccoon','agent','config','auth.json');
const legacyAuth=home=>join(home,'.box-agent','config','auth.json');
const candidate=(host,id='raccoon',options)=>(nativeCandidates(host,options).find(row=>row.id===id));
// The three copies (engine provider, local importer, discovery candidates) must agree byte for byte.
const paths=home=>new Map([
  ['default',[]],
  ['custom-directory',[{value:join(home,'Custom Box Agent')}]],
  ['custom-file',[{value:join(home,'elsewhere','session.json')}]],
  ['home-tilde',[{value:'~/.raccoon-cfg'}]],
  ['tilde-slash',[{value:'~/.raccoon-cfg/auth.json'}]],
  ['same-as-new-default',[{value:join(home,'.office-raccoon','agent','config')}]],
  ['malformed-relative',[{value:'auth.json'}]],
  ['malformed-dot-relative',[{value:'./config'}]],
  ['malformed-blank',[{value:'   '}]],
  ['malformed-nul',[{value:'C:/broken\u0000dir'}]],
  ['non-string-number',[{value:42}]],
  ['non-string-object',[{value:{}}]],
]);

test('engine, local importer and discovery share one raccoon auth candidate priority',async t=>{
  const home=await scratch(t);
  assert.equal(isAbsolute(home),true);
  for(const [name,entries] of paths(home)){
    const value=entries[0]?.value;
    const raw=value===undefined?{}:{BOX_AGENT_CONFIG_DIR:value};
    const fromEngine=engineCandidates({env:raw,home}),fromScript=scriptCandidates({env:raw,home});
    assert.deepEqual(fromEngine,fromScript,'engine and importer must not drift ('+name+')');
    assert.deepEqual(candidate({HOME:home,USERPROFILE:home,APPDATA:join(home,'Roaming'),LOCALAPPDATA:join(home,'Local'),...raw}).paths,fromEngine,'discovery must use the shared order ('+name+')');
    for(const file of fromEngine){assert.equal(isAbsolute(file),true,name+' must stay absolute');assert.ok(!file.includes('\u0000'),name+' must not carry a NUL');}
    assert.ok(fromEngine.length>=2&&fromEngine.length<=3,name+' keeps the known locations');
  }
  // priority: env first, then the 1.2.x client profile, then the legacy box-agent home.
  const env=join(home,'Custom Box Agent');
  assert.deepEqual(engineCandidates({env:{BOX_AGENT_CONFIG_DIR:env},home}),[join(env,'auth.json'),profileAuth(home),legacyAuth(home)]);
  assert.deepEqual(engineCandidates({env:{},home}),[profileAuth(home),legacyAuth(home)]);
  // the env value is a directory unless it names a .json file (the community client joins auth.json).
  assert.deepEqual(engineCandidates({env:{BOX_AGENT_CONFIG_DIR:'C:/box.json'},home}),['C:/box.json',profileAuth(home),legacyAuth(home)]);
  // a directory identical to the new default is deduplicated, not listed twice.
  assert.deepEqual(engineCandidates({env:{BOX_AGENT_CONFIG_DIR:join(home,'.office-raccoon','agent','config')},home}),[profileAuth(home),legacyAuth(home)]);
  // ~ expands against the caller's home, never the process home.
  assert.deepEqual(engineCandidates({env:{BOX_AGENT_CONFIG_DIR:'~/.raccoon-cfg'},home}),[join(home,'.raccoon-cfg','auth.json'),profileAuth(home),legacyAuth(home)]);
});

test('malformed BOX_AGENT_CONFIG_DIR is ignored instead of breaking every platform',async t=>{
  const home=await scratch(t);
  const baseline=nativeCandidates({HOME:home,USERPROFILE:home,APPDATA:join(home,'Roaming'),LOCALAPPDATA:join(home,'Local')});
  for(const broken of ['auth.json','./config','   ','C:/broken\u0000dir',42,{},'~..']){
    const host={HOME:home,USERPROFILE:home,APPDATA:join(home,'Roaming'),LOCALAPPDATA:join(home,'Local'),BOX_AGENT_CONFIG_DIR:broken};
    const rows=nativeCandidates(host);
    assert.equal(rows.length,baseline.length,'other platforms must not be dropped by '+JSON.stringify(broken));
    assert.deepEqual(candidate(host).paths,[profileAuth(home),legacyAuth(home)],'malformed value degrades to the known locations');
    for(const row of rows)for(const file of row.paths){assert.equal(typeof file,'string');assert.equal(isAbsolute(file),true,'every candidate path stays absolute');}
  }
  // `~` is a legal spelling of the home directory, so it is not a rejection case.
  assert.deepEqual(engineCandidates({env:{BOX_AGENT_CONFIG_DIR:'~'},home}),[join(home,'auth.json'),profileAuth(home),legacyAuth(home)]);
  // a well-formed env value still wins, so the guard is not a blanket rejection.
  const good={HOME:home,USERPROFILE:home,APPDATA:join(home,'Roaming'),LOCALAPPDATA:join(home,'Local'),BOX_AGENT_CONFIG_DIR:join(home,'Good')};
  assert.deepEqual(candidate(good).paths,[join(home,'Good','auth.json'),profileAuth(home),legacyAuth(home)]);
});

test('host environment capture passes BOX_AGENT_CONFIG_DIR through while candidates validate its shape',async t=>{
  const home=await scratch(t);
  const {captureHostEnvironment}=await import('../server/discovery.mjs');
  const captured=captureHostEnvironment({BOX_AGENT_CONFIG_DIR:'D:/SAMPLE/box',USERPROFILE:home},{home,username:'SAMPLE'});
  assert.equal(captured.BOX_AGENT_CONFIG_DIR,'D:/SAMPLE/box');
  assert.deepEqual(candidate({HOME:home,BOX_AGENT_CONFIG_DIR:captured.BOX_AGENT_CONFIG_DIR}).paths[0],'D:\\SAMPLE\\box\\auth.json');
  assert.deepEqual(candidate({HOME:home,BOX_AGENT_CONFIG_DIR:'D:/SAMPLE/box/auth.json'}).paths[0],'D:/SAMPLE/box/auth.json');
});

test('raccoon candidate targets the 1.2.x client profile root with legacy fallback',async t=>{
  const home=await scratch(t);
  const host={HOME:home,USERPROFILE:home,APPDATA:join(home,'Roaming'),LOCALAPPDATA:join(home,'Local')};
  const raccoon=candidate(host);
  assert.equal(raccoon.platform,'raccoon');assert.equal(raccoon.label,'小浣熊');
  assert.deepEqual(raccoon.paths,[profileAuth(home),legacyAuth(home)]);
  // markers: the profile directories derived from `paths` plus the installed-product directories,
  // with the 1.2.x install root listed before the legacy one and nothing dropped.
  assert.ok(raccoon.markers.includes(join(home,'.office-raccoon')));
  assert.ok(raccoon.markers.includes(join(home,'.box-agent')));
  assert.ok(raccoon.markers.indexOf(join(home,'.office-raccoon'))<raccoon.markers.indexOf(join(home,'.box-agent')),'the installed 1.2.x root comes first');
  assert.ok(raccoon.markers.includes(join(home,'.office-raccoon','agent','config')));
  assert.ok(raccoon.markers.includes(join(home,'.box-agent','config')));
  assert.deepEqual(new Set(raccoon.markers).size,raccoon.markers.length,'markers stay de-duplicated');
  assert.ok(!JSON.stringify(raccoon).includes('D:\\raccoon-ai'));
  // presence probing prefers the new client profile and falls back to the legacy directory.
  assert.equal(defaultRaccoonAuthPath({env:{},home}),profileAuth(home));
  await mkdir(join(home,'.box-agent','config'),{recursive:true});await writeFile(legacyAuth(home),'{}');
  assert.equal(defaultRaccoonAuthPath({env:{},home}),legacyAuth(home),'legacy login keeps working');
  await mkdir(join(home,'.office-raccoon','agent','config'),{recursive:true});await writeFile(profileAuth(home),'{}');
  assert.equal(defaultRaccoonAuthPath({env:{},home}),profileAuth(home),'the 1.2.x profile wins once present');
  assert.equal(defaultRaccoonAuthPath({env:{BOX_AGENT_CONFIG_DIR:join(home,'Missing')},home}),profileAuth(home),'an existing login outranks a configured path that is not there yet');
  const empty=await scratch(t);
  assert.equal(defaultRaccoonAuthPath({env:{BOX_AGENT_CONFIG_DIR:join(empty,'Missing.json')},home:empty}),join(empty,'Missing.json'),'a configured path is used before anything exists on disk');
  assert.equal(defaultRaccoonAuthPath({env:{BOX_AGENT_CONFIG_DIR:'auth.json'},home}),profileAuth(home),'a malformed env value is ignored, never used');
});

test('defaultRaccoonPaths derives cookie/session/localState from the client profile only',async t=>{
  const home=await scratch(t);
  const sentinel=process.env.APPDATA;process.env.APPDATA='C:/SENTINEL-APPDATA';
  try{
    const base=join(home,'.office-raccoon','user-data'),paths=defaultRaccoonPaths({home,existsImpl:()=>false});
    assert.deepEqual(paths,{llmConfig:'',sessionBinding:join(base,'default-session-model-binding.json'),cookieDb:join(base,'Network','Cookies'),localState:join(base,'Local State')});
    assert.ok(!JSON.stringify(paths).includes('SENTINEL-APPDATA'),'%APPDATA% must not be a fallback root any more');
    assert.ok(!JSON.stringify(paths).includes('raccoon-ai'));
    const probed=defaultRaccoonPaths({home,existsImpl:()=>true,programFiles:'C:\\Program Files'});
    assert.equal(probed.llmConfig,join('C:\\Program Files','@raccoonoffice-desktop','resources','default-llm-config.json'));
  }finally{if(sentinel===undefined)delete process.env.APPDATA;else process.env.APPDATA=sentinel;}
});

test('two raccoon editions become two candidates with independent identities',async t=>{
  const home=await scratch(t);
  const host={HOME:home,USERPROFILE:home,APPDATA:join(home,'Roaming'),LOCALAPPDATA:join(home,'Local')};
  const rows=nativeCandidates(host,{enterpriseIds:['Acme 42','']}),personal=candidate(host,'raccoon',{enterpriseIds:['Acme 42','']});
  const enterprise=rows.filter(row=>row.platform==='raccoon');
  assert.equal(enterprise.length,3,'personal + two enterprise candidates');
  assert.deepEqual(enterprise.map(row=>row.id),['raccoon','raccoon-enterprise-acme-42','raccoon-enterprise-default']);
  assert.equal(new Set(rows.map(row=>row.id)).size,rows.length,'candidate ids stay unique');
  assert.equal(enterprise[1].edition,'enterprise');assert.equal(enterprise[1].label,'小浣熊 企业版 acme-42');
  assert.deepEqual(enterprise[1].paths,[join(home,'.box-agent-acme-42','config','auth.json')]);
  assert.ok(enterprise[1].markers.includes(join(home,'.box-agent-acme-42')));
  assert.ok(enterprise[1].markers.includes(join(home,'Roaming','raccoon-enterprise-acme-42')));
  // every candidate still satisfies the createDiscovery constructor contract.
  for(const row of rows){assert.match(row.id,/^[a-z0-9][a-z0-9-]{0,63}$/);assert.ok(row.paths.length);for(const file of row.paths)assert.equal(isAbsolute(file),true);}
  // no enterprise id is ever scanned for, and no path escapes the caller's home.
  assert.equal(nativeCandidates(host).filter(row=>row.id.startsWith('raccoon-enterprise')).length,0);
  assert.ok(!JSON.stringify(rows).includes('office-raccoon\\user-data'));
});

test('raccoon local import uses the same candidate priority',async t=>{
  const home=await scratch(t);
  const root=join(home,'TARGET'),account={platform:'raccoon',credentials:{}};
  assert.deepEqual(credentialCandidates(account,{sourceDir:root,env:{},home,username:'SAMPLE'}),[profileAuth(home),legacyAuth(home)]);
  assert.deepEqual(credentialCandidates(account,{sourceDir:root,env:{BOX_AGENT_CONFIG_DIR:join(home,'Custom')},home,username:'SAMPLE'}),[join(home,'Custom','auth.json'),profileAuth(home),legacyAuth(home)]);
  assert.deepEqual(credentialCandidates(account,{sourceDir:root,env:{BOX_AGENT_CONFIG_DIR:'broken'},home,username:'SAMPLE'}),[profileAuth(home),legacyAuth(home)]);
  // an explicit credentials.file keeps short-circuiting the native candidate list.
  assert.deepEqual(credentialCandidates({platform:'raccoon',credentials:{file:join(root,'explicit.json')}},{sourceDir:root,env:{},home,username:'SAMPLE'}),[join(root,'explicit.json')]);
});

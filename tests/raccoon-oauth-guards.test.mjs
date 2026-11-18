import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,access} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeOptions,requireWithin} from '../server/contracts.mjs';
import {raccoonOAuthAccountFile,raccoonOAuthFile} from '../server/raccoon-oauth-path.mjs';

// X1 (D2 round 2): the credential root is only safe if an out-of-root path is
// refused before anything is written. These assertions target the exact guard
// every credential write goes through (`requireWithin`/`normalizeOptions`), and
// the canonical-name check that keeps a hand-edited account from choosing a path.
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const exists=async file=>{try{await access(file);return true;}catch{return false;}};

async function fixture(t){
  const parent=join(project,'work','raccoon-oauth-guards');
  await mkdir(parent,{recursive:true});
  const dir=await mkdtemp(join(parent,'case-')),stateRoot=join(dir,'state');
  await mkdir(stateRoot,{recursive:true});
  t.after(async()=>{await rm(dir,{recursive:true,force:true,maxRetries:5});});
  return {dir,stateRoot};
}

test('X1 a credential path outside the plugin state root is refused with state_path_outside_project',async t=>{
  const f=await fixture(t);
  assert.throws(()=>requireWithin(f.stateRoot,join(f.dir,'outside.json'),'raccoon credential'),{code:'state_path_outside_project'});
  assert.throws(()=>requireWithin(f.stateRoot,join(f.stateRoot,'..','escape.json'),'raccoon credential'),{code:'state_path_outside_project'});
  // The same guard is what runtime.mjs applies to the two option paths a caller controls.
  assert.throws(()=>normalizeOptions({taskRoot:f.dir,stateRoot:join(f.dir,'..','escape')},f.dir),{code:'state_path_outside_project'});
  assert.throws(()=>normalizeOptions({taskRoot:f.dir,stateRoot:f.stateRoot,configFile:join(f.dir,'outside','config.json')},f.dir),{code:'state_path_outside_project'});
  assert.equal(normalizeOptions({taskRoot:f.dir,stateRoot:f.stateRoot},f.dir).stateRoot,f.stateRoot,'an in-root state root still normalizes');
});

test('X1 an account that names its own credential path cannot escape the private directory',async t=>{
  const f=await fixture(t);
  const id='raccoon-oauth-0123456789ab';
  const canonical=raccoonOAuthFile({stateRoot:f.stateRoot},id);
  assert.equal(canonical,join(f.stateRoot,'private','raccoon-oauth',id+'.json'));
  const base={id,platform:'raccoon',credentials:{kind:'oauth',authKind:'oauth_iam'}};
  for(const file of ['../../evil.json','../escape/evil.json','private/raccoon-oauth/other.json','C:\\\\Windows\\\\evil.json']){
    assert.throws(()=>raccoonOAuthAccountFile({stateRoot:f.stateRoot},{...base,credentials:{...base.credentials,file}}),{code:'raccoon_oauth_account_invalid'},`${file} must be refused`);
  }
  assert.equal(await exists(join(f.dir,'evil.json')),false,'nothing may be created outside the private root');
  assert.equal(await exists(join(f.stateRoot,'..','evil.json')),false);
  assert.equal(await exists(join(f.stateRoot,'private','raccoon-oauth','other.json')),false);
});

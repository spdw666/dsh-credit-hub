import test from 'node:test';import assert from 'node:assert/strict';import {readFile,access} from 'node:fs/promises';import {join} from 'node:path';import {projectRoot} from '../src/config.mjs';
test('public desktop source has a portable native build and excludes local state',async()=>{
 try{await access(join(projectRoot,'desktop/AiCreditDesktop.cs'))}catch(error){if(error.code!=='ENOENT')throw error;const p=JSON.parse(await readFile(join(projectRoot,'../package.json'),'utf8'));assert.equal(p.name,'dsh-credit-hub');assert.equal(p.dsh.bundle.patch,'./cordis.patch.yml');await access(join(projectRoot,'../lib/client.js'));await access(join(projectRoot,'../plugin/index.mjs'));assert.match(await readFile(join(projectRoot,'../.gitignore'),'utf8'),/runtime\//);return;}
 const source=await readFile(join(projectRoot,'desktop/AiCreditDesktop.cs'),'utf8'),build=await readFile(join(projectRoot,'desktop/build.ps1'),'utf8'),ignore=await readFile(join(projectRoot,'desktop/.gitignore'),'utf8');
 assert.match(source,/class MainWindow/);assert.match(source,/class WbPoolBoard/);assert.match(build,/AI积分网关\.exe/);assert.match(build,/Microsoft\.NET/);assert.match(build,/BundleCore/);assert.match(build,/NATIVE_BUILD_OK/);assert.doesNotMatch(build,/[CD]:[\\/]Users[\\/]/i);
 for(const path of ['app-logo.png','app-logo-rounded.ico'])await access(join(projectRoot,'desktop',path));
 for(const value of ['desktop.local.json','runtime/','core/','*.exe'])assert.ok(ignore.includes(value));
});

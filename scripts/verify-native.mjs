import {readFile,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]||'.');
try {
 const p=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
 if(p.name!=='dsh-credit-hub'||p.dsh?.bundle?.patch!=='./cordis.patch.yml'||p.dsh?.client?.platform!=='web')throw Error('native manifest missing');
 for(const f of ['lib/index.mjs','lib/client.js','server/runtime.mjs','server/worker.mjs','client/index.jsx','engine/src/service.mjs','cordis.patch.yml','README.md','THIRD_PARTY_NOTICES.md'])await access(join(root,f));
 const client=await readFile(join(root,'lib/client.js'),'utf8');
 if(!client.includes('__ModuleLoader__')||client.includes('<iframe'))throw Error('native client invalid');
 const entry=await readFile(join(root,'plugin/index.mjs'),'utf8');
 if(!entry.includes('credit-hub')||!entry.includes('createHubRuntime'))throw Error('native lifecycle missing');
 console.log('NATIVE_PLUGIN=present; BUNDLE=valid; CLIENT=native; PROVIDER=credit-hub; ENGINE=independent');
} catch(e) {
 console.log('NATIVE_PLUGIN=absent_or_incomplete; RESULT=not_installed'); process.exitCode=1;
}
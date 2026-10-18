import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(join(root,'lib'),{recursive:true});
for(const [entry,out] of [['workbuddy','workbuddy-core'],['trae','trae-core']])await build({absWorkingDir:join(root,'engine'),entryPoints:[`vendor/${entry}/entry.ts`],outfile:`vendor/${out}.mjs`,bundle:true,platform:'node',format:'esm',target:'node22.23.3',legalComments:'inline'});
try {
 await build({absWorkingDir:root,entryPoints:['plugin/index.mjs'],outfile:'lib/index.mjs',bundle:false,platform:'node',format:'esm',target:'node22.23.3'});
 const proxy="export * from '../plugin/index.mjs';\n";await writeFile(join(root,'lib/index.mjs'),proxy);
} catch(e){if(!process.argv.includes('--engine-only'))throw e;}
if(!process.argv.includes('--engine-only')) {
 const result=await build({absWorkingDir:root,entryPoints:['client/index.jsx'],bundle:true,platform:'browser',format:'cjs',target:'es2022',external:['react','react/jsx-runtime','@deepseek-ai/*'],write:false,legalComments:'inline'});
 const code=result.outputFiles[0].text;
 const wrapped=`globalThis.__ModuleLoader__.load({id:'dsh-credit-hub',factory:(require)=>{const module={exports:{}};const exports=module.exports;\n${code}\nreturn module.exports;}});\n`;
 await writeFile(join(root,'lib/client.js'),wrapped);
 console.log('BUILD_OK engine=2 backend=1 native_client=1');
} else console.log('ENGINE_BUILD_OK workbuddy-core trae-core');
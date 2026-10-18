import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
async function clientTransfer(){
  const result=await build({entryPoints:[fileURLToPath(new URL('../client/transfer.jsx',import.meta.url))],bundle:true,format:'cjs',platform:'browser',external:['react'],write:false});
  const module={exports:{}};vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:()=>({}),TextEncoder,TextDecoder,Uint8Array,Blob,atob,btoa,URL,setTimeout});return module.exports;
}
test('account file import preserves Unicode, UTF16 BOM and raw ZIP bytes',async()=>{
  const {readTransferFiles}=await clientTransfer();
  const file=(name,bytes)=>({name,size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer});
  const raw=JSON.stringify({label:'SAMPLE 中文',token:'SAMPLE12345678901234567890'}),zip=Uint8Array.from([80,75,3,4,255,0,128,17]);
  const body=await readTransferFiles([file('sample.json',Buffer.concat([Buffer.from([255,254]),Buffer.from(raw,'utf16le')])),file('sample.zip',zip)]);
  assert.equal(body.files[0].content,raw);assert.equal(body.files[1].content,Buffer.from(zip).toString('base64'));
});
test('file input rejects unsupported types and transport oversize without truncating',async()=>{
  const {readTransferFiles}=await clientTransfer();
  await assert.rejects(readTransferFiles([]),/请选择/);
  await assert.rejects(readTransferFiles([{name:'sample.exe',size:1}]),/JSON 或 ZIP/);
  await assert.rejects(readTransferFiles([{name:'large.zip',size:5*1024*1024}]),/4 MiB/);
  const bytes=Buffer.alloc(3*1024*1024,9);
  await assert.rejects(readTransferFiles([{name:'large.zip',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)}]),/编码后的请求/);
});
test('explicit account download keeps every credential byte; rejects paths and invalid base64',async()=>{
  const {decodeAccountDownload}=await clientTransfer();
  const bytes=Buffer.from('{"accessToken":"SAMPLE12345678901234567890","nickname":"中文"}\n');
  const input={filename:'sample-20261018.json',mimeType:'application/json; charset=utf-8',contentBase64:bytes.toString('base64')};
  const result=decodeAccountDownload(input);assert.equal(result.filename,input.filename);assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()),bytes);
  for(const filename of ['../sample.json','C:\\sample.json','sample.html'])assert.throws(()=>decodeAccountDownload({...input,filename}),/描述/);
  assert.throws(()=>decodeAccountDownload({...input,contentBase64:'x==='}),/格式/);
});
test('account import uses preview before commit; exports are explicit and ordinary receipts omit payloads',async()=>{
  const source=await readFile(new URL('../client/transfer.jsx',import.meta.url),'utf8'),index=await readFile(new URL('../client/index.jsx',import.meta.url),'utf8');
  for(const path of ['/import/preview','/import/commit','/accounts/export'])assert.ok(source.includes(path));
  assert.match(source,/disabled=\{busy \|\| !input \|\| !preview\?\.valid/);
  assert.match(source,/version === generation\.current/);assert.ok(index.includes('>导入账号</Button>'));assert.ok(index.includes('>导出账号</Button>'));
  const receipt=index.slice(index.indexOf('function receipt('),index.indexOf('export function HubView'));
  assert.doesNotMatch(receipt,/contentBase64|download|\.content\b|\.auth\b/);
});
test('primary actions pair official foreground/fill; disabled controls do not fade their text',async()=>{
  const css=await readFile(new URL('../client/styles.js',import.meta.url),'utf8');
  assert.match(css,/--hub-action-text: var\(--dsw-alias-label-primary-foreground/);
  assert.match(css,/--hub-action-bg: var\(--dsw-alias-button-primary-fill/);
  assert.match(css,/button--primary \{ color: var\(--hub-action-text\)/);
  assert.doesNotMatch(css,/opacity: \.55|color: #fff; border-color: transparent/);
});

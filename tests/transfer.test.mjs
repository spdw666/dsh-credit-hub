import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHubRuntime} from '../server/runtime.mjs';
import {parseManagementRequest,boundedPublic,MAX_RPC_BYTES} from '../server/contracts.mjs';
import {ACCOUNT_EXPORT_PATH,MAX_TRANSFER_ENVELOPE_BYTES,engineAccountExportResponse,validateAccountExportResponse} from '../server/transfer.mjs';

const taskRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const exportRequest=(accountIds=['account-0123456789ab'],format='json')=>parseManagementRequest({method:'POST',path:ACCOUNT_EXPORT_PATH,body:{format,accountIds}});
const engineFile=(content='1111111111111111')=>({exported:true,encoding:'base64',filename:'workbuddy-auths-1-20261018.json',contentType:'application/json; charset=utf-8',content,count:1,token:'SAMPLE_UNEXPECTED_FIELD'});

test('download bytes use an explicit, bounded whitelist rather than text masking',()=>{
  assert.equal(MAX_TRANSFER_ENVELOPE_BYTES,MAX_RPC_BYTES);
  const request=exportRequest(),source=engineFile(),result=engineAccountExportResponse(source,request);
  assert.equal(result.body.download.contentBase64,source.content);
  assert.notEqual(boundedPublic({text:source.content}).text,source.content);
  assert.deepEqual(Object.keys(result.body).sort(),['accountCount','download']);
  assert.deepEqual(Object.keys(result.body.download).sort(),['contentBase64','filename','mimeType']);
  assert.equal(JSON.stringify(result).includes('SAMPLE_UNEXPECTED_FIELD'),false);
  assert.deepEqual(validateAccountExportResponse({...result,extra:'discard',body:{...result.body,credentials:{token:'discard'}}},request),result);
  assert.deepEqual(boundedPublic(result),{status:200,body:{accountCount:1}});
  assert.throws(()=>engineAccountExportResponse(source,{...request,pathname:'/admin/models'}),{code:'account_export_channel_required'});
});

test('export rejects invalid formats, raw identities, duplicate/empty selections and queries',()=>{
  const invalid=[{},null,{format:'json',accountIds:[]},{format:'yaml',accountIds:['account-0123456789ab']},{format:'json',accountIds:['13800138000']},{format:'json',accountIds:['account-0123456789ab','account-0123456789ab']},{format:'json',accountIds:['account-0123456789ab'],credentials:'SAMPLE_TOKEN'}];
  for(const body of invalid)assert.throws(()=>parseManagementRequest({method:'POST',path:ACCOUNT_EXPORT_PATH,body}),{code:'invalid_account_export_request'});
  assert.throws(()=>parseManagementRequest({method:'POST',path:ACCOUNT_EXPORT_PATH+'?format=json',body:{format:'json',accountIds:['account-0123456789ab']}}),{code:'invalid_account_export_request'});
  for(const patch of [{filename:'../SAMPLE.json'},{encoding:'utf8'},{count:2},{content:'not base64!'},{contentType:'text/html'},{exported:false}])assert.throws(()=>engineAccountExportResponse({...engineFile(),...patch},exportRequest()),{code:'invalid_account_export_response'});
  assert.throws(()=>engineAccountExportResponse(engineFile(Buffer.alloc(MAX_RPC_BYTES).toString('base64')),exportRequest()),{code:'rpc_response_too_large',status:413});
});

async function fixture(t){
  const parent=join(taskRoot,'work','transfer-tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'case-')),src=join(root,'fixture-engine','src');await mkdir(src,{recursive:true});
  const realModule=name=>JSON.stringify(new URL('../engine/src/'+name,import.meta.url).href),networkMarker=join(root,'UPSTREAM_ATTEMPT.txt');
  await writeFile(join(root,'fixture-engine','package.json'),JSON.stringify({type:'module',version:'0.6.0'}));
  await writeFile(join(src,'service.mjs'),`
import {appendFile} from 'node:fs/promises';import {createService as realCreateService} from ${realModule('service.mjs')};
const nativeFetch=globalThis.fetch;globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url??String(input));if(url.hostname==='127.0.0.1')return nativeFetch(input,init);await appendFile(${JSON.stringify(networkMarker)},'UPSTREAM_ATTEMPT\\n');throw Error('UPSTREAM_NETWORK_FORBIDDEN_IN_TRANSFER_FIXTURE')};
export const createService=realCreateService;
`);
  for(const name of ['server.mjs','activity-context.mjs'])await writeFile(join(src,name),`export * from ${realModule(name)};`);
  const profile=join(root,'runtime','profile');await mkdir(profile,{recursive:true});
  await writeFile(join(profile,'config.json'),JSON.stringify({schemaVersion:1,dataDir:'./data',server:{host:'127.0.0.1',port:0,allowRemote:false},scheduler:{enabled:false,startup:false,timezone:'Asia/Shanghai',hour:10,minute:0,jitterSeconds:600,retryMinutes:60},workbuddy:{autoMigrateSessions:false,autoTasks:false},clientUpdates:{enabled:false},accounts:[],routes:[],upstreams:[]}));
  const hub=await createHubRuntime({taskRoot:root,engineRoot:join(root,'fixture-engine'),nodeExecutable:process.execPath,requestTimeoutMs:10000,startupTimeoutMs:10000});
  t.after(async()=>{await hub.close();await assert.rejects(access(networkMarker),{code:'ENOENT'});assert.ok(root.startsWith(parent));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  return {hub,root,profile};
}
const sample={account:{uid:'SAMPLE_1380013800012345678',enterpriseId:'SAMPLE_1234567890123456',nickname:'SAMPLE 用户',email:'sample@example.com'},auth:{accessToken:'SAMPLE_ACCESS_123456789012345678901234567890',refreshToken:'SAMPLE_REFRESH_987654321098765432109876543210',expiresAt:4102444800000,domain:'www.workbuddy.cn'},gateway:{label:'SAMPLE_13800138000',notes:'SAMPLE portable note',inferenceEnabled:false}};
const post=(hub,path,body)=>hub.request({method:'POST',path,body});
const assertNoCredentials=value=>{const text=JSON.stringify(value);for(const secret of [sample.auth.accessToken,sample.auth.refreshToken,sample.account.uid,sample.account.email])assert.equal(text.includes(secret),false);};

test('real engine + standalone worker import preview/commit and JSON/ZIP/switch export roundtrip',async t=>{
  const {hub,root,profile}=await fixture(t),input={format:'json',content:JSON.stringify(sample)};
  const before=await readFile(join(profile,'config.json'));
  const preview=await post(hub,'/admin/workbuddy/accounts/import/preview',input);
  assert.equal(preview.status,200);assert.equal(preview.body.valid,true);assert.equal(preview.body.count,1);assertNoCredentials(preview);
  assert.deepEqual(await readFile(join(profile,'config.json')),before);
  const commit=await post(hub,'/admin/workbuddy/accounts/import/commit',{...input,selectedIndexes:[0],duplicatePolicy:'skip'});
  assert.equal(commit.status,200);assert.equal(commit.body.imported,1);assert.equal(commit.body.desktopLoginChanged,false);assert.equal(commit.body.routesEnabledChanged,false);assertNoCredentials(commit);
  const current=await hub.snapshot(),handle=current.accounts[0].id;
  assert.match(handle,/^account-[a-f0-9]{12}$/);assert.equal(commit.body.accounts[0].accountId,handle);assert.equal(current.schedulerRunning,false);assertNoCredentials(current);
  const onDisk=JSON.parse(await readFile(join(profile,'config.json'),'utf8')),account=onDisk.accounts[0],credential=JSON.parse(await readFile(account.credentials.file,'utf8'));
  assert.equal(credential.accessToken,sample.auth.accessToken);assert.equal(credential.refreshToken,sample.auth.refreshToken);assert.equal(credential.uid,sample.account.uid);assert.ok(account.credentials.file.startsWith(root));
  const expected={account:{uid:sample.account.uid,enterpriseId:sample.account.enterpriseId,nickname:sample.account.nickname,email:sample.account.email},auth:sample.auth,gateway:sample.gateway};
  const expectedBytes=Buffer.from(JSON.stringify(expected,null,2)+'\n');
  for(const format of ['json','zip','switch-json']){
    const result=await post(hub,ACCOUNT_EXPORT_PATH,{format,accountIds:[handle]});assert.equal(result.status,200);assert.equal(result.body.accountCount,1);
    const {download}=result.body,bytes=Buffer.from(download.contentBase64,'base64');assert.equal(download.contentBase64,bytes.toString('base64'));
    if(format==='json')assert.deepEqual(bytes,expectedBytes);
    if(format==='switch-json'){const [record]=JSON.parse(bytes.toString('utf8'));assert.equal(record.uid,sample.account.uid);assert.equal(record.access_token,sample.auth.accessToken);assert.equal(record.refresh_token,sample.auth.refreshToken);assert.equal(record.auth_raw.auth.accessToken,sample.auth.accessToken);}
    const importing={format:format==='zip'?'zip':'json',content:format==='zip'?download.contentBase64:bytes.toString('utf8'),duplicatePolicy:'replace',selectedIndexes:[0]};
    const rePreview=await post(hub,'/admin/workbuddy/accounts/import/preview',importing);assert.equal(rePreview.body.valid,true);assert.equal(rePreview.body.entries[0].duplicate,true);assertNoCredentials(rePreview);
    const restored=await post(hub,'/admin/workbuddy/accounts/import/commit',importing);assert.equal(restored.body.replaced,1);assert.equal(restored.body.imported,0);assertNoCredentials(restored);
    const after=await post(hub,ACCOUNT_EXPORT_PATH,{format:'json',accountIds:[handle]});assert.deepEqual(Buffer.from(after.body.download.contentBase64,'base64'),expectedBytes);
  }
  const logs=await readFile(join(root,'runtime','logs','credit-hub-worker.log'),'utf8');assertNoCredentials(logs);
});

test('real worker rejects unknown export handles and invalid imports without returning payload or mutating config',async t=>{
  const {hub,profile}=await fixture(t),before=await readFile(join(profile,'config.json'));
  await assert.rejects(post(hub,ACCOUNT_EXPORT_PATH,{format:'json',accountIds:['account-0123456789ab']}),{code:'account_not_found',status:404});
  const preview=await post(hub,'/admin/workbuddy/accounts/import/preview',{format:'json',content:'SAMPLE_TOKEN_1234567890123456'});
  assert.equal(preview.body.valid,false);assert.equal(JSON.stringify(preview).includes('SAMPLE_TOKEN'),false);
  const commit=await post(hub,'/admin/workbuddy/accounts/import/commit',{format:'json',content:'SAMPLE_TOKEN_1234567890123456'});
  assert.equal(commit.status,400);assert.equal(JSON.stringify(commit).includes('SAMPLE_TOKEN'),false);
  assert.deepEqual(await readFile(join(profile,'config.json')),before);
});

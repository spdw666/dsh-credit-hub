// Explicit, user-requested account-file transport. Never pass download bytes
// through publicValue/maskText: numeric token/base64 runs must remain exact.
// Both ends of the private worker IPC validate this narrowly typed envelope.
export const ACCOUNT_EXPORT_PATH='/admin/workbuddy/accounts/export';
export const MAX_TRANSFER_ENVELOPE_BYTES=2*1024*1024;
const formats=new Set(['json','zip','switch-json']);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const failure=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
export function isAccountExportRequest(request){return request?.method==='POST'&&request?.pathname===ACCOUNT_EXPORT_PATH;}
export function validateAccountExportRequest(body){
  if(!object(body)||Object.keys(body).some(key=>!['format','accountIds'].includes(key))||!formats.has(body.format??'json')||!Array.isArray(body.accountIds)||!body.accountIds.length||body.accountIds.length>128||new Set(body.accountIds).size!==body.accountIds.length||body.accountIds.some(id=>typeof id!=='string'||!/^account-[a-f0-9]{12}$/.test(id)))throw failure('invalid_account_export_request','Choose 1–128 account handles and JSON, ZIP, or switch-json format');
  return {format:body.format??'json',accountIds:[...body.accountIds]};
}
function validateDownload(download,count,request){
  if(!isAccountExportRequest(request))throw failure('account_export_channel_required','Account downloads require an explicit export request',403);
  const {format,accountIds}=validateAccountExportRequest(request.body),extension=format==='zip'?'zip':'json',prefix=format==='switch-json'?'wb-switch-accounts':'workbuddy-auths';
  if(!Number.isSafeInteger(count)||count!==accountIds.length||!object(download)||typeof download.filename!=='string'||!new RegExp('^'+prefix+'-'+count+'-\\d{8}\\.'+extension+'$').test(download.filename)||download.mimeType!==(format==='zip'?'application/zip':'application/json; charset=utf-8')||typeof download.contentBase64!=='string'||!download.contentBase64.length||download.contentBase64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(download.contentBase64))throw failure('invalid_account_export_response','The account export returned an invalid download envelope',502);
  if(download.contentBase64.length>MAX_TRANSFER_ENVELOPE_BYTES)throw failure('rpc_response_too_large','Account export exceeds the 2 MiB response limit; select fewer accounts',413);
  const bytes=Buffer.from(download.contentBase64,'base64');
  if(bytes.toString('base64')!==download.contentBase64)throw failure('invalid_account_export_response','The account export returned invalid file bytes',502);
  const result={status:200,body:{download:{filename:download.filename,mimeType:download.mimeType,contentBase64:download.contentBase64},accountCount:count}};
  if(Buffer.byteLength(JSON.stringify(result))>MAX_TRANSFER_ENVELOPE_BYTES)throw failure('rpc_response_too_large','Account export exceeds the 2 MiB response limit; select fewer accounts',413);
  return result;
}
export function engineAccountExportResponse(result,request){
  if(!object(result)||result.exported!==true||result.encoding!=='base64')throw failure('invalid_account_export_response','The account export did not produce a valid file',502);
  return validateDownload({filename:result.filename,mimeType:result.contentType,contentBase64:result.content},result.count,request);
}
export function validateAccountExportResponse(result,request){
  if(!object(result)||result.status!==200||!object(result.body))throw failure('invalid_account_export_response','The account export returned an invalid response',502);
  return validateDownload(result.body.download,result.body.accountCount,request);
}

import {createHash, randomBytes} from 'node:crypto';
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {dirname, resolve, isAbsolute} from 'node:path';
import {homedir} from 'node:os';
export class AppError extends Error {
  constructor(message, status = 500, code = 'internal_error') {super(message); this.status = status; this.code = code;}
}
export const hash = text => createHash('sha256').update(Buffer.isBuffer(text)?text:String(text)).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
const knownSecrets = new Set();
export function rememberSecret(value) {if (typeof value === 'string' && value.length > 5) knownSecrets.add(value); return value;}
export function redact(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const value of knownSecrets) text = text.replaceAll(value, '[REDACTED]');
  return text.replace(/Bearer\s+[^\s"',]+/gi, 'Bearer [REDACTED]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[JWT]');
}
// Deliberately narrow: neither arbitrary provider fields nor headers cross this
// public/usage boundary. A business block can be inside an HTTP200 stream.
export function zcodeFailureMetadata(error){
  if(error?.code!=='zcode_upstream_blocked')return {};
  const result={};
  if(error.upstreamCode===3012)result.upstreamCode=3012;
  if(Number.isInteger(error.upstreamStatus)&&error.upstreamStatus>=100&&error.upstreamStatus<=599)result.upstreamStatus=error.upstreamStatus;
  if(typeof error.upstreamRequestSent==='boolean')result.upstreamRequestSent=error.upstreamRequestSent;
  if(typeof error.retryable==='boolean')result.retryable=error.retryable;
  if(typeof error.actionRequired==='boolean')result.actionRequired=error.actionRequired;
  if(Number.isSafeInteger(error.retryAfterSeconds)&&error.retryAfterSeconds>=0&&error.retryAfterSeconds<=86400){
    result.retryAfterSeconds=error.retryAfterSeconds;
    if(error.retryAfterSource==='local_default')result.retryAfterSource='local_default';
  }
  return result;
}
export const errorView = e => ({code: e.code ?? 'upstream_error', message: redact(e.message ?? String(e)).slice(0, 500), status: e.status ?? 502,...zcodeFailureMetadata(e)});
export function localPath(value, base) {
  const expanded = String(value).replace(/^~(?=[\\/]|$)/, homedir()).replace(/%([^%]+)%/g,(_,key)=>process.env[key]??`%${key}%`);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(base,expanded);
}
export async function readJson(file) {return JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));}
export async function atomicJson(file, value) {
  await mkdir(dirname(file),{recursive:true,mode:0o700});
  const temp = file + '.' + secret().slice(0,8) + '.tmp';
  await writeFile(temp, JSON.stringify(value,null,2)+'\n',{mode:0o600});
  await rename(temp,file);
}
export function dayIn(date = new Date(), timezone = 'Asia/Shanghai') {
  return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
export async function jsonFetch(url, {headers, body, method = body === undefined ? 'GET' : 'POST', signal, successCodes=[0,'0',200,'200'], ...options} = {}) {
  const r = await fetch(url,{...options,method,headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal??AbortSignal.timeout(30000),redirect:'error'});
  let data;try{data=await r.json();}catch{throw new AppError(`HTTP ${r.status}: expected JSON`,r.ok?502:r.status,'invalid_upstream_response');}
  if(!r.ok)throw new AppError(`HTTP ${r.status}: ${redact(data.message??data.msg??data.error?.message??'upstream rejected request')}`,r.status,'upstream_http_error');
  if(data.code!==undefined && !successCodes.includes(data.code))throw new AppError(`Business ${data.code}: ${redact(data.msg??data.message??'request rejected')}`,502,'business_error');
  return data;
}

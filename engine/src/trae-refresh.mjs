// Trae desktop credential refresh (local patch for dsh-credit-hub).
//
// The plugin ships the verified refresh contract (engine/vendor/trae/refresh.ts)
// but its packaged runtime (engine/vendor/trae-core.mjs) does not export it and
// engine/src/credentials.mjs drops `refreshToken` on the floor. This module
// re-implements the same contract plus the storage re-encryption needed to write
// the rotated token back into a Trae `storage.json` snapshot.
//
// Contract (vendor/trae/refresh.ts:22-27):
//   cn | sg | solo  -> POST {host}/cloudide/api/v3/trae/oauth/ExchangeToken
//                      ClientID=ono9krqynydwx5, ClientSecret='-'
//   solo-sg         -> POST {host}/trae/api/v3/oauth/ExchangeToken
//                      ClientID=en1oxy7wnw8j9n + DeviceInfo body
import {createCipheriv,createHash,randomBytes} from 'node:crypto';

const CONTRACT={
  cn:{path:'/cloudide/api/v3/trae/oauth/ExchangeToken',clientId:'ono9krqynydwx5'},
  sg:{path:'/cloudide/api/v3/trae/oauth/ExchangeToken',clientId:'ono9krqynydwx5'},
  solo:{path:'/cloudide/api/v3/trae/oauth/ExchangeToken',clientId:'ono9krqynydwx5'},
  'solo-sg':{path:'/trae/api/v3/oauth/ExchangeToken',clientId:'en1oxy7wnw8j9n'}
};

const HEADER_AES=Buffer.from([116,99,5,16,0,0]);
const SALT_A=Uint8Array.from([82,9,106,213,48,54,165,56,191,64,163,158,129,243,215,251,124,227,57,130,155,47,255,135,52,142,67,68,196,222,233,203,84,123,148,50,166,194,35,61,238,76,149,11,66,250,195,78,8,46,161,102,40,217,36,178,118,91,162,73,109,139,209,37]);
const SALT_B=Uint8Array.from([31,221,168,51,136,7,199,49,177,18,16,89,39,128,236,95,96,81,127,169,25,181,74,13,45,229,122,159,147,201,156,239,160,224,59,77,174,42,245,176,200,235,187,60,131,83,153,97,23,43,4,126,186,119,214,38,225,105,20,99,85,33,12,125]);

function xor(a,b){return Buffer.from(a.map((value,index)=>value^(b[index]??0)));}
function storageSalt(){return xor(SALT_A,SALT_B);}

/** Re-encrypt a Trae auth record exactly like the client stores it (aes-v1). */
export function encryptTraeAuthValue(plaintext){
  const data=Buffer.from(plaintext,'utf8');
  const random=randomBytes(32);
  const first=createHash('sha512').update(random).digest();
  const derived=createHash('sha512').update(Buffer.concat([first,storageSalt()])).digest();
  const cipher=createCipheriv('aes-128-cbc',derived.subarray(0,16),derived.subarray(16,32));
  const digest=createHash('sha512').update(data).digest();
  const encrypted=Buffer.concat([cipher.update(Buffer.concat([digest,data])),cipher.final()]);
  return Buffer.concat([HEADER_AES,random,encrypted]).toString('base64');
}

export function rewriteTraeStorageAuth(text,record){
  const doc=JSON.parse(text);
  doc['iCubeAuthInfo://icube.cloudide']=encryptTraeAuthValue(JSON.stringify(record));
  return JSON.stringify(doc);
}

/**
 * Exchange a refresh token for a fresh access token.
 * `loginRequired` marks the failure as a permanent credential problem so the
 * caller can surface "re-login" instead of retrying forever.
 */
export async function refreshTraeToken({host,edition='cn',refreshToken,userId,signal,device}={}){
  const contract=CONTRACT[edition];
  if(!contract)throw Object.assign(new Error(`Trae ${edition} refresh contract is not verified`),{code:'trae_refresh_unsupported',status:400});
  if(typeof refreshToken!=='string'||!refreshToken)throw Object.assign(new Error('Trae refresh token is missing'),{code:'trae_refresh_missing',status:401,loginRequired:true});
  const base=String(host??'').trim().replace(/\/$/,'');
  if(!base)throw Object.assign(new Error('Trae refresh host is missing'),{code:'trae_refresh_host_missing',status:400});
  const body={ClientID:contract.clientId,ClientSecret:'-',RefreshToken:refreshToken,UserID:String(userId??'')};
  if(edition==='solo-sg'&&device?.deviceId)body.DeviceInfo={DeviceID:device.deviceId,MachineID:device.machineId??'',PlatformCode:'SOLO_PC',DeviceType:'PC'};
  let response;
  try{
    response=await fetch(base+contract.path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal??AbortSignal.timeout(30000)});
  }catch(error){
    throw Object.assign(new Error(`Trae token refresh failed (${error?.code??'network_error'})`),{code:'trae_refresh_transport',status:502,retryable:true});
  }
  if(!response.ok){
    const text=await response.text().catch(()=> '');
    const permanent=response.status===401||response.status===403;
    throw Object.assign(new Error(`Trae token refresh failed (http ${response.status})${text?': '+text.slice(0,180):''}`),{code:permanent?'trae_refresh_login_required':'trae_refresh_upstream',status:permanent?401:502,loginRequired:permanent,retryable:!permanent});
  }
  const payload=await response.json().catch(()=>null);
  const result=payload?.Result??null;
  const accessToken=typeof result?.Token==='string'?result.Token:'';
  if(!accessToken){
    const code=payload?.ResponseMetadata?.Error?.Code??'';
    throw Object.assign(new Error(`Trae token refresh returned no token${code?` (code ${code})`:''}`),{code:'trae_refresh_login_required',status:401,loginRequired:true});
  }
  const expiry=result?.TokenExpireAt;
  const expiresAtMs=typeof expiry==='number'?expiry:typeof expiry==='string'?Date.parse(expiry):Number.NaN;
  if(!Number.isFinite(expiresAtMs))throw Object.assign(new Error('Trae token refresh returned an invalid expiry'),{code:'trae_refresh_invalid_expiry',status:502});
  const nextRefresh=typeof result?.RefreshToken==='string'&&result.RefreshToken!==''?result.RefreshToken:undefined;
  return {accessToken,...(nextRefresh?{refreshToken:nextRefresh}:{}),expiresAtMs};
}

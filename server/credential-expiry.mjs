// Metadata only: never renew/decrypt or use an expiry probe to call an upstream.
export function credentialExpiry(value){
 const raw=value?.expiresAtMs??value?.auth?.expiresAt??value?.expiresAt??value?.expires_at??value?.expiry;
 let at=typeof raw==='string'&&!/^\d+$/.test(raw)?Date.parse(raw):Number(raw);if(Number.isFinite(at)&&at>0)return at<1e11?at*1000:at;
 for(const token of [value?.accessToken,value?.auth?.accessToken,value?.token]){if(typeof token!=='string'||token.length>65536)continue;const parts=token.split('.');if(parts.length!==3)continue;try{const payload=JSON.parse(Buffer.from(parts[1],'base64url'));if(typeof payload.exp==='number'&&Number.isFinite(payload.exp)&&payload.exp>0)return payload.exp*1000;}catch{}}
 return null;
}

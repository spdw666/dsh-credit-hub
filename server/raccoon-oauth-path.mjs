// Deterministic, validated locations for Raccoon web-authorization credentials.
// Everything lives below <stateRoot>/private/raccoon-oauth/. Account identifiers
// are derived from the platform and the account principal, so the same identity
// always maps to the same file and no caller-supplied path ever reaches disk.
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {hubError,requireWithin} from './contracts.mjs';

export const RACCOON_OAUTH_DIRECTORY='private/raccoon-oauth';
export const RACCOON_OAUTH_ACCOUNT=/^raccoon-oauth-[a-f0-9]{12}$/;
export const RACCOON_OAUTH_FILE=/^raccoon-oauth-[a-f0-9]{12}\.json$/;

const digest=value=>createHash('sha256').update(String(value)).digest('hex');

export function raccoonOAuthAccountId(platform,principal){
  return 'raccoon-oauth-'+digest(String(platform)+'\0'+String(principal)).slice(0,12);
}
export function isRaccoonOAuthAccountId(accountId){return RACCOON_OAUTH_ACCOUNT.test(String(accountId??''));}
export function raccoonOAuthRelativeFile(accountId){
  if(!isRaccoonOAuthAccountId(accountId))throw hubError('raccoon_oauth_account_invalid','Raccoon web-authorization account identifiers are derived, not supplied',400);
  return RACCOON_OAUTH_DIRECTORY+'/'+accountId+'.json';
}
export function raccoonOAuthDirectory(options){
  return requireWithin(options.stateRoot,join(options.stateRoot,'private','raccoon-oauth'),'raccoon OAuth credential directory');
}
export function raccoonOAuthFile(options,accountId){
  raccoonOAuthRelativeFile(accountId);
  return requireWithin(options.stateRoot,join(options.stateRoot,'private','raccoon-oauth',accountId+'.json'),'raccoon OAuth credential file');
}
// Reading back a stored account: the relative file must still be exactly the
// canonical name for that account id. A hand-edited config can therefore never
// redirect a cleanup or a read at an unrelated file.
export function raccoonOAuthAccountFile(options,account){
  const id=String(account?.id??'');
  if(!isRaccoonOAuthAccountId(id))throw hubError('raccoon_oauth_account_invalid','Raccoon web-authorization account identifier is invalid',400);
  const relative=String(account?.credentials?.file??'');
  if(relative!==raccoonOAuthRelativeFile(id))throw hubError('raccoon_oauth_account_invalid','Raccoon web-authorization credential path is outside its private directory',400);
  return raccoonOAuthFile(options,id);
}

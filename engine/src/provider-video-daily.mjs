// The video daily providers (vidu/pixverse) are not part of this package, so no
// account can name one of their kinds. `claims.mjs` still asks the adapter
// whether a claim object is a video receipt; the honest answer for every
// platform this package ships is "not a video receipt", which lets the caller
// fall through to the normal confirmation loop unchanged.
//
// Replace this file with the upstream implementation if video providers are
// ever added here - do not grow it.
export function officialVideoDailySettlement() {
  return null;
}

/** Video platforms roll over at their own local midnight; every platform this
 * package ships uses the configured scheduler day directly. */
export function videoDailyClaimDay(platform, date, timezone) {
  return date.toLocaleDateString('en-CA', {timeZone: timezone});
}

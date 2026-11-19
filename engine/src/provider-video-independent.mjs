// The independent video providers (jimeng/kling/xiaoyunque/hailuo/liblib) are not
// part of this package. `claims.mjs` consults this set before it treats a claim
// as an independent-video receipt; an empty set routes every shipped platform
// down the ordinary confirmation path, which is the correct behavior for all of
// them.
//
// Replace this file with the upstream implementation if those providers are
// added here - do not grow it.
export const INDEPENDENT_VIDEO_KINDS = Object.freeze([]);

export function independentVideoSettlement() {
  return null;
}

export function retainIndependentVideoReceipt() {
  return null;
}

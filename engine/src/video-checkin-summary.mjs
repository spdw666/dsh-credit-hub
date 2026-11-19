// This package ships the desktop providers only - the video check-in providers
// (vidu/pixverse/jimeng/kling/xiaoyunque/hailuo/liblib) and their session vault
// are not part of it, and no route can name one of those kinds. `balances.mjs`
// still asks these two questions of every row, so answering them for an
// unsupported platform must be explicit rather than throwing.
//
// If a video provider is ever added here, replace this file with the real
// implementation from the upstream gateway instead of growing it.
export function videoCheckinSummary() {
  return {};
}

/** A row is current when nothing about it can go stale. Without a video receipt
 * there is no dated evidence to expire, so an existing row stays usable. */
export function videoSummaryCurrent() {
  return true;
}
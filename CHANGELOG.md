# Changelog

## 0.2.4

- Fix LobsterAI scheduled check-in active/credits contract and require a same-day verified Loomy quota receipt.
- Reconcile CodeArts claim/confirm and Raccoon daily-login rewards using authoritative read-only checks after lost responses or delayed visibility, without replaying grants.
- Register supported daily tasks for newly discovered accounts; persist explicit scheduler enable across worker recovery and handle Qoder campaign boundaries.
- Retry only positively classified pre-submission failures; preserve uncertain submission fences across later read failures.
- Add explicit account deletion with credential-free suppression fingerprints, reference pruning and exclusive owned-credential cleanup; never infer a ban from one authentication failure.


## 0.2.3

- Supervise the worker in the DSH host with bounded readiness waits, startup retries, IPC heartbeats, serial restarts, backoff and crash-storm cooldown.
- Recover from worker exit, IPC disconnect and an unresponsive event loop; close cancels recovery and confirms the old child has exited before another starts.
- Refresh model profiles, loopback addresses and private keys on a new worker generation. Reject stale prepared calls before dispatch; never replay already dispatched generations or management actions.
- Add real SAMPLE child-process and loopback streaming fault-injection tests. Keep automatic check-ins disabled unless explicitly enabled.

## 0.2.2

- Raise `engines.node` to `>=22.23.3`: Node 22.19–22.22 could install the package but the worker then failed with `worker_node_unavailable`, because it requires `node:sqlite`.
- Name the detected Node version and `node:sqlite` probe result when no worker runtime qualifies, instead of returning a bare error code.
- State the worker runtime requirement and the optional Qwen Office Python dependencies in the README and the market entry description.

## 0.2.1

- First public GitHub/marketplace submission, with prebuilt native DSH client and independent engine.
- Resolve and verify an existing standalone Node runtime from the packaged DSH runtime or PATH; do not download or replace DSH.
- Publish a real repository/version feed, portable tests and CI.
- Preserve all 0.2.0 features and independent local data.

## 0.2.0

- Late-installed Agent discovery with read-only snapshots, identity deduplication and verified model catalogs.
- Published-version event notifications, event-to-native/Webhook mappings and persistent delivery state.
- Seven-day measured burn-down forecasts and per-account reserve suggestions.
- Platform check-in windows, persisted jitter, bounded concurrency and missing-today/manual queue.
- Compatibility adapters for all 32 audited official SDK tags (0.1.0-rc.7 through 0.2.1-rc.2); one current full desktop runtime tested.

## 0.1.1

- Theme-aware buttons and WorkBuddy JSON/ZIP account import/export.

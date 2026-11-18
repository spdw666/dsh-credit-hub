# Changelog

## 0.4.0

- 小浣熊网页授权账号现在会获得**模型路由**：oauth 账号不是发现候选（无原生文件、无快照、无 binding），但 discovery 新增的 `refreshOauthRoutes` 会按同一节流周期读 `/api/web/llm/v2/model_catalog` 并为它建 `oauth-route-<sha24>` 路由（`name='小浣熊 · <model>'`、`targets=[{upstreamId,model}]`、`enabled` 跟随 `discovery.autoEnableRoutes`、`discovered:true`）。只写 `routes`：`credentials.*`、bindings、`identityKey`、`data/discovered/` 全部不写，oauth 凭据文件跨扫描逐字节不变。授权提交完成后立即触发一次（`onAccountCommitted` → `refreshOauthAccount`），周期扫描也覆盖。
- 幂等且不覆盖用户改动：已存在覆盖同一 upstream+model 的路由（任意 id/名称/启用状态）一律跳过，重复刷新路由数不变；`discovery.status().oauthRoutes` 暴露每个网页授权账号的 `routeCount`/`catalogStatus`/`catalogReason`，客户端在发现面板只读展示。
- **桌面客户端读取默认下线**（需求 B）：新设置键 `discovery.raccoonDesktopReuse`，默认 `false`。关闭时 discovery 不再扫描 `~/.office-raccoon` / `~/.box-agent`，也不把 `.office-raccoon`/`.box-agent` 作为安装标记，新机器扫描不会产生桌面 raccoon 候选；已存在的桌面账号原样保留、可读可签。需要时可在「后装 Agent 自动接入」里打开开关（桌面行恢复）或用 `scripts/import-local.mjs` 手动导入。`nativeCandidates(host,{raccoonDesktopReuse})` 保留完整枚举能力（默认 `true`，供手动导入/诊断/测试）。
- `raccoonDesktopReuse` 与 `raccoonOauth` 一样进 `operationDefaults` + `validateOperationSettings`（布尔强校验），因此 `POST /hub/operations` 不会因未知键整体 400；文档 `engine/docs/provider-raccoon.md` 与 README 写明「桌面复用已默认关闭，推荐网页授权」。
## 0.3.0

- Raccoon 小浣熊 can now be authorized through the vendor's own sign-in page as a second, independent account: a one-shot `127.0.0.1` loopback listener (random port, host check, single-use state, ten-minute window, port closed on settle, five fixed security headers on the callback page) exchanges the authorization code at `/api/web/auth/v1/login_with_authorization_code`; pasting `office-raccoon://auth/callback?code=...`, a bare IAM JWT or a JSON token pair is also accepted and never re-opened as a URL. Credentials land in `<stateRoot>/private/raccoon-oauth/raccoon-oauth-<sha12>.json` via `.tmp` + rename, 0600, and never touch `~/.office-raccoon` or `~/.box-agent`.
- Dispatch on `credentials.authKind === 'oauth_iam'` only — never on `credentials.kind`, which the discovery snapshot rewrites. Web-authorized accounts stay entirely out of background discovery (`identityKey` and `discovery-state.json` unchanged), so a desktop sign-in with the same principal cannot adopt or overwrite them; deleting one removes exactly its credential file inside the restricted private root, leaving shared files and sibling accounts alone.
- One-click reauthorization: `GET /hub/raccoon/oauth` reports `needsReauth`/`expiresAt`/`remainingDays`/`renewalLevel` per account and a lightweight 60-second-throttled read probe can flip `needsReauth` when the server session died. Only the seven-day warning is an event (`credential.expiring`, `reasonCode=raccoon_oauth_expiring`, existing dedupe key); the 3-day/1-day/expired steps are inline UI levels. Expiry wording is source-aware: 「网页授权已到期，请点击『重新授权』」 for OAuth, 「请重开小浣熊客户端登录」 for the desktop file.
- Six new local routes (R1–R6) registered in all three places — worker forwarding, request classification, operations switch — matching one table; `raccoonOauth.enabled` joins `operationDefaults` with strict validation so disabling the flow returns `raccoon_oauth_disabled` for every entry point while desktop reuse keeps working.
- `authorizeUrl` is a secret everywhere except the single `POST /hub/raccoon/oauth/begin` response, where a bounded allow-list surfaces it once for `window.open`; status, snapshot, logs and events never carry it.
- Fix wave-1 leftovers: `engine/docs/provider-raccoon.md` regression command now points at `engine/tests/...` with the real count, the enterprise-build candidate builder is reachable through `createDiscovery({enterpriseIds})` instead of being dead code, and the Windows `0o600` caveat is documented next to the credential write.
## Unreleased

- Discover the CodeArts 0.2.x DESKTOP product (Electron) as its own candidate: `<userData>/secretStorage/sha256('authSession:<region>').enc` beside `<userData>/Local State`, for the seven IAM regions the desktop build can sign in to. The extension-era `codearts-agent/User/globalStorage/state.vscdb` candidate is unchanged, so a machine that has either (or both) reports only the one it actually has.
- Read that session without SQLite: the `.enc` file is base64 text whose decoded bytes are a `v10` DPAPI+AES-256-GCM blob, so `nativeCodeArtsStored` hands `.enc` paths back as raw text and `decryptCodeArtsAuth` unwraps them from base64. `codeArtsAuthFromNative` normalizes `{session,loginContext}` (`securityToken`/`refreshToken`/`expiresAt`, DPoP keys stored as JSON strings) into the auth shape the rest of the adapter already consumes, so signing, credits, catalog and check-in keep a single code path.
- Snapshot every sibling `.enc` into the owned copy, root the Electron profile at `<userData>`, dedupe markers so a seven-region candidate probes each directory once, and scope the refresh cache per identity: the desktop product keeps one secret per product, so two signed-in accounts differ only in content and would otherwise overwrite each other's rotating refresh token. Renewal replays the session's own `clientId` (`codearts` for the desktop product, `codearts-agent` for the extension). Tests cover candidate shape, detection and per-identity caches (`tests/discovery.test.mjs`), plus payload normalization, `.enc` decoding, principal derivation and client-bound renewal (`engine/tests/provider-codearts.test.mjs`).
- Fix the daily check-in against the live campaign. Delivery now returns 「每日签到领100积分」 as `campaignId 34 / type USER_LOGIN`, while the adapter was pinned to id 1, so every account answered `campaign_absent` and never posted a claim (the desktop app claimed it fine). The daily campaign is matched by `type` plus `extra.triggerEvent` with id 1 kept as a fallback; a `MANUAL_CLAIM` campaign only turns ELIGIBLE after the product reports the day's login, so the adapter now posts `POST /v1/ops/events/trigger {triggerEvent:'user.login', channel:'DESKTOP', idempotentKey:'login-YYYYMMDD-<rand>'}` and re-reads delivery. Writes mirror the app: `channel:'DESKTOP'`, `claim_<campaignId>_<ms>`, and `/v1/ops/confirm` now carries the `userBenefitId` the claim returned instead of a campaign id (an unknown id is never confirmed blindly). `CLAIMED` counts as claimed — it is the app's 「今日已领」 — so a claimed day is never re-submitted. Tests cover the type match, the login-event bootstrap, the settled-state gate and the lost-acknowledgement paths.

## 0.2.10

- Add audited DSH 0.2.2-rc.3 to the exact optional host SDK peer ranges; preserve every previously audited prerelease.
- Extend the official source/module contract matrix to 38 tags. rc.3 exports the same 66 llm / 16 typert / 7 llm-pi-ai / 26 cordis symbols and the same 18 audited seams as rc.2, re-verified by real Typert, LLM and PiAiAdapter contracts at the fixed tag (context 1000000, retry 1, tools and the 64000-token budget intact).
- Audit the sidebar slot contract as its own evidence path: rc.3 is the first release to declare `sidebar.session.action` (kind `hoc`, root) with its own `SidebarSessionActionOwnerProps`, and it adds `wide` to `SidebarFooterActionOwnerProps`. The three slots this plugin occupies — keyed `main`, list `sidebar.panellist`, list `settings.section` — are unchanged, so no client code moved.
- Pin 0.2.2-rc.3 to the same vendored mix as rc.1/rc.2 (cordis 4.1.0, schemastery 3.19.0, loader 1.1.0, pi-ai 1.3.0) and make it the default development SDK. CI adds a third Node 24.21.0 job for rc.3 while keeping the rc.1 and rc.2 jobs.
- No plugin runtime change: the adapter protocol and registration seams are untouched, so only the audited host range, the matrix row, the pinned development SDK and the version move.

## 0.2.9

- Add audited DSH 0.2.2-rc.2 to the exact optional host SDK peer ranges; preserve every previously audited prerelease.
- Extend the official source/module contract matrix to 37 tags. 0.2.2-rc.2 adds exactly two llm exports (`LLM_FAILURE_CODES`, `RETRY_CODE_CHOICES`) and removes none: llm 66→68, typert 16, cordis 26 unchanged, and the llm-pi-ai adapter still exports `PiAiAdapter` (its source adds only a debug-level `onThinkingOmitted` log). All 18 audited seams are unchanged, re-verified by real Typert, LLM and PiAiAdapter contracts at the fixed tag.
- Pin 0.2.2-rc.2 to the same vendored mix as rc.1 (cordis 4.1.0, schemastery 3.19.0, loader 1.1.0, pi-ai 1.3.0) and make it the default development SDK. CI adds a second Node 24.21.0 job for rc.2 while keeping the rc.1 job.
- Complete the isolated development SDK: install the seven host packages `dsh-llm`, `dsh-attachment`, `dsh-fs`, `dsh-llm-retry` and `dsh-session` declare as required peers (`dsh-error`, `dsh-sandbox`, `dsh-agent`, `dsh-session`, `dsh-session-projection`, `dsh-scope`, `dsh-system-prompt`). `@deepseek-ai/dsh-llm` imports `@deepseek-ai/dsh-error` from its `lib/index.js` entry, so a dev SDK without it fails every provider and watchdog suite at import; the host's flat `node_modules` used to hide the gap. The isolated SDK now resolves with zero unmet required peers.
- No plugin runtime change: the new llm exports are additive, and the adapter only consumes `resolveRetryPolicy`, `attributionHeaders`, `PiAiAdapter` and the Typert base pair.

## 0.2.8

- Add audited DSH 0.2.2-rc.1 to the exact optional host SDK peer ranges; preserve every previously audited prerelease.
- Extend the official source/module contract matrix to 36 tags. 0.2.2-rc.1 exports the same 66 llm / 16 typert / 7 llm-pi-ai / 26 cordis symbols and the same 18 audited seams as rc.5, re-verified by real Typert, LLM and PiAiAdapter contracts at the fixed tag.
- Follow the host's dependency upgrade in the development SDK: cordis 4.0.5→4.1.0, schemastery 3.18.5→3.19.0, cordis-plugin-loader 1.0.6→1.1.0, pi-ai 1.1.0→1.3.0. Each host version now pins its own vendored versions instead of borrowing another release's mix.
- Honour the new host floor: 0.2.2-rc.1 declares `engines.node >=24.9.0`, so its CI job runs Node 24.21.0 while the rc.2/rc.3/rc.5 jobs stay on Node 22.23.3. The plugin's own worker floor remains Node >=22.23.3, since the worker is not the host.

## 0.2.7

- Add audited DSH 0.2.1-rc.4 and 0.2.1-rc.5 to exact optional host SDK peer ranges; preserve every previously audited prerelease.
- Extend the official source/module contract matrix to 35 tags. rc.4 and rc.5 export the same 66 llm / 16 typert symbols as rc.3, and the same 18 audited seams, re-verified by real Typert, LLM and PiAiAdapter contracts at both fixed tags.
- Default the isolated development SDK to rc.5 and keep independent rc.2/rc.3/rc.5 CI jobs. Keep worker Node >=22.23.3 unchanged.
- Fix Web-panel WorkBuddy account capture: a capture request without an explicit account id now derives `wb-` plus a random suffix instead of failing validation, matching the desktop dialog and the OAuth login flow. Invalid explicit ids still return 400 invalid_account_id.

## 0.2.6

- Add audited DSH 0.2.1-rc.3 to exact optional host SDK peer ranges; preserve every previously audited prerelease.
- Extend the official source/module contract matrix to 33 tags, including native sidebar, settings, Typert and prepared/snapshot provider seams.
- Default the isolated development SDK to rc.3 and run independent rc.2/rc.3 CI jobs. Keep worker Node >=22.23.3 unchanged.
- Preserve full requests, tools, budgets, account selections and scheduler consent; no provider protocol rewrite or profile migration.

## 0.2.5

- Route all live-entitled ZCode model IDs through the pinned standard OpenAI proxy, without Flash-only branching or trimming messages/tools/budgets.
- Add isolated Bun runtime installer, authenticated loopback bridge, singleflight cold-start and complete third-party license attribution.
- Declare verified 1M/128K and always-on low/high/max reasoning metadata only for the exact GLM-5.3 and GLM-5.3-Flash IDs; preserve explicit deployment/caller defaults.
- Separate fresh official 3012 rejections from unsent local cooldown gates in HTTP/SSE diagnostics and dispatch accounting; never automatically replay or change providers.


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

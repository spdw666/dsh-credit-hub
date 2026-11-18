# 商汤小浣熊原生接入

## 凭据与刷新

默认只读当前用户 `%USERPROFILE%\.office-raccoon\agent\config\auth.json`（小浣熊客户端 1.2.x）；优先级为 `BOX_AGENT_CONFIG_DIR`（官方契约，目录或文件均可，非法值被忽略）→ 上述新目录 → legacy `~/.box-agent/config/auth.json`。账号引用 `credentials: {kind: "desktop", file: "auto"}`。支持显式私有 JSON 文件引用。access_token 为原生 Bearer 身份，与 Electron Cookie 库独立。每次 resolve 重读；不因 Cookie 库为空判未登录。不改浏览器或原生文件。1.2.x 客户端对 IAM 令牌不保存 refresh_token，此时凭据只读复用至 exp，并暴露 `refreshTokenPresent:false` 与 reason `raccoon_iam_no_refresh`；到期后报 `raccoon_refresh_needs_login` 并要求重开客户端完成网页登录，不把 access_token 当作续期凭据回传官方接口。仅当原生文件确实带 refresh_token 时，才在到期前 60 秒使用官方 `/api/web/auth/v1/refresh` 续期，轮换凭据仅保存于当前用户 LocalAppData/AI Credit Gateway/private-cache 下按源路径散列隔离的文件。缓存绑定原生文件 SHA256；原生登录更新后重新采纳新源。进程内 singleflight 与跨进程排他文件锁避免重复刷新；请求前持久化 intent，失败或不确定结果禁止反复消费同一 refresh token，直至本机登录态带来新凭据。返回凭据必须身份一致、有足够有效期。客户端与网关独立缓存可能遇到服务端会话撤销，届时显示明确重新登录状态，不声称凭据永久有效。

## 真实接口

仅向 `https://xiaohuanxiong.com` 固定 `/api/web/` 路径发送凭据，拒绝重定向：
- POST `/api/web/auth/v1/refresh`：固定官方续期端点，拒绝重定向，不自动尝试其他地址。
- GET `/api/web/llm/v2/model_catalog`：服务器目录、上下文、最大输出；未声明 tools 保持未知。
- GET `/api/web/points/v1/balance`：可用、每日、月度、奖励、充值积分分别展示，未知值不归零。
- POST `/api/web/llm/v2/chat/completions`：真实增量 SSE，工具调用/回传保持原结构；未知模型在本地拒绝，防止上游静默回落。兼容 max_completion_tokens。模型特有 reasoning_effort 未声明，不将网关通用档位作为官方支持字段。

每日额度为服务端日配额，不是假造签到。`daily-quota` 以当日官方账单与登录延期核验为准；尚未完成时复现已确认的官方桌面登录积分端点并复核。capabilities.checkin=false，日任务以 observed 记录，不称新增签到领取。

## 验证

2026-10-11 官方目录、可用余额与各积分桶已通过真实 GET 核验；个人数字只记录在本机验证输出中。`sn-sensenova-6-8-flash` 普通对话、真实 SSE、lookup 工具调用及结果回传四阶段通过。该型号256000上下文/63999输出来自官方目录，tools=true仅用于已实测型号，其他保持未知。自动额度观测不推断原始发放量。

回归（在仓库根直接执行即可）：`node --test engine/tests/provider-raccoon.test.mjs engine/tests/raccoon-refresh.test.mjs engine/tests/raccoon-oauth-provider.test.mjs`，当前实测 **67 项全通过**（2026-11-18，`# tests 67 / # pass 67 / # fail 0`；桌面侧 55 项 + 网页授权 12 项）。含未知模型、余额零与未知、原生凭据优先、泄露检查、SSE/工具字段、自动额度不POST，以及续期固定域名、原文件不变、轮换缓存、源更新、身份校验、singleflight、文件锁、失败禁止重复消费；网页授权部分覆盖身份公式与原生逐字节一致、重授权主体不一致拒绝、损坏凭据可读报错、到期边界、探测节流、换码幂等不自认续期成功。

## 来源
- https://github.com/xxhhlk/raccoon2api （MIT，原生路径与官方端点）
- https://github.com/rockswang/wild-work/tree/main/internal/raccoon （README声明MIT，轮换与协议对照；未复制源码）
- 本机官方客户端资源及上述官方端点实测；公开代码不携带用户凭据。


## 续期缓存与日额度回执

来源对照固定为 [dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model/tree/ddb451c2f24bac0b0f8b03b2473efbb1f0aefb68/vendor/channel-pack/src) 的 `raccoon-oauth.ts`、`raccoon-credits.ts`，MIT；仅协议/行为对照，本轮未复制其程序实现。原生 app.asar 的登录 effect 与积分规则文案也单独只读核验；REA 曾报告一个 unpacked bufferutil.node 哈希不匹配，后续只解析 JavaScript，没有运行该二进制。

续期成功允许仅返回 access_token；未返回 refresh_token 时保留原值，保留 office_identity 等原生附加字段。私有缓存按身份与原始 refresh token 的语义指纹绑定，JSON 格式和附加元数据变化不丢失已旋转链。跨日到期使用网关缓存的下一次令牌，不回写原客户端。明确 HTTP 429 进入十分钟冷却；未知网络结果、解析失败、真正失效不自动重放。新的原生有效登录可恢复同一身份。锁内 POST 前再次检查源字节，原生已更新则本次中止、下次重新读取。

原生客户端与网关可能同时消费同一旋转令牌家族；网关锁只协调网关进程，不是原生客户端锁。上述修复和时间推进单测不等于跨日实机问题已全部治愈；本轮没有为了测试强制消费原生 refresh token。

`daily-quota` 不再把正余额当作今日完成。它读取 `/api/web/points/v1/balance` 与 `/api/web/points/v1/bills?paging.limit=50&paging.offset=0`，只在 `biz_type=daily_grant`、`grant_at` 属于北京时间当日且 `expire_at` 已延长至次日零点之后时返回 observed=true。账单本身是官方持久回执，使用当前账号凭据实时读取，不保存跨账号本地猜测。前50条没找到只表示待核验。

若未核验本日延长，日任务复现原生登录 effect：POST `/api/web/desktop/v1/login/points/grant`，空 body，`X-Client-Platform: desktop-windows`，再读账单和余额。只有账单复核成功才返回 observed=true；始终 claimed=false、credit=0。`data.granted` 与 `popup.points` 属桌面奖励另列，不冒充每日新领取。已由原客户端完成本日延期则零 POST。

官方原生规则是每日 00:00 起算、默认当日24:00失效、当天登录延长7天。`created_at` 是账单记录时刻，不等于 `grant_at`。实机账单已区分每天 daily_grant 300 与一次 reward_grant 桌面登录奖励3000；一次已领探针 granted=false 且账单无变化，不用于声称下一天 POST 必然发放。

余额输出 `dailyQuotaObserved`、`dailyCycleDate`、`dailyQuota`、`dailyQuotaObservedAt`、`dailyQuotaSource='/api/web/points/v1/bills:daily_grant'`。额度字段取账单 points，不取多日累积 dailyRemaining。读取失败、未知账单、未延期、非当日都不输出已到账。

## 网页授权（0.4.0 起为推荐通路；桌面复用默认关闭）

> **0.4.0 变更**：小浣熊桌面客户端登录态**不再被默认读取**。`discovery.raccoonDesktopReuse` 默认 `false`，`~/.office-raccoon` / `~/.box-agent` 不再是自动发现的候选或安装标记，新装机器扫描不会产生桌面 raccoon 账号；**已存在的桌面账号不受影响**（不删、不改写、凭据照常可读可签）。需要在发现面板手动打开该开关才会恢复桌面候选，`scripts/import-local.mjs` 仍可手动导入。推荐路径是下面的网页授权 + `oauth-route-*` 模型路由。

原生路径之外新增一条**网页授权**通路：走厂商官方登录页 `https://xiaohuanxiong.com/code/authorize`，本机 `127.0.0.1` 随机端口做一次性回调（10 分钟窗口、state 单次、Host 校验、重复回调 409、回调页 `no-store`/`no-referrer`/CSP `default-src 'none'`），换取 `/api/web/auth/v1/login_with_authorization_code` 的令牌对；也支持粘贴 `office-raccoon://auth/callback?code=...`、裸 IAM 令牌或 JSON 令牌对，粘贴内容永不回连。凭据写入 `<stateRoot>/private/raccoon-oauth/raccoon-oauth-<sha12(platform\0principal)>.json`（0600、`.tmp` + rename 原子替换），**不**写回 `~/.office-raccoon`，也不在 `~/.box-agent` 下建任何文件。

- **模型路由（0.4.0）**：网页授权账号虽然没有原生文件与 binding，仍由 `server/discovery.mjs` 的 `refreshOauthRoutes` 按 `discovery.modelRefreshMinutes` 节流读取官方 `GET /api/web/llm/v2/model_catalog`，并为其 upstream 建路由：id `oauth-route-<sha24(upstreamId\0modelId)>`（与桌面的 `discovered-route-*` 区分）、`name='小浣熊 · <模型名>'`、`targets=[{upstreamId,model}]`、`enabled` 跟随 `discovery.autoEnableRoutes`、`discovered:true`。写盘只经过 routes 合并：`credentials.*`、bindings、`identityKey`、`data/discovered/` 全部不动，所以重复扫描后 oauth 凭据文件逐字节不变、`data\discovered\` 不新增任何文件（N3）。
- **幂等/不覆盖用户改动**：已存在覆盖同一 `upstream+model` 的路由（无论 id、名称、启用状态是用户改的还是上次生成的）一律跳过，重复刷新路由数不变；`discovery.status().oauthRoutes[]` 暴露每个账号的 `routeCount`/`catalogStatus`/`catalogReason`/`checkedAt`，客户端只读展示，不新增按钮。
- **触发时机**：①授权提交成功（`onAccountCommitted`）立即刷新一次该账号；②周期扫描在候选循环之后统一刷新所有网页授权账号。


- 身份：`principal = 'raccoon:' + sha256(claims.name ?? claims.sub ?? raw.principal).slice(0,24)`，与原生逐字节一致；另存 `identity.sub` 用于重授权一致性校验，不一致报 `raccoon_oauth_account_mismatch` 且不覆盖原文件。
- 分派只看 `credentials.authKind === 'oauth_iam'`：`kind` 会被发现流程改写，不能当安全边界；`kind: 'oauth'` 只是给界面和自动发现看的标签。
- 网页授权账号**完全不进入**自动发现：`identityKey` 与 `discovery-state.json` 结构不变，OAuth 账号不产生 binding，重扫不会覆盖凭据文件。删除账号会连带删除该凭据文件（文件名正则 + 非符号链接 + 限定私有根），共享文件与其他账号文件保留。
- 续期：账号页「重新授权」重新走一次浏览器/粘贴流程；到期前 7 天只发一条 `credential.expiring` 事件（复用既有去重键 `credential:<accountId>:<expiry>`，`reasonCode=raccoon_oauth_expiring`），3 天/1 天/已过期降级为界面内联 `status.renewalLevel`（`info`/`warn`/`urgent`/`expired`），不产生额外事件。`needsReauth` 可由一次轻量只读探测翻真，同账号 60 秒内最多探测一次，探测失败不改判。
- 错误文案按来源区分：网页授权到期提示「网页授权已到期，请点击『重新授权』」，不出现「重开客户端」；桌面来源仍提示重开小浣熊客户端。
- **权限位（W3）**：凭据文件写入带 `mode: 0o600`，但**Windows 上该位不生效**——它与默认 ACL 相同，都带 `Authenticated Users: Modify`；实际保护来自插件 stateRoot 目录树的 `%USERPROFILE%` ACL 继承。自动发现的凭据快照（`data/discovered/.../auth.json`）同理。不要把 0600 当成 Windows 上的安全边界，本仓库也不改写 ACL，测试里只对非 Windows 平台断言权限位。

**合规与风险**：该通路是第三方自行实现厂商登录页流程，未获厂商背书；服务条款是否许可、账号风险由用户承担。`operations.raccoonOauth.enabled` 默认 `true`，置 `false` 时浏览器授权与粘贴入口全部返回 `raccoon_oauth_disabled`（403），已接入的桌面只读复用不受影响。

**未验证（需用户配合）**：①真实浏览器全流程（本机只用粘贴令牌与假 fetch 验证）②30 天后一键续期端到端 ③浏览器会话过期后重授权是否需重登 ④0.4.0 的 oauth 模型路由只用注入的 `fetchModels`/假目录验证，未用真实网页授权账号在真机拉一次 `/api/web/llm/v2/model_catalog` 建路由（真机 0.4.0 仍待安装）。**外部证据、未在本机复现**：桌面端登录第二个账号会顶掉第一个（仅社区报告，本机 `/auth/v1/sessions` 显示多会话并存、`any_session_revoked=false`）；故双账号建议走网页授权，文案不断言桌面双开一定互斥。

## 企业版多开（W2）

插件配置项 `raccoonEnterpriseIds: string[]`（`plugin/index.mjs` 的 cordis `Config`，默认空数组）是**唯一**入口：它经 `createHubRuntime` 写进 worker 的 options，由 `server/operations.mjs` 透传成 `createDiscovery({enterpriseIds})`，最后进 `nativeCandidates(host,{enterpriseIds})` 生成候选（id `raccoon-enterprise-<slug>`、`edition='enterprise'`，读取 `~/.box-agent-<id>/config/auth.json`）。不配置就不扫描任何企业目录，不做隐式猜测或递归扫描。

id 在 `server/contracts.mjs:normalizeEnterpriseIds` 统一清洗后才离开宿主：只保留 `^[a-z][a-z0-9-]{0,47}$`，因此 `..`、路径分隔符、点号、空格、控制字符、`<`/`>` 等一律被丢弃；Windows 设备名（`con`/`prn`/`aux`/`nul`/`com1-9`/`lpt1-9`）与个人版目录名（`office-raccoon`/`box-agent`）被拒绝，重复项去重。非法值被静默忽略，不产生候选也不改写配置。

端到端证据：`tests/raccoon-enterprise-product.test.mjs` 从配置值出发，经 `createHubRuntime` → 真实 worker → operations → discovery 扫描，断言合法 id 产生候选并导入企业版账号、非法 id 一个都不出现；反向用例断言不配置时零企业候选。

**这不等于两个桌面 seat 可同时使用**：本节只保证两个凭据来源互不覆盖。桌面端第二个账号可能顶掉第一个（社区报告，本机未复现），双账号建议走网页授权。
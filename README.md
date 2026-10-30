# 积分中枢 · DSH Credit Hub

[![Plugin CI](https://github.com/spdw666/dsh-credit-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/spdw666/dsh-credit-hub/actions/workflows/ci.yml)

**DSH 原生多平台账号、模型路由、错峰签到、事件通知与额度预测插件。** 当前正式发布版 **0.2.6**。

Native DSH account and model routing management with staggered check-ins, event notifications, and measured quota forecasts.

## 安装

使用 [GitHub Release](https://github.com/spdw666/dsh-credit-hub/releases/latest) 中的预构建包，无需在安装时重新构建前端：

```sh
dsh plugin add https://github.com/spdw666/dsh-credit-hub/releases/latest/download/dsh-credit-hub.tgz
```

也可通过 GitHub 源安装；仓库已提交 `lib/` 与引擎必要预构建文件：

```sh
dsh plugin add github:spdw666/dsh-credit-hub
```

本项目已被插件市场收录，市场条目使用同一稳定 tarball 地址。完整稳定 Release 更新该地址的新安装／显式重装目标；GitHub 提交、Release 资产、市场原生更新徽标与实际安装升级分别核验。

### 运行条件

- 宿主提供官方 `@deepseek-ai/*` 与 React，不打包或替换一份 DSH。
- 独立 worker 需要 **Node >=22.23.3 且支持 `node:sqlite`**；`package.json` 的 `engines.node` 已是 `>=22.23.3`，更低的 Node 会在安装阶段被拒绝，而不是装好后起不来。优先使用显式配置，其后检测现有 task runtime、DSH 自带独立 Node、PATH。每个候选会真实执行 SQLite 内存查询，Electron 命令包装器不当作独立 Node；没有合格候选时，错误信息会列出探测过的候选及其 Node 版本。
- 默认数据位于 DSH 用户目录的 `plugins/credit-hub`。可通过插件配置指定 `taskRoot`、`configFile`、`nodeExecutable`、`allowScheduler`。
- 部分平台另需其登录态、原生身份或独立运行资产。千问办公的特定编码链额外需要 **Python + cryptography + wasmtime**（可选）；缺少这些条件只影响该平台的编码能力，其他平台管理与其他账号不受影响。

## 使用入口

**DSH 设置 → 积分中枢**，包含账户、模型路由、签到任务、用量记录、接力策略、设置。具备主面板/侧栏能力的版本另有侧栏入口，早期版本使用设置入口。

模型提供方 ID 为 `credit-hub`。本插件拥有独立账号快照、SQLite、刷新缓存与日志，不依赖原 AI 积分网关服务；同一官方账号的额度、限流与令牌状态仍是共享上游状态。

## 主要功能

### 后装 Agent 自动发现

默认每 60 秒检查受支持客户端的已知登录位置。可解析的已登录格式会复制到插件独立目录，识别身份，建立账号/上游，再获取实际模型目录；新路由默认启用，可在账户页关闭。原客户端只读，既有账号开关与路由保持。同一身份更新、不同身份新增。新账号自动登记已核实的签到/每日额度任务，只有用户启用全局排程后才执行；既有账号的任务与禁用选择不覆盖。

候选包含 WorkBuddy、Trae、千问办公、ZCode、MiniMax、Qoder、CodeBuddy、CodeArts、Cline、LobsterAI、Loomy、小浣熊和 OpenCode 的已知版本路径。未安装、未登录、需要独立配置、已接入及目录失败分开呈现。加密 WorkBuddy、Qoder 原生身份、MiniMax lease、OpenCode 独立服务等条件未满足时不会伪装成已接通。SQLite/WAL 与 Trae 身份元数据纳入内容校验。

### 账号与模型

- 账号启用与模型调用资格分开控制；模型调用关闭不代表签到关闭。
- WorkBuddy 国内/国际 JSON、ZIP、workbuddy-switch JSON 先预览再确认导入，支持选择导出；不将此格式冒充所有平台通用格式。
- 模型目录、账号快照接入和真实调用成功分别记录。
- 接力保留完整 messages、tools、tool IDs/results 与输出预算，不为回退裁剪上下文。

### 显式删除与防重新导入

账号页提供确认删除。删除插件内账号、上游与路由引用，清理独占的插件自有凭据，不为这次删除新建含凭据的恢复备份。共享文件和原客户端目录保持不动；清理结果如有保留项会明确返回。

插件仅保留不含 token 的删除指纹，后台发现重复扫描或重启后不会自动重新导入同一已删除主体；客户端换成另一主体仍能接入。401／403 等认证错误不会自动认定封禁或自动删号。删除仅影响本插件，不修改独立 AI 积分网关项目。

### 错峰签到

每平台配置时间窗口、窗口内持久随机预约、启动补跑分散与全局并发上限。当天从未尝试项可以补跑；明确尚未提交的临时网络/限流失败按 retryMinutes 与官方退避提示重试。未确认、运行中与缺乏阶段证据的旧失败不因重启重放。Qoder 按官方 10:00 活动边界登记新窗口。自动/手动共享有界队列，同账号串行，支持“今日未签到”、单个/已选/全部补签。跨午夜及 DST 按真实时区时刻处理。

**新安装自动签到默认关闭**。用户在设置中启用排程后，启用选择持久化，后台自恢复或 DSH 下次启动继续执行；关闭排程仍立即生效。后台发现和版本检查不等于签到；启用排程、手动补签和任务执行是不同操作。

| 平台 | 自动任务与验收依据 |
| --- | --- |
| WorkBuddy / CodeBuddy / Qoder / 国内 Trae / MiniMax / CodeArts / LobsterAI | 官方活动状态 → 领取 → 再查官方已领取状态；活动未开放与登录失效单独提示 |
| Loomy | 每日 first-login 额度刷新，与同日日期、每日额度和余额交叉核验；不是宠物打工奖励 |
| 商汤小浣熊 | 登录奖励触发后核验当日官方积分账单；保留 observed 语义，不把已有余额算作新赚积分 |
| 千问办公 | 查询官方每日自动额度，不伪造主动签到 |
| ZCode | 仅官方当前提供的免费套餐领取，可能有交互验证；不是每天固定发放 |
| BigModel / Antigravity / NVIDIA / FreeAPI / Cline / OpenCode / 国际 Trae | 当前没有已核实的每日签到适配，不生成虚假成功记录 |

CodeArts 领取与确认分阶段处理；领取响应丢失后仅核查官方状态，已 CLAIMED 时只补确认。CodeArts 与小浣熊追加有界只读后验，不因返回延迟重复领取。LobsterAI 使用官方活动提供的 check_in 动作与实时活动版本。领取前发现登录失效时保留 action_required 提示，并按 retryMinutes 间隔重新核验登录态；客户端重新登录被发现后，后续核验可恢复正常执行。领取后出现不明结果则保持 uncertain，不进入该重试路径。

### 事件 → 通知出口

签到失败、凭据 N 天内过期、余额低于阈值、接力触发、连续三次最终请求失败、版本更新，可映射到 DSH 内通知或通用 Webhook/IM 接收器。事件使用固定脱敏摘要、持久队列、去重与有限重试，不外发 token、原始账号身份或完整上游错误正文。

DSH 隐藏/失焦时保留通知，聚焦显示后确认；这是应用内通知，不冒充操作系统推送。Webhook 以 2xx 确认通用 JSON 信封接收，特定 IM 厂商业务码由接收器转换。Webhook 地址/请求头只存本地私有设置，普通快照不返回这些值。

### 额度 burn-down 与预留建议

按最近七天同单位计费数据，或可比较的余额净下降，计算消耗速度、预计耗尽时间和逐账号预留建议：

```text
预计耗尽小时 = 当前同单位余额 / 每小时可测消耗
建议预留 = 每小时消耗 × 距下次签到/续费小时 × 安全系数
建议比例 = 建议预留 / 已知总额度 × 100%
```

默认安全系数 1.25，可逐账号填写续费/补充时间。至少三个有效样本和 24 小时测量跨度；缺测不填零、Token 不换算积分、充值上升不算负消费、陈旧/过期余额不输出精确耗尽时间。显示覆盖率、来源和假设，不冒充完整官方账单。单账号建议不自动覆盖全局接力阈值，超过原引擎 50% 比例上限会明确提示。

### 版本提醒

默认每小时检测 `repository` 对应的 GitHub `package.json.version`，也支持 HTTPS 清单/npm 元数据。发现更高版本进入事件出口，不后台覆盖运行代码；仓库版本提示本身不证明 Release 安装包已经就绪，也不证明市场已收录。

正式更新需要递增版本、构建并发布带有同名 `dsh-credit-hub.tgz` 的完整 GitHub Release，稳定 latest 链接随后供新安装或显式重新安装取得新包。市场的更新徽标取决于市场客户端对安装来源的支持，不与本插件的版本提醒混为一谈；当前 dshmarket 的 tarball URL 安装不走 GitHub Release 自动版本比较。`link:` 开发安装由本地源码控制，不冒充市场安装。仅 push 同版本代码不等于发版。

## 界面示例

以下是实际 React 管理页和独立引擎使用 **SAMPLE 测试数据**的截图，不是任何用户真实账号：

![账号管理](docs/screenshots/accounts-sample.png)

![额度预测](docs/screenshots/forecast-sample.png)

## 兼容证据

已审计 35 个已知官方 tag（0.1.0-rc.7～0.2.1-rc.5）的源码/API，并逐版执行真实 Typert、LLM、PiAiAdapter 模块契约，保留旧 stream 与新版 snapshot/prepare 分支。13 个早期 tag 使用设置页入口。

这不是 35 个完整历史桌面安装验收。0.2.1-rc.5 已执行固定 tag 官方模块契约与真实 SDK 下的插件回归；另以本机现装 rc.5 官方运行层启动了独立空白 Host，原生提供方／模型发现注册与连续心跳通过，退出后测试 Host 和 worker 均已关闭；此项不冒充原用户窗口激活。历史完整桌面验收为 0.2.1-rc.2。未来版本按能力检测，不预先声称已实测。公开矩阵位于 `test-fixtures/compatibility-matrix.json`。

## 开发

### 后台守护（0.2.3）

插件加载后由 DSH 宿主启动并守护独立 worker；最初一次 worker 启动失败也会重试。宿主每 5 秒发送一次本地 IPC 心跳，单次期限 3 秒，连续 3 次失败后回收旧进程并重建；进程退出或 IPC 断开也会进入恢复。心跳不调用上游模型或签到接口，只证明本地事件循环与 IPC 有响应。

重启采用 0.5–30 秒指数退避与 20% 抖动；5 分钟内达到 5 次重启后冷却 60 秒再试。恢复时先确认旧进程退出，同一宿主控制器不重叠启动；宿主从长暂停恢复时有 15 秒观察宽限。正常关闭 DSH、禁用插件时停止守护并退出子进程，不额外安装系统服务。

每次新的生成调用先等待后台就绪（最多 10 秒，可取消）；新 generation 会刷新模型目录、回环地址、私有密钥与请求策略，旧代迟到目录不覆盖新状态。旧 prepared call 返回可识别的 503，调用方重新准备；已经发出的生成、已输出部分内容的流或管理动作不自动重放。上游 429、额度不足与普通业务请求超时不触发健康后台重启。

宿主快照中的 `worker.status/generation/restarts/heartbeatMisses/lastHeartbeatAt/nextRetryAt` 提供恢复状态。该机制适用于 DSH 宿主仍运行时；DSH 宿主退出、系统休眠或上游平台自身故障有各自的生命周期，不宣称无间断连接。GitHub Release 与插件市场收录是独立状态；更新已有安装需要版本递增和完整的新 Release，单纯 push 不等于发版。

```sh
npm ci --legacy-peer-deps
npm run sdk:install
npm run build
npm test
npm run test:engine
npm run verify
```

`sdk:install` 只用于开发/CI，默认安装锁定的 0.2.1-rc.3 官方 SDK；设置 CREDIT_HUB_TEST_DSH_VERSION=0.2.1-rc.2 可回归上一宿主版本。CI 对 rc.2/rc.3 分别构建、测试和打包；生产宿主提供这些接口。Qwen 离线编码测试可设置 `CREDIT_HUB_TEST_PYTHON` 为装有 cryptography/wasmtime 的 Python；未配置的额外平台测试会明确跳过。CI 会安装这些依赖并执行。

`lib/client.js` 使用官方 `__ModuleLoader__`、slots 与 Connection RPC/Typert，无 iframe。发布包保留预构建客户端和 vendor 核心。构建/测试不需要真实账号或上游生成。

## 派生与许可证

独立包名 `dsh-credit-hub`，并非覆盖原项目。引擎派生自 [spdw666/multi-agent-checkin-dsh](https://github.com/spdw666/multi-agent-checkin-dsh) 0.6.0 的 MIT 核心；原生 UI、隔离 worker、发现/通知/预测/调度与兼容集成为本项目实现。保留原许可证和第三方归属，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、`engine/THIRD_PARTY_NOTICES.md` 与 vendor 许可证。

MIT. See [LICENSE](LICENSE).

### ZCode 全权益模型标准代理

0.2.5 将 ZCode 模型转发接入固定版本的标准 OpenAI 代理链，按当前账号官方权益目录导入，而不是把参考兼容表当成可用模型。2026-10-24 核验目录为 `glm-5.3` 与 `glm-5.3-flash`；两者元数据为 1M 上下文、128000 输出、low/high/max 强制思考。原始消息、完整工具定义与工具结果均保留。

ZCode 需另有 Bun、Git 和当前原生登录态；运行层安装在插件私有 dataDir，不复用其他网关的进程、key 或数据。完整安装与诊断见 [ZCode 说明](docs/zcode.md)。固定第三方运行层采用 CC-BY-NC-SA-4.0，完整许可与修改说明见 `integrations/zcode-standard-proxy/`，不纳入本项目 MIT 许可。

官方 3012 与本地冷却分开标记，本地拦截不计为已请求官方；不自动重发或换供应。升级保留现有账号、删除指纹、路由开关及 DSH 默认模型。

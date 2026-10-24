# ZCode 完整标准代理

积分中枢支持可选的独立 ZCode 标准代理。它复用已固定版本的完整标准协议转换路径，把 DSH 的原始 OpenAI 请求、完整工具 schema、调用 ID、工具结果和输出预算交给相同账号的官方模型；DSH 仍然负责文件、命令和其他工具的实际执行。代理不替换 DSH Agent，不借用原 AI 积分网关后台。

## 模型目录与边界

模型清单来自插件当前账号的官方权益目录与已导入路由，而不是代理内的静态型号表。安装器读取全部已导入 ZCode 路由的目标模型，包括用户暂未启用的路由；安装不更改其启用状态。兼容别名不等于新增权益。每个实际目录型号都应分别完成普通响应、SSE 和工具结果回填验证，不能用 `/health`、目录可见或余额有值代替模型成功。

```text
现用 DSH
  → 积分中枢的路由、账号、完整请求与同账号冷却门控
  → 插件私有密钥认证的 loopback 标准代理
  → 固定版本 ZCode 标准协议链路
  → 官方模型响应
  → 原 DSH 执行工具并回填结果
  → 同一路线返回最终正文
```

## 独立安装

插件的 Node.js 运行时之外，可选代理还需要 **Bun** 与 **Git**。Bun、Git 和完整上游 runtime 不被塞进插件包。先在 ZCode 官方客户端完成登录，再在积分中枢保存账号并导入当前模型目录。

从已安装插件目录运行以下命令；`NODE_EXE`、`BUN_EXE`、`PLUGIN_PROFILE_CONFIG` 和 `INSTALLED_ZCODE_VERSION` 必须替换为本机实际值。`PLUGIN_PROFILE_CONFIG` 是本插件自己的配置，不是原网关或原 ZCode 客户端配置。应用版本从当前安装的 ZCode 产品版本或其 `resources/app/package.json` 只读核对，不把文档示例版本设成默认值。

```powershell
& 'NODE_EXE' scripts/setup-zcode-standard-proxy.mjs `
  --config 'PLUGIN_PROFILE_CONFIG' `
  --app-version 'INSTALLED_ZCODE_VERSION' `
  --bun 'BUN_EXE'
```

安装器会：

1. 校验当前插件配置和 ZCode 模型目录。
2. 在 **该配置的 `ConfigStore.dataDir/zcode-standard-proxy`** 获取固定提交，校验 handler 与完整 LICENSE，应用可选响应观察钩子，并按锁文件安装依赖、构建 worker。
3. 生成独立本机密钥和空闲 loopback 端口；重复安装复用这份配置的原密钥与端口。需要指定端口时增加 `--port PORT`。
4. 生成同一目录的 `runtime.json`、`bridge-private.json`、`config.json`、`bridge.ts` 和来源记录。**不在插件源码或 `engine/src` 写私有运行配置。**

安装不发送模型生成、套餐领取或每日签到请求，不新增账号，不改账号／路由开关。运行时通过当前账号凭据逐次派发；上游登录 store 不共享，原网关 bridge、密钥、数据库、原客户端目录均不复用。

已有干净的固定提交 checkout 时，可以增加 `--source 'PINNED_CHECKOUT'`。脚本只复制固定提交跟踪的普通文件，不复制其未跟踪登录材料、`node_modules` 或其他用户文件。依赖缓存不足时仍需联网。来源记录缺失的现存 runtime 会被保留，不直接覆盖。

## 按需启动与重载

安装本身不启动代理。积分中枢在模型请求需要代理时隐藏启动它，并检查已认证 `/health`；后续请求复用该独立进程。代理只监听 `127.0.0.1`，没有有效本机密钥的健康检查和模型请求均返回 **401**。本机桥密钥与上游账号认证分别传输，私有桥接头不被发送到官方上游。

独立 bridge 不启动上游 CLI／Agent 主程序，关闭其 **claim、auto-claim、idle/async、高速模式、Responses store、MCP、面板和更新检查**。唯一向官方派发模型请求的入口是经认证、附有当前账号信息的 `/v1/chat/completions`。原 DSH 的完整工具执行权保持。

更新脚本、bridge 或真实客户端版本后，先等待在途请求结束，再停止属于该配置的旧代理，并只重载积分中枢插件。安装回执中的 `restart_required=true` 不是“已经替你完成重载”。更新一个插件 worker 也不代表其他独立网关进程已更新。

## 核验与错误

可复用的原 DSH 工具闭环提示词：

```text
保持当前所选模型、账号和全部原工具。请使用你原有的文件读取工具读取 SAMPLE_FILE；收到真实工具结果后，只回复文件中 CHECK= 后面的值。不要猜测，不切换模型，不修改设置。
```

使用不含敏感信息的新建随机测试文件，逐模型记录：实际路由／型号／有效推理策略、保留的工具数量与输出预算、真实工具调用及匹配 ID 的结果、下一轮回填、最终值是否匹配；再停止本插件自己的代理重复一次，验证按需冷启动。结束后恢复用户原模型选择。

3012 等官方业务错误保留原始 HTTP 状态和业务码。3012 触发的同账号本地冷却会拦住后续模型请求，不自动重放；本地剩余退避时间不是官方解封时间。同账号换型号被本地门控挡住，也不是该型号又真实发出一次官方失败请求。

回滚时只恢复本次插件源码／安装文件，并停止这份配置的代理后重载插件；账号、路由、选择与历史保持。先在独立副本验证哈希和行为；不把停进程当成回滚完成，也不为回滚恢复用户已删除的凭据。

## 固定来源与许可证

- [TriDefender/zcode-api v4.8.5](https://github.com/TriDefender/zcode-api/tree/9880d91579fdb9d3e59c2bb900add3ab86722003)，提交 `9880d91579fdb9d3e59c2bb900add3ab86722003`。
- Copyright (c) 2026 TriDefender and the ZCode Proxy contributors；**CC-BY-NC-SA-4.0**，完整未改写文本位于 `integrations/zcode-standard-proxy/LICENSE.zcode-api` 和安装 runtime 的 `LICENSE`。参见 [Creative Commons 官方条款](https://creativecommons.org/licenses/by-nc-sa/4.0/)。
- 本项目的 `upstream-response.patch` 只增加可选响应观察回调，保留该上游派生修改的原许可；插件自己的 MIT 不扩张到完整 runtime。
- `engine/vendor/zcode-context` 的历史 MIT 固定快照是另一份组件，不能用其许可重新标注本次 runtime。完整归属见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) 和 [NOTICE.md](../integrations/zcode-standard-proxy/NOTICE.md)。

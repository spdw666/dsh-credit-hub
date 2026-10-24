# Third-party notices

## 独立项目与派生关系
积分中枢 (dsh-credit-hub) 的 DSH 原生 UI、Typert 接口、独立 profile 与安装/隔离机制为本项目新增实现。
engine/ 是从 spdw666/multi-agent-checkin-dsh 0.6.0 (commit 72f672705fc1a09b4cb7019720079447f3970236) 只读复制的 MIT 派生核心，保留 LICENSE 与完整归属说明，不依赖原项目服务、配置或源码目录。

原项目的依赖、客户端适配来源及其许可证详见 engine/THIRD_PARTY_NOTICES.md 与 engine/vendor/ 内各许可证。plugin/retry-metadata.mjs 与 provider.mjs 中的请求策略结构派生自该核心的MIT DSH适配层；该层原来源包含 dingminhua/dsh-connect-trae (MIT)，原作者说明完整保留。

## 官方 DSH
@deepseek-ai/* 作为 peerDependencies，不打包宿主副本。React与官方客户端模块由DSH宿主提供。DSH程序不在本插件包中重分发。

## Node.js
本机预览使用单独复制的 Node.js 22.23.3，不进入插件tarball。Node许可证随本地runtime保存。

## Development tools
esbuild 0.28.2 (MIT) 仅用于构建。

## 可选 ZCode 完整标准代理

- [TriDefender/zcode-api v4.8.5](https://github.com/TriDefender/zcode-api/tree/9880d91579fdb9d3e59c2bb900add3ab86722003)，固定提交 `9880d91579fdb9d3e59c2bb900add3ab86722003`；Copyright (c) 2026 TriDefender and the ZCode Proxy contributors；**CC-BY-NC-SA-4.0**。完整未改写许可证随包保存为 `integrations/zcode-standard-proxy/LICENSE.zcode-api`，安装的独立 runtime 继续保留自己的 `LICENSE`。
- `integrations/zcode-standard-proxy/upstream-response.patch` 给该上游 handler 增加可选响应观察钩子，属于本项目标注的上游派生修改，保留原 **CC-BY-NC-SA-4.0** 归属。插件自己的 MIT 声明不扩张到独立 runtime 或其派生补丁。
- 本机桥、安装脚本与隔离配置参考原 MIT AI 积分网关的同名模块后适配到独立插件；不依赖原网关路径、bridge 密钥、数据库或账号配置。上游完整 runtime、Bun、Git 和用户凭据不随插件 tarball 打包；安装时只获取固定提交及锁定依赖。
- `engine/vendor/zcode-context` 是另一个历史固定提交的上下文模块，原 MIT 归属不用于重新标注本次 v4.8.5。更多改动说明见 `integrations/zcode-standard-proxy/NOTICE.md` 与 `docs/zcode.md`。

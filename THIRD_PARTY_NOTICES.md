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
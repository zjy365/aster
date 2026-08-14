# Aster

Aster 是一款追求响应速度的本地优先 Kubernetes 桌面工作台，由 Electron 桌面壳与窄接口 Go sidecar 构成，以 lazy Kubernetes client、原生服务端分页和虚拟化资源表取代 Web 平台、全局缓存与全量列表渲染路径。

## 当前进度

当前 v0.1 版本已经包含：

- Electron main/preload/renderer 隔离与类型化 `window.aster` API。
- 只监听 loopback、使用一次性 Bearer token 的 Go sidecar。
- 不泄露凭据的默认 kubeconfig Context 发现。
- 支持常用 Kubernetes 资源目录（工作负载、流量、存储、配置和 RBAC）的 lazy dynamic list/get 与去敏详情投影。
- Kubernetes 原生分页和 selector。
- 虚拟化资源表、资源 Inspector 和去敏 YAML。
- 原生 scoped Kubernetes watch、bookmark、断线重连与过期 ResourceVersion reset。
- Deployment、StatefulSet、DaemonSet 的 scale/image/restart 安全写操作，支持 server-side dry-run 与 ResourceVersion 冲突保护。
- Renderer 只读开关、dry-run 确认和只保存摘要的按 Context 持久化 operation journal。
- 选中资源的 Events 查询与去敏事件投影。
- 受限 Pod Logs 查询（tail 行数、4MiB 响应上限，不开启 follow 长连接）。
- 一次性 Pod Terminal（argv 校验、1MiB 输出上限，不开启持久 shell，也不记录命令）。

ConfigMap/YAML 编辑、一次性 Terminal、语义化 dry-run Diff 预览、基于 ownerReferences 的 Related 导航和按 Context 持久化的本地 operation journal 已从 Inspector 提供。Logs 当前是有上限的一次性读取；follow 长连接和更完整的关系图导航不在本 v0.1 范围内；Secret 写操作明确禁用。

## 开发

需要 Node.js 22.19+、pnpm 10.12.2 和 Go 1.26+；连接真实集群时需要已有 kubeconfig。

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm dev
pnpm run pack
```

Aster 不创建 ServiceAccount、ClusterRole 或 ClusterRoleBinding，不包含用户数据库、OAuth、平台 RBAC、AI、Connector、遥测、全局 informer/cache。

## 致谢

感谢 [Kite](https://github.com/kite-org/kite) 及其贡献者在 Kubernetes 资源导航与工作流方面带来的启发。

## 许可证

Aster 使用 Apache License 2.0 许可证。

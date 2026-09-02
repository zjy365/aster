# Aster 快速上手

[English](quickstart.md) · [简体中文](quickstart.zh-CN.md)

Aster 读取的是和 `kubectl` 相同的 kubeconfig。只要你的机器上
`kubectl get pods` 能跑通，Aster 就能用——打开它，选一个集群即可。

## 1. 获得一个集群

已经有集群（EKS/GKE/AKS 等托管集群、家里的小实验室、公司的 context）？直接跳到下一步。
最快的本地集群方式是 [kind](https://kind.sigs.k8s.io/)：

```bash
# macOS
brew install kind
kind create cluster
```

```powershell
# Windows
winget install --id kind.sigs.k8s.kind
kind create cluster
```

其他选择：[minikube](https://minikube.sigs.k8s.io/)、[k3d](https://k3d.io/)，
或任意托管集群。它们都会写入 kubeconfig，Aster 会自动识别。

## 2. 把集群加进 Aster

- **在 `~/.kube/config` 或 `$KUBECONFIG` 里？** 首次启动时它们就已经出现在集群选择器里，无需任何配置。
- **在其他位置？** 打开 **设置 → Kubeconfig**，添加单个文件、整个目录，或直接粘贴 kubeconfig 内容。

## 3. 关键快捷键

Aster 以键盘为主，菜单只是兜底。

| 按键 | 作用 |
|---|---|
| `⌘K` / `Ctrl+K` | 命令面板——切换集群、直达任意资源类型、切换命名空间、按名称全集群搜索、切换主题 |
| `⌘F` / `Ctrl+F` | 过滤当前资源列表 |
| `↑` `↓` `⏎` | 移动与打开 |
| `Esc` | 逐层后退 |

之后：点击任意一行即可查看资源详情、拉取日志、编辑 YAML。所有写操作都会先经过
一份需要你确认的 dry-run diff，才会真正执行。

## 获取帮助

- 提交问题：<https://github.com/zjy365/aster/issues>
- 源码与发布：<https://github.com/zjy365/aster>

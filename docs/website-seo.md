# Aster 官网 SEO 维护

正式站为 `https://aster.zjy365.dev`，源码只在 `apps/landing/`。官网使用 Next.js 静态导出，与桌面应用的构建和运行时分离。

## 页面职责与内容树

采用本机哥飞教程的搜索意图、内容树、可抓取正文和双向内链方法。首页说明「free open-source Kubernetes GUI」，连接全部指南与下载入口；文章索引和文末相关链接帮助读者继续查找。

| 入口 | 对应任务 |
| --- | --- |
| `/blog/lens-alternatives/` | 根据工作流比较 Kubernetes 客户端 |
| `/blog/kubernetes-gui/` | 区分桌面、Web 与终端界面 |
| `/blog/k9s-alternatives/` | 判断何时在 K9s 之外使用桌面客户端 |
| `/blog/kubernetes-log-viewer/` | 阅读 Pod / workload 日志并理解保留边界 |
| `/blog/local-kubernetes-dashboard/` | 从已有 kind / minikube 开发集群连接本地界面 |

正文与元信息的数据源为 `apps/landing/content/articles.tsx`，不是 `content-drafts/`。文章仅在构建时生成，文中链接、目录和正文不依赖浏览器执行脚本。新文章加入后，索引、首页列表、静态路由和 sitemap 从同一数据源生成；相关链接仍需明确选择。

搜索主题来自实际产品任务和搜索结果结构，尚未核验本站查询级 Search Console 数据或关键词搜索量，不把这些主题表述为已验证的流量或商业机会。

## 事实与元信息规则

- Aster 能力声明以 `PRODUCT.md` 和当前 `core/` 为准。受限的一次性容器命令不是“无 exec”，也不是持续交互 Shell；支持的写操作不等于任意资源编辑。
- 不编造启动速度、安装包体积、客户反馈、性能对比或数据统计。不同产品的安装包大小、账号和价格要求随版本变化，不沿用旧草稿直接下结论。
- 竞品能力查官方文档。K9s 已有日志与管理能力，kubectl logs 支持 follow、selectors、多个来源等参数；不要通过错误描述制造 GUI 的优势。
- 对比文章说明作者与 Aster 的关系，将选择标准与实测结果分开，不把技术栈当作性能证据。
- `lib/seo.ts` 统一标题、描述、canonical、OG 与 Twitter。每页自指规范网址，分享图片必须实际生成；文章结构化数据对应可见标题、摘要和面包屑。
- Next.js 导出的 `/opengraph-image` 没有文件扩展名；保留 `apps/landing/public/_headers` 的 `Content-Type: image/png` 规则，并在正式域名检查响应类型，避免被静态托管当作二进制下载文件。
- 不把所有构建时间写成真实内容更新时间，不设固定字数或关键词密度，不改已有链接。经验规则以 [Google SEO 入门指南](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)校准。

## 验证

在仓库根目录执行：

```fish
pnpm --dir apps/landing typecheck
pnpm --dir apps/landing test
pnpm --dir apps/landing build
python3 apps/landing/scripts/verify-site-seo.py apps/landing/out https://aster.zjy365.dev
git diff --check
```

SEO 检查使用 Python 3 标准库，读取真实导出文件，验证非空 sitemap、独立标题与摘要、单一 H1、canonical、分享信息与图片、JSON-LD、站内链接和首页可达性。浏览器另查首页、文章索引和代表文章的桌面/手机布局。

提交或部署前检查当前分支与远端主线的差异，避免覆盖已在线的统计或收录修复。不要为了同步而丢弃已有本地工作。部署后从公网复查页面、robots 和 sitemap，再观察 Search Console 的索引、查询与点击；请求收录不是排名保证。

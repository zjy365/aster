# Aster macOS 签名 + 公证 + 发布流程

> 本文档记录 Aster 从本地签名到 GitHub Releases 分发的完整流程，基于 v0.1.0 实际发布验证。
> 适用：macOS 分发包（.dmg / .app）。不涉及 App Store 上架（Aster 走 GitHub Releases 分发，不需要 App Store 审核）。

## 背景概念

- **不上架 App Store 不需要 App Store 审核**，但 **公证（Notarization）必须做**。2020 年起 Apple 强制所有 macOS 分发（不限渠道）都必须公证。
- **公证是自动化检查**（签名校验 + 恶意软件扫描），不是人工审核，几分钟出结果。
- 需要 **付费 Apple Developer 账号**（$99/年）。免费账号只能本地调试，不能签发发布证书。

### 两个容易混淆的证书

| 证书 | 用途 | 能否分发 |
|---|---|---|
| `Apple Development: xxx (TEAMID)` | 本地调试 | ❌ 用户装不了，Gatekeeper 拒绝 |
| `Developer ID Application: xxx (TEAMID)` | **分发 .dmg / .app** | ✅ 配合公证通过 |

发布必须用 **Developer ID Application** 证书。本地通常已有一张 Apple Development 证书，不要用错。

## 一、申请 Developer ID 证书（一次性）

### 1. 生成私钥 + CSR

```bash
openssl genrsa -out ~/aster-dev-key.pem 2048
openssl req -new -key ~/aster-dev-key.pem \
  -out ~/aster-dev.csr \
  -subj "/C=CN/O=Aster/CN=Jingyang Zhu"
```

- 私钥 `~/aster-dev-key.pem` 权限 600，**不要外传**（泄露=签名被冒用）。
- CSR 就是拿去 Apple 换证书的"申请表"，不含私密内容。

### 2. 申请证书（浏览器）

1. 打开 https://developer.apple.com/account/resources/certificates/list
2. 点右上角 **+** → 选 **Developer ID Application**（不是 Apple Development / Mac App Distribution / Developer ID Installer）
3. 上传 `~/aster-dev.csr` → 下载 `developerID_application.cer`

### 3. 导入钥匙串 + 导出 p12

```bash
# 导入证书
security import ~/Downloads/developerID_application.cer -k ~/Library/Keychains/login.keychain-db

# 生成 p12 导出密码（随机 20 位，存文件备用）
openssl rand -base64 24 | tr -d '/+=' | cut -c1-20 > ~/.aster-p12-password
chmod 600 ~/.aster-p12-password

# 导出 p12 —— 必须用 -legacy！OpenSSL 3 默认算法 macOS 钥匙串不认
openssl pkcs12 -export -legacy \
  -out ~/aster-signing.p12 \
  -inkey ~/aster-dev-key.pem \
  -in ~/Downloads/developerID_application.cer \
  -name "Developer ID Application: Jingyang Zhu (TEAMID)" \
  -passout file:/Users/<user>/.aster-p12-password

# 导入 p12 到钥匙串（补全签名身份）
security import ~/aster-signing.p12 \
  -k ~/Library/Keychains/login.keychain-db \
  -P "$(cat ~/.aster-p12-password)" -T /usr/bin/codesign

# 验证：应看到 Developer ID Application 身份
security find-identity -v -p codesigning
```

> ⚠️ **坑**：OpenSSL 3.x 导出的 p12 默认用 PBES2/AES 加密，macOS 钥匙串导入会报 `MAC verification failed`。必须加 `-legacy`（传统 3DES/SHA1）。

## 二、生成 updater 签名密钥（一次性）

Tauri 自动更新需要自己的签名密钥对（与 Apple 证书无关）：

```bash
pnpm --dir apps/desktop tauri signer generate -w ~/aster-updater.key -p "你的密码"
```

- 私钥 `~/aster-updater.key` + 公钥 `~/aster-updater.key.pub` + 密码，都保管好，**丢失则更新功能永久失效**。
- 把公钥内容填进 `apps/desktop/src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`（替换占位符）。
- 密码存 `~/.aster-updater-password`（chmod 600）。

## 三、本地验证签名（推荐发布前做）

```bash
pnpm --dir apps/desktop tauri build
```

### 已知问题 1：本地打包不自动签名

本地 `tauri build` 默认 **adhoc（linker-signed）不签名**。需要手动用 Developer ID 签名：

```bash
codesign --force --deep --sign "Developer ID Application: Jingyang Zhu (TEAMID)" \
  --options runtime --timestamp \
  --entitlements apps/desktop/build/entitlements.tauri.plist \
  apps/desktop/src-tauri/target/release/bundle/macos/Aster.app
```

验证：

```bash
codesign --verify --deep --strict --verbose=2 \
  apps/desktop/src-tauri/target/release/bundle/macos/Aster.app
```

### 已知问题 2：tauri CLI 2.11.4 DMG 打包 bug

`tauri build` 到 DMG 阶段报 `failed to run bundle_dmg.sh`（脚本被放在 `dmg/` 根目录导致找不到 support + 参数错位）。**手动调用同一脚本可成功**：

```bash
cd apps/desktop/src-tauri/target/release/bundle/dmg
./bundle_dmg.sh \
  --volname "Aster" --volicon ./icon.icns \
  --window-size 500 350 --icon-size 128 \
  --app-drop-link 400 220 \
  apps/desktop/src-tauri/target/release/bundle/dmg/Aster_0.1.0_aarch64.dmg \
  apps/desktop/src-tauri/target/release/bundle/macos/Aster.app
```

> CI 用同一个 CLI（2.11.4），**同样可能踩这个 bug**。若 CI 的 DMG 阶段失败，在 release 工作流 tauri-action 后加一步用上面命令补生成。

## 四、公证（Notarization）

### 1. 生成 App 专用密码

https://account.apple.com/sign-in → 登录与安全 → App 专用密码 → 生成（如 `Aster Notarization`）。
**App 专用密码 ≠ 账号主密码**。这个密码同时用于公证和 CI 的 `APPLE_PASSWORD`。

### 2. 提交公证

```bash
cd apps/desktop/src-tauri/target/release/bundle/dmg
xcrun notarytool submit Aster_0.1.0_aarch64.dmg \
  --apple-id "你的Apple账号邮箱" \
  --team-id "你的TEAMID" \
  --password "你的App专用密码" \
  --wait
```

- 等 `Status: Accepted`。一般 5-30 分钟，高峰期可能 1 小时+，**没有网页进度**，只能盯终端或 `notarytool history` 查。
- 提交多次不会加速，重复提交反而拥堵。

### 3. 查询状态

```bash
xcrun notarytool history \
  --apple-id "邮箱" --team-id "TEAMID" --password "密码"
```

### 4. 装订票据（Stapling，公证通过后）

```bash
xcrun stapler staple \
  apps/desktop/src-tauri/target/release/bundle/dmg/Aster_0.1.0_aarch64.dmg
```

## 五、配置 GitHub secrets

入口：https://github.com/<owner>/<repo>/settings/secrets/actions （**New repository secret**）

| Secret | 值来源 |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `~/aster-updater.key` 内容 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `~/aster-updater-password` 内容 |
| `APPLE_CERTIFICATE` | `~/aster-signing.p12` 的 base64：`base64 -i ~/aster-signing.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | `~/.aster-p12-password` 内容 |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Jingyang Zhu (TEAMID)` |
| `APPLE_ID` | Apple 账号邮箱 |
| `APPLE_PASSWORD` | App 专用密码（与公证同一个） |
| `APPLE_TEAM_ID` | 团队 ID（证书里的括号值） |

> **TEAM ID 以证书/开发者后台为准**，不要凭记忆猜（v0.1 过程中出现过从开发证书猜错的情况）。

## 六、发布

```bash
git tag v0.1.0 && git push origin v0.1.0
```

触发 `release-tauri.yml`（签名 → 公证 → 装订 → 上传 draft release）。等 CI 绿后：
1. 去 GitHub Releases 把 draft 改成正式发布
2. 把下载链接填进 `apps/landing/lib/releases.ts`（现在是空数组，landing 显示 "unreleased"）

## 验证清单（发布前自检）

- [ ] 钥匙串有 `Developer ID Application` 身份（`security find-identity -v -p codesigning`）
- [ ] `codesign --verify --deep --strict` 通过，`TeamIdentifier` 正确
- [ ] DMG 生成成功且 `hdiutil verify` 通过
- [ ] 公证 `Status: Accepted`，stapling 完成
- [ ] 8 个 GitHub secrets 配置完整
- [ ] `tauri.conf.json` 的 `updater.pubkey` 与 `~/aster-updater.key.pub` 一致
- [ ] landing `releases.ts` 填了正式下载链接

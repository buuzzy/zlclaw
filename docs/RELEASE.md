# Sage 发布流程

本文档描述 Sage 桌面端从「写完代码」到「用户拿到新版本」的完整流程。iOS 端走 Capacitor + Railway，详见 `docs/ios/IOS_PLAN.md`。

---

## 0. 发布渠道一览

| 渠道 | 触发方式 | 用途 |
|---|---|---|
| **GitHub Release（CI 自动）** | `git push --tags` | 老用户应用内更新的来源；公开版本归档 |
| **本地手动打包** | `pnpm tauri:build:signed:<arch>` | 调试 / 内测期间私下分发完整安装包 |
| **Mac App Store** | 单独走 `tauri:build:mas`，详见 `docs/MAS.md`（如存在） | 正式公开后的主分发渠道 |

> 内测期间以私下渠道分发完整 DMG；GitHub Release 主要作为已安装用户的应用内更新通道。

---

## 1. 版本号管理

四处文件的版本号必须保持一致：

- `package.json`
- `src-api/package.json`
- `src-tauri/tauri.conf.json`（用户可见的应用版本）
- `src-tauri/Cargo.toml`

用 `scripts/version.sh` 一次性同步：

```bash
./scripts/version.sh              # 查看当前版本
./scripts/version.sh 1.0.7        # 把所有文件改成 1.0.7
```

格式遵循 semver：`MAJOR.MINOR.PATCH` 或 `1.0.7-rc.1` / `1.0.7-beta.2`。

---

## 2. 标准发布流程（CI 自动）

```bash
# 1. 同步版本号
./scripts/version.sh 1.0.7

# 2. 提交版本变更
git add -A && git commit -m "chore: bump version to 1.0.7"

# 3. 打 tag 并推送（触发 CI）
git tag -a v1.0.7 -m "v1.0.7"
git push origin main
git push origin v1.0.7
```

**Tag 命名规则**（影响 CI 行为）：

- `v1.0.7` → 正式版，会更新 `latest.json`，老用户的客户端会检测到更新
- `v1.0.7-rc.1` / `v1.0.7-beta.1` / `v1.0.7-alpha.1` → prerelease，**不会**更新 `latest.json`，老用户不会被推送，只能手动下载

---

## 3. CI 工作流（`.github/workflows/release.yml`）

### Build matrix

| platform_name | runner | rust_target | 产物 |
|---|---|---|---|
| `mac-arm` | macos-14 | aarch64-apple-darwin | DMG + .app.tar.gz + .sig |
| `mac-intel` | macos-15-intel | x86_64-apple-darwin | DMG + .app.tar.gz + .sig |

> Windows x64 暂未启用，恢复方式见 `release.yml` 注释（取消 matrix include 注释 + Tauri build 加 `--bundles nsis`）。

### CI 必需的 Secrets

在 GitHub 仓库 Settings → Secrets and variables → Actions 配置：

| Secret | 用途 |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater Ed25519 签名私钥（base64） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 上述私钥的密码（生成时无密码就留空） |
| `VITE_SUPABASE_URL` | 前端编译时注入的 Supabase 项目 URL |
| `VITE_SUPABASE_ANON_KEY` | 前端编译时注入的 Supabase anon key |

### 产物文件命名

CI 会把 Tauri 默认产物重命名为 ASCII 兼容名（GitHub 不支持非 ASCII asset 文件名）：

- `sage-<version>-<triple>.dmg` — 安装包
- `sage-<version>-<triple>.app.tar.gz` — updater payload
- `sage-<version>-<triple>.app.tar.gz.sig` — updater 签名
- `latest.json` — 仅正式版生成，updater endpoint

---

## 4. 应用内更新机制（Tauri Updater）

### 配置

`src-tauri/tauri.conf.json`：

```json
"updater": {
  "pubkey": "...(Ed25519 公钥, base64)...",
  "endpoints": [
    "https://github.com/buuzzy/sage/releases/latest/download/latest.json"
  ]
}
```

### 工作流程

1. 用户客户端启动时（或定时）请求 `endpoints[0]`
2. CI 在每次正式发布时通过 `scripts/gen-latest-json.sh` 生成新的 `latest.json`，覆盖到 `latest` release tag 下
3. `latest.json` 内含每个平台的 `.app.tar.gz` 下载地址 + Ed25519 签名
4. 客户端比对版本号，若有新版则下载并用公钥验签，验签通过后替换 `.app`
5. 用户重启 App 即生效

### `latest.json` 生成

由 CI 自动调用：

```bash
./scripts/gen-latest-json.sh \
  <version> \
  ./artifacts \
  https://github.com/buuzzy/sage/releases/download/v<version>
```

`<artifacts_dir>` 必须按 rust target triple 命名子目录（CI 已经处理好），脚本会拼接出每个平台的下载 URL 并校验 jq。

---

## 5. 本地手动打包

调试或私下分发时使用。所有命令从仓库根目录运行：

```bash
# Apple Silicon
pnpm tauri:build:signed:mac-arm

# Intel Mac
pnpm tauri:build:signed:mac-intel
```

`tauri:build:signed:*` 等价于 `./scripts/build-signed.sh`，它会：

1. 自动加载 `configs/env/.env.tauri-signing`（签名密钥）
2. 自动加载 `configs/env/.env.production`（前端 Supabase 配置）
3. 调用对应平台的 `tauri:build:<arch>`

产物位置（以 mac-arm 为例）：

```
src-tauri/target/aarch64-apple-darwin/release/bundle/
├── dmg/Sage_<version>_aarch64.dmg
├── macos/Sage.app.tar.gz         ← updater payload
└── macos/Sage.app.tar.gz.sig     ← updater 签名
```

> macOS 上无法交叉编译 Windows（缺 MSVC 工具链），Windows 必须走 CI。

---

## 6. 签名密钥管理

### Tauri Updater 签名（必需）

- **CI 用**：GitHub Secrets 里的 `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- **本地用**：`configs/env/.env.tauri-signing`（已 gitignore，不入库）
- **离线备份**：`~/Documents/Projects/sage-tauri-signing-key-v2.txt`

公钥已固化在 `tauri.conf.json` 的 `updater.pubkey` 字段。私钥**永不能丢**——丢了就再也无法发布老客户端能验证通过的更新，所有现有用户必须手动重装。

### 重新生成签名密钥（紧急情况）

```bash
pnpm exec tauri signer generate --ci --password '' --write-keys ~/.sage-updater.key
```

把私钥内容写入 `configs/env/.env.tauri-signing`，把公钥替换到 `tauri.conf.json` 的 `pubkey`。**所有老用户的更新会失败一次**，需要他们手动重装新版本一次以替换公钥，之后才能继续应用内更新。

### macOS 公证签名（可选，非 MAS 渠道）

当前 release.yml 不做公证（apple notarization）。用户首次安装时会看到「无法验证开发者」提示，需要右键→打开。如要消除此提示，未来需要：

1. Apple Developer ID 证书
2. notarytool 凭据
3. 在 release.yml 里加 `xcrun notarytool submit ... --wait`

---

## 7. 回滚 / 撤回 release

```bash
# 删除 GitHub Release（保留 tag）
gh release delete v1.0.7 --yes

# 同时删除 tag
git push origin :refs/tags/v1.0.7
git tag -d v1.0.7
```

如果错误版本已经被部分用户更新拿到，唯一补救方式是立刻发布 `v1.0.8` 修复版本。Updater 不支持降级。

---

## 8. 已知限制

| 限制 | 说明 | 跟踪 |
|---|---|---|
| Windows x64 暂缓 | 历史原因为中文产品名走 WiX `light.exe` 编码 bug；产品已改名 Sage 后理论上可恢复，需要 CI matrix 解注释 + 加 `--bundles nsis` | TODO.md P3 |
| 暂未公证 | macOS Gatekeeper 首次启动需右键打开 | 待 Apple Developer 账号 |
| Tauri 默认 `targets: "all"` 会同时打 NSIS + MSI | Windows 恢复时务必加 `--bundles nsis` 跳过 MSI | release.yml 注释 |

---

## 9. 故障排查

### CI build 失败：`Failed to bundle project: Failed to sign updater`

→ 检查 `TAURI_SIGNING_PRIVATE_KEY` Secret 是否正确（base64，无换行/空格）。

### CI build 失败：`error: linking with 'cc' failed`（Intel runner）

→ macos-15-intel runner 偶发，重跑一次 workflow 通常能过。

### 用户应用内更新不弹提示

→ 按以下顺序排查：
1. `latest.json` 是否被生成（CI release job 日志）
2. `latest.json` URL 是否能匿名访问
3. 客户端的 `tauri.conf.json` 里 `pubkey` 是否跟当前签名私钥配对
4. 客户端版本号是否真的旧于 `latest.json` 里的版本

### 用户安装后双击「无响应/闪退」

→ 大概率是 macOS Gatekeeper 拦截。指引用户**右键点 Sage → 选「打开」**，弹窗里点「打开」确认一次即可，之后正常双击。

### CI 产物文件名包含中文导致上传失败

→ 不应再发生。`release.yml` 的 stage 步骤已经把所有产物重命名为 ASCII（`sage-<ver>-<triple>.*`）。如果仍出现，检查 staging 步骤的 `cp` 是否漏掉某个产物。

---

## 10. 参考文件

| 文件 | 作用 |
|---|---|
| `.github/workflows/release.yml` | CI 工作流定义 |
| `scripts/build-signed.sh` | 本地签名打包入口 |
| `scripts/gen-latest-json.sh` | updater manifest 生成 |
| `scripts/version.sh` | 多文件版本同步 |
| `src-tauri/tauri.conf.json` | Tauri 配置（含 updater pubkey + endpoints） |
| `configs/env/.env.tauri-signing` | 本地签名密钥（gitignore） |
| `configs/env/.env.production` | 本地 Supabase 生产配置（gitignore） |

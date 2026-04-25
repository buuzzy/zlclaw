# RELEASE 流程

> 发一个带 OTA 更新能力的多平台包（macOS Apple Silicon / macOS Intel）。
> 从 v1.0.3 起走 **GitHub Actions CI 驱动** —— 推 tag 自动打各平台、生成 `latest.json`、创建 Release。
>
> **Windows x64 暂缓**（v1.0.3-rc1 CI 实测挂在 WiX MSI 中文编码 bug）。workflow 里保留了完整代码 + 恢复步骤注释，v1.0.4+ 可快速恢复。见附录 E。

---

## 前置

- **一次性**：`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` / `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 四个 GitHub Secrets 已在 `Settings → Secrets and variables → Actions` 录入（来源见"附录 D"）
- **一次性**：本地 `configs/env/.env.tauri-signing` 对应的 pubkey 已烧在 `src-tauri/tauri.conf.json:31`（历史改动，不需要再动）
- `gh` 已登录（`gh auth status`）
- 当前分支 clean，所有 commit 都推上去了

---

## 1. bump 版本号

**三处必须同时改**（Tauri 的 updater 会比对 `tauri.conf.json` 里的 `version`，但 Cargo 不改编译时会警告 / 某些工具链校验失败）：

| 文件 | 字段 |
|---|---|
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version = "..."` |

```bash
# 一次 grep 校验
grep -E '"version"|^version' package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
```

提交：
```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore: bump version X.Y.Z → X.Y.(Z+1)"
git push
```

---

## 2. 写 release notes

```bash
# docs/ 本身已 .gitignore，所以这个文件只在本地存在。
# CI 会用 GitHub 自动生成的 release notes 作为草稿，发版时手动去 UI 把本地文件内容粘过去。
vi docs/release-notes/v<version>.md
```

参考 v1.0.1 / v1.0.2 的结构：标题、日期、**修复 / 功能 / 体验 / 升级说明**。

**每份 release notes 结尾都要带上两个平台的首次安装提示**：
- macOS "已损坏"解除：见本文档末尾 **附录 A**
- Windows SmartScreen 解除：见本文档末尾 **附录 B**

---

## 3. 触发 CI 构建

```bash
VER=1.0.3
git tag -a v${VER} -m "Release v${VER}"
git push origin v${VER}
```

推上去后：
- `.github/workflows/release.yml` 自动在 `macos-14` / `macos-15-intel` 两台 runner 上并行构建（Windows 暂缓，见附录 E）
- 每个 job 跑 `pnpm --filter sage-api build:binary:<平台>` → `pnpm tauri build --target <triple>`
- 产物由 stage 步骤重命名为 ASCII（`zlclaw-<ver>-<triple>[-setup].<ext>`）后上传 artifact
- 汇总 job 在 `ubuntu-latest` 跑 `scripts/gen-latest-json.sh` 合并两平台 `latest.json`，创建 GitHub Release

**观察 CI：**
```bash
gh run watch         # 或网页版 Actions 页面
```

**首次 CI 失败时**（必有坑）：看 `gh run view --log-failed` 定位错，修完重推 tag：
```bash
git tag -d v${VER} && git push --delete origin v${VER}   # 删旧 tag
# 修 bug → commit push → 重打 tag
git tag -a v${VER} -m "Release v${VER}" && git push origin v${VER}
```

---

## 4. 验证 CI 产物

CI 绿后，Release 应已创建在 `https://github.com/buuzzy/zlclaw/releases/tag/v${VER}`，assets 里应有 **7 个文件**：

| 平台 | 安装包 | Updater artifact | 签名 |
|---|---|---|---|
| macOS ARM | `zlclaw-${VER}-aarch64-apple-darwin.dmg` | `.app.tar.gz` | `.app.tar.gz.sig` |
| macOS Intel | `zlclaw-${VER}-x86_64-apple-darwin.dmg` | `.app.tar.gz` | `.app.tar.gz.sig` |
| 全平台 | — | `latest.json` | — |

肉眼核对一眼 `latest.json`：
```bash
curl -sL https://github.com/buuzzy/zlclaw/releases/latest/download/latest.json | jq .
# 期望 platforms 里有 darwin-aarch64 / darwin-x86_64 两把
```

**踩坑记录**：
- `platforms` 的 key 必须是 tauri target string：mac Intel 是 `darwin-x86_64`，mac ARM 是 `darwin-aarch64`，Win 是 `windows-x86_64`。写错会静默 404
- 早期版本的 `latest.json` schema 要求字段命名为 `sig` —— 我们用的是 tauri 2.x，字段就叫 `signature`
- `latest.json` 由 CI 生成，本地不要手动 commit。若需要本地生成备份见"附录 C"

---

## 5. 手动调整 Release 元信息

CI 的 `softprops/action-gh-release` 默认会生成一份基于 commit 的 release notes 草稿。**手动在 Release UI 里改两件事**：

1. 把 `docs/release-notes/v${VER}.md` 的内容整段替换掉草稿
2. 把 release 标题改成 `v${VER} — <标题>`（如 "v1.0.3 — 首发 Windows/Intel"）

**不要**勾 "Set as a pre-release"（CI 只在 rc/beta/alpha tag 时自动勾；正式版 tag 自动留空）。标错了 `releases/latest` 指针就会漏过当前 release，updater 永远拉不到新版。

---

## 6. 验证 OTA 能生效

**macOS**（在已装旧版的机器上直接测，不需要卸载）：

1. 打开「涨乐金融龙虾」app → 设置 → 关于 → 检查更新
2. 预期：`checking` → `available (v<new>)` → 点更新 → `downloading` → `installing` → 自动重启到新版
3. 检查版本号：设置 → 关于 底部应显示新版本号
4. 跑一次核心场景（MiniMax / 分时图 / K 线 / 股票快照）回归

**Windows**：暂缓（见附录 E）。

**失败排查**：
- `checking failed: Could not fetch a valid release JSON from the remote`
  → 99% 是 `latest.json` 没传到 release、或 `releases/latest` 指针没指向当前 release（检查是不是误标了 prerelease）
- `Signature verification failed`
  → `signature` 字段串了 / 签名密钥和打包时用的 pubkey 不匹配。重新跑 CI
- `No update available` 但版本号明明不一样
  → 检查 `latest.json` 里 `version` 是否大于当前本地 `tauri.conf.json` 的 `version`（semver 严格比较）
- `update.available` 一直是 false
  → 快速 curl 验证：`curl -sL https://github.com/buuzzy/zlclaw/releases/latest/download/latest.json` 能否拿到最新版本号

---

## 7. 发版完成后

- 在 `docs/TODO.md` 里勾掉对应验收项
- 通知内测群（发 release URL 即可，内测用户走 OTA 更新，不用手动下安装包）
- **不需要**把安装包备份到桌面：Release 在 GitHub，本身就是云端备份
- `src-tauri/target/` 里本地产物下次 `build-signed.sh` 会自动覆盖，不用管；想彻底清理跑 `cargo clean`

---

## 历史版本归档

| 版本 | 日期 | 要点 |
|---|---|---|
| v1.0.0 | 2026-04-22 | 品牌更名 HTclaw → Sage → 涨乐金融龙虾、首次启动初始化、17 金融技能内置 |
| v1.0.1 | 2026-04-23 | 本地数据按账号隔离 (M1)、App 内更新 (M2)、红点提示 (M3)、Supabase 环境分离 (M4a)、同步状态 UI 重构、title sanitize、股票快照白屏修复 |
| v1.0.2 | 2026-04-23 | MiniMax 模型兼容性修复：planning 阶段 `<think>` 泄露 + parser 失败时重复 yield `direct_answer` |
| v1.0.3 | 2026-04-XX | 首发 macOS Intel（CI 驱动构建），移除内置 Claude/Codex CLI sidecar 瘦身约 150MB（CLI 改为后续以插件下载形式，按需启用）。Windows x64 暂缓，见附录 E |

---

## 附录 A：macOS "已损坏"提示解除（必须放进每份 release notes）

**背景：** 我们的 DMG 只做了 Tauri 的 Ed25519 updater 签名（给 OTA 用），**没有做 Apple Developer ID 公证（notarization）**。macOS Gatekeeper 看到 `com.apple.quarantine` 扩展属性 + 未 notarize → 报 "已损坏，应移到废纸篓"。这是假警报，DMG 本身是干净的。

**给用户看的标准段落**（复制到每份 release notes 结尾）：

```markdown
## macOS 首次安装提示"已损坏"怎么办

macOS 自带的 Gatekeeper 会对从浏览器下载的 app 打 quarantine 标记。我们还没买 Apple Developer 账号（99$/年，内测期暂缓），所以 Gatekeeper 无法识别这个 app 来源，会误报"已损坏"。**实际 DMG 是干净的**，我们自己打的签名由 Tauri 的 Ed25519 updater 链验证过。

打开「终端」执行一行命令即可解除（路径带中文，必须用双引号）：

    xattr -cr "/Applications/涨乐金融龙虾.app"

之后双击打开即可。OTA 自动更新不受此影响（走 Tauri updater 自己的签名链，不经过 Gatekeeper quarantine）。
```

**终极修复（未来）：** 买 Apple Developer ID（99$/年），把 `codesign --deep --force --sign` + `xcrun notarytool submit` 加进 release 流水线。配置一次一劳永逸，用户双击即开。

---

## 附录 B：Windows SmartScreen 提示解除（必须放进每份 release notes）

> **当前状态（v1.0.3）**：Windows 版本暂缓，此附录为未来恢复时备用。见附录 E。

**背景：** 我们的 Windows 安装包只做了 Tauri 的 Ed25519 updater 签名，**没有做代码签名（EV Code Signing Certificate ≈ 200-400$/年）**。Windows Defender SmartScreen 看到未签名的 exe 就会拦：`Windows 已保护你的电脑`。实际安装包是干净的。

**给用户看的标准段落**（复制到每份 release notes 结尾）：

```markdown
## Windows 首次安装提示"Windows 已保护你的电脑"怎么办

Windows 的 SmartScreen 会对没有微软认证代码签名的应用弹警告。我们暂时没买代码签名证书（200-400$/年，首发期暂缓），所以会误报。**实际安装包是干净的**，我们自己打的签名由 Tauri 的 Ed25519 updater 链验证过。

两种解决方式二选一：

**方式 1：在警告界面点"更多信息"**
1. 下载后双击 `.exe`，出现"Windows 已保护你的电脑"蓝色弹窗
2. 点左下角 **"更多信息"**
3. 出现新的 **"仍要运行"** 按钮，点它即可

**方式 2：下载后右键解除锁定**
1. 在文件资源管理器里找到下载的 `.exe`
2. 右键 → 属性 → 勾选底部 **"解除锁定"** → 确定
3. 双击安装
```

**终极修复（未来）：** 买 EV Code Signing 证书（约 300$/年，通常是 USB 硬件密钥或 HSM），把 `signtool sign` 加进 CI 的 Windows job。签完的 exe 直接双击即开，Defender 不拦。

---

## 附录 C：本地应急构建（CI 挂掉时的逃生舱）

**前提：只能打 macOS 两架构**。Windows 构建本地跑不了（Mac 上没 MSVC），`./scripts/build-signed.sh windows` 会被顶部的拦截代码 exit 2。

```bash
# macOS Apple Silicon（开发机原生）
./scripts/build-signed.sh mac-arm

# macOS Intel（开发机通过 Rosetta 交叉编译，Apple Silicon 也能跑）
./scripts/build-signed.sh mac-intel
```

产物位置：
- mac-arm DMG：`src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/涨乐金融龙虾_<ver>_aarch64.dmg`
- mac-intel DMG：`src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/涨乐金融龙虾_<ver>_x64.dmg`
- updater：`<triple>/release/bundle/macos/涨乐金融龙虾.app.tar.gz{,.sig}`

**手工生成 `latest.json`**（只含两个 macOS 平台，Windows 跳过发版）：
```bash
VER=1.0.3
# 按 gen-latest-json.sh 的约定：<artifacts>/<triple>/ 里放好 updater + .sig
# 注意文件名必须是 ASCII（脚本会拒绝非 ASCII 的 basename），所以先重命名。
mkdir -p /tmp/latest-json/{aarch64-apple-darwin,x86_64-apple-darwin}

cp src-tauri/target/aarch64-apple-darwin/release/bundle/macos/涨乐金融龙虾.app.tar.gz \
   /tmp/latest-json/aarch64-apple-darwin/zlclaw-${VER}-aarch64-apple-darwin.app.tar.gz
cp src-tauri/target/aarch64-apple-darwin/release/bundle/macos/涨乐金融龙虾.app.tar.gz.sig \
   /tmp/latest-json/aarch64-apple-darwin/zlclaw-${VER}-aarch64-apple-darwin.app.tar.gz.sig

cp src-tauri/target/x86_64-apple-darwin/release/bundle/macos/涨乐金融龙虾.app.tar.gz \
   /tmp/latest-json/x86_64-apple-darwin/zlclaw-${VER}-x86_64-apple-darwin.app.tar.gz
cp src-tauri/target/x86_64-apple-darwin/release/bundle/macos/涨乐金融龙虾.app.tar.gz.sig \
   /tmp/latest-json/x86_64-apple-darwin/zlclaw-${VER}-x86_64-apple-darwin.app.tar.gz.sig

./scripts/gen-latest-json.sh ${VER} /tmp/latest-json \
  https://github.com/buuzzy/zlclaw/releases/download/v${VER}
```

**手工创建 Release**（只 2 个平台）：
```bash
gh release create v${VER} \
  --title "v${VER} — <标题>（Windows 跳过）" \
  --notes-file docs/release-notes/v${VER}.md \
  /tmp/latest-json/aarch64-apple-darwin/zlclaw-${VER}-aarch64-apple-darwin.app.tar.gz{,.sig} \
  /tmp/latest-json/x86_64-apple-darwin/zlclaw-${VER}-x86_64-apple-darwin.app.tar.gz{,.sig} \
  src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/涨乐金融龙虾_${VER}_aarch64.dmg \
  src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/涨乐金融龙虾_${VER}_x64.dmg \
  latest.json
```

release notes 里注明 "Windows 版本本次跳过，下一版恢复"。

---

## 附录 D：GitHub Secrets 一次性配置清单

在 `Settings → Secrets and variables → Actions` 的 Repository secrets 里添加：

| Secret 名 | 本地来源 | 用途 |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `configs/env/.env.tauri-signing` | Tauri updater Ed25519 签名（三平台共用） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `configs/env/.env.tauri-signing` | 同上 |
| `VITE_SUPABASE_URL` | `configs/env/.env.production` | prod Supabase 端点（前端打包时注入） |
| `VITE_SUPABASE_ANON_KEY` | `configs/env/.env.production` | 同上 |

**注意**：`configs/env/` 在 `.gitignore` 里（`.gitignore:89-90`），必须本地 `cat` 出来手动粘到 GitHub UI，**不能**用任何"自动同步"工具（会误传到公开仓库）。

**快速校验**：
```bash
# 本地看到这四行都有值
grep -E '^(TAURI_SIGNING_PRIVATE_KEY|TAURI_SIGNING_PRIVATE_KEY_PASSWORD|VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)' \
  configs/env/.env.tauri-signing configs/env/.env.production
```

然后 `gh secret list` 看到四个名字即可（GitHub 不会让你读回值，这是对的）。

---

## 附录 E：Windows x64 暂缓记录 + 恢复步骤

### 暂缓原因

v1.0.3-rc1 的 CI 实测：
- ✅ Rust 编译成功（7m10s）
- ✅ NSIS 安装包 `.exe` + updater `.nsis.zip{,.sig}` 都产出了
- ❌ WiX MSI 打包挂在 `light.exe`：
  ```
  Running light to produce ...bundle\msi\涨乐金融龙虾_1.0.3_x64_en-US.msi
  failed to bundle project `failed to run ...WixTools314\light.exe`
  ```

**根因**：`tauri.conf.json` 的 `bundle.targets: "all"` 在 Windows 上等于 `nsis + msi` 都打。WiX 3.14 的 `light.exe`（2014 年的 .NET 3.5 老工具）对产品名含中文字符（"涨乐金融龙虾"）的 MSI 文件名有 encoding bug。NSIS 本身已经成功，updater 也只认 `.nsis.zip`——**MSI 压根儿不是我们需要的产物**。

### v1.0.4+ 恢复步骤

1. **取消 `.github/workflows/release.yml` matrix 第 33-35 行注释**（Windows job），加回：
   ```yaml
   - platform_name: windows
     runs-on: windows-latest
     rust_target: x86_64-pc-windows-msvc
   ```
2. **改 Tauri build 步骤**，给 Windows job 加 `--bundles nsis`。最干净的做法是在 matrix 里加个 `bundles_flag` 字段，macOS 留空（走 `targets: "all"`），Windows 固定 `--bundles nsis`：
   ```yaml
   matrix:
     include:
       - platform_name: mac-arm
         runs-on: macos-14
         rust_target: aarch64-apple-darwin
         bundles_flag: ""
       - platform_name: mac-intel
         runs-on: macos-15-intel
         rust_target: x86_64-apple-darwin
         bundles_flag: ""
       - platform_name: windows
         runs-on: windows-latest
         rust_target: x86_64-pc-windows-msvc
         bundles_flag: "--bundles nsis"
   # Tauri build 步骤：
   run: pnpm tauri build --target ${{ matrix.rust_target }} ${{ matrix.bundles_flag }}
   ```
3. **恢复 `Stage Windows artifacts` 的有效性**（当前保留但 matrix 里没 Windows 就不会跑，矩阵恢复后自动激活）
4. **把本附录这段"恢复步骤"删掉**，顶部状态和附录 B 的开头警告同步更新

### 可选替代方案（如果 `--bundles nsis` 仍有问题）

改产品名为 ASCII 的"Sage"绕开 WiX 编码问题：
- `src-tauri/tauri.conf.json` 把 `productName: "涨乐金融龙虾"` 改回 `Sage`
- 影响：app 显示名、安装包名、Start Menu 里的名字都会变 ASCII
- **不推荐**——品牌已经定"涨乐金融龙虾"，走 `--bundles nsis` 方案更自然


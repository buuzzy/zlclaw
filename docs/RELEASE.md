# RELEASE 流程

> 发一个带 OTA 更新能力的 macOS 包。每一步都有坑，请严格按顺序。

---

## 前置

- `.env.tauri-signing`（gitignored）里有 updater 签名密钥 + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `gh` 已登录（`gh auth status`）
- 当前分支 clean，commit 都推上去了

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

## 2. 打签名包

```bash
./scripts/build-signed.sh mac-arm
```

产物位置：
- DMG: `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/涨乐金融龙虾_<version>_aarch64.dmg`
- 更新包 + 签名: `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/涨乐金融龙虾.app.tar.gz{,.sig}`

**用户**（你）需要知道的：
- 更新包是 `.app.tar.gz`，不是 DMG。updater 只吃 tar.gz。
- `.sig` 是一个 base64 文件，其内容会**原样**粘到 `latest.json` 的 `signature` 字段。

---

## 3. 准备 latest.json

Updater 客户端会 GET `https://github.com/buuzzy/zlclaw/releases/latest/download/latest.json`，所以这个文件必须在 **`releases/latest` 指向的 release** 里。

模板 (`latest.json`)：
```json
{
  "version": "1.0.1",
  "notes": "一句话更新说明（release notes 里更详细的会另外写）",
  "pub_date": "2026-04-23T08:30:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<paste sig file content verbatim>",
      "url": "https://github.com/buuzzy/zlclaw/releases/download/v1.0.1/zlclaw-1.0.1.app.tar.gz"
    }
  }
}
```

填字段：
- `version`：不带 `v` 前缀
- `pub_date`：ISO 8601 UTC
- `signature`：`cat zlclaw-<version>.app.tar.gz.sig` 全部输出粘进来（含末尾换行）
- `url`：指向当前 release tag 下的 `.app.tar.gz` 资产

**踩坑记录**：
- `platforms` 的 key 必须是 tauri target string：mac Intel 是 `darwin-x86_64`，mac ARM 是 `darwin-aarch64`，Win 是 `windows-x86_64`，Linux AppImage 是 `linux-x86_64`。写错会静默 404。
- 早期版本的 `latest.json` schema 要求 `signature` 字段命名为 `sig` —— 我们用的是 tauri 2.x，字段就叫 `signature`。
- **GitHub 会吃掉上传文件名里的中文字符**（只保留 ASCII），所以**必须**把产物文件名改成 ASCII 再传。Tauri 打出来的原始名是 `涨乐金融龙虾.app.tar.gz`，上传前 cp 成 `zlclaw-<version>.app.tar.gz`（以及 `.sig` 和 DMG）。v1.0.1 发版时踩过这个坑。

---

## 4. 创建 GitHub Release

```bash
# 打 tag（可选，gh release create 会自动创建）
git tag -a v1.0.1 -m "Release v1.0.1"
git push origin v1.0.1

# 产物改 ASCII 名（GitHub 会吃掉中文）
VER=1.0.1
cp "src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/涨乐金融龙虾_${VER}_aarch64.dmg" \
   "src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/zlclaw-${VER}.dmg"
cp "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/涨乐金融龙虾.app.tar.gz" \
   "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/zlclaw-${VER}.app.tar.gz"
cp "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/涨乐金融龙虾.app.tar.gz.sig" \
   "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/zlclaw-${VER}.app.tar.gz.sig"

# 创建 release 并上传产物
gh release create v${VER} \
  --title "v${VER} — <标题>" \
  --notes-file docs/release-notes/v${VER}.md \
  "src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/zlclaw-${VER}.dmg" \
  "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/zlclaw-${VER}.app.tar.gz" \
  "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/zlclaw-${VER}.app.tar.gz.sig" \
  latest.json
```

注意：
- **不要**加 `--prerelease`。`releases/latest` 指针只会指向非 prerelease 的最新 release。标了就 updater 永远发现不了新版。
- 文件名带中文，GitHub 会正确编码 URL，但建议在 shell 里用双引号包住。

---

## 5. 验证 OTA 更新能生效

1. 卸载当前 app（Applications 里删掉 `涨乐金融龙虾.app`）
2. 安装旧版（上一个 release 的 DMG，或从 `~/Desktop/sage-release-archive/v1.0.0/` 找备份）
3. 打开 app → 设置 → 关于 → 检查更新
4. 应该看到：`checking` → `available (v1.0.1)` → 点下载 → `downloading` → `ready` → `installing` → 自动重启到新版

失败排查：
- `checking failed: Could not fetch a valid release JSON from the remote`
  → 99% 是 `latest.json` 没传到 release、或 `releases/latest` 指针没指向当前 release（检查是不是标了 prerelease）
- `Signature verification failed`
  → `signature` 字段粘贴时串了 / 签名密钥和打包时用的 pubkey 不匹配
- `No update available` 但版本号明明不一样
  → 检查 `latest.json` 里 `version` 是否大于当前本地 `tauri.conf.json` 的 `version`。semver 严格比较

---

## 6. 发版完成后

- 在 `docs/TODO.md` 勾掉 M2 剩余验收项
- 备份 DMG + sig 到 `~/Desktop/sage-release-archive/v<version>/`（上传 release 后本地就不再需要，但留一份在桌面方便回归测试）
- 通知内测群

---

## 历史版本归档

| 版本 | 日期 | 要点 |
|---|---|---|
| v1.0.0 | 2026-04-22 | 品牌更名 HTclaw → Sage → 涨乐金融龙虾、首次启动初始化、17 金融技能内置 |
| v1.0.1 | 2026-04-23 | 本地数据按账号隔离 (M1)、App 内更新 (M2)、红点提示 (M3)、Supabase 环境分离 (M4a)、同步状态 UI 重构、title sanitize、股票快照白屏修复 |

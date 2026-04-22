#!/usr/bin/env bash
# Sage release build wrapper — signed updater artifacts
#
# 用法：
#   ./scripts/build-signed.sh                         # arm64 dmg
#   ./scripts/build-signed.sh mac-arm                 # 同上
#   ./scripts/build-signed.sh mac-intel               # x86_64 dmg
#
# 作用：
#   1. 加载 .env.tauri-signing（TAURI_SIGNING_PRIVATE_KEY / PASSWORD）
#   2. 加载 .env.production（VITE_SUPABASE_URL/KEY，走 prod project）
#   3. 执行对应的 pnpm 脚本，确保 updater .sig / latest.json 产物签名
#
# 产物位置（以 mac-arm 为例）：
#   src-tauri/target/aarch64-apple-darwin/release/bundle/
#     ├── dmg/Sage_<version>_aarch64.dmg
#     ├── macos/Sage.app.tar.gz         ← updater artifact
#     └── macos/Sage.app.tar.gz.sig     ← Ed25519 signature

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

TARGET="${1:-mac-arm}"

# ── 1. 加载签名密钥（.env.tauri-signing）────────────────────────────────────
if [ ! -f .env.tauri-signing ]; then
  echo "❌ .env.tauri-signing 不存在。请先生成更新签名密钥："
  echo "   pnpm exec tauri signer generate --ci --password '' --write-keys ~/.sage-updater.key"
  echo "   然后把 ~/.sage-updater.key 内容写入 .env.tauri-signing"
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env.tauri-signing
set +a

if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  echo "❌ .env.tauri-signing 里 TAURI_SIGNING_PRIVATE_KEY 为空。"
  exit 1
fi

echo "✅ Loaded TAURI_SIGNING_PRIVATE_KEY (length: ${#TAURI_SIGNING_PRIVATE_KEY})"

# ── 2. 加载 prod 环境变量（若有 .env.production）────────────────────────────
if [ -f .env.production ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.production
  set +a
  echo "✅ Loaded .env.production (VITE_SUPABASE_URL=${VITE_SUPABASE_URL:-<unset>})"
else
  echo "⚠️  .env.production 不存在，将使用 supabase.ts 里硬编码的 prod fallback。"
fi

# ── 3. 执行打包 ────────────────────────────────────────────────────────────
case "$TARGET" in
  mac-arm|darwin-arm|arm64)
    pnpm tauri:build:mac-arm
    ;;
  mac-intel|darwin-intel|x86_64)
    pnpm tauri:build:mac-intel
    ;;
  linux)
    pnpm tauri:build:linux
    ;;
  windows|win)
    pnpm tauri:build:windows
    ;;
  all|default)
    pnpm tauri:build
    ;;
  *)
    echo "❌ Unknown target: $TARGET"
    echo "   支持: mac-arm / mac-intel / linux / windows / all"
    exit 1
    ;;
esac

echo ""
echo "✅ 打包完成。updater 产物（.sig 签名文件）位于 bundle 目录下。"
echo "   下一步：手动上传 DMG + .sig + 生成 latest.json 到 GitHub Releases"
echo "           (详见 docs/RELEASE.md，后续补)"

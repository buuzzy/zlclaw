#!/usr/bin/env bash
# Sage multi-platform latest.json generator
#
# 用法：
#   ./scripts/gen-latest-json.sh <version> <artifacts_dir> <release_base_url>
#
# 例子：
#   ./scripts/gen-latest-json.sh 1.0.3 ./artifacts \
#     https://github.com/buuzzy/zlclaw/releases/download/v1.0.3
#
#   ./scripts/gen-latest-json.sh auto ./artifacts \
#     https://github.com/buuzzy/zlclaw/releases/download/v1.0.3
#   # ↑ version=auto 时从 src-tauri/tauri.conf.json 读
#
# 约定：<artifacts_dir> 下必须有如下子目录（按 rust target triple 命名）：
#   <artifacts_dir>/aarch64-apple-darwin/     → darwin-aarch64   （*.app.tar.gz{,.sig}）
#   <artifacts_dir>/x86_64-apple-darwin/      → darwin-x86_64    （*.app.tar.gz{,.sig}）
#   <artifacts_dir>/x86_64-pc-windows-msvc/   → windows-x86_64   （*.nsis.zip{,.sig}）
#
# 重要：子目录里的 updater artifact 必须已重命名为 ASCII 文件名
#       （GitHub 会吃掉非 ASCII 文件名，参考 docs/RELEASE.md §5）。
#       本脚本直接把 basename 拼到 URL 里，所以文件名等于 release 里 asset 名。
#
# 产出：当前目录下的 latest.json（jq 校验过）
#
# 退出码：
#   0 成功；1 参数错误 / jq 缺失 / 目录无效；2 未找到任何平台 artifact

set -euo pipefail

# ── 1. 参数校验 ────────────────────────────────────────────────────────────

if [ $# -lt 3 ]; then
  echo "Usage: $0 <version|auto> <artifacts_dir> <release_base_url>" >&2
  echo "" >&2
  echo "Example:" >&2
  echo "  $0 1.0.3 ./artifacts https://github.com/buuzzy/zlclaw/releases/download/v1.0.3" >&2
  exit 1
fi

VERSION_ARG="$1"
ARTIFACTS_DIR="$2"
RELEASE_BASE_URL="$3"

if ! command -v jq >/dev/null 2>&1; then
  echo "❌ jq 未安装（CI runner 内置；本地跑 'brew install jq'）" >&2
  exit 1
fi

if [ ! -d "$ARTIFACTS_DIR" ]; then
  echo "❌ 不是有效目录：$ARTIFACTS_DIR" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_CONF="$ROOT_DIR/src-tauri/tauri.conf.json"

if [ "$VERSION_ARG" = "auto" ]; then
  if [ ! -f "$TAURI_CONF" ]; then
    echo "❌ version=auto 但找不到 $TAURI_CONF" >&2
    exit 1
  fi
  VERSION=$(jq -r '.version' "$TAURI_CONF")
  if [ -z "$VERSION" ] || [ "$VERSION" = "null" ]; then
    echo "❌ 无法从 $TAURI_CONF 读出 version" >&2
    exit 1
  fi
  echo "ℹ️  version=auto，从 tauri.conf.json 读到：$VERSION"
else
  VERSION="$VERSION_ARG"
fi

# 去掉 base_url 末尾斜杠，后面统一拼
RELEASE_BASE_URL="${RELEASE_BASE_URL%/}"

# ── 2. 平台映射表 ──────────────────────────────────────────────────────────
# 并排两个数组（避免 bash 3 没有 associative arrays —— macOS 默认 bash 3.2）
TRIPLES=(
  "aarch64-apple-darwin"
  "x86_64-apple-darwin"
  "x86_64-pc-windows-msvc"
)
PLATFORM_KEYS=(
  "darwin-aarch64"
  "darwin-x86_64"
  "windows-x86_64"
)
# updater artifact 扩展名（Tauri 2 约定）
SUFFIXES=(
  ".app.tar.gz"
  ".app.tar.gz"
  ".nsis.zip"
)

# ── 3. 扫 artifacts 并组装 platforms 对象 ──────────────────────────────────

PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
NOTES="${LATEST_JSON_NOTES:-See release notes for v${VERSION}.}"

PLATFORMS_JSON='{}'
FOUND=0

for i in "${!TRIPLES[@]}"; do
  TRIPLE="${TRIPLES[$i]}"
  KEY="${PLATFORM_KEYS[$i]}"
  SUFFIX="${SUFFIXES[$i]}"
  DIR="$ARTIFACTS_DIR/$TRIPLE"

  if [ ! -d "$DIR" ]; then
    echo "⚠️  跳过 ${KEY}：子目录不存在（${DIR}）"
    continue
  fi

  # 找 .sig 文件（Tauri 保证每个 updater artifact 配一个同名 .sig）
  SIG_FILE=$(find "$DIR" -type f -name "*${SUFFIX}.sig" 2>/dev/null | head -n 1 || true)

  if [ -z "$SIG_FILE" ]; then
    echo "⚠️  跳过 ${KEY}：在 ${DIR} 里没找到 *${SUFFIX}.sig"
    continue
  fi

  ARTIFACT_FILE="${SIG_FILE%.sig}"
  if [ ! -f "$ARTIFACT_FILE" ]; then
    echo "⚠️  跳过 ${KEY}：.sig 存在但缺 artifact 本体（${ARTIFACT_FILE}）"
    continue
  fi

  ARTIFACT_BASENAME=$(basename "$ARTIFACT_FILE")

  # 拒绝非 ASCII basename，GitHub 会吃掉中文导致 updater 404
  if ! printf '%s' "$ARTIFACT_BASENAME" | LC_ALL=C grep -q '^[[:print:]]*$'; then
    echo "❌ ${KEY} 的 artifact 文件名含非 ASCII 字符：${ARTIFACT_BASENAME}" >&2
    echo "   workflow 必须先重命名再调本脚本（参考 docs/RELEASE.md §5）" >&2
    exit 1
  fi

  SIG_CONTENT=$(tr -d '\n' < "$SIG_FILE")
  if [ -z "$SIG_CONTENT" ]; then
    echo "❌ ${KEY} 的 .sig 文件是空的：${SIG_FILE}" >&2
    exit 1
  fi

  URL="${RELEASE_BASE_URL}/${ARTIFACT_BASENAME}"

  PLATFORMS_JSON=$(jq \
    --arg key "$KEY" \
    --arg sig "$SIG_CONTENT" \
    --arg url "$URL" \
    '. + {($key): {signature: $sig, url: $url}}' \
    <<<"$PLATFORMS_JSON")

  echo "✅ $KEY → $ARTIFACT_BASENAME"
  FOUND=$((FOUND + 1))
done

# ── 4. 检查 & 写盘 ─────────────────────────────────────────────────────────

if [ "$FOUND" -eq 0 ]; then
  echo "❌ 没找到任何平台的 updater artifact（检查 $ARTIFACTS_DIR 目录结构）" >&2
  exit 2
fi

jq -n \
  --arg version "$VERSION" \
  --arg notes "$NOTES" \
  --arg pub_date "$PUB_DATE" \
  --argjson platforms "$PLATFORMS_JSON" \
  '{version: $version, notes: $notes, pub_date: $pub_date, platforms: $platforms}' \
  > latest.json

# 再过一遍 jq 严格 validate
if ! jq . latest.json >/dev/null 2>&1; then
  echo "❌ 生成的 latest.json 通不过 jq 校验" >&2
  exit 1
fi

echo ""
echo "✅ 写入 latest.json（$FOUND 个平台）"
echo "─── latest.json ───"
cat latest.json
echo ""

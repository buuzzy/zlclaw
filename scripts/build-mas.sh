#!/usr/bin/env bash
# Sage Mac App Store build + sign + upload
#
# 用法：
#   ./scripts/build-mas.sh              # 构建 + 签名 .pkg
#   ./scripts/build-mas.sh --upload     # 构建 + 签名 + 上传到 App Store Connect
#
# 前置条件：
#   1. Apple Developer 证书已安装到 Keychain:
#      - "3rd Party Mac Developer Application: YIYANG CAI (QB576QUT2S)"
#      - "3rd Party Mac Developer Installer: YIYANG CAI (QB576QUT2S)"
#   2. Provisioning profile 已放在 src-tauri/Sage_Mac_App_Store.provisionprofile
#   3. 若需上传，需设置环境变量 APPLE_API_KEY_ID 和 APPLE_API_ISSUER
#      或在 ~/.private_keys/ 中放置 AuthKey_<KEY_ID>.p8
#
# 产物：
#   Sage.pkg  ← 可直接上传到 App Store Connect

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

APP_NAME="Sage"
TARGET="aarch64-apple-darwin"
APP_PATH="src-tauri/target/${TARGET}/release/bundle/macos/${APP_NAME}.app"
PKG_PATH="${ROOT_DIR}/${APP_NAME}.pkg"
UPLOAD=false

# Parse args
for arg in "$@"; do
  case "$arg" in
    --upload) UPLOAD=true ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

# ── Step 1: Build .app ────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  Step 1: Building ${APP_NAME}.app for Mac App Store"
echo "══════════════════════════════════════════════════════════════"
echo ""

pnpm tauri:build:mas

if [ ! -d "$APP_PATH" ]; then
  echo "❌ Build failed: ${APP_PATH} not found"
  exit 1
fi

echo "✅ .app built: ${APP_PATH}"

# ── Step 2: Verify entitlements & provisioning ────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  Step 2: Verifying code signing"
echo "══════════════════════════════════════════════════════════════"
echo ""

echo "--- Code signature ---"
codesign -dvv "$APP_PATH" 2>&1 | head -10

echo ""
echo "--- Entitlements ---"
codesign -d --entitlements - "$APP_PATH" 2>&1 | head -20

echo ""
echo "--- Provisioning profile ---"
if [ -f "${APP_PATH}/Contents/embedded.provisionprofile" ]; then
  echo "✅ embedded.provisionprofile found"
else
  echo "⚠️  embedded.provisionprofile NOT found in .app bundle"
fi

# ── Step 3: Generate signed .pkg ──────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  Step 3: Creating signed .pkg"
echo "══════════════════════════════════════════════════════════════"
echo ""

xcrun productbuild \
  --sign "3rd Party Mac Developer Installer: YIYANG CAI (QB576QUT2S)" \
  --component "$APP_PATH" /Applications \
  "$PKG_PATH"

echo "✅ .pkg created: ${PKG_PATH}"
echo "   Size: $(du -h "$PKG_PATH" | cut -f1)"

# ── Step 4: Validate .pkg ────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  Step 4: Validating .pkg signature"
echo "══════════════════════════════════════════════════════════════"
echo ""

pkgutil --check-signature "$PKG_PATH"

# ── Step 5: Upload (optional) ────────────────────────────────────────────────
if [ "$UPLOAD" = true ]; then
  echo ""
  echo "══════════════════════════════════════════════════════════════"
  echo "  Step 5: Uploading to App Store Connect"
  echo "══════════════════════════════════════════════════════════════"
  echo ""

  if [ -z "${APPLE_API_KEY_ID:-}" ] || [ -z "${APPLE_API_ISSUER:-}" ]; then
    echo "❌ Upload requires APPLE_API_KEY_ID and APPLE_API_ISSUER environment variables."
    echo "   Create an API key at: https://appstoreconnect.apple.com/access/integrations/api"
    echo "   Then: export APPLE_API_KEY_ID=<key_id>"
    echo "         export APPLE_API_ISSUER=<issuer_id>"
    echo "   And place AuthKey_<key_id>.p8 in ~/.private_keys/"
    exit 1
  fi

  echo "Validating..."
  xcrun altool --validate-app --type macos \
    --file "$PKG_PATH" \
    --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER"

  echo ""
  echo "Uploading..."
  xcrun altool --upload-app --type macos \
    --file "$PKG_PATH" \
    --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER"

  echo ""
  echo "✅ Upload complete! Check App Store Connect for review status."
else
  echo ""
  echo "══════════════════════════════════════════════════════════════"
  echo "  Done! .pkg ready for upload"
  echo "══════════════════════════════════════════════════════════════"
  echo ""
  echo "To upload manually:"
  echo "  xcrun altool --upload-app --type macos \\"
  echo "    --file ${PKG_PATH} \\"
  echo "    --apiKey \$APPLE_API_KEY_ID --apiIssuer \$APPLE_API_ISSUER"
  echo ""
  echo "Or use Transporter.app to drag-and-drop ${PKG_PATH}"
fi

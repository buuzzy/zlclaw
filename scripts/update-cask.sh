#!/bin/bash

# Update Homebrew Cask with SHA256 hashes from GitHub Release
# Usage: ./scripts/update-cask.sh <version>
# Example: ./scripts/update-cask.sh 0.1.14

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CASK_FILE="$PROJECT_ROOT/Casks/workany.rb"

GITHUB_REPO="workany-ai/workany"

# Get version from argument
if [ -z "$1" ]; then
    echo "Usage: $0 <version>"
    echo "Example: $0 0.1.14"
    exit 1
fi

VERSION="$1"

echo "Updating cask for version: $VERSION"
echo ""

# Download URLs
ARM_URL="https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/WorkAny_${VERSION}_aarch64.dmg"
INTEL_URL="https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/WorkAny_${VERSION}_x64.dmg"

# Calculate SHA256 from remote files
echo "Downloading and calculating ARM64 SHA256..."
ARM_SHA=$(curl -sfL "$ARM_URL" | shasum -a 256 | cut -d ' ' -f 1)
if [ -z "$ARM_SHA" ]; then
    echo "Error: Failed to download ARM64 DMG from $ARM_URL"
    exit 1
fi
echo "ARM64 SHA256: $ARM_SHA"

echo ""
echo "Downloading and calculating Intel SHA256..."
INTEL_SHA=$(curl -sfL "$INTEL_URL" | shasum -a 256 | cut -d ' ' -f 1)
if [ -z "$INTEL_SHA" ]; then
    echo "Error: Failed to download Intel DMG from $INTEL_URL"
    exit 1
fi
echo "Intel SHA256: $INTEL_SHA"

# Update cask file
sed -i '' "s/version \"[^\"]*\"/version \"$VERSION\"/" "$CASK_FILE"
sed -i '' "s/sha256 arm:   \"[^\"]*\"/sha256 arm:   \"$ARM_SHA\"/" "$CASK_FILE"
sed -i '' "s/intel: \"[^\"]*\"/intel: \"$INTEL_SHA\"/" "$CASK_FILE"

echo ""
echo "Updated $CASK_FILE"
echo ""
echo "Next steps:"
echo "  git add Casks/workany.rb"
echo "  git commit -m \"chore: update workany to v$VERSION\""
echo "  git push"

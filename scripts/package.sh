#!/usr/bin/env bash
# package.sh — Build and package CodeSage VSIX for a specific platform
# Usage: ./scripts/package.sh <target>
#   target: win32-x64 | darwin-arm64 | darwin-x64 | linux-x64 | current
#   "current" auto-detects the current platform
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { echo "[package] $(date '+%H:%M:%S') $*"; }
err() { echo "[package] ERROR: $*" >&2; exit 1; }

TARGET="${1:-current}"

if [ "$TARGET" = "current" ]; then
    os="$(uname -s)"
    arch="$(uname -m)"
    case "$os" in
        Darwin)
            case "$arch" in
                arm64)  TARGET="darwin-arm64" ;;
                x86_64) TARGET="darwin-x64" ;;
            esac ;;
        Linux)  TARGET="linux-x64" ;;
        MINGW*|MSYS*|CYGWIN*) TARGET="win32-x64" ;;
        *)      err "Cannot detect platform from $os-$arch" ;;
    esac
fi

case "$TARGET" in
    win32-x64)     BIN_NAME="code-sage.exe" ;;
    darwin-arm64)  BIN_NAME="code-sage" ;;
    darwin-x64)    BIN_NAME="code-sage" ;;
    linux-x64)     BIN_NAME="code-sage" ;;
    *)             err "Unknown target: $TARGET. Use: win32-x64 | darwin-arm64 | darwin-x64 | linux-x64" ;;
esac

log "Packaging for target: $TARGET"

# ── 1. Verify analyzer binary ──
BIN_SRC="$ROOT/analyzer/build/$BIN_NAME"
if [ ! -f "$BIN_SRC" ]; then
    err "Analyzer binary not found at $BIN_SRC. Build it first."
fi

# ── 2. Compile extension TypeScript ──
log "Compiling extension..."
cd "$ROOT/extension"
npm install --ignore-scripts 2>/dev/null || true
npm run compile

# ── 3. Build webview ──
log "Building webview..."
cd "$ROOT/extension/webview"
npm install 2>/dev/null || true
npm run build

# ── 4. Build and bundle backend ──
log "Building backend..."
cd "$ROOT/backend"
npm install 2>/dev/null || true
npm run build

log "Bundling backend into extension..."
cd "$ROOT/extension"
node scripts/bundle-backend.js

# ── 5. Copy analyzer binary ──
log "Copying analyzer binary..."
mkdir -p "$ROOT/extension/bin"
cp "$BIN_SRC" "$ROOT/extension/bin/$BIN_NAME"
chmod +x "$ROOT/extension/bin/$BIN_NAME" 2>/dev/null || true

# ── 6. Package VSIX ──
log "Packaging VSIX for $TARGET..."
cd "$ROOT/extension"
npx vsce package --target "$TARGET" --no-dependencies

# ── 7. Show result ──
VSIX_FILE=$(ls -t *.vsix 2>/dev/null | head -1)
if [ -n "$VSIX_FILE" ]; then
    log "Done! VSIX: $ROOT/extension/$VSIX_FILE"
    ls -lh "$VSIX_FILE"
else
    err "VSIX file not found after packaging"
fi

# ── 8. Cleanup bundled files ──
rm -rf "$ROOT/extension/backend" "$ROOT/extension/bin"
log "Cleaned up temporary bundle directories"

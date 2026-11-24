#!/usr/bin/env bash
# STRATA ContentVault - reproducible Python & Apache-2.0 CJK font setup (Linux/macOS).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV_DIR="$REPO_ROOT/.venv"
REQ_FILE="$REPO_ROOT/packages/watermark-engine/requirements.txt"
FONT_DIR="$REPO_ROOT/vendor/fonts/wqy-microhei"
WQY_TARBALL_URL="https://codeload.github.com/anthonyfok/fonts-wqy-microhei/tar.gz/refs/heads/master"
WQY_EXPECTED_SHA256="e4bca8df123ce01b104780f576ea1a58b9a5ff1662a91124b6d3180cb6c88212"

if [ ! -d "$VENV_DIR" ]; then
  echo "[STRATA] Creating virtual environment at $VENV_DIR..."
  python3 -m venv "$VENV_DIR"
fi

echo "[STRATA] Installing pinned pypdfium2 and Pillow from $REQ_FILE..."
"$VENV_DIR/bin/pip" install --disable-pip-version-check --no-input -r "$REQ_FILE"

if [ ! -f "$FONT_DIR/wqy-microhei.ttc" ]; then
  echo "[STRATA] Fetching WenQuanYi Micro Hei CJK font (elected under Apache-2.0)..."
  mkdir -p "$FONT_DIR"
  curl -fsSL "$WQY_TARBALL_URL" | tar -xz -C "$FONT_DIR" --strip-components=1 \
    fonts-wqy-microhei-master/wqy-microhei.ttc \
    fonts-wqy-microhei-master/LICENSE_Apache2.txt \
    fonts-wqy-microhei-master/AUTHORS.txt \
    fonts-wqy-microhei-master/README.txt
fi

ACTUAL_SHA="$("$VENV_DIR/bin/python" -c "import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$FONT_DIR/wqy-microhei.ttc")"
if [ "$ACTUAL_SHA" != "$WQY_EXPECTED_SHA256" ]; then
  echo "[STRATA] ERROR: Font SHA-256 mismatch ($ACTUAL_SHA != $WQY_EXPECTED_SHA256)" >&2
  exit 1
fi
echo "[STRATA] Verified wqy-microhei.ttc SHA-256 ($ACTUAL_SHA)."

echo "[STRATA] Verifying pypdfium2 watermark engine..."
"$VENV_DIR/bin/python" "$REPO_ROOT/scripts/synthetic/verify_watermark_visual.py"
echo "[STRATA] Python dependency setup complete."

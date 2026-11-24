#!/usr/bin/env bash
set -euo pipefail

# Reproducible Python environment setup for STRATA ContentVault (POSIX / Linux / macOS)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV_DIR="${REPO_ROOT}/.venv"
REQ_FILE="${REPO_ROOT}/packages/watermark-engine/requirements.txt"

PYTHON_BIN="${PYTHON_BIN:-python3}"
if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
  PYTHON_BIN="python"
fi

echo "[STRATA] Creating virtual environment at ${VENV_DIR}..."
"${PYTHON_BIN}" -m venv "${VENV_DIR}"

echo "[STRATA] Installing pinned PyMuPDF and Pillow from ${REQ_FILE}..."
"${VENV_DIR}/bin/pip" install --no-deps -r "${REQ_FILE}"

echo "[STRATA] Verifying watermark engine..."
"${VENV_DIR}/bin/python" "${REPO_ROOT}/scripts/synthetic/verify_watermark_visual.py"
echo "[STRATA] Python dependency setup complete."

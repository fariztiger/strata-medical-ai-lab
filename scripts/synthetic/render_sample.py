#!/usr/bin/env python3
"""Render a sample watermarked page to disk for visual inspection."""

from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
ENGINE = REPO / "packages" / "watermark-engine" / "render_page.py"
sys.path.insert(0, str(REPO / "vendor" / "pylibs"))
for venv_site in (REPO / ".venv").glob("lib/python*/site-packages"):
    sys.path.insert(0, str(venv_site))
win_site = REPO / ".venv" / "Lib" / "site-packages"
if win_site.is_dir():
    sys.path.insert(0, str(win_site))

VENV_PY_POSIX = REPO / ".venv" / "bin" / "python"
VENV_PY_WIN = REPO / ".venv" / "Scripts" / "python.exe"
PYTHON_EXEC = (
    str(VENV_PY_POSIX)
    if VENV_PY_POSIX.is_file()
    else (str(VENV_PY_WIN) if VENV_PY_WIN.is_file() else sys.executable)
)


def run(request: dict) -> dict:
    proc = subprocess.run(
        [PYTHON_EXEC, str(ENGINE)],
        input=json.dumps(request),
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if proc.returncode != 0:
        raise SystemExit(f"engine failed: {proc.stderr or proc.stdout}")
    return json.loads(proc.stdout)


def main() -> None:
    pdf = str(REPO / "knowledge" / "synthetic" / "synthetic-neurology-module.pdf")
    out_dir = REPO / "var" / "samples"
    out_dir.mkdir(parents=True, exist_ok=True)

    result = run(
        {
            "command": "render",
            "path": pdf,
            "page": 2,
            "dpi": 120,
            "identity": {
                "label": "Nurul Aisyah (Synthetic Student A)",
                "ref": "usr_synth_student_a",
                "stamp": "2026-11-24T14:30Z",
            },
        }
    )
    target = out_dir / "sample-page-2-watermarked.png"
    target.write_bytes(base64.b64decode(result["png"]))
    print(f"wrote {target} ({result['bytes']} bytes, {result['width']}x{result['height']})")
    print(f"watermark: {result['watermark']}")


if __name__ == "__main__":
    main()

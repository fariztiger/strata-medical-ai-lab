#!/usr/bin/env python3
"""
Programmatic visual verification of the watermark.

I cannot eyeball the render in this environment, so this script measures the
properties that actually matter:

1. Coverage  - what fraction of the page area carries a visible delta.
2. Legibility- the page must NOT be washed out; mean luminance change stays small.
3. Locality  - the delta must appear in the body area, not only one corner.
4. Identity  - two students produce deltas in the same regions but different bytes.
"""

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

from PIL import Image, ImageChops, ImageStat

VENV_PY_POSIX = REPO / ".venv" / "bin" / "python"
VENV_PY_WIN = REPO / ".venv" / "Scripts" / "python.exe"
PYTHON_EXEC = (
    str(VENV_PY_POSIX)
    if VENV_PY_POSIX.is_file()
    else (str(VENV_PY_WIN) if VENV_PY_WIN.is_file() else sys.executable)
)


def render(pdf: str, page: int, dpi: int, identity: dict, watermark: bool) -> Image.Image:
    request = {
        "command": "render",
        "path": pdf,
        "page": page,
        "dpi": dpi,
        "identity": identity,
        "watermark": watermark,
    }
    proc = subprocess.run(
        [PYTHON_EXEC, str(ENGINE)],
        input=json.dumps(request),
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if proc.returncode != 0:
        raise SystemExit(f"engine failed: {proc.stderr or proc.stdout}")
    payload = json.loads(proc.stdout)
    import io

    return Image.open(io.BytesIO(base64.b64decode(payload["png"]))).convert("RGB")


def region_stats(diff: Image.Image, label: str) -> dict:
    width, height = diff.size
    gray = diff.convert("L")
    thresholded = gray.point(lambda v: 255 if v > 6 else 0)
    hist = thresholded.histogram()
    changed = hist[255]
    total = width * height
    stat = ImageStat.Stat(gray)
    return {
        "region": label,
        "changedPct": round(100.0 * changed / total, 2),
        "meanDelta": round(stat.mean[0], 3),
        "maxDelta": gray.getextrema()[1],
    }


def thirds(diff: Image.Image) -> list[dict]:
    width, height = diff.size
    out = []
    for index, name in enumerate(["top", "middle", "bottom"], start=1):
        band = diff.crop((0, height * (index - 1) // 3, width, height * index // 3))
        out.append(region_stats(band, name))
    return out


def main() -> None:
    pdf = str(REPO / "knowledge" / "synthetic" / "synthetic-neurology-module.pdf")
    identity_a = {"label": "Nurul Aisyah", "ref": "usr_synth_a", "stamp": "2026-11-24T14:30Z"}
    identity_b = {"label": "Tan Wei Ming", "ref": "usr_synth_b", "stamp": "2026-11-24T14:30Z"}

    clean = render(pdf, 2, 96, identity_a, watermark=False)
    marked_a = render(pdf, 2, 96, identity_a, watermark=True)
    marked_b = render(pdf, 2, 96, identity_b, watermark=True)

    diff_a = ImageChops.difference(clean, marked_a)
    diff_b = ImageChops.difference(clean, marked_b)

    report = {
        "whole": region_stats(diff_a, "whole-page"),
        "bands": thirds(diff_a),
        "identityDiffers": diff_a.tobytes() != diff_b.tobytes(),
        "cleanVsMarkedIdentical": clean.tobytes() == marked_a.tobytes(),
    }

    print(json.dumps(report, indent=2))

    checks = {
        # Glyph strokes cover a small share of a page by construction; what
        # matters is that the change is clearly measurable, distributed across
        # every region, and strong enough to survive printing or compression.
        "coverage_at_least_2pct": report["whole"]["changedPct"] >= 2.0,
        "coverage_below_70pct": report["whole"]["changedPct"] <= 70.0,
        "mean_delta_stays_readable": report["whole"]["meanDelta"] <= 8.0,
        "delta_is_strong_enough_to_see": report["whole"]["maxDelta"] >= 60,
        "covers_all_three_bands": all(band["changedPct"] > 1.5 for band in report["bands"]),
        "identity_changes_pixels": report["identityDiffers"],
        "clean_differs_from_marked": not report["cleanVsMarkedIdentical"],
    }
    print("\nchecks:")
    for name, passed in checks.items():
        print(f"  {'PASS' if passed else 'FAIL'}  {name}")
    if not all(checks.values()):
        raise SystemExit(1)
    print("\nall visual-property checks passed")


if __name__ == "__main__":
    main()

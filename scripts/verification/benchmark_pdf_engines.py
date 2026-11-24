#!/usr/bin/env python3
"""
Empirical evaluation & benchmark of `pypdfium2` vs `pymupdf` through the
modular `PdfRasterAdapter` interface (Mission 004 Phase A).

Measures:
  - Cold & cached page rendering latency across all 6 synthetic pages at 144 DPI.
  - Subprocess peak RSS memory (`ru_maxrss`) per isolated worker invocation.
  - Resolution fidelity, text/diagram contrast, and pixel similarity (MAE / PSNR).
  - Personalized watermarking and multilingual CJK/Unicode glyph verification.
"""

from __future__ import annotations

import base64
import io
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from PIL import Image, ImageChops, ImageStat

REPO_ROOT = Path(__file__).resolve().parents[2]
ENGINE_PY = REPO_ROOT / "packages" / "watermark-engine" / "render_page.py"
PDF_PATH = REPO_ROOT / "knowledge" / "synthetic" / "synthetic-neurology-module.pdf"
PY_BIN = sys.executable


def invoke_worker_with_rss(payload: dict) -> tuple[dict, float, float]:
    """Run `render_page.py` in a fresh child Python process and measure wall time + peak RSS MB."""
    wrapper = (
        "import json, resource, runpy, sys\n"
        f"sys.argv = [{str(ENGINE_PY)!r}]\n"
        "try:\n"
        f"    runpy.run_path({str(ENGINE_PY)!r}, run_name='__main__')\n"
        "finally:\n"
        "    rss_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss\n"
        "    sys.stderr.write(f'PEAK_RSS_KB={rss_kb}\\n')\n"
    )
    t0 = time.perf_counter()
    proc = subprocess.run(
        [PY_BIN, "-c", wrapper],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        check=True,
    )
    wall_ms = (time.perf_counter() - t0) * 1000.0
    rss_mb = 0.0
    for line in proc.stderr.splitlines():
        if line.startswith("PEAK_RSS_KB="):
            rss_mb = float(line.split("=", 1)[1]) / 1024.0
    return json.loads(proc.stdout), round(wall_ms, 2), round(rss_mb, 2)


def benchmark_engine(engine: str) -> dict | None:
    try:
        probe_res, _, probe_rss = invoke_worker_with_rss(
            {"command": "probe", "engine": engine, "path": str(PDF_PATH)}
        )
    except subprocess.CalledProcessError:
        return None

    with tempfile.TemporaryDirectory() as cache_dir:
        cold_ms = []
        warm_ms = []
        rss_samples = [probe_rss]
        resolutions = []
        clean_images: dict[int, Image.Image] = {}

        for p in range(1, probe_res["pageCount"] + 1):
            out_cold, _, rss_c = invoke_worker_with_rss(
                {
                    "command": "render",
                    "engine": engine,
                    "path": str(PDF_PATH),
                    "page": p,
                    "dpi": 144,
                    "identity": {"label": "陈伟明 Student B", "ref": "usr_bench", "stamp": "2026-11-24Z"},
                    "cacheDir": cache_dir,
                }
            )
            cold_ms.append(out_cold["renderMs"])
            rss_samples.append(rss_c)
            resolutions.append(f"{out_cold['width']}x{out_cold['height']}")

            out_warm, _, rss_w = invoke_worker_with_rss(
                {
                    "command": "render",
                    "engine": engine,
                    "path": str(PDF_PATH),
                    "page": p,
                    "dpi": 144,
                    "identity": {"label": "Aisyah Student A", "ref": "usr_bench2", "stamp": "2026-11-24Z"},
                    "cacheDir": cache_dir,
                }
            )
            warm_ms.append(out_warm["renderMs"])
            rss_samples.append(rss_w)

            out_clean, _, _ = invoke_worker_with_rss(
                {
                    "command": "render",
                    "engine": engine,
                    "path": str(PDF_PATH),
                    "page": p,
                    "dpi": 144,
                    "watermark": False,
                    "identity": {},
                }
            )
            clean_images[p] = Image.open(io.BytesIO(base64.b64decode(out_clean["png"]))).convert("RGB")

        st_out, _, _ = invoke_worker_with_rss(
            {"command": "selftest", "engine": engine, "path": str(PDF_PATH), "page": 2, "dpi": 144}
        )

        # Measure text/diagram contrast (stddev of luminance on page 2 & page 4 diagram page)
        luma_p2 = clean_images[2].convert("L")
        stat_p2 = ImageStat.Stat(luma_p2)
        dark_ink_pct = round(100.0 * sum(luma_p2.histogram()[:80]) / (luma_p2.width * luma_p2.height), 3)

        return {
            "engine": engine,
            "pageCount": probe_res["pageCount"],
            "pageDimensionsPt": [probe_res["pageWidth"], probe_res["pageHeight"]],
            "resolutionsPx": sorted(set(resolutions)),
            "coldRenderMsPerPage": cold_ms,
            "coldRenderMsMean": round(sum(cold_ms) / len(cold_ms), 2),
            "warmCacheRenderMsMean": round(sum(warm_ms) / len(warm_ms), 2),
            "peakRssMbMax": round(max(rss_samples), 2),
            "peakRssMbMean": round(sum(rss_samples) / len(rss_samples), 2),
            "page2LuminanceStdDev": round(stat_p2.stddev[0], 2),
            "page2DarkGlyphInkPct": dark_ink_pct,
            "selftest": {
                "watermarkedOutputsDiffer": st_out["watermarkedOutputsDiffer"],
                "watermarkChangesPixels": st_out["watermarkChangesPixels"],
                "fontSource": st_out.get("fontSource"),
                "fontLoaded": st_out.get("fontLoaded"),
            },
            "_clean_p2": clean_images[2],
        }


def main() -> None:
    os.chmod(ENGINE_PY, 0o755)
    pdfium_stats = benchmark_engine("pypdfium2")
    mupdf_stats = benchmark_engine("pymupdf")

    comparison = None
    if pdfium_stats and mupdf_stats:
        img_a = pdfium_stats.pop("_clean_p2")
        img_b = mupdf_stats.pop("_clean_p2")
        if img_a.size != img_b.size:
            img_b = img_b.resize(img_a.size, Image.Resampling.BILINEAR)
        diff = ImageChops.difference(img_a, img_b)
        stat = ImageStat.Stat(diff)
        mse = sum(v * v for v in stat.rms) / 3.0
        psnr = 99.0 if mse == 0 else round(10.0 * math.log10((255.0 ** 2) / mse), 2)
        mae = round(sum(stat.mean) / 3.0, 3)
        comparison = {
            "cleanPage2MeanAbsDiffRgb": mae,
            "cleanPage2PsnrDb": psnr,
            "identicalDimensions": pdfium_stats["resolutionsPx"] == mupdf_stats["resolutionsPx"],
        }
    elif pdfium_stats:
        pdfium_stats.pop("_clean_p2", None)

    summary = {
        "pypdfium2": pdfium_stats,
        "pymupdf": mupdf_stats,
        "crossEngineFidelity": comparison,
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()

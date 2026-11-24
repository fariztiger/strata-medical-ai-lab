#!/usr/bin/env python3
"""
STRATA ContentVault watermark & rasterisation worker (Mission 004 Phase A).

Uses a pluggable `PdfRasterAdapter` (`pypdfium2` by default, `pymupdf` optional
via `CV_PDF_ENGINE` or request `engine`) so PDF rasterisation can be swapped
without touching authorization, entitlement management, storage, or frontend UI.

Security & Internationalisation Properties
------------------------------------------
1. Burned-in RGBA pixel compositing (no removable CSS/DOM overlay — CV-019).
2. Deterministic pan-Unicode & Mandarin (CJK) glyph rendering without AGPL
   font extraction, resolving in order:
   - explicit `CV_WATERMARK_FONT_PATH`,
   - repo-local `vendor/fonts/wqy-microhei/wqy-microhei.ttc` (WenQuanYi Micro Hei,
     elected under Apache-2.0 and SHA-256 verified during setup),
   - installed OS Noto CJK / WenQuanYi / DejaVu TrueType/OpenType fonts.
3. Multi-chromatic + achromatic neutral tiling (`+28 deg` staggered grid cycling
   Neutral Slate, Cool Teal-Navy, and Champagne Ochre + `-26 deg` content-
   intersecting trace + bottom edge stamp) to resist simple color scrubbing (SEC-005).
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import time

from PIL import Image, ImageDraw, ImageFont

ENGINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = ENGINE_DIR.parent.parent
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from adapters import PdfEngineError, get_pdf_adapter  # noqa: E402

MAX_DIMENSION = 2600

# SEC-005: Three orthogonal ink channels (Achromatic Slate, Cool Teal-Navy, Warm Ochre)
TILE_PALETTE = (
    (56, 60, 64, 72),    # Neutral Slate (achromatic: R ~= G ~= B)
    (24, 76, 92, 74),    # Cool Deep Teal-Navy (B > R)
    (138, 86, 28, 76),   # Warm Champagne Ochre (R > B)
)
CROSS_TRACE_RGBA = (62, 66, 72, 46)
INK_EDGE = (46, 54, 64)
EDGE_OPACITY = 152

VENDOR_WQY_FONT = REPO_ROOT / "vendor" / "fonts" / "wqy-microhei" / "wqy-microhei.ttc"


def fail(code: str, message: str) -> None:
    """Emit a structured error and exit non-zero. Never leak a stack trace."""
    print(json.dumps({"ok": False, "error": code, "message": message}))
    raise SystemExit(2)


def resolve_font_info(text: str = "") -> tuple[str, str | None]:
    """Return `(source_kind, filesystem_path)` for diagnostics and font loading."""
    custom_font = os.environ.get("CV_WATERMARK_FONT_PATH", "").strip()
    if custom_font and os.path.isfile(custom_font):
        return ("env:CV_WATERMARK_FONT_PATH", custom_font)

    needs_non_ascii = any(ord(ch) > 0x024F for ch in text)
    cjk_candidates = [
        str(VENDOR_WQY_FONT),
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        "/System/Library/Fonts/PingFang.ttc",
    ]
    latin_candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        str(VENDOR_WQY_FONT),
        r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\calibri.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]

    ordered = cjk_candidates + latin_candidates if needs_non_ascii else latin_candidates + cjk_candidates
    for candidate in ordered:
        if os.path.isfile(candidate):
            return ("file", candidate)
    return ("pillow_default", None)


def load_font(size: int, text: str = "") -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Resolve an Apache-2.0 / OFL / OS TrueType/OpenType font without AGPL dependencies."""
    _, font_path = resolve_font_info(text)
    if font_path:
        try:
            return ImageFont.truetype(font_path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def sanitize_unicode_field(raw: object, max_len: int) -> str:
    """Preserve printable Unicode (including CJK, accents, symbols) while stripping control chars."""
    text = "".join(ch for ch in str(raw or "") if ch.isprintable() and ch not in "\r\n\t\x00")
    return text.strip()[:max_len]


def probe(path: str, engine_name: str | None = None) -> dict:
    adapter = get_pdf_adapter(engine_name)
    info = adapter.probe(path)
    return {
        "ok": True,
        "engine": info.engine,
        "pageCount": info.page_count,
        "pageWidth": info.page_width,
        "pageHeight": info.page_height,
    }


def watermark_text(identity: dict, page_number: int, total: int) -> str:
    label = sanitize_unicode_field(identity.get("label"), 60) or "Authorized Learner"
    ref = sanitize_unicode_field(identity.get("ref"), 40)
    stamp = sanitize_unicode_field(identity.get("stamp"), 32)
    parts = [label, ref, f"p.{page_number}/{total}", stamp]
    return "  ·  ".join(part for part in parts if part)


def apply_watermark(
    image: Image.Image,
    mark: str,
    page_number: int,
    total: int,
    short_ref: str = "",
) -> Image.Image:
    base = image.convert("RGBA")
    width, height = base.size
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    font_size = max(12, int(min(width, height) / 34))
    font = load_font(font_size, mark)

    probe_bbox = draw.textbbox((0, 0), mark, font=font)
    text_w = max(probe_bbox[2] - probe_bbox[0], 1)
    text_h = max(probe_bbox[3] - probe_bbox[1], 1)

    step_x = max(text_w + int(width * 0.04) + 16, int(width / 3.1))
    step_y = max(text_h + int(height * 0.055) + 18, int(height / 8.5))

    palette_tiles: list[Image.Image] = []
    for rgba in TILE_PALETTE:
        tile = Image.new("RGBA", (step_x, step_y), (0, 0, 0, 0))
        tile_draw = ImageDraw.Draw(tile)
        tile_draw.text((12, 6), mark, font=font, fill=rgba)
        palette_tiles.append(tile.rotate(28, expand=True, resample=Image.BICUBIC))

    for row, y in enumerate(range(-step_y, height + step_y, step_y)):
        offset = -step_x // 2 if row % 2 else 0
        for col, x in enumerate(range(-step_x + offset, width + step_x, step_x)):
            chosen_tile = palette_tiles[(row + col) % len(palette_tiles)]
            overlay.alpha_composite(chosen_tile, (x, y))

    trace_label = f"{short_ref or mark[:28]} · p.{page_number}/{total}"
    trace_size = max(10, int(min(width, height) / 48))
    trace_font = load_font(trace_size, trace_label)
    tb = draw.textbbox((0, 0), trace_label, font=trace_font)
    tw = max(tb[2] - tb[0] + 24, 120)
    th = max(tb[3] - tb[1] + 16, 32)
    trace_tile = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    ImageDraw.Draw(trace_tile).text((8, 4), trace_label, font=trace_font, fill=CROSS_TRACE_RGBA)
    trace_rot = trace_tile.rotate(-26, expand=True, resample=Image.BICUBIC)
    for band_y in (int(height * 0.22), int(height * 0.50), int(height * 0.76)):
        for band_x in (int(width * 0.16), int(width * 0.54)):
            overlay.alpha_composite(trace_rot, (band_x, band_y))

    edge_size = max(10, int(min(width, height) / 60))
    edge_font = load_font(edge_size, mark)
    edge_mark = f"STRATA ContentVault · {mark}"
    draw.rectangle(
        [(0, height - edge_size * 2 - 8), (width, height)],
        fill=(255, 255, 255, 44),
    )
    draw.text(
        (edge_size, height - edge_size * 2),
        edge_mark,
        font=edge_font,
        fill=(*INK_EDGE, EDGE_OPACITY),
    )

    return Image.alpha_composite(base, overlay).convert("RGB")


def render(
    path: str,
    page_number: int,
    dpi: int,
    identity: dict,
    max_dimension: int = MAX_DIMENSION,
    with_watermark: bool = True,
    cache_dir: str | None = None,
    content_hash: str | None = None,
    engine_name: str | None = None,
) -> dict:
    if not os.path.isfile(path):
        fail("missing_file", "PDF file not found.")

    started = time.perf_counter()
    adapter = get_pdf_adapter(engine_name)

    cache_hit = False
    cache_file = None
    image: Image.Image | None = None
    total = 0

    if cache_dir:
        try:
            os.makedirs(cache_dir, exist_ok=True)
            with open(path, "rb") as pdf_fh:
                doc_digest = content_hash or hashlib.sha256(pdf_fh.read()).hexdigest()
            key_raw = f"{doc_digest}:{adapter.engine_id}:p{page_number}:dpi{dpi}:max{max_dimension}:v2"
            cache_key = hashlib.sha256(key_raw.encode("utf-8")).hexdigest()
            cache_file = os.path.join(cache_dir, f"base_{cache_key}.png")
        except OSError:
            cache_file = None

    if cache_file and os.path.isfile(cache_file):
        info = adapter.probe(path)
        total = info.page_count
        if page_number < 1 or page_number > total:
            fail("bad_page", f"Page {page_number} is outside 1..{total}.")
        try:
            with Image.open(cache_file) as cached_img:
                image = cached_img.convert("RGB")
            cache_hit = True
        except Exception:
            image = None

    if image is None:
        raster = adapter.rasterize_page(path, page_number, dpi, max_dimension)
        image = raster.image
        total = raster.page_count

        if cache_file:
            tmp_cache = f"{cache_file}.{os.getpid()}.tmp"
            try:
                with open(tmp_cache, "wb") as fh:
                    image.save(fh, format="PNG", optimize=False)
                try:
                    os.chmod(tmp_cache, 0o600)
                except OSError:
                    pass
                os.replace(tmp_cache, cache_file)
            except OSError:
                try:
                    if os.path.exists(tmp_cache):
                        os.unlink(tmp_cache)
                except OSError:
                    pass

    mark = watermark_text(identity, page_number, total)
    short_ref = sanitize_unicode_field(identity.get("ref") or identity.get("label"), 36)
    if with_watermark:
        image = apply_watermark(image, mark, page_number, total, short_ref=short_ref)

    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=False)
    png_bytes = buffer.getvalue()

    return {
        "ok": True,
        "engine": adapter.engine_id,
        "png": base64.b64encode(png_bytes).decode("ascii"),
        "width": image.width,
        "height": image.height,
        "pageCount": total,
        "bytes": len(png_bytes),
        "sha256": hashlib.sha256(png_bytes).hexdigest(),
        "watermark": mark if with_watermark else None,
        "renderMs": int((time.perf_counter() - started) * 1000),
        "cacheHit": cache_hit,
    }


def selftest(path: str, page_number: int = 1, dpi: int = 96, engine_name: str | None = None) -> dict:
    """Prove that two identities (including CJK Unicode) produce materially different pixels."""
    stamp = "2026-11-24T12:00:00Z"
    a = render(
        path,
        page_number,
        dpi,
        {"label": "Student A", "ref": "usr_aaa111", "stamp": stamp},
        engine_name=engine_name,
    )
    b = render(
        path,
        page_number,
        dpi,
        {"label": "陈伟明 Student B", "ref": "usr_bbb222", "stamp": stamp},
        engine_name=engine_name,
    )
    clean = render(
        path,
        page_number,
        dpi,
        {"label": "Student A", "ref": "usr_aaa111", "stamp": stamp},
        with_watermark=False,
        engine_name=engine_name,
    )
    font_source, font_path = resolve_font_info("陈伟明")

    return {
        "ok": True,
        "engine": a["engine"],
        "fontSource": font_source,
        "fontLoaded": bool(font_path),
        "page": page_number,
        "dpi": dpi,
        "watermarkedOutputsDiffer": a["sha256"] != b["sha256"],
        "watermarkChangesPixels": a["sha256"] != clean["sha256"],
        "shaA": a["sha256"],
        "shaB": b["sha256"],
        "shaClean": clean["sha256"],
        "watermarkA": a["watermark"],
        "watermarkB": b["watermark"],
        "bytesA": a["bytes"],
        "bytesClean": clean["bytes"],
        "renderMsA": a["renderMs"],
    }


def main() -> None:
    raw = sys.stdin.read()
    try:
        request = json.loads(raw or "{}")
    except json.JSONDecodeError:
        fail("bad_request", "Request body is not valid JSON.")

    command = request.get("command")
    engine_name = str(request.get("engine")).strip() if request.get("engine") else None
    try:
        if command == "probe":
            result = probe(str(request.get("path") or ""), engine_name=engine_name)
        elif command == "render":
            result = render(
                str(request.get("path") or ""),
                int(request.get("page") or 1),
                int(request.get("dpi") or 144),
                request.get("identity") or {},
                int(request.get("maxDimension") or MAX_DIMENSION),
                bool(request.get("watermark", True)),
                str(request.get("cacheDir")) if request.get("cacheDir") else None,
                str(request.get("contentHash")) if request.get("contentHash") else None,
                engine_name=engine_name,
            )
        elif command == "selftest":
            result = selftest(
                str(request.get("path") or ""),
                int(request.get("page") or 1),
                int(request.get("dpi") or 96),
                engine_name=engine_name,
            )
        else:
            fail("bad_command", f"Unknown command: {command!r}")
            return
    except PdfEngineError as error:
        fail(error.code, error.message)
        return
    except SystemExit:
        raise
    except (ValueError, TypeError) as error:
        fail("bad_request", str(error))
        return

    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()


if __name__ == "__main__":
    main()

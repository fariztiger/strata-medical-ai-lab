#!/usr/bin/env python3
"""
STRATA ContentVault watermark engine (Hardened — Mission 003-A: SEC-004 & SEC-005).

Rasterises a page of a private PDF and burns a per-student watermark into the
pixel data. Invoked by the trusted Node API with a JSON request on stdin and a
JSON response on stdout. No shell interpolation of paths or identifiers.

Security & Internationalisation Properties
------------------------------------------
1. Burned-in RGBA pixel compositing (no removable CSS/DOM overlay — CV-019).
2. Deterministic pan-Unicode & Mandarin (CJK) glyph rendering on minimal Linux
   containers via PyMuPDF's embedded Apache-2.0 Droid Sans Fallback TrueType
   buffer (`pymupdf.Font("china-ss").buffer`) when no OS CJK font is installed
   (SEC-004).
3. Multi-chromatic + achromatic neutral tiling (`+28 deg` primary staggered grid
   cycling Neutral Slate, Cool Teal-Navy, and Champagne Ochre + `-26 deg`
   content-intersecting neutral trace + edge stamp) to resist simple single-hue,
   channel-difference, and saturation threshold filters while keeping clinical
   typography legible (SEC-005).
"""

from __future__ import annotations

import base64
import functools
import hashlib
import io
import json
import os
import sys
import time

try:
    import pymupdf  # PyMuPDF >= 1.24 exposes the canonical module name
except ImportError:  # pragma: no cover
    import fitz as pymupdf  # type: ignore

from PIL import Image, ImageDraw, ImageFont

MAX_DIMENSION = 2600

# SEC-005: Three orthogonal ink channels (Achromatic Slate, Cool Teal-Navy, Warm Ochre)
# prevent single-color or R-B / saturation filters from stripping the watermark.
TILE_PALETTE = (
    (56, 60, 64, 72),    # Neutral Slate (achromatic: R ~= G ~= B)
    (24, 76, 92, 74),    # Cool Deep Teal-Navy (B > R)
    (138, 86, 28, 76),   # Warm Champagne Ochre (R > B)
)
CROSS_TRACE_RGBA = (62, 66, 72, 46)
INK_EDGE = (46, 54, 64)
EDGE_OPACITY = 152


def fail(code: str, message: str) -> None:
    """Emit a structured error and exit non-zero. Never leak a stack trace."""
    print(json.dumps({"ok": False, "error": code, "message": message}))
    raise SystemExit(2)


@functools.lru_cache(maxsize=1)
def _embedded_cjk_ttf_bytes() -> bytes | None:
    """
    Extract the Apache-2.0 licensed Droid Sans Fallback Regular TrueType font
    compiled into PyMuPDF (`china-ss`) so Mandarin, Japanese, Korean, and
    extended Unicode names render deterministically on minimal Linux systems.
    """
    try:
        font_obj = pymupdf.Font("china-ss")
        buf = bytes(font_obj.buffer)
        return buf if len(buf) > 1024 else None
    except Exception:
        return None


def load_font(size: int, text: str = "") -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """
    Resolve a TrueType/OpenType font capable of rendering `text`:
    1. Explicit `CV_WATERMARK_FONT_PATH` if configured.
    2. Installed OS CJK or Latin TrueType fonts when appropriate.
    3. Embedded PyMuPDF `china-ss` (Droid Sans Fallback Regular, Apache-2.0) for
       guaranteed CJK/Unicode coverage on minimal Linux containers (SEC-004).
    """
    custom_font = os.environ.get("CV_WATERMARK_FONT_PATH", "").strip()
    if custom_font and os.path.isfile(custom_font):
        try:
            return ImageFont.truetype(custom_font, size)
        except OSError:
            pass

    needs_non_ascii = any(ord(ch) > 0x024F for ch in text)
    cjk_candidates = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        "/System/Library/Fonts/PingFang.ttc",
    ]
    latin_candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\calibri.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]

    if needs_non_ascii:
        for path in cjk_candidates:
            if os.path.isfile(path):
                try:
                    return ImageFont.truetype(path, size)
                except OSError:
                    continue
        embedded = _embedded_cjk_ttf_bytes()
        if embedded:
            try:
                return ImageFont.truetype(io.BytesIO(embedded), size)
            except OSError:
                pass

    for path in latin_candidates + cjk_candidates:
        if os.path.isfile(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue

    embedded = _embedded_cjk_ttf_bytes()
    if embedded:
        try:
            return ImageFont.truetype(io.BytesIO(embedded), size)
        except OSError:
            pass

    return ImageFont.load_default()


def sanitize_unicode_field(raw: object, max_len: int) -> str:
    """Preserve printable Unicode (including CJK, accents, symbols) while stripping control chars."""
    text = "".join(ch for ch in str(raw or "") if ch.isprintable() and ch not in "\r\n\t\x00")
    return text.strip()[:max_len]


def probe(path: str) -> dict:
    if not os.path.isfile(path):
        fail("missing_file", "PDF file not found.")
    try:
        doc = pymupdf.open(path)
    except Exception as error:
        fail("unreadable", f"Could not open PDF: {type(error).__name__}")
    try:
        if doc.needs_pass:
            fail("encrypted", "PDF is password protected.")
        if doc.page_count < 1:
            fail("empty", "PDF has no pages.")
        first = doc[0].rect
        return {
            "ok": True,
            "pageCount": doc.page_count,
            "pageWidth": round(first.width, 2),
            "pageHeight": round(first.height, 2),
        }
    finally:
        doc.close()


def watermark_text(identity: dict, page_number: int, total: int) -> str:
    """
    Build the mark from server-supplied fields only, preserving full Unicode
    names (Mandarin, Malay, Tamil, accented Latin, mixed-script — SEC-004).
    """
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
    """
    Composite a multi-chromatic + neutral diagonal staggered grid, counter-angled
    central trace, and bottom forensic edge stamp directly into the page pixels.
    """
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

    # Pre-render one rotated tile for each of the 3 orthogonal ink profiles (SEC-005).
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

    # Secondary counter-angled (-26 deg) achromatic trace across body-text zones
    # so intersections with dark glyphs survive aggressive background bleaching.
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

    # Bottom forensic edge stamp in neutral slate.
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
) -> dict:
    if not os.path.isfile(path):
        fail("missing_file", "PDF file not found.")

    started = time.perf_counter()
    try:
        doc = pymupdf.open(path)
    except Exception as error:
        fail("unreadable", f"Could not open PDF: {type(error).__name__}")

    try:
        total = doc.page_count
        if page_number < 1 or page_number > total:
            fail("bad_page", f"Page {page_number} is outside 1..{total}.")

        cache_hit = False
        cache_file = None
        if cache_dir:
            try:
                os.makedirs(cache_dir, exist_ok=True)
                doc_digest = content_hash or hashlib.sha256(open(path, "rb").read()).hexdigest()
                key_raw = f"{doc_digest}:p{page_number}:dpi{dpi}:max{max_dimension}:v1"
                cache_key = hashlib.sha256(key_raw.encode("utf-8")).hexdigest()
                cache_file = os.path.join(cache_dir, f"base_{cache_key}.png")
            except OSError:
                cache_file = None

        image: Image.Image | None = None
        if cache_file and os.path.isfile(cache_file):
            try:
                with Image.open(cache_file) as cached_img:
                    image = cached_img.convert("RGB")
                cache_hit = True
            except Exception:
                image = None

        if image is None:
            page = doc[page_number - 1]
            rect = page.rect
            zoom = dpi / 72.0
            longest = max(rect.width, rect.height) * zoom
            if longest > max_dimension and longest > 0:
                zoom = max_dimension / max(rect.width, rect.height)

            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
            image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)

            # Store ONLY the unwatermarked base raster in cache (ADR-002).
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
    finally:
        doc.close()


def selftest(path: str, page_number: int = 1, dpi: int = 96) -> dict:
    """Prove that two identities (including CJK Unicode) produce materially different pixels."""
    stamp = "2026-11-24T12:00:00Z"
    a = render(path, page_number, dpi, {"label": "Student A", "ref": "usr_aaa111", "stamp": stamp})
    b = render(path, page_number, dpi, {"label": "陈伟明 Student B", "ref": "usr_bbb222", "stamp": stamp})
    clean = render(
        path,
        page_number,
        dpi,
        {"label": "Student A", "ref": "usr_aaa111", "stamp": stamp},
        with_watermark=False,
    )

    return {
        "ok": True,
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
    try:
        if command == "probe":
            result = probe(str(request.get("path") or ""))
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
            )
        elif command == "selftest":
            result = selftest(
                str(request.get("path") or ""),
                int(request.get("page") or 1),
                int(request.get("dpi") or 96),
            )
        else:
            fail("bad_command", f"Unknown command: {command!r}")
            return
    except SystemExit:
        raise
    except (ValueError, TypeError) as error:
        fail("bad_request", str(error))

    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()


if __name__ == "__main__":
    main()

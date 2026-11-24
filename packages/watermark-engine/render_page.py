#!/usr/bin/env python3
"""
STRATA ContentVault watermark engine.

Rasterises a page of a private PDF and burns a per-student watermark into the
pixel data. Invoked by the trusted Node API with a JSON request on stdin and a
JSON response on stdout. No shell interpolation of paths or identifiers.

Commands
--------
probe     Report page count and dimensions without rendering.
render    Rasterise one page with the watermark baked into the pixels.
selftest  Render one page for two identities and prove the bytes differ.
          This is the evidence behind acceptance test CV-019.

Why a burned-in mark
--------------------
The watermark is composited into the RGBA raster before PNG encoding. There is
no CSS overlay, no separate DOM layer and no client-side drawing step, so a
student cannot remove it by editing stylesheets or the DOM. Any screenshot or
saved image carries the identity of the account that requested it.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import sys
import time

try:
    import pymupdf  # PyMuPDF >= 1.24 exposes the canonical module name
except ImportError:  # pragma: no cover - compatibility with older installs
    import fitz as pymupdf  # type: ignore

from PIL import Image, ImageDraw, ImageFont

MAX_DIMENSION = 2600

# Champagne-gold mark. Opacity is deliberately strong enough to be clearly
# visible on a printed page or screenshot (that is the deterrence), while the
# thin glyph coverage keeps body text readable underneath.
INK = (146, 92, 26)
INK_EDGE = (96, 60, 16)
TILE_OPACITY = 74   # out of 255 - visible, not blinding
EDGE_OPACITY = 150


def fail(code: str, message: str) -> None:
    """Emit a structured error and exit non-zero. Never leak a stack trace."""
    print(json.dumps({"ok": False, "error": code, "message": message}))
    raise SystemExit(2)


def load_font(size: int, text: str = "") -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """
    Prefer a real TrueType face for legibility; fall back to the bundled
    bitmap font so the engine still works on a minimal machine.
    """
    needs_cjk = any(ord(ch) > 0x2E80 for ch in text)
    cjk_candidates = [
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/System/Library/Fonts/PingFang.ttc",
    ]
    latin_candidates = [
        r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\calibri.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    candidates = (cjk_candidates + latin_candidates) if needs_cjk else latin_candidates
    for path in candidates:
        if os.path.isfile(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def has_cjk_font() -> bool:
    for path in (
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/System/Library/Fonts/PingFang.ttc",
    ):
        if os.path.isfile(path):
            return True
    return False


def probe(path: str) -> dict:
    if not os.path.isfile(path):
        fail("missing_file", "PDF file not found.")
    try:
        doc = pymupdf.open(path)
    except Exception as error:  # corrupt or unsupported file
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
    Build the mark from server-supplied fields only.

    The caller (Node API) constructs `identity` from the authenticated session
    row. A client cannot inject this string.
    """
    raw_label = str(identity.get("label") or "").strip()[:60]
    if raw_label and any(ord(ch) > 0x2E80 for ch in raw_label) and not has_cjk_font():
        ascii_only = "".join(ch for ch in raw_label if ord(ch) < 0x2E80).strip(" -·()")
        label = ascii_only or "Learner"
    else:
        label = raw_label
    ref = str(identity.get("ref") or "").strip()[:40]
    stamp = str(identity.get("stamp") or "").strip()[:32]
    parts = [label, ref, f"p.{page_number}/{total}", stamp]
    return "  ·  ".join(part for part in parts if part)


def apply_watermark(image: Image.Image, mark: str, page_number: int, total: int) -> Image.Image:
    """Composite the diagonal repeating tile plus an edge stamp onto the page."""
    base = image.convert("RGBA")
    width, height = base.size
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    font_size = max(12, int(min(width, height) / 34))
    font = load_font(font_size, mark)

    # Measure once, then lay out a staggered grid across the whole surface so
    # the identity recurs everywhere and cannot be cropped away in one place.
    probe_bbox = draw.textbbox((0, 0), mark, font=font)
    text_w = max(probe_bbox[2] - probe_bbox[0], 1)
    text_h = max(probe_bbox[3] - probe_bbox[1], 1)

    # Denser tiling than the bare minimum: roughly three columns and eight rows
    # of the mark across an A4 page.
    step_x = text_w + int(width * 0.04) + 16
    step_y = text_h + int(height * 0.055) + 18
    step_x = max(step_x, int(width / 3.1))
    step_y = max(step_y, int(height / 8.5))

    tile = Image.new("RGBA", (step_x, step_y), (0, 0, 0, 0))
    tile_draw = ImageDraw.Draw(tile)
    tile_draw.text(
        (12, 6),
        mark,
        font=font,
        fill=(*INK, TILE_OPACITY),
    )
    tile = tile.rotate(30, expand=True, resample=Image.BICUBIC)

    for row, y in enumerate(range(-step_y, height + step_y, step_y)):
        offset = -step_x // 2 if row % 2 else 0
        for x in range(-step_x + offset, width + step_x, step_x):
            overlay.alpha_composite(tile, (x, y))

    # Edge stamp: survives a tight crop of the body text.
    edge_size = max(10, int(min(width, height) / 60))
    edge_font = load_font(edge_size, mark)
    edge_mark = f"STRATA ContentVault · {mark}"
    draw.rectangle(
        [(0, height - edge_size * 2 - 8), (width, height)],
        fill=(255, 255, 255, 40),
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
        if with_watermark:
            image = apply_watermark(image, mark, page_number, total)

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
    """Prove that two identities produce materially different pixels."""
    stamp = "2026-11-24T12:00:00Z"
    a = render(path, page_number, dpi, {"label": "Student A", "ref": "usr_aaa111", "stamp": stamp})
    b = render(path, page_number, dpi, {"label": "Student B", "ref": "usr_bbb222", "stamp": stamp})
    clean = render(path, page_number, dpi, {"label": "Student A", "ref": "usr_aaa111", "stamp": stamp}, with_watermark=False)

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

    # The PNG payload goes on stdout exactly once, as a single JSON object.
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()


if __name__ == "__main__":
    main()

"""
Primary production-sustainable PDF rasteriser backed by `pypdfium2` (PDFium).

Licensing note:
  `pypdfium2` Python bindings are dual-licensed (`Apache-2.0 OR BSD-3-Clause`)
  and bundle `libpdfium` (`BSD-3-Clause` / `Apache-2.0`) plus third-party native
  components (`FreeType FTL`, `libjpeg-turbo IJG/BSD`, `AGG 2.3`, `ICU`, `zlib`,
  etc.). See `docs/licensing/PDF_ENGINE_LICENSES_AND_OBLIGATIONS.md` for notice
  and binary redistribution obligations.
"""

from __future__ import annotations

import os
from PIL import Image

from .base import PageProbeResult, PdfEngineError, PdfRasterAdapter, RasterPageResult


class PyPdfium2Adapter(PdfRasterAdapter):
    engine_id = "pypdfium2"
    license_spdx = " (Apache-2.0 OR BSD-3-Clause) AND BSD-3-Clause"

    @staticmethod
    def _load_modules():
        try:
            import pypdfium2 as pdfium
            import pypdfium2.raw as pdfium_c
            return pdfium, pdfium_c
        except ImportError as exc:  # pragma: no cover
            raise PdfEngineError(
                "engine_unavailable",
                f"pypdfium2 is not installed ({type(exc).__name__}).",
            ) from exc

    def _open_document(self, path: str):
        if not path or not os.path.isfile(path):
            raise PdfEngineError("missing_file", "PDF file not found.")
        pdfium, pdfium_c = self._load_modules()
        try:
            return pdfium.PdfDocument(path)
        except pdfium.PdfiumError as error:
            if getattr(error, "err_code", None) == getattr(pdfium_c, "FPDF_ERR_PASSWORD", 4):
                raise PdfEngineError("encrypted", "PDF is password protected.") from error
            raise PdfEngineError(
                "unreadable", f"Could not open PDF: {type(error).__name__}"
            ) from error
        except Exception as error:
            raise PdfEngineError(
                "unreadable", f"Could not open PDF: {type(error).__name__}"
            ) from error

    def probe(self, path: str) -> PageProbeResult:
        doc = self._open_document(path)
        try:
            total = len(doc)
            if total < 1:
                raise PdfEngineError("empty", "PDF has no pages.")
            first_page = doc[0]
            try:
                width, height = first_page.get_size()
            finally:
                first_page.close()
            return PageProbeResult(
                engine=self.engine_id,
                page_count=total,
                page_width=round(float(width), 2),
                page_height=round(float(height), 2),
            )
        finally:
            doc.close()

    def rasterize_page(
        self,
        path: str,
        page_number: int,
        dpi: int,
        max_dimension: int,
    ) -> RasterPageResult:
        doc = self._open_document(path)
        try:
            total = len(doc)
            if total < 1:
                raise PdfEngineError("empty", "PDF has no pages.")
            if page_number < 1 or page_number > total:
                raise PdfEngineError("bad_page", f"Page {page_number} is outside 1..{total}.")

            page = doc[page_number - 1]
            bitmap = None
            try:
                pt_width, pt_height = page.get_size()
                scale = float(dpi) / 72.0
                longest_pt = max(float(pt_width), float(pt_height))
                if longest_pt * scale > max_dimension and longest_pt > 0:
                    scale = float(max_dimension) / longest_pt

                bitmap = page.render(scale=scale)
                pil_img: Image.Image = bitmap.to_pil().convert("RGB")
                return RasterPageResult(
                    engine=self.engine_id,
                    page_count=total,
                    image=pil_img,
                )
            finally:
                if bitmap is not None and hasattr(bitmap, "close"):
                    bitmap.close()
                page.close()
        finally:
            doc.close()

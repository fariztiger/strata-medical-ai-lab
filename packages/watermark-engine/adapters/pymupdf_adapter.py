"""
Optional legacy/comparison PDF rasteriser backed by `PyMuPDF` (`pymupdf`).

Retained strictly behind the `PdfRasterAdapter` interface for research benchmarking
and fallback verification (`CV_PDF_ENGINE=pymupdf`). `pymupdf` (`AGPL-3.0`) is NOT
imported unless this adapter is explicitly selected, and is omitted from default
production dependencies.
"""

from __future__ import annotations

import os
from PIL import Image

from .base import PageProbeResult, PdfEngineError, PdfRasterAdapter, RasterPageResult


class PyMuPdfAdapter(PdfRasterAdapter):
    engine_id = "pymupdf"
    license_spdx = "AGPL-3.0-only"

    @staticmethod
    def _load_module():
        try:
            import pymupdf
            return pymupdf
        except ImportError:
            try:
                import fitz as pymupdf  # type: ignore
                return pymupdf
            except ImportError as exc:
                raise PdfEngineError(
                    "engine_unavailable",
                    "PyMuPDF (pymupdf) is not installed in this environment.",
                ) from exc

    def probe(self, path: str) -> PageProbeResult:
        if not path or not os.path.isfile(path):
            raise PdfEngineError("missing_file", "PDF file not found.")
        pymupdf = self._load_module()
        try:
            doc = pymupdf.open(path)
        except Exception as error:
            raise PdfEngineError(
                "unreadable", f"Could not open PDF: {type(error).__name__}"
            ) from error
        try:
            if doc.needs_pass:
                raise PdfEngineError("encrypted", "PDF is password protected.")
            if doc.page_count < 1:
                raise PdfEngineError("empty", "PDF has no pages.")
            first = doc[0].rect
            return PageProbeResult(
                engine=self.engine_id,
                page_count=doc.page_count,
                page_width=round(first.width, 2),
                page_height=round(first.height, 2),
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
        if not path or not os.path.isfile(path):
            raise PdfEngineError("missing_file", "PDF file not found.")
        pymupdf = self._load_module()
        try:
            doc = pymupdf.open(path)
        except Exception as error:
            raise PdfEngineError(
                "unreadable", f"Could not open PDF: {type(error).__name__}"
            ) from error
        try:
            if doc.needs_pass:
                raise PdfEngineError("encrypted", "PDF is password protected.")
            total = doc.page_count
            if total < 1:
                raise PdfEngineError("empty", "PDF has no pages.")
            if page_number < 1 or page_number > total:
                raise PdfEngineError("bad_page", f"Page {page_number} is outside 1..{total}.")

            page = doc[page_number - 1]
            rect = page.rect
            zoom = float(dpi) / 72.0
            longest = max(rect.width, rect.height) * zoom
            if longest > max_dimension and longest > 0:
                zoom = float(max_dimension) / max(rect.width, rect.height)

            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
            image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
            return RasterPageResult(
                engine=self.engine_id,
                page_count=total,
                image=image,
            )
        finally:
            doc.close()

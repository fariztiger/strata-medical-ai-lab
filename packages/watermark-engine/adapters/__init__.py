"""Adapter registry for STRATA ContentVault PDF rasterisation engines."""

from __future__ import annotations

import os
from .base import PageProbeResult, PdfEngineError, PdfRasterAdapter, RasterPageResult
from .pypdfium2_adapter import PyPdfium2Adapter
from .pymupdf_adapter import PyMuPdfAdapter

DEFAULT_ENGINE = "pypdfium2"

_ADAPTERS: dict[str, type[PdfRasterAdapter]] = {
    "pypdfium2": PyPdfium2Adapter,
    "pymupdf": PyMuPdfAdapter,
}


def get_pdf_adapter(engine_name: str | None = None) -> PdfRasterAdapter:
    selected = (engine_name or os.environ.get("CV_PDF_ENGINE") or DEFAULT_ENGINE).strip().lower()
    cls = _ADAPTERS.get(selected)
    if cls is None:
        raise PdfEngineError(
            "bad_engine",
            f"Unsupported PDF engine {selected!r}. Allowed: {', '.join(sorted(_ADAPTERS))}.",
        )
    return cls()


__all__ = [
    "DEFAULT_ENGINE",
    "PageProbeResult",
    "PdfEngineError",
    "PdfRasterAdapter",
    "PyMuPdfAdapter",
    "PyPdfium2Adapter",
    "RasterPageResult",
    "get_pdf_adapter",
]

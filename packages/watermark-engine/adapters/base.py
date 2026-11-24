"""
Modular PDF rasterisation adapter contract for STRATA ContentVault (Mission 004 Phase A).

Separates engine-specific PDF parsing and page bitmap rasterisation from:
  - personalized pixel watermarking,
  - base-raster disk caching,
  - Node API authorization, entitlement enforcement, and storage layers.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass
from PIL import Image


class PdfEngineError(Exception):
    """Structured engine error mapped directly to ContentVault JSON error responses."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class PageProbeResult:
    engine: str
    page_count: int
    page_width: float
    page_height: float


@dataclass(frozen=True)
class RasterPageResult:
    engine: str
    page_count: int
    image: Image.Image


class PdfRasterAdapter(abc.ABC):
    """Pluggable PDF rasteriser contract."""

    engine_id: str = "abstract"
    license_spdx: str = "UNKNOWN"

    @abc.abstractmethod
    def probe(self, path: str) -> PageProbeResult:
        """Inspect page count and first-page PDF point dimensions."""

    @abc.abstractmethod
    def rasterize_page(
        self,
        path: str,
        page_number: int,
        dpi: int,
        max_dimension: int,
    ) -> RasterPageResult:
        """Rasterise 1-indexed `page_number` into an unwatermarked RGB PIL.Image."""

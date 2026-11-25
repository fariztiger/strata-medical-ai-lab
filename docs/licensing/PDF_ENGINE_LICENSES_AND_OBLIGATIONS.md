# PDF Rendering Engine Sustainability, Licensing & Redistribution Obligations

**Status:** Mission 004 — Phase A Implemented (`CV_PDF_ENGINE=pypdfium2` default)  
**Scope:** `packages/watermark-engine/` and `apps/contentvault-api/src/services/pdf-engine.js`

---

## 1. Important Disclaimer on Legal Compliance

Replacing an `AGPL-3.0` dependency (`PyMuPDF`) with permissively licensed libraries (`pypdfium2`, `Pillow`, `WenQuanYi Micro Hei` under `Apache-2.0`) **eliminates network-service copyleft (`AGPL-3.0` §13) source-disclosure triggers**, but **does not by itself constitute complete legal compliance**.

Production deployment still requires:
1. Satisfying **all copyright notice, attribution, and binary-wheel third-party license reproduction obligations** whenever container images, installers, or virtual appliances are distributed to third parties.
2. Reviewing **Apache-2.0 §3 patent termination clauses** and trademark restrictions.
3. Independent intellectual-property clearance and written author consent before uploading, hosting, or serving any real clinical, academic, or third-party PDF content (`AGENTS.md` §6.3 & §24).
4. Qualified legal counsel review prior to commercial contracting or external distribution.

---

## 2. Empirical Migration Benchmark (`PyMuPDF 2.1` vs `pypdfium2 5.15.2`)

Measured via `scripts/verification/benchmark_pdf_engines.py` on the 6-page synthetic neurology module (`595×842 pt`, rendered at `144 DPI` → `1190×1684 px`) with multi-chromatic + CJK watermarking:

| Metric | `PyMuPDF 2.1` (Legacy) | `pypdfium2 5.15.2` (Default) | Delta / Outcome |
| --- | --- | --- | --- |
| Primary License | `AGPL-3.0-only` (or paid Artifex) | `Apache-2.0 OR BSD-3-Clause` | Eliminates AGPL §13 SaaS copyleft |
| Linux `x86_64` Wheel Size | `69.0 MB` | `~18 MB` | **~74% smaller** install footprint |
| Output Resolution (`144 DPI`) | `1190 × 1684 px` | `1190 × 1684 px` | **Identical geometry** (`6` pages) |
| Cross-Engine Visual Fidelity | Baseline | MAE `0.806 / 255`, PSNR `32.49 dB` | Sub-pixel hinting diff only; full text & diagram clarity |
| Cold Render Latency (mean / page) | `354.33 ms` | **`309.83 ms`** | **12.6% faster** |
| Warm Base-Cache Latency (mean) | `341.00 ms` | **`283.00 ms`** | **17.0% faster** |
| Worker Peak Memory (`ru_maxrss`) | `121.35 MB` max (`113.79 MB` mean) | **`92.55 MB` max** (`81.84 MB` mean) | **23.7% lower RAM** (~29 MB saved/worker) |
| Multilingual Watermarks | CJK + Latin verified | CJK + Latin verified (`wqy-microhei.ttc`) | Zero `"Learner"` fallback |

---

## 3. Dependency & Transitive Native Binary Inventory

Because Python `manylinux` wheels bundle precompiled C/C++ shared libraries inside `.venv/lib/.../site-packages/`, operators redistributing Docker images or on-premise bundles must preserve `*.dist-info/licenses/` and account for both Python wrapper licenses and statically/dynamically linked native libraries:

| Component | Pinned Version | Declared License(s) | Bundled Native Subcomponents | Concrete Redistribution & Operational Obligations |
| --- | --- | --- | --- | --- |
| **`pypdfium2`** (Python bindings) | `5.15.2` | `Apache-2.0 OR BSD-3-Clause` *(code)*; `CC-BY-4.0` *(upstream docs)* | Prebuilt `libpdfium` (`pdfium-binaries`) | Retain `pypdfium2-5.15.2.dist-info/licenses/` in any distributed container/artifact. Exclude or attribute `CC-BY-4.0` documentation if copied separately. |
| **`libpdfium` & bundled PDFium deps** (inside `pypdfium2_raw`) | Chromium PDFium build | `BSD-3-Clause` & `Apache-2.0` | `FreeType` (`FTL`), `libjpeg-turbo` (`IJG` + `BSD-3-Clause` + `zlib`), `AGG 2.3`, `HarfBuzz` (`MIT`), `ICU` (`Unicode-3.0`), `lcms2` (`MIT`), `libopenjpeg` (`BSD-2-Clause`), `libpng`, `libtiff`, `abseil`, `brotli`, `zlib` *(non-V8/non-XFA build)* | 1. **IJG Clause (`libjpeg-turbo`):** Binary redistributions (e.g., customer-deployed containers) should include an acknowledgment in documentation: *"This software is based in part on the work of the Independent JPEG Group."*<br>2. **FreeType License (`FTL`):** Credit the FreeType Project in third-party notices when redistributing binaries.<br>3. Retain all files under `BUILD_LICENSES/` inside `.venv`. |
| **`Pillow`** (`PIL`) | `13.0.0` | `MIT-CMU` (Historical Permission Notice and Disclaimer) | `pillow.libs/`: `libfreetype`, `libharfbuzz`, `libjpeg-turbo`, `libopenjp2`, `libpng16`, `libtiff`, `libwebp`, `libavif`, `liblcms2`, `libxcb`, `libXau`, `liblzma`, `libzstd`, `libbrotli` | Retain `pillow-13.0.0.dist-info/licenses/LICENSE` (which aggregates `pillow.libs` third-party notices) in any redistributed image/bundle. |
| **WenQuanYi Micro Hei** (`wqy-microhei.ttc`) | `0.2.0-beta` (`SHA-256: e4bca8df...`) | Dual: **`Apache-2.0`** *(elected)* OR `GPL-3.0-with-font-exception` | Derived from `Droid Sans Fallback` (`Apache-2.0`) + WenQuanYi hinting | Fetched to gitignored `vendor/fonts/wqy-microhei/`. Retain `LICENSE_Apache2.txt`, `AUTHORS.txt`, and `README.txt` alongside `wqy-microhei.ttc` in any deployed image. Do **not** bundle proprietary Windows/macOS OS fonts. |
| **Node.js Runtime** | `>= 22.5.0` | `MIT` (+ ICU/OpenSSL/V8 notices in Node binary) | Built-in `node:http`, `node:crypto`, `node:sqlite` (`Public Domain` SQLite) | Zero third-party `npm` runtime dependencies in `apps/contentvault-api`. |

---

## 4. Modular Adapter Architecture

The PDF engine boundary is isolated across two layers:
- **Python Worker Layer (`packages/watermark-engine/adapters/`):**
  - `PdfRasterAdapter` (`base.py`) defines `probe(path)` and `rasterize_page(path, page_number, dpi, max_dimension)`.
  - `PyPdfium2Adapter` (`pypdfium2_adapter.py`) is the default production-sustainable adapter (`CV_PDF_ENGINE=pypdfium2`).
  - `PyMuPdfAdapter` (`pymupdf_adapter.py`) is lazily imported only if `CV_PDF_ENGINE=pymupdf` is explicitly requested for benchmarking, so `pymupdf` never needs to be installed in production.
  - Base-raster disk cache keys incorporate `adapter.engine_id` (`v2`) to prevent cross-engine cache collisions.
- **Node Service Layer (`apps/contentvault-api/src/services/pdf-engine.js`):**
  - `createPdfEngineAdapter({ engineName, runner, cacheDir, defaultDpi })` allows swapping engines or mocking worker transport in unit tests without modifying `routes.js`, `authz.js`, `content.js`, `storage.js`, or `public/app.js`.

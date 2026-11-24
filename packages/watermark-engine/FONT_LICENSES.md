# Watermark Engine Font Licensing & CJK Typography (`SEC-004`)

`packages/watermark-engine/render_page.py` deterministically renders English, Malay, Mandarin (`简体中文` / `繁體中文`), Japanese, Korean, and accented Latin learner identities across Windows, macOS, and minimal headless Linux containers without stripping non-ASCII characters.

## Font Resolution Hierarchy

1. **Custom Configured Font (`CV_WATERMARK_FONT_PATH`):**
   - Operators may supply a custom SIL Open Font License (`OFL-1.1`) or Apache-2.0 TrueType/OpenType font file (for example, `NotoSansCJKsc-Regular.otf`) via `CV_WATERMARK_FONT_PATH`.
2. **System TrueType / OpenType Fonts:**
   - Uses installed OS fonts when present (`NotoSansCJK`, `wqy-zenhei`, `DejaVuSans`, `Segoe UI`, `Microsoft YaHei`, `PingFang`).
3. **Deterministic Embedded Pan-CJK Fallback (`Droid Sans Fallback Regular`):**
   - On minimal Linux containers lacking system CJK font packages, `render_page.py` loads `Droid Sans Fallback Regular` directly from `pymupdf.Font("china-ss").buffer` into Pillow (`ImageFont.truetype`).
   - **Font License:** `Droid Sans Fallback` was developed by Ascender Corporation for the Android Open Source Project (AOSP) and is distributed under the **Apache License, Version 2.0** (`https://www.apache.org/licenses/LICENSE-2.0`).
   - **Library Note:** While the `Droid Sans Fallback` font data itself carries permissive Apache-2.0 terms, `PyMuPDF` (`pymupdf`) remains governed by `AGPL-3.0` / Artifex commercial terms (documented in `docs/security/KNOWN_LIMITATIONS.md` and `reports/SECURITY_REMEDIATION_003.md`). When migrating the rasteriser to `pypdfium2` (`Apache-2.0` / `BSD-3-Clause`) for commercial production, pair `CV_WATERMARK_FONT_PATH` with standalone `NotoSansCJKsc-Regular.otf` (`SIL OFL-1.1`, `apt-get install fonts-noto-cjk`).

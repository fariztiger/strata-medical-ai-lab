# Watermark Font Licensing & Attribution (`packages/watermark-engine`)

To guarantee deterministic Mandarin (Simplified & Traditional Chinese), Japanese, Korean, and extended Unicode watermark rendering on minimal Linux containers **without** relying on `PyMuPDF` (`AGPL-3.0`), `packages/watermark-engine/render_page.py` resolves fonts in the following order:

1. **Explicit Operator Font (`CV_WATERMARK_FONT_PATH`):**
   - Operators may supply a standalone open-licensed CJK font such as **Google / Adobe Noto Sans CJK SC (`NotoSansCJK-Regular.ttc`)** under the **SIL Open Font License 1.1 (`OFL-1.1`)** (`apt-get install fonts-noto-cjk` on Debian/Ubuntu).

2. **Pinned Setup Font (`vendor/fonts/wqy-microhei/wqy-microhei.ttc`):**
   - Installed and SHA-256 verified (`e4bca8df123ce01b104780f576ea1a58b9a5ff1662a91124b6d3180cb6c88212`) by `scripts/setup/install-python-deps.sh` and `install-python-deps.ps1` into the gitignored `vendor/fonts/wqy-microhei/` directory alongside upstream `LICENSE_Apache2.txt`, `AUTHORS.txt`, and `README.txt`.
   - **Font:** *WenQuanYi Micro Hei* (`v0.2.0-beta`), incorporating *Droid Sans* / *Droid Sans Fallback* glyphs (© Google Inc. / The Android Open Source Project) and WenQuanYi Zen Hei hinting data (© Qianqian Fang and The WenQuanYi Project Contributors).
   - **License Election:** Upstream offers dual licensing under **Apache License 2.0** OR **GPLv3 with Font Embedding Exception**. STRATA explicitly elects **Apache License 2.0** (`vendor/fonts/wqy-microhei/LICENSE_Apache2.txt`).
   - **Redistribution Obligations:** Server-side rasterisation into PNG pixels does not distribute the `.ttc` font file to end-user browsers. If container images, VM snapshots, or on-premise bundles redistribute `wqy-microhei.ttc`, they **must** retain `LICENSE_Apache2.txt`, `AUTHORS.txt`, and `README.txt` alongside the font binary per Apache-2.0 §4.

3. **System Font Discovery:**
   - Falls back to installed OS Noto CJK (`OFL-1.1`), WenQuanYi (`Apache-2.0` / `GPL+FE`), or DejaVu Sans (`Bitstream Vera` / `Arev` permissive license) when present on the host OS.
   - Note: OS fonts on Windows (`msyh.ttc`, `segoeui.ttf`) and macOS (`PingFang.ttc`) are proprietary OS components and must **never** be copied out of the host OS or bundled into container images.

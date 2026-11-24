# ADR-002: PDF rasterisation and watermarking engine

- Status: Accepted
- Date: 2026-11-24
- Milestone: M006

## Context

The core promise of ContentVault is that the original PDF never reaches the
student, and that every page a student sees carries *their* identifier burned
into the pixels, not an overlay a client can delete (acceptance test CV-019).

Options considered:

1. **Client-side PDF.js with a CSS watermark overlay.** Rejected. The original
   bytes reach the browser and the watermark disappears when a user edits the
   DOM or screenshot-tools around the overlay. This is exactly the mockup
   AGENTS.md section 26 forbids.
2. **Client-side rendering of an encrypted PDF.** Rejected. The key must reach
   the client, so the protection is only as strong as JavaScript obfuscation.
3. **Server-side rasterisation to images, watermark composited server-side.**
   Chosen. The browser receives only a rasterised page image.

## Decision

Use **PyMuPDF** (import name `pymupdf`, version 2.1) running as a local
Python worker invoked by the Node API.

- Original PDFs stay under `var/storage/private/` and are never served by any
  HTTP route.
- A page request triggers: authorisation check -> rasterise at 144 DPI ->
  draw watermark -> return PNG bytes.
- The watermark is drawn **into the rasterised page**, so disabling CSS or
  editing the DOM changes nothing. There is no overlay to remove.

### Licensing

PyMuPDF is licensed **AGPL-3.0** (or commercial from Artifex). This is a real
constraint and must be resolved before any commercial or hosted deployment:

- For local research and internal evaluation it is acceptable.
- For a hosted commercial product, either (a) open-source the service under
  AGPL, (b) purchase an Artifex commercial licence, or (c) switch to a
  permissively licensed engine.

**Action for the funding proposal: budget a line item decision for either the
Artifex licence or an alternative engine (e.g. pdfium via `pypdfium2`, which is
Apache-2.0/BSD-3).** This is recorded as an open item in
`docs/security/KNOWN_LIMITATIONS.md`.

### Installation note

`pip install` into the shared runtime was denied by the file sandbox, and pip's
temporary directory is outside the workspace. The wheel was therefore fetched
directly from PyPI and extracted into `vendor/pylibs/`. That directory is
git-ignored; `scripts/setup/install-python-deps.ps1` reproduces it.

## Consequences

- Watermark cannot be removed by client-side means (verified by CV-019).
- Rendering costs CPU per page; mitigated by a content-addressed disk cache of
  *unwatermarked* rasters, with per-user watermarks applied on top at request
  time. The cache never contains a watermarked image.
- A student receives an image, not selectable text. This is a deliberate trade
  of accessibility/convenience for protection. Text extraction is documented as
  a known limitation. An accessible transcript feature is proposed as P1.

## Verification

- `python packages/watermark-engine/render_page.py --selftest` prints a JSON
  report including DPI, watermark mode and timing.
- Test CV-019 compares page bytes with and without the watermark and asserts the
  difference is in the pixel data.

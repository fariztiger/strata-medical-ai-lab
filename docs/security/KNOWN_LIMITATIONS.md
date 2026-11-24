# STRATA ContentVault v0.1 — Known Security & Operational Limitations

- **Requirement:** Acceptance Test `CV-020` & `AGENTS.md` Sections 6.1, 9, 14, 15
- **Date:** 2026-11-24

ContentVault v0.1 demonstrates functional server-side access control and pixel-composited watermarking. In accordance with STRATA's governance principle (*Evidence before claims*), the following technical, physical, and licensing limitations are explicitly documented.

---

## 1. Screen Capture & External Camera Recording ("The Analogue Hole")

- **Limitation:** No web browser or application can prevent an authorized user from taking OS-level screenshots, using hardware capture cards, or photographing their monitor with an external smartphone camera.
- **Mitigation & Positioning:** ContentVault must **never** be marketed as "piracy-proof." Instead, every rendered page embeds a dense diagonal staggered grid plus a bottom edge stamp carrying the learner's full name, internal user ID, page number, and UTC render timestamp directly inside the PNG pixel buffer. Cropping or disabling CSS cannot strip the mark, providing strong **piracy deterrence and forensic source traceability**.

## 2. Post-Revocation Retention of Previously Captured Material

- **Limitation:** When an administrator revokes an entitlement (`POST /api/documents/:id/revoke`) or when `expires_at` passes, ContentVault immediately blocks all new page and audio requests (`HTTP 403`) and invalidates outstanding tokens via entitlement version bumping. However, **access revocation cannot erase screenshots, recordings, or images that a learner already captured locally while they were authorized.**
- **Mitigation:** Pages are delivered one rasterized page at a time with `Cache-Control: no-store, no-cache, must-revalidate, max-age=0, private`, rate-limited per learner to deter automated bulk harvesting, and permanently watermarked with the render timestamp.

## 3. PyMuPDF (`AGPL-3.0`) Software License Constraint

- **Limitation:** The server-side rasterization engine uses `PyMuPDF` (`pymupdf 2.1`), which is dual-licensed under **GNU AGPL-3.0** and Artifex commercial licensing. Under AGPL-3.0, operating PyMuPDF inside a network-accessible commercial SaaS product triggers source-disclosure obligations unless a commercial license is held.
- **Required Pre-Commercial Action:** Acceptable for private local research and internal proof-of-concept evaluation. Prior to commercial hosting, STRATA must execute one of three options budgeted in the funding proposal:
  1. Replace the rasterizer in `packages/watermark-engine/render_page.py` with **`pypdfium2`** (Apache-2.0 / BSD-3-Clause PDFium bindings), keeping the Pillow watermark pipeline unchanged;
  2. Purchase an Artifex commercial license; or
  3. Release the standalone rendering microservice under AGPL-3.0.

## 4. SQLite Prototype vs. PostgreSQL Row Level Security (RLS)

- **Limitation:** To achieve zero-cost offline reproducibility (ADR-001), v0.1 uses Node's built-in `node:sqlite` (`WAL` mode). SQLite provides single-writer concurrency and has **no database-engine Row Level Security (RLS)**. Authorization is enforced in application code (`src/security/authz.js`).
- **Required Production Migration:** Before pilot cohort scaling, migrate persistence to PostgreSQL / Supabase with **independently audited RLS policies** on `documents`, `entitlements`, `chapters`, `reading_progress`, and `audit_log`. Never expose Supabase `service_role` keys to frontend clients.

## 5. Single-Process Rate Limiting & Local Filesystem Storage

- **Limitation:** Login and page-render rate limiting (`src/http/helpers.js`) lives in Node process memory (`Map`), which resets on restart and is not shared across horizontal replicas. Private PDF/audio objects reside in `var/storage/private/` protected by OS `0600` file permissions rather than cloud IAM/KMS encryption-at-rest.
- **Required Production Migration:** Move private objects to Supabase Private Storage or Cloudflare R2 (with server-only credentials) and enforce rate limits via a shared store.

## 6. Rasterized Page Text Selection & Screen-Reader Accessibility

- **Limitation:** Delivering rasterized PNGs instead of DOM text or PDFs intentionally prevents one-click text copying, which also means screen readers cannot read body paragraphs directly from the page image.
- **Planned Enhancement (P1):** Provide authorized, watermarked/attributed structured accessible chapter summaries and audio companions alongside the visual page reader.

# Changelog

All notable changes to `strata-medical-ai-lab` are documented in this file.

## [0.2.0] — 2026-11-24 (Mission 004: Technology Sustainability, Real Chromium E2E & Production Architecture)

### Changed & Added
- **Phase A (PDF Engine Sustainability):** Replaced `PyMuPDF` (`AGPL-3.0`) with a modular `PdfRasterAdapter` (`packages/watermark-engine/adapters/`, `apps/contentvault-api/src/services/pdf-engine.js`) defaulting to `pypdfium2==5.15.2` (`12.6%` faster cold renders, `23.7%` lower peak RSS) + standalone SHA-256-verified *WenQuanYi Micro Hei* (`Apache-2.0` elected), documented transitive binary licenses and redistribution obligations (`docs/licensing/PDF_ENGINE_LICENSES_AND_OBLIGATIONS.md`), and added `tests/phase-a-pdf-engine.test.js`.
- **Phase B (Real Chromium Verification):** Configured `.github/workflows/phase-b-browser-ci.yml` and expanded `scripts/verification/playwright-e2e.mjs` to execute genuine headless Chromium tests at `1440×900` (Desktop) and `390×844` (Mobile) across all 4 synthetic personas + Reviewer, fixing a `390px` CSS Grid `minmax(0, 1fr)` mobile overflow and capturing genuine Chromium screenshots in `reports/browser-screenshots/`.
- **Phase C (Production Architecture):** Published `docs/architecture/POSTGRES_MIGRATION_AND_RLS_DESIGN.md`, implemented `db/migrations/001_postgres_schema_and_rls.sql` + `PostgresPersistenceAdapter` (verified live on `postgres:16-alpine`), replaced in-memory rate limits with shared bounded `rate_limit_buckets` (`maxBuckets=10000`), mitigated unauthenticated account-lockout DoS via composite `(IP, Account)` pair throttling, enforced production secret Shannon entropy + `CV_SIGNING_SECRET_FILE` `0600` permissions + `CV_SIGNING_SECRET_PREVIOUS` rotation, added the bilingual `#view-reviewer` portal, and published `reports/PRODUCTION_READINESS_004.md` (`40/40` Node tests passing).

## [0.1.2] — 2026-11-24 (Mission 003-A: Security Hardening & Production Isolation)

### Security (`SEC-001` .. `SEC-005`)
- **SEC-001 (Portfolio Access Control):** Restricted `/portfolio`, `/portfolio/*`, and `GET/POST /api/portfolio/enquiries` to authenticated `admin` and `reviewer` accounts (`401` anonymous, `403` student), recorded `portfolio.access` audit events, and preserved `noindex` + `no-store` headers.
- **SEC-002 (Production Isolation & Session Cap):** Disabled `/api/auth/demo-personas` and `/api/auth/demo-login` by default (`CV_ENABLE_DEMO_PERSONAS=1` required in local non-prod), stripped all password fields from API JSON, blocked `seed.js` and `CV_ALLOW_FRAME_EMBED=1` in production, refused production startup when active demo accounts exist in SQLite, and enforced a 12-hour absolute session lifetime (`CV_SESSION_MAX_HOURS`).
- **SEC-003 (Rate-Limit Integrity):** Stopped trusting `X-Forwarded-*` by default, added `CV_TRUST_PROXY` with right-to-left hop boundary extraction, and implemented per-account failed-login throttling (`8` failures / `300s`) alongside IP rate limiting.
- **SEC-004 (International Watermarks):** Enabled deterministic Mandarin and extended Unicode watermark rendering on minimal Linux systems via PyMuPDF's embedded Apache-2.0 `Droid Sans Fallback` TrueType font (`FONT_LICENSES.md`).
- **SEC-005 (Watermark Resilience & Single-Use Page Tokens):** Upgraded watermarks to cycle achromatic Neutral Slate, Cool Teal-Navy, and Warm Ochre tiles with counter-angled body-text traces, enforced atomic single-use `X-Page-Token` redemption (`token_redemptions`), and preserved bounded-window HTTP `206` Range streaming on `X-Audio-Token`.

### Fixed & Added (Priority 3 & 4)
- Downgraded `JRN-003`..`JRN-005` (`M003`) and M007 *Clinical Neurophysiology* to `PARTIALLY_VERIFIED`, completed 100% Simplified Chinese (`中文`) localization in `apps/strata-website/public/`, pinned `packages/watermark-engine/requirements.txt`, added `tests/security-003a.test.js` (`32/32` total tests passing) + `scripts/verification/playwright-e2e.mjs`, and published `reports/SECURITY_REMEDIATION_003.md`.

## [0.1.1] — 2026-11-24 (Four-Persona E2E Verification, Primary-Source M002/M003 Audit & M007 Portfolio Prototype)

### Added
- **Four-Persona End-to-End Test Suite (`apps/contentvault-api/tests/personas-e2e.test.js`):** Automated verification across `Admin`, `Student A (EN)`, `Student B (Mandarin 中文)`, and unauthorized `Student C` plus revocation/re-grant lifecycle and `/portfolio` routes (`26/26` total tests passing alongside `CV-001`..`CV-020`).
- **Live Persona Visual Captures (`scripts/verification/capture_persona_views.py` & `reports/screenshots/01..05*.png`):** Generated live HTTP + server-rasterised watermarked PNG visual captures for all 4 personas and the M007 portfolio prototype.
- **Primary-Source Verification (`M002` & `M003`):** Updated `research/professional-profile/PROFILE_VERIFICATION_REGISTER.md` (`PRF-001`..`PRF-010`) and `research/publications/ASSET_INVENTORY.md` (`PUB-001`..`PUB-010`, `JRN-001`..`JRN-005`) with official NSR `#126713`, MMC MeRITS, MSN 2017 guideline, peer-reviewed DOI, and bibliographic records verified on `2026-11-24`.
- **M007 Professional Digital Portfolio Prototype (`apps/strata-website/public/`):** Private bilingual (`EN`/`中文`) speaker, author, and clinical educator prototype mounted at `/portfolio` with `X-Robots-Tag: noindex, nofollow, noarchive`, explicit `[PLACEHOLDER]` badges for unverified items, withheld portrait placeholder, and local-only SQLite enquiry staging (`POST /api/portfolio/enquiries`).

## [0.1.0] — 2026-11-24 (Mission 002-A: ContentVault Recovery & MVP Completion)

### Fixed (Recovery from `d0fc178` Baseline)
- Fixed corrupted ESM import specifiers (`"\.\./config.js"` and invalid relative `./db.js` paths) across `src/db.js`, `src/routes.js`, `src/server.js`, `src/security/authz.js`, `src/security/crypto.js`, and `src/security/audit.js`.
- Removed CommonJS `require(...)` calls inside `"type": "module"` files (`src/server.js`, `src/routes.js`) that caused runtime `ReferenceError` crashes on startup, upload, page rendering, and engine self-test.
- Fixed broken import wiring in `src/routes.js` (moved user/session/authz imports from `services/content.js` to `security/authz.js` and imported `findUserByEmail`).
- Fixed URL routing in `src/app.js` / `src/server.js` to parse `pathname` independently of query strings so `?page=N` and `?limit=N` requests resolve accurately.
- Fixed variable-scoping bug (`storagePath`) in `handlePage` and eliminated redundant full-PDF temp copies during page renders while adding proper `finally` cleanup for staged uploads.
- Closed authorization gap in `GET /api/documents/:id` so non-admin learners must hold an active, non-expired entitlement (`canReadDocument`) to view document metadata or chapters.
- Enforced `isSameOriginMutating` CSRF origin checks on all mutating `/api/*` endpoints and explicit `404` + `audit_log` recording on `/storage` and `/var` direct-probe attempts.

### Added
- **Unwatermarked Base-Raster Cache:** Implemented content-addressed `0600` base PNG caching in `packages/watermark-engine/render_page.py` (`var/render-cache/`), compositing fresh per-learner watermarks at request time in compliance with `ADR-002`.
- **Authenticated Audio Companions:** Added deterministic 16-bit PCM WAV synthesis (`src/services/synthetic-audio.js`), short-lived signed audio tokens (`issueAudioToken` / `verifyAudioToken`), and HTTP `Range` (`206 Partial Content`) streaming in `GET /api/documents/:id/audio`.
- **Reproducible Seed & Setup Pipeline:** Added `apps/contentvault-api/scripts/seed.js` (`npm run seed`) and cross-platform `.venv` setup scripts (`scripts/setup/install-python-deps.sh` & `.ps1`).
- **Bilingual Web Reader & Admin Console (`apps/contentvault-api/public/`):** Responsive desktop/mobile interface in STRATA's Deep Navy / Emerald / Champagne Gold / Ivory palette with `EN` / `中文` toggle, page navigation, zoom, fullscreen, chapter navigation, audio player, entitlement grant/revoke/expiry controls, PDF upload, engine pixel self-test, and live security audit viewer.
- **Full Acceptance Test Suite (`CV-001` – `CV-020`):** Implemented end-to-end automated verification in `apps/contentvault-api/tests/acceptance.test.js`.
- **Project Governance & Security Documentation:** Added `README.md`, `.env.example`, `ROADMAP.md`, `MILESTONES.md`, `docs/architecture/CONTENTVAULT_ARCHITECTURE.md`, `docs/security/THREAT_MODEL.md`, `docs/security/KNOWN_LIMITATIONS.md`, `research/professional-profile/PROFILE_VERIFICATION_REGISTER.md`, `research/publications/ASSET_INVENTORY.md`, and Mission 002-A reports.

## [0.0.1-baseline] — 2026-11-24 (`d0fc178` / `0e30776`)
- Initial `agent.md` / `AGENTS.md` governance charter (`0e30776`).
- Preserved incomplete DeepSeek ContentVault experiment baseline on `research/deepseek-contentvault-baseline` (`d0fc178`).

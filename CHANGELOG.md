# Changelog

All notable changes to `strata-medical-ai-lab` are documented in this file.

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

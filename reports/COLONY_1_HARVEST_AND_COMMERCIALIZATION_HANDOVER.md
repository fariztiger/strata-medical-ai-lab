# STRATA COLONY 1 — Harvest Inventory & Standalone `ContentVault` Commercialization Handover

**Prepared By:** BRADLEY (Final Audit & Harvest Handover)  
**Source Repository:** `fariztiger/strata-medical-ai-lab` (`arena/85a94944-strata-medical-ai-lab`)  
**Audited Implementation Baseline:** `e7b062c` (docs HEAD `457914c`, `55/55` tests green, CI Runs `#19` & `#20` green)  
**Date:** 2026-11-24 (UTC)

---

## 1. Strategic Harvest Summary

Colony 1 began as a joint medical AI research workspace combining two distinct workstreams:
1. **`STRATA ContentVault`:** A zero-framework, permissively licensed (`MIT` / `Apache-2.0` / `BSD-3-Clause` / `MIT-CMU`), bilingual (`EN` / `中文`) protected document & audio delivery platform with server-side PDFium rasterisation, burned-in per-recipient pixel watermarking, single-use token anti-replay, and 4-role PostgreSQL 16 Row-Level Security (`RLS`).
2. **Specialist Research & `M007` Portfolio Prototype:** Literature/profile audits (`research/`) and a gated bilingual neurologist portfolio prototype (`apps/strata-website/public/`) referencing **Dr. Eow Gaik Bee** (subject to strict partner-consent and primary-source verification gates).

**Core Harvest Conclusion:** Over **90% of the engineering codebase is 100% domain-agnostic** and has zero dependency on clinical data or individual specialist identity. It can be cleanly extracted into a standalone commercial product — **`STRATA ContentVault v1.0`** — serving medical education, legal/boardroom datarooms, financial research distribution, executive coaching, and paid technical publishing.

---

## 2. Complete Inventory of Reusable Technology Assets

### Tier 1 — Directly Commercializable Core Product Assets (`Extract As-Is / Minor Decouple`)

| Asset ID | Repository Path(s) | Technology & License Posture | Commercial Capability & Value | Extraction Action |
| :--- | :--- | :--- | :--- | :--- |
| **`HV-CORE-01`** | `packages/watermark-engine/{render_page.py, requirements.txt, FONT_LICENSES.md, adapters/base.py, adapters/pypdfium2_adapter.py}` + `vendor/fonts/wqy-microhei/` | Python 3.11+, `pypdfium2==5.15.2` (`Apache-2.0`/`BSD-3-Clause`), `Pillow==13.0.0` (`MIT-CMU`), `wqy-microhei.ttc` (`Apache-2.0`). **Zero `AGPL`/`GPL`.** | Server-side 144–300 DPI PDF rasteriser (`MAX_DIMENSION=2600` bomb clamp) + burned-in diagonal lattice & micro-banner watermarking across ASCII, accented Latin, Simplified/Traditional Chinese, Japanese, and Korean. | **Extract to `packages/watermark-engine/`** *(drop `adapters/pymupdf_adapter.py` — see Tier 4)*. |
| **`HV-CORE-02`** | `apps/contentvault-api/src/services/pdf-engine.js` | Node.js ESM (`MIT`, zero npm deps) | Modular PDF engine adapter with bounded global worker concurrency (`CV_WORKER_MAX_CONCURRENCY`), FIFO wait queue (`503` + `Retry-After`), per-user inflight budget (`429`), `SIGTERM` -> `SIGKILL` wedged-worker reaper, SHA-256 base-raster cache with TTL/byte/count LRU eviction, `statfs` low-disk circuit breaker, and live worker telemetry. | **Extract to `apps/api/src/services/pdf-engine.js`**. |
| **`HV-CORE-03`** | `db/migrations/{001_postgres_schema_and_rls.sql, 002_database_roles_and_hardening.sql}` + `db/migrations/rollback/{001_down.sql, 002_down.sql}` + `apps/contentvault-api/scripts/migrate-pg.js` | PostgreSQL 16 SQL + `pg` (`MIT`) | Production 4-role database security model (`cv_owner`, `cv_auth_definer`, `cv_backup_maint`, `cv_runtime`), `FORCE ROW LEVEL SECURITY` across all tables, column-level `password_hash` isolation, `auth_bootstrap`-only credential lookup, immutable trigger-protected `audit_log`, `LOGGED` crash-safe single-use token & lockout-exempt rate-limit ledgers, and reversible migration CLI. | **Extract to `db/migrations/`** *(drop `portfolio_enquiries` table/policies during standalone product cutover)*. |
| **`HV-CORE-04`** | `apps/contentvault-api/src/persistence/adapter.js` + `src/db.js` + `scripts/check-db.js` | Node.js 22 (`node:sqlite` + `pg`, `MIT`) | Dual-backend asynchronous `PersistenceAdapter`: zero-infrastructure local SQLite (`0600` WAL) for developer onboarding/demos + fail-closed multi-replica PostgreSQL 16 RLS (`SEC-DB-003` runtime role guard) with `/readyz` verification. | **Extract to `apps/api/src/persistence/`** *(remove `portfolio_enquiries` methods)*. |
| **`HV-CORE-05`** | `apps/contentvault-api/src/security/{crypto.js, authz.js, audit.js}` + `src/config.js` + `src/http/helpers.js` | Node.js `node:crypto` + `node:net` (`MIT`, zero npm deps) | Bounded async `scrypt` password hashing & backpressure (`503 auth_busy`), HMAC-SHA256 purpose-bound single-use `X-Page-Token` (`jti` replay protection) & HTTP `Range`-safe `X-Audio-Token`, bounded 24h zero-downtime key rotation (`_PREVIOUS_FILE` + `EXPIRES_AT`), DEFLATE periodic-secret rejection, `net.BlockList` IPv4/IPv6 CIDR `CV_TRUST_PROXY` parser, clean-IP vs bad-password DoS budget separation, and append-only audit logger. | **Extract to `apps/api/src/security/` & `src/http/`** *(strip unreferenced legacy sync wrappers)*. |
| **`HV-CORE-06`** | `apps/contentvault-api/src/{server.js, app.js, routes.js}` + `src/services/{content.js, storage.js}` | Node.js `node:http` (`MIT`, zero web framework bloat) | Complete HTTP API: authentication, RBAC (`admin`, `student`/`member`), PDF upload & page-count validation, chapter index & Range audio streaming (`206 Partial Content`), watermarked page delivery (`Cache-Control: no-store`), per-page reading progress sync, live entitlement grant/revoke/expiry, and admin telemetry/audit endpoints. | **Extract to `apps/api/src/`** *(remove `/portfolio` static mount & `/api/portfolio/enquiries` route from `app.js`)*. |
| **`HV-CORE-07`** | `apps/contentvault-api/public/{index.html, app.js, styles.css, favicon.svg}` | Vanilla ES2022 + CSS (`MIT`, zero frontend build step or supply-chain deps) | Responsive Desktop (`1440×900`) & Mobile (`390×844`) bilingual (`EN` / `中文`) SPA: Admin Console (upload, chapter/audio manager, live entitlement grant/revoke, watermark pixel self-test, audit viewer) + Protected Learner Reader (canvas/blob page viewer, zoom/fullscreen, chapter drawer, blob-preloaded HTML5 audio player, reading progress resume). | **Extract to `apps/api/public/`** *(remove `#view-reviewer` / `#header-portfolio-link` M007 link)*; rebrand header subtitle from *Medical AI Research Lab* to neutral product branding. |

### Tier 2 — Commercial DevSecOps, Packaging, Compliance & Verification Assets (`Extract As-Is`)

| Asset ID | Repository Path(s) | Purpose & Commercial Reuse Value |
| :--- | :--- | :--- |
| **`HV-OPS-01`** | `scripts/operations/backup-restore.mjs` + `docs/operations/{BACKUP_AND_RECOVERY.md, DEPLOYMENT_RUNBOOK.md}` + `docs/security/{DATABASE_RUNTIME_PRIVILEGES.md, THREAT_MODEL.md, KNOWN_LIMITATIONS.md}` | Turnkey disaster-recovery CLI (`backup-sqlite` via atomic `VACUUM INTO`, `backup-pg` via `cv_backup_maint` repeatable-read snapshot + `cv_purge_expired_ephemeral()`, cryptographic SHA-256 tamper verification, and verified `restore-sqlite`/`restore-pg`) plus operator runbooks. |
| **`HV-OPS-02`** | `scripts/packaging/build-third-party-notices.mjs` + `docs/licensing/{THIRD_PARTY_NOTICES.md, PDF_ENGINE_LICENSES_AND_OBLIGATIONS.md}` | Automated copyleft gatekeeper (fails closed if any `AGPL`/`GPL` dependency appears) and deterministic generator for `/opt/strata/THIRD_PARTY_NOTICES.txt` preserving `MIT`, `BSD-3-Clause`, `Apache-2.0`, `MIT-CMU`, `FTL`, and `IJG` notices. |
| **`HV-OPS-03`** | `Dockerfile` + `.dockerignore` + `docker-compose.postgres.yml` + `.env.example` + `scripts/setup/install-python-deps.{sh,ps1}` | Non-root (`USER node`) production container build with `/readyz` `HEALTHCHECK` and multi-container reference topology separating `migrate` (`strata_owner`) from `contentvault-api` (`cv_runtime`) with `0400` mounted signing secrets. |
| **`HV-OPS-04`** | `apps/contentvault-api/tests/*.test.js` (`10` suites) + `scripts/verification/{playwright-e2e.mjs, benchmark_pdf_engines.py}` + `.github/workflows/phase-b-browser-ci.yml` | Complete `55`-test security/concurrency/PostgreSQL/backup regression harness + genuine `postgres:16-alpine` & headless Chromium Desktop/Mobile CI pipeline. |

### Tier 3 — Synthetic Curriculum & Audio Generators (`Extract to Dev/Test Only — Never Ship in Prod`)

| Asset ID | Repository Path(s) | Commercial Role |
| :--- | :--- | :--- |
| **`HV-SYN-01`** | `scripts/synthetic/{make_synthetic_pdf.py, render_sample.py, verify_watermark_visual.py}` + `apps/contentvault-api/src/services/synthetic-audio.js` + `apps/contentvault-api/scripts/seed.js` + `knowledge/synthetic/synthetic-neurology-module.pdf` | Generates clean-room synthetic multi-page PDFs (clinical tables, vector diagrams, typography) and synthetic WAV chapter audio for CI tests and sales sandbox demos with zero copyrighted or patient data. Replace neurology-specific copy with neutral enterprise/education demo copy if desired. |

### Tier 4 — Quarantined / Non-Extractable Assets (`DO NOT Extract into Standalone ContentVault`)

| Asset ID | Repository Path(s) | Reason for Quarantine & Governance Rule |
| :--- | :--- | :--- |
| **`HV-QUAR-01`** | `apps/strata-website/public/{index.html, portfolio.css, portfolio.js}` + `research/professional-profile/PROFILE_VERIFICATION_REGISTER.md` + `research/publications/ASSET_INVENTORY.md` | **Partner-Consent Gated (`Dr. Eow Gaik Bee`):** Contains specialist name, clinical profile, and `M007` neurologist portfolio prototype (plus `PARTIALLY_VERIFIED` items `JRN-003`..`JRN-005` and *Clinical Neurophysiology* subspecialty listing). **Strictly remain in private research lab until explicit written consent and primary-source verification are obtained.** |
| **`HV-QUAR-02`** | `packages/watermark-engine/adapters/pymupdf_adapter.py` | **Copyleft Hygiene:** Optional benchmark-only wrapper referencing `PyMuPDF` (`AGPL-3.0`). Exclude from commercial `STRATA ContentVault` repo so zero `AGPL` adapter code exists in commercial distributions. |
| **`HV-QUAR-03`** | `scripts/verification/capture_persona_views.py` + `reports/screenshots/01..05*.png` | **Deprecated Legacy Artifacts (`AUD-B2`):** Historical `v0.1.1` non-browser composites superseded by `playwright-e2e.mjs` (`reports/browser-screenshots/`). |

---

## 3. Standalone `STRATA ContentVault v1.0` Extraction Blueprint

When spinning out the standalone commercial repository (e.g., `strata-contentvault`), execute the following **5-step clean-room extraction**:

1. **Repository Layout:**
   ```text
   strata-contentvault/
   ├── apps/contentvault-api/      #HV-CORE-02, 04, 05, 06, 07 + HV-OPS-04
   ├── packages/watermark-engine/  #HV-CORE-01 (pypdfium2 + Pillow + wqy-microhei ONLY)
   ├── db/migrations/              #HV-CORE-03 (4-role PG16 RLS + rollback)
   ├── scripts/{operations,packaging,setup,synthetic,verification}/
   ├── docs/{architecture,licensing,operations,security}/
   ├── Dockerfile
   ├── docker-compose.postgres.yml
   └── .env.example
   ```
2. **Surgical Decoupling from `M007` Specialist Portfolio (`~45` LOC removal):**
   - Remove `apps/strata-website/` (`HV-QUAR-01`) and `research/`.
   - Remove `/portfolio` static handler, `/api/portfolio/enquiries` endpoint (`app.js`), `portfolio_enquiries` DDL/RLS policies (`001`/`002` SQL + `adapter.js`), and the `reviewer` role (`VALID_ROLES = ['admin', 'student']` or rename `'student'` -> `'member'`/`'learner'` via display alias).
   - Remove `packages/watermark-engine/adapters/pymupdf_adapter.py` (`HV-QUAR-02`) and lock `CV_PDF_ENGINE=pypdfium2`.
   - Remove unreferenced legacy sync SQLite exports noted in `OBS-005B-1`.
3. **High-Scale Commercial Enhancements (Post-Extraction v1.1 Roadmap — Optional, Non-Blocking for v1.0 Single-Node / Shared-Volume Deployments):**
   - Add an `S3StorageAdapter` (`AWS S3` / `Cloudflare R2` / `MinIO`) alongside `LocalPrivateStorage` in `src/services/storage.js` for stateless multi-replica container horizontal scaling.
   - Add an optional persistent Python worker pool (`stdin`/`stdout` length-prefixed IPC over warm `pypdfium2` workers) behind `createPdfEngineAdapter({ runner })` for `> 50 RPS` enterprise deployments.
   - Add edge Turnstile/WebAuthn hook on `POST /api/auth/login` when `login:acct-clean:<email>` exceeds threshold (`AUD-D1` defense-in-depth).

---

## 4. Non-Technical Commercialization & Governance Checklist

- [ ] **Legal Counsel Sign-Off:** Review `docs/licensing/THIRD_PARTY_NOTICES.md` (`/opt/strata/THIRD_PARTY_NOTICES.txt`), customer EULA/ToS, and PDPA/GDPR audit-log retention disclosures (`audit_log` records IP, User-Agent, and recipient watermark identity for leak attribution).
- [ ] **Font & Container Hygiene:** Build commercial images exclusively from `Dockerfile` (`fonts-wqy-microhei` Apache-2.0); never bundle proprietary Windows/macOS host fonts (`msyh.ttc`, `PingFang.ttc`, `segoeui.ttf`).
- [ ] **Partner & Content Consent (`AGENTS.md` §6.3, §24):** Keep Dr. Eow Gaik Bee's `M007` portfolio and all real specialist/medical materials strictly private until written authorization and primary-source verification (`JRN-003`..`JRN-005`, *Clinical Neurophysiology*) are completed.

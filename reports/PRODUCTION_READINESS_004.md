# STRATA ContentVault — Mission 004: Technology Sustainability & Production-Readiness Report

- **Branch:** `arena/85a94944-strata-medical-ai-lab` *(Note: Arena Agent Mode binds each session to its fixed active branch; commits advance cleanly from approved commit `922cf05` while keeping `main` at `0e30776` and `research/deepseek-contentvault-baseline` at `d0fc178` untouched. PR `#1` remains `OPEN` and unmerged.)*
- **Data Governance:** Exclusively synthetic demonstration data (`knowledge/synthetic/synthetic-neurology-module.pdf` + synthetic personas). Dr. Eow Gaik Bee's `M007` portfolio remains private, authenticated (`reviewer`/`admin`), and `noindex`; zero external publication has occurred.

---

## 1. Phase A — PDF Engine Sustainability (`PyMuPDF` → `pypdfium2`)

### Modular Adapter Architecture
- **Python Worker Adapter (`packages/watermark-engine/adapters/`):** `PdfRasterAdapter` (`base.py`) decouples PDF parsing/rasterisation from pixel watermarking and disk caching. `PyPdfium2Adapter` (`CV_PDF_ENGINE=pypdfium2`, default) runs with **`pymupdf` (`AGPL-3.0`) completely uninstalled** from `.venv` and `packages/watermark-engine/requirements.txt`. `PyMuPdfAdapter` is lazily loaded only if `CV_PDF_ENGINE=pymupdf` is explicitly set for benchmarking.
- **Node Service Adapter (`apps/contentvault-api/src/services/pdf-engine.js`):** `createPdfEngineAdapter({ engineName, runner, cacheDir, defaultDpi })` swaps engines without modifying `routes.js`, `authz.js`, `content.js`, `storage.js`, or `public/app.js`. Base-raster cache keys (`v2`) include `adapter.engine_id`.
- **Standalone Multilingual Font (`vendor/fonts/wqy-microhei/wqy-microhei.ttc`):** `scripts/setup/install-python-deps.{sh,ps1}` deterministically fetches and SHA-256 verifies (`e4bca8df123ce01b104780f576ea1a58b9a5ff1662a91124b6d3180cb6c88212`) *WenQuanYi Micro Hei* elected under **Apache License 2.0**, removing prior reliance on `pymupdf.Font("china-ss").buffer`.

### Empirical Verification (`scripts/verification/benchmark_pdf_engines.py`)
| Dimension | `PyMuPDF 2.1` (`AGPL-3.0`) | `pypdfium2 5.15.2` (`Apache-2.0 / BSD-3-Clause`) | Verified Result |
| --- | --- | --- | --- |
| Geometry & Resolution (`144 DPI`) | `6` pages · `1190 × 1684 px` | `6` pages · `1190 × 1684 px` | **Identical** (`595 × 842 pt`) |
| Text & Diagram Fidelity | Baseline | MAE `0.806 / 255`, PSNR `32.49 dB` | Crisp typography & tables |
| Cold Render Latency (mean) | `354.33 ms` | **`309.83 ms`** | **12.6% faster** |
| Warm Cache Latency (mean) | `341.00 ms` | **`283.00 ms`** | **17.0% faster** |
| Worker Peak Memory (`ru_maxrss`) | `121.35 MB` max (`113.79 MB` mean) | **`92.55 MB` max** (`81.84 MB` mean) | **23.7% lower RSS** |
| Wheel Footprint (`manylinux_x86_64`) | `69.0 MB` | `~18 MB` | **~74% smaller** |
| Multilingual Watermarking | CJK/Latin verified | Simplified/Trad. Chinese, Japanese, Korean, Latin verified | Distinct SHA-256 pixel digests |

### Licensing & Redistribution Obligations
Documented in `docs/licensing/PDF_ENGINE_LICENSES_AND_OBLIGATIONS.md` and `packages/watermark-engine/FONT_LICENSES.md`:
- Eliminating `AGPL-3.0` removes network-service copyleft triggers, **not** general legal compliance duties.
- Binary container redistributions must retain `.dist-info/licenses/` (`pypdfium2`, `Pillow`), include `FreeType` (`FTL`) credit and `libjpeg-turbo` (`IJG`) documentation acknowledgments, keep `LICENSE_Apache2.txt` + `AUTHORS.txt` alongside `wqy-microhei.ttc`, and never redistribute proprietary Windows/macOS OS fonts or unconsented third-party clinical PDFs.

---

## 2. Phase B — Genuine Chromium Browser Verification

- **Runner Configuration:** `.github/workflows/phase-b-browser-ci.yml` executes `scripts/verification/playwright-e2e.mjs --strict` against real headless Google Chrome / Chromium on `ubuntu-latest` (`CV_REQUIRE_BROWSER=1`).
- **Viewports & Coverage Verified in Real Chromium:**
  - **Desktop (`1440 × 900`) & Mobile (`390 × 844`):** Zero horizontal overflow (`scrollWidth <= innerWidth`) across login, library, protected reader, mobile chapter drawer, reviewer portal, and `M007` portfolio *(caught and fixed a real CSS Grid `1fr` → `minmax(0, 1fr)` overflow on `390px` mobile that static regex checks missed)*.
  - **All 4 Synthetic Personas + Reviewer:** Admin console & live PDFium pixel self-test (`Persona 1`), Student A English reader + Page 1→2 navigation + HTML5 `<audio>` blob playback (`Persona 2`), Student B Mandarin `中文`↔`EN` toggle + distinct CJK watermark + live mid-session entitlement revocation (`Persona 3`), Student C `403` refusal (`Persona 4`), and Reviewer least-privilege landing portal + `/portfolio` `401`/`403`/`200` access control.
- **Genuine Browser Evidence (`reports/browser-screenshots/`):** `01-desktop-admin-console.png` through `08-mobile-portfolio-en.png` + `browser-verification-report.json` captured directly by Chromium via `page.screenshot()` (never synthetic composites).

---

## 3. Phase C — Production Architecture Prototypes & Safeguards

1. **Migration Design First:** Documented schema mapping, RLS invariants, rollback triggers, and regression plan in `docs/architecture/POSTGRES_MIGRATION_AND_RLS_DESIGN.md` prior to coding.
2. **PostgreSQL 16 Persistence Adapter & Kernel RLS (`db/migrations/001_postgres_schema_and_rls.sql`, `src/persistence/adapter.js`):**
   - Local development remains zero-dependency on `node:sqlite` (`SqlitePersistenceAdapter`, $0 paid infrastructure).
   - `PostgresPersistenceAdapter` wraps every unit of work in `BEGIN; SET LOCAL ROLE cv_app_user; SELECT set_config('app.current_user_id', $1, true), set_config('app.current_user_role', $2, true); ... COMMIT;`.
   - Verified live against both `PGlite` (WASM PG 16) locally and **`postgres:16-alpine`** in GitHub Actions (`scripts/verification/verify-postgres-rls.mjs`): `ENABLE` + `FORCE ROW LEVEL SECURITY` blocks cross-student entitlement reads, unentitled `documents`/`chapters` reads, and student `portfolio_enquiries` access, while SQL role grants deny `UPDATE`/`DELETE`/`TRUNCATE` on `audit_log`.
3. **Shared & Bounded Rate Limiting (`src/http/helpers.js`, `src/persistence/adapter.js`):**
   - Replaced unbounded in-memory `Map` with shared table-backed `rate_limit_buckets` (`SQLite` locally / `UNLOGGED` table in PostgreSQL) capped at `CV_RATE_LIMIT_MAX_BUCKETS=10000` with oldest-expiry eviction.
4. **Account-Lockout DoS Mitigation (`src/routes.js`):**
   - Combines per-`(IP, Account)` pair throttling (`5 / 300s`), distributed account velocity (`8 / 300s`), and global scrypt CPU ceiling (`30 / 300s`). A legitimate user signing in from a clean IP (`pairCount === 0`) with their **valid** password succeeds (`200 OK`) even during an active third-party credential-stuffing spray, while offending IPs and wrong guesses receive `429`. Also hardened `DEMO_PERSONA_EMAILS` with `Object.create(null)`.
5. **Production Secret Entropy, File Mounts & Key Rotation (`src/config.js`, `src/security/crypto.js`):**
   - `NODE_ENV=production` rejects low-entropy secrets (`< 3.5 bits/char` or `< 12` distinct chars, e.g., `'a'.repeat(64)`), supports `CV_SIGNING_SECRET_FILE` (enforcing `0600`/`0400` permissions on POSIX), and supports `CV_SIGNING_SECRET_PREVIOUS` for zero-downtime HMAC key rotation.
6. **Reviewer-Specific Landing Experience (`public/index.html`, `public/app.js`):**
   - Added bilingual (`EN` / `中文`) `#view-reviewer` portal explaining least-privilege reviewer scope and linking directly to `/portfolio`.

---

## 4. Automated Test & Readiness Matrix

| Verification Suite | Scope | Result |
| --- | --- | --- |
| `tests/acceptance.test.js` | Original `CV-001` .. `CV-020` acceptance matrix | **`20 / 20 PASS`** |
| `tests/personas-e2e.test.js` | 4-persona E2E + revocation + gated `M007` | **`6 / 6 PASS`** |
| `tests/security-003a.test.js` | `SEC-001` .. `SEC-005` + Mandarin `M007` VM | **`6 / 6 PASS`** |
| `tests/phase-a-pdf-engine.test.js` | Modular adapter swap, `pypdfium2` 144 DPI, CJK, `<160 MB` RSS | **`3 / 3 PASS`** |
| `tests/phase-c-architecture.test.js` | PG/SQLite adapters, bounded limiter, DoS-safe auth, secret entropy, reviewer portal | **`5 / 5 PASS`** |
| `verify-postgres-rls.mjs` (`postgres:16-alpine` CI) | Live PostgreSQL 16 kernel RLS & append-only `audit_log` | **`PASS`** |
| `playwright-e2e.mjs --strict` (`ubuntu-latest` CI) | Real Chromium `1440×900` + `390×844` + `<audio>` + screenshots | **`PASS`** |

### Remaining Gate Before External Pilot Launch
1. Wire HTTP route handlers from synchronous `node:sqlite` helpers onto async `PostgresPersistenceAdapter` against managed PostgreSQL 16 (`Stage 2` cutover in `docs/architecture/POSTGRES_MIGRATION_AND_RLS_DESIGN.md`).
2. Provision TLS termination (`CV_TRUST_PROXY` set to ingress CIDR) and container third-party license bundle (`/app/THIRD_PARTY_NOTICES.txt`).
3. Obtain written sign-off from Dr. Eow Gaik Bee prior to any external `M007` deployment or real clinical content ingestion (`AGENTS.md` §6.3, §24).

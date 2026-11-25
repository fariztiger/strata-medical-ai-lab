# STRATA RESEARCH LAB — MISSION 004-B: INDEPENDENT TECHNOLOGY SUSTAINABILITY AUDIT

- **Assigned Auditor:** BRADLEY (Independent Technology Sustainability & Security Audit)
- **Repository:** `https://github.com/fariztiger/strata-medical-ai-lab` (`PR #1` — **OPEN / UNMERGED**)
- **Commit Audited:** `5f39e6009088605cfe61923c7f2c06335fd7ad6b` (`5f39e60`)
- **Previously Approved Baseline:** `922cf05`
- **Audit Date:** `2026-11-24` (UTC)
- **Source-Code Non-Modification Attestation:** Application source code was **not** modified during this audit (`git diff 5f39e60 -- apps packages db scripts .github` is empty). All clean-checkout builds, PostgreSQL 16 kernel exploits/probes, malformed PDF bombs, and DoS simulations were executed in isolated `/tmp/audit-004b-*` workspaces and cleaned up upon completion.

---

## Executive Summary

Commit `5f39e60` genuinely resolves two major sustainability and verification gaps from `922cf05`:
1. **Runtime AGPL-3.0 elimination (`Phase A`):** `PyMuPDF` is completely removed from runtime dependencies and `.venv`, replaced by a clean modular `pypdfium2==5.15.2` + `Pillow==13.0.0` + *WenQuanYi Micro Hei* (`Apache-2.0`) pipeline that is faster (`~319 ms` cold mean), lighter (`92.5 MB` peak RSS), and verified across CJK/Latin watermarks and malformed/oversized PDFs.
2. **Genuine Chromium verification (`Phase B`):** GitHub Actions Run `45484670561` executed real headless Google Chrome (`157.0.8103.78`) across `1440×900` and `390×844` viewports and produced authentic browser PNG screenshots (`reports/browser-screenshots/`).

However, **independent code-path tracing and adversarial live testing prove that critical production architecture items (`Phase C`) remain prototypes rather than integrated production controls**:
- **PostgreSQL is NOT wired into the HTTP application (`AUD-C1`):** Zero runtime route handlers (`server.js`, `app.js`, `routes.js`, `authz.js`, `content.js`, `audit.js`) instantiate `PostgresPersistenceAdapter` or read `DATABASE_URL`; `100%` of live HTTP traffic still runs synchronously on `node:sqlite`.
- **PostgreSQL RLS privilege & helper flaws (`AUD-C2`, `AUD-C3`, `AUD-C4`):** `cv_app_user` is `NOLOGIN` and entered via `SET LOCAL ROLE` from the migration owner/superuser connection (allowing `RESET ROLE` escalation or raw-pool RLS bypass), `SECURITY DEFINER cv_lookup_auth_user(email)` is callable by `student` sessions to read admin `password_hash` values, and `PostgresPersistenceAdapter.rateLimit` has an inverted `ORDER BY expires_at_ms ASC OFFSET` eviction query that deletes **newer** buckets instead of oldest ones.
- **Account-lockout DoS & rate-limit eviction bypass (`AUD-D1`, `AUD-D2`):** Sending `30` bad logins (`6` IPs × `5` attempts) trips `LOGIN_GLOBAL_CPU_CEILING` (`30 / 300s`) *before* the clean-IP check, locking out the legitimate user (`HTTP 429`) even from a clean IP with a valid password; conversely, spraying `maxBuckets` unique dummy keys evicts older active lockouts in SQLite.

---

## AUDIT A — PDF ENGINE (`PyMuPDF` → `pypdfium2`)

### 1. Clean-Checkout Reproduction & Runtime Dependency Verification
Reproduced from scratch in an isolated clone with no `.venv/` or `vendor/`:
```bash
git clone /home/user/strata-medical-ai-lab /tmp/audit-004b-clean
cd /tmp/audit-004b-clean && git checkout 5f39e60
./scripts/setup/install-python-deps.sh
.venv/bin/pip list --format=json
```
- **Verified `.venv` packages:** `Pillow==13.0.0`, `pypdfium2==5.15.2` (`pip`, `setuptools` stdlib venv bootstrap). **`pymupdf` is completely absent** from `.venv`, `packages/watermark-engine/requirements.txt`, and `apps/contentvault-api/package.json` (`0` npm runtime dependencies).
- **Font verification:** `vendor/fonts/wqy-microhei/wqy-microhei.ttc` (`5,177,387` bytes) downloaded cleanly with `LICENSE_Apache2.txt` and `AUTHORS.txt`, matching pinned SHA-256 `e4bca8df123ce01b104780f576ea1a58b9a5ff1662a91124b6d3180cb6c88212`.
- **Runtime vs. development-only tooling distinction:**
  - *Runtime (`packages/watermark-engine/render_page.py`, `adapters/pypdfium2_adapter.py`):* Zero `pymupdf` dependency. `adapters/pymupdf_adapter.py` imports `pymupdf` lazily only if `CV_PDF_ENGINE=pymupdf` is explicitly requested.
  - *Dev/legacy scripts (`scripts/synthetic/make_synthetic_pdf.py`, `scripts/verification/capture_persona_views.py`):* Still contain top-level `import pymupdf` without a separate `requirements-dev.txt`; invoking `capture_persona_views.py` on a clean checkout fails immediately with `ModuleNotFoundError: No module named 'pymupdf'`.

### 2. Direct & Transitive Licensing Inspection
Inspected unpacked wheel contents inside `.venv/lib/python3.11/site-packages/`:
- **`pypdfium2-5.15.2` (`pypdfium2_raw/libpdfium.so`, `8.27 MB`):** Wraps Chromium PDFium (`Apache-2.0 OR BSD-3-Clause`; non-V8, non-XFA build). `pypdfium2-5.15.2.dist-info/licenses/BUILD_LICENSES/` contains 16 third-party notices (`freetype.txt` [`FTL`], `libjpeg_turbo.ijg` [`IJG`], `agg23.txt`, `icu.txt`, `harfbuzz.txt`, `lcms.txt`, `libopenjpeg.txt`, `libpng.txt`, `libtiff.txt`, `abseil.txt`, `fast_float.txt`, `highway.txt`, `dragonbox-*`).
- **`Pillow-13.0.0` (`pillow.libs/`, `14.4 MB`, 17 shared `.so` files):** Bundles `libavif`, `libfreetype`, `libharfbuzz`, `libjpeg-turbo`, `liblcms2`, `liblzma`, `libopenjp2`, `libpng16`, `libsharpyuv`, `libtiff`, `libwebp*`, `libXau`, `libxcb`, and `libzstd` under `pillow-13.0.0.dist-info/licenses/LICENSE` (`MIT-CMU` + aggregated notices).
- **`wqy-microhei.ttc`:** Dual-licensed (`Apache-2.0` OR `GPL-3.0-with-font-exception`); repo explicitly elects `Apache-2.0` and retains `LICENSE_Apache2.txt`.
- **Assessment:** `docs/licensing/PDF_ENGINE_LICENSES_AND_OBLIGATIONS.md` accurately identifies the `FTL` credit, `IJG` documentation clause, and font/wheel notice retention duties without overclaiming automatic legal compliance. Note: `resolve_font_info()` (`render_page.py:67-86`) lists Windows/macOS proprietary fonts (`msyh.ttc`, `segoeui.ttf`, `PingFang.ttc`) as host fallbacks; operators must never copy OS fonts into container images.

### 3. Independent Benchmark, Readability & Adversarial PDF Tests
Independently executed `.venv/bin/python scripts/verification/benchmark_pdf_engines.py` and custom malformed/bomb probes on `5f39e60`:
- **Benchmark (`144 DPI`, `1190 × 1684 px`, 6 pages):** Cold render mean `319.0 ms` (`305–341 ms`), warm cache mean `299.17 ms`, peak worker RSS `92.53 MB` max (`82.0 MB` mean), Page 2 dark glyph ink `1.976%`, luminance std-dev `32.53` (confirming crisp clinical text & table contrast; visually confirmed in `02-desktop-student-a-reader-en.png` and `03-desktop-student-b-reader-zh.png`).
- **Multilingual watermarking:** Verified distinct SHA-256 pixel outputs across Simplified/Traditional Chinese (`陈伟明 · 張雅婷`), Japanese/Korean (`佐藤花子 · 김민수`), accented Latin, and ASCII (`whole-page` pixel coverage `4.31%`, top/mid/bottom bands `3.89% / 4.54% / 4.51%`).
- **Malformed, encrypted, oversized & timeout probes (empirically verified):**
  - *Truncated/corrupt PDF:* Exits `2` with `{"ok":false,"error":"unreadable","message":"Could not open PDF: PdfiumError"}` and `0` bytes on `stderr` (zero stack-trace leakage).
  - *Password-encrypted PDF:* Exits `2` with `{"ok":false,"error":"encrypted","message":"PDF is password protected."}`.
  - *Zero-page PDF:* Exits `2` with `{"ok":false,"error":"unreadable"}`.
  - *`28,800 × 28,800 pt` (`400 × 400 in`) PDF dimension bomb at `300 DPI`:* Clamped by `MAX_DIMENSION = 2600` to `2600 × 2600 px` (`897 KB` PNG) in `659 ms` without OOM.
  - *`505`-page PDF upload (`POST /api/documents`):* Rejected with `HTTP 400 too_many_pages` (`MAX_PDF_PAGES = 500`).
  - *Worker timeout (`runPythonWorker(req, 5)`):* Terminates worker and throws `EngineError("engine_timeout")`.
  - *Adapter swap authorization invariance:* Setting `CV_PDF_ENGINE=nonexistent_broken_adapter` and requesting `/api/documents/:id/page?page=1` as an unentitled user still returns `HTTP 403 no_entitlement` because `currentUser()` and `canReadDocument()` (`routes.js:1105-1131`) execute strictly prior to `renderWatermarkedPage()`.
- **Audit A Findings:**
  - **`AUD-A1` (Medium — Unbounded Per-Request Python Process Spawning):** `runPythonWorker` (`src/services/pdf-engine.js:56-98`) spawns a new Python interpreter for *every* page render (even on base-raster cache hits, since per-user watermarks are composited in Python) with **no** global concurrency semaphore. Simultaneous page loads across 25+ entitled learners can spawn dozens of concurrent `82–93 MB` processes (`> 2 GB` RAM spike).
  - **`AUD-A2` (Low — `SIGTERM`-Only Worker Kill & Unbounded Base-Raster Cache):** `child.kill()` (`pdf-engine.js:85`) sends `SIGTERM` without a `SIGKILL` fallback timer if `libpdfium.so` hangs inside native C code, and `var/render-cache/` has no max-bytes LRU eviction policy.

---

## AUDIT B — REAL BROWSER VERIFICATION

### 1. GitHub Actions Run `45484670561` & Artifact Audit
Queried directly via `gh api repos/fariztiger/strata-medical-ai-lab/actions/runs/45484670561`:
- **Run Metadata:** Run `#13` (`id: 45484670561`), `event: push`, `head_sha: 06718e5cc90232267fdcb86d415d4810f30f224d`, `status: completed`, `conclusion: success` (`2026-11-24T20:48:51Z` → `20:49:55Z`).
- **Job 1 (`138766750695` — `Chromium E2E (1440x900 + 390x844) & Regression Suite`):** `conclusion: success` (`59s`, all 14 steps green). Installed `pypdfium2` + `wqy-microhei.ttc` (into both `vendor/fonts/` and `$HOME/.local/share/fonts` via `fc-cache`), ran `npm test`, ran `node scripts/verification/playwright-e2e.mjs --strict` against headless Google Chrome `157.0.8103.78`, uploaded artifact `chromium-browser-evidence` (`id: 14963557525`, `1,578,055` bytes), and committed `reports/browser-screenshots/` in `5f39e60`.
- **Job 2 (`138766751298` — `PostgreSQL 16 Row-Level Security & Append-Only Audit`):** `conclusion: success` (`20s`, all 10 steps green on `postgres:16-alpine`).
- **Local Reproduction Check:** Local sandbox container lacks root-installed X11/GTK shared libraries (`libxkbcommon.so.0`, `libnss3`, `libgbm1`), so headless Chromium cannot execute locally here; CI runner execution in Run `45484670561` is genuine and reproducible via `.github/workflows/phase-b-browser-ci.yml`.

### 2. Genuine Browser Screenshot & Persona Coverage Verification
Inspected PNG `IHDR` dimensions, SHA-256 digests, and rendered pixels across all 9 files in `reports/browser-screenshots/`:
- **Desktop (`1440 × 900` RGB):** `01-desktop-admin-console.png` (`137 KB`), `02-desktop-student-a-reader-en.png` (`326 KB`), `03-desktop-student-b-reader-zh.png` (`345 KB`), `04-desktop-student-b-revoked.png` (`138 KB`), `05-desktop-student-c-denied.png` (`109 KB`), `06a-desktop-reviewer-portal.png` (`116 KB`), `06-desktop-portfolio-zh.png` (`269 KB`).
- **Mobile (`390 × 844` RGB):** `07-mobile-student-a-reader.png` (`71 KB`), `08-mobile-portfolio-en.png` (`106 KB`).
- **Verified behaviors in `playwright-e2e.mjs` + screenshots:** All 4 personas (`Admin`, `Student A`, `Student B`, `Student C`) + `Reviewer` tested; `p.1 → p.2` navigation (`1190×1684` natural size) and mobile progress resume (`p.2 / 6`); HTML5 `<audio>` blob preload (`duration: 8s`, `paused === false` playback check); `中文`↔`EN` switching with full CJK font rendering; live entitlement revocation (`#reader-denied` shown mid-session); `/portfolio` `401`/`403`/`200` access control; and `scrollWidth <= innerWidth` assertions across viewports.
- **Audit B Findings:**
  - **`AUD-B1` (Low — Mobile Reader Screenshot Taken With Drawer Open):** `07-mobile-student-a-reader.png` (`playwright-e2e.mjs:360-366`) captures the `390×844` viewport *after* clicking `#btn-toggle-chapters`, so the open mobile chapter/audio drawer covers the underlying watermarked page image in the saved PNG (though `waitForRenderedPageImage(mobStuPage, 2)` verified the raster prior to opening the drawer). Capturing two mobile reader frames (canvas view + open drawer) would improve visual evidence completeness.
  - **`AUD-B2` (Low — Legacy Non-Browser Composites Still Present in `reports/screenshots/`):** `reports/PRODUCTION_READINESS_004.md` accurately cites only `reports/browser-screenshots/`, and no synthetic composite is misrepresented as browser evidence in Mission 004. However, `reports/screenshots/01..05*.png` and `scripts/verification/capture_persona_views.py` from `v0.1.1` remain in the repo without a deprecation banner.

---

## AUDIT C — POSTGRESQL INTEGRATION *(Highest Priority)*

### 1. Definitive Architectural Classification
**Verdict: Classification `C` at the HTTP application layer (zero live application routes use PostgreSQL), combined with a partial standalone adapter (`B`: `PostgresPersistenceAdapter`, 7 methods) and a verified database/RLS schema (`db/migrations/001_postgres_schema_and_rls.sql`).**

### 2. End-to-End Request-Path Trace (`apps/contentvault-api/src/`)
Tracing every module in `apps/contentvault-api/src/` confirms that **100% of live HTTP traffic executes synchronously against `node:sqlite` (`getDb()`)**:

| Request Path | Actual Runtime Call Chain (`5f39e60`) | Uses PostgreSQL? |
| --- | --- | --- |
| `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` | `routes.js` → `security/authz.js` (`login`, `resolveSession`, `logout`) → **`db.js:getDb()` (`node:sqlite`)** | **NO** |
| `POST /api/auth/register`, `GET /api/admin/users` | `routes.js` → `security/authz.js` (`createUser`, `listUsers`) → **`db.js:getDb()` (`node:sqlite`)** | **NO** |
| `GET / POST /api/documents`, `GET /api/documents/:id` | `routes.js` → `services/content.js` (`listDocuments`, `listReadableDocuments`, `createDocument`, `findDocument`) → **`db.js:getDb()` (`node:sqlite`)** | **NO** |
| `POST /api/documents/:id/grant`, `POST /revoke` | `routes.js` → `services/content.js` (`grantEntitlement`, `revokeEntitlement`) → **`db.js:transaction()` (`node:sqlite`)** | **NO** |
| `GET /api/documents/:id/page`, `GET /audio`, `GET/POST /progress` | `routes.js` → `authz.js` (`canReadDocument`, `redeemPageToken`) + `content.js` (`recordProgress`) → **`db.js:getDb()` (`node:sqlite`)** | **NO** |
| `audit(...)` & `GET /api/admin/audit` | `security/audit.js` (`audit`, `listAudit`) → **`db.js:getDb()` (`node:sqlite`)** | **NO** |
| `GET / POST /api/portfolio/enquiries` | `app.js:343-402` → inline `getDb().prepare(...)` (**`node:sqlite`**) | **NO** |
| `rateLimit(...)` (`http/helpers.js:294`) | `helpers.js` → `adapter.js:sharedSqliteRateLimit(getDb(), ...)` (**`node:sqlite`**) | **NO** |

- `apps/contentvault-api/package.json` has **no** `pg` dependency, and **zero** files in `src/` reference `PostgresPersistenceAdapter`, `DATABASE_URL`, or `CV_DB_ADAPTER`.
- `PostgresPersistenceAdapter` (`src/persistence/adapter.js:85-261`) implements 7 async methods (`withActorContext`, `listReadableDocuments`, `listEntitlements`, `listPortfolioEnquiries`, `appendAuditLog`, `rateLimit`, `redeemSingleUseToken`), leaving ~18 user, session, document-upload, chapter, entitlement-mutation, and reading-progress queries unported.

### 3. Live Adversarial PostgreSQL 16 Verification Results
Executed `db/migrations/001_postgres_schema_and_rls.sql` and `PostgresPersistenceAdapter` against a live compiled PostgreSQL 16 engine (`@electric-sql/pglite` locally + `postgres:16-alpine` in CI Job `138766751298`):

- **Verified Passing on PostgreSQL 16:**
  - *Cross-account RLS isolation:* `Student A` sees `1` entitled document and only `ent_a`; unentitled `Student C` and `Reviewer` see `0` rows on `SELECT * FROM documents`; `Student A` sees `0` rows on `portfolio_enquiries` and fails `INSERT` with RLS policy violation.
  - *Transaction-scoped user context & pool hygiene:* After both `COMMIT` and simulated mid-transaction crash (`ROLLBACK`), `current_setting('app.current_user_id', true)` and `current_setting('app.current_user_role', true)` on the reused pooled connection cleanly revert to `""` (`set_config(..., true)` is strictly `LOCAL` to the transaction).
  - *Concurrent entitlement revocation & multi-instance rate limiting:* Interleaved `listReadableDocuments` + admin `UPDATE entitlements SET status = 'revoked'` transitions immediately from `1` → `0` visible documents; two independent `PostgresPersistenceAdapter` instances sharing one DB enforce `rateLimit(..., 2, 60)` atomically (`[true, true, false]`).
  - *Append-only `audit_log` under `cv_app_user`:* `Student` can `INSERT`, reads `0` rows on `SELECT`, and `Admin` under `cv_app_user` receives `permission denied for table audit_log` on `UPDATE` and `DELETE`.
  - *Idempotent DDL re-apply:* Running `001_postgres_schema_and_rls.sql` twice consecutively succeeds cleanly.

- **Critical & Medium Findings Discovered in PostgreSQL Design (`AUD-C1` .. `AUD-C5`):**
  - **`AUD-C1` (BLOCKER for Pilot/Prod — Unwired Application Persistence):** HTTP routes do not call `PostgresPersistenceAdapter`. Setting `DATABASE_URL` in production has zero effect on the running API server.
  - **`AUD-C2` (HIGH — `NOLOGIN cv_app_user` + `SET LOCAL ROLE` Privilege Escalation / Superuser Bypass):** `001_postgres_schema_and_rls.sql:12-15` creates `cv_app_user` as `NOLOGIN` and expects the pool to connect as the migration owner (`strata_owner` / `postgres`, which in `postgres:16-alpine` is a PostgreSQL `SUPERUSER`) and drop privileges via `SET LOCAL ROLE cv_app_user`. Live test proved two hazards:
    1. Executing `RESET ROLE;` inside a `withActorContext` transaction immediately escalates `current_user` back to the pool login role (`postgres` / `strata_owner`) without error.
    2. Any query accidentally run via `pool.query(...)` outside `withActorContext` executes as the owner/superuser — and PostgreSQL `SUPERUSER`s bypass **even `FORCE ROW LEVEL SECURITY`** and `REVOKE DELETE ON audit_log`.
    - *Remediation:* Create two distinct roles: migration owner (`cv_owner`, owns schema) and runtime login role (`cv_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, granted `cv_app_user` or direct least-privilege grants) so the application pool **never** possesses owner/superuser credentials.
  - **`AUD-C3` (HIGH — `SECURITY DEFINER cv_lookup_auth_user` Leaks Password Hashes Across Roles):** `001_postgres_schema_and_rls.sql:205-221` grants `EXECUTE` on `SECURITY DEFINER` function `cv_lookup_auth_user(TEXT)` to `cv_app_user` without checking `cv_current_user_role()`. Live test confirmed that a transaction bound to `{ id: 'usr_b', role: 'student' }` gets `0` rows from `SELECT * FROM users WHERE id = 'usr_adm'`, **but succeeds in reading the admin's `password_hash` via `SELECT password_hash FROM cv_lookup_auth_user('adm@s.test')`**.
  - **`AUD-C4` (MEDIUM — Inverted Eviction Query in `PostgresPersistenceAdapter.rateLimit`):** `src/persistence/adapter.js:202-209` deletes overflow buckets using:
    ```sql
    SELECT bucket_key FROM rate_limit_buckets ORDER BY expires_at_ms ASC OFFSET $1
    ```
    Because `ASC` orders soonest-expiring buckets *first*, `OFFSET (maxBuckets - 1)` skips the oldest `maxBuckets - 1` rows and **evicts the newest / longest-lived rate-limit buckets**! Live test with `maxBuckets = 5` (`key_1` .. `key_5` with `+1m`..`+5m` expiry) proved that inserting `key_6` deleted `key_5` (`+5m`) while keeping stale `key_1..key_4` (`ORDER BY expires_at_ms DESC OFFSET $1` was intended).
  - **`AUD-C5` (MEDIUM — `UNLOGGED` Token Ledger, Missing Ephemeral-Table RLS, Cross-Reviewer Enquiries & Rollback/Backup Gaps):**
    1. `token_redemptions` (`001_postgres_schema_and_rls.sql:138`) is `UNLOGGED`: an unclean PostgreSQL crash/failover truncates it on recovery (reopening a brief `<=45s` `X-Page-Token` replay window) and breaks queries on physical standby replicas. Neither `token_redemptions` nor `rate_limit_buckets` has RLS enabled (`cv_app_user` holds unrestricted `DELETE`).
    2. `portfolio_enquiries_reviewer_admin` (`001_postgres_schema_and_rls.sql:309-313`) allows *any* `reviewer` account to `SELECT` confidential enquiries submitted by *other* external reviewers (`crossReviewerSeesAllEnquiries: true`).
    3. `audit_insert_all` (`WITH CHECK (true)`) does not verify `actor_id` against `cv_current_user_id()`.
    4. No `schema_migrations` ledger, `001_down.sql` rollback script, or coordinated `pg_dump`/PITR + `var/storage/private` backup/restore runbook is present yet.

---

## AUDIT D — PRODUCTION SECURITY

| Control Area | Verification Outcome | Evidence & Findings |
| --- | --- | --- |
| **Production secret validation** | **PARTIAL PASS (`AUD-D3a`)** | `config.js:116-128` enforces length `>= 32`, `>= 12` distinct chars, and Shannon character entropy `>= 3.5 bits/char` in `NODE_ENV=production` (blocks `'a'.repeat(64)`). **Gap:** First-order character entropy accepts deterministic repeating sequences such as `'0123456789abcdef'.repeat(4)` (`4.00 bits/char`, accepted in live `NODE_ENV=production` test). |
| **Secret-file permissions** | **PASS** | `config.js:100-114` rejects missing `CV_SIGNING_SECRET_FILE` and enforces `(mode & 0o077) === 0` (`0600`/`0400`) on POSIX in production (`0644` rejected in test `C-4`). |
| **Signing-key rotation & expiry** | **PARTIAL PASS (`AUD-D3b`)** | `CV_SIGNING_SECRET_PREVIOUS` (`config.js:166-172`, `crypto.js:105-115`) cleanly verifies in-flight `X-Page-Token` (`45s` TTL) and `X-Audio-Token` (`60s` TTL) HMACs (`cv_session` cookies are opaque DB tokens, not HMAC-signed). **Gaps:** No `CV_SIGNING_SECRET_PREVIOUS_FILE` mount option, and no rotation timestamp / max-age enforcement if `CV_SIGNING_SECRET_PREVIOUS` is left set indefinitely. |
| **Demo account isolation** | **PASS** | `CV_ENABLE_DEMO_PERSONAS` is off by default (`403`), forbidden in `NODE_ENV=production`, strips all password fields, uses `Object.create(null)` (`DEMO_PERSONA_EMAILS`), and `assertProductionSafety` (`config.js:218-249`) aborts startup if any active `is_demo = 1` or `@strata.local` user exists. |
| **Trusted proxy configuration** | **PARTIAL PASS (`AUD-D3c`)** | `helpers.js:125-145` ignores `X-Forwarded-*` by default and walks hops right-to-left when `CV_TRUST_PROXY` matches TCP peer. **Gap:** `matchesTrustedSpec` (`helpers.js:101`) parses IPv4 CIDRs (`10.0.0.0/8` → `true`) but returns `false` on IPv6 CIDRs (`fd00::/8` → `false`). |
| **Account-lockout DoS & global login budget exhaustion** | **FAIL UNDER >=30 SPRAY (`AUD-D1`, `AUD-D2`)** | **1. `AUD-D1` (HIGH):** In `routes.js:437-459`, `login:acct-cpu:<email>` (`LOGIN_GLOBAL_CPU_CEILING = 30 / 300s`) runs *before* the clean-IP check (`pairStatus.count === 0`). Live test proved **6 bot IPs × 5 bad passwords (= 30 attempts in 5 min)** causes request `#31` from a brand-new clean IP (`203.0.113.77`) with the **valid password** to fail with **`HTTP 429` (`Account sign-in capacity temporarily saturated`)**.<br>**2. `AUD-D2` (MEDIUM):** In `sharedSqliteRateLimit` (`adapter.js:308-315`), oldest-expiry eviction (`ORDER BY expires_at_ms ASC`) allows a locked-out attacker to spray `maxBuckets` fresh dummy keys (which carry newer `expires_at_ms` values) and **evict their own active lockout row** (`lockedBeforeSpray: true` → `unlockedAfterSpray: true`). |
| **Absolute session lifetime** | **PASS** | `resolveSession` (`authz.js:194-233`) enforces `120 min` idle expiry and `12h` hard cap (`SESSION_MAX_HOURS`), deleting expired rows immediately. |
| **Reviewer access restrictions** | **PASS (with `AUD-C5` note)** | Live test confirmed `reviewer` gets `200` on `/portfolio`, `0` rows on `GET /api/documents`, `403 no_entitlement` on `/api/documents/:id/page`, and `403 admin_required` on `/api/admin/*` (`handleGrantAccess` also restricts grants to `role === 'student'`). Note: `GET /api/portfolio/enquiries` exposes enquiries across all reviewers (`app.js:343`). |
| **Private storage safeguards** | **PARTIAL PASS (`AUD-D3d`)** | `putPrivateObject` (`storage.js:48`) writes objects with `0600` mode under random `obj_*` keys outside `public/`, blocks path traversal (`assertSafeKey`), and audits `/storage`/`/var`/`/private` probes (`404`). **Gap:** `ensureDirs()` (`config.js:253`) and `DatabaseSync` leave `var/storage/private` at `0755` and `var/contentvault.db` at `0644` under standard `umask 0022`. |

---

## AUDIT E — REGRESSION TESTING (`40 / 40` Executed Independently)

Independently ran `npm --prefix apps/contentvault-api test` on clean checkout `5f39e60`: **`40` tests across `5` suites, `40 PASS`, `0 FAIL` (`25.42s`)**, plus CI scripts `verify-postgres-rls.mjs` and `playwright-e2e.mjs --strict`.

### Test Classification Breakdown (`40` Node Tests)
- **Integration (`24` tests — live in-process HTTP + SQLite + filesystem/worker):**
  - `acceptance.test.js`: `CV-001`..`CV-014`, `CV-018` (`15` tests)
  - `security-003a.test.js`: `SEC-001`..`SEC-003`, `SEC-005`, `Priority 3 VM+API` (`5` tests)
  - `phase-a-pdf-engine.test.js`: `A-3` (`1` test — live `pypdfium2` worker + disk cache + benchmark)
  - `phase-c-architecture.test.js`: `C-2`, `C-3`, `C-5` (`3` tests — SQLite rate limit, HTTP login spray, VM+HTTP reviewer portal)
- **End-to-End API Workflow (`6` tests — multi-persona seeded lifecycle over HTTP; non-browser):**
  - `personas-e2e.test.js`: Personas `1`..`4`, Live Revocation/Re-grant Lifecycle, `M007` Portfolio Auth Flow (`6` tests). *(True browser E2E lives separately in `scripts/verification/playwright-e2e.mjs` in CI.)*
- **Behavioral / Unit (`5` tests):**
  - `CV-019` (PNG band pixel-delta behavioral proof), `SEC-004` (Unicode/CJK worker pixel uniqueness), `A-2` (mock-runner adapter contract), `C-1` (SQLite visibility + **mocked** `pg.Pool` SQL protocol check), `C-4` (production startup secret/permission rejection + `signToken`/`verifyToken` rotation).
- **Infrastructure-Only (`2` tests):**
  - `CV-017` (spawns `check-db.js` & `verify_watermark_visual.py`), `A-1` (verifies `.venv` Python module specs & `probePdf`).
- **Static Inspection (`3` tests):**
  - `CV-015` (regex/substring checks on `index.html` & `styles.css`), `CV-016` (regex secret scan on `public/` & `git ls-files`), `CV-020` (regex checks on `KNOWN_LIMITATIONS.md` & `THREAT_MODEL.md`).

### Genuine Test Coverage Gaps
1. **Zero HTTP-to-PostgreSQL integration or E2E tests:** `npm test` tests `PostgresPersistenceAdapter` only against an in-memory mock `Pool` (`C-1`), and CI `verify-postgres-rls.mjs` tests the adapter directly without HTTP routes.
2. **Sub-ceiling DoS test (`C-3`):** Sends only `11` attacker requests (`< 30`), missing the `LOGIN_GLOBAL_CPU_CEILING = 30` lockout cliff (`AUD-D1`) and the key-spray bucket eviction bypass (`AUD-D2`).
3. **Eviction-order assertions (`C-2` & `verify-postgres-rls.mjs`):** Check row count (`<= 35`) and basic `rateLimit` blocking, but never assert *which* keys were evicted — missing `PostgresPersistenceAdapter.rateLimit`'s inverted eviction bug (`AUD-C4`).
4. **Concurrency & load:** No concurrent multi-learner `/page` worker-spawn stress test (`AUD-A1`) or concurrent `GRANT`/`REVOKE` race test in `npm test`.

---

## FINAL INDEPENDENT VERDICTS

| Deployment Category | Verdict | Basis |
| --- | --- | --- |
| **1. Research baseline merge** (`PR #1` → `research/deepseek-contentvault-baseline`) | **`APPROVE`** | Materially advances `922cf05`: eliminates runtime `AGPL-3.0` (`PyMuPDF`), passes `40/40` Node tests + genuine Chromium Desktop/Mobile E2E + PostgreSQL 16 RLS prototype in CI, and preserves synthetic-only boundaries. *(Per Mission 004-B instructions, PR `#1` has NOT been merged.)* |
| **2. Private synthetic demonstration** | **`APPROVE`** | Safe for internal/private evaluation using exclusively synthetic neurology content and gated `M007` reviewer sessions (`noindex`, `no-store`, `SEC-001`..`SEC-005` active). |
| **3. Controlled external pilot** | **`REQUEST CHANGES`** | Blocked by technical integration & DoS findings **`AUD-C1`**, **`AUD-C2`**, **`AUD-C3`**, **`AUD-D1`**, **`AUD-D2`**, **`AUD-C4`**, **`AUD-A1`**, and **`AUD-C5`**, plus separate partner-consent and license-packaging gates below. |
| **4. Commercial production deployment** | **`BLOCK`** | Requires full async PostgreSQL route cutover, non-owner DB runtime role, durable/attack-resistant rate-limiting & token ledgers, bounded render worker pool, backup/PITR + TLS operations, legal counsel sign-off, and written content/specialist agreements. |

### Separation of Blockers & Obligations

1. **Technical Blockers (Must Fix in Code Before External Pilot / Production):**
   - **P0 (`AUD-C1`, `AUD-C2`, `AUD-C3`):** Wire all HTTP routes/services (`authz.js`, `content.js`, `audit.js`, `app.js`, `routes.js`) onto async `PostgresPersistenceAdapter`; connect the app pool as a dedicated `LOGIN NOSUPERUSER NOBYPASSRLS` non-owner role (eliminating `RESET ROLE` / owner bypass); and restrict `cv_lookup_auth_user` so `student`/`reviewer` contexts cannot query password hashes.
   - **P1 (`AUD-D1`, `AUD-D2`, `AUD-C4`):** Decouple clean-IP credential verification or proof-of-work/challenge from the flat `30 / 300s` per-account global counter so a 6-IP spray cannot DoS legitimate logins; isolate security lockout buckets from general rate-limit eviction (or shard/exempt ` count >= limit` rows from eviction); and fix `ORDER BY expires_at_ms DESC OFFSET $1` in `PostgresPersistenceAdapter.rateLimit`.
   - **P1 (`AUD-A1`, `AUD-A2`):** Bound concurrent Python worker spawns via a fixed worker pool or semaphore (`e.g., max 4–8 concurrent renders`), add `SIGKILL` escalation after `SIGTERM` on worker timeout, and bound `var/render-cache/` disk usage.
   - **P2 (`AUD-C5`, `AUD-D3`):** Make `token_redemptions` a logged table with RLS enabled, scope `GET /api/portfolio/enquiries` so non-admin reviewers only see their own submissions (`actor_id = current_user_id()`), enforce `0700`/`0600` on `DATA_DIR` and `contentvault.db`, add IPv6 CIDR matching in `matchesTrustedSpec`, add `CV_SIGNING_SECRET_PREVIOUS` rotation expiry, and add `schema_migrations` + backup/restore scripts.
2. **Licensing & Redistribution Obligations (Separate from Technical Functionality):**
   - Generate and ship a consolidated `/app/THIRD_PARTY_NOTICES.txt` in any distributed container/appliance preserving `.dist-info/licenses/` (`pypdfium2`, `Pillow`), the `FreeType` (`FTL`) credit, the `libjpeg-turbo` (`IJG`) documentation clause, and `vendor/fonts/wqy-microhei/{LICENSE_Apache2.txt,AUTHORS.txt}`.
   - Never copy proprietary host OS fonts into redistributable images; obtain qualified legal counsel review before commercial distribution.
3. **Partner-Consent & Content Governance Requirements (Non-Technical Gate):**
   - Written sign-off from **Dr. Eow Gaik Bee** is mandatory before any external pilot or publication involving her name, credentials, `M007` portfolio, or real educational materials (`AGENTS.md` §6.3, §24).
   - Independent primary-source verification is still required for `PARTIALLY_VERIFIED` items (`JRN-003`..`JRN-005` and *Clinical Neurophysiology* subspecialty listing).

# STRATA ContentVault — Mission 005 Production Engineering Report

**Date:** 2026-11-24  
**Branch:** `arena/85a94944-strata-medical-ai-lab` (`PR #1` OPEN — unmerged per standing instruction; `main` untouched at `0e30776`)  
**Engineering Checkpoints Completed:** `005-A`, `005-B`, `005-C`, `005-D`, `005-E`, `005-F`, `005-G`  
**Governance & Readiness Boundary:** Mission 005 remediates and behaviorally verifies all technical findings (`AUD-A1`..`AUD-A2`, `AUD-B1`..`AUD-B2`, `AUD-C1`..`AUD-C5`, `AUD-D1`..`AUD-D3`) identified in `reports/MISSION_004B_INDEPENDENT_AUDIT.md`. **No public production deployment has been executed, and commercial/production readiness is NOT self-certified here** — independent review and approval belong to **BRADLEY** in **Mission 005-B**, alongside external legal counsel review and written partner consent from **Dr. Eow Gaik Bee**.

---

## 1. Executive Summary of Engineering Changes

1. **Checkpoint `005-A` — Full Async PostgreSQL 16 HTTP Application Cutover (`AUD-C1`):**
   - Migrated all live HTTP routes and services (`src/security/authz.js`, `src/services/content.js`, `src/security/audit.js`, `src/http/helpers.js`, `src/routes.js`, `src/app.js`, `src/server.js`, `scripts/seed.js`, `scripts/check-db.js`) onto the unified asynchronous `PersistenceAdapter` (`SqlitePersistenceAdapter` for zero-paid-infra local development; `PostgresPersistenceAdapter` via `pg.Pool` for multi-replica RLS deployments).
   - Fixed all 8 `PostgresPersistenceAdapter` result-normalization sites so `SELECT` checks inspect `.rows` while `UPDATE`/`DELETE` mutations return accurate `.rowCount`.
   - Enforced fail-closed backend selection (`CV_DB_BACKEND=postgres`, `CV_REQUIRE_POSTGRES=1`, zero silent fallback from PostgreSQL to SQLite) and added deep `/readyz` readiness checks alongside `/health` liveness.

2. **Checkpoint `005-B` — Four-Role PostgreSQL 16 Privilege Separation & Hardening (`AUD-C2`, `AUD-C3`, `AUD-C5`):**
   - Authored `db/migrations/002_database_roles_and_hardening.sql` (and reversible `db/migrations/rollback/{002_down.sql,001_down.sql}` via `apps/contentvault-api/scripts/migrate-pg.js`) separating `cv_owner` (`NOLOGIN`), `cv_auth_definer` (`NOLOGIN`), `cv_backup_maint` (`NOLOGIN`), and `cv_runtime` (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`, non-owner).
   - Enforced `SEC-DB-003` startup/readiness verification rejecting superuser, `BYPASSRLS`, or table-owning runtime credentials; verified `RESET ROLE` and `SET ROLE` cannot escalate privileges from `cv_runtime`.
   - Revoked `password_hash` column reads from `cv_runtime` and restricted `cv_lookup_auth_user` (`SECURITY DEFINER` owned by `cv_auth_definer`, pinned `search_path = pg_catalog, public`) exclusively to `app.current_user_role = 'auth_bootstrap'`.
   - Converted `token_redemptions` and `rate_limit_buckets` to crash-safe `LOGGED` tables (`relpersistence = 'p'`) with `FORCE ROW LEVEL SECURITY`, isolated `reviewer` visibility on `portfolio_enquiries` to `actor_id = cv_current_user_id()`, and bound `audit_log` `INSERT` actor fields to transaction GUCs.

3. **Checkpoint `005-C` — Attack-Resistant Rate Limiting, Scrypt Backpressure & IPv6 Proxy CIDRs (`AUD-C4`, `AUD-D1`, `AUD-D2`, `AUD-D3c`):**
   - Fixed bucket eviction in both PostgreSQL (`cv_check_rate_limit`) and SQLite (`sharedSqliteRateLimit`) to purge expired rows first, evict **oldest unlocked** buckets (`ORDER BY expires_at_ms ASC`), exempt active lockouts (`is_locked = TRUE`) from spray eviction, and fail closed if `maxBuckets` is 100% saturated by active lockouts.
   - Separated repeat-IP / account bad-password failure budgets (`login:pair`, `login:acct-fail`) from clean-IP credential verification (`pairStatus.count === 0`, bounded by `login:acct-clean` `CV_LOGIN_CLEAN_IP_VERIFY_CEILING=120`) so distributed credential stuffing does not lock out a legitimate user signing in from a clean IP.
   - Migrated password verification onto non-blocking `verifyPasswordAsync` (`crypto.scrypt`) with bounded concurrency and queue backpressure (`CV_LOGIN_MAX_CONCURRENT_SCRYPT=8`, `CV_LOGIN_MAX_SCRYPT_QUEUE=32` -> `503 auth_busy`).
   - Upgraded `CV_TRUST_PROXY` (`matchesTrustedSpec` in `src/http/helpers.js`) to `net.BlockList` supporting both IPv4 and IPv6 CIDRs (`10.0.0.0/8`, `fd00::/8`, `2001:db8::/32`).

4. **Checkpoint `005-D` — Bounded PDF Worker Concurrency, `SIGKILL` Escalation & Render-Cache Eviction (`AUD-A1`, `AUD-A2`):**
   - Added `createBoundedWorkerScheduler` in `src/services/pdf-engine.js` enforcing global worker concurrency (`CV_WORKER_MAX_CONCURRENCY=4`), bounded FIFO queue (`CV_WORKER_MAX_QUEUE=24` -> `503 render_queue_full` + `Retry-After`), and per-user concurrency budget (`CV_WORKER_MAX_PER_USER=2` -> `429 user_render_budget_exceeded`), strictly downstream of authentication and entitlement checks.
   - Added `SIGTERM` -> `SIGKILL` escalation (`CV_WORKER_KILL_GRACE_MS=500`) in `runPythonWorker` so native-hung workers cannot leak orphan PIDs.
   - Added `enforceRenderCachePolicy` enforcing TTL expiry, max-bytes (`128 MiB`) & file-count LRU/oldest eviction, and `fs.statfsSync` low-disk protection (`503 disk_space_exhausted`), plus live `pdfWorker` and `scryptPool` telemetry in `GET /api/admin/stats`.

5. **Checkpoint `005-E` & `005-F` — Operational Security, Backup/Restore, Third-Party Notices, `AUD-B1`/`AUD-B2` & CI Verification (`AUD-D3`):**
   - Verified DEFLATE periodic-secret rejection (`'0123456789abcdef'.repeat(4)` rejected in production), `CV_SIGNING_SECRET_PREVIOUS_FILE` (`0600` mode check) + mandatory `CV_SIGNING_SECRET_PREVIOUS_EXPIRES_AT` (`<= 24h` overlap), `0700`/`0600` filesystem permissions, and PostgreSQL TLS configuration (`CV_PG_SSL_MODE=disable|require|verify-ca|verify-full`).
   - Built `scripts/operations/backup-restore.mjs` (`backup-sqlite`, `backup-pg`, `verify`, `restore-sqlite`, `restore-pg` + `cv_purge_expired_ephemeral()`), `scripts/packaging/build-third-party-notices.mjs` -> `docs/licensing/THIRD_PARTY_NOTICES.md` (`MIT`, `Apache-2.0`, `BSD-3-Clause`, `MIT-CMU`, `FTL`, `IJG`; zero `AGPL`/`GPL`), non-root `Dockerfile`, `.dockerignore`, `docker-compose.postgres.yml`, and updated `.env.example`.
   - Captured unobstructed mobile reader canvas screenshot `07a-mobile-student-a-canvas.png` prior to opening the chapter drawer (`AUD-B1`) and marked legacy `v0.1.1` composites deprecated (`AUD-B2`).

---

## 2. Behavioral Verification Evidence Summary

### 2.1 Local & CI Node Test Matrix (`55 / 55 PASS`, `0` Failures)

| Suite | File | Tests | Outcome |
| :--- | :--- | :---: | :---: |
| Acceptance Matrix (`CV-001`..`CV-020`) | `tests/acceptance.test.js` | `20` | **20 / 20 PASS** |
| 4-Persona & M007 Flow | `tests/personas-and-portfolio.test.js` | `6` | **6 / 6 PASS** |
| Mission 003-A Security (`SEC-001`..`SEC-005` + P3) | `tests/security-003a.test.js` | `6` | **6 / 6 PASS** |
| Mission 004 Phase A PDFium Adapter | `tests/phase-a-pdf-engine.test.js` | `3` | **3 / 3 PASS** |
| Mission 004 Phase C Architecture | `tests/phase-c-architecture.test.js` | `5` | **5 / 5 PASS** |
| **Checkpoint `005-A`** PG HTTP Application (`AUD-C1`) | `tests/phase-005-postgres-app.test.js` | `3` | **3 / 3 PASS** |
| **Checkpoint `005-B`** DB Privilege Isolation (`AUD-C2`, `AUD-C3`, `AUD-C5`) | `tests/phase-005-db-privileges.test.js` | `3` | **3 / 3 PASS** |
| **Checkpoint `005-C`** Rate Limiting, Scrypt & IPv6 CIDRs (`AUD-C4`, `AUD-D1`, `AUD-D2`) | `tests/phase-005-ratelimit.test.js` | `3` | **3 / 3 PASS** |
| **Checkpoint `005-D`** PDF Worker Pool, `SIGKILL` & Cache (`AUD-A1`, `AUD-A2`) | `tests/phase-005-worker-resources.test.js` | `3` | **3 / 3 PASS** |
| **Checkpoint `005-E`** Operational Security, Backup/Restore & Notices (`AUD-D3`) | `tests/phase-005-backup-ops.test.js` | `3` | **3 / 3 PASS** |
| **Total** | **10 Test Suites** | **`55`** | **`55 / 55 PASS`** |

### 2.2 Genuine PostgreSQL 16 (`postgres:16-alpine` TCP `cv_runtime`) & Real Chromium CI Run
- **GitHub Actions Workflow Run:** **`45510882934`** (`head_sha: e7b062c36ea8b86dc75246cb59cead866a1acd1e`, `status: completed`, `conclusion: success`):
  - **Job `138857983257` (`PostgreSQL 16 Row-Level Security & Append-Only Audit`):** **`conclusion: success`** — Verified `verify-postgres-rls.mjs` (`001` baseline) AND dedicated genuine `postgres:16-alpine` TCP databases running `005-A` (`phase-005-postgres-app.test.js` as `cv_runtime` with `CV_REQUIRE_GENUINE_PG=1` & `CV_ENFORCE_DB_ROLE_SEPARATION=1`), `005-B` (`phase-005-db-privileges.test.js` as `cv_runtime`), and `005-E` (`backup-pg` -> `verify` -> `restore-pg` into `contentvault_restore_ci`).
  - **Job `138857982708` (`Chromium E2E (1440x900 + 390x844) & Regression Suite`):** **`conclusion: success`** — Executed all `55` tests and headless Google Chrome / Chromium Desktop (`1440 × 900`) & Mobile (`390 × 844`) E2E verification (`playwright-e2e.mjs --strict`), persisting all 10 genuine browser screenshots (including `07a-mobile-student-a-canvas.png` for `AUD-B1`) to `reports/browser-screenshots/`.

---

## 3. Remaining Risks & Handoff to Mission 005-B (BRADLEY)

1. **Residual Technical Considerations:** Documented in `reports/MISSION_005_FINDING_RESOLUTION_MATRIX.md` §2 (high-cardinality `> 120` clean-IP residential botnet login window per target email without upstream WAF/Turnstile challenge; deterrent-only pixel watermarking boundary against physical camera capture; POSIX/S3 shared storage requirement for multi-replica uploads).
2. **External Governance Gates:**
   - **Independent Audit (`Mission 005-B`):** Ready for independent review by **BRADLEY**.
   - **Partner Consent:** Written approval from **Dr. Eow Gaik Bee** remains mandatory prior to any external pilot or publication involving her name, credentials, `M007` portfolio, or real educational content.
   - **Legal Counsel Review:** Required prior to commercial distribution of container/appliance artifacts and terms.

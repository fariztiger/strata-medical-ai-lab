# PostgreSQL Persistence Migration Design, Row-Level Security & Regression Strategy

**Status:** Mission 004 — Phase C Design Specification (Written Prior to Adapter Implementation)  
**Scope:** `db/migrations/001_postgres_schema_and_rls.sql`, `apps/contentvault-api/src/persistence/`

---

## 1. Design Goals & Zero-Paid-Infrastructure Constraint

1. **Zero Mandatory Paid Infrastructure Locally:** Local development and offline evaluation continue to run out-of-the-box on Node's built-in `node:sqlite` (`CV_DB_ADAPTER=sqlite`, default) with zero external services or `npm` dependencies.
2. **Pluggable Persistence Boundary:** Introduce a formal `PersistenceAdapter` contract (`apps/contentvault-api/src/persistence/adapter.js`) supporting both `SqlitePersistenceAdapter` and `PostgresPersistenceAdapter` (`CV_DB_ADAPTER=postgres` + `DATABASE_URL`).
3. **Database-Enforced Row-Level Authorization (RLS):** In PostgreSQL, authorization must not rely solely on application `WHERE` clauses. Every request transaction executes `SET LOCAL ROLE cv_app_user` and binds `app.current_user_id` and `app.current_user_role` via `set_config(..., true)` so `ENABLE` + `FORCE ROW LEVEL SECURITY` policies enforce tenant/learner isolation inside the database kernel.
4. **Append-Only Audit Trail:** `cv_app_user` receives `SELECT, INSERT` on `audit_log` and is explicitly denied `UPDATE, DELETE, TRUNCATE`.
5. **Shared, Bounded Rate Limiting & Single-Use Token Ledger:** Store rate-limit buckets (`rate_limit_buckets`) and single-use page token redemptions (`token_redemptions`) in shared tables (`UNLOGGED` in PostgreSQL for low-latency writes without WAL bloat) with deterministic TTL cleanup and a hard row cap (`10,000` active buckets) to prevent memory/storage exhaustion across multiple API replicas.

---

## 2. Schema & Type Mapping (`SQLite` → `PostgreSQL 16`)

| Table | SQLite Local Schema | PostgreSQL 16 Schema | RLS Policy Summary (`FORCE ROW LEVEL SECURITY`) |
| --- | --- | --- | --- |
| `users` | `TEXT` PK, `is_demo INTEGER` | `TEXT` PK, `is_demo BOOLEAN NOT NULL DEFAULT FALSE`, `TIMESTAMPTZ` | Self-read (`id = current_user_id()`) or `current_user_role() = 'admin'`; login lookup via `SECURITY DEFINER` function `cv_lookup_auth_user(email)` returning only auth fields. |
| `sessions` | `token_hash TEXT PK` | `token_hash TEXT PK`, `TIMESTAMPTZ` | Visible/mutable only when `user_id = current_user_id()` or `admin` / auth bootstrap function. |
| `documents` | `synthetic INTEGER` | `synthetic BOOLEAN`, `BIGINT byte_size`, `TIMESTAMPTZ` | `SELECT`: `admin` OR active, non-expired row in `entitlements` for `current_user_id()`. `INSERT/UPDATE`: `admin` only. |
| `chapters` | `start_page`, `end_page` | `INTEGER`, `DOUBLE PRECISION audio_seconds` | `SELECT`: `admin` OR parent `document_id` readable by `current_user_id()`. `INSERT/UPDATE`: `admin` only. |
| `entitlements` | `UNIQUE(user_id, document_id)` | `UNIQUE(user_id, document_id)`, `INTEGER version` | `SELECT`: `user_id = current_user_id()` OR `admin`. `INSERT/UPDATE`: `admin` only. |
| `reading_progress` | `PRIMARY KEY (user_id, document_id)` | `PRIMARY KEY (user_id, document_id)` | `SELECT/INSERT/UPDATE`: `user_id = current_user_id()` (and active entitlement) OR `admin`. |
| `audit_log` | `INTEGER PK AUTOINCREMENT` | `BIGSERIAL PRIMARY KEY`, `JSONB detail` | `INSERT`: allowed for all roles (`WITH CHECK (true)`). `SELECT`: `admin` only. `UPDATE/DELETE`: revoked at SQL privilege level + restrictive `USING (false)` policy. |
| `portfolio_enquiries` | `TEXT PK` | `TEXT PK`, `TIMESTAMPTZ` | `SELECT/INSERT`: `current_user_role() IN ('admin', 'reviewer')` only (`student` & `anonymous` denied at DB layer). |
| `token_redemptions` | `jti TEXT PK` | `UNLOGGED TABLE`, `jti TEXT PK`, `TIMESTAMPTZ` | Atomic `INSERT ... ON CONFLICT (jti) DO NOTHING` single-use consumption across all API replicas. |
| `rate_limit_buckets` | *(New shared table)* | `UNLOGGED TABLE`, `bucket_key TEXT PK`, `count INTEGER`, `reset_epoch BIGINT` | Shared atomic upsert across replicas + bounded eviction (`MAX_BUCKETS = 10,000`). |

---

## 3. Staged Migration & Rollback Plan

1. **Stage 0 (Current — Prototype):** Implement `001_postgres_schema_and_rls.sql` and `PostgresPersistenceAdapter` alongside `SqlitePersistenceAdapter` without switching default local `npm test` away from SQLite.
2. **Stage 1 (Dual-Verification in CI):** Provision ephemeral `postgres:16-alpine` in GitHub Actions, apply `001_postgres_schema_and_rls.sql`, and run adversarial RLS isolation + append-only audit tests against real PostgreSQL 16.
3. **Stage 2 (Pilot Cutover — Pre-Production):**
   - Freeze synthetic demo seeding (`NODE_ENV=production` blocks `is_demo = TRUE` accounts).
   - Provision managed PostgreSQL 16 with TLS (`sslmode=verify-full`), apply `001_postgres_schema_and_rls.sql` as migration owner (`cv_owner`), and connect the API strictly as non-superuser `cv_app_user`.
   - Rollback trigger: any RLS policy regression or latency spike > `50 ms` p95 aborts cutover prior to external onboarding.

---

## 4. Regression Testing Strategy

1. **Preserve Existing 35 Tests (`SQLite` Default):** All `CV-001`..`CV-020`, 4-Persona E2E, `SEC-001`..`SEC-005`, and Phase A `pypdfium2` tests must continue passing unchanged.
2. **Phase C Unit & Behavioral Suite (`tests/phase-c-architecture.test.js`):**
   - Persistence adapter contract parity (`SqlitePersistenceAdapter` + parameterized `PostgresPersistenceAdapter` transaction/RLS context binding).
   - Shared & bounded rate limiter (`rate_limit_buckets` persistence + `MAX_BUCKETS` eviction cap).
   - Account-lockout DoS mitigation (attacker brute-force from IP `A` gets `429`, distributed bad passwords across IPs get `429`, while legitimate user with valid password from clean IP `B` still receives `200`).
   - Production signing-secret entropy enforcement (rejecting low-entropy 64-char strings, supporting `CV_SIGNING_SECRET_FILE` with mode `0600` check).
   - Reviewer-specific landing view (`#view-reviewer`) in both `EN` and `中文`.
3. **Real PostgreSQL 16 Kernel RLS Verification (`.github/workflows/` + `scripts/verification/verify-postgres-rls.mjs`):**
   - Executes directly against `postgres:16-alpine` in CI to prove kernel-enforced RLS blocks cross-student reads, unentitled document/chapter reads, student access to `portfolio_enquiries`, and any `UPDATE`/`DELETE` on `audit_log`.

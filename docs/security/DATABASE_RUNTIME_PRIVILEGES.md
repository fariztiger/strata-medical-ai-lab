# STRATA ContentVault — PostgreSQL 16 Four-Role Runtime Privilege Architecture

> **Scope:** Mission 005 Checkpoint `005-B` (`AUD-C2`, `AUD-C3`, `AUD-C5`). Verified behaviorally against genuine `postgres:16-alpine` via `apps/contentvault-api/tests/phase-005-db-privileges.test.js` (`cv_runtime` TCP session) and `scripts/verification/verify-postgres-rls.mjs`.

---

## 1. Threat Model & Design Objective

If an application SQL injection bug, ORM misconfiguration, or connection-pool state leak occurs at runtime, a database connection running as the schema/table owner can bypass Row-Level Security (`RLS`), execute `DDL` (`DROP TABLE`, `ALTER POLICY`), read arbitrary password hashes, or disable `audit_log` triggers via `RESET ROLE`.

STRATA ContentVault eliminates owner-level runtime access by enforcing **four-role privilege separation** in `db/migrations/002_database_roles_and_hardening.sql`:

| Database Role | `LOGIN`? | Attributes | Purpose & Strict Boundaries |
| :--- | :---: | :--- | :--- |
| **`cv_owner`** | `NOLOGIN` | `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS` | Owns all schema tables, indexes, and general RLS helper functions. Used **exclusively** during `npm run migrate:pg` and disaster-recovery `restore-pg`. Unreachable from `cv_runtime` (`SET ROLE cv_owner` fails with `42501`). |
| **`cv_auth_definer`** | `NOLOGIN` | `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS` | Dedicated owner of authentication, session, single-use token, and rate-limit `SECURITY DEFINER` routines (`cv_lookup_auth_user`, `cv_resolve_session`, `cv_redeem_token`, `cv_check_rate_limit`). Unreachable via `SET ROLE` from `cv_runtime`. |
| **`cv_backup_maint`** | `NOLOGIN` | `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS` | Read-only logical snapshot role (`SELECT` + `*_backup_read` RLS policies across all 10 tables) + execute privilege on `cv_purge_expired_ephemeral()`. Zero `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` privileges. Unreachable from `cv_runtime`. |
| **`cv_runtime`** | **`LOGIN`** | `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION` | **Sole application runtime login (`DATABASE_URL`).** Owns zero tables/functions, has zero `CREATE` rights on `SCHEMA public`, cannot `TRUNCATE` or `ALTER` any object, and cannot escalate via `RESET ROLE` or `SET ROLE`. |

---

## 2. Startup Role-Separation Guard (`SEC-DB-003`)

During `PostgresPersistenceAdapter.verifySchemaAndRoles()` (`src/persistence/adapter.js`, invoked by `/readyz` and server startup when `CV_ENFORCE_DB_ROLE_SEPARATION=1`):

1. Queries `current_user`, `session_user`, `rolsuper`, `rolbypassrls`, and `pg_class` ownership counts in `public`.
2. **Fails closed (`SEC-DB-003`)** if:
   - `rolsuper = TRUE` or `rolbypassrls = TRUE`,
   - `session_user IN ('cv_owner', 'cv_auth_definer', 'cv_backup_maint', 'postgres')`, or
   - `owned_tables > 0` (the runtime login owns any table in `public`).

---

## 3. Table, Column & Function Matrix (`cv_runtime`)

All 10 application and ephemeral tables have **`ENABLE ROW LEVEL SECURITY`** AND **`FORCE ROW LEVEL SECURITY`**:

| Table | `RELPERISTENCE` | Direct Grants to `cv_runtime` | Access Mechanism & RLS Policy |
| :--- | :---: | :--- | :--- |
| `users` | `p` (`LOGGED`) | Column-level `SELECT (id, email, display_name, role, locale, created_at, disabled_at, is_demo)`, `INSERT` (`admin`), `UPDATE` (`admin`) | **`password_hash` is revoked at column level (`AUD-C3`).** Credential lookup runs exclusively via `cv_lookup_auth_user(email)` under `app.current_user_role = 'auth_bootstrap'` (`app.current_user_id = ''`). Calls from `student`, `reviewer`, `admin`, or `anonymous` contexts raise `42501`. |
| `sessions` | `p` (`LOGGED`) | `INSERT` (`auth_bootstrap`) | Session resolution, sliding touch, and logout execute strictly via `cv_resolve_session`, `cv_touch_session`, and `cv_delete_session` (`SECURITY DEFINER` owned by `cv_auth_definer`, pinned `search_path = pg_catalog, public`). |
| `documents` | `p` (`LOGGED`) | `SELECT, INSERT, UPDATE, DELETE` | `admin` sees/modifies all; `student` sees only documents with an active, non-expired `entitlements` row (`cv_has_active_entitlement`). |
| `chapters` | `p` (`LOGGED`) | `SELECT, INSERT, UPDATE, DELETE` | Visible to `admin` or entitled `student` for parent `document_id`. |
| `entitlements` | `p` (`LOGGED`) | `SELECT, INSERT, UPDATE` | `admin` full access; `student` sees only own rows (`user_id = cv_current_user_id()`). `cv_has_active_entitlement(doc_id, uid)` blocks cross-learner oracle probing (`uid` must match `cv_current_user_id()` unless caller is `admin`). |
| `reading_progress` | `p` (`LOGGED`) | `SELECT, INSERT, UPDATE` | Strictly bound to `user_id = cv_current_user_id()` (or `admin` read). |
| `portfolio_enquiries` | `p` (`LOGGED`) | `SELECT, INSERT, UPDATE, DELETE` | **`AUD-C5` Reviewer Isolation:** `reviewer` can `INSERT` only rows with `submitted_by = cv_current_user_id()` and `SELECT` only their own rows; `admin` can view/manage all enquiries; `student`/`anonymous` have zero access. |
| `audit_log` | `p` (`LOGGED`) | `SELECT, INSERT` (**Zero `UPDATE`/`DELETE`/`TRUNCATE`**) | **`AUD-C5` Actor Binding + Immutability:** `BEFORE UPDATE OR DELETE` trigger (`trg_audit_log_immutable`) rejects mutations for **all** roles; `audit_insert_actor_bound` prevents non-admin callers from spoofing another user's `actor_id` or `actor_role`; `SELECT` restricted to `admin`. |
| `token_redemptions` | `p` (`LOGGED`) | **Zero direct table grants** | **`AUD-C5` Crash-Safe Replay Ledger:** Converted from `UNLOGGED` to `LOGGED` with `FORCE RLS`. Accessed solely via `cv_redeem_token(jti, now_ms, exp_ms)` (`SECURITY DEFINER`). |
| `rate_limit_buckets` | `p` (`LOGGED`) | **Zero direct table grants** | **`AUD-C4` / `AUD-D2` Lockout-Safe Rate Limiter:** `LOGGED` + `FORCE RLS`. Accessed solely via `cv_check_rate_limit(...)` and `cv_clear_rate_limit(...)` (`SECURITY DEFINER`). |

---

## 4. `SECURITY DEFINER` Hardening Rules

Every `SECURITY DEFINER` function in `002_database_roles_and_hardening.sql` adheres to four mandatory PostgreSQL security controls:
1. Explicit `SET search_path = pg_catalog, public` in the function signature to prevent schema-shadowing attacks.
2. `REVOKE ALL ON FUNCTION ... FROM PUBLIC;` followed by explicit `GRANT EXECUTE ... TO cv_runtime` (or `cv_backup_maint` for `cv_purge_expired_ephemeral()`).
3. Owned by `cv_auth_definer` or `cv_owner` (`NOLOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`).
4. Explicit GUC context validation inside `cv_lookup_auth_user(TEXT)` rejecting any session where `app.current_user_role <> 'auth_bootstrap'` or `app.current_user_id <> ''`.

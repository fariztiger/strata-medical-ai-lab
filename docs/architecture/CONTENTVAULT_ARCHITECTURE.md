# STRATA ContentVault v0.1 — Technical Architecture

- **Milestone:** M006
- **Date:** 2026-11-24

---

## 1. End-to-End Request & Enforcement Flow

```text
[Browser: Bilingual Reader / Admin SPA (public/)]
       |
       |  HTTPS / HTTP (Same-Origin, HttpOnly cv_session cookie)
       v
[Node.js HTTP Server (apps/contentvault-api/src/app.js & routes.js)]
   |-- 1. Resolve session -> SQLite `sessions` + `users` (src/security/authz.js)
   |-- 2. Evaluate entitlement -> `canReadDocument(user, docId)`
   |        (status === 'active' AND (expires_at IS NULL OR expires_at > now))
   |-- 3. Validate short-lived HMAC-SHA256 token (bound to sub, doc, page, ent.version)
   |-- 4. Append allow/deny record -> SQLite `audit_log` (src/security/audit.js)
   |
   +--> [Private Object Store (var/storage/private/obj_*)]
   |        (0600 permissions, random keys, never exposed via static HTTP)
   |
   +--> [Python Worker (packages/watermark-engine/render_page.py)]
            |-- JSON stdin/stdout IPC (no shell command interpolation)
            |-- Load or populate unwatermarked 144 DPI base PNG in var/render-cache/
            |-- Composite per-learner diagonal tile + edge watermark via Pillow
            +-- Return PNG bytes + SHA-256 digest (`Cache-Control: no-store`)
```

---

## 2. Database Schema (`var/contentvault.db`)

Managed in `apps/contentvault-api/src/db.js` using parameterized SQLite (`WAL` journal mode, `PRAGMA foreign_keys = ON`):

- `users`: `id`, `email` (`NOCASE` unique), `display_name`, `role` (`admin` | `student`), `password_hash` (`scrypt`), `locale` (`en` | `zh`), `created_at`, `disabled_at`.
- `sessions`: `id` (256-bit random token), `user_id`, `created_at`, `last_seen_at`, `expires_at`, `user_agent`, `ip`.
- `documents`: `id`, `title_en`, `title_zh`, `author`, `description`, `storage_key` (stripped from all API responses), `content_hash`, `byte_size`, `page_count`, `synthetic`, `uploaded_by`, `created_at`, `archived_at`.
- `entitlements`: `id`, `user_id`, `document_id`, `status` (`active` | `revoked` | `expired`), `version` (monotonic integer incremented on every grant/revoke), `granted_by`, `granted_at`, `expires_at`, `revoked_by`, `revoked_at`, `revoke_reason`.
- `chapters`: `id`, `document_id`, `ordinal`, `title_en`, `title_zh`, `start_page`, `end_page`, `audio_key`, `audio_mime`, `audio_seconds`.
- `reading_progress`: `(user_id, document_id)` primary key, `last_page`, `pages_read`, `updated_at`.
- `audit_log`: append-only table recording `event`, `outcome` (`allow` | `deny` | `info` | `error`), `actor_id`, `actor_role`, `subject_id`, `document_id`, `page`, `ip`, `user_agent`, `detail`.

---

## 3. Baseline Recovery Summary (From `d0fc178`)

Commit `d0fc178` (`research/deepseek-contentvault-baseline`) contained an incomplete backend draft that could not start or execute requests due to:
1. Escaped/invalid ESM import paths (`"\.\./config.js"` and wrong relative paths `./db.js` inside `src/security/`).
2. CommonJS `require(...)` calls inside `"type": "module"` ESM modules (`server.js`, `routes.js`).
3. Missing function exports/imports between `routes.js`, `authz.js`, `content.js`, and `helpers.js`.
4. Query-string routing bug in `server.js` causing `?page=N` requests to return `404`.
5. Variable-scoping bug in `handlePage` (`ReferenceError: storagePath is not defined`) and missing student authorization check on `GET /api/documents/:id`.
6. Missing `scripts/seed.js`, missing teaching audio support, missing web reader/admin UI, missing acceptance tests, and missing governance/security docs.

All defects were resolved and verified by the 20-item acceptance suite (`apps/contentvault-api/tests/acceptance.test.js`).

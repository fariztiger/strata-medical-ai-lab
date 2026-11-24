# STRATA ContentVault v0.1 — Security Threat Model

- **Milestone:** M005
- **Date:** 2026-11-24
- **Status:** Verified against ContentVault v0.1 implementation

---

## 1. Security Objective & Honest Scope

ContentVault protects high-value educational publications and audio companions against **casual unauthorized redistribution, unattributed sharing, credential-less scraping, and post-revocation access**.

**Explicit Non-Goal:** ContentVault is **not** advertised as "piracy-proof." Any authorized learner viewing pixels or listening to audio on an endpoint they control can photograph the screen or record analog output. ContentVault's objective is:
1. **Never deliver the original vector PDF** to client devices.
2. **Enforce server-side per-learner entitlements** on every page and audio request.
3. **Embed a visible, non-removable identity watermark into the page raster** so leaked screenshots or printouts remain forensically attributable to the originating account.
4. **Enforce immediate revocation and expiration** for all future requests.
5. **Maintain an append-only audit trail** of both authorized accesses and denied attempts.

---

## 2. Protected Assets

| Asset ID | Asset | Confidentiality / Integrity Requirement |
| --- | --- | --- |
| **A-01** | Original uploaded PDFs (`var/storage/private/obj_*.pdf`) | Strictly server-private; never transmitted to browsers or anonymous callers. |
| **A-02** | Protected teaching audio (`var/storage/private/obj_*.wav/.mp3`) | Accessible only to authenticated learners with an active entitlement. |
| **A-03** | Unwatermarked raster cache (`var/render-cache/base_*.png`) | Server-private; never served directly without per-learner watermark compositing. |
| **A-04** | Signing secret (`CV_SIGNING_SECRET` / `var/.dev-signing-secret`) | Server-only HMAC key (`>= 32` chars); never committed to Git or bundled in UI. |
| **A-05** | User credentials & sessions (`users.password_hash`, `sessions`) | `scrypt` salted hashes (`N=16384`); opaque 256-bit `HttpOnly` session cookies. |
| **A-06** | Audit log (`audit_log`) | Append-only server record of authentication, admin mutations, renders, and denials. |

---

## 3. Trust Boundaries

1. **Browser <-> Node HTTP API (`apps/contentvault-api/src/app.js`)**:
   - Untrusted network boundary. Every header, cookie, query parameter, and body payload from the client is untrusted.
   - Identity is resolved exclusively from the `cv_session` cookie against the SQLite `sessions` + `users` tables (`resolveSession`).
2. **Node HTTP API <-> Python Watermark Worker (`packages/watermark-engine/render_page.py`)**:
   - Local process boundary invoked via `child_process.spawn(PYTHON, [ENGINE_PATH])` with JSON over `stdin`/`stdout` (zero shell interpolation, preventing command injection).
3. **Node HTTP API <-> Private Filesystem (`var/storage/private/`)**:
   - Guarded by `keyToPath()` (`assertSafeKey` regex `^[A-Za-z0-9._-]+$`, `..`/slash/null-byte rejection, and `path.dirname(resolved) === root` containment check).

---

## 4. Adversary Scenarios & Implemented Controls

| Threat ID | Adversary Scenario | Mitigation Implemented | Verification Test |
| --- | --- | --- | --- |
| **T-01** | Anonymous caller guesses URLs (`/storage/...`, `/var/...`, `/api/documents/:id/page`) to download PDFs | No static route maps to `var/`; `/storage` & `/var` probes are explicitly denied & audited; all document/page/audio routes require valid session | `CV-002`, `CV-012` |
| **T-02** | Enrolled Student C (without entitlement to Module X) requests Module X metadata, pages, or audio | `canReadDocument(user, docId)` checks `entitlements` table on `GET /api/documents/:id`, `/page`, `/audio`, and `/progress` | `CV-004`, `CV-013` |
| **T-03** | Student A opens DevTools and deletes CSS styles or DOM nodes to capture a clean page without watermark | Watermark is composited into the RGBA PNG raster on the server by Pillow before PNG encoding; zero DOM watermark overlay exists | `CV-005`, `CV-019` |
| **T-04** | Student A modifies query/header fields (`?userId=`, `X-User-Id`, `?watermark=`) to frame Student B in a leaked screenshot | Server ignores all client identity fields; `label` (`user.display_name`) and `ref` (`user.id`) are loaded strictly from the authenticated session's DB row | `CV-006`, `CV-007` |
| **T-05** | Student A copies a protected page/audio URL (including `?token=...`) and sends it to Student B or an anonymous browser | Page & audio endpoints verify live session cookie AND match `token.sub === user.id` and `token.ent === entitlement.version` | `CV-008` |
| **T-06** | Revoked or expired learner replays a previously issued short-lived token or refreshes open reader | Revocation/regrant increments `entitlements.version` inside an `IMMEDIATE` transaction; `evaluateEntitlement` checks both `status` and `expires_at <= now` on every request | `CV-009`, `CV-010` |
| **T-07** | Student calls admin endpoints (`POST /api/documents`, `/grant`, `/revoke`, `/api/auth/register`, `/api/admin/*`) | `ensureAdmin()` enforces `user.role === 'admin'` server-side and logs `deny` audit events on every unauthorized attempt | `CV-011`, `CV-014` |
| **T-08** | Malicious admin or user uploads non-PDF binary or path-traversal filename | Raw upload checks `%PDF-` magic header, runs PyMuPDF `probePdf` in an isolated temp file, enforces page/byte caps, and assigns random server-generated storage keys | `CV-001`, `CV-012` |
| **T-09** | Credential stuffing or brute-force login / user enumeration | `login()` runs constant-time `scrypt` verification even for unknown emails (dummy hash path) + IP rate limiting (`429 Retry-After`) | `CV-014`, `CV-017` |
| **T-10** | Secret leakage via frontend bundles or Git history | `.gitignore` excludes `.env*`, `var/`, `*.db`, `.dev-signing-secret`, `.venv/`; static UI sits in `public/` with zero secrets | `CV-016` |

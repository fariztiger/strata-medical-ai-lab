# STRATA ContentVault v0.1 — Acceptance & Security Test Report

- **Milestone:** M009
- **Execution Date:** 2026-11-24 (UTC)
- **Runtime:** Node.js `v22.22.3` (`node:sqlite` `3.51.3`), Python `3.11.2`, `PyMuPDF 2.1`, `Pillow 13.0.0`
- **Reproducible Command:**
  ```bash
  cd apps/contentvault-api && npm test
  ```
- **Summary:** **20 / 20 PASS** (`0 FAIL`, `0 BLOCKED`, `0 NOT RUN`, suite duration `~6.3s`, zero mocks)

---

## Acceptance Test Matrix (`AGENTS.md` §14)

| Test ID | Requirement | Outcome | Verified Evidence (`apps/contentvault-api/tests/acceptance.test.js`) |
| --- | --- | --- | --- |
| **CV-001** | Admin can upload a synthetic PDF | **PASS** | `POST /api/documents` returned `201`; PyMuPDF verified `page_count === 6`; object stored in `var/storage/private/` (`0600`) with `storage_key` omitted from response JSON. |
| **CV-002** | Original PDF cannot be accessed anonymously | **PASS** | Anonymous requests to `/api/documents`, `/api/documents/:id`, `/page`, `/storage/<key>`, `/var/storage/private/<key>`, and `/private/<key>` all returned `401` or `404` with zero `%PDF-` bytes. |
| **CV-003** | Authorized student can open assigned material | **PASS** | Granted Student A received `200` on `GET /api/documents`, `GET /api/documents/:id`, and `GET /api/documents/:id/page?page=2` (`image/png`, valid PNG header, `> 40 KB`). |
| **CV-004** | Unauthorized student cannot open the same material | **PASS** | Unentitled Student C received empty `[]` on `GET /api/documents` and `403 no_entitlement` on `GET /api/documents/:id` and `/page?page=2`. |
| **CV-005** | Student A receives a personalized watermark | **PASS** | `/api/admin/engine-selftest` confirmed `watermarkChangesPixels === true`; SHA-256 of Student A's 144 DPI PNG differed from unwatermarked 144 DPI render. |
| **CV-006** | Student B receives a different personalized watermark | **PASS** | Student A and Student B page-2 renders produced distinct PNG SHA-256 digests (`shaB !== studentAPage2Sha`); visual verifier confirmed `identityDiffers === true`. |
| **CV-007** | Changing client-side identifiers cannot impersonate another student | **PASS** | Injecting `?userId=`, `?email=`, `?watermark=SPOOFED`, `X-User-Id`, and `X-Role: admin` did not alter server-resolved `actor_id` (`studentA.id`); forged `cv_session` returned `401`. |
| **CV-008** | Copied protected page URL does not grant unauthorized access | **PASS** | Replaying `/page?page=2&token=<studentA_token>` returned `401` anonymously, `403 no_entitlement` for Student C, and `403 invalid_page_token` for Student B. |
| **CV-009** | Revoked student cannot request new protected pages | **PASS** | After `POST /api/documents/:id/revoke`, Student A immediately received `403 revoked` on both direct page requests and replays of previously issued unexpired tokens (`version` bumped). |
| **CV-010** | Expired entitlement prevents further access | **PASS** | Entitlement granted with past `expiresAt` excluded document from `GET /api/documents` and returned `403 expired` on `GET /api/documents/:id/page`. |
| **CV-011** | Student cannot access admin API operations | **PASS** | Student A received `403 admin_required` across all 8 admin endpoints (`POST /api/documents`, `/grant`, `/revoke`, `/api/auth/register`, `GET /api/admin/stats`, `/users`, `/audit`, `/engine-selftest`). |
| **CV-012** | Original PDF is not delivered through browser requests | **PASS** | Page responses carry `Content-Type: image/png` and `Cache-Control: no-store, ..., private`; zero `%PDF-` bytes or `storage_key` fields returned. |
| **CV-013** | Audio access respects student entitlement | **PASS** | Entitled Student A received `200 audio/wav` (`RIFF/WAVE`) and `206 Partial Content` (`Range: bytes=0-511`); anonymous received `401`; expired Student C and revoked Student B received `403`. |
| **CV-014** | Audit log records relevant access events | **PASS** | `GET /api/admin/audit` verified recorded rows for `auth.login` (`allow`/`deny`), `document.upload`, `entitlement.grant`, `entitlement.revoke`, `page.render` (`allow`/`deny`), `audio.play` (`allow`/`deny`), and `storage.direct_probe` (`deny`). |
| **CV-015** | Desktop and mobile layouts work correctly | **PASS** | Verified `/` (`200`), mobile viewport meta tag, responsive breakpoints (`960px`, `640px`), mobile chapter/audio drawer toggle, zoom/fullscreen controls, STRATA palette, and `EN`/`中文` switch. |
| **CV-016** | No secrets are exposed in frontend bundles or Git | **PASS** | Scanned `apps/contentvault-api/public/*` and `git ls-files`: zero signing secrets, password hashes, seed passwords, `.env`, `.db`, `var/`, or `.venv/` files exposed. |
| **CV-017** | Existing tests pass following new changes | **PASS** | `scripts/check-db.js` and `scripts/synthetic/verify_watermark_visual.py` exited `0` (`changedPct: 3.84%`, `meanDelta: 1.312`, `maxDelta: 112`, all 7 visual checks `PASS`). |
| **CV-018** | Documentation provides reproducible setup steps | **PASS** | Verified `README.md`, `.env.example`, setup scripts, and idempotent `seedDemoEnvironment()` execution. |
| **CV-019** | Watermark cannot be removed merely by disabling CSS overlay | **PASS** | Verified absence of DOM watermark overlay in `public/index.html` and verified via Pillow pixel diff that top, middle, and bottom vertical thirds of the HTTP PNG all carry `> 1.5%` burned-in pixel delta. |
| **CV-020** | Known security limitations are documented | **PASS** | Verified `docs/security/KNOWN_LIMITATIONS.md` & `THREAT_MODEL.md` disclose screenshot/camera limits, post-revocation prior-capture retention, PyMuPDF `AGPL-3.0` licensing, and SQLite -> Postgres RLS migration. |

# STRATA ContentVault — Deployment & Operations Runbook

> **Governance Notice:** No public or commercial production deployment has been executed in Mission 005. Per project governance (`AGENTS.md`), commercial deployment remains gated on:
> 1. Independent technical & security sign-off from **BRADLEY** (**Mission 005-B**),
> 2. External legal counsel review of open-source notice packaging and terms, and
> 3. Written partner/content consent from **Dr. Eow Gaik Bee** prior to any use of real medical material or public `M007` specialist portfolio data.

---

## 1. Pre-Flight Requirements

- **Runtime:** Node.js `>= 22.5.0`, Python `>= 3.11` with pinned `packages/watermark-engine/requirements.txt` (`pypdfium2==5.15.2`, `Pillow==13.0.0`), and Apache-2.0 `WenQuanYi Micro Hei` (`wqy-microhei.ttc`).
- **Database (Staging / Production):** PostgreSQL `16.x` reachable over TLS (`CV_PG_SSL_MODE=verify-full` recommended). Production **never** silently falls back to SQLite (`CV_REQUIRE_POSTGRES=1`).
- **Filesystem:** Dedicated private data volume (`CV_DATA_DIR`, e.g. `/var/lib/contentvault`) owned by the service UID (`0700` directory mode, `0600` file mode).

---

## 2. Cryptographic Secret Provisioning & Zero-Downtime Key Rotation (`AUD-D3`)

> **Security Note:** Shannon entropy checks and DEFLATE compression checks (`config.js`) catch accidental placeholders and periodic strings (such as `'0123456789abcdef'.repeat(4)`), **not** weak PRNG seeds. Always generate secrets from an OS CSPRNG!

### 2.1 Initial Secret Generation
```bash
install -d -m 0700 /etc/strata/secrets
openssl rand -hex 48 > /etc/strata/secrets/cv_signing_secret
chmod 0600 /etc/strata/secrets/cv_signing_secret
```
Configure:
```bash
CV_SIGNING_SECRET_FILE=/etc/strata/secrets/cv_signing_secret
```

### 2.2 Bounded Key Rotation (Max 24-Hour Overlap)
1. Move the current secret file to `cv_signing_secret.prev` (`0600`) and generate a fresh 48-byte CSPRNG primary secret:
   ```bash
   cp -p /etc/strata/secrets/cv_signing_secret /etc/strata/secrets/cv_signing_secret.prev
   openssl rand -hex 48 > /etc/strata/secrets/cv_signing_secret
   chmod 0600 /etc/strata/secrets/cv_signing_secret /etc/strata/secrets/cv_signing_secret.prev
   ```
2. Set a bounded ISO-8601 expiry (`<= 24 hours` ahead; mandatory in `NODE_ENV=production`):
   ```bash
   CV_SIGNING_SECRET_FILE=/etc/strata/secrets/cv_signing_secret
   CV_SIGNING_SECRET_PREVIOUS_FILE=/etc/strata/secrets/cv_signing_secret.prev
   CV_SIGNING_SECRET_PREVIOUS_EXPIRES_AT=2026-11-25T12:00:00Z
   ```
3. Rolling-restart API instances. Once `CV_SIGNING_SECRET_PREVIOUS_EXPIRES_AT` passes, `resolveVerificationSecrets()` automatically stops accepting signatures from the retired secret even before you remove `cv_signing_secret.prev`.

---

## 3. PostgreSQL 16 Provisioning & Least-Privilege Migration

1. Provision database `contentvault` with administrative migration user `strata_owner` and generate a distinct CSPRNG password for runtime user `cv_runtime`.
2. Apply schema & 4-role hardening migrations using **`DATABASE_MIGRATION_URL`** (never pass `strata_owner` to the running API):
   ```bash
   DATABASE_MIGRATION_URL="postgres://strata_owner:${PG_OWNER_PASSWORD}@db.internal:5432/contentvault" \
   CV_PG_RUNTIME_PASSWORD="${PG_RUNTIME_PASSWORD}" \
   CV_PG_SSL_MODE=verify-full \
   CV_PG_SSL_CA_FILE=/etc/strata/certs/pg-ca.pem \
   npm --prefix apps/contentvault-api run migrate:pg
   ```
3. Verify schema & runtime role separation (`SEC-DB-003`) using **`DATABASE_URL`** (`cv_runtime`):
   ```bash
   CV_DB_BACKEND=postgres \
   CV_ENFORCE_DB_ROLE_SEPARATION=1 \
   DATABASE_URL="postgres://cv_runtime:${PG_RUNTIME_PASSWORD}@db.internal:5432/contentvault" \
   CV_PG_SSL_MODE=verify-full \
   CV_PG_SSL_CA_FILE=/etc/strata/certs/pg-ca.pem \
   npm --prefix apps/contentvault-api run db:check
   ```

---

## 4. Application Startup, Reverse Proxy & Resource Tuning

### 4.1 Recommended Production Environment Variables
```bash
NODE_ENV=production
HOST=0.0.0.0
PORT=7410
CV_DB_BACKEND=postgres
CV_REQUIRE_POSTGRES=1
CV_ENFORCE_DB_ROLE_SEPARATION=1
DATABASE_URL="postgres://cv_runtime:${PG_RUNTIME_PASSWORD}@db.internal:5432/contentvault"
CV_PG_SSL_MODE=verify-full
CV_PG_SSL_CA_FILE=/etc/strata/certs/pg-ca.pem
CV_SIGNING_SECRET_FILE=/etc/strata/secrets/cv_signing_secret
CV_DATA_DIR=/var/lib/contentvault

# Reverse proxy CIDRs (IPv4 and/or IPv6; leave empty if exposed directly)
CV_TRUST_PROXY=10.0.0.0/8,fd00::/8

# Bounded PDF worker pool & disk cache (`AUD-A1`, `AUD-A2`)
CV_PDF_ENGINE=pypdfium2
CV_WORKER_MAX_CONCURRENCY=4
CV_WORKER_MAX_QUEUE=24
CV_WORKER_MAX_PER_USER=2
CV_WORKER_TIMEOUT_MS=20000
CV_WORKER_KILL_GRACE_MS=500
CV_RENDER_CACHE_MAX_BYTES=134217728
CV_MIN_FREE_DISK_BYTES=33554432

# Bounded scrypt & login DoS budgets (`AUD-D1`, `AUD-D2`)
CV_LOGIN_MAX_CONCURRENT_SCRYPT=8
CV_LOGIN_MAX_SCRYPT_QUEUE=32
CV_LOGIN_CLEAN_IP_VERIFY_CEILING=120
```

### 4.2 Liveness, Readiness & Operational Telemetry
- **`GET /health`:** Lightweight process liveness check (`200 OK` when event loop is responsive).
- **`GET /readyz`:** Deep readiness check (`200 OK` only when persistence adapter query succeeds, `001`+`002` migrations are present, and `cv_runtime` passes `SEC-DB-003`; returns `503 Service Unavailable` otherwise). Wire load-balancer target health and container `HEALTHCHECK` to `/readyz`.
- **`GET /api/admin/stats` (Admin-only):** Returns live `pdfWorker` (`inFlight`, `queued`, `overloadRejections`, `sigkillEscalations`, `timeouts`) and `scryptPool` (`active`, `queued`, `maxConcurrency`) metrics.
- **Third-Party License Bundle:** Re-generate `docs/licensing/THIRD_PARTY_NOTICES.md` on any dependency update via `node scripts/packaging/build-third-party-notices.mjs`. Container builds (`Dockerfile`) place a copy at `/opt/strata/THIRD_PARTY_NOTICES.txt`.

# STRATA ContentVault — Backup, Point-in-Time Recovery (PITR) & Rollback Runbook

> **Scope:** Mission 005 Checkpoint `005-E`. Verified end-to-end by `apps/contentvault-api/tests/phase-005-backup-ops.test.js` (`005-E-2` SQLite + storage backup/tamper-check/restore; `005-E-3` PostgreSQL `cv_backup_maint` snapshot + ephemeral purge + clean restore) and CI `postgres:16-alpine` backup/restore step.

---

## 1. Recovery Objectives & Stateful Components

STRATA ContentVault state comprises **two coupled stores** that must be backed up together:
1. **Relational Database:** PostgreSQL 16 (`users`, `sessions`, `documents`, `chapters`, `entitlements`, `reading_progress`, `portfolio_enquiries`, append-only `audit_log`, `token_redemptions`, `rate_limit_buckets`) — or `var/contentvault.db` in local SQLite mode.
2. **Private Master Object Store (`$CV_DATA_DIR/storage/`):** Content-addressed master PDFs and chapter audio files (`var/render-cache/` is derived/ephemeral and excluded from backups).

| Tier | Target RPO | Target RTO | Mechanism |
| :--- | :---: | :---: | :--- |
| **PostgreSQL 16 + WAL PITR + Object Sync** | `<= 5 minutes` | `<= 30 minutes` | Continuous PostgreSQL WAL archiving + daily `pg_basebackup` / `backup-pg` + content-addressed object replication |
| **Local / Single-Node SQLite Snapshot** | `<= 24 hours` (scheduled) | `<= 15 minutes` | Online atomic `VACUUM INTO` + storage copy + SHA-256 manifest (`backup-sqlite`) |

---

## 2. Automated Backup, Integrity Check & Restoration CLI

`scripts/operations/backup-restore.mjs` provides unified backup, cryptographic SHA-256 manifest verification, and verified restoration:

### 2.1 SQLite + Private Storage (`backup-sqlite` / `verify` / `restore-sqlite`)
```bash
# 1. Online atomic backup (safe while SQLite WAL writers are active)
node scripts/operations/backup-restore.mjs backup-sqlite \
  --data-dir /var/lib/contentvault \
  --out /var/backups/strata/snap-$(date -u +%Y%m%dT%H%M%SZ)

# 2. Verify SHA-256 manifest of every file in the backup bundle
node scripts/operations/backup-restore.mjs verify \
  --bundle /var/backups/strata/snap-20261124T120000Z

# 3. Restore into a clean target data directory (runs PRAGMA integrity_check & enforces 0700/0600)
node scripts/operations/backup-restore.mjs restore-sqlite \
  --bundle /var/backups/strata/snap-20261124T120000Z \
  --target-dir /var/lib/contentvault-restored
```

### 2.2 PostgreSQL 16 + Private Storage (`backup-pg` / `verify` / `restore-pg`)
`backup-pg` first runs `SELECT public.cv_purge_expired_ephemeral()` as `cv_backup_maint` to prune expired `sessions`, `token_redemptions`, and `rate_limit_buckets`, then opens a **`REPEATABLE READ READ ONLY`** transaction as `cv_backup_maint` to export a consistent logical snapshot alongside private storage objects and SHA-256 digests:
```bash
# 1. Create repeatable-read logical snapshot + private storage bundle
DATABASE_URL="postgres://strata_owner:${PG_OWNER_PASSWORD}@db.internal:5432/contentvault" \
node scripts/operations/backup-restore.mjs backup-pg \
  --data-dir /var/lib/contentvault \
  --out /var/backups/strata/pg-$(date -u +%Y%m%dT%H%M%SZ)

# 2. Verify SHA-256 manifest before any restoration
node scripts/operations/backup-restore.mjs verify \
  --bundle /var/backups/strata/pg-20261124T120000Z

# 3. Restore into a freshly migrated PostgreSQL 16 database + target storage directory
DATABASE_MIGRATION_URL="postgres://strata_owner:${PG_OWNER_PASSWORD}@db-dr.internal:5432/contentvault" \
npm --prefix apps/contentvault-api run migrate:pg

DATABASE_MIGRATION_URL="postgres://strata_owner:${PG_OWNER_PASSWORD}@db-dr.internal:5432/contentvault" \
node scripts/operations/backup-restore.mjs restore-pg \
  --bundle /var/backups/strata/pg-20261124T120000Z \
  --target-dir /var/lib/contentvault-dr
```

---

## 3. Native PostgreSQL 16 Physical Backup & Point-in-Time Recovery (PITR)

For sub-5-minute RPO in production PostgreSQL 16 deployments:
1. Enable continuous WAL archiving in `postgresql.conf`:
   ```ini
   wal_level = replica
   archive_mode = on
   archive_timeout = 300s
   archive_command = 'test ! -f /var/backups/pg-wal/%f && cp %p /var/backups/pg-wal/%f'
   ```
2. Take nightly physical base backups (`pg_basebackup -D /var/backups/pg-base/$(date -u +%F) -Ft -z -X stream`).
3. Note that `token_redemptions`, `rate_limit_buckets`, and `audit_log` are all **`LOGGED` (`relpersistence = 'p'`)** in `002_database_roles_and_hardening.sql`, so WAL replay / PITR preserves single-use token anti-replay state, active security lockouts, and append-only audit evidence across crashes and failovers.
4. To recover to a specific timestamp prior to an operator error:
   - Restore the latest base backup, create `recovery.signal`, set `restore_command = 'cp /var/backups/pg-wal/%f %p'` and `recovery_target_time = '2026-11-24 11:58:00+00'`, start PostgreSQL 16, verify `npm run db:check`, and promote (`SELECT pg_promote();`).

---

## 4. Schema Migration Rollback Procedure

Reversible SQL down-migrations live in `db/migrations/rollback/`:
- **Roll back `002` → `001` (preserves all relational data while reverting role/policy changes):**
  ```bash
  DATABASE_MIGRATION_URL="postgres://strata_owner:${PG_OWNER_PASSWORD}@db.internal:5432/contentvault" \
  node apps/contentvault-api/scripts/migrate-pg.js down --steps 1
  ```
- **Full schema teardown (`002` → `001` → empty, non-production reset only):**
  ```bash
  DATABASE_MIGRATION_URL="postgres://strata_owner:${PG_OWNER_PASSWORD}@127.0.0.1:5432/contentvault_dev" \
  node apps/contentvault-api/scripts/migrate-pg.js down --steps 2
  ```
Always capture and `verify` a full `backup-pg` bundle prior to executing any migration rollback.

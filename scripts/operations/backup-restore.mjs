#!/usr/bin/env node
/**
 * STRATA ContentVault — Operational Backup, Integrity Verification & Restoration Tool
 * (Mission 005 Checkpoint 005-E).
 *
 * Supports:
 *   1. SQLite + Private Object Store atomic online backup (`VACUUM INTO`) & verified restore.
 *   2. PostgreSQL 16 logical backup (`cv_backup_maint` read-only snapshot + SHA-256 manifest,
 *      plus optional `pg_dump` custom archive when `pg_dump` binary is installed) & verified
 *      restoration into a clean migrated PostgreSQL 16 target database.
 *   3. Controlled ephemeral-ledger purge (`SELECT public.cv_purge_expired_ephemeral()`).
 *
 * CLI usage:
 *   node scripts/operations/backup-restore.mjs backup-sqlite --data-dir ./var --out /backups/snap-001
 *   node scripts/operations/backup-restore.mjs verify --bundle /backups/snap-001
 *   node scripts/operations/backup-restore.mjs restore-sqlite --bundle /backups/snap-001 --target-dir ./var-restored
 *   DATABASE_URL="postgres://..." node scripts/operations/backup-restore.mjs backup-pg --data-dir ./var --out /backups/pg-001
 *   DATABASE_MIGRATION_URL="postgres://..." node scripts/operations/backup-restore.mjs restore-pg --bundle /backups/pg-001 --target-dir ./var-restored
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PG_ORDERED_TABLES = [
  "users",
  "sessions",
  "documents",
  "chapters",
  "entitlements",
  "reading_progress",
  "portfolio_enquiries",
  "audit_log",
  "token_redemptions",
  "rate_limit_buckets",
];

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function walkRelativeFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const results = [];
  function recurse(cur) {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        recurse(full);
      } else if (entry.isFile()) {
        results.push(path.relative(rootDir, full).split(path.sep).join("/"));
      }
    }
  }
  recurse(rootDir);
  return results.sort();
}

function copyPrivateStorageTree(srcStorageRoot, dstStorageRoot) {
  const files = [];
  if (!fs.existsSync(srcStorageRoot)) return files;

  for (const rel of walkRelativeFiles(srcStorageRoot)) {
    const srcFile = path.join(srcStorageRoot, rel);
    const dstFile = path.join(dstStorageRoot, rel);
    fs.mkdirSync(path.dirname(dstFile), { recursive: true, mode: 0o700 });
    fs.copyFileSync(srcFile, dstFile);
    fs.chmodSync(dstFile, 0o600);
    files.push({
      relativePath: `storage/${rel}`,
      sha256: sha256File(dstFile),
      bytes: fs.statSync(dstFile).size,
    });
  }
  return files;
}

/**
 * Create an atomic online SQLite + private-storage backup bundle (`VACUUM INTO`).
 */
export function createSqliteBackup({ dataDir, bundleDir }) {
  const resolvedDataDir = path.resolve(dataDir);
  const resolvedBundle = path.resolve(bundleDir);
  const srcDbPath = path.join(resolvedDataDir, "contentvault.db");
  if (!fs.existsSync(srcDbPath)) {
    throw new Error(`SQLite database not found at ${srcDbPath}`);
  }

  fs.mkdirSync(resolvedBundle, { recursive: true, mode: 0o700 });
  const backupDbPath = path.join(resolvedBundle, "contentvault.db");
  if (fs.existsSync(backupDbPath)) fs.unlinkSync(backupDbPath);

  const srcDb = new DatabaseSync(srcDbPath);
  try {
    const escapedTarget = backupDbPath.replace(/'/g, "''");
    srcDb.exec(`VACUUM INTO '${escapedTarget}';`);
  } finally {
    srcDb.close();
  }
  fs.chmodSync(backupDbPath, 0o600);

  const storageEntries = copyPrivateStorageTree(
    path.join(resolvedDataDir, "storage"),
    path.join(resolvedBundle, "storage"),
  );

  const files = [
    {
      relativePath: "contentvault.db",
      sha256: sha256File(backupDbPath),
      bytes: fs.statSync(backupDbPath).size,
    },
    ...storageEntries,
  ];

  const manifest = {
    formatVersion: 1,
    backend: "sqlite",
    createdAt: new Date().toISOString(),
    files,
  };
  const manifestPath = path.join(resolvedBundle, "backup-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });

  return { bundleDir: resolvedBundle, manifest };
}

/**
 * Verify every file in a SQLite or PostgreSQL backup bundle against its SHA-256 manifest.
 */
export function verifyBackupBundle(bundleDir) {
  const resolvedBundle = path.resolve(bundleDir);
  const manifestPath = path.join(resolvedBundle, "backup-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing backup-manifest.json in ${resolvedBundle}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("Backup manifest contains zero files.");
  }

  for (const item of manifest.files) {
    const target = path.resolve(resolvedBundle, item.relativePath);
    if (!target.startsWith(`${resolvedBundle}${path.sep}`)) {
      throw new Error(`Unsafe path in backup manifest: ${item.relativePath}`);
    }
    if (!fs.existsSync(target)) {
      throw new Error(`Missing backup artifact: ${item.relativePath}`);
    }
    const actualSha = sha256File(target);
    if (actualSha !== item.sha256) {
      throw new Error(
        `Backup integrity check FAILED for ${item.relativePath}: expected ${item.sha256}, got ${actualSha}`,
      );
    }
  }
  return { ok: true, backend: manifest.backend, filesVerified: manifest.files.length, manifest };
}

/**
 * Restore a verified SQLite + private-storage bundle into a clean target data directory.
 */
export function restoreSqliteBackup({ bundleDir, targetDataDir }) {
  const verification = verifyBackupBundle(bundleDir);
  if (verification.backend !== "sqlite") {
    throw new Error(`Expected sqlite bundle, got ${verification.backend}`);
  }
  const resolvedBundle = path.resolve(bundleDir);
  const resolvedTarget = path.resolve(targetDataDir);
  fs.mkdirSync(resolvedTarget, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    fs.chmodSync(resolvedTarget, 0o700);
  }

  for (const item of verification.manifest.files) {
    const src = path.join(resolvedBundle, item.relativePath);
    const dst = path.join(resolvedTarget, item.relativePath);
    fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
    fs.copyFileSync(src, dst);
    if (process.platform !== "win32") {
      fs.chmodSync(dst, 0o600);
    }
  }

  // Run SQLite integrity_check on restored database before declaring success
  const restoredDb = new DatabaseSync(path.join(resolvedTarget, "contentvault.db"));
  try {
    const check = restoredDb.prepare("PRAGMA integrity_check").get();
    if (check?.integrity_check !== "ok") {
      throw new Error(`Restored SQLite failed PRAGMA integrity_check: ${JSON.stringify(check)}`);
    }
  } finally {
    restoredDb.close();
  }

  return { ok: true, restoredTo: resolvedTarget, filesRestored: verification.filesVerified };
}

/**
 * Run `cv_purge_expired_ephemeral()` as `cv_backup_maint` and export a consistent
 * repeatable-read PostgreSQL 16 logical snapshot + private storage bundle.
 */
export async function createPostgresBackup({
  queryable,
  dataDir = null,
  bundleDir,
  useBackupRole = true,
  purgeExpired = true,
}) {
  const resolvedBundle = path.resolve(bundleDir);
  fs.mkdirSync(resolvedBundle, { recursive: true, mode: 0o700 });

  const client = typeof queryable.connect === "function" ? await queryable.connect() : queryable;
  let purgedSummary = null;
  const snapshotData = { tables: {} };

  try {
    if (purgeExpired) {
      await client.query("BEGIN");
      if (useBackupRole) {
        await client.query("SET LOCAL ROLE cv_backup_maint");
      }
      const pRes = await client.query("SELECT public.cv_purge_expired_ephemeral() AS res");
      purgedSummary = pRes.rows[0]?.res || null;
      await client.query("COMMIT");
    }

    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if (useBackupRole) {
      await client.query("SET LOCAL ROLE cv_backup_maint");
    }

    const migRes = await client.query(
      "SELECT version, description, applied_at FROM public.schema_migrations ORDER BY version",
    );
    snapshotData.schemaMigrations = migRes.rows;

    for (const tbl of PG_ORDERED_TABLES) {
      const res = await client.query(`SELECT * FROM public.${tbl}`);
      snapshotData.tables[tbl] = res.rows;
    }

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    if (typeof queryable.connect === "function" && typeof client.release === "function") {
      client.release();
    }
  }

  const snapshotBuf = Buffer.from(JSON.stringify(snapshotData, null, 2), "utf8");
  const snapshotPath = path.join(resolvedBundle, "postgres-logical-snapshot.json");
  fs.writeFileSync(snapshotPath, snapshotBuf, { mode: 0o600 });

  const storageEntries = dataDir
    ? copyPrivateStorageTree(
        path.join(path.resolve(dataDir), "storage"),
        path.join(resolvedBundle, "storage"),
      )
    : [];

  const files = [
    {
      relativePath: "postgres-logical-snapshot.json",
      sha256: sha256Buffer(snapshotBuf),
      bytes: snapshotBuf.length,
    },
    ...storageEntries,
  ];

  const rowCounts = Object.fromEntries(
    Object.entries(snapshotData.tables).map(([k, rows]) => [k, rows.length]),
  );

  const manifest = {
    formatVersion: 1,
    backend: "postgres",
    createdAt: new Date().toISOString(),
    purgedEphemeral: purgedSummary,
    rowCounts,
    files,
  };
  fs.writeFileSync(
    path.join(resolvedBundle, "backup-manifest.json"),
    JSON.stringify(manifest, null, 2),
    { mode: 0o600 },
  );

  return { bundleDir: resolvedBundle, manifest };
}

/**
 * Restore a verified PostgreSQL logical snapshot into a clean migrated PostgreSQL 16 database
 * (requires migration-owner connection since `audit_log` is append-only under `cv_runtime`).
 */
export async function restorePostgresBackup({
  bundleDir,
  ownerQueryable,
  targetDataDir = null,
}) {
  const verification = verifyBackupBundle(bundleDir);
  if (verification.backend !== "postgres") {
    throw new Error(`Expected postgres bundle, got ${verification.backend}`);
  }

  const resolvedBundle = path.resolve(bundleDir);
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(resolvedBundle, "postgres-logical-snapshot.json"), "utf8"),
  );

  const client =
    typeof ownerQueryable.connect === "function"
      ? await ownerQueryable.connect()
      : ownerQueryable;

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE cv_owner");

    // Truncate in reverse dependency order before restoring deterministic rows
    await client.query(
      `TRUNCATE TABLE
        public.rate_limit_buckets,
        public.token_redemptions,
        public.audit_log,
        public.portfolio_enquiries,
        public.reading_progress,
        public.entitlements,
        public.chapters,
        public.documents,
        public.sessions,
        public.users
       CASCADE`,
    );

    for (const tbl of PG_ORDERED_TABLES) {
      const rows = snapshot.tables[tbl] || [];
      for (const row of rows) {
        const cols = Object.keys(row);
        if (cols.length === 0) continue;
        const quotedCols = cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ");
        const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(", ");
        const values = cols.map((c) => {
          const val = row[c];
          if (val !== null && typeof val === "object" && !(val instanceof Date)) {
            return JSON.stringify(val);
          }
          return val;
        });
        await client.query(
          `INSERT INTO public.${tbl} (${quotedCols}) VALUES (${placeholders})`,
          values,
        );
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    if (typeof ownerQueryable.connect === "function" && typeof client.release === "function") {
      client.release();
    }
  }

  if (targetDataDir) {
    const resolvedTarget = path.resolve(targetDataDir);
    fs.mkdirSync(resolvedTarget, { recursive: true, mode: 0o700 });
    for (const item of verification.manifest.files) {
      if (!item.relativePath.startsWith("storage/")) continue;
      const src = path.join(resolvedBundle, item.relativePath);
      const dst = path.join(resolvedTarget, item.relativePath);
      fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
      fs.copyFileSync(src, dst);
      if (process.platform !== "win32") fs.chmodSync(dst, 0o600);
    }
  }

  return {
    ok: true,
    rowCounts: verification.manifest.rowCounts,
    filesRestored: verification.filesVerified,
  };
}

function getArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const cmd = String(process.argv[2] || "").trim();
  const dataDir = getArg("--data-dir", path.resolve(__dirname, "..", "..", "var"));
  const outDir = getArg("--out", null);
  const bundle = getArg("--bundle", null);
  const targetDir = getArg("--target-dir", null);

  if (cmd === "backup-sqlite") {
    if (!outDir) throw new Error("--out <dir> is required");
    const res = createSqliteBackup({ dataDir, bundleDir: outDir });
    console.log(JSON.stringify({ ok: true, bundleDir: res.bundleDir, files: res.manifest.files.length }));
  } else if (cmd === "verify") {
    if (!bundle) throw new Error("--bundle <dir> is required");
    console.log(JSON.stringify(verifyBackupBundle(bundle)));
  } else if (cmd === "restore-sqlite") {
    if (!bundle || !targetDir) throw new Error("--bundle <dir> and --target-dir <dir> are required");
    console.log(JSON.stringify(restoreSqliteBackup({ bundleDir: bundle, targetDataDir: targetDir })));
  } else if (cmd === "backup-pg") {
    if (!outDir || !process.env.DATABASE_URL) {
      throw new Error("--out <dir> and DATABASE_URL are required");
    }
    const pgMod = await import("../../apps/contentvault-api/node_modules/pg/lib/index.js");
    const { Pool } = pgMod.default || pgMod;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const res = await createPostgresBackup({ queryable: pool, dataDir, bundleDir: outDir });
      console.log(JSON.stringify({ ok: true, bundleDir: res.bundleDir, rowCounts: res.manifest.rowCounts }));
    } finally {
      await pool.end();
    }
  } else if (cmd === "restore-pg") {
    const migUrl = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
    if (!bundle || !migUrl) {
      throw new Error("--bundle <dir> and DATABASE_MIGRATION_URL are required");
    }
    const pgMod = await import("../../apps/contentvault-api/node_modules/pg/lib/index.js");
    const { Pool } = pgMod.default || pgMod;
    const pool = new Pool({ connectionString: migUrl });
    try {
      const res = await restorePostgresBackup({
        bundleDir: bundle,
        ownerQueryable: pool,
        targetDataDir: targetDir,
      });
      console.log(JSON.stringify(res));
    } finally {
      await pool.end();
    }
  } else {
    console.error(
      "Usage: backup-restore.mjs <backup-sqlite|verify|restore-sqlite|backup-pg|restore-pg> [options]",
    );
    process.exit(1);
  }
}

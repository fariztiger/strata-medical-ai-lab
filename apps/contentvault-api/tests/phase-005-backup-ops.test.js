/**
 * Mission 005 Checkpoint 005-E — Operational Security, Backup/Restore & Packaging Suite
 * (`AUD-D3`, Backup/Restoration, Secret Rotation Expiry, TLS Config & License Notices).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(API_ROOT, "..", "..");

const {
  resolveSigningSecret,
  resolveVerificationSecrets,
  buildPgPoolConfig,
} = await import("../src/config.js");
const { signToken, verifyToken } = await import("../src/security/crypto.js");
const { applyPostgresMigrations } = await import("../scripts/migrate-pg.js");
const {
  createSqliteBackup,
  verifyBackupBundle,
  restoreSqliteBackup,
  createPostgresBackup,
  restorePostgresBackup,
} = await import("../../../scripts/operations/backup-restore.mjs").catch(() =>
  import("../../..//scripts/operations/backup-restore.mjs"),
);
const { generateThirdPartyNotices } = await import(
  path.join(REPO_ROOT, "scripts", "packaging", "build-third-party-notices.mjs")
);

describe("Mission 005 Checkpoint 005-E — Operational Security, Backup/Restore & License Notices (AUD-D3)", () => {
  it("005-E-1 (AUD-D3): Rejects periodic deterministic secrets, enforces _PREVIOUS_FILE 0600 & 24h rotation expiry, and validates PostgreSQL TLS pool modes", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "strata-005e-sec-"));
    const savedEnv = { ...process.env };

    try {
      process.env.NODE_ENV = "production";
      delete process.env.CV_SIGNING_SECRET_FILE;
      delete process.env.CV_SIGNING_SECRET_PREVIOUS;
      delete process.env.CV_SIGNING_SECRET_PREVIOUS_FILE;
      delete process.env.CV_SIGNING_SECRET_PREVIOUS_EXPIRES_AT;

      // 1. AUD-D3a: Periodic deterministic string `'0123456789abcdef'.repeat(4)` has 4.0 bits/char
      //    Shannon entropy and 64 chars, yet MUST be rejected in production!
      process.env.CV_SIGNING_SECRET = "0123456789abcdef".repeat(4);
      assert.throws(() => resolveSigningSecret(), /SEC-002 violation/);

      // Genuine CSPRNG 96-hex secret succeeds
      const primarySecret = crypto.randomBytes(48).toString("hex");
      const previousSecret = crypto.randomBytes(48).toString("hex");
      process.env.CV_SIGNING_SECRET = primarySecret;
      assert.equal(resolveSigningSecret(), primarySecret);

      // 2. AUD-D3b: Previous secret file with world-readable 0644 mode MUST fail in production
      const prevFile = path.join(tmpDir, "prev.secret");
      fs.writeFileSync(prevFile, previousSecret, { mode: 0o644 });
      fs.chmodSync(prevFile, 0o644);
      process.env.CV_SIGNING_SECRET_PREVIOUS_FILE = prevFile;
      process.env.CV_SIGNING_SECRET_PREVIOUS_EXPIRES_AT = new Date(
        Date.now() + 60 * 60 * 1000,
      ).toISOString();
      if (process.platform !== "win32") {
        assert.throws(() => resolveVerificationSecrets(), /0600/);
      }

      // Harden to 0600 -> missing EXPIRES_AT in production MUST fail
      fs.chmodSync(prevFile, 0o600);
      delete process.env.CV_SIGNING_SECRET_PREVIOUS_EXPIRES_AT;
      assert.throws(() => resolveVerificationSecrets(), /CV_SIGNING_SECRET_PREVIOUS_EXPIRES_AT/);

      // > 24h overlap window MUST fail in production
      process.env.CV_SIGNING_SECRET_PREVIOUS_EXPIRES_AT = new Date(
        Date.now() + 48 * 60 * 60 * 1000,
      ).toISOString();
      assert.throws(() => resolveVerificationSecrets(), /24-hour/);

      // Valid 1-hour overlap window accepts tokens signed with previous key; once expired, rejects!
      process.env.CV_SIGNING_SECRET = previousSecret;
      delete process.env.CV_SIGNING_SECRET_PREVIOUS_FILE;
      const legacyToken = signToken({ sub: "usr_rot" }, 300, "page");

      process.env.CV_SIGNING_SECRET = primarySecret;
      process.env.CV_SIGNING_SECRET_PREVIOUS_FILE = prevFile;
      process.env.CV_SIGNING_SECRET_PREVIOUS_EXPIRES_AT = new Date(
        Date.now() + 30 * 60 * 1000,
      ).toISOString();
      assert.equal(verifyToken(legacyToken, "page").sub, "usr_rot");

      // Advance rotation expiry into the past -> legacy key is retired immediately!
      process.env.CV_SIGNING_SECRET_PREVIOUS_EXPIRES_AT = new Date(
        Date.now() - 5_000,
      ).toISOString();
      assert.throws(() => verifyToken(legacyToken, "page"), /signature/i);

      // 3. PostgreSQL TLS configuration modes
      process.env.CV_PG_SSL_MODE = "require";
      const reqCfg = buildPgPoolConfig("postgres://cv_runtime:pw@db.internal:5432/cv");
      assert.deepEqual(reqCfg.ssl, { rejectUnauthorized: false });

      const caFile = path.join(tmpDir, "ca.pem");
      fs.writeFileSync(caFile, "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n");
      process.env.CV_PG_SSL_MODE = "verify-full";
      process.env.CV_PG_SSL_CA_FILE = caFile;
      const fullCfg = buildPgPoolConfig("postgres://cv_runtime:pw@db.internal:5432/cv");
      assert.equal(fullCfg.ssl.rejectUnauthorized, true);
      assert.match(fullCfg.ssl.ca, /BEGIN CERTIFICATE/);

      process.env.CV_PG_SSL_MODE = "bogus-mode";
      assert.throws(
        () => buildPgPoolConfig("postgres://cv_runtime:pw@db.internal:5432/cv"),
        /SEC-DB-002/,
      );
    } finally {
      for (const k of Object.keys(process.env)) {
        if (!(k in savedEnv)) delete process.env[k];
      }
      Object.assign(process.env, savedEnv);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("005-E-2: Creates online SQLite + private-storage backup, detects tampering via SHA-256, and restores cleanly", async () => {
    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "strata-005e-sqlite-bk-"));
    const srcDataDir = path.join(workRoot, "src-var");
    const bundleDir = path.join(workRoot, "bundle");
    const restoredDir = path.join(workRoot, "restored-var");

    try {
      // Seed an isolated SQLite data directory in a child process to avoid singleton cross-talk
      const { spawnSync } = await import("node:child_process");
      const seedRes = spawnSync(
        process.execPath,
        [path.join(API_ROOT, "scripts", "seed.js")],
        {
          cwd: API_ROOT,
          env: {
            ...process.env,
            NODE_ENV: "development",
            CV_DB_BACKEND: "sqlite",
            DATABASE_URL: "",
            CV_DATA_DIR: srcDataDir,
          },
          encoding: "utf8",
          timeout: 20_000,
        },
      );
      assert.equal(seedRes.status, 0, `Seed failed: ${seedRes.stderr}`);

      // Verify restricted 0700 / 0600 permissions (`AUD-D3d`)
      if (process.platform !== "win32") {
        assert.equal(fs.statSync(srcDataDir).mode & 0o777, 0o700);
        assert.equal(fs.statSync(path.join(srcDataDir, "contentvault.db")).mode & 0o777, 0o600);
      }

      const bk = createSqliteBackup({ dataDir: srcDataDir, bundleDir });
      assert.ok(bk.manifest.files.length >= 7); // contentvault.db + 1 PDF + 5 WAVs

      const verified = verifyBackupBundle(bundleDir);
      assert.equal(verified.ok, true);

      // Tamper with a single byte in the backed-up SQLite file -> verifyBackupBundle MUST fail!
      const dbBackupPath = path.join(bundleDir, "contentvault.db");
      const origBytes = fs.readFileSync(dbBackupPath);
      const tampered = Buffer.from(origBytes);
      tampered[tampered.length - 1] ^= 0xff;
      fs.writeFileSync(dbBackupPath, tampered);
      assert.throws(() => verifyBackupBundle(bundleDir), /Backup integrity check FAILED/);

      // Restore original bytes & run clean restoration into `restoredDir`
      fs.writeFileSync(dbBackupPath, origBytes);
      const restored = restoreSqliteBackup({ bundleDir, targetDataDir: restoredDir });
      assert.equal(restored.ok, true);

      // Verify restored SQLite DB + private storage objects pass `check-db.js`
      const checkRes = spawnSync(
        process.execPath,
        [path.join(API_ROOT, "scripts", "check-db.js")],
        {
          cwd: API_ROOT,
          env: {
            ...process.env,
            CV_DB_BACKEND: "sqlite",
            DATABASE_URL: "",
            CV_DATA_DIR: restoredDir,
          },
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      assert.equal(checkRes.status, 0);
      assert.match(checkRes.stdout, /ready: true/);
    } finally {
      fs.rmSync(workRoot, { recursive: true, force: true });
    }
  });

  it("005-E-3: Executes PostgreSQL cv_backup_maint snapshot, purges expired ephemerals, restores into clean PG16, and generates permissive third-party notices", async () => {
    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "strata-005e-pg-bk-"));
    const bundleDir = path.join(workRoot, "pg-bundle");
    const { PGlite } = await import("@electric-sql/pglite");
    const pgSource = new PGlite();
    const pgTarget = new PGlite();

    try {
      await applyPostgresMigrations(pgSource);
      await applyPostgresMigrations(pgTarget);

      // Grant cv_backup_maint & cv_owner to current PGlite user so SET LOCAL ROLE works cleanly
      await pgSource.exec("GRANT cv_backup_maint, cv_owner TO CURRENT_USER;");
      await pgTarget.exec("GRANT cv_owner TO CURRENT_USER;");

      // Populate source PostgreSQL with synthetic users, document, entitlement, audit_log, and an expired token
      await pgSource.exec(`
        BEGIN;
        SET LOCAL ROLE cv_owner;
        INSERT INTO public.users (id, email, display_name, role, password_hash, locale, is_demo)
        VALUES ('usr_bk_admin', 'bk.admin@strata.test', 'Backup Admin', 'admin', 'scrypt$16384$8$1$aa$bb', 'en', FALSE),
               ('usr_bk_stu', 'bk.stu@strata.test', 'Backup Student', 'student', 'scrypt$16384$8$1$cc$dd', 'zh', FALSE);
        INSERT INTO public.documents (id, title_en, storage_key, content_hash, byte_size, page_count, synthetic, uploaded_by)
        VALUES ('doc_bk_1', 'Backup Doc', 'aa/bk.pdf', 'f00d', 2048, 4, TRUE, 'usr_bk_admin');
        INSERT INTO public.entitlements (id, user_id, document_id, status, version, granted_by)
        VALUES ('ent_bk_1', 'usr_bk_stu', 'doc_bk_1', 'active', 2, 'usr_bk_admin');
        INSERT INTO public.audit_log (id, event, outcome, actor_id, actor_role, document_id, detail)
        VALUES ('aud_bk_1', 'entitlement.grant', 'allow', 'usr_bk_admin', 'admin', 'doc_bk_1', '{"reason":"bk_test"}'::jsonb);
        INSERT INTO public.token_redemptions (jti, redeemed_at, expires_at)
        VALUES ('jti_expired_old', 100, 200);
        COMMIT;
      `);

      const pgBackup = await createPostgresBackup({
        queryable: pgSource,
        bundleDir,
        useBackupRole: true,
        purgeExpired: true,
      });
      assert.equal(pgBackup.manifest.purgedEphemeral.purgedTokens, 1);
      assert.equal(pgBackup.manifest.rowCounts.users, 2);
      assert.equal(pgBackup.manifest.rowCounts.documents, 1);
      assert.equal(pgBackup.manifest.rowCounts.entitlements, 1);
      assert.equal(pgBackup.manifest.rowCounts.audit_log, 1);

      // Restore into clean `pgTarget` and verify identical rows
      const restored = await restorePostgresBackup({
        bundleDir,
        ownerQueryable: pgTarget,
      });
      assert.equal(restored.ok, true);

      await pgTarget.exec("BEGIN; SET LOCAL ROLE cv_owner;");
      const targetUsers = await pgTarget.query("SELECT id, email FROM public.users ORDER BY id");
      assert.equal(targetUsers.rows.length, 2);
      const targetAudits = await pgTarget.query("SELECT id, event FROM public.audit_log");
      assert.equal(targetAudits.rows.length, 1);
      assert.equal(targetAudits.rows[0].id, "aud_bk_1");
      await pgTarget.exec("COMMIT;");

      // Generate official third-party license notice bundle and verify permissive-only attribution
      const noticePath = path.join(REPO_ROOT, "docs", "licensing", "THIRD_PARTY_NOTICES.md");
      const noticeRes = generateThirdPartyNotices({ outputPath: noticePath });
      assert.equal(fs.existsSync(noticeRes.outputPath), true);
      const noticeText = fs.readFileSync(noticePath, "utf8");
      assert.match(noticeText, /node-postgres/);
      assert.match(noticeText, /BSD-3-Clause/);
      assert.match(noticeText, /MIT-CMU/);
      assert.match(noticeText, /WenQuanYi Micro Hei/);
      assert.match(noticeText, /Zero `AGPL` or `GPL`/);
    } finally {
      await pgSource.close();
      await pgTarget.close();
      fs.rmSync(workRoot, { recursive: true, force: true });
    }
  });
});

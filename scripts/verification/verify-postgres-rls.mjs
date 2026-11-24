#!/usr/bin/env node
/**
 * STRATA ContentVault — Mission 004 Phase C Real PostgreSQL 16 Kernel RLS Verifier
 *
 * Applies `db/migrations/001_postgres_schema_and_rls.sql` against a live PostgreSQL 16
 * database and behaviorally proves through `PostgresPersistenceAdapter` that:
 *   1. Student A can read entitled document/chapters and own entitlement, NEVER Student B's.
 *   2. Unentitled Student C sees 0 rows in `SELECT * FROM documents` at the DB kernel level.
 *   3. Student A sees 0 rows in `SELECT * FROM portfolio_enquiries` and cannot INSERT,
 *      while Reviewer and Admin are permitted.
 *   4. `cv_app_user` can INSERT into `audit_log`, only Admin can SELECT, and ANY
 *      `UPDATE` or `DELETE` on `audit_log` fails with PostgreSQL permission denied!
 *   5. Shared `rateLimit` and single-use `redeemSingleUseToken` work atomically.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresPersistenceAdapter } from "../../apps/contentvault-api/src/persistence/adapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MIGRATION_PATH = path.join(REPO_ROOT, "db", "migrations", "001_postgres_schema_and_rls.sql");

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.log("POSTGRES_RLS_SKIPPED: DATABASE_URL is not set.");
  process.exit(0);
}

const pgSpec = process.env.CV_PG_MODULE || "pg";
const pgMod = await import(pgSpec);
const { Pool } = pgMod.default || pgMod;

const pool = new Pool({ connectionString: dbUrl });

try {
  const ddl = fs.readFileSync(MIGRATION_PATH, "utf8");
  await pool.query(ddl);

  const adapter = new PostgresPersistenceAdapter(pool);

  // Provision synthetic test data under Admin RLS context
  const adminActor = { id: "usr_admin_pg", role: "admin" };
  await adapter.withActorContext(adminActor, async (client) => {
    await client.query("TRUNCATE users, documents, portfolio_enquiries, audit_log, token_redemptions, rate_limit_buckets CASCADE");

    await client.query(
      `INSERT INTO users (id, email, display_name, role, password_hash, locale) VALUES
        ('usr_admin_pg', 'admin@strata.test', 'Admin PG', 'admin', 'scrypt$stub', 'en'),
        ('usr_stu_a', 'aisyah@strata.test', 'Student A', 'student', 'scrypt$stub', 'en'),
        ('usr_stu_b', 'weiming@strata.test', '陈伟明', 'student', 'scrypt$stub', 'zh'),
        ('usr_stu_c', 'priya@strata.test', 'Student C', 'student', 'scrypt$stub', 'en'),
        ('usr_rev_pg', 'reviewer@strata.test', 'Reviewer PG', 'reviewer', 'scrypt$stub', 'en')`,
    );

    await client.query(
      `INSERT INTO documents (id, title_en, storage_key, content_hash, byte_size, page_count, synthetic, uploaded_by)
       VALUES ('doc_pg_neuro', 'Synthetic Neuro Module', 'obj/1', 'sha256_1', 12000, 6, TRUE, 'usr_admin_pg')`,
    );
    await client.query(
      `INSERT INTO chapters (id, document_id, ordinal, title_en, start_page, end_page)
       VALUES ('chap_pg_1', 'doc_pg_neuro', 1, 'Chapter 1', 1, 3)`,
    );

    await client.query(
      `INSERT INTO entitlements (id, user_id, document_id, status, version, granted_by) VALUES
        ('ent_a', 'usr_stu_a', 'doc_pg_neuro', 'active', 1, 'usr_admin_pg'),
        ('ent_b', 'usr_stu_b', 'doc_pg_neuro', 'active', 1, 'usr_admin_pg')`,
    );
  });

  // 1. Student A sees entitled document & ONLY Student A's entitlement (never Student B's!)
  const stuADocs = await adapter.listReadableDocuments({ id: "usr_stu_a", role: "student" });
  assert.equal(stuADocs.length, 1);
  const stuAEnts = await adapter.listEntitlements({ id: "usr_stu_a", role: "student" });
  assert.equal(stuAEnts.length, 1);
  assert.equal(stuAEnts[0].user_id, "usr_stu_a");

  // 2. Unentitled Student C & Reviewer see 0 documents via raw `SELECT * FROM documents`!
  const stuCDocs = await adapter.listReadableDocuments({ id: "usr_stu_c", role: "student" });
  assert.equal(stuCDocs.length, 0, "PostgreSQL RLS must filter unentitled documents for Student C");
  const revDocs = await adapter.listReadableDocuments({ id: "usr_rev_pg", role: "reviewer" });
  assert.equal(revDocs.length, 0, "PostgreSQL RLS must block Reviewer from learner documents");

  // 3. Reviewer can INSERT & SELECT portfolio_enquiries; Student A gets 0 rows & RLS insert rejection!
  await adapter.withActorContext({ id: "usr_rev_pg", role: "reviewer" }, async (client) => {
    await client.query(
      `INSERT INTO portfolio_enquiries (id, actor_id, sender_name, sender_email, topic, message)
       VALUES ('enq_1', 'usr_rev_pg', 'Synthetic Reviewer', 'rev@strata.test', 'Governance', 'Local synthetic test note')`,
    );
  });
  const revEnq = await adapter.listPortfolioEnquiries({ id: "usr_rev_pg", role: "reviewer" });
  assert.equal(revEnq.length, 1);
  const stuEnq = await adapter.listPortfolioEnquiries({ id: "usr_stu_a", role: "student" });
  assert.equal(stuEnq.length, 0, "PostgreSQL RLS must hide portfolio_enquiries from students");
  await assert.rejects(
    () =>
      adapter.withActorContext({ id: "usr_stu_a", role: "student" }, (client) =>
        client.query(
          `INSERT INTO portfolio_enquiries (id, sender_name, sender_email, topic, message)
           VALUES ('enq_bad', 'Stu', 's@strata.test', 'Bypass', 'Should fail RLS')`,
        ),
      ),
    /row-level security policy/i,
  );

  // 4. Append-only `audit_log`: Student can INSERT, cannot SELECT (0 rows), and Admin/App CANNOT UPDATE or DELETE!
  await adapter.appendAuditLog(
    { id: "usr_stu_a", role: "student" },
    { id: "aud_1", event: "page.render", outcome: "allow", actorId: "usr_stu_a", actorRole: "student", documentId: "doc_pg_neuro", page: 2, detail: { engine: "pypdfium2" } },
  );
  const stuAuditRead = await adapter.withActorContext({ id: "usr_stu_a", role: "student" }, (client) =>
    client.query("SELECT * FROM audit_log"),
  );
  assert.equal(stuAuditRead.rowCount, 0, "Non-admin must read 0 rows from audit_log under RLS");

  const adminAuditRead = await adapter.withActorContext(adminActor, (client) =>
    client.query("SELECT * FROM audit_log"),
  );
  assert.equal(adminAuditRead.rowCount, 1);

  await assert.rejects(
    () => adapter.withActorContext(adminActor, (client) => client.query("DELETE FROM audit_log WHERE id = 'aud_1'")),
    /permission denied for table audit_log/i,
  );
  await assert.rejects(
    () => adapter.withActorContext(adminActor, (client) => client.query("UPDATE audit_log SET outcome = 'deny' WHERE id = 'aud_1'")),
    /permission denied for table audit_log/i,
  );

  // 5. Shared PostgreSQL rate limiter + single-use token redemption
  const rl1 = await adapter.rateLimit("pg:rl:test", 2, 60);
  const rl2 = await adapter.rateLimit("pg:rl:test", 2, 60);
  const rl3 = await adapter.rateLimit("pg:rl:test", 2, 60);
  assert.deepEqual([rl1.allowed, rl2.allowed, rl3.allowed], [true, true, false]);

  const exp = Math.floor(Date.now() / 1000) + 60;
  assert.equal(await adapter.redeemSingleUseToken("jti_live_pg", exp), true);
  assert.equal(await adapter.redeemSingleUseToken("jti_live_pg", exp), false);

  console.log("POSTGRES_16_RLS_VERIFIED: All kernel RLS policies, append-only audit grants, and shared limiters passed.");
} finally {
  await pool.end();
}

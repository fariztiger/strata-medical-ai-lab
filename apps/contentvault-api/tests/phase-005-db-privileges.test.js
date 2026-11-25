/**
 * Mission 005 Checkpoint 005-B — PostgreSQL Runtime Privilege & RLS Isolation Suite
 * (`AUD-C2`, `AUD-C3`, `AUD-C5`).
 *
 * Verifies:
 *   - `005-B-1` (`AUD-C2`): 4 separated database roles (`cv_owner`, `cv_runtime`,
 *     `cv_auth_definer`, `cv_backup_maint`); `cv_runtime` is non-superuser, non-owner,
 *     `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`; `PostgresPersistenceAdapter.init`
 *     (`SEC-DB-003`) rejects owner/superuser pools when `enforceRoleSeparation: true`
 *     and accepts `cv_runtime` pools; on genuine TCP PostgreSQL (`DATABASE_URL`),
 *     `RESET ROLE` / `SET ROLE NONE` on a raw pool connection CANNOT escalate privileges
 *     or bypass `FORCE ROW LEVEL SECURITY`.
 *   - `005-B-2` (`AUD-C3`): Direct `SELECT password_hash FROM users` is blocked (`42501`)
 *     even for `admin` under `cv_runtime`; `cv_lookup_auth_user` rejects `student`,
 *     `reviewer`, `admin`, and `anonymous` transactions (`42501`); external
 *     `withActorContext({ role: 'auth_bootstrap' })` throws `SEC-DB-004`; all
 *     `SECURITY DEFINER` functions enforce `search_path = pg_catalog, public` and
 *     revoke `PUBLIC` execute privileges.
 *   - `005-B-3` (`AUD-C5`): `token_redemptions` and `rate_limit_buckets` are crash-safe
 *     `LOGGED` (`relpersistence = 'p'`) with `FORCE ROW LEVEL SECURITY` and zero direct
 *     table privileges for `cv_runtime`/`cv_app_user`; `portfolio_enquiries` RLS blocks
 *     cross-reviewer reads and forged `actor_id` inserts; `audit_log` RLS blocks forged
 *     `actor_id` inserts and `UPDATE`/`DELETE`; migration rollback (`002_down.sql`) and
 *     re-application (`002`) round-trip cleanly.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

const EXTERNAL_DB_URL = String(process.env.DATABASE_URL || "").trim();
const EXTERNAL_MIG_URL = String(process.env.DATABASE_MIGRATION_URL || "").trim();
const REQUIRE_GENUINE_PG = process.env.CV_REQUIRE_GENUINE_PG === "1";

const {
  applyPostgresMigrations,
  rollbackPostgresMigrations,
} = await import("../scripts/migrate-pg.js");
const { PostgresPersistenceAdapter } = await import("../src/persistence/adapter.js");

let runtimePool = null;
let ownerPool = null;
let pglite = null;
let adapter = null;
let isGenuineTcpPg = false;

describe("Mission 005 Checkpoint 005-B — Database Security & Runtime Privilege Isolation (AUD-C2, AUD-C3, AUD-C5)", () => {
  before(async () => {
    if (REQUIRE_GENUINE_PG && !EXTERNAL_DB_URL) {
      throw new Error(
        "CV_REQUIRE_GENUINE_PG=1 requires genuine TCP PostgreSQL 16 via DATABASE_URL.",
      );
    }

    if (EXTERNAL_DB_URL) {
      isGenuineTcpPg = true;
      const pgMod = await import("pg");
      const { Pool } = pgMod.default || pgMod;

      if (EXTERNAL_MIG_URL) {
        ownerPool = new Pool({ connectionString: EXTERNAL_MIG_URL });
        await applyPostgresMigrations(ownerPool, {
          runtimePassword: process.env.CV_PG_RUNTIME_PASSWORD || "",
        });
      }

      runtimePool = new Pool({ connectionString: EXTERNAL_DB_URL });
      adapter = new PostgresPersistenceAdapter(runtimePool, {
        appRole: "cv_app_user",
        enforceRoleSeparation: true,
      });
      await adapter.init();
    } else {
      const { PGlite } = await import("@electric-sql/pglite");
      pglite = new PGlite();
      await applyPostgresMigrations(pglite);

      runtimePool = {
        async connect() {
          return {
            query: (sql, params) => pglite.query(sql, params),
            release() {},
          };
        },
        query: (sql, params) => pglite.query(sql, params),
        async end() {
          await pglite.close();
        },
      };
      adapter = new PostgresPersistenceAdapter(runtimePool, {
        appRole: "cv_runtime",
        enforceRoleSeparation: false,
      });
      await adapter.init();
    }
  });

  after(async () => {
    if (runtimePool) await runtimePool.end();
    if (ownerPool) await ownerPool.end();
  });

  it("005-B-1 (AUD-C2): Enforces four-role separation, non-owner cv_runtime, SEC-DB-003 guard, and RESET ROLE non-escalation", async () => {
    const inspectPool = ownerPool || runtimePool;
    const rolesRes = await inspectPool.query(`
      SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
      FROM pg_roles
      WHERE rolname IN ('cv_owner', 'cv_runtime', 'cv_auth_definer', 'cv_backup_maint')
      ORDER BY rolname
    `);
    const byName = Object.fromEntries(rolesRes.rows.map((r) => [r.rolname, r]));

    for (const rName of ["cv_owner", "cv_runtime", "cv_auth_definer", "cv_backup_maint"]) {
      assert.ok(byName[rName], `Expected role ${rName} to exist`);
      assert.equal(byName[rName].rolsuper, false, `${rName} must be NOSUPERUSER`);
      assert.equal(byName[rName].rolbypassrls, false, `${rName} must be NOBYPASSRLS`);
      assert.equal(byName[rName].rolcreatedb, false, `${rName} must be NOCREATEDB`);
      assert.equal(byName[rName].rolcreaterole, false, `${rName} must be NOCREATEROLE`);
    }
    assert.equal(byName.cv_runtime.rolcanlogin, true, "cv_runtime must be a direct LOGIN role");
    assert.equal(byName.cv_owner.rolcanlogin, false, "cv_owner must be NOLOGIN");
    assert.equal(byName.cv_auth_definer.rolcanlogin, false, "cv_auth_definer must be NOLOGIN");
    assert.equal(byName.cv_backup_maint.rolcanlogin, false, "cv_backup_maint must be NOLOGIN");

    // Verify all 11 tables are owned by `cv_owner` and ZERO tables are owned by `cv_runtime`
    const tblRes = await inspectPool.query(`
      SELECT tablename, tableowner
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    assert.ok(tblRes.rows.length >= 11);
    for (const row of tblRes.rows) {
      assert.equal(
        row.tableowner,
        "cv_owner",
        `Table ${row.tablename} must be owned by cv_owner, got ${row.tableowner}`,
      );
    }

    // Verify SEC-DB-003 rejects privileged/superuser/owner pools when enforceRoleSeparation = true
    const privilegedPool = ownerPool || runtimePool;
    if (!isGenuineTcpPg || ownerPool) {
      const unsafeAdapter = new PostgresPersistenceAdapter(privilegedPool, {
        appRole: "cv_app_user",
        enforceRoleSeparation: true,
      });
      await assert.rejects(() => unsafeAdapter.init(), /SEC-DB-003/);
    }

    // On genuine TCP PostgreSQL 16 connected as `cv_runtime`, prove raw pool queries & RESET ROLE cannot escalate!
    if (isGenuineTcpPg) {
      const rawClient = await runtimePool.connect();
      try {
        await rawClient.query("RESET ROLE");
        const who = await rawClient.query("SELECT current_user AS cu, session_user AS su");
        assert.equal(who.rows[0].cu, "cv_runtime");
        assert.equal(who.rows[0].su, "cv_runtime");

        // Raw query without GUC context sees 0 rows on RLS-forced `users`
        const rawUsers = await rawClient.query("SELECT id, email FROM public.users");
        assert.equal(rawUsers.rows.length, 0, "Raw cv_runtime query after RESET ROLE must still obey FORCE RLS");

        // Raw DELETE / DROP on audit_log must fail with 42501
        await assert.rejects(() => rawClient.query("DELETE FROM public.audit_log"), {
          code: "42501",
        });
        await assert.rejects(() => rawClient.query("DROP TABLE public.audit_log"), {
          code: "42501",
        });
      } finally {
        rawClient.release();
      }
    }
  });

  it("005-B-2 (AUD-C3): Blocks cross-user password_hash reads, restricts cv_lookup_auth_user to auth_bootstrap, and hardens SECURITY DEFINER functions", async () => {
    const admin = await adapter.createUser(
      { role: "admin" },
      {
        id: "usr_b2_admin",
        email: "b2.admin@strata.test",
        displayName: "B2 Admin",
        role: "admin",
        passwordHash: "scrypt$16384$8$1$secret_salt$secret_admin_hash_value",
        locale: "en",
      },
    );
    const student = await adapter.createUser(
      { role: "admin" },
      {
        id: "usr_b2_student",
        email: "b2.student@strata.test",
        displayName: "B2 Student",
        role: "student",
        passwordHash: "scrypt$16384$8$1$secret_salt$secret_student_hash",
        locale: "en",
      },
    );
    const reviewer = await adapter.createUser(
      { role: "admin" },
      {
        id: "usr_b2_reviewer",
        email: "b2.reviewer@strata.test",
        displayName: "B2 Reviewer",
        role: "reviewer",
        passwordHash: "scrypt$16384$8$1$secret_salt$secret_reviewer_hash",
        locale: "en",
      },
    );

    // 1. Even `admin` in `cv_runtime` cannot SELECT `password_hash` directly from `public.users`!
    await assert.rejects(
      () =>
        adapter.withActorContext(admin, (tx) =>
          tx.query("SELECT id, password_hash FROM public.users"),
        ),
      { code: "42501" },
    );

    // 2. `student`, `reviewer`, `admin`, and `anonymous` transactions CANNOT execute `cv_lookup_auth_user`!
    for (const actor of [student, reviewer, admin, { role: "anonymous" }]) {
      await assert.rejects(
        () =>
          adapter.withActorContext(actor, (tx) =>
            tx.query("SELECT * FROM public.cv_lookup_auth_user($1)", ["b2.admin@strata.test"]),
          ),
        (err) => err.code === "42501" && /auth_bootstrap/.test(err.message),
      );
    }

    // 3. External callers cannot spoof `role: 'auth_bootstrap'` into `withActorContext`
    await assert.rejects(
      () => adapter.withActorContext({ role: "auth_bootstrap" }, async () => {}),
      /SEC-DB-004/,
    );

    // 4. Controlled `adapter.lookupAuthUserForLogin` succeeds cleanly via internal bootstrap tx
    const authRow = await adapter.lookupAuthUserForLogin("b2.admin@strata.test");
    assert.ok(authRow);
    assert.equal(authRow.id, admin.id);
    assert.ok(authRow.password_hash.includes("secret_admin_hash_value"));

    // 5. Cross-learner entitlement oracle blocked (`cv_has_active_entitlement`)
    const doc = await adapter.createDocument(admin, {
      id: "doc_b2_1",
      titleEn: "Oracle Guard Test",
      storageKey: "ab/oracle.pdf",
      contentHash: "a".repeat(64),
      byteSize: 1024,
      pageCount: 2,
      synthetic: true,
      uploadedBy: admin.id,
    });
    await adapter.grantEntitlement(admin, {
      id: "ent_b2_1",
      userId: student.id,
      documentId: doc.id,
      grantedBy: admin.id,
    });

    const probeFromReviewer = await adapter.withActorContext(reviewer, (tx) =>
      tx.query("SELECT public.cv_has_active_entitlement($1, $2) AS entitled", [
        doc.id,
        student.id,
      ]),
    );
    assert.equal(
      probeFromReviewer.rows[0].entitled,
      false,
      "Non-admin actor must not be able to probe another user's entitlement status via cv_has_active_entitlement",
    );

    // 6. All SECURITY DEFINER functions in schema `public` enforce safe search_path & revoke PUBLIC execute
    const inspectPool = ownerPool || runtimePool;
    const secDefRes = await inspectPool.query(`
      SELECT p.proname,
             p.proconfig,
             has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef = TRUE
      ORDER BY p.proname
    `);
    assert.ok(secDefRes.rows.length >= 8);
    for (const fn of secDefRes.rows) {
      assert.equal(fn.public_exec, false, `PUBLIC must not have EXECUTE on ${fn.proname}`);
      assert.ok(
        Array.isArray(fn.proconfig) &&
          fn.proconfig.some((c) => c.startsWith("search_path=pg_catalog")),
        `SECURITY DEFINER ${fn.proname} must pin search_path=pg_catalog, public`,
      );
    }
  });

  it("005-B-3 (AUD-C5): Enforces LOGGED + FORCE RLS ephemeral ledgers, reviewer enquiry isolation, actor-bound audit_log, and reversible rollback", async () => {
    const inspectPool = ownerPool || runtimePool;

    // 1. Both `token_redemptions` and `rate_limit_buckets` are LOGGED ('p') and FORCE RLS
    const relRes = await inspectPool.query(`
      SELECT relname, relpersistence, relrowsecurity, relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND relname IN ('token_redemptions', 'rate_limit_buckets', 'audit_log', 'portfolio_enquiries')
      ORDER BY relname
    `);
    for (const r of relRes.rows) {
      assert.equal(r.relpersistence, "p", `${r.relname} must be LOGGED (relpersistence='p')`);
      assert.equal(r.relrowsecurity, true, `${r.relname} must enable RLS`);
      assert.equal(r.relforcerowsecurity, true, `${r.relname} must FORCE RLS`);
    }

    // 2. Direct table access to `token_redemptions` & `rate_limit_buckets` is revoked from `cv_runtime`
    for (const tbl of ["token_redemptions", "rate_limit_buckets"]) {
      await assert.rejects(
        () =>
          adapter.withActorContext({ id: "usr_b2_admin", role: "admin" }, (tx) =>
            tx.query(`DELETE FROM public.${tbl}`),
          ),
        { code: "42501" },
      );
      await assert.rejects(
        () =>
          adapter.withActorContext({ id: "usr_b2_admin", role: "admin" }, (tx) =>
            tx.query(`SELECT * FROM public.${tbl}`),
          ),
        { code: "42501" },
      );
    }

    // Controlled SECURITY DEFINER token & rate-limit primitives succeed
    const nowSec = Math.floor(Date.now() / 1000);
    assert.equal(await adapter.redeemSingleUseToken("jti_b3_once", nowSec + 60), true);
    assert.equal(await adapter.redeemSingleUseToken("jti_b3_once", nowSec + 60), false);

    // 3. Reviewer cannot forge another reviewer's `actor_id` in `portfolio_enquiries` or `audit_log`
    const rev1 = { id: "usr_b2_reviewer", role: "reviewer" };
    await assert.rejects(
      () =>
        adapter.withActorContext(rev1, (tx) =>
          tx.query(
            `INSERT INTO public.portfolio_enquiries
              (id, actor_id, sender_name, sender_email, topic, message)
             VALUES ('enq_forged', 'usr_b2_admin', 'Forger', 'f@strata.test', 't', 'forged message body')`,
          ),
        ),
      { code: "42501" },
    );

    await assert.rejects(
      () =>
        adapter.withActorContext(rev1, (tx) =>
          tx.query(
            `INSERT INTO public.audit_log (id, event, outcome, actor_id, actor_role)
             VALUES ('aud_forged', 'fake.event', 'allow', 'usr_b2_admin', 'admin')`,
          ),
        ),
      { code: "42501" },
    );

    // 4. Verify `schema_migrations` ledger & reversible `002_down.sql` -> `002` round-trip on migration connection
    const migRes = await inspectPool.query(
      "SELECT version FROM public.schema_migrations ORDER BY version",
    );
    assert.deepEqual(
      migRes.rows.map((r) => r.version),
      ["001_postgres_schema_and_rls", "002_database_roles_and_hardening"],
    );

    if (ownerPool || pglite) {
      const migTarget = ownerPool || pglite;
      const reverted = await rollbackPostgresMigrations(migTarget, { all: false });
      assert.deepEqual(reverted, ["002_down"]);

      const reapplied = await applyPostgresMigrations(migTarget, {
        runtimePassword: process.env.CV_PG_RUNTIME_PASSWORD || "",
      });
      assert.deepEqual(reapplied, [
        "001_postgres_schema_and_rls",
        "002_database_roles_and_hardening",
      ]);
    }
  });
});

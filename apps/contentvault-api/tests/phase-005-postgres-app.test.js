/**
 * Mission 005 Checkpoint 005-A — Behavioral PostgreSQL HTTP Application Suite (`AUD-C1`).
 *
 * Executes real end-to-end HTTP requests (`createAppServer`) against PostgreSQL:
 *   - When `DATABASE_URL` is set (CI `postgres:16-alpine` TCP server connected as
 *     non-owner `cv_runtime`), runs against genuine PostgreSQL 16 over TCP (`pg.Pool`)
 *     with `CV_ENFORCE_DB_ROLE_SEPARATION=1`.
 *   - When `DATABASE_URL` is unset (local offline developer sandbox without a local
 *     postgres daemon), runs against an isolated PostgreSQL 16 WASM (`@electric-sql/pglite`)
 *     instance, unless `CV_REQUIRE_GENUINE_PG=1` is set (which fails closed if TCP PG is absent).
 *
 * Proves:
 *   1. Real HTTP routes (auth, sessions, register, PDF upload, chapters, audio Range,
 *      watermarked page render, single-use X-Page-Token redemption, grant/revoke,
 *      progress, reviewer-isolated portfolio enquiries, admin stats/users/audit, `/readyz`)
 *      execute 100% through PostgreSQL with ZERO `contentvault.db` SQLite file created.
 *   2. Fail-closed backend selection: misconfigured or unreachable PostgreSQL exits
 *      non-zero and NEVER falls back to SQLite.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(API_ROOT, "..", "..");

const EXTERNAL_DB_URL = String(process.env.DATABASE_URL || "").trim();
const REQUIRE_GENUINE_PG = process.env.CV_REQUIRE_GENUINE_PG === "1";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "strata-005a-pgapp-"));
process.env.CV_DATA_DIR = TEST_DATA_DIR;
process.env.CV_PDF_ENGINE = "pypdfium2";
process.env.CV_SIGNING_SECRET = crypto.randomBytes(48).toString("hex");

const { applyPostgresMigrations } = await import("../scripts/migrate-pg.js");
const {
  PostgresPersistenceAdapter,
  setPersistenceAdapter,
  initializePersistence,
  closePersistenceAdapter,
} = await import("../src/persistence/adapter.js");
const { createAppServer } = await import("../src/app.js");
const { seedDemoEnvironment } = await import("../scripts/seed.js");
const { generateSyntheticTeachingWav } = await import("../src/services/synthetic-audio.js");

let server;
let baseUrl;
let pgliteInstance = null;
let engineMode = "unknown";

async function http(pathname, { method = "GET", headers = {}, body = null, cookie = null } = {}) {
  const finalHeaders = { ...headers };
  if (cookie) finalHeaders.Cookie = cookie;
  let payload = body;
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    finalHeaders["Content-Type"] = finalHeaders["Content-Type"] || "application/json";
    payload = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers: finalHeaders,
    body: payload,
    redirect: "manual",
  });
}

async function loginCookie(email, password, ip = "198.51.100.10") {
  const res = await http("/api/auth/login", {
    method: "POST",
    headers: { "X-Forwarded-For": ip },
    body: { email, password },
  });
  assert.equal(res.status, 200, `Expected 200 login for ${email}, got ${res.status}`);
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/cv_session=[^;]+/);
  assert.ok(match, "Expected cv_session Set-Cookie header");
  return match[0];
}

describe("Mission 005 Checkpoint 005-A — PostgreSQL HTTP Application Integration (AUD-C1)", () => {
  before(async () => {
    if (REQUIRE_GENUINE_PG && !EXTERNAL_DB_URL) {
      throw new Error(
        "CV_REQUIRE_GENUINE_PG=1 is set, but DATABASE_URL is missing. Refusing PGlite substitute.",
      );
    }

    if (EXTERNAL_DB_URL) {
      engineMode = "postgres-16-tcp";
      const migUrl = process.env.DATABASE_MIGRATION_URL || EXTERNAL_DB_URL;
      const pgMod = await import("pg");
      const { Pool } = pgMod.default || pgMod;

      // Apply migrations via owner/migration URL if provided
      if (process.env.DATABASE_MIGRATION_URL) {
        const migPool = new Pool({ connectionString: migUrl });
        try {
          await applyPostgresMigrations(migPool, {
            runtimePassword: process.env.CV_PG_RUNTIME_PASSWORD || "",
          });
        } finally {
          await migPool.end();
        }
      }

      process.env.CV_DB_BACKEND = "postgres";
      await initializePersistence();
    } else {
      engineMode = "pglite-postgres16-wasm";
      const { PGlite } = await import("@electric-sql/pglite");
      pgliteInstance = new PGlite();
      await applyPostgresMigrations(pgliteInstance);

      const poolLike = {
        async connect() {
          return {
            query: (sql, params) => pgliteInstance.query(sql, params),
            release() {},
          };
        },
        query: (sql, params) => pgliteInstance.query(sql, params),
        async end() {
          await pgliteInstance.close();
        },
      };
      const adapter = new PostgresPersistenceAdapter(poolLike, {
        appRole: "cv_runtime",
        enforceRoleSeparation: false,
      });
      await adapter.init();
      setPersistenceAdapter(adapter);
    }

    await seedDemoEnvironment();

    server = createAppServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await closePersistenceAdapter();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it("005-A-1: Serves /health and /readyz on PostgreSQL with ZERO SQLite database file created", async () => {
    const sqliteFile = path.join(TEST_DATA_DIR, "contentvault.db");
    assert.equal(
      fs.existsSync(sqliteFile),
      false,
      `SQLite file ${sqliteFile} must NEVER be created when running on PostgreSQL (${engineMode})`,
    );

    const healthRes = await http("/health");
    assert.equal(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.equal(healthBody.ok, true);

    const readyRes = await http("/readyz");
    assert.equal(readyRes.status, 200);
    const readyBody = await readyRes.json();
    assert.equal(readyBody.ok, true);
    assert.equal(readyBody.ready, true);
    assert.equal(readyBody.backend, "postgres");
    if (engineMode === "postgres-16-tcp") {
      assert.equal(readyBody.dbRole, "cv_runtime");
    }
  });

  it("005-A-2: Executes full HTTP lifecycle (auth, upload, chapters, audio Range, page render, single-use token, progress, grant/revoke, reviewer isolation, audit) on PostgreSQL", async () => {
    const adminCookie = await loginCookie("admin@strata.local", "strata-demo-admin-local");
    const studentACookie = await loginCookie("aisyah@student.strata.local", "strata-demo-student-local");
    const studentCCookie = await loginCookie("priya@student.strata.local", "strata-demo-student-local");

    // 1. Session resolution (`/api/auth/me`)
    const meRes = await http("/api/auth/me", { cookie: studentACookie });
    assert.equal(meRes.status, 200);
    const meBody = await meRes.json();
    assert.equal(meBody.user.email, "aisyah@student.strata.local");
    assert.equal("password_hash" in meBody.user, false);

    // 2. Admin registers two distinct reviewers & one new student
    const rev1Res = await http("/api/auth/register", {
      method: "POST",
      cookie: adminCookie,
      body: {
        email: "reviewer.alpha@strata.test",
        password: "ReviewerAlphaStrong!2026",
        displayName: "Reviewer Alpha",
        role: "reviewer",
      },
    });
    assert.equal(rev1Res.status, 201);

    const rev2Res = await http("/api/auth/register", {
      method: "POST",
      cookie: adminCookie,
      body: {
        email: "reviewer.beta@strata.test",
        password: "ReviewerBetaStrong!2026",
        displayName: "Reviewer Beta",
        role: "reviewer",
      },
    });
    assert.equal(rev2Res.status, 201);

    const newStuRes = await http("/api/auth/register", {
      method: "POST",
      cookie: adminCookie,
      body: {
        email: "learner.pg@strata.test",
        password: "LearnerPgStrong!2026",
        displayName: "PG Learner 陳同學",
        role: "student",
        locale: "zh",
      },
    });
    assert.equal(newStuRes.status, 201);
    const newStudent = (await newStuRes.json()).user;

    // 3. Admin uploads synthetic PDF via HTTP POST /api/documents
    const pdfBytes = fs.readFileSync(
      path.join(REPO_ROOT, "knowledge", "synthetic", "synthetic-neurology-module.pdf"),
    );
    const uploadRes = await http("/api/documents", {
      method: "POST",
      cookie: adminCookie,
      headers: {
        "Content-Type": "application/pdf",
        "X-Title-En": "PG16 Integration Module",
        "X-Title-Zh": encodeURIComponent("PG16 集成验证单元"),
        "X-Author": "STRATA Synthetic",
      },
      body: pdfBytes,
    });
    assert.equal(uploadRes.status, 201);
    const uploadedDoc = (await uploadRes.json()).document;
    assert.ok(uploadedDoc.id.startsWith("doc_"));

    // 4. Admin creates chapter + uploads private WAV audio
    const chRes = await http(`/api/documents/${uploadedDoc.id}/chapters`, {
      method: "POST",
      cookie: adminCookie,
      body: {
        ordinal: 1,
        titleEn: "PG Chapter 1",
        titleZh: "第一章",
        startPage: 1,
        endPage: 2,
      },
    });
    assert.equal(chRes.status, 201);
    const { chapterId } = await chRes.json();

    const wavBytes = generateSyntheticTeachingWav({ chapterOrdinal: 1, durationSeconds: 2 });
    const audUpRes = await http(
      `/api/documents/${uploadedDoc.id}/chapters/${chapterId}/audio`,
      {
        method: "POST",
        cookie: adminCookie,
        headers: { "Content-Type": "audio/wav", "X-Audio-Seconds": "2" },
        body: wavBytes,
      },
    );
    assert.equal(audUpRes.status, 201);

    // 5. Unentitled Student C gets 403 on document detail, page, and audio
    const unentDoc = await http(`/api/documents/${uploadedDoc.id}`, { cookie: studentCCookie });
    assert.equal(unentDoc.status, 403);
    const unentPage = await http(`/api/documents/${uploadedDoc.id}/page?page=1`, {
      cookie: studentCCookie,
    });
    assert.equal(unentPage.status, 403);

    // 6. Admin grants access to newStudent; newStudent signs in & renders watermarked page + redeems single-use token
    const grantRes = await http(`/api/documents/${uploadedDoc.id}/grant`, {
      method: "POST",
      cookie: adminCookie,
      body: { userId: newStudent.id, reason: "pg_http_e2e" },
    });
    assert.equal(grantRes.status, 200);

    const newStuCookie = await loginCookie("learner.pg@strata.test", "LearnerPgStrong!2026");

    const listRes = await http("/api/documents", { cookie: newStuCookie });
    assert.equal(listRes.status, 200);
    const listedDocs = (await listRes.json()).documents;
    assert.equal(listedDocs.length, 1);
    assert.equal(listedDocs[0].id, uploadedDoc.id);

    const page1Res = await http(`/api/documents/${uploadedDoc.id}/page?page=1`, {
      cookie: newStuCookie,
    });
    assert.equal(page1Res.status, 200);
    assert.equal(page1Res.headers.get("content-type"), "image/png");
    const pageToken = page1Res.headers.get("x-page-token");
    const audioToken = page1Res.headers.get("x-audio-token");
    assert.ok(pageToken, "Expected X-Page-Token header");
    assert.ok(audioToken, "Expected X-Audio-Token header");
    const pngBuf = Buffer.from(await page1Res.arrayBuffer());
    assert.equal(pngBuf.subarray(0, 4).toString("hex"), "89504e47");

    // Single-use token redemption in PostgreSQL `token_redemptions`
    const redeem1 = await http(
      `/api/documents/${uploadedDoc.id}/page?page=1&token=${encodeURIComponent(pageToken)}`,
      { cookie: newStuCookie },
    );
    assert.equal(redeem1.status, 200);

    const redeemReplay = await http(
      `/api/documents/${uploadedDoc.id}/page?page=1&token=${encodeURIComponent(pageToken)}`,
      { cookie: newStuCookie },
    );
    assert.equal(redeemReplay.status, 403);
    assert.equal((await redeemReplay.json()).error, "token_replayed");

    // HTTP Range audio streaming with X-Audio-Token
    const audioRange = await http(
      `/api/documents/${uploadedDoc.id}/audio?page=1&token=${encodeURIComponent(audioToken)}`,
      {
        cookie: newStuCookie,
        headers: { Range: "bytes=0-127" },
      },
    );
    assert.equal(audioRange.status, 206);
    assert.equal((await audioRange.arrayBuffer()).byteLength, 128);

    // Reading progress persistence in PostgreSQL
    const progPost = await http(`/api/documents/${uploadedDoc.id}/progress`, {
      method: "POST",
      cookie: newStuCookie,
      body: { page: 3 },
    });
    assert.equal(progPost.status, 200);
    const progGet = await http(`/api/documents/${uploadedDoc.id}/progress`, {
      cookie: newStuCookie,
    });
    assert.equal((await progGet.json()).progress.last_page, 3);

    // 7. Live revocation immediately returns 403 `revoked` on both document detail and page render
    const revAccess = await http(`/api/documents/${uploadedDoc.id}/revoke`, {
      method: "POST",
      cookie: adminCookie,
      body: { userId: newStudent.id, reason: "pg_revocation_check" },
    });
    assert.equal(revAccess.status, 200);

    const afterRevDoc = await http(`/api/documents/${uploadedDoc.id}`, { cookie: newStuCookie });
    assert.equal(afterRevDoc.status, 403);
    assert.equal((await afterRevDoc.json()).error, "revoked");

    const afterRevPage = await http(`/api/documents/${uploadedDoc.id}/page?page=1`, {
      cookie: newStuCookie,
    });
    assert.equal(afterRevPage.status, 403);
    assert.equal((await afterRevPage.json()).error, "revoked");

    // 8. Reviewer portfolio enquiry isolation (`AUD-C5`) over HTTP
    const rev1Cookie = await loginCookie("reviewer.alpha@strata.test", "ReviewerAlphaStrong!2026");
    const rev2Cookie = await loginCookie("reviewer.beta@strata.test", "ReviewerBetaStrong!2026");

    const enq1 = await http("/api/portfolio/enquiries", {
      method: "POST",
      cookie: rev1Cookie,
      body: {
        senderName: "Reviewer Alpha",
        senderOrg: "Hospital Alpha",
        senderEmail: "alpha@hospital.test",
        topic: "research",
        message: "Confidential enquiry from Reviewer Alpha only.",
      },
    });
    assert.equal(enq1.status, 201);

    const rev2Enquiries = await (
      await http("/api/portfolio/enquiries", { cookie: rev2Cookie })
    ).json();
    assert.equal(
      rev2Enquiries.enquiries.length,
      0,
      "Reviewer Beta must NOT see Reviewer Alpha's enquiries",
    );

    const rev1Enquiries = await (
      await http("/api/portfolio/enquiries", { cookie: rev1Cookie })
    ).json();
    assert.equal(rev1Enquiries.enquiries.length, 1);

    const adminEnquiries = await (
      await http("/api/portfolio/enquiries", { cookie: adminCookie })
    ).json();
    assert.ok(adminEnquiries.enquiries.length >= 1);

    // 9. Admin stats, users (no password_hash), audit trail, and logout
    const statsRes = await http("/api/admin/stats", { cookie: adminCookie });
    assert.equal(statsRes.status, 200);
    const statsBody = await statsRes.json();
    assert.equal(statsBody.backend, "postgres");
    assert.ok(statsBody.users >= 7);

    const usersBody = await (await http("/api/admin/users", { cookie: adminCookie })).json();
    assert.ok(usersBody.users.every((u) => !("password_hash" in u)));

    const auditBody = await (
      await http(`/api/admin/audit?documentId=${uploadedDoc.id}`, { cookie: adminCookie })
    ).json();
    assert.ok(auditBody.entries.some((e) => e.event === "page.render" && e.outcome === "allow"));
    assert.ok(auditBody.entries.some((e) => e.event === "entitlement.revoke" && e.outcome === "allow"));

    const logoutRes = await http("/api/auth/logout", {
      method: "POST",
      cookie: newStuCookie,
    });
    assert.equal(logoutRes.status, 200);
    const meAfterLogout = await http("/api/auth/me", { cookie: newStuCookie });
    assert.equal(meAfterLogout.status, 401);

    // Confirm SQLite file STILL does not exist after full workload
    assert.equal(fs.existsSync(path.join(TEST_DATA_DIR, "contentvault.db")), false);
  });

  it("005-A-3: Fails closed when PostgreSQL is misconfigured or unreachable with ZERO fallback to SQLite", () => {
    const serverScript = path.join(API_ROOT, "src", "server.js");
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "strata-005a-failclosed-"));
    const strongSecret = crypto.randomBytes(48).toString("hex");

    try {
      // 1. CV_DB_BACKEND=postgres without DATABASE_URL
      const missingUrl = spawnSync(process.execPath, [serverScript], {
        cwd: API_ROOT,
        env: {
          ...process.env,
          CV_DATA_DIR: emptyDir,
          CV_DB_BACKEND: "postgres",
          DATABASE_URL: "",
          CV_SIGNING_SECRET: strongSecret,
          PORT: "0",
        },
        encoding: "utf8",
        timeout: 5000,
      });
      assert.notEqual(missingUrl.status, 0);
      assert.match(missingUrl.stderr, /SEC-DB-001/);
      assert.equal(fs.existsSync(path.join(emptyDir, "contentvault.db")), false);

      // 2. Unreachable PostgreSQL port in production -> fails closed, zero SQLite fallback
      const unreachablePg = spawnSync(process.execPath, [serverScript], {
        cwd: API_ROOT,
        env: {
          ...process.env,
          NODE_ENV: "production",
          CV_DATA_DIR: emptyDir,
          CV_PG_SSL_MODE: "disable",
          DATABASE_URL: "postgres://cv_runtime:badpass@127.0.0.1:1/contentvault_unreachable",
          CV_SIGNING_SECRET: strongSecret,
          PORT: "0",
        },
        encoding: "utf8",
        timeout: 8000,
      });
      assert.notEqual(unreachablePg.status, 0);
      assert.match(unreachablePg.stderr, /FATAL startup failure/i);
      assert.equal(
        fs.existsSync(path.join(emptyDir, "contentvault.db")),
        false,
        "Production PostgreSQL failure must NEVER create or fall back to SQLite",
      );

      // 3. Explicit sqlite backend rejected when CV_REQUIRE_POSTGRES=1
      const forbiddenSqlite = spawnSync(process.execPath, [serverScript], {
        cwd: API_ROOT,
        env: {
          ...process.env,
          CV_DATA_DIR: emptyDir,
          CV_DB_BACKEND: "sqlite",
          CV_REQUIRE_POSTGRES: "1",
          CV_SIGNING_SECRET: strongSecret,
          PORT: "0",
        },
        encoding: "utf8",
        timeout: 5000,
      });
      assert.notEqual(forbiddenSqlite.status, 0);
      assert.match(forbiddenSqlite.stderr, /SEC-DB-001/);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

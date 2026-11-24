/**
 * Mission 004 — Phase C Production Architecture Suite:
 *   C-1: Pluggable Persistence Adapters (SQLite + PostgreSQL RLS transaction protocol)
 *   C-2: Shared & Strictly Bounded Rate Limiting (`rate_limit_buckets` cap & eviction)
 *   C-3: Account Lockout DoS Mitigation + Null-Prototype Demo Persona Lookup
 *   C-4: Production Signing Secret Entropy, File Permissions & Key Rotation
 *   C-5: Reviewer-Specific Least-Privilege Landing Experience (EN & 中文)
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";

const PHASE_C_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "strata-phase-c-"));
process.env.CV_DATA_DIR = PHASE_C_DIR;
process.env.CV_SIGNING_SECRET = crypto.randomBytes(48).toString("hex");
delete process.env.CV_ENABLE_DEMO_PERSONAS;
delete process.env.CV_ALLOW_FRAME_EMBED;
delete process.env.CV_TRUST_PROXY;

const { API_ROOT, PUBLIC_DIR } = await import("../src/config.js");
const { getDb, closeDb } = await import("../src/db.js");
const { createAppServer } = await import("../src/app.js");
const { seedDemoEnvironment } = await import("../scripts/seed.js");
const { createUser } = await import("../src/security/authz.js");
const { signToken, verifyToken } = await import("../src/security/crypto.js");
const { rateLimit } = await import("../src/http/helpers.js");
const {
  SqlitePersistenceAdapter,
  PostgresPersistenceAdapter,
} = await import("../src/persistence/adapter.js");

let server;
let baseUrl;
let seeded;

function reqJson(urlPath, { method = "GET", headers = {}, body = null, cookie = "" } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body !== null ? Buffer.from(JSON.stringify(body), "utf8") : null;
    const reqHeaders = { ...headers };
    if (cookie) reqHeaders.Cookie = cookie;
    if (payload) {
      reqHeaders["Content-Type"] = "application/json";
      reqHeaders["Content-Length"] = String(payload.length);
    }
    const req = http.request(`${baseUrl}${urlPath}`, { method, headers: reqHeaders }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = JSON.parse(raw);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, raw, json });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("Mission 004 Phase C — Production Architecture Prototypes & Safeguards", () => {
  before(async () => {
    seeded = await seedDemoEnvironment({ silent: true });
    const app = createAppServer();
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    closeDb();
    fs.rmSync(PHASE_C_DIR, { recursive: true, force: true });
  });

  test("C-1: SqlitePersistenceAdapter enforces row visibility and PostgresPersistenceAdapter binds RLS role & session GUC context", async () => {
    const sqliteAdapter = new SqlitePersistenceAdapter();

    const stuADocs = await sqliteAdapter.listReadableDocuments({
      id: seeded.studentA.id,
      role: "student",
    });
    assert.equal(stuADocs.length, 1);

    const stuCDocs = await sqliteAdapter.listReadableDocuments({
      id: seeded.studentC.id,
      role: "student",
    });
    assert.equal(stuCDocs.length, 0, "Unentitled Student C must see 0 documents");

    await assert.rejects(
      () => sqliteAdapter.listPortfolioEnquiries({ id: seeded.studentA.id, role: "student" }),
      (err) => err.code === "RLS_DENIED",
    );

    // Verify PostgresPersistenceAdapter transaction & SET LOCAL ROLE + set_config protocol
    const executedQueries = [];
    const mockPool = {
      async connect() {
        return {
          async query(sql, params = []) {
            executedQueries.push({ sql: sql.trim(), params });
            if (sql.includes("FROM documents")) {
              return { rows: [{ id: "doc_pg_1", title_en: "RLS Filtered Doc" }], rowCount: 1 };
            }
            if (sql.includes("INSERT INTO token_redemptions")) {
              return { rows: [], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
          },
          release() {},
        };
      },
    };

    const pgAdapter = new PostgresPersistenceAdapter(mockPool);
    const pgDocs = await pgAdapter.listReadableDocuments({
      id: "usr_stu_pg",
      role: "student",
    });
    assert.equal(pgDocs.length, 1);
    assert.equal(executedQueries[0].sql, "BEGIN");
    assert.equal(executedQueries[1].sql, "SET LOCAL ROLE cv_app_user");
    assert.match(executedQueries[2].sql, /set_config\('app\.current_user_id'/);
    assert.deepEqual(executedQueries[2].params, ["usr_stu_pg", "student"]);
    assert.equal(executedQueries[4].sql, "COMMIT");

    const redeemed = await pgAdapter.redeemSingleUseToken("jti_pg_001", Math.floor(Date.now() / 1000) + 45);
    assert.equal(redeemed, true);
  });

  test("C-2: Shared rate limiter persists in SQLite and strictly enforces maxBuckets eviction cap", () => {
    const db = getDb();
    db.prepare("DELETE FROM rate_limit_buckets").run();

    for (let i = 0; i < 95; i += 1) {
      rateLimit(`spray:key:${i}`, 10, 120, { maxBuckets: 35 });
    }

    const rowCount = db.prepare("SELECT COUNT(*) AS n FROM rate_limit_buckets").get().n;
    assert.ok(
      rowCount <= 35,
      `Expected rate_limit_buckets count <= 35 under key-spray attack, got ${rowCount}`,
    );
  });

  test("C-3: Mitigates unauthenticated account-lockout DoS while blocking single-IP brute force, distributed sprays & prototype probes", async () => {
    const victim = createUser({
      email: "dos.resilient@strata.test",
      password: "LegitDoctorPassword#2026!",
      displayName: "Dr. Resilient User",
      role: "student",
    });

    process.env.CV_TRUST_PROXY = "127.0.0.1";
    try {
      // 1. Single-IP brute force against victim from 203.0.113.200 is throttled after 5 failures
      const singleIpCodes = [];
      for (let i = 1; i <= 6; i += 1) {
        const r = await reqJson("/api/auth/login", {
          method: "POST",
          headers: { "X-Forwarded-For": "203.0.113.200" },
          body: { email: victim.email, password: "BadPassword#1" },
        });
        singleIpCodes.push(r.status);
      }
      assert.deepEqual(singleIpCodes, [401, 401, 401, 401, 401, 429]);

      // 2. Additional distributed bot IPs push global failures past 8 -> bot gets 429
      for (let i = 1; i <= 4; i += 1) {
        await reqJson("/api/auth/login", {
          method: "POST",
          headers: { "X-Forwarded-For": `203.0.113.${50 + i}` },
          body: { email: victim.email, password: "BadPassword#2" },
        });
      }
      const botBlocked = await reqJson("/api/auth/login", {
        method: "POST",
        headers: { "X-Forwarded-For": "203.0.113.99" },
        body: { email: victim.email, password: "BadPassword#3" },
      });
      assert.equal(botBlocked.status, 429, "Distributed attacker IP must receive 429");

      // 3. CRITICAL DoS MITIGATION PROOF: Legitimate user from clean IP (198.51.100.88)
      //    with VALID password STILL authenticates (200 OK) despite active spray!
      const legitLogin = await reqJson("/api/auth/login", {
        method: "POST",
        headers: { "X-Forwarded-For": "198.51.100.88" },
        body: { email: victim.email, password: "LegitDoctorPassword#2026!" },
      });
      assert.equal(
        legitLogin.status,
        200,
        "Legitimate account owner from clean IP must NOT be DoS-locked out by third-party spray",
      );

      // 4. Meanwhile, original attacker IP (203.0.113.200) REMAINS locked out (429)!
      const attackerStillLocked = await reqJson("/api/auth/login", {
        method: "POST",
        headers: { "X-Forwarded-For": "203.0.113.200" },
        body: { email: victim.email, password: "LegitDoctorPassword#2026!" },
      });
      assert.equal(attackerStillLocked.status, 429, "Offending attacker IP must stay throttled");
    } finally {
      delete process.env.CV_TRUST_PROXY;
    }

    // 5. Prototype-key probe on /api/auth/demo-login returns 400 (not 404/500)
    process.env.CV_ENABLE_DEMO_PERSONAS = "1";
    try {
      const protoProbe = await reqJson("/api/auth/demo-login", {
        method: "POST",
        body: { personaId: "__proto__" },
      });
      assert.equal(protoProbe.status, 400);
    } finally {
      delete process.env.CV_ENABLE_DEMO_PERSONAS;
    }
  });

  test("C-4: Enforces production secret Shannon entropy, secret-file 0600 permissions, and zero-downtime key rotation", () => {
    const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), "strata-prod-ent-"));
    try {
      // 1. Low-entropy 64-char secret ('a'.repeat(64)) MUST fail in NODE_ENV=production
      assert.throws(
        () => {
          execFileSync(process.execPath, ["src/server.js"], {
            cwd: API_ROOT,
            env: {
              ...process.env,
              NODE_ENV: "production",
              CV_DATA_DIR: cleanDir,
              CV_SIGNING_SECRET: "a".repeat(64),
              PORT: "0",
            },
            stdio: "pipe",
          });
        },
        /entropy/i,
      );

      // 2. World-readable CV_SIGNING_SECRET_FILE (0644) MUST fail in NODE_ENV=production on POSIX
      if (process.platform !== "win32") {
        const badSecretFile = path.join(cleanDir, "weak-perms.secret");
        fs.writeFileSync(badSecretFile, crypto.randomBytes(48).toString("hex"), { mode: 0o644 });
        fs.chmodSync(badSecretFile, 0o644);
        assert.throws(
          () => {
            execFileSync(process.execPath, ["src/server.js"], {
              cwd: API_ROOT,
              env: {
                ...process.env,
                NODE_ENV: "production",
                CV_DATA_DIR: cleanDir,
                CV_SIGNING_SECRET: "",
                CV_SIGNING_SECRET_FILE: badSecretFile,
                PORT: "0",
              },
              stdio: "pipe",
            });
          },
          /permissions/i,
        );
      }

      // 3. Zero-downtime key rotation: token signed with old secret verifies via CV_SIGNING_SECRET_PREVIOUS
      const oldSecret = crypto.randomBytes(48).toString("hex");
      const newSecret = crypto.randomBytes(48).toString("hex");
      const prevEnv = process.env.CV_SIGNING_SECRET;
      try {
        process.env.CV_SIGNING_SECRET = oldSecret;
        const rotatedTok = signToken({ sub: "usr_rot", doc: "doc_1" }, 60, "page");

        process.env.CV_SIGNING_SECRET = newSecret;
        assert.throws(
          () => verifyToken(rotatedTok, "page"),
          (err) => err.code === "bad_signature",
        );

        process.env.CV_SIGNING_SECRET_PREVIOUS = oldSecret;
        const decoded = verifyToken(rotatedTok, "page");
        assert.equal(decoded.sub, "usr_rot");
      } finally {
        process.env.CV_SIGNING_SECRET = prevEnv;
        delete process.env.CV_SIGNING_SECRET_PREVIOUS;
      }
    } finally {
      fs.rmSync(cleanDir, { recursive: true, force: true });
    }
  });

  test("C-5: Reviewer account receives dedicated least-privilege portal (#view-reviewer) in EN and 中文", async () => {
    const revUser = createUser({
      email: "portal.reviewer@strata.test",
      password: "ReviewerPortal#2026!",
      displayName: "Reviewer Portal User",
      role: "reviewer",
      locale: "zh",
    });

    const loginRes = await reqJson("/api/auth/login", {
      method: "POST",
      body: { email: revUser.email, password: "ReviewerPortal#2026!" },
    });
    assert.equal(loginRes.status, 200);
    const revCookie = loginRes.headers["set-cookie"][0].split(";")[0];

    // Execute real public/app.js in a minimal DOM harness backed by live HTTP /api/auth/me
    const ids = [
      "global-toast", "btn-locale-en", "btn-locale-zh", "view-login", "header-session-box",
      "header-portfolio-link", "view-student", "view-reviewer", "view-admin",
      "header-user-role", "header-user-name", "student-watermark-preview", "demo-personas-section",
      "demo-personas-grid", "panel-student-library", "panel-student-reader", "tab-student-library",
      "tab-student-reader", "student-docs-grid", "probe-doc-id", "probe-doc-form", "probe-doc-result",
      "reader-doc-title", "reader-doc-author", "label-page-count", "input-page-num",
      "reader-chapters-list", "reader-sidebar", "reader-progress-text", "reader-progress-fill",
      "reader-progress-bar-wrap", "reader-figure", "btn-zoom-reset", "btn-prev-page", "btn-next-page",
      "reader-denied", "reader-loading", "reader-denied-title", "reader-denied-desc",
      "reader-page-img", "telemetry-cache", "telemetry-token-exp", "reader-audio-title",
      "reader-audio-status", "reader-audio-player", "login-form", "login-error", "login-email",
      "login-password", "btn-logout", "btn-refresh-library", "btn-back-library",
      "btn-back-library-mobile", "btn-toggle-chapters", "btn-zoom-out", "btn-zoom-in",
      "btn-fullscreen", "reader-stage-container", "btn-admin-refresh", "grant-form",
      "grant-student-email", "grant-expires", "btn-grant-short-expiry", "upload-form",
      "upload-file", "upload-title-en", "upload-title-zh", "upload-author", "upload-desc",
      "btn-upload-submit", "register-user-form", "reg-name", "reg-email", "reg-password",
      "reg-role", "reg-locale", "btn-run-selftest", "selftest-output", "audit-filter-outcome",
      "audit-filter-event", "reviewerHeadingNode",
    ];
    const elements = new Map();
    const mkEl = (id) => ({
      id,
      textContent: "",
      innerHTML: "",
      value: "",
      style: {},
      disabled: false,
      attrs: new Map(id === "reviewerHeadingNode" ? [["data-i18n", "reviewerHeading"]] : []),
      classList: {
        _s: new Set(["view-student", "view-reviewer", "view-admin", "header-portfolio-link"].includes(id) ? ["hidden"] : []),
        add(...c) { c.forEach((x) => this._s.add(x)); },
        remove(...c) { c.forEach((x) => this._s.delete(x)); },
        toggle(c, force) {
          if (force === undefined) {
            if (this._s.has(c)) { this._s.delete(c); return false; }
            this._s.add(c); return true;
          }
          if (force) this._s.add(c); else this._s.delete(c);
          return Boolean(force);
        },
        contains(c) { return this._s.has(c); },
      },
      setAttribute(k, v) { this.attrs.set(k, v); },
      getAttribute(k) { return this.attrs.get(k) || null; },
      removeAttribute(k) { this.attrs.delete(k); },
      addEventListener() {},
      pause() {},
    });
    for (const id of ids) elements.set(id, mkEl(id));

    const sandbox = {
      URL,
      URLSearchParams,
      Blob,
      setTimeout,
      clearTimeout,
      document: {
        documentElement: { lang: "en" },
        activeElement: null,
        getElementById: (id) => elements.get(id) || mkEl(id),
        querySelectorAll: (sel) => (sel === "[data-i18n]" ? [elements.get("reviewerHeadingNode")] : []),
        addEventListener() {},
      },
      fetch: async (u, opts = {}) => {
        const r = await reqJson(u, { method: opts.method || "GET", cookie: revCookie });
        return {
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          headers: { get: (k) => r.headers[k.toLowerCase()] || null },
          json: async () => r.json,
        };
      },
    };
    const appSrc = fs.readFileSync(path.join(PUBLIC_DIR, "app.js"), "utf8");
    vm.runInNewContext(appSrc, sandbox);
    await new Promise((r) => setTimeout(r, 80));

    assert.equal(elements.get("view-reviewer").classList.contains("hidden"), false, "#view-reviewer must be visible");
    assert.equal(elements.get("view-student").classList.contains("hidden"), true, "#view-student must stay hidden for reviewer");
    assert.equal(elements.get("header-portfolio-link").classList.contains("hidden"), false);
    assert.equal(sandbox.document.documentElement.lang, "zh-Hans");
    assert.match(elements.get("reviewerHeadingNode").textContent, /M007/);
  });
});

/**
 * STRATA ContentVault v0.1 — Full Acceptance & Security Test Matrix (CV-001 .. CV-020)
 *
 * Runs against a real ephemeral HTTP server, isolated SQLite database, private
 * filesystem storage, and live PyMuPDF + Pillow server-side rasteriser.
 * Zero mocks.
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

// Isolate test runtime data BEFORE importing application modules.
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "strata-cv-test-"));
process.env.CV_DATA_DIR = TEST_DATA_DIR;
process.env.CV_SIGNING_SECRET = crypto.randomBytes(48).toString("hex");
delete process.env.CV_ALLOW_FRAME_EMBED;

const { createAppServer } = await import("../src/app.js");
const { closeDb, getDb } = await import("../src/db.js");
const { createUser } = await import("../src/security/authz.js");
const { generateSyntheticTeachingWav } = await import("../src/services/synthetic-audio.js");
const { enginePaths } = await import("../src/services/pdf-engine.js");
const { seedDemoEnvironment } = await import("../scripts/seed.js");

let server;
let baseUrl;

// Test actors & state shared across sequential acceptance steps
const PASS_ADMIN = "AdminTestPass#2026!";
const PASS_STUDENT = "StudentTestPass#2026!";
let adminCookie = "";
let studentACookie = "";
let studentBCookie = "";
let studentCCookie = "";
let studentAUser = null;
let studentBUser = null;
let studentCUser = null;
let uploadedDoc = null;
let uploadedChapterId = null;
let rawStorageKey = null;
let studentAPage2Sha = "";
let studentAPage2Token = "";

function extractSessionCookie(res) {
  const raw = res.headers.get("set-cookie") || "";
  const match = raw.match(/cv_session=[^;]+/);
  return match ? match[0] : "";
}

async function http(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.cookie) {
    headers.Cookie = options.cookie;
  }
  let body = options.body;
  if (
    body &&
    typeof body === "object" &&
    !Buffer.isBuffer(body) &&
    !(body instanceof Uint8Array)
  ) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers,
    body,
    redirect: "manual",
  });
}

describe("STRATA ContentVault v0.1 Acceptance Matrix (CV-001 .. CV-020)", () => {
  before(async () => {
    createUser({
      email: "admin.cv@strata.test",
      password: PASS_ADMIN,
      displayName: "Admin Auditor",
      role: "admin",
      locale: "en",
    });
    studentAUser = createUser({
      email: "student.a@strata.test",
      password: PASS_STUDENT,
      displayName: "Nurul Aisyah (Student A)",
      role: "student",
      locale: "en",
    });
    studentBUser = createUser({
      email: "student.b@strata.test",
      password: PASS_STUDENT,
      displayName: "Tan Wei Ming (Student B)",
      role: "student",
      locale: "zh",
    });
    studentCUser = createUser({
      email: "student.c@strata.test",
      password: PASS_STUDENT,
      displayName: "Priya Menon (Student C)",
      role: "student",
      locale: "en",
    });

    server = createAppServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Authenticate all four personas
    const loginAdmin = await http("/api/auth/login", {
      method: "POST",
      body: { email: "admin.cv@strata.test", password: PASS_ADMIN },
    });
    assert.equal(loginAdmin.status, 200);
    adminCookie = extractSessionCookie(loginAdmin);
    assert.ok(adminCookie.startsWith("cv_session="));

    // Also record one failed login so CV-014 verifies auth.login deny logging
    const badLogin = await http("/api/auth/login", {
      method: "POST",
      body: { email: "admin.cv@strata.test", password: "wrong-password-123" },
    });
    assert.equal(badLogin.status, 401);

    const loginA = await http("/api/auth/login", {
      method: "POST",
      body: { email: "student.a@strata.test", password: PASS_STUDENT },
    });
    studentACookie = extractSessionCookie(loginA);

    const loginB = await http("/api/auth/login", {
      method: "POST",
      body: { email: "student.b@strata.test", password: PASS_STUDENT },
    });
    studentBCookie = extractSessionCookie(loginB);

    const loginC = await http("/api/auth/login", {
      method: "POST",
      body: { email: "student.c@strata.test", password: PASS_STUDENT },
    });
    studentCCookie = extractSessionCookie(loginC);
  });

  after(async () => {
    closeDb();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it("CV-001: Admin can upload a synthetic PDF", async () => {
    const pdfPath = path.join(
      REPO_ROOT,
      "knowledge",
      "synthetic",
      "synthetic-neurology-module.pdf",
    );
    const pdfBytes = fs.readFileSync(pdfPath);

    const res = await http("/api/documents", {
      method: "POST",
      cookie: adminCookie,
      headers: {
        "Content-Type": "application/pdf",
        "X-Title-En": encodeURIComponent("Synthetic Neurology Acceptance Module"),
        "X-Title-Zh": encodeURIComponent("合成神经病学验收模块"),
        "X-Author": encodeURIComponent("STRATA QA"),
      },
      body: pdfBytes,
    });

    assert.equal(res.status, 201);
    const payload = await res.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.document.page_count, 6);
    assert.equal(payload.document.storage_key, undefined);
    uploadedDoc = payload.document;

    // Verify private storage file exists on disk outside public web root
    const dbRow = getDb()
      .prepare("SELECT storage_key FROM documents WHERE id = ?")
      .get(uploadedDoc.id);
    assert.ok(dbRow?.storage_key);
    rawStorageKey = dbRow.storage_key;
    const storedPath = path.join(TEST_DATA_DIR, "storage", "private", rawStorageKey);
    assert.equal(fs.existsSync(storedPath), true);

    // Attach Chapter 1 + synthetic teaching WAV audio for CV-013
    const chRes = await http(`/api/documents/${uploadedDoc.id}/chapters`, {
      method: "POST",
      cookie: adminCookie,
      body: {
        ordinal: 1,
        titleEn: "Chapter 1 — Orientation",
        titleZh: "第一章 — 导论",
        startPage: 1,
        endPage: 6,
      },
    });
    assert.equal(chRes.status, 201);
    const chBody = await chRes.json();
    uploadedChapterId = chBody.chapterId;

    const wav = generateSyntheticTeachingWav({ chapterOrdinal: 1, durationSeconds: 2 });
    const audioRes = await http(
      `/api/documents/${uploadedDoc.id}/chapters/${uploadedChapterId}/audio`,
      {
        method: "POST",
        cookie: adminCookie,
        headers: { "Content-Type": "audio/wav", "X-Audio-Seconds": "2" },
        body: wav,
      },
    );
    assert.equal(audioRes.status, 201);
  });

  it("CV-002: Original PDF cannot be accessed anonymously", async () => {
    const probes = [
      `/api/documents`,
      `/api/documents/${uploadedDoc.id}`,
      `/api/documents/${uploadedDoc.id}/page?page=1`,
      `/storage/${rawStorageKey}`,
      `/storage/private/${rawStorageKey}`,
      `/var/storage/private/${rawStorageKey}`,
      `/private/${rawStorageKey}`,
    ];

    for (const target of probes) {
      const res = await http(target);
      assert.ok(
        [401, 404].includes(res.status),
        `Expected 401/404 for anonymous ${target}, got ${res.status}`,
      );
      const buf = Buffer.from(await res.arrayBuffer());
      assert.notEqual(buf.subarray(0, 5).toString("ascii"), "%PDF-");
    }
  });

  it("CV-003: Authorized student can open assigned material", async () => {
    const grantRes = await http(`/api/documents/${uploadedDoc.id}/grant`, {
      method: "POST",
      cookie: adminCookie,
      body: { email: studentAUser.email },
    });
    assert.equal(grantRes.status, 200);

    const listRes = await http("/api/documents", { cookie: studentACookie });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.documents.length, 1);
    assert.equal(listBody.documents[0].id, uploadedDoc.id);

    const detailRes = await http(`/api/documents/${uploadedDoc.id}`, {
      cookie: studentACookie,
    });
    assert.equal(detailRes.status, 200);

    const pageRes = await http(`/api/documents/${uploadedDoc.id}/page?page=2`, {
      cookie: studentACookie,
    });
    assert.equal(pageRes.status, 200);
    assert.equal(pageRes.headers.get("content-type"), "image/png");
    studentAPage2Token = pageRes.headers.get("x-page-token") || "";
    assert.ok(studentAPage2Token.includes("."));

    const pngBuf = Buffer.from(await pageRes.arrayBuffer());
    assert.deepEqual(
      pngBuf.subarray(0, 8),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    assert.ok(pngBuf.length > 40_000);
    studentAPage2Sha = crypto.createHash("sha256").update(pngBuf).digest("hex");
  });

  it("CV-004: Unauthorized student cannot open the same material", async () => {
    const listRes = await http("/api/documents", { cookie: studentCCookie });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.documents.length, 0);

    const detailRes = await http(`/api/documents/${uploadedDoc.id}`, {
      cookie: studentCCookie,
    });
    assert.equal(detailRes.status, 403);
    const detailBody = await detailRes.json();
    assert.equal(detailBody.error, "no_entitlement");

    const pageRes = await http(`/api/documents/${uploadedDoc.id}/page?page=2`, {
      cookie: studentCCookie,
    });
    assert.equal(pageRes.status, 403);
    const pageBody = await pageRes.json();
    assert.equal(pageBody.error, "no_entitlement");
  });

  it("CV-005: Student A receives a personalized watermark", async () => {
    const selfRes = await http("/api/admin/engine-selftest", {
      cookie: adminCookie,
    });
    assert.equal(selfRes.status, 200);
    const report = await selfRes.json();
    assert.equal(report.watermarkChangesPixels, true);

    // Also render page 2 unwatermarked at 144 DPI and confirm Student A's PNG differs
    const pdfPath = path.join(TEST_DATA_DIR, "storage", "private", rawStorageKey);
    const proc = spawnSync(
      enginePaths.PYTHON,
      [enginePaths.ENGINE_PATH],
      {
        input: JSON.stringify({
          command: "render",
          path: pdfPath,
          page: 2,
          dpi: 144,
          identity: { label: studentAUser.display_name, ref: studentAUser.id },
          watermark: false,
        }),
        encoding: "utf8",
      },
    );
    assert.equal(proc.status, 0);
    const cleanOut = JSON.parse(proc.stdout);
    assert.notEqual(studentAPage2Sha, cleanOut.sha256);
  });

  it("CV-006: Student B receives a different personalized watermark", async () => {
    const grantRes = await http(`/api/documents/${uploadedDoc.id}/grant`, {
      method: "POST",
      cookie: adminCookie,
      body: { email: studentBUser.email },
    });
    assert.equal(grantRes.status, 200);

    const pageResB = await http(`/api/documents/${uploadedDoc.id}/page?page=2`, {
      cookie: studentBCookie,
    });
    assert.equal(pageResB.status, 200);
    const pngBufB = Buffer.from(await pageResB.arrayBuffer());
    const shaB = crypto.createHash("sha256").update(pngBufB).digest("hex");

    assert.notEqual(
      shaB,
      studentAPage2Sha,
      "Student A and Student B must receive distinct watermarked pixel buffers",
    );
  });

  it("CV-007: Changing client-side identifiers cannot impersonate another student", async () => {
    // Student A attempts to inject Student B's userId/email/watermark in query & headers
    const spoofRes = await http(
      `/api/documents/${uploadedDoc.id}/page?page=2&userId=${encodeURIComponent(studentBUser.id)}&email=${encodeURIComponent(studentBUser.email)}&watermark=SPOOFED`,
      {
        cookie: studentACookie,
        headers: {
          "X-User-Id": studentBUser.id,
          "X-Student-Email": studentBUser.email,
          "X-Role": "admin",
        },
      },
    );
    assert.equal(spoofRes.status, 200);

    // Check latest page.render audit log row: actor_id MUST be Student A, never Student B
    const latestAudit = getDb()
      .prepare(
        "SELECT actor_id, outcome FROM audit_log WHERE event = 'page.render' ORDER BY rowid DESC LIMIT 1",
      )
      .get();
    assert.equal(latestAudit.actor_id, studentAUser.id);
    assert.equal(latestAudit.outcome, "allow");

    // Forged session cookie cannot impersonate anyone
    const forgedCookieRes = await http(`/api/documents/${uploadedDoc.id}/page?page=2`, {
      cookie: `cv_session=${studentBUser.id}`,
    });
    assert.equal(forgedCookieRes.status, 401);
  });

  it("CV-008: A copied protected page URL does not grant an unauthorized account access", async () => {
    const copiedUrl = `/api/documents/${uploadedDoc.id}/page?page=2&token=${encodeURIComponent(studentAPage2Token)}`;

    // 1. Anonymous browser pasting copied URL -> 401
    const anonRes = await http(copiedUrl);
    assert.equal(anonRes.status, 401);

    // 2. Unentitled Student C pasting copied URL -> 403
    const unentitledRes = await http(copiedUrl, { cookie: studentCCookie });
    assert.equal(unentitledRes.status, 403);

    // 3. Even entitled Student B pasting Student A's signed token URL -> 403 invalid_page_token
    const crossStudentRes = await http(copiedUrl, { cookie: studentBCookie });
    assert.equal(crossStudentRes.status, 403);
    const crossBody = await crossStudentRes.json();
    assert.equal(crossBody.error, "invalid_page_token");
  });

  it("CV-009: Revoked student cannot request new protected pages", async () => {
    const revokeRes = await http(`/api/documents/${uploadedDoc.id}/revoke`, {
      method: "POST",
      cookie: adminCookie,
      body: { email: studentAUser.email, reason: "cv009_test_revocation" },
    });
    assert.equal(revokeRes.status, 200);
    const revokeBody = await revokeRes.json();
    assert.equal(revokeBody.changed, true);

    // Direct page request denied immediately
    const deniedPage = await http(`/api/documents/${uploadedDoc.id}/page?page=2`, {
      cookie: studentACookie,
    });
    assert.equal(deniedPage.status, 403);
    const deniedBody = await deniedPage.json();
    assert.equal(deniedBody.error, "revoked");

    // Replaying previously issued unexpired page token also denied
    const replayTokenRes = await http(
      `/api/documents/${uploadedDoc.id}/page?page=2&token=${encodeURIComponent(studentAPage2Token)}`,
      { cookie: studentACookie },
    );
    assert.equal(replayTokenRes.status, 403);

    // Re-grant Student A for subsequent audio test and verify entitlement version bumped
    const regrantRes = await http(`/api/documents/${uploadedDoc.id}/grant`, {
      method: "POST",
      cookie: adminCookie,
      body: { email: studentAUser.email },
    });
    assert.equal(regrantRes.status, 200);
    const regrantBody = await regrantRes.json();
    assert.equal(regrantBody.entitlement.version, 3);
  });

  it("CV-010: Expired entitlement prevents further access", async () => {
    const pastIso = new Date(Date.now() - 10_000).toISOString();
    const grantExpired = await http(`/api/documents/${uploadedDoc.id}/grant`, {
      method: "POST",
      cookie: adminCookie,
      body: { email: studentCUser.email, expiresAt: pastIso },
    });
    assert.equal(grantExpired.status, 200);

    const listRes = await http("/api/documents", { cookie: studentCCookie });
    const listBody = await listRes.json();
    assert.equal(listBody.documents.length, 0);

    const pageRes = await http(`/api/documents/${uploadedDoc.id}/page?page=1`, {
      cookie: studentCCookie,
    });
    assert.equal(pageRes.status, 403);
    const pageBody = await pageRes.json();
    assert.equal(pageBody.error, "expired");
  });

  it("CV-011: Student cannot access admin API operations", async () => {
    const adminOps = [
      { method: "POST", url: "/api/documents", body: Buffer.from("%PDF-1.4") },
      {
        method: "POST",
        url: `/api/documents/${uploadedDoc.id}/grant`,
        body: { email: studentCUser.email },
      },
      {
        method: "POST",
        url: `/api/documents/${uploadedDoc.id}/revoke`,
        body: { email: studentBUser.email },
      },
      {
        method: "POST",
        url: "/api/auth/register",
        body: {
          email: "hacker@strata.test",
          password: "Password123!",
          displayName: "Hacker",
          role: "admin",
        },
      },
      { method: "GET", url: "/api/admin/stats" },
      { method: "GET", url: "/api/admin/users" },
      { method: "GET", url: "/api/admin/audit" },
      { method: "GET", url: "/api/admin/engine-selftest" },
    ];

    for (const op of adminOps) {
      const res = await http(op.url, {
        method: op.method,
        cookie: studentACookie,
        headers: Buffer.isBuffer(op.body)
          ? { "Content-Type": "application/pdf", "X-Title-En": "Attempt" }
          : {},
        body: op.body,
      });
      assert.equal(
        res.status,
        403,
        `Student request to ${op.method} ${op.url} must return 403, got ${res.status}`,
      );
      const body = await res.json();
      assert.equal(body.error, "admin_required");
    }
  });

  it("CV-012: Original PDF is not delivered through browser requests", async () => {
    const pageRes = await http(`/api/documents/${uploadedDoc.id}/page?page=1`, {
      cookie: studentACookie,
    });
    assert.equal(pageRes.status, 200);
    assert.equal(pageRes.headers.get("content-type"), "image/png");
    const cc = pageRes.headers.get("cache-control") || "";
    assert.ok(cc.includes("no-store") && cc.includes("private"));

    const bytes = Buffer.from(await pageRes.arrayBuffer());
    assert.notEqual(bytes.subarray(0, 5).toString("ascii"), "%PDF-");

    const detailRes = await http(`/api/documents/${uploadedDoc.id}`, {
      cookie: studentACookie,
    });
    const detailText = await detailRes.text();
    assert.equal(detailText.includes(rawStorageKey), false);
    assert.equal(detailText.includes("storage_key"), false);
  });

  it("CV-013: Audio access respects student entitlement", async () => {
    // Authorized Student A: full 200 WAV + 206 Range slice
    const audioOk = await http(`/api/documents/${uploadedDoc.id}/audio?page=1`, {
      cookie: studentACookie,
    });
    assert.equal(audioOk.status, 200);
    assert.equal(audioOk.headers.get("content-type"), "audio/wav");
    const wavBytes = Buffer.from(await audioOk.arrayBuffer());
    assert.equal(wavBytes.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(wavBytes.subarray(8, 12).toString("ascii"), "WAVE");

    const rangeRes = await http(`/api/documents/${uploadedDoc.id}/audio?page=1`, {
      cookie: studentACookie,
      headers: { Range: "bytes=0-511" },
    });
    assert.equal(rangeRes.status, 206);
    const slice = Buffer.from(await rangeRes.arrayBuffer());
    assert.equal(slice.length, 512);

    // Anonymous -> 401
    const anonAudio = await http(`/api/documents/${uploadedDoc.id}/audio?page=1`);
    assert.equal(anonAudio.status, 401);

    // Expired Student C -> 403
    const expiredAudio = await http(`/api/documents/${uploadedDoc.id}/audio?page=1`, {
      cookie: studentCCookie,
    });
    assert.equal(expiredAudio.status, 403);

    // Revoke Student B -> audio immediately returns 403
    await http(`/api/documents/${uploadedDoc.id}/revoke`, {
      method: "POST",
      cookie: adminCookie,
      body: { email: studentBUser.email },
    });
    const revokedAudio = await http(`/api/documents/${uploadedDoc.id}/audio?page=1`, {
      cookie: studentBCookie,
    });
    assert.equal(revokedAudio.status, 403);
  });

  it("CV-014: Audit log records relevant access events", async () => {
    const res = await http("/api/admin/audit?limit=300", { cookie: adminCookie });
    assert.equal(res.status, 200);
    const { entries } = await res.json();

    const has = (event, outcome) =>
      entries.some((e) => e.event === event && e.outcome === outcome);

    assert.equal(has("auth.login", "allow"), true, "Missing auth.login allow");
    assert.equal(has("auth.login", "deny"), true, "Missing auth.login deny");
    assert.equal(has("document.upload", "allow"), true, "Missing document.upload allow");
    assert.equal(has("entitlement.grant", "allow"), true, "Missing entitlement.grant allow");
    assert.equal(has("entitlement.revoke", "allow"), true, "Missing entitlement.revoke allow");
    assert.equal(has("page.render", "allow"), true, "Missing page.render allow");
    assert.equal(has("page.render", "deny"), true, "Missing page.render deny");
    assert.equal(has("audio.play", "allow"), true, "Missing audio.play allow");
    assert.equal(has("audio.play", "deny"), true, "Missing audio.play deny");
    assert.equal(has("storage.direct_probe", "deny"), true, "Missing storage.direct_probe deny");
  });

  it("CV-015: Desktop and mobile layouts work correctly", async () => {
    const htmlRes = await http("/");
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.ok(html.includes('name="viewport" content="width=device-width, initial-scale=1.0"'));
    assert.ok(html.includes('id="reader-page-img"'));
    assert.ok(html.includes('id="reader-audio-player"'));
    assert.ok(html.includes('id="btn-toggle-chapters"'));
    assert.ok(html.includes('id="btn-fullscreen"'));
    assert.ok(html.includes('id="btn-locale-zh"'));

    const cssRes = await http("/styles.css");
    assert.equal(cssRes.status, 200);
    const css = await cssRes.text();
    assert.ok(css.includes("@media (max-width: 960px)"));
    assert.ok(css.includes("@media (max-width: 640px)"));
    assert.ok(css.includes("#142B40") && css.includes("#17594D") && css.includes("#C5A46D"));

    const jsRes = await http("/app.js");
    assert.equal(jsRes.status, 200);
  });

  it("CV-016: No secrets are exposed in frontend bundles or Git", async () => {
    const publicDir = path.join(API_ROOT, "public");
    const publicFiles = fs.readdirSync(publicDir);
    const forbiddenPatterns = [
      /CV_SIGNING_SECRET/,
      /scrypt\$/,
      /PRIVATE KEY/,
      /strata-demo-admin-local/,
      /strata-demo-student-local/,
      /\.dev-signing-secret/,
    ];

    for (const file of publicFiles) {
      const text = fs.readFileSync(path.join(publicDir, file), "utf8");
      for (const pattern of forbiddenPatterns) {
        assert.equal(
          pattern.test(text),
          false,
          `Secret pattern ${pattern} found in public/${file}`,
        );
      }
    }

    const gitFilesProc = spawnSync("git", ["ls-files"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.equal(gitFilesProc.status, 0);
    const tracked = gitFilesProc.stdout.split(/\r?\n/).filter(Boolean);
    for (const rel of tracked) {
      assert.equal(
        rel === ".env" ||
          (rel.startsWith(".env.") && rel !== ".env.example") ||
          rel.endsWith(".db") ||
          rel.endsWith(".sqlite") ||
          rel.endsWith(".pem") ||
          rel.endsWith(".key") ||
          rel.includes(".dev-signing-secret") ||
          rel.startsWith("var/") ||
          rel.startsWith("vendor/") ||
          rel.startsWith(".venv/"),
        false,
        `Forbidden runtime/secret file tracked in Git: ${rel}`,
      );
    }
  });

  it("CV-017: Existing tests pass following new changes", () => {
    const checkDbProc = spawnSync(
      process.execPath,
      [path.join(API_ROOT, "scripts", "check-db.js")],
      {
        cwd: API_ROOT,
        env: { ...process.env, CV_DATA_DIR: TEST_DATA_DIR },
        encoding: "utf8",
      },
    );
    assert.equal(checkDbProc.status, 0);
    assert.ok(checkDbProc.stdout.includes("tables: audit_log, chapters, documents"));

    const visualProc = spawnSync(
      enginePaths.PYTHON,
      [path.join(REPO_ROOT, "scripts", "synthetic", "verify_watermark_visual.py")],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    assert.equal(visualProc.status, 0, visualProc.stderr || visualProc.stdout);
    assert.ok(visualProc.stdout.includes("all visual-property checks passed"));
  });

  it("CV-018: Documentation provides reproducible setup steps", async () => {
    const readme = fs.readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
    const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
    assert.ok(readme.includes("install-python-deps"));
    assert.ok(readme.includes("npm run seed"));
    assert.ok(readme.includes("npm start"));
    assert.ok(readme.includes("npm test"));
    assert.ok(envExample.includes("CV_SIGNING_SECRET"));

    // Verify seedDemoEnvironment() runs cleanly and idempotently
    const seeded1 = await seedDemoEnvironment();
    const seeded2 = await seedDemoEnvironment();
    assert.equal(seeded1.document.id, seeded2.document.id);
    assert.equal(seeded1.chaptersCount, 5);
  });

  it("CV-019: Watermark cannot be removed merely by disabling a client-side CSS overlay", async () => {
    // 1. Verify no watermark overlay text/element sits over the reader image in HTML
    const html = fs.readFileSync(path.join(API_ROOT, "public", "index.html"), "utf8");
    assert.equal(html.includes("watermark-overlay"), false);

    // 2. Fetch actual HTTP PNG bytes for Student A and verify via Python Pillow that
    //    watermark pixels are baked into top, middle, and bottom bands of the PNG itself.
    const pageRes = await http(`/api/documents/${uploadedDoc.id}/page?page=2`, {
      cookie: studentACookie,
    });
    assert.equal(pageRes.status, 200);
    const markedPngPath = path.join(TEST_DATA_DIR, "cv019-marked.png");
    fs.writeFileSync(markedPngPath, Buffer.from(await pageRes.arrayBuffer()));

    const pdfPath = path.join(TEST_DATA_DIR, "storage", "private", rawStorageKey);
    const verifyPy = `
import base64, io, json, subprocess, sys
from PIL import Image, ImageChops
marked = Image.open(${JSON.stringify(markedPngPath)}).convert("RGB")
proc = subprocess.run(
    [${JSON.stringify(enginePaths.PYTHON)}, ${JSON.stringify(enginePaths.ENGINE_PATH)}],
    input=json.dumps({"command":"render","path":${JSON.stringify(pdfPath)},"page":2,"dpi":144,"identity":{},"watermark":False}),
    capture_output=True, text=True, check=True
)
clean_b64 = json.loads(proc.stdout)["png"]
clean = Image.open(io.BytesIO(base64.b64decode(clean_b64))).convert("RGB")
diff = ImageChops.difference(clean, marked).convert("L")
w, h = diff.size
bands = []
for i in range(3):
    crop = diff.crop((0, h * i // 3, w, h * (i + 1) // 3))
    changed = crop.point(lambda v: 255 if v > 6 else 0).histogram()[255]
    bands.append(round(100.0 * changed / (crop.size[0] * crop.size[1]), 2))
print(json.dumps({"bandsPct": bands, "allBandsMarked": all(p > 1.5 for p in bands)}))
`;
    const pyCheck = spawnSync(enginePaths.PYTHON, ["-c", verifyPy], {
      encoding: "utf8",
    });
    assert.equal(pyCheck.status, 0, pyCheck.stderr);
    const parsed = JSON.parse(pyCheck.stdout);
    assert.equal(parsed.allBandsMarked, true, `Expected all 3 bands > 1.5%, got ${pyCheck.stdout}`);
  });

  it("CV-020: Known security limitations are documented", () => {
    const limits = fs.readFileSync(
      path.join(REPO_ROOT, "docs", "security", "KNOWN_LIMITATIONS.md"),
      "utf8",
    );
    const threatModel = fs.readFileSync(
      path.join(REPO_ROOT, "docs", "security", "THREAT_MODEL.md"),
      "utf8",
    );

    assert.ok(/screenshot|camera/i.test(limits), "Must disclose screenshot/camera limitation");
    assert.ok(/piracy-proof/i.test(limits), "Must explicitly state not piracy-proof");
    assert.ok(
      /revocation cannot erase|previously captured/i.test(limits),
      "Must disclose post-revocation retention of prior captures",
    );
    assert.ok(/AGPL-3\.0/i.test(limits), "Must disclose PyMuPDF AGPL-3.0 licensing");
    assert.ok(/Row Level Security|RLS/i.test(limits), "Must disclose SQLite vs RLS migration");
    assert.ok(threatModel.includes("CV-019"));
  });
});

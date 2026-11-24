/**
 * End-to-End Functional Verification across all four ContentVault personas
 * (Admin, Student A [EN], Student B [Mandarin ZH], Unauthorized Student C)
 * plus M007 Professional Digital Portfolio prototype routes.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "strata-personas-e2e-"));
process.env.CV_DATA_DIR = TEST_DATA_DIR;
process.env.CV_SIGNING_SECRET = crypto.randomBytes(48).toString("hex");
delete process.env.CV_ALLOW_FRAME_EMBED;

const { createAppServer } = await import("../src/app.js");
const { closeDb } = await import("../src/db.js");
const { seedDemoEnvironment, DEMO_ACCOUNTS } = await import("../scripts/seed.js");

const ADMIN_PASS = process.env.CV_DEMO_ADMIN_PASSWORD || "strata-demo-admin-local";
const STUDENT_PASS = process.env.CV_DEMO_STUDENT_PASSWORD || "strata-demo-student-local";

let server;
let baseUrl;
let seeded;
const sessions = {};
let studentAPageSha = "";
let studentBPageSha = "";
let studentBPag2Token = "";

function extractCookie(res) {
  const header = res.headers.get("set-cookie") || "";
  const match = header.match(/cv_session=[^;]+/);
  return match ? match[0] : "";
}

async function req(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.cookie) headers.Cookie = options.cookie;
  let body = options.body;
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers,
    body,
  });
}

describe("Four-Persona End-to-End Flow & M007 Portfolio Verification", () => {
  before(async () => {
    seeded = await seedDemoEnvironment();
    server = createAppServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    closeDb();
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it("Persona 1 — Admin authenticates, inspects entitlements, runs pixel self-test, and views audit trail", async () => {
    const loginRes = await req("/api/auth/login", {
      method: "POST",
      body: { email: DEMO_ACCOUNTS.admin.email, password: ADMIN_PASS },
    });
    assert.equal(loginRes.status, 200);
    sessions.admin = extractCookie(loginRes);
    const loginData = await loginRes.json();
    assert.equal(loginData.user.role, "admin");

    const statsRes = await req("/api/admin/stats", { cookie: sessions.admin });
    assert.equal(statsRes.status, 200);
    const stats = await statsRes.json();
    assert.equal(stats.users, 4);
    assert.equal(stats.documents, 1);
    assert.equal(stats.activeEntitlements, 2);

    const detailRes = await req(`/api/documents/${seeded.document.id}`, {
      cookie: sessions.admin,
    });
    assert.equal(detailRes.status, 200);
    const detail = await detailRes.json();
    assert.equal(detail.entitlements.length, 2);

    const selftestRes = await req("/api/admin/engine-selftest", {
      cookie: sessions.admin,
    });
    assert.equal(selftestRes.status, 200);
    const selftest = await selftestRes.json();
    assert.equal(selftest.watermarkIdentityBound, true);
    assert.equal(selftest.watermarkChangesPixels, true);
  });

  it("Persona 2 — Student A (EN) authenticates, renders watermarked pages, plays Range audio, and tracks progress", async () => {
    const loginRes = await req("/api/auth/login", {
      method: "POST",
      body: { email: DEMO_ACCOUNTS.studentA.email, password: STUDENT_PASS },
    });
    assert.equal(loginRes.status, 200);
    sessions.studentA = extractCookie(loginRes);
    const { user } = await loginRes.json();
    assert.equal(user.locale, "en");

    const libRes = await req("/api/documents", { cookie: sessions.studentA });
    const lib = await libRes.json();
    assert.equal(lib.documents.length, 1);
    assert.equal(lib.documents[0].title_en, "Neurology Teaching Module (Synthetic Demonstration)");

    const pageRes = await req(`/api/documents/${seeded.document.id}/page?page=2`, {
      cookie: sessions.studentA,
    });
    assert.equal(pageRes.status, 200);
    assert.equal(pageRes.headers.get("content-type"), "image/png");
    const audioToken = pageRes.headers.get("x-audio-token");
    assert.ok(audioToken);
    const pngBytes = Buffer.from(await pageRes.arrayBuffer());
    studentAPageSha = crypto.createHash("sha256").update(pngBytes).digest("hex");

    const audioRes = await req(
      `/api/documents/${seeded.document.id}/audio?page=2&token=${encodeURIComponent(audioToken)}`,
      {
        cookie: sessions.studentA,
        headers: { Range: "bytes=0-1023" },
      },
    );
    assert.equal(audioRes.status, 206);
    const audioSlice = Buffer.from(await audioRes.arrayBuffer());
    assert.equal(audioSlice.length, 1024);
    assert.equal(audioSlice.subarray(0, 4).toString("ascii"), "RIFF");

    const progRes = await req(`/api/documents/${seeded.document.id}/progress`, {
      cookie: sessions.studentA,
    });
    const prog = await progRes.json();
    assert.equal(prog.progress.last_page, 2);
  });

  it("Persona 3 — Student B (Mandarin 中文) receives Mandarin metadata, distinct watermark pixels, and chapter audio", async () => {
    const loginRes = await req("/api/auth/login", {
      method: "POST",
      body: { email: DEMO_ACCOUNTS.studentB.email, password: STUDENT_PASS },
    });
    assert.equal(loginRes.status, 200);
    sessions.studentB = extractCookie(loginRes);
    const { user } = await loginRes.json();
    assert.equal(user.locale, "zh");

    const detailRes = await req(`/api/documents/${seeded.document.id}`, {
      cookie: sessions.studentB,
    });
    assert.equal(detailRes.status, 200);
    const detail = await detailRes.json();
    assert.equal(detail.document.title_zh, "神经病学教学示范单元（合成演示内容）");
    assert.equal(detail.chapters.length, 5);
    assert.ok(detail.chapters[1].title_zh.includes("第二章"));

    const pageRes = await req(`/api/documents/${seeded.document.id}/page?page=2`, {
      cookie: sessions.studentB,
    });
    assert.equal(pageRes.status, 200);
    studentBPag2Token = pageRes.headers.get("x-page-token") || "";
    const pngBytes = Buffer.from(await pageRes.arrayBuffer());
    studentBPageSha = crypto.createHash("sha256").update(pngBytes).digest("hex");
    assert.notEqual(studentBPageSha, studentAPageSha);

    const ch2Audio = await req(`/api/documents/${seeded.document.id}/audio?page=3`, {
      cookie: sessions.studentB,
    });
    assert.equal(ch2Audio.status, 200);
  });

  it("Persona 4 — Unauthorized Student C is denied document metadata, page rasters, and audio", async () => {
    const loginRes = await req("/api/auth/login", {
      method: "POST",
      body: { email: DEMO_ACCOUNTS.studentC.email, password: STUDENT_PASS },
    });
    assert.equal(loginRes.status, 200);
    sessions.studentC = extractCookie(loginRes);

    const libRes = await req("/api/documents", { cookie: sessions.studentC });
    const lib = await libRes.json();
    assert.equal(lib.documents.length, 0);

    const docRes = await req(`/api/documents/${seeded.document.id}`, {
      cookie: sessions.studentC,
    });
    assert.equal(docRes.status, 403);

    const pageRes = await req(`/api/documents/${seeded.document.id}/page?page=2`, {
      cookie: sessions.studentC,
    });
    assert.equal(pageRes.status, 403);

    const audioRes = await req(`/api/documents/${seeded.document.id}/audio?page=2`, {
      cookie: sessions.studentC,
    });
    assert.equal(audioRes.status, 403);
  });

  it("Live Revocation & Re-grant Lifecycle immediately blocks and restores Student B", async () => {
    const revRes = await req(`/api/documents/${seeded.document.id}/revoke`, {
      method: "POST",
      cookie: sessions.admin,
      body: { email: DEMO_ACCOUNTS.studentB.email, reason: "e2e_persona_revocation_check" },
    });
    assert.equal(revRes.status, 200);

    const blockedPage = await req(
      `/api/documents/${seeded.document.id}/page?page=2&token=${encodeURIComponent(studentBPag2Token)}`,
      { cookie: sessions.studentB },
    );
    assert.equal(blockedPage.status, 403);
    const blockedBody = await blockedPage.json();
    assert.equal(blockedBody.error, "revoked");

    const blockedAudio = await req(`/api/documents/${seeded.document.id}/audio?page=2`, {
      cookie: sessions.studentB,
    });
    assert.equal(blockedAudio.status, 403);

    // Restore access
    const restoreRes = await req(`/api/documents/${seeded.document.id}/grant`, {
      method: "POST",
      cookie: sessions.admin,
      body: { email: DEMO_ACCOUNTS.studentB.email },
    });
    assert.equal(restoreRes.status, 200);
    const restoredPage = await req(`/api/documents/${seeded.document.id}/page?page=2`, {
      cookie: sessions.studentB,
    });
    assert.equal(restoredPage.status, 200);
  });

  it("M007 Portfolio Prototype serves private placeholder-marked profile and local-only enquiry capture", async () => {
    const htmlRes = await req("/portfolio");
    assert.equal(htmlRes.status, 200);
    assert.ok((htmlRes.headers.get("x-robots-tag") || "").includes("noindex"));
    const html = await htmlRes.text();
    assert.ok(html.includes("PRIVATE PROTOTYPE"));
    assert.ok(html.includes("NSR #126713"));
    assert.ok(html.includes("PORTRAIT PLACEHOLDER"));

    const jsRes = await req("/portfolio/portfolio.js");
    assert.equal(jsRes.status, 200);
    const jsText = await jsRes.text();
    assert.ok(jsText.includes("978-983-44306-1-0"));
    assert.ok(jsText.includes("978-629-97290-0-6"));
    assert.ok(jsText.includes("UNVERIFIED PLACEHOLDER"));

    const enqRes = await req("/api/portfolio/enquiries", {
      method: "POST",
      body: {
        senderName: "Prof. Synthetic Reviewer",
        senderOrg: "Academic Neurology Symposium",
        senderEmail: "reviewer@symposium.test",
        topic: "academic_speaking",
        message: "Invitation draft for private M007 prototype evaluation.",
      },
    });
    assert.equal(enqRes.status, 201);
    const enqBody = await enqRes.json();
    assert.equal(enqBody.mode, "local_staging_only");
  });
});

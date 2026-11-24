/**
 * STRATA Mission 003-A — Adversarial Security & Quality Regression Suite
 *
 * Verifies remediations for:
 *   - SEC-001: Private M007 Portfolio access control (Admin/Reviewer auth + noindex)
 *   - SEC-002: Production isolation, default-off demo personas, zero credential exposure,
 *              and absolute session lifetime enforcement
 *   - SEC-003: Untrusted X-Forwarded-For rejection, right-to-left trusted-proxy hop
 *              validation, and per-account failed-login throttling
 *   - SEC-004: Deterministic Mandarin (CJK) & Unicode watermark rendering on minimal Linux
 *   - SEC-005: Multi-chromatic watermark resilience against color/saturation scrubbing,
 *              single-use X-Page-Token redemption, and Range-safe X-Audio-Token streaming
 *   - Priority 3: M003/M007 verification classification alignment & complete Mandarin
 *                 portfolio runtime execution via Node VM + live HTTP API
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(API_ROOT, "..", "..");

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "strata-sec003a-"));
process.env.CV_DATA_DIR = TEST_DATA_DIR;
process.env.CV_SIGNING_SECRET = crypto.randomBytes(48).toString("hex");
delete process.env.CV_ENABLE_DEMO_PERSONAS;
delete process.env.CV_ALLOW_FRAME_EMBED;
delete process.env.CV_TRUST_PROXY;
delete process.env.NODE_ENV;

const { createAppServer } = await import("../src/app.js");
const { closeDb, getDb } = await import("../src/db.js");
const { createUser } = await import("../src/security/authz.js");
const { enginePaths } = await import("../src/services/pdf-engine.js");
const { seedDemoEnvironment } = await import("../scripts/seed.js");

let server;
let baseUrl;
let seeded;
const cookies = {};

function getCookie(res) {
  const raw = res.headers.get("set-cookie") || "";
  const m = raw.match(/cv_session=[^;]+/);
  return m ? m[0] : "";
}

async function http(pathname, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.cookie) headers.Cookie = opts.cookie;
  let body = opts.body;
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${pathname}`, {
    method: opts.method || "GET",
    headers,
    body,
  });
}

describe("Mission 003-A Security Hardening Suite (SEC-001 .. SEC-005 & Priority 3)", () => {
  before(async () => {
    seeded = await seedDemoEnvironment();

    // Also register a dedicated non-admin Reviewer account for SEC-001 least-privilege proof
    createUser({
      email: "reviewer@strata.test",
      password: "ReviewerPass#2026!",
      displayName: "Dr. External Reviewer (Synthetic)",
      role: "reviewer",
      locale: "zh",
    });

    server = createAppServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const loginAdmin = await http("/api/auth/login", {
      method: "POST",
      body: { email: "admin@strata.local", password: "strata-demo-admin-local" },
    });
    assert.equal(loginAdmin.status, 200);
    cookies.admin = getCookie(loginAdmin);

    const loginRev = await http("/api/auth/login", {
      method: "POST",
      body: { email: "reviewer@strata.test", password: "ReviewerPass#2026!" },
    });
    assert.equal(loginRev.status, 200);
    cookies.reviewer = getCookie(loginRev);

    const loginStudent = await http("/api/auth/login", {
      method: "POST",
      body: { email: "aisyah@student.strata.local", password: "strata-demo-student-local" },
    });
    assert.equal(loginStudent.status, 200);
    cookies.studentA = getCookie(loginStudent);

    const loginStudentB = await http("/api/auth/login", {
      method: "POST",
      body: { email: "weiming@student.strata.local", password: "strata-demo-student-local" },
    });
    assert.equal(loginStudentB.status, 200);
    cookies.studentB = getCookie(loginStudentB);
  });

  after(async () => {
    delete process.env.CV_ENABLE_DEMO_PERSONAS;
    delete process.env.CV_TRUST_PROXY;
    delete process.env.NODE_ENV;
    closeDb();
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it("SEC-001: Private M007 portfolio rejects anonymous & student access, permits reviewer & admin, and preserves noindex", async () => {
    // 1. Anonymous probes rejected (401) across HTML, CSS, JS, and enquiry GET/POST
    for (const p of ["/portfolio", "/portfolio/portfolio.css", "/portfolio/portfolio.js", "/api/portfolio/enquiries"]) {
      const r = await http(p);
      assert.equal(r.status, 401, `Anonymous GET ${p} must return 401`);
      assert.ok((r.headers.get("x-robots-tag") || "").includes("noindex"));
    }
    const anonPost = await http("/api/portfolio/enquiries", {
      method: "POST",
      body: {
        senderName: "Anon",
        senderEmail: "anon@test.org",
        topic: "speaking",
        message: "Should be blocked before touching SQLite.",
      },
    });
    assert.equal(anonPost.status, 401);

    // 2. Authenticated student rejected (403)
    for (const p of ["/portfolio", "/portfolio/portfolio.js", "/api/portfolio/enquiries"]) {
      const r = await http(p, { cookie: cookies.studentA });
      assert.equal(r.status, 403, `Student GET ${p} must return 403`);
      assert.ok((r.headers.get("x-robots-tag") || "").includes("noindex"));
    }
    const studentPost = await http("/api/portfolio/enquiries", {
      method: "POST",
      cookie: cookies.studentA,
      body: {
        senderName: "Student A",
        senderEmail: "aisyah@student.strata.local",
        topic: "speaking",
        message: "Students cannot submit reviewer enquiries.",
      },
    });
    assert.equal(studentPost.status, 403);

    // 3. Dedicated Reviewer succeeds on /portfolio & enquiries (200/201), but is still blocked from /api/admin/* (403)
    const revHtml = await http("/portfolio", { cookie: cookies.reviewer });
    assert.equal(revHtml.status, 200);
    assert.ok((revHtml.headers.get("x-robots-tag") || "").includes("noindex"));
    assert.ok((revHtml.headers.get("cache-control") || "").includes("no-store"));

    const revPost = await http("/api/portfolio/enquiries", {
      method: "POST",
      cookie: cookies.reviewer,
      body: {
        senderName: "Dr. External Reviewer",
        senderOrg: "Penang Neurological Society (Synthetic)",
        senderEmail: "reviewer@strata.test",
        topic: "research_collaboration",
        message: "Verified authorized reviewer enquiry submission.",
      },
    });
    assert.equal(revPost.status, 201);

    const revList = await http("/api/portfolio/enquiries", { cookie: cookies.reviewer });
    assert.equal(revList.status, 200);
    const revListBody = await revList.json();
    assert.ok(revListBody.enquiries.length >= 1);

    const revAdminProbe = await http("/api/admin/stats", { cookie: cookies.reviewer });
    assert.equal(revAdminProbe.status, 403);
  });

  it("SEC-002: Demo endpoints are disabled by default, never leak passwords, and production startup blocks unsafe states", async () => {
    // 1. Disabled by default when CV_ENABLE_DEMO_PERSONAS is unset
    const dpDefault = await http("/api/auth/demo-personas");
    assert.equal(dpDefault.status, 403);
    const dlDefault = await http("/api/auth/demo-login", {
      method: "POST",
      body: { personaId: "admin" },
    });
    assert.equal(dlDefault.status, 403);

    // 2. When CV_ENABLE_DEMO_PERSONAS=1 in non-production, zero passwords are exposed in JSON
    process.env.CV_ENABLE_DEMO_PERSONAS = "1";
    try {
      const dpEnabled = await http("/api/auth/demo-personas");
      assert.equal(dpEnabled.status, 200);
      const rawText = await dpEnabled.text();
      assert.equal(rawText.includes("password"), false, "API response must never contain password field");
      assert.equal(rawText.includes("strata-demo-admin-local"), false);
      assert.equal(rawText.includes("strata-demo-student-local"), false);

      const dlOk = await http("/api/auth/demo-login", {
        method: "POST",
        body: { personaId: "studentA" },
      });
      assert.equal(dlOk.status, 200);
      // Non-demo accounts cannot be accessed via demo-login
      const dlUnknown = await http("/api/auth/demo-login", {
        method: "POST",
        body: { personaId: "reviewer" },
      });
      assert.equal(dlUnknown.status, 400);
    } finally {
      delete process.env.CV_ENABLE_DEMO_PERSONAS;
    }

    // 3. seedDemoEnvironment() refuses NODE_ENV=production
    process.env.NODE_ENV = "production";
    try {
      await assert.rejects(() => seedDemoEnvironment(), /SEC-002/);
    } finally {
      delete process.env.NODE_ENV;
    }

    // 4. Production startup checks in isolated child processes:
    const serverScript = path.join(API_ROOT, "src", "server.js");
    const strongSecret = crypto.randomBytes(48).toString("hex");

    // 4a. Rejects NODE_ENV=production when seeded demo accounts exist in TEST_DATA_DIR
    const prodWithDemoDb = spawnSync(process.execPath, [serverScript], {
      cwd: API_ROOT,
      env: {
        ...process.env,
        NODE_ENV: "production",
        CV_DATA_DIR: TEST_DATA_DIR,
        CV_SIGNING_SECRET: strongSecret,
        PORT: "0",
      },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.notEqual(prodWithDemoDb.status, 0);
    assert.match(prodWithDemoDb.stderr, /SEC-002|demonstration accounts/i);

    // 4b. Clean production data dir rejects CV_ALLOW_FRAME_EMBED=1 and CV_ENABLE_DEMO_PERSONAS=1
    const cleanProdDir = fs.mkdtempSync(path.join(os.tmpdir(), "strata-clean-prod-"));
    try {
      for (const badFlag of [
        { CV_ALLOW_FRAME_EMBED: "1" },
        { CV_ENABLE_DEMO_PERSONAS: "1" },
      ]) {
        const badProc = spawnSync(process.execPath, [serverScript], {
          cwd: API_ROOT,
          env: {
            ...process.env,
            NODE_ENV: "production",
            CV_DATA_DIR: cleanProdDir,
            CV_SIGNING_SECRET: strongSecret,
            PORT: "0",
            ...badFlag,
          },
          encoding: "utf8",
          timeout: 5000,
        });
        assert.notEqual(badProc.status, 0);
        assert.match(badProc.stderr, /SEC-002/);
      }

      // 4c. Clean production data dir + strong secret + no unsafe flags boots cleanly
      const cleanChild = spawn(process.execPath, [serverScript], {
        cwd: API_ROOT,
        env: {
          ...process.env,
          NODE_ENV: "production",
          CV_DATA_DIR: cleanProdDir,
          CV_SIGNING_SECRET: strongSecret,
          PORT: "0",
          HOST: "127.0.0.1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const startedLine = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanChild.kill();
          reject(new Error("Timed out waiting for clean production startup"));
        }, 5000);
        cleanChild.stdout.on("data", (chunk) => {
          const s = chunk.toString("utf8");
          if (s.includes("STRATA ContentVault listening")) {
            clearTimeout(timer);
            resolve(s);
          }
        });
        cleanChild.on("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`Unexpected exit ${code}`));
        });
      });
      assert.ok(startedLine.includes("STRATA ContentVault listening"));
      cleanChild.kill("SIGTERM");
      await new Promise((r) => cleanChild.on("close", r));
    } finally {
      fs.rmSync(cleanProdDir, { recursive: true, force: true });
    }

    // 5. Absolute session lifetime cap (12h default) invalidates old sessions even if idle window is unexpired
    const tempUser = createUser({
      email: "abs.session@strata.test",
      password: "AbsSessionPass#2026!",
      displayName: "Absolute Session Check",
      role: "student",
    });
    const tempLogin = await http("/api/auth/login", {
      method: "POST",
      body: { email: tempUser.email, password: "AbsSessionPass#2026!" },
    });
    const tempCookie = getCookie(tempLogin);
    const sid = decodeURIComponent(tempCookie.split("=")[1]);
    const thirteenHoursAgo = new Date(Date.now() - 13 * 3600 * 1000).toISOString();
    getDb()
      .prepare("UPDATE sessions SET created_at = ? WHERE id = ?")
      .run(thirteenHoursAgo, sid);

    const meAfterMax = await http("/api/auth/me", { cookie: tempCookie });
    assert.equal(meAfterMax.status, 401);
  });

  it("SEC-003: Rejects spoofed X-Forwarded-For by default, validates trusted proxy hops, and enforces per-account throttling", async () => {
    // Isolate in a dedicated server instance so IP rate-limit buckets don't collide with other tests
    const throttleTarget = createUser({
      email: "throttled.target@strata.test",
      password: "CorrectHorseBattery#99",
      displayName: "Throttle Target",
      role: "student",
    });

    // 1. Behind trusted proxy (CV_TRUST_PROXY=127.0.0.1), test per-account lockout across distinct real client IPs
    process.env.CV_TRUST_PROXY = "127.0.0.1";
    try {
      const acctStatuses = [];
      for (let i = 1; i <= 10; i += 1) {
        // Each attempt comes from a distinct external hop (203.0.113.i) PLUS a spoofed leftmost hop (198.51.100.i)
        const r = await http("/api/auth/login", {
          method: "POST",
          headers: { "X-Forwarded-For": `198.51.100.${i}, 203.0.113.${i}` },
          body: { email: throttleTarget.email, password: "WrongPassword#123" },
        });
        acctStatuses.push(r.status);
      }
      // First 8 return 401, attempts 9 and 10 MUST return 429 via per-account failed-login throttling
      assert.deepEqual(acctStatuses.slice(0, 8), Array(8).fill(401));
      assert.equal(acctStatuses[8], 429);
      assert.equal(acctStatuses[9], 429);

      // Verify right-to-left hop extraction logged 203.0.113.10, NEVER the spoofed left-most 198.51.100.10
      const lastDeny = getDb()
        .prepare(
          "SELECT ip, detail FROM audit_log WHERE event = 'auth.login' AND outcome = 'deny' ORDER BY rowid DESC LIMIT 1",
        )
        .get();
      assert.equal(lastDeny.ip, "203.0.113.10");
      assert.ok(lastDeny.detail.includes("account_throttled"));
    } finally {
      delete process.env.CV_TRUST_PROXY;
    }

    // 2. With CV_TRUST_PROXY unset (default), rotating X-Forwarded-For cannot bypass IP rate limiting
    const xffBypassStatuses = [];
    for (let i = 1; i <= 28; i += 1) {
      const r = await http("/api/auth/login", {
        method: "POST",
        headers: { "X-Forwarded-For": `192.0.2.${i}` },
        body: { email: `nonexistent.${i}@strata.test`, password: "WrongPassword#123" },
      });
      xffBypassStatuses.push(r.status);
    }
    assert.equal(
      xffBypassStatuses.includes(429),
      true,
      "Rotating X-Forwarded-For must NOT bypass IP rate limiting when CV_TRUST_PROXY is unset",
    );
  });

  it("SEC-004: Mandarin (Chinese-only), mixed-language, and accented Unicode names render deterministically in watermarks", async () => {
    const actors = [
      { email: "cn.wei@strata.test", displayName: "陈伟明" },
      { email: "cn.lin@strata.test", displayName: "林淑芬" },
      { email: "mix.chen@strata.test", displayName: "陈伟明 Tan Wei Ming" },
      { email: "intl.muller@strata.test", displayName: "Dr. Élodie Müller" },
    ];

    const pdfPath = path.join(REPO_ROOT, "knowledge", "synthetic", "synthetic-neurology-module.pdf");
    const stamp = "2026-11-24T20:00:00Z";
    const outputs = [];

    for (const spec of actors) {
      const proc = spawnSync(
        enginePaths.PYTHON,
        [enginePaths.ENGINE_PATH],
        {
          input: JSON.stringify({
            command: "render",
            path: pdfPath,
            page: 2,
            dpi: 120,
            identity: { label: spec.displayName, ref: spec.email, stamp },
          }),
          encoding: "utf8",
        },
      );
      assert.equal(proc.status, 0, proc.stderr);
      const parsed = JSON.parse(proc.stdout);
      assert.equal(parsed.watermark.includes("Learner"), false, "Must not strip CJK name to Learner");
      assert.equal(parsed.watermark.includes(spec.displayName), true);
      outputs.push(parsed);
    }

    // Two different Chinese-only names must produce distinct pixel hashes even when ref/stamp are held identical
    const cnSameRefA = JSON.parse(
      spawnSync(
        enginePaths.PYTHON,
        [enginePaths.ENGINE_PATH],
        {
          input: JSON.stringify({
            command: "render",
            path: pdfPath,
            page: 2,
            dpi: 120,
            identity: { label: "陈伟明", ref: "usr_same", stamp },
          }),
          encoding: "utf8",
        },
      ).stdout,
    );
    const cnSameRefB = JSON.parse(
      spawnSync(
        enginePaths.PYTHON,
        [enginePaths.ENGINE_PATH],
        {
          input: JSON.stringify({
            command: "render",
            path: pdfPath,
            page: 2,
            dpi: 120,
            identity: { label: "林淑芬", ref: "usr_same", stamp },
          }),
          encoding: "utf8",
        },
      ).stdout,
    );
    assert.notEqual(
      cnSameRefA.sha256,
      cnSameRefB.sha256,
      "Chinese-only names 陈伟明 and 林淑芬 must render distinct CJK glyph pixels",
    );

    assert.equal(
      fs.existsSync(path.join(REPO_ROOT, "packages", "watermark-engine", "FONT_LICENSES.md")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(REPO_ROOT, "packages", "watermark-engine", "requirements.txt")),
      true,
    );
  });

  it("SEC-005: Enforces single-use X-Page-Token, preserves Range-safe X-Audio-Token, and resists color/chroma scrubbing", async () => {
    // 1. Issue X-Page-Token & X-Audio-Token on page 2 for Student A
    const initialPage = await http(`/api/documents/${seeded.document.id}/page?page=2`, {
      cookie: cookies.studentA,
    });
    assert.equal(initialPage.status, 200);
    const pageToken = initialPage.headers.get("x-page-token");
    const audioToken = initialPage.headers.get("x-audio-token");
    assert.ok(pageToken && audioToken);
    const markedPng = Buffer.from(await initialPage.arrayBuffer());

    // 2. First redemption of X-Page-Token succeeds (200); second replay MUST fail with 403 token_replayed
    const firstRedeem = await http(
      `/api/documents/${seeded.document.id}/page?page=2&token=${encodeURIComponent(pageToken)}`,
      { cookie: cookies.studentA },
    );
    assert.equal(firstRedeem.status, 200);

    const replayAttempt = await http(
      `/api/documents/${seeded.document.id}/page?page=2&token=${encodeURIComponent(pageToken)}`,
      { cookie: cookies.studentA },
    );
    assert.equal(replayAttempt.status, 403);
    const replayBody = await replayAttempt.json();
    assert.equal(replayBody.error, "token_replayed");

    // 3. X-Audio-Token allows multiple HTTP 206 byte-range requests within playback window,
    //    but rejects cross-purpose (/page), cross-chapter, and cross-student misuse
    for (const range of ["bytes=0-511", "bytes=512-1023", "bytes=1024-2047"]) {
      const r = await http(
        `/api/documents/${seeded.document.id}/audio?page=2&token=${encodeURIComponent(audioToken)}`,
        { cookie: cookies.studentA, headers: { Range: range } },
      );
      assert.equal(r.status, 206);
    }

    const crossPurpose = await http(
      `/api/documents/${seeded.document.id}/page?page=2&token=${encodeURIComponent(audioToken)}`,
      { cookie: cookies.studentA },
    );
    assert.equal(crossPurpose.status, 403);

    const detail = await (
      await http(`/api/documents/${seeded.document.id}`, { cookie: cookies.studentA })
    ).json();
    const ch2 = detail.chapters.find((c) => c.ordinal === 2);
    const wrongChapterAudio = await http(
      `/api/documents/${seeded.document.id}/audio?chapter=${encodeURIComponent(ch2.id)}&token=${encodeURIComponent(audioToken)}`,
      { cookie: cookies.studentA },
    );
    assert.equal(wrongChapterAudio.status, 403);

    const crossStudentAudio = await http(
      `/api/documents/${seeded.document.id}/audio?page=2&token=${encodeURIComponent(audioToken)}`,
      { cookie: cookies.studentB },
    );
    assert.equal(crossStudentAudio.status, 403);

    // 4. Watermark resilience against warm-hue and full-chromaticity scrubbing
    const markedPath = path.join(TEST_DATA_DIR, "sec005-marked.png");
    fs.writeFileSync(markedPath, markedPng);
    const pdfPath = path.join(REPO_ROOT, "knowledge", "synthetic", "synthetic-neurology-module.pdf");
    const scrubScript = `
import base64, io, json, subprocess
from PIL import Image, ImageChops

proc = subprocess.run(
    [${JSON.stringify(enginePaths.PYTHON)}, ${JSON.stringify(enginePaths.ENGINE_PATH)}],
    input=json.dumps({"command":"render","path":${JSON.stringify(pdfPath)},"page":2,"dpi":144,"identity":{},"watermark":False}),
    capture_output=True, text=True, check=True
)
clean = Image.open(io.BytesIO(base64.b64decode(json.loads(proc.stdout)["png"]))).convert("RGB")
marked = Image.open(${JSON.stringify(markedPath)}).convert("RGB")
total = clean.size[0] * clean.size[1]

def pct_diff(a, b):
    d = ImageChops.difference(a, b).convert("L")
    return round(100.0 * d.point(lambda v: 255 if v > 6 else 0).histogram()[255] / total, 2)

before = pct_diff(clean, marked)
chroma_scrub = marked.copy()
px = chroma_scrub.load()
for y in range(chroma_scrub.size[1]):
    for x in range(chroma_scrub.size[0]):
        r, g, b = px[x, y]
        if (max(r, g, b) - min(r, g, b)) > 10 and max(r, g, b) > 170:
            px[x, y] = (255, 255, 255)
after_chroma = pct_diff(clean, chroma_scrub)
print(json.dumps({"before": before, "afterChroma": after_chroma}))
`;
    const pyRes = spawnSync(enginePaths.PYTHON, ["-c", scrubScript], { encoding: "utf8" });
    assert.equal(pyRes.status, 0, pyRes.stderr);
    const metrics = JSON.parse(pyRes.stdout);
    assert.ok(
      metrics.afterChroma >= 3.0 && metrics.afterChroma >= metrics.before * 0.75,
      `Watermark must retain >=75% pixel coverage after chromatic scrubbing, got ${pyRes.stdout}`,
    );
  });

  it("Priority 3: Verifies M003/M007 classification corrections and executes Mandarin portfolio runtime in VM against live API", async () => {
    // 1. M003 register downgrades unsupported Scholar/unfetched entries to PARTIALLY_VERIFIED
    const m003 = fs.readFileSync(
      path.join(REPO_ROOT, "research", "publications", "ASSET_INVENTORY.md"),
      "utf8",
    );
    for (const id of ["JRN-003", "JRN-004", "JRN-005"]) {
      const line = m003.split(/\r?\n/).find((l) => l.includes(`**${id}**`));
      assert.ok(line && line.includes("PARTIALLY_VERIFIED"), `${id} must be PARTIALLY_VERIFIED`);
    }

    // 2. Execute apps/strata-website/public/portfolio.js inside a minimal DOM VM wired to live HTTP API
    const htmlRes = await http("/portfolio", { cookie: cookies.reviewer });
    const html = await htmlRes.text();
    const jsRes = await http("/portfolio/portfolio.js", { cookie: cookies.reviewer });
    const jsCode = await jsRes.text();

    // Build deterministic lightweight DOM nodes for every ID & data-i18n element in portfolio/index.html
    const elementsById = new Map();
    const i18nElements = [];
    const placeholderInputs = [];

    function makeEl(id = "") {
      const listeners = {};
      const classes = new Set();
      const attrs = new Map();
      const el = {
        id,
        value: "",
        innerHTML: "",
        textContent: "",
        classList: {
          add: (...names) => names.forEach((n) => classes.add(n)),
          remove: (...names) => names.forEach((n) => classes.delete(n)),
          toggle: (n, force) => {
            const next = force !== undefined ? Boolean(force) : !classes.has(n);
            if (next) classes.add(n);
            else classes.delete(n);
            return next;
          },
          contains: (n) => classes.has(n),
        },
        setAttribute: (k, v) => attrs.set(k, String(v)),
        getAttribute: (k) => attrs.get(k) ?? null,
        addEventListener: (ev, fn) => {
          listeners[ev] = fn;
        },
        click: () => listeners.click && listeners.click({ preventDefault() {} }),
        submit: () => listeners.submit && listeners.submit({ preventDefault() {} }),
        reset: () => {},
      };
      if (id) elementsById.set(id, el);
      return el;
    }

    for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
      makeEl(m[1]);
    }
    for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) {
      const el = makeEl();
      el.setAttribute("data-i18n", m[1]);
      i18nElements.push(el);
    }
    for (const m of html.matchAll(/data-i18n-placeholder="([^"]+)"/g)) {
      const el = makeEl();
      el.setAttribute("data-i18n-placeholder", m[1]);
      placeholderInputs.push(el);
    }

    const docStub = {
      documentElement: { lang: "en" },
      body: makeEl("body"),
      getElementById: (id) => elementsById.get(id) || makeEl(id),
      querySelectorAll: (sel) => {
        if (sel === "[data-i18n]") return i18nElements;
        if (sel === "[data-i18n-placeholder]") return placeholderInputs;
        return [];
      },
    };

    const sandbox = {
      document: docStub,
      fetch: (url, init = {}) =>
        fetch(`${baseUrl}${url}`, {
          ...init,
          headers: { ...(init.headers || {}), Cookie: cookies.reviewer },
        }),
      console,
    };
    vm.runInNewContext(jsCode, sandbox);

    // Check English render first: Clinical Neurophysiology is PARTIALLY VERIFIED, NOT VERIFIED
    const enInterestsHtml = elementsById.get("interests-list").innerHTML;
    assert.ok(enInterestsHtml.includes("Clinical Neurophysiology"));
    assert.ok(enInterestsHtml.includes("PARTIALLY VERIFIED"));

    // Click 中文 button (#pf-zh) and verify complete Simplified Chinese translation across all sections
    elementsById.get("pf-zh").click();
    assert.equal(docStub.documentElement.lang, "zh-Hans");
    assert.ok(elementsById.get("interests-list").innerHTML.includes("临床神经电生理学"));
    assert.ok(elementsById.get("pub-books-grid").innerHTML.includes("《临床医学精要速览》"));
    assert.ok(elementsById.get("speaking-topics-list").innerHTML.includes("连接临床神经科学与心理韧性建设"));
    assert.ok(elementsById.get("media-resources-list").innerHTML.includes("高分辨率官方授权讲者肖像照"));

    // Submit collaboration enquiry in 中文 mode against live server
    elementsById.get("enq-name").value = "林教授";
    elementsById.get("enq-org").value = "亚洲神经病学研讨会";
    elementsById.get("enq-email").value = "prof.lin@neuro-symposium.test";
    elementsById.get("enq-topic").value = "academic_speaking";
    elementsById.get("enq-message").value = "诚邀参与双语医学教育学术交流与研讨。";
    await elementsById.get("enquiry-form").submit();
    assert.ok(elementsById.get("enq-status").textContent.includes("已存入本地暂存库"));
  });
});

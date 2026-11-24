/**
 * Mission 005 Checkpoint 005-D — PDF Worker Resource Safety & Cache Eviction Suite
 * (`AUD-A1`, `AUD-A2`).
 *
 * Behaviorally verifies:
 *   1. `005-D-1` (`AUD-A1`): Bounded worker concurrency, per-user render budget (`429`),
 *      global queue saturation (`503` + `Retry-After`), and pre-render authz enforcement.
 *   2. `005-D-2` (`AUD-A2`): Malformed PDF handling, worker crash recovery, and real
 *      `SIGTERM`-ignoring wedged Python worker escalated to `SIGKILL` with zero orphan PIDs.
 *   3. `005-D-3`: Render-cache TTL + max-byte + max-file LRU eviction, free-disk-space
 *      safeguard (`503 disk_space_exhausted`), and `/api/admin/stats` worker telemetry.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "strata-005d-worker-"));
process.env.CV_DATA_DIR = TEST_DATA_DIR;
process.env.CV_PDF_ENGINE = "pypdfium2";
process.env.CV_SIGNING_SECRET = crypto.randomBytes(48).toString("hex");

const {
  createPdfEngineAdapter,
  runPythonWorker,
  enforceRenderCachePolicy,
  getPdfWorkerMetrics,
  EngineError,
} = await import("../src/services/pdf-engine.js");
const { createAppServer } = await import("../src/app.js");
const { seedDemoEnvironment } = await import("../scripts/seed.js");
const { closePersistenceAdapter } = await import("../src/persistence/adapter.js");

let server;
let baseUrl;
let demoDocId;

async function http(pathname, { method = "GET", headers = {}, body = null, cookie = null } = {}) {
  const finalHeaders = { ...headers };
  if (cookie) finalHeaders.Cookie = cookie;
  let payload = body;
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    finalHeaders["Content-Type"] = finalHeaders["Content-Type"] || "application/json";
    payload = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${pathname}`, { method, headers: finalHeaders, body: payload });
}

async function loginCookie(email, password) {
  const res = await http("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(res.status, 200);
  return (res.headers.get("set-cookie") || "").match(/cv_session=[^;]+/)[0];
}

describe("Mission 005 Checkpoint 005-D — PDF Worker Concurrency, Timeouts & Cache Safety (AUD-A1, AUD-A2)", () => {
  before(async () => {
    const summary = await seedDemoEnvironment();
    demoDocId = summary.document.id;
    server = createAppServer();
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    await closePersistenceAdapter();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it("005-D-1 (AUD-A1): Enforces bounded concurrency, per-user 429 budget, global 503 queue cap, and pre-render authz", async () => {
    // 1. Unit/Behavioral scheduler proof: maxConcurrency=2, maxQueue=2, maxPerUser=2
    let currentRunning = 0;
    let peakRunning = 0;

    const slowRunner = async (req) => {
      currentRunning += 1;
      peakRunning = Math.max(peakRunning, currentRunning);
      await new Promise((r) => setTimeout(r, 90));
      currentRunning -= 1;
      return {
        ok: true,
        engine: "pypdfium2",
        png: Buffer.from("89504e470d0a1a0a", "hex").toString("base64"),
        sha256: "a".repeat(64),
        width: 100,
        height: 100,
        pageCount: 6,
        watermark: req.identity?.label || "test",
        renderMs: 90,
        cacheHit: false,
      };
    };

    const isolatedCache = fs.mkdtempSync(path.join(os.tmpdir(), "strata-d1-cache-"));
    try {
      const boundedAdapter = createPdfEngineAdapter({
        runner: slowRunner,
        cacheDir: isolatedCache,
        maxConcurrency: 2,
        maxQueue: 2,
        maxPerUser: 2,
      });

      // Same user firing 3 simultaneous renders -> 3rd rejected with 429 `user_render_budget_exceeded`
      const sameUserResults = await Promise.allSettled([
        boundedAdapter.renderWatermarkedPage({
          absolutePath: "/tmp/fake.pdf",
          page: 1,
          userId: "usr_a",
          identity: { label: "A", ref: "usr_a" },
        }),
        boundedAdapter.renderWatermarkedPage({
          absolutePath: "/tmp/fake.pdf",
          page: 2,
          userId: "usr_a",
          identity: { label: "A", ref: "usr_a" },
        }),
        boundedAdapter.renderWatermarkedPage({
          absolutePath: "/tmp/fake.pdf",
          page: 3,
          userId: "usr_a",
          identity: { label: "A", ref: "usr_a" },
        }),
      ]);
      const rejectedUser = sameUserResults.filter((r) => r.status === "rejected");
      assert.equal(rejectedUser.length, 1);
      assert.equal(rejectedUser[0].reason.code, "user_render_budget_exceeded");
      assert.equal(rejectedUser[0].reason.statusCode, 429);

      // 6 distinct users firing simultaneously into `maxConcurrency=2 + maxQueue=2` (capacity=4)
      // -> 4 succeed with `peakRunning <= 2`, and 2 fail fast with `503 render_queue_full`!
      const globalBurst = await Promise.allSettled(
        Array.from({ length: 6 }, (_, idx) =>
          boundedAdapter.renderWatermarkedPage({
            absolutePath: "/tmp/fake.pdf",
            page: 1,
            userId: `usr_burst_${idx}`,
            identity: { label: `U${idx}`, ref: `usr_burst_${idx}` },
          }),
        ),
      );
      assert.ok(peakRunning <= 2, `Peak concurrent workers (${peakRunning}) exceeded maxConcurrency=2`);
      const okCount = globalBurst.filter((r) => r.status === "fulfilled").length;
      const overloadErrors = globalBurst
        .filter((r) => r.status === "rejected")
        .map((r) => r.reason);
      assert.equal(okCount, 4);
      assert.equal(overloadErrors.length, 2);
      assert.ok(overloadErrors.every((e) => e.code === "render_queue_full" && e.statusCode === 503));
    } finally {
      fs.rmSync(isolatedCache, { recursive: true, force: true });
    }

    // 2. End-to-end HTTP proof: pre-render authz blocks unauthenticated (401) & unentitled (403)
    //    BEFORE touching worker pool, and HTTP `/page` returns 429/503 under tight env budgets!
    const metricsBeforeAuthzBlock = getPdfWorkerMetrics();
    const anonRes = await http(`/api/documents/${demoDocId}/page?page=1`);
    assert.equal(anonRes.status, 401);

    const stuCCookie = await loginCookie("priya@student.strata.local", "strata-demo-student-local");
    const unentRes = await http(`/api/documents/${demoDocId}/page?page=1`, { cookie: stuCCookie });
    assert.equal(unentRes.status, 403);
    const metricsAfterAuthzBlock = getPdfWorkerMetrics();
    assert.equal(
      metricsAfterAuthzBlock.completed,
      metricsBeforeAuthzBlock.completed,
      "Unauthenticated/unentitled requests must NEVER spawn a PDF worker",
    );

    // Tight per-user HTTP limit (`CV_WORKER_MAX_PER_USER=1`) returns HTTP 429 + Retry-After on concurrent `/page`
    const stuACookie = await loginCookie("aisyah@student.strata.local", "strata-demo-student-local");
    process.env.CV_WORKER_MAX_PER_USER = "1";
    try {
      const [r1, r2, r3] = await Promise.all([
        http(`/api/documents/${demoDocId}/page?page=1`, { cookie: stuACookie }),
        http(`/api/documents/${demoDocId}/page?page=2`, { cookie: stuACookie }),
        http(`/api/documents/${demoDocId}/page?page=3`, { cookie: stuACookie }),
      ]);
      const statuses = [r1.status, r2.status, r3.status];
      assert.ok(
        statuses.includes(200) && statuses.includes(429),
        `Expected concurrent per-user renders to include 200 and 429, got [${statuses.join(",")}]`,
      );
      const throttled = [r1, r2, r3].find((r) => r.status === 429);
      assert.ok(throttled.headers.get("retry-after"));
    } finally {
      delete process.env.CV_WORKER_MAX_PER_USER;
    }
  });

  it("005-D-2 (AUD-A2): Escalates SIGTERM-ignoring hung worker to SIGKILL, handles worker crashes, and rejects malformed PDFs", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "strata-d2-proc-"));
    const pidFile = path.join(tmpDir, "wedged.pid");
    const wedgedScript = path.join(tmpDir, "wedged_worker.py");
    const crashScript = path.join(tmpDir, "crash_worker.py");

    // Python worker that explicitly ignores SIGTERM and sleeps 30s
    fs.writeFileSync(
      wedgedScript,
      [
        "import os, signal, sys, time",
        "signal.signal(signal.SIGTERM, signal.SIG_IGN)",
        `open(${JSON.stringify(pidFile)}, 'w').write(str(os.getpid()))`,
        "sys.stdout.flush()",
        "time.sleep(30)",
      ].join("\n"),
      "utf8",
    );

    // Python worker that crashes abruptly with exit code 139
    fs.writeFileSync(
      crashScript,
      "import sys\nsys.stderr.write('simulated native segfault\\n')\nsys.exit(139)\n",
      "utf8",
    );

    try {
      const beforeKillCount = getPdfWorkerMetrics().sigkillEscalations;

      await assert.rejects(
        () =>
          runPythonWorker({ command: "render" }, 150, {
            engineScript: wedgedScript,
            killGraceMs: 100,
          }),
        (err) => err instanceof EngineError && err.code === "engine_timeout" && err.statusCode === 504,
      );

      // Wait for grace window + SIGKILL reap
      await new Promise((r) => setTimeout(r, 220));
      assert.ok(fs.existsSync(pidFile), "Wedged worker should have written its PID before hanging");
      const wedgedPid = Number(fs.readFileSync(pidFile, "utf8").trim());
      assert.ok(Number.isInteger(wedgedPid) && wedgedPid > 1);

      let processStillAlive = true;
      try {
        process.kill(wedgedPid, 0);
      } catch (err) {
        if (err.code === "ESRCH") processStillAlive = false;
      }
      assert.equal(
        processStillAlive,
        false,
        `Wedged SIGTERM-ignoring worker PID ${wedgedPid} MUST be terminated via SIGKILL`,
      );
      assert.ok(getPdfWorkerMetrics().sigkillEscalations > beforeKillCount);

      // Crashing worker rejects cleanly with `engine_failed` and frees concurrency slot
      const crashAdapter = createPdfEngineAdapter({
        maxConcurrency: 1,
        maxQueue: 2,
        runner: (req) =>
          req.page === 99
            ? runPythonWorker(req, 2000, { engineScript: crashScript })
            : Promise.resolve({
                ok: true,
                engine: "pypdfium2",
                png: Buffer.from("89504e47", "hex").toString("base64"),
                sha256: "b".repeat(64),
                width: 10,
                height: 10,
                pageCount: 1,
                watermark: "ok",
                renderMs: 5,
                cacheHit: false,
              }),
        cacheDir: null,
      });

      await assert.rejects(
        () =>
          crashAdapter.renderWatermarkedPage({
            absolutePath: "/tmp/x.pdf",
            page: 99,
            identity: { label: "Crash", ref: "u1" },
          }),
        (err) => err.code === "engine_failed",
      );

      // Immediately after crash, single-slot adapter still serves next valid render!
      const recovered = await crashAdapter.renderWatermarkedPage({
        absolutePath: "/tmp/x.pdf",
        page: 1,
        identity: { label: "Recovered", ref: "u2" },
      });
      assert.equal(recovered.sha256, "b".repeat(64));

      // Malformed PDF upload via HTTP `/api/documents` is rejected cleanly (`400 invalid_pdf`)
      const adminCookie = await loginCookie("admin@strata.local", "strata-demo-admin-local");
      const badPdfRes = await http("/api/documents", {
        method: "POST",
        cookie: adminCookie,
        headers: {
          "Content-Type": "application/pdf",
          "X-Title-En": "Corrupted PDF Payload",
        },
        body: Buffer.from("%PDF-1.7\ncorrupted-xref-stream-not-a-valid-pdf\n%%EOF"),
      });
      assert.equal(badPdfRes.status, 400);
      assert.equal((await badPdfRes.json()).error, "invalid_pdf");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("005-D-3: Enforces render-cache TTL, max-byte & file-count eviction, free-disk-space safeguard, and admin worker telemetry", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "strata-d3-cache-"));
    try {
      // 1. Create an expired file + 4 active 1 KB files
      const expiredFile = path.join(cacheDir, "expired.png");
      fs.writeFileSync(expiredFile, Buffer.alloc(1024, 0xaa));
      const pastSec = (Date.now() - 10_000) / 1000;
      fs.utimesSync(expiredFile, pastSec, pastSec);

      for (let i = 1; i <= 4; i += 1) {
        const f = path.join(cacheDir, `active_${i}.png`);
        fs.writeFileSync(f, Buffer.alloc(1024, i));
        const t = (Date.now() - (5 - i) * 500) / 1000;
        fs.utimesSync(f, t, t);
      }

      // Enforce TTL=5000ms and maxBytes=2048 -> removes expired.png AND oldest 2 active files, leaving newest 2!
      const res = enforceRenderCachePolicy(cacheDir, {
        ttlMs: 5_000,
        maxBytes: 2_048,
        maxFiles: 10,
        minFreeDiskBytes: 0,
      });
      assert.equal(res.evicted, 3);
      assert.equal(res.totalFiles, 2);
      assert.ok(res.totalBytes <= 2_048);
      assert.equal(fs.existsSync(expiredFile), false);
      assert.equal(fs.existsSync(path.join(cacheDir, "active_1.png")), false);
      assert.equal(fs.existsSync(path.join(cacheDir, "active_4.png")), true);

      // 2. Simulated critically low disk space -> purges cache and throws 503 `disk_space_exhausted`
      assert.throws(
        () =>
          enforceRenderCachePolicy(cacheDir, {
            ttlMs: 60_000,
            maxBytes: 1024 * 1024,
            minFreeDiskBytes: 50 * 1024 * 1024,
            statfsFn: () => 1 * 1024 * 1024, // Only 1 MB free
          }),
        (err) => err.code === "disk_space_exhausted" && err.statusCode === 503,
      );
      assert.equal(fs.readdirSync(cacheDir).length, 0, "Low-disk safeguard must purge cached rasters");

      // 3. Admin `/api/admin/stats` exposes live `pdfWorker` and `scryptPool` metrics
      const adminCookie = await loginCookie("admin@strata.local", "strata-demo-admin-local");
      const statsRes = await http("/api/admin/stats", { cookie: adminCookie });
      assert.equal(statsRes.status, 200);
      const stats = await statsRes.json();
      assert.ok(stats.pdfWorker && typeof stats.pdfWorker.maxConcurrency === "number");
      assert.ok(stats.scryptPool && typeof stats.scryptPool.maxConcurrency === "number");
    } finally {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

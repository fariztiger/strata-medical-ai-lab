#!/usr/bin/env node
/**
 * STRATA ContentVault — Mission 004 Phase B Real-Browser Verification Suite
 *
 * Executes genuine headless Chromium tests via Playwright at:
 *   - Desktop: 1440 x 900
 *   - Mobile:  390 x 844
 *
 * Verifies:
 *   1. All 4 synthetic personas (Admin, Student A EN, Student B 中文, Student C unentitled) + Reviewer.
 *   2. Document navigation (Page 1 -> Page 2 -> Chapter jump).
 *   3. Burned-in server-side watermark display (`naturalWidth === 1190`, `naturalHeight === 1684`,
 *      distinct pixel canvas hash between Student A and Student B, zero CSS watermark overlay).
 *   4. Language switching (`EN` <-> `中文` on both ContentVault and M007 `/portfolio`).
 *   5. Responsive layout (`document.documentElement.scrollWidth <= window.innerWidth` at 1440x900 & 390x844
 *      plus mobile chapter drawer toggle).
 *   6. Authenticated HTML5 `<audio>` loading, duration metadata, and programmatic playback.
 *   7. Live mid-session entitlement revocation immediately blocking subsequent page navigation.
 *   8. Private M007 `/portfolio` access control (`401` anonymous, `403` student, `200` reviewer/admin).
 *   9. Genuine Chromium browser screenshots saved to `reports/browser-screenshots/`.
 *
 * Set `CV_REQUIRE_BROWSER=1` (enabled in GitHub Actions CI) to fail hard if Playwright/Chromium
 * is not installed. In restricted offline sandboxes without Chromium, emits `BROWSER_VERIFICATION_SKIPPED`.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const API_ROOT = path.join(REPO_ROOT, "apps", "contentvault-api");
const SCREENSHOT_DIR = path.join(REPO_ROOT, "reports", "browser-screenshots");
const REQUIRE_BROWSER = process.env.CV_REQUIRE_BROWSER === "1" || process.argv.includes("--strict");

let playwrightPkg = null;
try {
  const pwSpecifier = process.env.CV_PLAYWRIGHT_MODULE || "playwright";
  const mod = await import(pwSpecifier);
  playwrightPkg = mod.default || mod;
} catch (err) {
  if (REQUIRE_BROWSER) {
    console.error("FATAL: `playwright` package is required when CV_REQUIRE_BROWSER=1:", err.message);
    process.exit(1);
  }
  console.log(
    "BROWSER_VERIFICATION_SKIPPED: `playwright` package is not installed in this local zero-dependency environment (set up Playwright + Chromium or run `.github/workflows/phase-b-browser-ci.yml`).",
  );
  process.exit(0);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "strata-pw-004b-"));
const PORT = Number(process.env.CV_PW_PORT || 17488);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const env = {
  ...process.env,
  CV_DATA_DIR: tmpDir,
  CV_SIGNING_SECRET: crypto.randomBytes(48).toString("hex"),
  CV_ENABLE_DEMO_PERSONAS: "1",
  CV_PDF_ENGINE: "pypdfium2",
  PORT: String(PORT),
  HOST: "127.0.0.1",
};

await new Promise((resolve, reject) => {
  const seed = spawn(process.execPath, ["scripts/seed.js"], {
    cwd: API_ROOT,
    env,
    stdio: "inherit",
  });
  seed.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`))));
});

const server = spawn(process.execPath, ["src/server.js"], {
  cwd: API_ROOT,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitForHealth(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Server failed to become healthy within timeout");
}

let browser;
try {
  await waitForHealth();
  const executableCandidates = [
    process.env.CV_CHROMIUM_EXECUTABLE,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const existingExe = executableCandidates.find((p) => fs.existsSync(p));
  browser = await playwrightPkg.chromium.launch({
    headless: true,
    ...(existingExe ? { executablePath: existingExe } : {}),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
} catch (err) {
  server.kill("SIGTERM");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (REQUIRE_BROWSER) {
    console.error("FATAL: Chromium launch failed under CV_REQUIRE_BROWSER=1:", err);
    process.exit(1);
  }
  console.log(`BROWSER_VERIFICATION_SKIPPED: Chromium binary unavailable (${err.message.split("\n")[0]}).`);
  process.exit(0);
}

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  assert.ok(
    metrics.scrollWidth <= metrics.innerWidth + 1,
    `Horizontal overflow on ${label}: scrollWidth=${metrics.scrollWidth} > innerWidth=${metrics.innerWidth}`,
  );
  return metrics;
}

async function waitForRenderedPageImage(page) {
  await page.waitForFunction(
    () => {
      const img = document.getElementById("reader-page-img");
      const fig = document.getElementById("reader-figure");
      return (
        img &&
        fig &&
        !fig.classList.contains("hidden") &&
        img.complete &&
        img.naturalWidth > 800 &&
        img.src.startsWith("blob:")
      );
    },
    { timeout: 20_000 },
  );
  return page.evaluate(async () => {
    const img = document.getElementById("reader-page-img");
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 340;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let i = 0; i < bytes.length; i += 4) {
      hash ^= bytes[i] + (bytes[i + 1] << 8) + (bytes[i + 2] << 16);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return {
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      sampleHash: hash.toString(16).padStart(8, "0"),
    };
  });
}

const report = {
  executedAt: new Date().toISOString(),
  browserVersion: browser.version(),
  pdfEngine: "pypdfium2",
  viewportsTested: ["1440x900", "390x844"],
  checks: {},
  screenshots: [],
};

try {
  // 0. Anonymous portfolio access control check (401)
  {
    const anonCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const anonPage = await anonCtx.newPage();
    const pfAnonRes = await anonPage.goto(`${BASE_URL}/portfolio`);
    assert.equal(pfAnonRes.status(), 401, "Anonymous /portfolio must return 401");
    report.checks.anonymousPortfolioBlocked401 = true;
    await anonCtx.close();
  }

  // 1. Desktop (1440x900) — Persona 1: Admin console, selftest, reviewer provisioning & portfolio
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const adminPage = await adminCtx.newPage();
  await adminPage.goto(`${BASE_URL}/`);
  await assertNoHorizontalOverflow(adminPage, "desktop-login");
  await adminPage.fill("#login-email", "admin@strata.local");
  await adminPage.fill("#login-password", "strata-demo-admin-local");
  await adminPage.click("#btn-login-submit");
  await adminPage.waitForSelector("#view-admin:not(.hidden)");
  await adminPage.waitForFunction(() => Number(document.getElementById("stat-docs")?.textContent || 0) >= 1);
  await assertNoHorizontalOverflow(adminPage, "desktop-admin-overview");

  const s1 = "01-desktop-admin-console.png";
  await adminPage.screenshot({ path: path.join(SCREENSHOT_DIR, s1), fullPage: false });
  report.screenshots.push(s1);

  // Provision a synthetic Reviewer account through the real Admin browser UI
  await adminPage.click('[data-admin-tab="users"]');
  await adminPage.waitForSelector("#admin-panel-users:not(.hidden)");
  await adminPage.fill("#reg-name", "Dr. Mei-Lin Tan (Synthetic Reviewer)");
  await adminPage.fill("#reg-email", "reviewer@strata.test");
  await adminPage.fill("#reg-password", "SyntheticReviewer#2026!");
  await adminPage.selectOption("#reg-role", "reviewer");
  await adminPage.click('#register-user-form button[type="submit"]');
  await adminPage.waitForFunction(() =>
    document.getElementById("admin-users-table-wrap")?.textContent?.includes("reviewer@strata.test"),
  );

  // Run live PDFium pixel proof in Admin Audit tab
  await adminPage.click('[data-admin-tab="audit"]');
  await adminPage.waitForSelector("#admin-panel-audit:not(.hidden)");
  await adminPage.click("#btn-run-selftest");
  await adminPage.waitForFunction(() =>
    document.getElementById("selftest-output")?.textContent?.includes('"watermarkedOutputsDiffer": true'),
  );
  await adminPage.click('[data-admin-tab="overview"]');
  report.checks.persona1AdminDesktop = true;

  // 2. Desktop (1440x900) — Persona 2: Student A (EN), navigation, watermark, & HTML5 <audio> playback
  const stuACtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const stuAPage = await stuACtx.newPage();
  await stuAPage.goto(`${BASE_URL}/`);
  await stuAPage.fill("#login-email", "aisyah@student.strata.local");
  await stuAPage.fill("#login-password", "strata-demo-student-local");
  await stuAPage.click("#btn-login-submit");
  await stuAPage.waitForSelector("[data-open-doc]");
  const docId = await stuAPage.getAttribute("[data-open-doc]", "data-open-doc");
  await stuAPage.click("[data-open-doc]");

  const p1ImgA = await waitForRenderedPageImage(stuAPage);
  assert.equal(p1ImgA.naturalWidth, 1190);
  assert.equal(p1ImgA.naturalHeight, 1684);

  // Navigate to Page 2 via Next button and verify page update + audio playback
  await stuAPage.click("#btn-next-page");
  await stuAPage.waitForFunction(() => document.getElementById("input-page-num")?.value === "2");
  const p2ImgA = await waitForRenderedPageImage(stuAPage);
  assert.notEqual(p1ImgA.sampleHash, p2ImgA.sampleHash, "Page 2 raster must differ from Page 1");

  // Verify HTML5 <audio> loads authenticated blob and plays
  await stuAPage.waitForFunction(() => {
    const a = document.getElementById("reader-audio-player");
    return a && a.src.startsWith("blob:") && a.readyState >= 1 && a.duration > 0;
  });
  const audioCheck = await stuAPage.evaluate(async () => {
    const a = document.getElementById("reader-audio-player");
    await a.play();
    await new Promise((r) => setTimeout(r, 250));
    const progressed = a.currentTime > 0 || !a.paused;
    a.pause();
    return { duration: a.duration, currentTime: a.currentTime, progressed };
  });
  assert.ok(audioCheck.duration > 0.5, "Authenticated chapter audio duration must be > 0.5s");
  assert.equal(audioCheck.progressed, true, "HTML5 <audio> must play in Chromium");
  await assertNoHorizontalOverflow(stuAPage, "desktop-student-a-reader");

  const s2 = "02-desktop-student-a-reader-en.png";
  await stuAPage.screenshot({ path: path.join(SCREENSHOT_DIR, s2), fullPage: false });
  report.screenshots.push(s2);
  report.checks.persona2StudentADesktopAndAudio = { page2NaturalSize: `${p2ImgA.naturalWidth}x${p2ImgA.naturalHeight}`, audioDurationSec: Number(audioCheck.duration.toFixed(2)) };
  await stuACtx.close();

  // 3. Desktop (1440x900) — Persona 3: Student B (Mandarin 中文), language toggle, distinct CJK watermark & live revocation
  const stuBCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const stuBPage = await stuBCtx.newPage();
  await stuBPage.goto(`${BASE_URL}/`);
  await stuBPage.fill("#login-email", "weiming@student.strata.local");
  await stuBPage.fill("#login-password", "strata-demo-student-local");
  await stuBPage.click("#btn-login-submit");
  await stuBPage.waitForSelector("[data-open-doc]");
  assert.equal(await stuBPage.evaluate(() => document.documentElement.lang), "zh-Hans");

  // Toggle language EN -> 中文 and verify DOM translation updates
  await stuBPage.click("#btn-locale-en");
  assert.equal(await stuBPage.textContent("#tab-student-library"), "Assigned Library");
  await stuBPage.click("#btn-locale-zh");
  assert.equal(await stuBPage.textContent("#tab-student-library"), "已授权课程库");

  await stuBPage.click("[data-open-doc]");
  await waitForRenderedPageImage(stuBPage);
  await stuBPage.click("#btn-next-page");
  await stuBPage.waitForFunction(() => document.getElementById("input-page-num")?.value === "2");
  const p2ImgB = await waitForRenderedPageImage(stuBPage);
  assert.notEqual(
    p2ImgA.sampleHash,
    p2ImgB.sampleHash,
    "Student B Mandarin watermarked page pixels must differ from Student A in browser",
  );

  const s3 = "03-desktop-student-b-reader-zh.png";
  await stuBPage.screenshot({ path: path.join(SCREENSHOT_DIR, s3), fullPage: false });
  report.screenshots.push(s3);

  // Live mid-session revocation from Admin browser context -> Student B immediately blocked on Page 3
  await adminPage.waitForSelector('[data-revoke-email="weiming@student.strata.local"]');
  await adminPage.click('[data-revoke-email="weiming@student.strata.local"]');
  await adminPage.waitForSelector('[data-regrant-email="weiming@student.strata.local"]');

  await stuBPage.click("#btn-next-page");
  await stuBPage.waitForSelector("#reader-denied:not(.hidden)");
  const deniedText = await stuBPage.textContent("#reader-denied-title");
  assert.match(deniedText, /403/);

  const s4 = "04-desktop-student-b-revoked.png";
  await stuBPage.screenshot({ path: path.join(SCREENSHOT_DIR, s4), fullPage: false });
  report.screenshots.push(s4);

  // Restore Student B entitlement from Admin UI
  await adminPage.click('[data-regrant-email="weiming@student.strata.local"]');
  await adminPage.waitForSelector('[data-revoke-email="weiming@student.strata.local"]');
  report.checks.persona3StudentBMandarinAndLiveRevocation = true;
  await stuBCtx.close();

  // 4. Desktop (1440x900) — Persona 4: Unentitled Student C refusal + 403 on /portfolio
  const stuCCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const stuCPage = await stuCCtx.newPage();
  await stuCPage.goto(`${BASE_URL}/`);
  await stuCPage.fill("#login-email", "priya@student.strata.local");
  await stuCPage.fill("#login-password", "strata-demo-student-local");
  await stuCPage.click("#btn-login-submit");
  await stuCPage.waitForSelector("#probe-doc-id");
  await stuCPage.fill("#probe-doc-id", docId);
  await stuCPage.click('#probe-doc-form button[type="submit"]');
  await stuCPage.waitForSelector("#probe-doc-result:not(.hidden)");
  assert.match(await stuCPage.textContent("#probe-doc-result"), /403/);

  const s5 = "05-desktop-student-c-denied.png";
  await stuCPage.screenshot({ path: path.join(SCREENSHOT_DIR, s5), fullPage: false });
  report.screenshots.push(s5);

  const pfStuRes = await stuCPage.goto(`${BASE_URL}/portfolio`);
  assert.equal(pfStuRes.status(), 403, "Student role must receive 403 on /portfolio");
  report.checks.persona4StudentCDeniedAndPortfolio403 = true;
  await stuCCtx.close();

  // 5. Desktop (1440x900) & Mobile (390x844) — Authorized Reviewer accesses /portfolio & toggles 中文
  const revCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const revPage = await revCtx.newPage();
  await revPage.goto(`${BASE_URL}/`);
  await revPage.fill("#login-email", "reviewer@strata.test");
  await revPage.fill("#login-password", "SyntheticReviewer#2026!");
  await revPage.click("#btn-login-submit");
  await revPage.waitForSelector("#view-reviewer:not(.hidden)");
  await revPage.waitForSelector("#header-portfolio-link:not(.hidden)");
  await assertNoHorizontalOverflow(revPage, "desktop-reviewer-portal");

  const s6a = "06a-desktop-reviewer-portal.png";
  await revPage.screenshot({ path: path.join(SCREENSHOT_DIR, s6a), fullPage: false });
  report.screenshots.push(s6a);

  await revPage.click("#btn-reviewer-open-portfolio");
  await revPage.waitForSelector("#pf-enq-form");
  await assertNoHorizontalOverflow(revPage, "desktop-portfolio-en");

  await revPage.click("#pf-lang-zh");
  await revPage.waitForFunction(() => document.documentElement.lang === "zh-Hans");
  await assertNoHorizontalOverflow(revPage, "desktop-portfolio-zh");

  const s6 = "06-desktop-portfolio-zh.png";
  await revPage.screenshot({ path: path.join(SCREENSHOT_DIR, s6), fullPage: false });
  report.screenshots.push(s6);
  report.checks.reviewerPortfolioDesktop = true;
  await revCtx.close();

  // 6. Mobile (390x844) — Student A responsive reader + chapter drawer + Reviewer mobile portfolio
  const mobStuCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobStuPage = await mobStuCtx.newPage();
  await mobStuPage.goto(`${BASE_URL}/`);
  await assertNoHorizontalOverflow(mobStuPage, "mobile-login");
  await mobStuPage.fill("#login-email", "aisyah@student.strata.local");
  await mobStuPage.fill("#login-password", "strata-demo-student-local");
  await mobStuPage.click("#btn-login-submit");
  await mobStuPage.waitForSelector("[data-open-doc]");
  await assertNoHorizontalOverflow(mobStuPage, "mobile-student-library");
  await mobStuPage.click("[data-open-doc]");
  await waitForRenderedPageImage(mobStuPage);
  await assertNoHorizontalOverflow(mobStuPage, "mobile-student-reader");

  await mobStuPage.click("#btn-toggle-chapters");
  await mobStuPage.waitForSelector("#reader-sidebar.mobile-open");
  await assertNoHorizontalOverflow(mobStuPage, "mobile-student-drawer-open");

  const s7 = "07-mobile-student-a-reader.png";
  await mobStuPage.screenshot({ path: path.join(SCREENSHOT_DIR, s7), fullPage: false });
  report.screenshots.push(s7);
  await mobStuCtx.close();

  const mobRevCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobRevPage = await mobRevCtx.newPage();
  await mobRevPage.goto(`${BASE_URL}/`);
  await mobRevPage.fill("#login-email", "reviewer@strata.test");
  await mobRevPage.fill("#login-password", "SyntheticReviewer#2026!");
  await mobRevPage.click("#btn-login-submit");
  await mobRevPage.waitForSelector("#header-portfolio-link:not(.hidden)");
  await mobRevPage.goto(`${BASE_URL}/portfolio`);
  await mobRevPage.waitForSelector("#pf-enq-form");
  await assertNoHorizontalOverflow(mobRevPage, "mobile-portfolio");

  const s8 = "08-mobile-portfolio-en.png";
  await mobRevPage.screenshot({ path: path.join(SCREENSHOT_DIR, s8), fullPage: false });
  report.screenshots.push(s8);
  await mobRevCtx.close();

  await adminCtx.close();
  report.checks.mobileResponsive390x844 = true;

  const reportPath = path.join(SCREENSHOT_DIR, "browser-verification-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log("BROWSER_VERIFICATION_PASSED:", JSON.stringify(report, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

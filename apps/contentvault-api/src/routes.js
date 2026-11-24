/**
 * ContentVault HTTP routes (Mission 005 Phase A — Full Async Persistence).
 *
 * Core security principle: the client's only authenticated identity is the
 * server-side session (`cv_session` cookie), resolved in the active database
 * backend (PostgreSQL 16 or SQLite) on every request. No client field, query
 * parameter, or custom identity header is ever trusted as a user identity or role.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  readJson,
  readRawBody,
  sendJson,
  sendBuffer,
  sendError,
  parseCookies,
  serializeCookie,
  clearCookie,
  isSecureRequest,
  rateLimitAsync,
  clearRateLimitAsync,
  clientIp,
  protectedAssetHeaders,
} from "./http/helpers.js";
import {
  SESSION_COOKIE,
  VALID_ROLES,
  createUserAsync,
  findUserByIdAsync,
  findUserByEmailAsync,
  listUsersAsync,
  loginAsync,
  createSessionForUserAsync,
  logoutAsync,
  resolveSession,
  resolveSessionAsync,
  canViewPortfolio,
  canReadDocumentAsync,
  issuePageToken,
  redeemPageTokenAsync,
  issueAudioToken,
  verifyAudioToken,
} from "./security/authz.js";
import {
  grantEntitlementAsync,
  revokeEntitlementAsync,
  findDocumentAsync,
  listReadableDocumentsAsync,
  listDocuments,
  listDocumentsAsync,
  createDocumentAsync,
  addChapterAsync,
  listChaptersAsync,
  findChapterForPageAsync,
  findChapterByIdAsync,
  attachChapterAudioAsync,
  recordProgressAsync,
  getProgressAsync,
  listEntitlementsForDocumentAsync,
} from "./services/content.js";
import {
  probePdf,
  renderWatermarkedPage,
  engineSelftest,
} from "./services/pdf-engine.js";
import {
  putPrivateObject,
  readPrivateObjectSync,
  privateObjectExists,
  keyToPath,
} from "./services/storage.js";
import { auditAsync, listAuditAsync } from "./security/audit.js";
import { nowIso } from "./db.js";
import {
  getPersistenceAdapter,
  getActivePersistenceAdapterSync,
} from "./persistence/adapter.js";
import {
  PAGE_TOKEN_TTL_SECONDS,
  AUDIO_TOKEN_TTL_SECONDS,
  SESSION_IDLE_MINUTES,
  LOGIN_IP_LIMIT_PER_MINUTE,
  LOGIN_PAIR_FAIL_LIMIT,
  LOGIN_ACCOUNT_FAIL_LIMIT,
  LOGIN_GLOBAL_FAIL_BUDGET,
  LOGIN_CLEAN_IP_VERIFY_CEILING,
  LOGIN_ACCOUNT_WINDOW_SECONDS,
  MAX_UPLOAD_BYTES,
  MAX_PDF_PAGES,
  SEED_MANIFEST_PATH,
  isDemoPersonasEnabled,
  isFrameEmbedAllowed,
} from "./config.js";

/**
 * Resolves the seeded synthetic demo document.
 * Populated by server.js / seed manifest or explicit env variable.
 */
let demoDocId = null;

function readCachedDemoDocId() {
  if (demoDocId) return demoDocId;
  if (process.env.CV_DEMO_DOCUMENT_ID) return process.env.CV_DEMO_DOCUMENT_ID;
  try {
    if (fs.existsSync(SEED_MANIFEST_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(SEED_MANIFEST_PATH, "utf8"));
      if (parsed?.demoDocumentId) {
        demoDocId = parsed.demoDocumentId;
        return demoDocId;
      }
    }
  } catch {
    /* ignore unreadable manifest */
  }
  return null;
}

export async function requireDemoDocIdAsync() {
  const cached = readCachedDemoDocId();
  if (cached) return cached;
  const docs = await listDocumentsAsync({ role: "admin" });
  return docs.length > 0 ? docs[0].id : null;
}

export function requireDemoDocId() {
  const cached = readCachedDemoDocId();
  if (cached) return cached;
  const syncAdapter = getActivePersistenceAdapterSync();
  if (syncAdapter && syncAdapter.kind === "sqlite") {
    const docs = listDocuments();
    return docs.length > 0 ? docs[0].id : null;
  }
  return null;
}

export function setDemoDocId(id) {
  demoDocId = id;
}

export function extractIp(req) {
  return clientIp(req);
}

export function userAgent(req) {
  return String(req.headers["user-agent"] || "").slice(0, 300);
}

function parseQuery(url) {
  const parsed = new URL(url || "/", "http://localhost");
  const query = Object.create(null);
  parsed.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return query;
}

function decodeHeaderText(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  try {
    return decodeURIComponent(text).trim();
  } catch {
    return text;
  }
}

function safeDocument(doc) {
  if (!doc) return null;
  const { storage_key: _sk, content_hash: _ch, ...publicFields } = doc;
  return publicFields;
}

function extractSessionCookie(req) {
  const cookies = parseCookies(req);
  let sessionId = cookies[SESSION_COOKIE];
  if (!sessionId && isFrameEmbedAllowed()) {
    const fallback = req.headers["x-cv-session"];
    if (typeof fallback === "string" && fallback.length > 0) {
      sessionId = fallback.trim();
    }
  }
  return sessionId || null;
}

/**
 * Resolve the authenticated user from the active server-side persistence backend.
 */
export async function currentUserAsync(req) {
  const sessionId = extractSessionCookie(req);
  if (!sessionId) return null;
  return resolveSessionAsync(sessionId);
}

export function currentUser(req) {
  const sessionId = extractSessionCookie(req);
  if (!sessionId) return null;
  return resolveSession(sessionId);
}

export function requireAuth(req) {
  return currentUser(req) ?? null;
}

export function requireAdmin(req) {
  const user = currentUser(req);
  if (!user) return null;
  return user.role === "admin" ? user : null;
}

async function ensureAdminAsync(req, res, eventName) {
  const user = await currentUserAsync(req);
  if (!user) {
    await auditAsync({
      event: eventName,
      outcome: "deny",
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { reason: "unauthenticated" },
    });
    sendError(res, 401, "not_authenticated", "No valid session.");
    return null;
  }
  if (user.role !== "admin") {
    await auditAsync(
      {
        event: eventName,
        outcome: "deny",
        actorId: user.id,
        actorRole: user.role,
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: { reason: "admin_required" },
      },
      user,
    );
    sendError(res, 403, "admin_required", "Administrator privileges are required.");
    return null;
  }
  return user;
}

function notFound(res) {
  sendError(res, 404, "not_found", "Route not found.");
}

function methodNotAllowed(res, allowed) {
  res.setHeader("Allow", allowed);
  sendError(res, 405, "method_not_allowed", `Allowed methods: ${allowed}.`);
}

function writeTempBuffer(buffer, subdir, ext = "pdf") {
  const tmpDir = path.join(os.tmpdir(), subdir);
  fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const file = path.join(tmpDir, `${crypto.randomBytes(12).toString("hex")}.${ext}`);
  fs.writeFileSync(file, buffer, { mode: 0o600 });
  return file;
}

/* ------------------------------------------------------------------ */
/* Auth routes                                                         */
/* ------------------------------------------------------------------ */

async function handleAuth(req, res) {
  const parsed = new URL(req.url || "/", "http://localhost");
  const match = parsed.pathname.match(/^\/api\/auth\/?(?<action>[a-z0-9_-]+)?$/i);
  const action = match?.groups?.action || null;

  if (action === "login") {
    if (req.method !== "POST") return methodNotAllowed(res, "POST");
    return handleLogin(req, res);
  }
  if (action === "logout") {
    if (req.method !== "POST") return methodNotAllowed(res, "POST");
    return handleLogout(req, res);
  }
  if (action === "me") {
    if (req.method !== "GET") return methodNotAllowed(res, "GET");
    return handleMe(req, res);
  }
  if (action === "register") {
    if (req.method !== "POST") return methodNotAllowed(res, "POST");
    return handleRegister(req, res);
  }
  if (action === "demo-personas") {
    if (req.method !== "GET") return methodNotAllowed(res, "GET");
    return handleDemoPersonas(req, res);
  }
  if (action === "demo-login") {
    if (req.method !== "POST") return methodNotAllowed(res, "POST");
    return handleDemoLogin(req, res);
  }
  return notFound(res);
}

const DEMO_PERSONA_EMAILS = Object.assign(Object.create(null), {
  admin: "admin@strata.local",
  studentA: "aisyah@student.strata.local",
  studentB: "weiming@student.strata.local",
  studentC: "priya@student.strata.local",
});

function issueSessionResponse(req, res, session) {
  const idleSeconds = SESSION_IDLE_MINUTES * 60;
  const secure = isSecureRequest(req);
  const embedMode = isFrameEmbedAllowed();

  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, session.sessionId, {
      maxAge: idleSeconds,
      httpOnly: true,
      secure,
      sameSite: embedMode && secure ? "None" : "Strict",
      partitioned: Boolean(embedMode && secure),
    }),
  );

  const responsePayload = { ok: true, user: session.user };
  if (embedMode) {
    responsePayload.previewSession = session.sessionId;
  }
  return sendJson(res, 200, responsePayload);
}

async function handleDemoPersonas(_req, res) {
  if (!isDemoPersonasEnabled()) {
    return sendError(
      res,
      403,
      "demo_personas_disabled",
      "Demo persona directory is disabled by default. Set CV_ENABLE_DEMO_PERSONAS=1 in local non-production evaluation only.",
      { enabled: false, personas: [] },
    );
  }
  const demoDocIdValue = await requireDemoDocIdAsync();

  // SEC-002: Never include passwords or secrets in API responses.
  return sendJson(res, 200, {
    ok: true,
    enabled: true,
    demoDocumentId: demoDocIdValue,
    personas: [
      {
        id: "admin",
        email: DEMO_PERSONA_EMAILS.admin,
        labelEn: "Administrator",
        labelZh: "平台管理员",
        noteEn: "Upload PDFs, grant/revoke access, audit logs & M007 review",
        noteZh: "上传受保护文档、授权/撤销访问、审计日志及 M007 审阅",
      },
      {
        id: "studentA",
        email: DEMO_PERSONA_EMAILS.studentA,
        labelEn: "Student A · Nurul Aisyah",
        labelZh: "学员 A · Nurul Aisyah",
        noteEn: "Entitled · Unique burned-in watermark A",
        noteZh: "已授权 · 专属服务端像素水印 A",
      },
      {
        id: "studentB",
        email: DEMO_PERSONA_EMAILS.studentB,
        labelEn: "Student B · Tan Wei Ming",
        labelZh: "学员 B · Tan Wei Ming",
        noteEn: "Entitled · Distinct burned-in watermark B",
        noteZh: "已授权 · 独立服务端像素水印 B",
      },
      {
        id: "studentC",
        email: DEMO_PERSONA_EMAILS.studentC,
        labelEn: "Student C · Priya Menon",
        labelZh: "学员 C · Priya Menon",
        noteEn: "Unentitled · Demonstrates 403 access denial",
        noteZh: "未授权 · 演示 403 越权拦截",
      },
    ],
  });
}

async function handleDemoLogin(req, res) {
  if (!isDemoPersonasEnabled()) {
    await auditAsync({
      event: "auth.demo_login",
      outcome: "deny",
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { reason: "demo_personas_disabled" },
    });
    return sendError(
      res,
      403,
      "demo_personas_disabled",
      "Quick-switch demo login is disabled unless CV_ENABLE_DEMO_PERSONAS=1 in non-production.",
    );
  }

  const meta = { ip: extractIp(req), userAgent: userAgent(req) };
  const limiter = await rateLimitAsync(`demologin:ip:${meta.ip}`, LOGIN_IP_LIMIT_PER_MINUTE, 60);
  if (!limiter.allowed) {
    res.setHeader("Retry-After", String(limiter.retryAfter || 60));
    return sendError(res, 429, "rate_limited", "Too many login attempts.");
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendError(res, error.statusCode || 400, "bad_request", error.message);
  }

  const personaId = String(body.personaId || "").trim();
  const targetEmail = DEMO_PERSONA_EMAILS[personaId];
  if (!targetEmail) {
    return sendError(res, 400, "bad_request", "Unknown demo persona identifier.");
  }

  const user = await findUserByEmailAsync({ role: "admin" }, targetEmail);
  if (!user || user.disabled_at || Number(user.is_demo) !== 1) {
    return sendError(res, 404, "demo_account_unavailable", "Seeded demo persona not found.");
  }

  const session = await createSessionForUserAsync(user, {
    ...meta,
    eventDetail: { mode: "demo_persona_switch", personaId },
  });
  return issueSessionResponse(req, res, session);
}

async function handleLogin(req, res) {
  const meta = { ip: extractIp(req), userAgent: userAgent(req) };
  const limiter = await rateLimitAsync(
    `login:ip:${meta.ip}`,
    LOGIN_IP_LIMIT_PER_MINUTE,
    60,
    { protectLockout: true },
  );
  if (!limiter.allowed) {
    await auditAsync({
      event: "auth.login",
      outcome: "deny",
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: { reason: "ip_rate_limited" },
    });
    res.setHeader("Retry-After", String(limiter.retryAfter || 60));
    return sendError(res, 429, "rate_limited", "Too many login attempts.", {
      retryAfter: limiter.retryAfter,
    });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendError(res, error.statusCode || 400, "bad_request", error.message);
  }

  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return sendError(res, 400, "bad_request", "Email and password are required.");
  }

  const normalizedEmail = body.email.trim().toLowerCase().slice(0, 180);
  const windowSec = Number(
    process.env.CV_LOGIN_ACCOUNT_WINDOW_SECONDS || LOGIN_ACCOUNT_WINDOW_SECONDS,
  );
  const pairFailLimit = Number(
    process.env.CV_LOGIN_PAIR_FAIL_LIMIT || LOGIN_PAIR_FAIL_LIMIT,
  );
  const acctFailLimit = Number(
    process.env.CV_LOGIN_ACCOUNT_FAIL_LIMIT || LOGIN_ACCOUNT_FAIL_LIMIT,
  );
  const globalFailBudget = Number(
    process.env.CV_LOGIN_GLOBAL_FAIL_BUDGET ||
      process.env.CV_LOGIN_GLOBAL_CPU_CEILING ||
      LOGIN_GLOBAL_FAIL_BUDGET,
  );
  const cleanIpVerifyCeiling = Number(
    process.env.CV_LOGIN_CLEAN_IP_VERIFY_CEILING || LOGIN_CLEAN_IP_VERIFY_CEILING,
  );

  const pairKey = `login:pair:${meta.ip}:${normalizedEmail}`;
  const acctKey = `login:acct:${normalizedEmail}`;
  const failBudgetKey = `login:acct-fail:${normalizedEmail}`;
  const cleanVerifyKey = `login:acct-clean:${normalizedEmail}`;

  // 1. Per-(IP, Account) pair lockout (`AUD-D2`: `protectLockout: true` prevents spray eviction).
  const pairStatus = await rateLimitAsync(pairKey, pairFailLimit, windowSec, {
    increment: false,
    protectLockout: true,
  });
  if (!pairStatus.allowed) {
    await auditAsync({
      event: "auth.login",
      outcome: "deny",
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: { reason: "ip_account_pair_throttled", email: normalizedEmail },
    });
    res.setHeader("Retry-After", String(pairStatus.retryAfter || windowSec));
    return sendError(
      res,
      429,
      "rate_limited",
      "Too many failed sign-in attempts from this network for this account.",
      { retryAfter: pairStatus.retryAfter },
    );
  }

  // 2. Account-wide failed-attempt velocity & global failure budget checks (`AUD-D1` fix):
  //    - Repeat-offender IPs (`pairStatus.count > 0`) are blocked BEFORE `scrypt` as soon
  //      as the account enters distributed-attack state (`!acctStatus.allowed` or `!failBudget.allowed`).
  //    - Clean IPs (`pairStatus.count === 0`) are NOT locked out by third-party failed attempts!
  //      Instead, clean-IP attempts use a separate bounded verification budget (`cleanVerifyKey`)
  //      plus the process-wide `verifyPasswordAsync` scrypt concurrency semaphore (`503 auth_busy`).
  const acctStatus = await rateLimitAsync(acctKey, acctFailLimit, windowSec, {
    increment: false,
    protectLockout: true,
  });
  const failBudgetStatus = await rateLimitAsync(
    failBudgetKey,
    globalFailBudget,
    windowSec,
    { increment: false, protectLockout: true },
  );

  if (pairStatus.count > 0 && (!acctStatus.allowed || !failBudgetStatus.allowed)) {
    const retrySec =
      acctStatus.retryAfter || failBudgetStatus.retryAfter || windowSec;
    await auditAsync({
      event: "auth.login",
      outcome: "deny",
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: { reason: "account_throttled", email: normalizedEmail },
    });
    res.setHeader("Retry-After", String(retrySec));
    return sendError(
      res,
      429,
      "rate_limited",
      "Account temporarily throttled due to repeated failed sign-in attempts.",
      { retryAfter: retrySec },
    );
  }

  if (pairStatus.count === 0) {
    const cleanBudget = await rateLimitAsync(
      cleanVerifyKey,
      cleanIpVerifyCeiling,
      windowSec,
      { increment: true },
    );
    if (!cleanBudget.allowed) {
      await auditAsync({
        event: "auth.login",
        outcome: "deny",
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { reason: "clean_ip_verify_ceiling", email: normalizedEmail },
      });
      res.setHeader("Retry-After", String(cleanBudget.retryAfter || windowSec));
      return sendError(
        res,
        429,
        "rate_limited",
        "Account sign-in verification capacity temporarily saturated; please retry shortly.",
        { retryAfter: cleanBudget.retryAfter },
      );
    }
  }

  let session;
  try {
    session = await loginAsync({ email: body.email, password: body.password, ...meta });
  } catch (error) {
    if (error?.code === "auth_busy" || error?.statusCode === 503) {
      const retrySec = Number(error.retryAfter || 2);
      await auditAsync({
        event: "auth.login",
        outcome: "deny",
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { reason: "scrypt_backpressure", email: normalizedEmail },
      });
      res.setHeader("Retry-After", String(retrySec));
      return sendError(res, 503, "auth_busy", error.message, { retryAfter: retrySec });
    }
    await auditAsync({
      event: "auth.login",
      outcome: "error",
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: { error: error.message },
    });
    return sendError(res, 400, "login_error", error.message);
  }

  if (!session) {
    await rateLimitAsync(pairKey, pairFailLimit, windowSec, {
      increment: true,
      protectLockout: true,
    });
    const updatedAcct = await rateLimitAsync(acctKey, acctFailLimit, windowSec, {
      increment: true,
      protectLockout: true,
    });
    const updatedFailBudget = await rateLimitAsync(
      failBudgetKey,
      globalFailBudget,
      windowSec,
      { increment: true, protectLockout: true },
    );

    if (
      !acctStatus.allowed ||
      !failBudgetStatus.allowed ||
      (!updatedAcct.allowed && updatedAcct.count > acctFailLimit) ||
      (!updatedFailBudget.allowed && updatedFailBudget.count > globalFailBudget)
    ) {
      const retrySec =
        updatedAcct.retryAfter ||
        acctStatus.retryAfter ||
        updatedFailBudget.retryAfter ||
        windowSec;
      await auditAsync({
        event: "auth.login",
        outcome: "deny",
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { reason: "account_throttled", email: normalizedEmail },
      });
      res.setHeader("Retry-After", String(retrySec));
      return sendError(
        res,
        429,
        "rate_limited",
        "Account temporarily throttled due to repeated failed sign-in attempts.",
        { retryAfter: retrySec },
      );
    }
    return sendError(res, 401, "invalid_credentials", "Email or password is incorrect.");
  }

  await clearRateLimitAsync(pairKey);
  return issueSessionResponse(req, res, session);
}

async function handleLogout(req, res) {
  const meta = { ip: extractIp(req), userAgent: userAgent(req) };
  const sid = extractSessionCookie(req);
  if (sid) {
    await logoutAsync(sid, meta);
  }
  res.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE));
  return sendJson(res, 200, { ok: true });
}

async function handleMe(req, res) {
  const user = await currentUserAsync(req);
  if (!user) {
    return sendError(res, 401, "not_authenticated", "No valid session.");
  }
  return sendJson(res, 200, { ok: true, user });
}

async function handleRegister(req, res) {
  const admin = await ensureAdminAsync(req, res, "admin.user.register");
  if (!admin) return;

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendError(res, error.statusCode || 400, "bad_request", error.message);
  }
  if (
    typeof body.email !== "string" ||
    typeof body.password !== "string" ||
    typeof body.displayName !== "string" ||
    !VALID_ROLES.includes(body.role)
  ) {
    return sendError(
      res,
      400,
      "bad_request",
      "email, password, displayName and role (admin|reviewer|student) are required.",
    );
  }
  try {
    const created = await createUserAsync(admin, {
      email: body.email,
      password: body.password,
      displayName: body.displayName,
      role: body.role,
      locale: body.locale === "zh" ? "zh" : "en",
    });
    await auditAsync(
      {
        event: "admin.user.register",
        outcome: "allow",
        actorId: admin.id,
        actorRole: "admin",
        subjectId: created.id,
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: { email: created.email, role: created.role },
      },
      admin,
    );
    return sendJson(res, 201, { ok: true, user: created });
  } catch (error) {
    await auditAsync(
      {
        event: "admin.user.register",
        outcome: "deny",
        actorId: admin.id,
        actorRole: "admin",
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: { error: error.message },
      },
      admin,
    );
    return sendError(res, 400, "registration_error", error.message);
  }
}

/* ------------------------------------------------------------------ */
/* Document routes                                                     */
/* ------------------------------------------------------------------ */

async function handleDocuments(req, res) {
  if (req.method === "GET") {
    return handleListDocuments(req, res);
  }
  if (req.method === "POST") {
    return handleUploadDocument(req, res);
  }
  return methodNotAllowed(res, "GET, POST");
}

async function handleListDocuments(req, res) {
  const user = await currentUserAsync(req);
  if (!user) {
    return sendError(res, 401, "not_authenticated", "No valid session.");
  }
  const documents =
    user.role === "admin"
      ? await listDocumentsAsync(user)
      : await listReadableDocumentsAsync(user);
  return sendJson(res, 200, { ok: true, documents });
}

async function handleUploadDocument(req, res) {
  const admin = await ensureAdminAsync(req, res, "document.upload");
  if (!admin) return;

  let body;
  try {
    body = await readRawBody(req, MAX_UPLOAD_BYTES);
  } catch (error) {
    return sendError(res, error.statusCode || 400, "bad_request", error.message);
  }

  const titleEn = decodeHeaderText(req.headers["x-title-en"]).slice(0, 200);
  const titleZh = decodeHeaderText(req.headers["x-title-zh"]).slice(0, 200) || null;
  const author = decodeHeaderText(req.headers["x-author"]).slice(0, 160) || null;
  const description =
    decodeHeaderText(req.headers["x-description"]).slice(0, 1000) || null;
  const autoChapter = String(req.headers["x-auto-chapter"] || "") === "1";
  const contentType = String(req.headers["content-type"] || "").toLowerCase();

  if (!titleEn) {
    return sendError(res, 400, "bad_request", "X-Title-En header is required.");
  }
  if (!contentType.includes("application/pdf")) {
    return sendError(res, 400, "bad_request", "Content-Type must be application/pdf.");
  }
  if (body.length < 8 || body.subarray(0, 5).toString("ascii") !== "%PDF-") {
    await auditAsync(
      {
        event: "document.upload",
        outcome: "deny",
        actorId: admin.id,
        actorRole: "admin",
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: { reason: "not_a_pdf_header" },
      },
      admin,
    );
    return sendError(res, 400, "invalid_pdf", "Payload does not have a valid %PDF- header.");
  }

  const stagedFile = writeTempBuffer(body, "cv-uploads", "pdf");
  let probe;
  try {
    probe = await probePdf(stagedFile);
  } catch (error) {
    await auditAsync(
      {
        event: "document.upload",
        outcome: "deny",
        actorId: admin.id,
        actorRole: "admin",
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: { error: error.message },
      },
      admin,
    );
    return sendError(res, 400, "invalid_pdf", error.message);
  } finally {
    try {
      fs.unlinkSync(stagedFile);
    } catch {
      /* ignore cleanup failure */
    }
  }

  if (probe.pageCount > MAX_PDF_PAGES) {
    return sendError(
      res,
      400,
      "too_many_pages",
      `PDF exceeds the ${MAX_PDF_PAGES}-page prototype limit.`,
    );
  }

  try {
    const storage = await putPrivateObject(body, "pdf");
    const document = await createDocumentAsync(admin, {
      titleEn,
      titleZh,
      author,
      description,
      storageKey: storage.key,
      contentHash: storage.contentHash,
      byteSize: storage.byteSize,
      pageCount: probe.pageCount,
      synthetic: true,
      uploadedBy: admin.id,
    });

    if (autoChapter) {
      await addChapterAsync(admin, {
        documentId: document.id,
        ordinal: 1,
        titleEn: "Complete Module",
        titleZh: "完整学习单元",
        startPage: 1,
        endPage: probe.pageCount,
      });
    }

    await auditAsync(
      {
        event: "document.upload",
        outcome: "allow",
        actorId: admin.id,
        actorRole: "admin",
        documentId: document.id,
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: {
          titleEn,
          pageCount: probe.pageCount,
          byteSize: storage.byteSize,
        },
      },
      admin,
    );
    return sendJson(res, 201, { ok: true, document: safeDocument(document) });
  } catch (error) {
    await auditAsync(
      {
        event: "document.upload",
        outcome: "error",
        actorId: admin.id,
        actorRole: "admin",
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: { error: error.message },
      },
      admin,
    );
    return sendError(res, 500, "upload_error", error.message);
  }
}

/* ------------------------------------------------------------------ */
/* Document detail + entitlement management                            */
/* ------------------------------------------------------------------ */

async function handleDocumentDetail(req, res, id) {
  const user = await currentUserAsync(req);
  if (!user) {
    await auditAsync({
      event: "document.open",
      outcome: "deny",
      documentId: id,
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { reason: "unauthenticated" },
    });
    return sendError(res, 401, "not_authenticated", "No valid session.");
  }

  const verdict = await canReadDocumentAsync(user, id);
  if (user.role !== "admin" && !verdict.allowed) {
    await auditAsync(
      {
        event: "document.open",
        outcome: "deny",
        actorId: user.id,
        actorRole: user.role,
        documentId: id,
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: { reason: verdict.reason },
      },
      user,
    );
    return sendError(res, 403, verdict.reason, `Access denied: ${verdict.reason}.`);
  }

  const document = await findDocumentAsync(user, id);
  if (!document || document.archived_at) {
    if (user.role !== "admin") {
      await auditAsync(
        {
          event: "document.open",
          outcome: "deny",
          actorId: user.id,
          actorRole: user.role,
          documentId: id,
          ip: extractIp(req),
          userAgent: userAgent(req),
          detail: { reason: "not_found_or_unauthorized" },
        },
        user,
      );
      return sendError(res, 403, "no_entitlement", "Access denied.");
    }
    return sendError(res, 404, "not_found", "Document not found.");
  }

  const chapters = await listChaptersAsync(user, id);
  const entitlements =
    user.role === "admin" ? await listEntitlementsForDocumentAsync(user, id) : null;
  const progress = await getProgressAsync(user, user.id, id);

  await auditAsync(
    {
      event: "document.open",
      outcome: "allow",
      actorId: user.id,
      actorRole: user.role,
      documentId: id,
      ip: extractIp(req),
      userAgent: userAgent(req),
    },
    user,
  );

  return sendJson(res, 200, {
    ok: true,
    document: safeDocument(document),
    chapters,
    progress,
    canRead: verdict.allowed,
    entitlement: verdict.entitlement
      ? {
          id: verdict.entitlement.id,
          status: verdict.entitlement.status,
          version: verdict.entitlement.version,
          expires_at: verdict.entitlement.expires_at,
        }
      : null,
    entitlements,
  });
}

async function handleGrantAccess(req, res, documentId) {
  const admin = await ensureAdminAsync(req, res, "entitlement.grant");
  if (!admin) return;

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendError(res, error.statusCode || 400, "bad_request", error.message);
  }

  const targetUser = body.userId
    ? await findUserByIdAsync(admin, String(body.userId))
    : await findUserByEmailAsync(admin, body.email);

  if (!targetUser || targetUser.role !== "student") {
    return sendError(res, 404, "student_not_found", "Student account not found.");
  }
  const document = await findDocumentAsync(admin, documentId);
  if (!document) {
    return sendError(res, 404, "not_found", "Document not found.");
  }

  let expiresAt = null;
  if (typeof body.expiresAt === "string" && body.expiresAt.trim()) {
    const parsedTime = Date.parse(body.expiresAt.trim());
    if (!Number.isFinite(parsedTime)) {
      return sendError(res, 400, "bad_request", "expiresAt must be a valid ISO-8601 timestamp.");
    }
    expiresAt = new Date(parsedTime).toISOString();
  }

  try {
    const result = await grantEntitlementAsync(admin, {
      userId: targetUser.id,
      documentId,
      grantedBy: admin.id,
      expiresAt,
      reason: body.reason || "admin_grant",
    });
    return sendJson(res, 200, {
      ok: true,
      entitlement: result.entitlement,
      changed: result.changed,
    });
  } catch (error) {
    await auditAsync(
      {
        event: "entitlement.grant",
        outcome: "deny",
        actorId: admin.id,
        actorRole: "admin",
        subjectId: targetUser.id,
        documentId,
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: { error: error.message },
      },
      admin,
    );
    return sendError(res, 500, "grant_error", error.message);
  }
}

async function handleRevokeAccess(req, res, documentId) {
  const admin = await ensureAdminAsync(req, res, "entitlement.revoke");
  if (!admin) return;

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendError(res, error.statusCode || 400, "bad_request", error.message);
  }

  const targetUser = body.userId
    ? await findUserByIdAsync(admin, String(body.userId))
    : await findUserByEmailAsync(admin, body.email);

  if (!targetUser) {
    return sendError(res, 404, "student_not_found", "Student account not found.");
  }

  const result = await revokeEntitlementAsync(admin, {
    userId: targetUser.id,
    documentId,
    revokedBy: admin.id,
    reason: typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "admin_revoke",
  });

  return sendJson(res, 200, {
    ok: true,
    changed: result.changed,
    reason: result.reason || "revoked",
    entitlement: result.entitlement || null,
  });
}

/* ------------------------------------------------------------------ */
/* Chapter & chapter-audio management                                  */
/* ------------------------------------------------------------------ */

async function handleChapters(req, res, documentId) {
  if (req.method === "GET") {
    const user = await currentUserAsync(req);
    if (!user) {
      return sendError(res, 401, "not_authenticated", "No valid session.");
    }
    if (user.role !== "admin") {
      const verdict = await canReadDocumentAsync(user, documentId);
      if (!verdict.allowed) {
        return sendError(res, 403, verdict.reason, `Access denied: ${verdict.reason}.`);
      }
    }
    return sendJson(res, 200, {
      ok: true,
      chapters: await listChaptersAsync(user, documentId),
    });
  }

  if (req.method === "POST") {
    const admin = await ensureAdminAsync(req, res, "chapter.create");
    if (!admin) return;

    const document = await findDocumentAsync(admin, documentId);
    if (!document) {
      return sendError(res, 404, "not_found", "Document not found.");
    }

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      return sendError(res, error.statusCode || 400, "bad_request", error.message);
    }
    const startPage = Math.max(1, Number(body.startPage || 1));
    const endPage = Math.min(document.page_count, Math.max(startPage, Number(body.endPage || startPage)));
    const chapterId = await addChapterAsync(admin, {
      documentId,
      ordinal: Number(body.ordinal || 1),
      titleEn: String(body.titleEn || "Untitled chapter").trim(),
      titleZh: body.titleZh ? String(body.titleZh).trim() : null,
      startPage,
      endPage,
      audioKey: body.audioKey ?? null,
      audioMime: body.audioMime ?? null,
      audioSeconds: body.audioSeconds ?? null,
    });
    await auditAsync(
      {
        event: "chapter.create",
        outcome: "allow",
        actorId: admin.id,
        actorRole: "admin",
        documentId,
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: { chapterId, startPage, endPage },
      },
      admin,
    );
    return sendJson(res, 201, { ok: true, chapterId });
  }

  return methodNotAllowed(res, "GET, POST");
}

async function handleUploadChapterAudio(req, res, documentId, chapterId) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, "POST");
  }
  const admin = await ensureAdminAsync(req, res, "chapter.audio.upload");
  if (!admin) return;

  const chapter = await findChapterByIdAsync(admin, documentId, chapterId);
  if (!chapter) {
    return sendError(res, 404, "not_found", "Chapter not found.");
  }

  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const allowedMimes = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/ogg"];
  const matchedMime = allowedMimes.find((m) => contentType.includes(m));
  if (!matchedMime) {
    return sendError(
      res,
      400,
      "bad_request",
      "Content-Type must be audio/wav, audio/mpeg, or audio/ogg.",
    );
  }

  let body;
  try {
    body = await readRawBody(req, MAX_UPLOAD_BYTES);
  } catch (error) {
    return sendError(res, error.statusCode || 400, "bad_request", error.message);
  }
  if (!body.length) {
    return sendError(res, 400, "bad_request", "Empty audio payload.");
  }

  const ext = matchedMime.includes("wav")
    ? "wav"
    : matchedMime.includes("ogg")
      ? "ogg"
      : "mp3";
  const canonicalMime = ext === "wav" ? "audio/wav" : ext === "ogg" ? "audio/ogg" : "audio/mpeg";
  const audioSeconds = Number(req.headers["x-audio-seconds"] || 0) || null;

  const stored = await putPrivateObject(body, ext);
  await attachChapterAudioAsync(admin, {
    documentId,
    chapterId,
    audioKey: stored.key,
    audioMime: canonicalMime,
    audioSeconds,
  });

  await auditAsync(
    {
      event: "chapter.audio.upload",
      outcome: "allow",
      actorId: admin.id,
      actorRole: "admin",
      documentId,
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { chapterId, byteSize: stored.byteSize, mime: canonicalMime },
    },
    admin,
  );

  return sendJson(res, 201, {
    ok: true,
    chapterId,
    byteSize: stored.byteSize,
    audioMime: canonicalMime,
  });
}

/* ------------------------------------------------------------------ */
/* Protected page rendering - the primary enforcement boundary         */
/* ------------------------------------------------------------------ */

async function handlePage(req, res, documentId) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, "GET");
  }

  const user = await currentUserAsync(req);
  if (!user) {
    await auditAsync({
      event: "page.render",
      outcome: "deny",
      actorId: null,
      actorRole: null,
      documentId,
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { reason: "unauthenticated" },
    });
    return sendError(res, 401, "not_authenticated", "No valid session.");
  }

  const verdict = await canReadDocumentAsync(user, documentId);
  if (!verdict.allowed) {
    await auditAsync(
      {
        event: "page.render",
        outcome: "deny",
        actorId: user.id,
        actorRole: user.role,
        documentId,
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: { reason: verdict.reason },
      },
      user,
    );
    return sendError(res, 403, verdict.reason, `Access denied: ${verdict.reason}.`);
  }

  const document = await findDocumentAsync(user, documentId);
  if (!document || document.archived_at) {
    return sendError(res, 404, "not_found", "Document not found.");
  }

  const query = parseQuery(req.url);
  const rawPage = req.headers["x-page"] ?? query.page ?? 1;
  const page = Number(rawPage);
  if (!Number.isInteger(page) || page < 1 || page > document.page_count) {
    return sendError(
      res,
      400,
      "bad_page",
      `Page must be an integer between 1 and ${document.page_count}.`,
    );
  }

  const entitlement = verdict.entitlement;

  // SEC-005: Verify signature, purpose, expiry, subject, document, page, entitlement version,
  // AND atomically redeem its jti in the active logged database ledger (`token_redemptions`).
  if (query.token !== undefined) {
    try {
      const claims = await redeemPageTokenAsync(query.token);
      if (
        claims.sub !== user.id ||
        claims.doc !== documentId ||
        Number(claims.page) !== page ||
        Number(claims.ent) !== Number(entitlement.version)
      ) {
        await auditAsync(
          {
            event: "page.render",
            outcome: "deny",
            actorId: user.id,
            actorRole: user.role,
            documentId,
            page,
            ip: extractIp(req),
            userAgent: userAgent(req),
            detail: { reason: "page_token_claim_mismatch" },
          },
          user,
        );
        return sendError(
          res,
          403,
          "invalid_page_token",
          "Page token does not match current session or entitlement.",
        );
      }
    } catch (error) {
      const errCode = error.code === "token_replayed" ? "token_replayed" : "invalid_page_token";
      await auditAsync(
        {
          event: "page.render",
          outcome: "deny",
          actorId: user.id,
          actorRole: user.role,
          documentId,
          page,
          ip: extractIp(req),
          userAgent: userAgent(req),
          detail: { reason: error.code || "invalid_page_token" },
        },
        user,
      );
      return sendError(res, 403, errCode, error.message);
    }
  }

  const limiter = await rateLimitAsync(`page:${user.id}`, 180, 60);
  if (!limiter.allowed) {
    res.setHeader("Retry-After", String(limiter.retryAfter || 60));
    return sendError(res, 429, "rate_limited", "Too many page requests.");
  }

  if (!privateObjectExists(document.storage_key)) {
    return sendError(res, 404, "not_found", "Stored document is unavailable.");
  }
  const absolutePdfPath = keyToPath(document.storage_key);

  const token = issuePageToken(user, documentId, page, entitlement.version);
  const tokenExpiresAt = new Date(
    Date.now() + PAGE_TOKEN_TTL_SECONDS * 1000,
  ).toISOString();

  const chapter = await findChapterForPageAsync(user, documentId, page);
  const audioToken =
    chapter && chapter.audio_key
      ? issueAudioToken(user, documentId, page, entitlement.version, chapter.id)
      : null;

  try {
    // Identity ALWAYS comes from the server-side authenticated user row.
    const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const result = await renderWatermarkedPage({
      absolutePath: absolutePdfPath,
      page,
      contentHash: document.content_hash,
      userId: user.id,
      identity: {
        label: user.display_name,
        ref: user.id,
        stamp,
      },
    });

    await recordProgressAsync(user, {
      userId: user.id,
      documentId,
      page,
      pageCount: document.page_count,
    });

    await auditAsync(
      {
        event: "page.render",
        outcome: "allow",
        actorId: user.id,
        actorRole: user.role,
        documentId,
        page,
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: {
          sha256: result.sha256,
          renderMs: result.renderMs,
          cacheHit: result.cacheHit,
        },
      },
      user,
    );

    const extraHeaders = {
      ...protectedAssetHeaders(),
      "X-Page-Number": String(page),
      "X-Page-Count": String(document.page_count),
      "X-Page-Token": token,
      "X-Page-Token-Expires": tokenExpiresAt,
      "X-Content-Watermark": "STRATA per-student burned-in mark",
    };
    if (audioToken) {
      extraHeaders["X-Audio-Token"] = audioToken;
      extraHeaders["X-Audio-Token-Expires"] = new Date(
        Date.now() + AUDIO_TOKEN_TTL_SECONDS * 1000,
      ).toISOString();
    }

    return sendBuffer(res, 200, result.buffer, "image/png", extraHeaders);
  } catch (error) {
    const status = Number(error.statusCode) || 500;
    const errCode = error.code || "render_error";
    if (error.retryAfter) {
      res.setHeader("Retry-After", String(error.retryAfter));
    }
    await auditAsync(
      {
        event: "page.render",
        outcome: status === 429 || status === 503 ? "deny" : "error",
        actorId: user.id,
        actorRole: user.role,
        documentId,
        page,
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: { code: errCode, error: error.message },
      },
      user,
    );
    return sendError(res, status, errCode, error.message);
  }
}

/* ------------------------------------------------------------------ */
/* Protected audio playback (with HTTP Range support)                  */
/* ------------------------------------------------------------------ */

async function handleAudio(req, res, documentId) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, "GET");
  }

  const user = await currentUserAsync(req);
  if (!user) {
    await auditAsync({
      event: "audio.play",
      outcome: "deny",
      actorId: null,
      actorRole: null,
      documentId,
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { reason: "unauthenticated" },
    });
    return sendError(res, 401, "not_authenticated", "No valid session.");
  }

  const verdict = await canReadDocumentAsync(user, documentId);
  if (!verdict.allowed) {
    await auditAsync(
      {
        event: "audio.play",
        outcome: "deny",
        actorId: user.id,
        actorRole: user.role,
        documentId,
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: { reason: verdict.reason },
      },
      user,
    );
    return sendError(res, 403, verdict.reason, `Access denied: ${verdict.reason}.`);
  }

  const query = parseQuery(req.url);
  const page = Number(req.headers["x-page"] ?? query.page ?? 1);
  const chapter = query.chapter
    ? await findChapterByIdAsync(user, documentId, String(query.chapter))
    : await findChapterForPageAsync(
        user,
        documentId,
        Number.isFinite(page) && page >= 1 ? page : 1,
      );

  if (query.token !== undefined) {
    try {
      const claims = verifyAudioToken(query.token);
      const chapterMismatch =
        Boolean(claims.ch) && Boolean(chapter) && String(claims.ch) !== String(chapter.id);
      if (
        claims.sub !== user.id ||
        claims.doc !== documentId ||
        Number(claims.ent) !== Number(verdict.entitlement.version) ||
        chapterMismatch
      ) {
        await auditAsync(
          {
            event: "audio.play",
            outcome: "deny",
            actorId: user.id,
            actorRole: user.role,
            documentId,
            ip: extractIp(req),
            userAgent: userAgent(req),
            detail: { reason: "audio_token_claim_mismatch" },
          },
          user,
        );
        return sendError(
          res,
          403,
          "invalid_audio_token",
          "Audio token is not valid for this session or chapter.",
        );
      }
    } catch (error) {
      await auditAsync(
        {
          event: "audio.play",
          outcome: "deny",
          actorId: user.id,
          actorRole: user.role,
          documentId,
          ip: extractIp(req),
          userAgent: userAgent(req),
          detail: { reason: error.code || "invalid_audio_token" },
        },
        user,
      );
      return sendError(res, 403, "invalid_audio_token", error.message);
    }
  }

  if (!chapter || !chapter.audio_key) {
    return sendError(res, 404, "no_audio", "No audio track is attached to this section.");
  }

  let audioBuffer;
  try {
    audioBuffer = readPrivateObjectSync(chapter.audio_key);
  } catch {
    return sendError(res, 404, "not_found", "Audio object unavailable.");
  }

  const total = audioBuffer.length;
  const mime = chapter.audio_mime || "audio/wav";
  const rangeHeader = req.headers.range;

  const isInitialOrStart = !rangeHeader || /^bytes=0-/i.test(String(rangeHeader));
  if (isInitialOrStart) {
    await auditAsync(
      {
        event: "audio.play",
        outcome: "allow",
        actorId: user.id,
        actorRole: user.role,
        documentId,
        page: Number.isFinite(page) ? page : chapter.start_page,
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: { chapterId: chapter.id, ordinal: chapter.ordinal },
      },
      user,
    );
  }

  if (typeof rangeHeader === "string" && rangeHeader.startsWith("bytes=")) {
    const match = rangeHeader.replace(/bytes=/, "").split("-");
    const start = Number.parseInt(match[0], 10);
    const end = match[1] ? Number.parseInt(match[1], 10) : total - 1;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end >= total ||
      start > end
    ) {
      res.writeHead(416, {
        "Content-Range": `bytes */${total}`,
        ...protectedAssetHeaders(),
      });
      res.end();
      return;
    }
    const slice = audioBuffer.subarray(start, end + 1);
    return sendBuffer(res, 206, slice, mime, {
      ...protectedAssetHeaders(),
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${total}`,
    });
  }

  return sendBuffer(res, 200, audioBuffer, mime, {
    ...protectedAssetHeaders(),
    "Accept-Ranges": "bytes",
  });
}

/* ------------------------------------------------------------------ */
/* Reading progress                                                    */
/* ------------------------------------------------------------------ */

async function handleProgress(req, res, documentId) {
  const user = await currentUserAsync(req);
  if (!user) {
    return sendError(res, 401, "not_authenticated", "No valid session.");
  }
  const verdict = await canReadDocumentAsync(user, documentId);
  if (!verdict.allowed) {
    return sendError(res, 403, verdict.reason, `Access denied: ${verdict.reason}.`);
  }
  const document = await findDocumentAsync(user, documentId);
  if (!document) {
    return sendError(res, 404, "not_found", "Document not found.");
  }

  if (req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      progress: (await getProgressAsync(user, user.id, documentId)) || {
        last_page: 1,
        pages_read: 0,
        updated_at: null,
      },
    });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      return sendError(res, error.statusCode || 400, "bad_request", error.message);
    }
    const page = Number(body.page || 1);
    if (!Number.isInteger(page) || page < 1 || page > document.page_count) {
      return sendError(
        res,
        400,
        "bad_page",
        `Page must be between 1 and ${document.page_count}.`,
      );
    }
    await recordProgressAsync(user, {
      userId: user.id,
      documentId,
      page,
      pageCount: document.page_count,
    });
    return sendJson(res, 200, {
      ok: true,
      progress: await getProgressAsync(user, user.id, documentId),
    });
  }

  return methodNotAllowed(res, "GET, POST");
}

/* ------------------------------------------------------------------ */
/* Admin diagnostics, users, audit log & engine selftest               */
/* ------------------------------------------------------------------ */

async function handleAdminStats(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  const admin = await ensureAdminAsync(req, res, "admin.stats");
  if (!admin) return;

  const adapter = await getPersistenceAdapter();
  const stats = await adapter.getAdminStats(admin);

  return sendJson(res, 200, {
    ok: true,
    ...stats,
    backend: adapter.kind,
    timestamp: nowIso(),
  });
}

async function handleAdminUsers(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  const admin = await ensureAdminAsync(req, res, "admin.users.list");
  if (!admin) return;

  return sendJson(res, 200, {
    ok: true,
    users: await listUsersAsync(admin),
  });
}

async function handleAdminAudit(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  const admin = await ensureAdminAsync(req, res, "admin.audit.list");
  if (!admin) return;

  const query = parseQuery(req.url);
  const entries = await listAuditAsync(admin, {
    limit: query.limit ? Number(query.limit) : 100,
    documentId: query.documentId || null,
    event: query.event || null,
    outcome: query.outcome || null,
  });

  return sendJson(res, 200, {
    ok: true,
    entries,
  });
}

async function handleEngineSelftest(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  const admin = await ensureAdminAsync(req, res, "admin.engine.selftest");
  if (!admin) return;

  const targetId = await requireDemoDocIdAsync();
  if (!targetId) {
    return sendError(res, 404, "not_found", "No document available for self-test.");
  }
  const doc = await findDocumentAsync(admin, targetId);
  if (!doc || !privateObjectExists(doc.storage_key)) {
    return sendError(res, 404, "not_found", "Document storage object not found.");
  }

  const testPage = Math.min(2, Math.max(1, doc.page_count));
  const report = await engineSelftest(keyToPath(doc.storage_key), testPage, 96);

  await auditAsync(
    {
      event: "admin.engine.selftest",
      outcome: "info",
      actorId: admin.id,
      actorRole: "admin",
      documentId: doc.id,
      page: testPage,
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: {
        watermarkedOutputsDiffer: report.watermarkedOutputsDiffer,
        watermarkChangesPixels: report.watermarkChangesPixels,
        shaA: report.shaA,
        shaB: report.shaB,
      },
    },
    admin,
  );

  return sendJson(res, 200, {
    ok: true,
    engine: report.engine || "pypdfium2",
    documentId: doc.id,
    page: testPage,
    watermarkIdentityBound: report.watermarkedOutputsDiffer,
    watermarkChangesPixels: report.watermarkChangesPixels,
    shaA: report.shaA,
    shaB: report.shaB,
    shaClean: report.shaClean,
    watermarkA: report.watermarkA,
    watermarkB: report.watermarkB,
    renderMs: report.renderMsA,
  });
}

export {
  canViewPortfolio,
  handleAuth,
  handleDocuments,
  handleDocumentDetail,
  handleGrantAccess,
  handleRevokeAccess,
  handleChapters,
  handleUploadChapterAudio,
  handlePage,
  handleAudio,
  handleProgress,
  handleAdminStats,
  handleAdminUsers,
  handleAdminAudit,
  handleEngineSelftest,
};

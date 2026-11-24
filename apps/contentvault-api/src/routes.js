/**
 * ContentVault HTTP routes.
 *
 * Core security principle: the client's only authenticated identity is the
 * server-side session (`cv_session` cookie), resolved in SQLite on every
 * request. No client field, query parameter, or custom identity header is
 * ever trusted as a user identity or role.
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
  rateLimit,
  clearRateLimit,
  clientIp,
  protectedAssetHeaders,
} from "./http/helpers.js";
import {
  SESSION_COOKIE,
  VALID_ROLES,
  createUser,
  findUserById,
  findUserByEmail,
  listUsers,
  login,
  createSessionForUser,
  logout,
  resolveSession,
  canViewPortfolio,
  canReadDocument,
  issuePageToken,
  redeemPageToken,
  issueAudioToken,
  verifyAudioToken,
} from "./security/authz.js";
import {
  grantEntitlement,
  revokeEntitlement,
  findDocument,
  listReadableDocuments,
  listDocuments,
  createDocument,
  addChapter,
  listChapters,
  findChapterForPage,
  findChapterById,
  attachChapterAudio,
  recordProgress,
  getProgress,
  listEntitlementsForDocument,
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
import { audit, listAudit } from "./security/audit.js";
import { getDb, nowIso } from "./db.js";
import {
  PAGE_TOKEN_TTL_SECONDS,
  AUDIO_TOKEN_TTL_SECONDS,
  SESSION_IDLE_MINUTES,
  LOGIN_IP_LIMIT_PER_MINUTE,
  LOGIN_PAIR_FAIL_LIMIT,
  LOGIN_ACCOUNT_FAIL_LIMIT,
  LOGIN_GLOBAL_CPU_CEILING,
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

export function requireDemoDocId() {
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
  const docs = listDocuments();
  return docs.length > 0 ? docs[0].id : null;
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

/**
 * Resolve the authenticated user from the server-side session.
 * Returns null if there is no valid session.
 */
export function currentUser(req) {
  const cookies = parseCookies(req);
  let sessionId = cookies[SESSION_COOKIE];
  if (!sessionId && isFrameEmbedAllowed()) {
    const fallback = req.headers["x-cv-session"];
    if (typeof fallback === "string" && fallback.length > 0) {
      sessionId = fallback.trim();
    }
  }
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

function ensureAdmin(req, res, eventName) {
  const user = currentUser(req);
  if (!user) {
    audit({
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
    audit({
      event: eventName,
      outcome: "deny",
      actorId: user.id,
      actorRole: user.role,
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { reason: "admin_required" },
    });
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
  fs.mkdirSync(tmpDir, { recursive: true });
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

function handleDemoPersonas(_req, res) {
  if (!isDemoPersonasEnabled()) {
    return sendError(
      res,
      403,
      "demo_personas_disabled",
      "Demo persona directory is disabled by default. Set CV_ENABLE_DEMO_PERSONAS=1 in local non-production evaluation only.",
      { enabled: false, personas: [] },
    );
  }
  const demoDocIdValue = requireDemoDocId();

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
    audit({
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
  const limiter = rateLimit(`demologin:ip:${meta.ip}`, LOGIN_IP_LIMIT_PER_MINUTE, 60);
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

  const user = findUserByEmail(targetEmail);
  if (!user || user.disabled_at || Number(user.is_demo) !== 1) {
    return sendError(res, 404, "demo_account_unavailable", "Seeded demo persona not found.");
  }

  const session = createSessionForUser(user, {
    ...meta,
    eventDetail: { mode: "demo_persona_switch", personaId },
  });
  return issueSessionResponse(req, res, session);
}

async function handleLogin(req, res) {
  const meta = { ip: extractIp(req), userAgent: userAgent(req) };
  const limiter = rateLimit(`login:ip:${meta.ip}`, LOGIN_IP_LIMIT_PER_MINUTE, 60);
  if (!limiter.allowed) {
    audit({
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
  const pairKey = `login:pair:${meta.ip}:${normalizedEmail}`;
  const acctKey = `login:acct:${normalizedEmail}`;
  const cpuKey = `login:acct-cpu:${normalizedEmail}`;

  // 1. Per-(IP, Account) pair throttle blocks single-source brute force without
  //    locking out the legitimate account owner signing in from a clean network.
  const pairStatus = rateLimit(
    pairKey,
    LOGIN_PAIR_FAIL_LIMIT,
    LOGIN_ACCOUNT_WINDOW_SECONDS,
    { increment: false },
  );
  if (!pairStatus.allowed) {
    audit({
      event: "auth.login",
      outcome: "deny",
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: { reason: "ip_account_pair_throttled", email: normalizedEmail },
    });
    res.setHeader("Retry-After", String(pairStatus.retryAfter || LOGIN_ACCOUNT_WINDOW_SECONDS));
    return sendError(
      res,
      429,
      "rate_limited",
      "Too many failed sign-in attempts from this network for this account.",
      { retryAfter: pairStatus.retryAfter },
    );
  }

  // 2. Hard global scrypt CPU ceiling per account protects worker CPU against huge botnets.
  const cpuStatus = rateLimit(
    cpuKey,
    LOGIN_GLOBAL_CPU_CEILING,
    LOGIN_ACCOUNT_WINDOW_SECONDS,
    { increment: true },
  );
  if (!cpuStatus.allowed) {
    audit({
      event: "auth.login",
      outcome: "deny",
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: { reason: "account_cpu_ceiling", email: normalizedEmail },
    });
    res.setHeader("Retry-After", String(cpuStatus.retryAfter || LOGIN_ACCOUNT_WINDOW_SECONDS));
    return sendError(
      res,
      429,
      "rate_limited",
      "Account sign-in capacity temporarily saturated; please retry shortly.",
      { retryAfter: cpuStatus.retryAfter },
    );
  }

  // 3. Distributed account velocity check:
  //    - If global failed attempts exceed LOGIN_ACCOUNT_FAIL_LIMIT AND this IP already
  //      failed at least once (`pairStatus.count > 0`), reject immediately with 429.
  //    - If this IP has zero prior failures (`pairStatus.count === 0`), verify password
  //      so the legitimate user is NOT DoS-locked out by third-party spray attacks,
  //      while returning 429 immediately if the password from the new IP is also wrong!
  const acctStatus = rateLimit(
    acctKey,
    LOGIN_ACCOUNT_FAIL_LIMIT,
    LOGIN_ACCOUNT_WINDOW_SECONDS,
    { increment: false },
  );
  if (!acctStatus.allowed && pairStatus.count > 0) {
    audit({
      event: "auth.login",
      outcome: "deny",
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: { reason: "account_throttled", email: normalizedEmail },
    });
    res.setHeader("Retry-After", String(acctStatus.retryAfter || LOGIN_ACCOUNT_WINDOW_SECONDS));
    return sendError(
      res,
      429,
      "rate_limited",
      "Account temporarily throttled due to repeated failed sign-in attempts.",
      { retryAfter: acctStatus.retryAfter },
    );
  }

  let session;
  try {
    session = login({ email: body.email, password: body.password, ...meta });
  } catch (error) {
    audit({
      event: "auth.login",
      outcome: "error",
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: { error: error.message },
    });
    return sendError(res, 400, "login_error", error.message);
  }

  if (!session) {
    rateLimit(pairKey, LOGIN_PAIR_FAIL_LIMIT, LOGIN_ACCOUNT_WINDOW_SECONDS, {
      increment: true,
    });
    const updatedAcct = rateLimit(
      acctKey,
      LOGIN_ACCOUNT_FAIL_LIMIT,
      LOGIN_ACCOUNT_WINDOW_SECONDS,
      { increment: true },
    );
    if (!acctStatus.allowed || !updatedAcct.allowed && updatedAcct.count > LOGIN_ACCOUNT_FAIL_LIMIT) {
      audit({
        event: "auth.login",
        outcome: "deny",
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { reason: "account_throttled", email: normalizedEmail },
      });
      res.setHeader(
        "Retry-After",
        String(updatedAcct.retryAfter || acctStatus.retryAfter || LOGIN_ACCOUNT_WINDOW_SECONDS),
      );
      return sendError(
        res,
        429,
        "rate_limited",
        "Account temporarily throttled due to repeated failed sign-in attempts.",
        { retryAfter: updatedAcct.retryAfter || LOGIN_ACCOUNT_WINDOW_SECONDS },
      );
    }
    return sendError(res, 401, "invalid_credentials", "Email or password is incorrect.");
  }

  // Clear ONLY this legitimate caller's (IP, Account) pair counter — never clear
  // global/other-IP lockout counters so an active distributed attacker stays throttled.
  clearRateLimit(pairKey);
  return issueSessionResponse(req, res, session);
}

async function handleLogout(req, res) {
  const meta = { ip: extractIp(req), userAgent: userAgent(req) };
  const cookies = parseCookies(req);
  const sid =
    cookies[SESSION_COOKIE] ||
    (isFrameEmbedAllowed()
      ? String(req.headers["x-cv-session"] || "").trim()
      : "");
  if (sid) {
    logout(sid, meta);
  }
  res.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE));
  return sendJson(res, 200, { ok: true });
}

async function handleMe(req, res) {
  const user = currentUser(req);
  if (!user) {
    return sendError(res, 401, "not_authenticated", "No valid session.");
  }
  return sendJson(res, 200, { ok: true, user });
}

async function handleRegister(req, res) {
  const admin = ensureAdmin(req, res, "admin.user.register");
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
    const created = createUser({
      email: body.email,
      password: body.password,
      displayName: body.displayName,
      role: body.role,
      locale: body.locale === "zh" ? "zh" : "en",
    });
    audit({
      event: "admin.user.register",
      outcome: "allow",
      actorId: admin.id,
      actorRole: "admin",
      subjectId: created.id,
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { email: created.email, role: created.role },
    });
    return sendJson(res, 201, { ok: true, user: created });
  } catch (error) {
    audit({
      event: "admin.user.register",
      outcome: "deny",
      actorId: admin.id,
      actorRole: "admin",
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { error: error.message },
    });
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
  const user = currentUser(req);
  if (!user) {
    return sendError(res, 401, "not_authenticated", "No valid session.");
  }
  const documents =
    user.role === "admin" ? listDocuments() : listReadableDocuments(user);
  return sendJson(res, 200, { ok: true, documents });
}

async function handleUploadDocument(req, res) {
  const admin = ensureAdmin(req, res, "document.upload");
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
    audit({
      event: "document.upload",
      outcome: "deny",
      actorId: admin.id,
      actorRole: "admin",
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { reason: "not_a_pdf_header" },
    });
    return sendError(res, 400, "invalid_pdf", "Payload does not have a valid %PDF- header.");
  }

  const stagedFile = writeTempBuffer(body, "cv-uploads", "pdf");
  let probe;
  try {
    probe = await probePdf(stagedFile);
  } catch (error) {
    audit({
      event: "document.upload",
      outcome: "deny",
      actorId: admin.id,
      actorRole: "admin",
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { error: error.message },
    });
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
    const document = createDocument({
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
      addChapter({
        documentId: document.id,
        ordinal: 1,
        titleEn: "Complete Module",
        titleZh: "完整学习单元",
        startPage: 1,
        endPage: probe.pageCount,
      });
    }

    audit({
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
    });
    return sendJson(res, 201, { ok: true, document: safeDocument(document) });
  } catch (error) {
    audit({
      event: "document.upload",
      outcome: "error",
      actorId: admin.id,
      actorRole: "admin",
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { error: error.message },
    });
    return sendError(res, 500, "upload_error", error.message);
  }
}

/* ------------------------------------------------------------------ */
/* Document detail + entitlement management                            */
/* ------------------------------------------------------------------ */

async function handleDocumentDetail(req, res, id) {
  const user = currentUser(req);
  if (!user) {
    audit({
      event: "document.open",
      outcome: "deny",
      documentId: id,
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { reason: "unauthenticated" },
    });
    return sendError(res, 401, "not_authenticated", "No valid session.");
  }

  const document = findDocument(id);
  if (!document || document.archived_at) {
    if (user.role !== "admin") {
      audit({
        event: "document.open",
        outcome: "deny",
        actorId: user.id,
        actorRole: user.role,
        documentId: id,
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: { reason: "not_found_or_unauthorized" },
      });
      return sendError(res, 403, "no_entitlement", "Access denied.");
    }
    return sendError(res, 404, "not_found", "Document not found.");
  }

  const verdict = canReadDocument(user, id);
  if (user.role !== "admin" && !verdict.allowed) {
    audit({
      event: "document.open",
      outcome: "deny",
      actorId: user.id,
      actorRole: user.role,
      documentId: id,
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { reason: verdict.reason },
    });
    return sendError(res, 403, verdict.reason, `Access denied: ${verdict.reason}.`);
  }

  const chapters = listChapters(id);
  const entitlements =
    user.role === "admin" ? listEntitlementsForDocument(id) : null;
  const progress = getProgress(user.id, id);

  audit({
    event: "document.open",
    outcome: "allow",
    actorId: user.id,
    actorRole: user.role,
    documentId: id,
    ip: extractIp(req),
    userAgent: userAgent(req),
  });

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
  const admin = ensureAdmin(req, res, "entitlement.grant");
  if (!admin) return;

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendError(res, error.statusCode || 400, "bad_request", error.message);
  }

  const targetUser = body.userId
    ? findUserById(String(body.userId))
    : findUserByEmail(body.email);

  if (!targetUser || targetUser.role !== "student") {
    return sendError(res, 404, "student_not_found", "Student account not found.");
  }
  const document = findDocument(documentId);
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
    const result = grantEntitlement({
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
    audit({
      event: "entitlement.grant",
      outcome: "deny",
      actorId: admin.id,
      actorRole: "admin",
      subjectId: targetUser.id,
      documentId,
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { error: error.message },
    });
    return sendError(res, 500, "grant_error", error.message);
  }
}

async function handleRevokeAccess(req, res, documentId) {
  const admin = ensureAdmin(req, res, "entitlement.revoke");
  if (!admin) return;

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendError(res, error.statusCode || 400, "bad_request", error.message);
  }

  const targetUser = body.userId
    ? findUserById(String(body.userId))
    : findUserByEmail(body.email);

  if (!targetUser) {
    return sendError(res, 404, "student_not_found", "Student account not found.");
  }

  const result = revokeEntitlement({
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
    const user = currentUser(req);
    if (!user) {
      return sendError(res, 401, "not_authenticated", "No valid session.");
    }
    if (user.role !== "admin") {
      const verdict = canReadDocument(user, documentId);
      if (!verdict.allowed) {
        return sendError(res, 403, verdict.reason, `Access denied: ${verdict.reason}.`);
      }
    }
    return sendJson(res, 200, { ok: true, chapters: listChapters(documentId) });
  }

  if (req.method === "POST") {
    const admin = ensureAdmin(req, res, "chapter.create");
    if (!admin) return;

    const document = findDocument(documentId);
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
    const chapterId = addChapter({
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
    audit({
      event: "chapter.create",
      outcome: "allow",
      actorId: admin.id,
      actorRole: "admin",
      documentId,
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { chapterId, startPage, endPage },
    });
    return sendJson(res, 201, { ok: true, chapterId });
  }

  return methodNotAllowed(res, "GET, POST");
}

async function handleUploadChapterAudio(req, res, documentId, chapterId) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, "POST");
  }
  const admin = ensureAdmin(req, res, "chapter.audio.upload");
  if (!admin) return;

  const chapter = findChapterById(documentId, chapterId);
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
  attachChapterAudio({
    documentId,
    chapterId,
    audioKey: stored.key,
    audioMime: canonicalMime,
    audioSeconds,
  });

  audit({
    event: "chapter.audio.upload",
    outcome: "allow",
    actorId: admin.id,
    actorRole: "admin",
    documentId,
    ip: extractIp(req),
    userAgent: userAgent(req),
    detail: { chapterId, byteSize: stored.byteSize, mime: canonicalMime },
  });

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

  const user = currentUser(req);
  if (!user) {
    audit({
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

  const verdict = canReadDocument(user, documentId);
  if (!verdict.allowed) {
    audit({
      event: "page.render",
      outcome: "deny",
      actorId: user.id,
      actorRole: user.role,
      documentId,
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { reason: verdict.reason },
    });
    return sendError(res, 403, verdict.reason, `Access denied: ${verdict.reason}.`);
  }

  const document = findDocument(documentId);
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

  // SEC-005: When a signed page token is supplied, verify signature, purpose,
  // expiry, subject identity, document, page, current entitlement version, AND
  // atomically redeem its jti so each X-Page-Token is strictly single-use.
  if (query.token !== undefined) {
    try {
      const claims = redeemPageToken(query.token);
      if (
        claims.sub !== user.id ||
        claims.doc !== documentId ||
        Number(claims.page) !== page ||
        Number(claims.ent) !== Number(entitlement.version)
      ) {
        audit({
          event: "page.render",
          outcome: "deny",
          actorId: user.id,
          actorRole: user.role,
          documentId,
          page,
          ip: extractIp(req),
          userAgent: userAgent(req),
          detail: { reason: "page_token_claim_mismatch" },
        });
        return sendError(res, 403, "invalid_page_token", "Page token does not match current session or entitlement.");
      }
    } catch (error) {
      const errCode = error.code === "token_replayed" ? "token_replayed" : "invalid_page_token";
      audit({
        event: "page.render",
        outcome: "deny",
        actorId: user.id,
        actorRole: user.role,
        documentId,
        page,
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: { reason: error.code || "invalid_page_token" },
      });
      return sendError(res, 403, errCode, error.message);
    }
  }

  const limiter = rateLimit(`page:${user.id}`, 180, 60);
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

  const chapter = findChapterForPage(documentId, page);
  const audioToken =
    chapter && chapter.audio_key
      ? issueAudioToken(user, documentId, page, entitlement.version, chapter.id)
      : null;

  try {
    // Identity ALWAYS comes from the server-side authenticated user row.
    // Client-supplied headers/query fields (userId, watermark, etc.) are ignored.
    const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const result = await renderWatermarkedPage({
      absolutePath: absolutePdfPath,
      page,
      contentHash: document.content_hash,
      identity: {
        label: user.display_name,
        ref: user.id,
        stamp,
      },
    });

    recordProgress({
      userId: user.id,
      documentId,
      page,
      pageCount: document.page_count,
    });

    audit({
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
    });

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
    audit({
      event: "page.render",
      outcome: "error",
      actorId: user.id,
      actorRole: user.role,
      documentId,
      page,
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { error: error.message },
    });
    return sendError(res, 500, "render_error", error.message);
  }
}

/* ------------------------------------------------------------------ */
/* Protected audio playback (with HTTP Range support)                  */
/* ------------------------------------------------------------------ */

async function handleAudio(req, res, documentId) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, "GET");
  }

  const user = currentUser(req);
  if (!user) {
    audit({
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

  const verdict = canReadDocument(user, documentId);
  if (!verdict.allowed) {
    audit({
      event: "audio.play",
      outcome: "deny",
      actorId: user.id,
      actorRole: user.role,
      documentId,
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { reason: verdict.reason },
    });
    return sendError(res, 403, verdict.reason, `Access denied: ${verdict.reason}.`);
  }

  const query = parseQuery(req.url);
  const page = Number(req.headers["x-page"] ?? query.page ?? 1);
  const chapter = query.chapter
    ? findChapterById(documentId, String(query.chapter))
    : findChapterForPage(documentId, Number.isFinite(page) && page >= 1 ? page : 1);

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
        audit({
          event: "audio.play",
          outcome: "deny",
          actorId: user.id,
          actorRole: user.role,
          documentId,
          ip: extractIp(req),
          userAgent: userAgent(req),
          detail: { reason: "audio_token_claim_mismatch" },
        });
        return sendError(res, 403, "invalid_audio_token", "Audio token is not valid for this session or chapter.");
      }
    } catch (error) {
      audit({
        event: "audio.play",
        outcome: "deny",
        actorId: user.id,
        actorRole: user.role,
        documentId,
        ip: extractIp(req),
        userAgent: userAgent(req),
        detail: { reason: error.code || "invalid_audio_token" },
      });
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

  // Record audit entry on initial audio fetch or byte=0 start to avoid spamming every scrub chunk.
  const isInitialOrStart = !rangeHeader || /^bytes=0-/i.test(String(rangeHeader));
  if (isInitialOrStart) {
    audit({
      event: "audio.play",
      outcome: "allow",
      actorId: user.id,
      actorRole: user.role,
      documentId,
      page: Number.isFinite(page) ? page : chapter.start_page,
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { chapterId: chapter.id, ordinal: chapter.ordinal },
    });
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
  const user = currentUser(req);
  if (!user) {
    return sendError(res, 401, "not_authenticated", "No valid session.");
  }
  const verdict = canReadDocument(user, documentId);
  if (!verdict.allowed) {
    return sendError(res, 403, verdict.reason, `Access denied: ${verdict.reason}.`);
  }
  const document = findDocument(documentId);
  if (!document) {
    return sendError(res, 404, "not_found", "Document not found.");
  }

  if (req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      progress: getProgress(user.id, documentId) || {
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
    recordProgress({
      userId: user.id,
      documentId,
      page,
      pageCount: document.page_count,
    });
    return sendJson(res, 200, {
      ok: true,
      progress: getProgress(user.id, documentId),
    });
  }

  return methodNotAllowed(res, "GET, POST");
}

/* ------------------------------------------------------------------ */
/* Admin diagnostics, users, audit log & engine selftest               */
/* ------------------------------------------------------------------ */

async function handleAdminStats(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  const admin = ensureAdmin(req, res, "admin.stats");
  if (!admin) return;

  const db = getDb();
  const activeEntitlements =
    db
      .prepare("SELECT COUNT(*) AS n FROM entitlements WHERE status = 'active'")
      .get()?.n ?? 0;
  const auditAllows =
    db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE outcome = 'allow'")
      .get()?.n ?? 0;
  const auditDenies =
    db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE outcome = 'deny'")
      .get()?.n ?? 0;

  return sendJson(res, 200, {
    ok: true,
    users: listUsers().length,
    documents: listDocuments().length,
    activeEntitlements,
    auditAllows,
    auditDenies,
    timestamp: nowIso(),
  });
}

async function handleAdminUsers(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  const admin = ensureAdmin(req, res, "admin.users.list");
  if (!admin) return;

  return sendJson(res, 200, {
    ok: true,
    users: listUsers(),
  });
}

async function handleAdminAudit(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  const admin = ensureAdmin(req, res, "admin.audit.list");
  if (!admin) return;

  const query = parseQuery(req.url);
  const entries = listAudit({
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
  const admin = ensureAdmin(req, res, "admin.engine.selftest");
  if (!admin) return;

  const targetId = requireDemoDocId();
  if (!targetId) {
    return sendError(res, 404, "not_found", "No document available for self-test.");
  }
  const doc = findDocument(targetId);
  if (!doc || !privateObjectExists(doc.storage_key)) {
    return sendError(res, 404, "not_found", "Document storage object not found.");
  }

  const testPage = Math.min(2, Math.max(1, doc.page_count));
  const report = await engineSelftest(keyToPath(doc.storage_key), testPage, 96);

  audit({
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
  });

  return sendJson(res, 200, {
    ok: true,
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

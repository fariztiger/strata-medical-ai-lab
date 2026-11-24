/**
 * ContentVault HTTP routes.
 *
 * Core security principle: the client's only authenticated identity is the
 * `cv_session` cookie, resolved server-side to a user row. No client field is
 * ever accepted as an identity or role.
 */

import { createServer } from "node:http";
import path from "node:path";
import {
  readJson,
  readRawBody,
  sendJson,
  sendBuffer,
  sendError,
  sendText,
  parseCookies,
  serializeCookie,
  clearCookie,
  rateLimit,
  clientIp,
  htmlSecurityHeaders,
  protectedAssetHeaders,
  isSameOriginMutating,
} from "./http/helpers.js";
import {
  createUser,
  findUserById,
  login,
  logout,
  resolveSession,
  canReadDocument,
  issuePageToken,
  verifyPageToken,
  grantEntitlement,
  revokeEntitlement,
  findDocument,
  listReadableDocuments,
  listDocuments,
  createDocument,
  addChapter,
  listChapters,
  findChapterForPage,
  recordProgress,
  getProgress,
  listEntitlementsForDocument,
  listUsers,
} from "./services/content.js";
import { probePdf, renderWatermarkedPage, engineSelftest } from "./services/pdf-engine.js";
import { putPrivateObject, readPrivateObjectSync } from "./services/storage.js";
import { audit } from "./security/audit.js";
import { nowIso } from "./db.js";
import { SESSION_COOKIE, PAGE_TOKEN_TTL_SECONDS } from "\.\./config.js";

/**
 * Resolves the seeded synthetic demo document.
 * Populated by server.js at startup from the seed script output or by an
 * explicit environment variable.
 */
let demoDocId = null;

export function requireDemoDocId() {
  return demoDocId || process.env.CV_DEMO_DOCUMENT_ID || null;
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
  const parsed = new URL(url, "http://localhost");
  const query = Object.create(null);
  parsed.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return query;
}

/**
 * Resolve the authenticated user from the session cookie.
 * Returns null if there is no valid session.
 */
export function currentUser(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];
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

function notFound(res) {
  sendError(res, 404, "not_found", "Route not found.");
}

function methodNotAllowed(res, allowed) {
  res.setHeader("Allow", allowed);
  sendError(res, 405, "method_not_allowed", `Allowed methods: ${allowed}.`);
}

/* ------------------------------------------------------------------ */
/* Auth routes                                                         */
/* ------------------------------------------------------------------ */

function handleAuth(req, res) {
  const { url } = req;
  const match = url.match(/^\/api\/auth\/?(?:(?<action>\w+))?/);
  const action = match && match.groups ? match.groups.action : null;

  if (req.method === "POST" && action === "login") {
    return handleLogin(req, res);
  }
  if (req.method === "POST" && action === "logout") {
    return handleLogout(req, res);
  }
  if (req.method === "GET" && action === "me") {
    return handleMe(req, res);
  }
  if (action === "register" && req.method === "POST") {
    return handleRegister(req, res);
  }
  notFound(res);
}

async function handleLogin(req, res) {
  const meta = { ip: extractIp(req), userAgent: userAgent(req) };
  const limiter = rateLimit(`login:${meta.ip}`, 10, 60);
  if (!limiter.allowed) {
    res.setHeader("Retry-After", String(limiter.retryAfter || 60));
    return sendError(res, 429, "rate_limited", "Too many login attempts.", { retryAfter: limiter.retryAfter });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendError(res, error.statusCode || 400, "bad_request", error.message);
  }

  let session;
  try {
    session = login({ email: body.email, password: body.password, ...meta });
  } catch (error) {
    audit({ event: "auth.login", outcome: "error", ip: meta.ip, userAgent: meta.userAgent, detail: { error: error.message } });
    return sendError(res, 400, "login_error", error.message);
  }

  if (!session) {
    return sendError(res, 401, "invalid_credentials", "Email or password is incorrect.");
  }

  const idleMs =
    Number(process.env.CV_SESSION_IDLE_MINUTES || 120) * 60 * 1000;
  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, session.sessionId, {
      maxAge: idleMs / 1000,
      httpOnly: true,
      secure: false, // Set true behind HTTPS in production
      sameSite: "Strict",
    }),
  );
  return sendJson(res, 200, { ok: true, user: session.user });
}

async function handleLogout(req, res) {
  const user = currentUser(req);
  const meta = { ip: extractIp(req), userAgent: userAgent(req) };
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE]) {
    logout(cookies[SESSION_COOKIE], meta);
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
  const user = currentUser(req);
  // Registration is admin-only in this prototype (no open sign-up).
  if (!user || user.role !== "admin") {
    return sendError(res, 403, "admin_required", "Only administrators may register accounts.");
  }
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
    !["admin", "student"].includes(body.role)
  ) {
    return sendError(res, 400, "bad_request", "email, password, displayName and role (admin|student) are required.");
  }
  try {
    const created = createUser({
      email: body.email,
      password: body.password,
      displayName: body.displayName,
      role: body.role,
      locale: body.locale || "en",
    });
    audit({
      event: "admin.user.register",
      outcome: "allow",
      actorId: user.id,
      actorRole: "admin",
      subjectId: created.id,
      detail: { email: body.email, role: body.role },
    });
    return sendJson(res, 201, { ok: true, user: created });
  } catch (error) {
    audit({ event: "admin.user.register", outcome: "deny", actorId: user.id, actorRole: "admin", detail: { error: error.message } });
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
  methodNotAllowed(res, "GET, POST");
}

async function handleListDocuments(req, res) {
  const user = currentUser(req);
  if (!user) {
    return sendError(res, 401, "not_authenticated", "No valid session.");
  }
  let payload;
  if (user.role === "admin") {
    // Admins see all documents (the admin console). Entitlement checks happen
    // at the page-render boundary, not here.
    payload = listDocuments();
  } else {
    payload = listReadableDocuments(user);
  }
  return sendJson(res, 200, { ok: true, documents: payload });
}

async function handleUploadDocument(req, res) {
  const admin = requireAdmin(req);
  if (!admin) {
    return sendError(res, 403, "admin_required", "Only administrators may upload documents.");
  }

  let body;
  try {
    body = await readRawBody(req, 40 * 1024 * 1024);
  } catch (error) {
    return sendError(res, error.statusCode || 400, "bad_request", error.message);
  }

  const titleEn = String(req.headers["x-title-en"] || "").trim();
  const titleZh = String(req.headers["x-title-zh"] || "").trim() || null;
  const author = String(req.headers["x-author"] || "").trim() || null;
  const description = String(req.headers["x-description"] || "").trim() || null;
  const contentType = String(req.headers["content-type"] || "");

  if (!titleEn) {
    return sendError(res, 400, "bad_request", "X-Title-En header is required.");
  }
  if (!contentType.includes("application/pdf")) {
    return sendError(res, 400, "bad_request", "Content-Type must be application/pdf.");
  }
  if (!body.length) {
    return sendError(res, 400, "bad_request", "Empty upload body.");
  }

  // Trust but verify: probe the actual PDF bytes before storing them.
  let probe;
  try {
    probe = await probePdf(bufferToTempFile(body));
  } catch (error) {
    audit({ event: "document.upload", outcome: "deny", actorId: admin.id, actorRole: "admin", detail: { error: error.message } });
    return sendError(res, 400, "invalid_pdf", error.message);
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
    audit({
      event: "document.upload",
      outcome: "allow",
      actorId: admin.id,
      actorRole: "admin",
      documentId: document.id,
      detail: { titleEn, pageCount: probe.pageCount, byteSize: storage.byteSize },
    });
    return sendJson(res, 201, { ok: true, document });
  } catch (error) {
    audit({ event: "document.upload", outcome: "error", actorId: admin.id, actorRole: "admin", detail: { error: error.message } });
    return sendError(res, 500, "upload_error", error.message);
  }
}

function bufferToTempFile(buffer) {
  // The engine reads from a real filesystem path, so stage uploads there.
  const fs = require("node:fs");
  const crypto = require("node:crypto");
  const tmpDir = require("node:path").join(require("os").tmpdir(), "cv-uploads");
  fs.mkdirSync(tmpDir, { recursive: true });
  const file = path.join(tmpDir, `${crypto.randomBytes(12).toString("hex")}.pdf`);
  fs.writeFileSync(file, buffer);
  return file;
}

/* ------------------------------------------------------------------ */
/* Document detail + entitlement management                            */
/* ------------------------------------------------------------------ */

async function handleDocumentDetail(req, res, id) {
  const user = currentUser(req);
  if (!user) {
    return sendError(res, 401, "not_authenticated", "No valid session.");
  }
  const document = findDocument(id);
  if (!document) {
    return sendError(res, 404, "not_found", "Document not found.");
  }

  const chapters = listChapters(id);
  const entitlements =
    user.role === "admin" ? listEntitlementsForDocument(id) : null;

  return sendJson(res, 200, {
    ok: true,
    document: { ...document, storage_key: undefined, content_hash: undefined },
    chapters,
    entitlements,
  });
}

async function handleGrantAccess(req, res, documentId) {
  const admin = requireAdmin(req);
  if (!admin) {
    return sendError(res, 403, "admin_required", "Only administrators may grant access.");
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendError(res, error.statusCode || 400, "bad_request", error.message);
  }

  const user = findUserByEmail(body.email);
  if (!user || user.role !== "student") {
    return sendError(res, 404, "student_not_found", "Student account not found.");
  }
  const document = findDocument(documentId);
  if (!document) {
    return sendError(res, 404, "not_found", "Document not found.");
  }

  const expiresAt =
    typeof body.expiresAt === "string" && body.expiresAt
      ? body.expiresAt
      : null;

  try {
    const result = grantEntitlement({
      userId: user.id,
      documentId,
      grantedBy: admin.id,
      expiresAt,
    });
    return sendJson(res, 200, { ok: true, entitlement: result.entitlement, changed: result.changed });
  } catch (error) {
    audit({ event: "entitlement.grant", outcome: "deny", actorId: admin.id, actorRole: "admin", subjectId: user.id, documentId, detail: { error: error.message } });
    return sendError(res, 500, "grant_error", error.message);
  }
}

async function handleRevokeAccess(req, res, documentId) {
  const admin = requireAdmin(req);
  if (!admin) {
    return sendError(res, 403, "admin_required", "Only administrators may revoke access.");
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendError(res, error.statusCode || 400, "bad_request", error.message);
  }

  const user = findUserByEmail(body.email);
  if (!user) {
    return sendError(res, 404, "student_not_found", "Student account not found.");
  }

  const result = revokeEntitlement({
    userId: user.id,
    documentId,
    revokedBy: admin.id,
    reason: body.reason || "admin_revoke",
  });

  return sendJson(res, 200, { ok: true, changed: result.changed });
}

/* ------------------------------------------------------------------ */
/* Chapter routes                                                      */
/* ------------------------------------------------------------------ */

async function handleChapters(req, res, documentId) {
  const admin = requireAdmin(req);
  if (!admin) {
    return sendError(res, 403, "admin_required", "Only administrators may manage chapters.");
  }
  if (req.method === "GET") {
    return sendJson(res, 200, { ok: true, chapters: listChapters(documentId) });
  }
  if (req.method === "POST") {
    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      return sendError(res, error.statusCode || 400, "bad_request", error.message);
    }
    const chapterId = addChapter({
      documentId,
      ordinal: Number(body.ordinal || 1),
      titleEn: String(body.titleEn || "Untitled chapter"),
      titleZh: body.titleZh ?? null,
      startPage: Number(body.startPage || 1),
      endPage: Number(body.endPage || 1),
      audioKey: body.audioKey ?? null,
      audioMime: body.audioMime ?? null,
      audioSeconds: body.audioSeconds ?? null,
    });
    return sendJson(res, 201, { ok: true, chapterId });
  }
  methodNotAllowed(res, "GET, POST");
}

/* ------------------------------------------------------------------ */
/* Protected page rendering - the enforcement boundary                 */
/* ------------------------------------------------------------------ */

async function handlePage(req, res, documentId) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, "GET");
  }

  const user = currentUser(req);
  if (!user) {
    audit({ event: "page.render", outcome: "deny", actorId: null, actorRole: null, documentId, ip: extractIp(req), userAgent: userAgent(req), detail: { reason: "unauthenticated" } });
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
  if (!document) {
    return sendError(res, 404, "not_found", "Document not found.");
  }

  const page = Number(req.headers["x-page"] || parseQuery(req.url).page || 1);
  if (!Number.isFinite(page) || page < 1 || page > document.page_count) {
    return sendError(res, 400, "bad_page", `Page must be between 1 and ${document.page_count}.`);
  }

  // Issue/verify a short-lived page token bound to entitlement version.
  // A fresh token is issued per page load so revocation invalidates it fast.
  const entitlement = verdict.entitlement;
  const token = issuePageToken(user, documentId, page, entitlement.version);
  const tokenExpiresAt = new Date(Date.now() + PAGE_TOKEN_TTL_SECONDS * 1000).toISOString();

  try {
    const storagePath = readPrivateObjectSync(document.storage_key);
  } catch {
    return sendError(res, 404, "not_found", "Stored document is unavailable.");
  }

  // Staging: engine reads from disk; copy the private object to a temp file.
  const fs = require("node:fs");
  const crypto = require("node:crypto");
  const tmpDir = require("node:path").join(require("os").tmpdir(), "cv-render");
  fs.mkdirSync(tmpDir, { recursive: true });
  const staged = path.join(tmpDir, `${crypto.randomBytes(12).toString("hex")}.pdf`);
  fs.writeFileSync(staged, storagePath);

  try {
    const result = await renderWatermarkedPage({
      absolutePath: staged,
      page,
      identity: {
        label: user.display_name,
        ref: user.id,
        stamp: new Date().toISOString(),
      },
    });

    // Record reading progress server-side (never accepted from the client).
    recordProgress({ userId: user.id, documentId, page, pageCount: document.page_count });

    audit({
      event: "page.render",
      outcome: "allow",
      actorId: user.id,
      actorRole: user.role,
      documentId,
      page,
      ip: extractIp(req),
      userAgent: userAgent(req),
      detail: { sha256: result.sha256, renderMs: result.renderMs },
    });

    return sendBuffer(res, 200, result.buffer, "image/png", {
      ...protectedAssetHeaders(),
      "X-Page-Token": token,
      "X-Page-Token-Expires": tokenExpiresAt,
      "X-Content-Watermark": "STRATA per-student burned-in mark",
    });
  } catch (error) {
    audit({ event: "page.render", outcome: "error", actorId: user.id, actorRole: user.role, documentId, page, ip: extractIp(req), userAgent: userAgent(req), detail: { error: error.message } });
    return sendError(res, 500, "render_error", error.message);
  } finally {
    try {
      fs.unlinkSync(staged);
    } catch {
      /* staged file cleanup failure is non-fatal */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Audio playback                                                      */
/* ------------------------------------------------------------------ */

async function handleAudio(req, res, documentId) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, "GET");
  }

  const user = currentUser(req);
  if (!user) {
    audit({ event: "audio.play", outcome: "deny", actorId: null, actorRole: null, documentId, ip: extractIp(req), userAgent: userAgent(req), detail: { reason: "unauthenticated" } });
    return sendError(res, 401, "not_authenticated", "No valid session.");
  }

  const verdict = canReadDocument(user, documentId);
  if (!verdict.allowed) {
    audit({ event: "audio.play", outcome: "deny", actorId: user.id, actorRole: user.role, documentId, ip: extractIp(req), userAgent: userAgent(req), detail: { reason: verdict.reason } });
    return sendError(res, 403, verdict.reason, `Access denied: ${verdict.reason}.`);
  }

  const page = Number(req.headers["x-page"] || 1);
  const chapter = findChapterForPage(documentId, page);
  if (!chapter || !chapter.audio_key) {
    return sendError(res, 404, "no_audio", "No audio track for this page.");
  }

  try {
    const stream = readPrivateObjectSync(chapter.audio_key);
    return sendBuffer(res, 200, stream, chapter.audio_mime || "audio/mpeg", {
      ...protectedAssetHeaders(),
      "Accept-Ranges": "bytes",
    });
  } catch {
    return sendError(res, 404, "not_found", "Audio object unavailable.");
  }
}

/* ------------------------------------------------------------------ */
/* Admin diagnostics                                                   */
/* ------------------------------------------------------------------ */

async function handleAdminStats(req, res) {
  const admin = requireAdmin(req);
  if (!admin) {
    return sendError(res, 403, "admin_required", "Only administrators may view statistics.");
  }
  return sendJson(res, 200, {
    ok: true,
    users: listUsers().length,
    documents: listDocuments().length,
    timestamp: nowIso(),
  });
}

async function handleEngineSelftest(req, res) {
  const admin = requireAdmin(req);
  if (!admin) {
    return sendError(res, 403, "admin_required", "Admin only.");
  }
  const demoDocId = requireDemoDocId();
  if (!demoDocId) {
    return sendError(res, 404, "not_found", "No demo document seeded yet.");
  }
  const doc = findDocument(demoDocId);
  if (!doc) return sendError(res, 404, "not_found", "Demo document not found.");

  const fs = require("node:fs");
  const crypto = require("node:crypto");
  const tmpDir = require("node:path").join(require("os").tmpdir(), "cv-selftest");
  fs.mkdirSync(tmpDir, { recursive: true });
  const staged = path.join(tmpDir, `${crypto.randomBytes(12).toString("hex")}.pdf`);
  fs.writeFileSync(staged, readPrivateObjectSync(doc.storage_key));

  try {
    const report = await engineSelftest(staged, 2, 96);
    return sendJson(res, 200, {
      ok: true,
      watermarkIdentityBound: report.watermarkedOutputsDiffer,
      watermarkChangesPixels: report.watermarkChangesPixels,
      shaA: report.shaA,
      shaB: report.shaB,
      watermarkA: report.watermarkA,
      watermarkB: report.watermarkB,
      renderMs: report.renderMsA,
    });
  } finally {
    try {
      fs.unlinkSync(staged);
    } catch {
      /* ignore */
    }
  }
}

export {
  handleAuth,
  handleDocuments,
  handleDocumentDetail,
  handleGrantAccess,
  handleRevokeAccess,
  handleChapters,
  handlePage,
  handleAudio,
  handleAdminStats,
  handleEngineSelftest,
};


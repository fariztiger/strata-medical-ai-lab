/**
 * ContentVault HTTP server factory (Mission 005 Phase A/E).
 *
 * Separating server construction (`createAppServer`) from CLI binding
 * (`server.js`) allows acceptance and PostgreSQL integration tests to start an
 * isolated server in-process with zero mocks while enforcing fail-closed
 * database and production safety invariants.
 */

import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import {
  htmlSecurityHeaders,
  sendJson,
  sendError,
  sendBuffer,
  readJson,
  rateLimitAsync,
  isSameOriginMutating,
  clientIp,
} from "./http/helpers.js";
import {
  currentUserAsync,
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
} from "./routes.js";
import { auditAsync } from "./security/audit.js";
import { newId } from "./security/crypto.js";
import { getDb } from "./db.js";
import {
  getPersistenceAdapter,
  getActivePersistenceAdapterSync,
  initializePersistence,
} from "./persistence/adapter.js";
import {
  PUBLIC_DIR,
  PORTFOLIO_PUBLIC_DIR,
  assertProductionSafety,
  ensureDirs,
  resolveDbBackend,
} from "./config.js";

const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

const NOINDEX_HEADER = {
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

function serveStaticFromRoot(rootDir, relPath, res, extraHeaders = {}) {
  if (!fs.existsSync(rootDir)) return false;
  const targetRel = relPath || "index.html";
  if (
    !targetRel ||
    targetRel.includes("..") ||
    targetRel.includes("\\") ||
    targetRel.includes("\0")
  ) {
    return false;
  }

  const resolvedRoot = path.resolve(rootDir);
  const resolvedFile = path.resolve(resolvedRoot, targetRel);
  if (
    resolvedFile !== path.join(resolvedRoot, targetRel) &&
    !resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    return false;
  }

  if (!fs.existsSync(resolvedFile) || !fs.statSync(resolvedFile).isFile()) {
    return false;
  }

  const ext = path.extname(resolvedFile).toLowerCase();
  const mime = STATIC_MIME[ext];
  if (!mime) return false;

  const buf = fs.readFileSync(resolvedFile);
  sendBuffer(res, 200, buf, mime, {
    ...htmlSecurityHeaders(),
    ...NOINDEX_HEADER,
    "Cache-Control": "no-cache",
    ...extraHeaders,
  });
  return true;
}

/**
 * SEC-001: Enforce authenticated administrator or reviewer authorisation on all
 * private M007 portfolio assets and collaboration enquiry endpoints.
 */
async function ensurePortfolioAccessAsync(req, res, pathname) {
  const user = await currentUserAsync(req);
  const ua = String(req.headers["user-agent"] || "").slice(0, 300);
  if (!user) {
    await auditAsync({
      event: "portfolio.access",
      outcome: "deny",
      ip: clientIp(req),
      userAgent: ua,
      detail: { reason: "unauthenticated", pathname },
    });
    sendError(
      res,
      401,
      "not_authenticated",
      "Authentication as an authorized reviewer or administrator is required to access the private M007 portfolio.",
      {},
      NOINDEX_HEADER,
    );
    return null;
  }
  if (!canViewPortfolio(user)) {
    await auditAsync(
      {
        event: "portfolio.access",
        outcome: "deny",
        actorId: user.id,
        actorRole: user.role,
        ip: clientIp(req),
        userAgent: ua,
        detail: { reason: "insufficient_role", pathname },
      },
      user,
    );
    sendError(
      res,
      403,
      "portfolio_access_denied",
      "Private M007 portfolio access is restricted to designated reviewers and administrators.",
      {},
      NOINDEX_HEADER,
    );
    return null;
  }
  return user;
}

export function createAppServer() {
  ensureDirs();

  // Fail-closed backend validation: throws immediately on invalid backend or missing DATABASE_URL.
  const backend = resolveDbBackend();
  const existingAdapter = getActivePersistenceAdapterSync();

  if (existingAdapter) {
    if (existingAdapter.kind === "sqlite") {
      assertProductionSafety(getDb());
    } else {
      assertProductionSafety(null, 0);
    }
  } else if (backend === "sqlite") {
    const database = getDb();
    assertProductionSafety(database);
  } else {
    // PostgreSQL mode: validate production env/secrets immediately and never touch SQLite!
    assertProductionSafety(null, 0);
  }

  const server = createServer(async (req, res) => {
    if (!req || !res) return;

    let parsedUrl;
    try {
      parsedUrl = new URL(req.url || "/", "http://localhost");
    } catch {
      sendError(res, 400, "bad_url", "Malformed request URL.");
      return;
    }

    const rawPathname = parsedUrl.pathname || "/";
    const pathname =
      rawPathname.length > 1 ? rawPathname.replace(/\/+$/, "") : "/";

    // Public liveness check (process alive; returns no sensitive state).
    if (pathname === "/health" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        service: "contentvault",
        version: "0.1.0",
        time: new Date().toISOString(),
      });
      return;
    }

    // Operational readiness check (verifies active persistence backend connectivity & migrations).
    if (pathname === "/readyz" && req.method === "GET") {
      try {
        const adapter = await getPersistenceAdapter();
        const ping = await adapter.ping();
        if (!ping.ok) {
          sendError(res, 503, "not_ready", "Database readiness check returned not ok.", {
            ready: false,
            backend: adapter.kind,
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          ready: true,
          service: "contentvault",
          backend: ping.backend,
          ...(ping.dbRole ? { dbRole: ping.dbRole } : {}),
          time: new Date().toISOString(),
        });
      } catch (error) {
        sendError(
          res,
          503,
          "not_ready",
          error?.message ? String(error.message) : "Database backend unavailable.",
          { ready: false },
        );
      }
      return;
    }

    // Explicitly refuse any direct probe of storage/var/internal paths and record it.
    if (
      pathname.startsWith("/storage") ||
      pathname.startsWith("/var") ||
      pathname.startsWith("/private") ||
      rawPathname.includes("..") ||
      rawPathname.includes("\0") ||
      rawPathname.includes("\\")
    ) {
      await auditAsync({
        event: "storage.direct_probe",
        outcome: "deny",
        ip: clientIp(req),
        userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
        detail: { pathname: rawPathname },
      });
      sendError(res, 404, "not_found", "Route not found.");
      return;
    }

    // Mutating API CSRF origin check.
    if (
      pathname.startsWith("/api/") &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(String(req.method))
    ) {
      if (!isSameOriginMutating(req)) {
        await auditAsync({
          event: "security.csrf",
          outcome: "deny",
          ip: clientIp(req),
          userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
          detail: { origin: req.headers.origin, host: req.headers.host },
        });
        sendError(res, 403, "csrf_blocked", "Cross-origin mutating request denied.");
        return;
      }
    }

    try {
      // Ensure persistence backend is initialized before serving API / portfolio routes
      if (pathname.startsWith("/api/") || pathname === "/portfolio" || pathname.startsWith("/portfolio/")) {
        try {
          await getPersistenceAdapter();
        } catch (dbErr) {
          sendError(
            res,
            503,
            "database_unavailable",
            dbErr?.message ? String(dbErr.message) : "Required database backend is unavailable.",
          );
          return;
        }
      }

      // Auth
      if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) {
        await handleAuth(req, res);
        return;
      }

      // Documents list / upload
      if (pathname === "/api/documents") {
        await handleDocuments(req, res);
        return;
      }

      // Document detail
      const docMatch = pathname.match(/^\/api\/documents\/([^/]+)$/);
      if (docMatch) {
        const id = decodeURIComponent(docMatch[1]);
        if (req.method === "GET") {
          await handleDocumentDetail(req, res, id);
          return;
        }
        if (req.method === "POST") {
          await handleGrantAccess(req, res, id);
          return;
        }
        res.setHeader("Allow", "GET, POST");
        sendError(res, 405, "method_not_allowed", "Allowed methods: GET, POST.");
        return;
      }

      // Grant / Revoke
      const grantMatch = pathname.match(/^\/api\/documents\/([^/]+)\/grant$/);
      if (grantMatch) {
        if (req.method !== "POST") {
          res.setHeader("Allow", "POST");
          sendError(res, 405, "method_not_allowed", "Allowed methods: POST.");
          return;
        }
        await handleGrantAccess(req, res, decodeURIComponent(grantMatch[1]));
        return;
      }

      const revokeMatch = pathname.match(/^\/api\/documents\/([^/]+)\/revoke$/);
      if (revokeMatch) {
        if (req.method !== "POST") {
          res.setHeader("Allow", "POST");
          sendError(res, 405, "method_not_allowed", "Allowed methods: POST.");
          return;
        }
        await handleRevokeAccess(req, res, decodeURIComponent(revokeMatch[1]));
        return;
      }

      // Chapters & chapter audio upload
      const chaptersMatch = pathname.match(/^\/api\/documents\/([^/]+)\/chapters$/);
      if (chaptersMatch) {
        await handleChapters(req, res, decodeURIComponent(chaptersMatch[1]));
        return;
      }

      const chapterAudioMatch = pathname.match(
        /^\/api\/documents\/([^/]+)\/chapters\/([^/]+)\/audio$/,
      );
      if (chapterAudioMatch) {
        await handleUploadChapterAudio(
          req,
          res,
          decodeURIComponent(chapterAudioMatch[1]),
          decodeURIComponent(chapterAudioMatch[2]),
        );
        return;
      }

      // Protected page render
      const pageMatch = pathname.match(/^\/api\/documents\/([^/]+)\/page$/);
      if (pageMatch) {
        await handlePage(req, res, decodeURIComponent(pageMatch[1]));
        return;
      }

      // Protected audio stream
      const audioMatch = pathname.match(/^\/api\/documents\/([^/]+)\/audio$/);
      if (audioMatch) {
        await handleAudio(req, res, decodeURIComponent(audioMatch[1]));
        return;
      }

      // Reading progress
      const progressMatch = pathname.match(/^\/api\/documents\/([^/]+)\/progress$/);
      if (progressMatch) {
        await handleProgress(req, res, decodeURIComponent(progressMatch[1]));
        return;
      }

      // Admin endpoints
      if (pathname === "/api/admin/stats") {
        await handleAdminStats(req, res);
        return;
      }
      if (pathname === "/api/admin/users") {
        await handleAdminUsers(req, res);
        return;
      }
      if (pathname === "/api/admin/audit") {
        await handleAdminAudit(req, res);
        return;
      }
      if (pathname === "/api/admin/engine-selftest") {
        await handleEngineSelftest(req, res);
        return;
      }

      // SEC-001 & AUD-C5: Protected M007 Portfolio Collaboration Enquiry endpoint
      // (Admin sees all; each Reviewer sees & creates ONLY their own enquiries!)
      if (pathname === "/api/portfolio/enquiries") {
        if (req.method !== "GET" && req.method !== "POST") {
          res.setHeader("Allow", "GET, POST");
          sendError(res, 405, "method_not_allowed", "Allowed methods: GET, POST.");
          return;
        }
        const viewer = await ensurePortfolioAccessAsync(req, res, pathname);
        if (!viewer) return;

        const adapter = await getPersistenceAdapter();

        if (req.method === "GET") {
          const rows = await adapter.listPortfolioEnquiries(viewer);
          sendJson(res, 200, { ok: true, enquiries: rows }, NOINDEX_HEADER);
          return;
        }

        const limiter = await rateLimitAsync(`enquiry:${clientIp(req)}`, 10, 60);
        if (!limiter.allowed) {
          sendError(res, 429, "rate_limited", "Too many enquiry submissions.");
          return;
        }
        let body;
        try {
          body = await readJson(req);
        } catch (error) {
          sendError(res, error.statusCode || 400, "bad_request", error.message);
          return;
        }
        const senderName = String(body.senderName || "").trim().slice(0, 120);
        const senderOrg = String(body.senderOrg || "").trim().slice(0, 160) || null;
        const senderEmail = String(body.senderEmail || "").trim().slice(0, 160);
        const topic = String(body.topic || "speaking").trim().slice(0, 80);
        const message = String(body.message || "").trim().slice(0, 2000);
        if (!senderName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(senderEmail) || message.length < 10) {
          sendError(
            res,
            400,
            "bad_request",
            "Valid name, email address, and enquiry message (>= 10 chars) are required.",
          );
          return;
        }
        const id = newId("enq");
        await adapter.createPortfolioEnquiry(viewer, {
          id,
          senderName,
          senderOrg,
          senderEmail,
          topic,
          message,
        });
        await auditAsync(
          {
            event: "portfolio.enquiry",
            outcome: "allow",
            actorId: viewer.id,
            actorRole: viewer.role,
            ip: clientIp(req),
            detail: { enquiryId: id, topic },
          },
          viewer,
        );
        sendJson(
          res,
          201,
          {
            ok: true,
            enquiryId: id,
            mode: "local_staging_only",
            notice:
              "Recorded locally in private prototype database only. No external email or communication was transmitted.",
          },
          NOINDEX_HEADER,
        );
        return;
      }

      // SEC-001: Private M007 Portfolio static routes (Admin / Reviewer only)
      if (pathname === "/portfolio" || pathname.startsWith("/portfolio/")) {
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.setHeader("Allow", "GET, HEAD");
          sendError(res, 405, "method_not_allowed", "Allowed methods: GET, HEAD.");
          return;
        }
        const viewer = await ensurePortfolioAccessAsync(req, res, pathname);
        if (!viewer) return;

        const sub = pathname.replace(/^\/portfolio\/?/, "") || "index.html";
        if (sub === "index.html") {
          await auditAsync(
            {
              event: "portfolio.access",
              outcome: "allow",
              actorId: viewer.id,
              actorRole: viewer.role,
              ip: clientIp(req),
              detail: { pathname },
            },
            viewer,
          );
        }
        const served = serveStaticFromRoot(PORTFOLIO_PUBLIC_DIR, sub, res, {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, private",
        });
        if (served) return;
        sendError(res, 404, "not_found", "Portfolio asset not found.", {}, NOINDEX_HEADER);
        return;
      }

      // Static ContentVault SPA frontend (GET / HEAD only, non-API paths)
      if (
        !pathname.startsWith("/api/") &&
        (req.method === "GET" || req.method === "HEAD")
      ) {
        const targetRel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
        if (serveStaticFromRoot(PUBLIC_DIR, targetRel, res)) {
          return;
        }
      }

      sendError(res, 404, "not_found", "Route not found.");
    } catch (error) {
      sendError(
        res,
        500,
        "internal_error",
        error?.message ? String(error.message) : "Unexpected server error.",
      );
    }
  });

  return server;
}

export async function createAppServerAsync() {
  await initializePersistence();
  return createAppServer();
}

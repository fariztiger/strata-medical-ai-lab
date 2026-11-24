#!/usr/bin/env node
/**
 * ContentVault API entry point.
 *
 * Runs the HTTP server on localhost, seeds synthetic data if requested, and
 * exposes:
 *   POST   /api/auth/login     - session creation
 *   POST   /api/auth/logout    - session destruction
 *   POST   /api/auth/register  - admin-only account creation
 *   GET    /api/auth/me        - resolve session to user
 *   GET    /api/documents      - list (student sees readable; admin sees all)
 *   POST   /api/documents      - admin-only private PDF upload
 *   GET    /api/documents/:id  - document detail + chapters + entitlements
 *   POST   /api/documents/:id/grant   - admin-only grant student access
 *   POST   /api/documents/:id/revoke  - admin-only revoke student access
 *   GET    /api/documents/:id/chapters - chapter list (admin)
 *   POST   /api/documents/:id/chapters - admin add chapter
 *   GET    /api/documents/:id/page     - protected watermarked page image
 *   GET    /api/documents/:id/audio    - entitled audio for page chapter
 *   GET    /api/admin/stats            - admin diagnostics
 *   GET    /api/admin/engine-selftest  - watermark engine proof (admin)
 *   GET    /health                     - public health check (no data)
 */

import { createServer } from "node:http";
import path from "node:path";
import {
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
} from "./routes.js";
import { closeDb } from "./db.js";
import { ensureDirs } from "\.\./config.js";

const PORT = Number(process.env.PORT || 7410);
const HOST = process.env.HOST || "127.0.0.1";

const server = createServer(async (req, res) => {
  if (!req) return;
  const url = req.url || "/";

  // Public health - returns nothing sensitive.
  if (url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json", ...htmlSecurityHeaders() });
    res.end(JSON.stringify({ ok: true, service: "contentvault", time: new Date().toISOString() }));
    return;
  }

  const normalized = url.replace(/\/$/, "") || "/";

  try {
    // Auth
    if (normalized === "/api/auth" || normalized.startsWith("/api/auth/")) {
      await handleAuth(req, res);
      return;
    }

    // Documents list / upload
    if (normalized === "/api/documents") {
      await handleDocuments(req, res);
      return;
    }

    // Document detail / grant / revoke
    const docMatch = normalized.match(/^\/api\/documents\/([^/]+)$/);
    if (docMatch) {
      const id = docMatch[1];
      if (req.method === "GET") return handleDocumentDetail(req, res, id);
      if (req.method === "POST") return handleGrantAccess(req, res, id);
      return;
    }

    const grantMatch = normalized.match(/^\/api\/documents\/([^/]+)\/grant$/);
    if (grantMatch) {
      if (req.method === "POST") return handleGrantAccess(req, res, grantMatch[1]);
      return;
    }

    const revokeMatch = normalized.match(/^\/api\/documents\/([^/]+)\/revoke$/);
    if (revokeMatch) {
      if (req.method === "POST") return handleRevokeAccess(req, res, revokeMatch[1]);
      return;
    }

    const chaptersMatch = normalized.match(/^\/api\/documents\/([^/]+)\/chapters$/);
    if (chaptersMatch) {
      if (req.method === "GET") return handleChapters(req, res, chaptersMatch[1]);
      if (req.method === "POST") return handleChapters(req, res, chaptersMatch[1]);
      return;
    }

    const pageMatch = normalized.match(/^\/api\/documents\/([^/]+)\/page$/);
    if (pageMatch) {
      if (req.method === "GET") return handlePage(req, res, pageMatch[1]);
      return;
    }

    const audioMatch = normalized.match(/^\/api\/documents\/([^/]+)\/audio$/);
    if (audioMatch) {
      if (req.method === "GET") return handleAudio(req, res, audioMatch[1]);
      return;
    }

    if (normalized === "/api/admin/stats") {
      return handleAdminStats(req, res);
    }

    if (normalized === "/api/admin/engine-selftest") {
      return handleEngineSelftest(req, res);
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not_found", message: "Route not found." }));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "internal_error", message: error.message || String(error) }));
  }
});

function shutdown() {
  closeDb();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

ensureDirs();

server.listen(PORT, HOST, () => {
  console.log(`ContentVault API listening on http://${HOST}:${PORT}`);
  console.log(`Data dir: ${require("./config.js").DATA_DIR}`);
});


#!/usr/bin/env node
/**
 * ContentVault API & Web Application entry point.
 *
 * Exposes:
 *   GET    /                                   - ContentVault web UI (Reader + Admin)
 *   GET    /health                             - public health check (no data)
 *   POST   /api/auth/login                     - session creation
 *   POST   /api/auth/logout                    - session destruction
 *   POST   /api/auth/register                  - admin-only account creation
 *   GET    /api/auth/me                        - resolve session to user
 *   GET    /api/documents                      - list (student sees entitled; admin sees all)
 *   POST   /api/documents                      - admin-only private PDF upload
 *   GET    /api/documents/:id                  - document detail + chapters + entitlements
 *   POST   /api/documents/:id/grant            - admin-only grant student access
 *   POST   /api/documents/:id/revoke           - admin-only revoke student access
 *   GET    /api/documents/:id/chapters         - chapter list (authorized)
 *   POST   /api/documents/:id/chapters         - admin add chapter
 *   POST   /api/documents/:id/chapters/:c/audio- admin attach private chapter audio
 *   GET    /api/documents/:id/page             - protected watermarked page image
 *   GET    /api/documents/:id/audio            - entitled audio for page/chapter (Range-capable)
 *   GET    /api/documents/:id/progress         - student reading progress
 *   POST   /api/documents/:id/progress         - update reading progress
 *   GET    /api/admin/stats                    - admin diagnostics
 *   GET    /api/admin/users                    - admin user directory
 *   GET    /api/admin/audit                    - admin append-only audit log
 *   GET    /api/admin/engine-selftest          - watermark engine proof (admin)
 */

import { createAppServer } from "./app.js";
import { closeDb } from "./db.js";
import { PORT, HOST, DATA_DIR } from "./config.js";

const server = createAppServer();

function shutdown() {
  closeDb();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, HOST, () => {
  console.log(`STRATA ContentVault listening on http://${HOST}:${PORT}`);
  console.log(`Private data directory: ${DATA_DIR}`);
});

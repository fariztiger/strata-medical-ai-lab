#!/usr/bin/env node
/**
 * ContentVault API & Web Application entry point (Mission 005 Phase A/E).
 *
 * Fail-closed startup:
 *   1. Validates active persistence backend (`PostgreSQL 16` via `DATABASE_URL`
 *      or local `SQLite`), database role privileges (`SEC-DB-003`), and
 *      production safety (`SEC-002`) BEFORE binding the HTTP socket.
 *   2. Never falls back from PostgreSQL to SQLite when PostgreSQL is configured.
 */

import { createAppServer } from "./app.js";
import {
  initializePersistence,
  closePersistenceAdapter,
} from "./persistence/adapter.js";
import { PORT, HOST, DATA_DIR } from "./config.js";

async function start() {
  const adapter = await initializePersistence();
  const server = createAppServer();

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(async () => {
      await closePersistenceAdapter().catch(() => {});
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(PORT, HOST, () => {
    console.log(`STRATA ContentVault listening on http://${HOST}:${PORT} [db=${adapter.kind}]`);
    console.log(`Private data directory: ${DATA_DIR}`);
  });
}

start().catch(async (error) => {
  console.error(`FATAL startup failure: ${error?.message || error}`);
  await closePersistenceAdapter().catch(() => {});
  process.exit(1);
});

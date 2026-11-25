#!/usr/bin/env node
/**
 * Verify database schema & runtime connectivity across SQLite or PostgreSQL 16.
 */

import { resolveDbBackend } from "../src/config.js";
import {
  initializePersistence,
  closePersistenceAdapter,
} from "../src/persistence/adapter.js";
import { getDb } from "../src/db.js";

async function main() {
  const backend = resolveDbBackend();
  const adapter = await initializePersistence();
  const ping = await adapter.ping();

  if (backend === "postgres") {
    const info = await adapter.withActorContext({ role: "anonymous" }, async (client) => {
      const tbls = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' ORDER BY table_name`,
      );
      const ver = await client.query("SELECT version() AS v, session_user AS role");
      return {
        tables: tbls.rows.map((r) => r.table_name),
        version: ver.rows[0]?.v,
        role: ver.rows[0]?.role,
      };
    });
    console.log("backend: postgres");
    console.log("role:", info.role);
    console.log("tables:", info.tables.join(", "));
    console.log("postgres:", info.version);
  } else {
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name")
      .all("table")
      .map((row) => row.name);
    const version = db.prepare("SELECT sqlite_version() AS v").get();
    console.log("backend: sqlite");
    console.log("ready:", ping.ok);
    console.log("tables:", tables.join(", "));
    console.log("sqlite:", version.v);
  }
}

main()
  .then(() => closePersistenceAdapter())
  .catch(async (err) => {
    console.error("Database check failed:", err.message);
    await closePersistenceAdapter().catch(() => {});
    process.exit(1);
  });

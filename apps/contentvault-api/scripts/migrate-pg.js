#!/usr/bin/env node
/**
 * STRATA ContentVault — PostgreSQL 16 Migration & Rollback CLI (Mission 005).
 *
 * Usage:
 *   DATABASE_MIGRATION_URL="postgres://strata_owner:...@host:5432/db" \
 *   CV_PG_RUNTIME_PASSWORD="..." \
 *     node scripts/migrate-pg.js up
 *
 *   DATABASE_MIGRATION_URL="postgres://strata_owner:...@host:5432/db" \
 *     node scripts/migrate-pg.js down          # reverts latest step (002 -> 001)
 *   DATABASE_MIGRATION_URL="..." \
 *     node scripts/migrate-pg.js down --all    # full staging teardown (requires CV_CONFIRM_DESTRUCTIVE=1)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPgPoolConfig } from "../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const MIG_DIR = path.join(REPO_ROOT, "db", "migrations");

export async function applyPostgresMigrations(queryable, { runtimePassword = "" } = {}) {
  const m001 = fs.readFileSync(path.join(MIG_DIR, "001_postgres_schema_and_rls.sql"), "utf8");
  const m002 = fs.readFileSync(path.join(MIG_DIR, "002_database_roles_and_hardening.sql"), "utf8");

  if (typeof queryable.exec === "function" && !queryable.connect) {
    // PGlite single-connection mode
    await queryable.exec(m001);
    if (runtimePassword) {
      await queryable.query("SELECT set_config('cv.runtime_password', $1, false)", [runtimePassword]);
    }
    await queryable.exec(m002);
    return ["001_postgres_schema_and_rls", "002_database_roles_and_hardening"];
  }

  const client = typeof queryable.connect === "function" ? await queryable.connect() : queryable;
  try {
    await client.query(m001);
    if (runtimePassword) {
      await client.query("SELECT set_config('cv.runtime_password', $1, false)", [runtimePassword]);
    }
    await client.query(m002);
    return ["001_postgres_schema_and_rls", "002_database_roles_and_hardening"];
  } finally {
    if (typeof queryable.connect === "function" && typeof client.release === "function") {
      client.release();
    }
  }
}

export async function rollbackPostgresMigrations(queryable, { all = false } = {}) {
  const r002 = fs.readFileSync(path.join(MIG_DIR, "rollback", "002_down.sql"), "utf8");
  const r001 = fs.readFileSync(path.join(MIG_DIR, "rollback", "001_down.sql"), "utf8");

  if (typeof queryable.exec === "function" && !queryable.connect) {
    await queryable.exec(r002);
    if (all) await queryable.exec(r001);
    return all ? ["002_down", "001_down"] : ["002_down"];
  }

  const client = typeof queryable.connect === "function" ? await queryable.connect() : queryable;
  try {
    await client.query(r002);
    if (all) await client.query(r001);
    return all ? ["002_down", "001_down"] : ["002_down"];
  } finally {
    if (typeof queryable.connect === "function" && typeof client.release === "function") {
      client.release();
    }
  }
}

const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const direction = String(process.argv[2] || "up").toLowerCase();
  const fullAll = process.argv.includes("--all");
  const migUrl = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!migUrl) {
    console.error("ERROR: Set DATABASE_MIGRATION_URL (or DATABASE_URL) to run migrations.");
    process.exit(1);
  }
  if (direction === "down" && fullAll && process.env.CV_CONFIRM_DESTRUCTIVE !== "1") {
    console.error("ERROR: Full rollback (--all) drops tables; set CV_CONFIRM_DESTRUCTIVE=1 to confirm.");
    process.exit(1);
  }

  const pgMod = await import(process.env.CV_PG_MODULE || "pg");
  const { Pool } = pgMod.default || pgMod;
  const pool = new Pool(buildPgPoolConfig(migUrl));

  try {
    if (direction === "up") {
      const applied = await applyPostgresMigrations(pool, {
        runtimePassword: process.env.CV_PG_RUNTIME_PASSWORD || "",
      });
      console.log(`Applied PostgreSQL migrations: ${applied.join(", ")}`);
    } else if (direction === "down") {
      const reverted = await rollbackPostgresMigrations(pool, { all: fullAll });
      console.log(`Reverted PostgreSQL migrations: ${reverted.join(", ")}`);
    } else {
      console.error(`Unknown migration command: ${direction} (expected 'up' or 'down')`);
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

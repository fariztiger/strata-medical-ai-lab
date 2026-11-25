/**
 * Persistence layer for STRATA ContentVault.
 *
 * Uses Node's built-in `node:sqlite` (Node >= 22) so the prototype has zero
 * runtime dependencies and no external database to provision. Every query uses
 * bound parameters; no SQL string interpolation of user input anywhere.
 *
 * Production migration path: PostgreSQL + Row Level Security (see
 * docs/decisions/ADR-001-zero-dependency-runtime.md & reports/SECURITY_REMEDIATION_003.md).
 */

import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DB_PATH, ensureDirs } from "./config.js";

let db = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','reviewer','student')),
  password_hash TEXT NOT NULL,
  locale        TEXT NOT NULL DEFAULT 'en',
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  disabled_at   TEXT
);

-- One row per login. Tokens are never stored; the session id is the lookup key
-- and the session is invalidated by deleting the row.
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  user_agent   TEXT,
  ip           TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  title_en      TEXT NOT NULL,
  title_zh      TEXT,
  author        TEXT,
  description   TEXT,
  storage_key   TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  byte_size     INTEGER NOT NULL,
  page_count    INTEGER NOT NULL DEFAULT 0,
  synthetic     INTEGER NOT NULL DEFAULT 1,
  uploaded_by   TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  archived_at   TEXT
);

-- Entitlement = the authorisation record that a student may read a document.
-- The version column is bumped on every change so outstanding page/audio tokens
-- die instantly when access is granted, changed or revoked.
CREATE TABLE IF NOT EXISTS entitlements (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('active','revoked','expired')),
  version      INTEGER NOT NULL DEFAULT 1,
  granted_by   TEXT NOT NULL REFERENCES users(id),
  granted_at   TEXT NOT NULL,
  expires_at   TEXT,
  revoked_by   TEXT REFERENCES users(id),
  revoked_at   TEXT,
  revoke_reason TEXT,
  UNIQUE (user_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_entitlements_user ON entitlements(user_id);

-- Chapters map page ranges to a teaching audio track.
CREATE TABLE IF NOT EXISTS chapters (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal      INTEGER NOT NULL,
  title_en     TEXT NOT NULL,
  title_zh     TEXT,
  start_page   INTEGER NOT NULL,
  end_page     INTEGER NOT NULL,
  audio_key    TEXT,
  audio_mime   TEXT,
  audio_seconds INTEGER
);
CREATE INDEX IF NOT EXISTS idx_chapters_doc ON chapters(document_id, ordinal);

-- Append-only audit trail. Never updated, never deleted by the application.
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  event       TEXT NOT NULL,
  outcome     TEXT NOT NULL CHECK (outcome IN ('allow','deny','info','error')),
  actor_id    TEXT,
  actor_role  TEXT,
  subject_id  TEXT,
  document_id TEXT,
  page        INTEGER,
  ip          TEXT,
  user_agent  TEXT,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event);

-- Reading progress per student per document.
CREATE TABLE IF NOT EXISTS reading_progress (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  last_page    INTEGER NOT NULL DEFAULT 1,
  pages_read   INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, document_id)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count        INTEGER NOT NULL
);

-- Shared & bounded fixed-window rate-limit buckets (Mission 004 Phase C / Mission 005 Phase C).
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key      TEXT PRIMARY KEY,
  window_start_ms INTEGER NOT NULL,
  expires_at_ms   INTEGER NOT NULL,
  count           INTEGER NOT NULL,
  is_locked       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_exp ON rate_limit_buckets(expires_at_ms);

-- Single-use page token redemption ledger (SEC-005).
CREATE TABLE IF NOT EXISTS token_redemptions (
  jti          TEXT PRIMARY KEY,
  redeemed_at  INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_token_redemptions_exp ON token_redemptions(expires_at);

-- Local-only collaboration enquiry log for M007 prototype (never sent externally).
CREATE TABLE IF NOT EXISTS portfolio_enquiries (
  id           TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  actor_id     TEXT REFERENCES users(id),
  sender_name  TEXT NOT NULL,
  sender_org   TEXT,
  sender_email TEXT NOT NULL,
  topic        TEXT NOT NULL,
  message      TEXT NOT NULL
);
`;

function migrateExistingSchema(database) {
  const userTable = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get();
  if (userTable?.sql && (!userTable.sql.includes("'reviewer'") || !userTable.sql.includes("is_demo"))) {
    const hasIsDemo = userTable.sql.includes("is_demo");
    database.exec("PRAGMA foreign_keys = OFF;");
    database.exec("BEGIN IMMEDIATE;");
    try {
      database.exec(`
        CREATE TABLE users_new (
          id            TEXT PRIMARY KEY,
          email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
          display_name  TEXT NOT NULL,
          role          TEXT NOT NULL CHECK (role IN ('admin','reviewer','student')),
          password_hash TEXT NOT NULL,
          locale        TEXT NOT NULL DEFAULT 'en',
          is_demo       INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT NOT NULL,
          disabled_at   TEXT
        );
      `);
      if (hasIsDemo) {
        database.exec(`
          INSERT INTO users_new (id, email, display_name, role, password_hash, locale, is_demo, created_at, disabled_at)
          SELECT id, email, display_name, role, password_hash, locale, is_demo, created_at, disabled_at FROM users;
        `);
      } else {
        database.exec(`
          INSERT INTO users_new (id, email, display_name, role, password_hash, locale, is_demo, created_at, disabled_at)
          SELECT id, email, display_name, role, password_hash, locale,
                 CASE WHEN email LIKE '%@strata.local' OR email LIKE '%.strata.local' THEN 1 ELSE 0 END,
                 created_at, disabled_at
          FROM users;
        `);
      }
      database.exec("DROP TABLE users;");
      database.exec("ALTER TABLE users_new RENAME TO users;");
      database.exec("COMMIT;");
    } catch (err) {
      database.exec("ROLLBACK;");
      throw err;
    } finally {
      database.exec("PRAGMA foreign_keys = ON;");
    }
  }

  const enqTable = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'portfolio_enquiries'")
    .get();
  if (enqTable?.sql && !enqTable.sql.includes("actor_id")) {
    database.exec("ALTER TABLE portfolio_enquiries ADD COLUMN actor_id TEXT REFERENCES users(id);");
  }

  const rlTable = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rate_limit_buckets'")
    .get();
  if (rlTable?.sql && !rlTable.sql.includes("is_locked")) {
    database.exec("ALTER TABLE rate_limit_buckets ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0;");
  }
}

function hardenSqliteFilePermissions() {
  if (process.platform === "win32") return;
  for (const suffix of ["", "-wal", "-shm"]) {
    const target = `${DB_PATH}${suffix}`;
    if (fs.existsSync(target)) {
      try {
        fs.chmodSync(target, 0o600);
      } catch {
        /* ignore non-owned special files */
      }
    }
  }
}

export function getDb() {
  if (db) return db;
  ensureDirs();
  db = new DatabaseSync(DB_PATH);
  db.exec(SCHEMA);
  migrateExistingSchema(db);
  hardenSqliteFilePermissions();
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/** Run a function inside an IMMEDIATE transaction. */
export function transaction(fn) {
  const database = getDb();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(database);
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* ignore rollback failure, original error wins */
    }
    throw error;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

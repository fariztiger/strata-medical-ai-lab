/**
 * Unified Asynchronous Persistence & Security-Coordination Layer (Mission 005 Phases A, B, C).
 *
 * Implements full application persistence across:
 *   1. `SqlitePersistenceAdapter` (lightweight zero-paid-infra local development backend)
 *   2. `PostgresPersistenceAdapter` (production multi-replica PostgreSQL 16 backend with
 *      non-owner/non-superuser `cv_runtime` login, column-level `password_hash` protection,
 *      `FORCE ROW LEVEL SECURITY`, crash-safe logged token/rate-limit ledgers, and
 *      attack-resistant lockout preservation).
 */

import { getDb, closeDb, transaction as sqliteTx, nowIso } from "../db.js";
import {
  RATE_LIMIT_MAX_BUCKETS,
  resolveDbBackend,
  buildPgPoolConfig,
  assertProductionSafety,
  isProduction,
} from "../config.js";

const VALID_ACTOR_ROLES = new Set(["anonymous", "student", "reviewer", "admin"]);

function normalizeActor(actor = {}) {
  const role = String(actor?.role || "anonymous").trim().toLowerCase();
  if (role === "auth_bootstrap") {
    throw new Error(
      "SEC-DB-004: Reserved internal role 'auth_bootstrap' cannot be passed to withActorContext.",
    );
  }
  const safeRole = VALID_ACTOR_ROLES.has(role) ? role : "anonymous";
  return {
    userId: safeRole === "anonymous" ? "" : String(actor?.id || actor?.userId || ""),
    role: safeRole,
  };
}

function mapPgUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    locale: row.locale || "en",
    is_demo: row.is_demo ? 1 : 0,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ""),
    disabled_at:
      row.disabled_at instanceof Date
        ? row.disabled_at.toISOString()
        : row.disabled_at ?? null,
  };
}

function mapPgDoc(row) {
  if (!row) return null;
  return {
    ...row,
    byte_size: row.byte_size !== undefined ? Number(row.byte_size) : undefined,
    page_count: row.page_count !== undefined ? Number(row.page_count) : undefined,
    active_grants: row.active_grants !== undefined ? Number(row.active_grants) : undefined,
    synthetic:
      row.synthetic === undefined ? undefined : Boolean(row.synthetic) ? 1 : 0,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    archived_at:
      row.archived_at instanceof Date ? row.archived_at.toISOString() : row.archived_at ?? null,
    expires_at:
      row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at ?? undefined,
    last_read_at:
      row.last_read_at instanceof Date
        ? row.last_read_at.toISOString()
        : row.last_read_at ?? undefined,
  };
}

function mapPgEntitlement(row) {
  if (!row) return null;
  return {
    ...row,
    version: Number(row.version),
    granted_at:
      row.granted_at instanceof Date ? row.granted_at.toISOString() : row.granted_at,
    expires_at:
      row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at ?? null,
    revoked_at:
      row.revoked_at instanceof Date ? row.revoked_at.toISOString() : row.revoked_at ?? null,
  };
}

/* ============================================================================
 * 1. SQLite Persistence Adapter (Lightweight Local Development)
 * ============================================================================ */
export class SqlitePersistenceAdapter {
  constructor(dbProvider = getDb) {
    this.kind = "sqlite";
    this._getDb = dbProvider;
  }

  async init() {
    this._getDb().prepare("SELECT 1 AS ok").get();
    return this;
  }

  async ping() {
    const row = this._getDb().prepare("SELECT 1 AS ok").get();
    return { ok: row?.ok === 1, backend: "sqlite" };
  }

  async close() {
    if (this._getDb === getDb) {
      closeDb();
    }
  }

  async withActorContext(actor, fn) {
    const ctx = normalizeActor(actor);
    return fn(this._getDb(), ctx);
  }

  async countActiveDemoUsers() {
    const row = this._getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM users
         WHERE disabled_at IS NULL
           AND (is_demo = 1 OR email LIKE '%@strata.local' OR email LIKE '%.strata.local')`,
      )
      .get();
    return Number(row?.n ?? 0);
  }

  async createUser(actor, { id, email, displayName, role, passwordHash, locale = "en", isDemo = false }) {
    return this.withActorContext(actor, (db) => {
      db.prepare(
        `INSERT INTO users (id, email, display_name, role, password_hash, locale, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, email, displayName, role, passwordHash, locale, isDemo ? 1 : 0, nowIso());
      return db
        .prepare(
          "SELECT id, email, display_name, role, locale, is_demo, created_at, disabled_at FROM users WHERE id = ?",
        )
        .get(id);
    });
  }

  async ensureDemoFlag(actor, userId) {
    return this.withActorContext(actor, (db) => {
      db.prepare("UPDATE users SET is_demo = 1 WHERE id = ?").run(userId);
    });
  }

  async findUserById(actor, userId) {
    if (!userId) return null;
    return this.withActorContext(actor, (db) => {
      return (
        db
          .prepare(
            "SELECT id, email, display_name, role, locale, is_demo, created_at, disabled_at FROM users WHERE id = ?",
          )
          .get(userId) ?? null
      );
    });
  }

  async findUserByEmail(actor, email) {
    if (!email) return null;
    return this.withActorContext(actor, (db) => {
      return (
        db
          .prepare(
            `SELECT id, email, display_name, role, locale, is_demo, created_at, disabled_at
             FROM users WHERE email = ? COLLATE NOCASE`,
          )
          .get(String(email).trim().toLowerCase()) ?? null
      );
    });
  }

  async listUsers(actor) {
    return this.withActorContext(actor, (db, ctx) => {
      if (ctx.role !== "admin") {
        throw Object.assign(new Error("Forbidden by row-level policy"), { code: "RLS_DENIED" });
      }
      return db
        .prepare(
          `SELECT id, email, display_name, role, locale, is_demo, created_at, disabled_at
           FROM users ORDER BY role, display_name`,
        )
        .all();
    });
  }

  async lookupAuthUserForLogin(email) {
    if (!email) return null;
    const row = this._getDb()
      .prepare(
        `SELECT id, email, display_name, role, password_hash, locale, is_demo, disabled_at
         FROM users WHERE email = ? COLLATE NOCASE`,
      )
      .get(String(email).trim().toLowerCase());
    return row ?? null;
  }

  async createSession({ id, userId, createdAt, lastSeenAt, expiresAt, userAgent, ip }) {
    this._getDb()
      .prepare(
        `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, createdAt, lastSeenAt, expiresAt, userAgent, ip);
  }

  async resolveSessionRecord(sessionId) {
    if (!sessionId) return null;
    const db = this._getDb();
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
    if (!session) return null;
    const user = db
      .prepare(
        "SELECT id, email, display_name, role, locale, is_demo, created_at, disabled_at FROM users WHERE id = ?",
      )
      .get(session.user_id);
    return { session, user: user ?? null };
  }

  async touchSession(sessionId, { lastSeenAt, expiresAt }) {
    this._getDb()
      .prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
      .run(lastSeenAt, expiresAt, sessionId);
  }

  async deleteSession(sessionId) {
    const db = this._getDb();
    const existing = db.prepare("SELECT user_id FROM sessions WHERE id = ?").get(sessionId);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    return existing?.user_id ?? null;
  }

  async createDocument(actor, doc) {
    return this.withActorContext(actor, (db, ctx) => {
      if (ctx.role !== "admin") {
        throw Object.assign(new Error("Admin required"), { code: "RLS_DENIED" });
      }
      db.prepare(
        `INSERT INTO documents
          (id, title_en, title_zh, author, description, storage_key, content_hash,
           byte_size, page_count, synthetic, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        doc.id,
        doc.titleEn,
        doc.titleZh ?? null,
        doc.author ?? null,
        doc.description ?? null,
        doc.storageKey,
        doc.contentHash,
        doc.byteSize,
        doc.pageCount,
        doc.synthetic !== false ? 1 : 0,
        doc.uploadedBy,
        nowIso(),
      );
      return db.prepare("SELECT * FROM documents WHERE id = ?").get(doc.id);
    });
  }

  async findDocument(actor, id) {
    if (!id) return null;
    return this.withActorContext(actor, (db) => {
      return db.prepare("SELECT * FROM documents WHERE id = ?").get(id) ?? null;
    });
  }

  async listDocuments(actor) {
    return this.withActorContext(actor, (db, ctx) => {
      if (ctx.role !== "admin") return [];
      return db
        .prepare(
          `SELECT d.id, d.title_en, d.title_zh, d.author, d.page_count, d.synthetic,
                  d.created_at, d.archived_at, d.byte_size,
                  (SELECT COUNT(*) FROM entitlements e
                    WHERE e.document_id = d.id AND e.status = 'active') AS active_grants
           FROM documents d
           WHERE d.archived_at IS NULL
           ORDER BY d.created_at DESC`,
        )
        .all();
    });
  }

  async listReadableDocuments(actor) {
    return this.withActorContext(actor, (db, ctx) => {
      if (ctx.role === "admin") {
        return db
          .prepare("SELECT * FROM documents WHERE archived_at IS NULL ORDER BY created_at DESC")
          .all();
      }
      if (ctx.role !== "student" || !ctx.userId) return [];
      const now = nowIso();
      return db
        .prepare(
          `SELECT d.id, d.title_en, d.title_zh, d.author, d.description,
                  d.page_count, d.synthetic, d.created_at, d.byte_size,
                  e.id AS entitlement_id, e.status AS entitlement_status,
                  e.expires_at, e.version,
                  COALESCE(rp.last_page, 1) AS last_page,
                  COALESCE(rp.pages_read, 0) AS pages_read,
                  rp.updated_at AS last_read_at
           FROM documents d
           JOIN entitlements e ON e.document_id = d.id
           LEFT JOIN reading_progress rp
             ON rp.document_id = d.id AND rp.user_id = e.user_id
           WHERE e.user_id = ?
             AND e.status = 'active'
             AND (e.expires_at IS NULL OR e.expires_at > ?)
             AND d.archived_at IS NULL
           ORDER BY d.created_at DESC`,
        )
        .all(ctx.userId, now);
    });
  }

  async addChapter(actor, ch) {
    return this.withActorContext(actor, (db, ctx) => {
      if (ctx.role !== "admin") {
        throw Object.assign(new Error("Admin required"), { code: "RLS_DENIED" });
      }
      db.prepare(
        `INSERT INTO chapters
          (id, document_id, ordinal, title_en, title_zh, start_page, end_page,
           audio_key, audio_mime, audio_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        ch.id,
        ch.documentId,
        ch.ordinal,
        ch.titleEn,
        ch.titleZh ?? null,
        ch.startPage,
        ch.endPage,
        ch.audioKey ?? null,
        ch.audioMime ?? null,
        ch.audioSeconds ?? null,
      );
      return ch.id;
    });
  }

  async listChapters(actor, documentId) {
    if (!documentId) return [];
    return this.withActorContext(actor, (db) => {
      return db
        .prepare(
          `SELECT id, document_id, ordinal, title_en, title_zh, start_page, end_page,
                  audio_key IS NOT NULL AS has_audio, audio_mime, audio_seconds
           FROM chapters WHERE document_id = ? ORDER BY ordinal`,
        )
        .all(documentId);
    });
  }

  async findChapterForPage(actor, documentId, page) {
    if (!documentId) return null;
    return this.withActorContext(actor, (db) => {
      return (
        db
          .prepare(
            `SELECT * FROM chapters
             WHERE document_id = ? AND start_page <= ? AND end_page >= ?
             ORDER BY ordinal LIMIT 1`,
          )
          .get(documentId, page, page) ?? null
      );
    });
  }

  async findChapterById(actor, documentId, chapterId) {
    if (!documentId || !chapterId) return null;
    return this.withActorContext(actor, (db) => {
      return (
        db
          .prepare("SELECT * FROM chapters WHERE document_id = ? AND id = ?")
          .get(documentId, chapterId) ?? null
      );
    });
  }

  async attachChapterAudio(actor, { documentId, chapterId, audioKey, audioMime, audioSeconds }) {
    return this.withActorContext(actor, (db, ctx) => {
      if (ctx.role !== "admin") {
        throw Object.assign(new Error("Admin required"), { code: "RLS_DENIED" });
      }
      const res = db
        .prepare(
          `UPDATE chapters
           SET audio_key = ?, audio_mime = ?, audio_seconds = COALESCE(?, audio_seconds)
           WHERE id = ? AND document_id = ?`,
        )
        .run(audioKey, audioMime, audioSeconds ?? null, chapterId, documentId);
      return res.changes > 0;
    });
  }

  async getEntitlement(actor, userId, documentId) {
    if (!userId || !documentId) return null;
    return this.withActorContext(actor, (db) => {
      return (
        db
          .prepare("SELECT * FROM entitlements WHERE user_id = ? AND document_id = ?")
          .get(userId, documentId) ?? null
      );
    });
  }

  async grantEntitlement(actor, { id, userId, documentId, grantedBy, expiresAt = null }) {
    return this.withActorContext(actor, (_db, ctx) => {
      if (ctx.role !== "admin") {
        throw Object.assign(new Error("Admin required"), { code: "RLS_DENIED" });
      }
      return sqliteTx((db) => {
        const existing = db
          .prepare("SELECT * FROM entitlements WHERE user_id = ? AND document_id = ?")
          .get(userId, documentId);

        if (existing && existing.status === "active" && existing.expires_at === expiresAt) {
          return { changed: false, mode: "noop", previousStatus: existing.status, entitlement: existing };
        }

        if (existing) {
          db.prepare(
            `UPDATE entitlements
             SET status = 'active', expires_at = ?, granted_by = ?, granted_at = ?,
                 revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL,
                 version = version + 1
             WHERE id = ?`,
          ).run(expiresAt, grantedBy, nowIso(), existing.id);
          return {
            changed: true,
            mode: "regrant",
            previousStatus: existing.status,
            entitlement: db.prepare("SELECT * FROM entitlements WHERE id = ?").get(existing.id),
          };
        }

        db.prepare(
          `INSERT INTO entitlements
            (id, user_id, document_id, status, version, granted_by, granted_at, expires_at)
           VALUES (?, ?, ?, 'active', 1, ?, ?, ?)`,
        ).run(id, userId, documentId, grantedBy, nowIso(), expiresAt);
        return {
          changed: true,
          mode: "new",
          previousStatus: null,
          entitlement: db.prepare("SELECT * FROM entitlements WHERE id = ?").get(id),
        };
      });
    });
  }

  async revokeEntitlement(actor, { userId, documentId, revokedBy, reason = "admin_revoke" }) {
    return this.withActorContext(actor, (_db, ctx) => {
      if (ctx.role !== "admin") {
        throw Object.assign(new Error("Admin required"), { code: "RLS_DENIED" });
      }
      return sqliteTx((db) => {
        const existing = db
          .prepare("SELECT * FROM entitlements WHERE user_id = ? AND document_id = ?")
          .get(userId, documentId);
        if (!existing) {
          return { changed: false, reason: "not_found" };
        }
        if (existing.status === "revoked") {
          return { changed: false, reason: "already_revoked", entitlement: existing };
        }
        db.prepare(
          `UPDATE entitlements
           SET status = 'revoked', revoked_by = ?, revoked_at = ?, revoke_reason = ?,
               version = version + 1
           WHERE id = ?`,
        ).run(revokedBy, nowIso(), reason, existing.id);
        return {
          changed: true,
          previousStatus: existing.status,
          entitlement: db.prepare("SELECT * FROM entitlements WHERE id = ?").get(existing.id),
        };
      });
    });
  }

  async listEntitlementsForDocument(actor, documentId) {
    return this.withActorContext(actor, (db, ctx) => {
      if (ctx.role !== "admin") return [];
      return db
        .prepare(
          `SELECT e.id, e.user_id, u.display_name, u.email, e.status, e.version,
                  e.granted_at, e.expires_at, e.revoked_at, e.revoke_reason
           FROM entitlements e
           JOIN users u ON u.id = e.user_id
           WHERE e.document_id = ?
           ORDER BY u.display_name`,
        )
        .all(documentId);
    });
  }

  async listEntitlements(actor) {
    return this.withActorContext(actor, (db, ctx) => {
      if (ctx.role === "admin") {
        return db.prepare("SELECT * FROM entitlements ORDER BY granted_at DESC").all();
      }
      return db
        .prepare("SELECT * FROM entitlements WHERE user_id = ? ORDER BY granted_at DESC")
        .all(ctx.userId);
    });
  }

  async recordProgress(actor, { userId, documentId, page, pageCount }) {
    return this.withActorContext(actor, (db) => {
      const cap = Math.max(Number(pageCount) || 1, 1);
      const safePage = Math.min(Math.max(Number(page) || 1, 1), cap);
      db.prepare(
        `INSERT INTO reading_progress (user_id, document_id, last_page, pages_read, updated_at)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(user_id, document_id) DO UPDATE SET
           pages_read = CASE
             WHEN reading_progress.last_page = excluded.last_page THEN reading_progress.pages_read
             ELSE MIN(?, reading_progress.pages_read + 1)
           END,
           last_page = excluded.last_page,
           updated_at = excluded.updated_at`,
      ).run(userId, documentId, safePage, nowIso(), cap);
    });
  }

  async getProgress(actor, userId, documentId) {
    return this.withActorContext(actor, (db) => {
      return (
        db
          .prepare(
            "SELECT last_page, pages_read, updated_at FROM reading_progress WHERE user_id = ? AND document_id = ?",
          )
          .get(userId, documentId) ?? null
      );
    });
  }

  async createPortfolioEnquiry(actor, { id, senderName, senderOrg, senderEmail, topic, message }) {
    return this.withActorContext(actor, (db, ctx) => {
      if (ctx.role !== "admin" && ctx.role !== "reviewer") {
        throw Object.assign(new Error("Forbidden by row-level policy"), { code: "RLS_DENIED" });
      }
      db.prepare(
        `INSERT INTO portfolio_enquiries
          (id, created_at, actor_id, sender_name, sender_org, sender_email, topic, message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, nowIso(), ctx.userId || null, senderName, senderOrg ?? null, senderEmail, topic, message);
      return id;
    });
  }

  async listPortfolioEnquiries(actor) {
    return this.withActorContext(actor, (db, ctx) => {
      if (ctx.role === "admin") {
        return db
          .prepare(
            `SELECT id, created_at, actor_id, sender_name, sender_org, sender_email, topic, message
             FROM portfolio_enquiries ORDER BY created_at DESC LIMIT 100`,
          )
          .all();
      }
      if (ctx.role === "reviewer" && ctx.userId) {
        // AUD-C5: Reviewer sees ONLY their own submitted enquiries!
        return db
          .prepare(
            `SELECT id, created_at, actor_id, sender_name, sender_org, sender_email, topic, message
             FROM portfolio_enquiries
             WHERE actor_id = ?
             ORDER BY created_at DESC LIMIT 100`,
          )
          .all(ctx.userId);
      }
      throw Object.assign(new Error("Forbidden by row-level policy"), { code: "RLS_DENIED" });
    });
  }

  async appendAuditLog(_actor, entry) {
    const db = this._getDb();
    db.prepare(
      `INSERT INTO audit_log
        (id, created_at, event, outcome, actor_id, actor_role, subject_id,
         document_id, page, ip, user_agent, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.id,
      entry.createdAt || nowIso(),
      String(entry.event),
      String(entry.outcome),
      entry.actorId ?? null,
      entry.actorRole ?? null,
      entry.subjectId ?? null,
      entry.documentId ?? null,
      entry.page ?? null,
      entry.ip ?? null,
      entry.userAgent ? String(entry.userAgent).slice(0, 300) : null,
      entry.detail ? JSON.stringify(entry.detail).slice(0, 4000) : null,
    );
  }

  async listAuditLog(actor, { limit = 100, documentId = null, event = null, outcome = null } = {}) {
    return this.withActorContext(actor, (db, ctx) => {
      if (ctx.role !== "admin") return [];
      const clauses = [];
      const params = [];
      if (documentId) {
        clauses.push("document_id = ?");
        params.push(documentId);
      }
      if (event) {
        clauses.push("event = ?");
        params.push(event);
      }
      if (outcome) {
        clauses.push("outcome = ?");
        params.push(outcome);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
      const rows = db
        .prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
        .all(...params, safeLimit);
      return rows.map((row) => ({
        ...row,
        detail: row.detail ? safeParseJson(row.detail) : null,
      }));
    });
  }

  async getAdminStats(actor) {
    return this.withActorContext(actor, (db, ctx) => {
      if (ctx.role !== "admin") {
        throw Object.assign(new Error("Admin required"), { code: "RLS_DENIED" });
      }
      const users = db.prepare("SELECT COUNT(*) AS n FROM users").get()?.n ?? 0;
      const documents = db
        .prepare("SELECT COUNT(*) AS n FROM documents WHERE archived_at IS NULL")
        .get()?.n ?? 0;
      const activeEntitlements = db
        .prepare("SELECT COUNT(*) AS n FROM entitlements WHERE status = 'active'")
        .get()?.n ?? 0;
      const auditAllows = db
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE outcome = 'allow'")
        .get()?.n ?? 0;
      const auditDenies = db
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE outcome = 'deny'")
        .get()?.n ?? 0;
      return {
        users: Number(users),
        documents: Number(documents),
        activeEntitlements: Number(activeEntitlements),
        auditAllows: Number(auditAllows),
        auditDenies: Number(auditDenies),
      };
    });
  }

  async rateLimit(
    key,
    limit,
    windowSeconds,
    { increment = true, maxBuckets = RATE_LIMIT_MAX_BUCKETS, protectLockout = false } = {},
  ) {
    return sharedSqliteRateLimit(this._getDb(), key, limit, windowSeconds, {
      increment,
      maxBuckets,
      protectLockout,
    });
  }

  async clearRateLimit(key) {
    this._getDb()
      .prepare("DELETE FROM rate_limit_buckets WHERE bucket_key = ?")
      .run(String(key || "").slice(0, 256));
  }

  async redeemSingleUseToken(jti, expiresAtEpochSec) {
    const db = this._getDb();
    const nowSec = Math.floor(Date.now() / 1000);
    db.prepare("DELETE FROM token_redemptions WHERE expires_at < ?").run(nowSec);
    const ins = db
      .prepare(
        "INSERT OR IGNORE INTO token_redemptions (jti, redeemed_at, expires_at) VALUES (?, ?, ?)",
      )
      .run(jti, nowSec, expiresAtEpochSec);
    return ins.changes === 1;
  }
}

/* ============================================================================
 * 2. PostgreSQL 16 Persistence Adapter (Production Multi-Replica + Kernel RLS)
 * ============================================================================ */
export class PostgresPersistenceAdapter {
  constructor(
    pool,
    {
      appRole = "cv_app_user",
      maxBuckets = RATE_LIMIT_MAX_BUCKETS,
      enforceRoleSeparation = false,
    } = {},
  ) {
    if (!pool || typeof pool.connect !== "function") {
      throw new Error("PostgresPersistenceAdapter requires a pg.Pool-compatible instance.");
    }
    if (appRole !== null && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(appRole)) {
      throw new Error("Invalid PostgreSQL identifier for appRole.");
    }
    this.kind = "postgres";
    this.pool = pool;
    this.appRole = appRole;
    this.maxBuckets = maxBuckets;
    this.enforceRoleSeparation = enforceRoleSeparation;
    this._hasHardening002 = null;
  }

  /**
   * Verify database connectivity, migration state, and strict non-owner/non-superuser
   * runtime database credentials (`AUD-C2`).
   */
  async init() {
    const client = await this.pool.connect();
    try {
      const roleCheck = await client.query(
        `SELECT current_user AS cur_user,
                session_user AS sess_user,
                r.rolsuper,
                r.rolbypassrls,
                r.rolcreatedb,
                r.rolcreaterole,
                EXISTS (
                  SELECT 1 FROM pg_tables
                  WHERE schemaname = 'public'
                    AND tableowner = session_user
                    AND tablename IN ('users', 'documents', 'entitlements', 'audit_log')
                ) AS owns_tables,
                EXISTS (
                  SELECT 1 FROM pg_proc p
                  JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'cv_check_rate_limit'
                ) AS has_002
         FROM pg_roles r
         WHERE r.rolname = session_user`,
      );

      const info = roleCheck.rows[0];
      if (!info) {
        throw new Error("SEC-DB-003: Could not inspect runtime PostgreSQL session role.");
      }
      this._hasHardening002 = Boolean(info.has_002);

      if (this.enforceRoleSeparation) {
        if (info.rolsuper || info.rolbypassrls || info.rolcreatedb || info.rolcreaterole || info.owns_tables) {
          throw new Error(
            `SEC-DB-003: Runtime database connection ('${info.sess_user}') MUST NOT be a superuser, BYPASSRLS, CREATEDB, CREATEROLE, or table owner (super=${info.rolsuper}, bypassrls=${info.rolbypassrls}, ownsTables=${info.owns_tables}). Connect as restricted 'cv_runtime'.`,
          );
        }
        if (!this._hasHardening002) {
          throw new Error(
            "SEC-DB-003: Database migration 002_database_roles_and_hardening.sql has not been applied.",
          );
        }
      }
      return this;
    } finally {
      client.release();
    }
  }

  async ping() {
    const client = await this.pool.connect();
    try {
      const res = await client.query("SELECT 1 AS ok, session_user AS role");
      return {
        ok: res.rows[0]?.ok === 1,
        backend: "postgres",
        dbRole: res.rows[0]?.role,
      };
    } finally {
      client.release();
    }
  }

  async close() {
    if (this.pool && typeof this.pool.end === "function") {
      await this.pool.end();
    }
  }

  /**
   * Execute `fn(client, ctx)` inside an isolated PostgreSQL transaction with
   * transaction-local role and RLS session GUCs (`app.current_user_id`, `app.current_user_role`).
   */
  async withActorContext(actor, fn) {
    const ctx = normalizeActor(actor);
    return this._runInTx(ctx.userId, ctx.role, fn, ctx);
  }

  /**
   * Controlled internal bootstrap transaction ONLY for credential lookup & session creation.
   * Never exposed via `withActorContext`.
   */
  async _withAuthBootstrapContext(fn) {
    return this._runInTx("", "auth_bootstrap", fn, { userId: "", role: "auth_bootstrap" });
  }

  async _runInTx(userId, role, fn, ctxObj) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (this.appRole) {
        await client.query(`SET LOCAL ROLE ${this.appRole}`);
      }
      await client.query(
        "SELECT set_config('app.current_user_id', $1, true), set_config('app.current_user_role', $2, true)",
        [userId, role],
      );
      const result = await fn(client, ctxObj);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* preserve primary error */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async countActiveDemoUsers() {
    return this.withActorContext({ role: "anonymous" }, async (client) => {
      if (this._hasHardening002 !== false) {
        try {
          const r = await client.query("SELECT public.cv_count_active_demo_users() AS n");
          return Number(r.rows[0]?.n ?? 0);
        } catch {
          this._hasHardening002 = false;
        }
      }
      return 0;
    });
  }

  async createUser(actor, { id, email, displayName, role, passwordHash, locale = "en", isDemo = false }) {
    return this.withActorContext(actor, async (client) => {
      const res = await client.query(
        `INSERT INTO users (id, email, display_name, role, password_hash, locale, is_demo)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, email, display_name, role, locale, is_demo, created_at, disabled_at`,
        [id, email, displayName, role, passwordHash, locale, Boolean(isDemo)],
      );
      return mapPgUser(res.rows[0]);
    });
  }

  async ensureDemoFlag(actor, userId) {
    return this.withActorContext(actor, async (client) => {
      await client.query("UPDATE users SET is_demo = TRUE WHERE id = $1", [userId]);
    });
  }

  async findUserById(actor, userId) {
    if (!userId) return null;
    return this.withActorContext(actor, async (client) => {
      const res = await client.query(
        `SELECT id, email, display_name, role, locale, is_demo, created_at, disabled_at
         FROM users WHERE id = $1`,
        [userId],
      );
      return mapPgUser(res.rows[0]);
    });
  }

  async findUserByEmail(actor, email) {
    if (!email) return null;
    return this.withActorContext(actor, async (client) => {
      const res = await client.query(
        `SELECT id, email, display_name, role, locale, is_demo, created_at, disabled_at
         FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [String(email).trim()],
      );
      return mapPgUser(res.rows[0]);
    });
  }

  async listUsers(actor) {
    return this.withActorContext(actor, async (client) => {
      const res = await client.query(
        `SELECT id, email, display_name, role, locale, is_demo, created_at, disabled_at
         FROM users ORDER BY role, display_name`,
      );
      return res.rows.map(mapPgUser);
    });
  }

  async lookupAuthUserForLogin(email) {
    if (!email) return null;
    return this._withAuthBootstrapContext(async (client) => {
      const res = await client.query(
        "SELECT * FROM public.cv_lookup_auth_user($1)",
        [String(email).trim()],
      );
      if (res.rowCount === 0) return null;
      const row = res.rows[0];
      return {
        ...mapPgUser(row),
        password_hash: row.password_hash,
      };
    });
  }

  async createSession({ id, userId, createdAt, lastSeenAt, expiresAt, userAgent, ip }) {
    return this._withAuthBootstrapContext(async (client) => {
      await client.query(
        `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent, ip)
         VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5::timestamptz, $6, $7)`,
        [id, userId, createdAt, lastSeenAt, expiresAt, userAgent, ip],
      );
    });
  }

  async resolveSessionRecord(sessionId) {
    if (!sessionId) return null;
    return this.withActorContext({ role: "anonymous" }, async (client) => {
      const res = await client.query("SELECT * FROM public.cv_resolve_session($1)", [sessionId]);
      if (res.rowCount === 0) return null;
      const r = res.rows[0];
      return {
        session: {
          id: r.session_id,
          user_id: r.user_id,
          created_at:
            r.session_created_at instanceof Date
              ? r.session_created_at.toISOString()
              : r.session_created_at,
          last_seen_at:
            r.session_last_seen_at instanceof Date
              ? r.session_last_seen_at.toISOString()
              : r.session_last_seen_at,
          expires_at:
            r.session_expires_at instanceof Date
              ? r.session_expires_at.toISOString()
              : r.session_expires_at,
        },
        user: mapPgUser({
          id: r.user_id,
          email: r.email,
          display_name: r.display_name,
          role: r.role,
          locale: r.locale,
          is_demo: r.is_demo,
          created_at: r.user_created_at,
          disabled_at: r.disabled_at,
        }),
      };
    });
  }

  async touchSession(sessionId, { lastSeenAt, expiresAt }) {
    return this.withActorContext({ role: "anonymous" }, async (client) => {
      await client.query("SELECT public.cv_touch_session($1, $2::timestamptz, $3::timestamptz)", [
        sessionId,
        lastSeenAt,
        expiresAt,
      ]);
    });
  }

  async deleteSession(sessionId) {
    return this.withActorContext({ role: "anonymous" }, async (client) => {
      const res = await client.query("SELECT public.cv_delete_session($1) AS user_id", [sessionId]);
      return res.rows[0]?.user_id ?? null;
    });
  }

  async createDocument(actor, doc) {
    return this.withActorContext(actor, async (client) => {
      const res = await client.query(
        `INSERT INTO documents
          (id, title_en, title_zh, author, description, storage_key, content_hash,
           byte_size, page_count, synthetic, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          doc.id,
          doc.titleEn,
          doc.titleZh ?? null,
          doc.author ?? null,
          doc.description ?? null,
          doc.storageKey,
          doc.contentHash,
          doc.byteSize,
          doc.pageCount,
          doc.synthetic !== false,
          doc.uploadedBy,
        ],
      );
      return mapPgDoc(res.rows[0]);
    });
  }

  async findDocument(actor, id) {
    if (!id) return null;
    return this.withActorContext(actor, async (client) => {
      const res = await client.query("SELECT * FROM documents WHERE id = $1", [id]);
      return mapPgDoc(res.rows[0]);
    });
  }

  async listDocuments(actor) {
    return this.withActorContext(actor, async (client) => {
      const res = await client.query(
        `SELECT d.id, d.title_en, d.title_zh, d.author, d.page_count, d.synthetic,
                d.created_at, d.archived_at, d.byte_size,
                (SELECT COUNT(*)::INTEGER FROM entitlements e
                  WHERE e.document_id = d.id AND e.status = 'active') AS active_grants
         FROM documents d
         WHERE d.archived_at IS NULL
         ORDER BY d.created_at DESC`,
      );
      return res.rows.map(mapPgDoc);
    });
  }

  async listReadableDocuments(actor) {
    // Kernel RLS (`documents_read_entitled_or_admin`) enforces document visibility!
    // When running against a real PostgreSQL schema with entitlements/reading_progress,
    // student view enriches with entitlement + progress metadata; simple `SELECT * FROM documents`
    // remains used if running against a minimal mock pool in unit contract tests.
    return this.withActorContext(actor, async (client, ctx) => {
      if (ctx.role !== "student" || !this._hasHardening002) {
        const res = await client.query(
          "SELECT * FROM documents WHERE archived_at IS NULL ORDER BY created_at DESC",
        );
        return res.rows.map(mapPgDoc);
      }
      const res = await client.query(
        `SELECT d.id, d.title_en, d.title_zh, d.author, d.description,
                d.page_count, d.synthetic, d.created_at, d.byte_size,
                e.id AS entitlement_id, e.status AS entitlement_status,
                e.expires_at, e.version,
                COALESCE(rp.last_page, 1) AS last_page,
                COALESCE(rp.pages_read, 0) AS pages_read,
                rp.updated_at AS last_read_at
         FROM documents d
         JOIN entitlements e ON e.document_id = d.id AND e.user_id = $1
         LEFT JOIN reading_progress rp ON rp.document_id = d.id AND rp.user_id = $1
         WHERE d.archived_at IS NULL
         ORDER BY d.created_at DESC`,
        [ctx.userId],
      );
      return res.rows.map(mapPgDoc);
    });
  }

  async addChapter(actor, ch) {
    return this.withActorContext(actor, async (client) => {
      await client.query(
        `INSERT INTO chapters
          (id, document_id, ordinal, title_en, title_zh, start_page, end_page,
           audio_key, audio_mime, audio_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          ch.id,
          ch.documentId,
          ch.ordinal,
          ch.titleEn,
          ch.titleZh ?? null,
          ch.startPage,
          ch.endPage,
          ch.audioKey ?? null,
          ch.audioMime ?? null,
          ch.audioSeconds ?? null,
        ],
      );
      return ch.id;
    });
  }

  async listChapters(actor, documentId) {
    if (!documentId) return [];
    return this.withActorContext(actor, async (client) => {
      const res = await client.query(
        `SELECT id, document_id, ordinal, title_en, title_zh, start_page, end_page,
                (audio_key IS NOT NULL) AS has_audio, audio_mime, audio_seconds
         FROM chapters WHERE document_id = $1 ORDER BY ordinal`,
        [documentId],
      );
      return res.rows;
    });
  }

  async findChapterForPage(actor, documentId, page) {
    if (!documentId) return null;
    return this.withActorContext(actor, async (client) => {
      const res = await client.query(
        `SELECT * FROM chapters
         WHERE document_id = $1 AND start_page <= $2 AND end_page >= $2
         ORDER BY ordinal LIMIT 1`,
        [documentId, page],
      );
      return res.rows[0] ?? null;
    });
  }

  async findChapterById(actor, documentId, chapterId) {
    if (!documentId || !chapterId) return null;
    return this.withActorContext(actor, async (client) => {
      const res = await client.query(
        "SELECT * FROM chapters WHERE document_id = $1 AND id = $2",
        [documentId, chapterId],
      );
      return res.rows[0] ?? null;
    });
  }

  async attachChapterAudio(actor, { documentId, chapterId, audioKey, audioMime, audioSeconds }) {
    return this.withActorContext(actor, async (client) => {
      const res = await client.query(
        `UPDATE chapters
         SET audio_key = $1, audio_mime = $2, audio_seconds = COALESCE($3, audio_seconds)
         WHERE id = $4 AND document_id = $5`,
        [audioKey, audioMime, audioSeconds ?? null, chapterId, documentId],
      );
      return res.rowCount > 0;
    });
  }

  async getEntitlement(actor, userId, documentId) {
    if (!userId || !documentId) return null;
    return this.withActorContext(actor, async (client) => {
      const res = await client.query(
        "SELECT * FROM entitlements WHERE user_id = $1 AND document_id = $2",
        [userId, documentId],
      );
      return mapPgEntitlement(res.rows[0]);
    });
  }

  async grantEntitlement(actor, { id, userId, documentId, grantedBy, expiresAt = null }) {
    return this.withActorContext(actor, async (client) => {
      const cur = await client.query(
        "SELECT * FROM entitlements WHERE user_id = $1 AND document_id = $2 FOR UPDATE",
        [userId, documentId],
      );
      const existing = mapPgEntitlement(cur.rows[0]);

      if (existing && existing.status === "active" && existing.expires_at === expiresAt) {
        return { changed: false, mode: "noop", previousStatus: existing.status, entitlement: existing };
      }

      if (existing) {
        const upd = await client.query(
          `UPDATE entitlements
           SET status = 'active', expires_at = $1::timestamptz, granted_by = $2, granted_at = NOW(),
               revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL,
               version = version + 1
           WHERE id = $3
           RETURNING *`,
          [expiresAt, grantedBy, existing.id],
        );
        return {
          changed: true,
          mode: "regrant",
          previousStatus: existing.status,
          entitlement: mapPgEntitlement(upd.rows[0]),
        };
      }

      const ins = await client.query(
        `INSERT INTO entitlements
          (id, user_id, document_id, status, version, granted_by, granted_at, expires_at)
         VALUES ($1, $2, $3, 'active', 1, $4, NOW(), $5::timestamptz)
         RETURNING *`,
        [id, userId, documentId, grantedBy, expiresAt],
      );
      return {
        changed: true,
        mode: "new",
        previousStatus: null,
        entitlement: mapPgEntitlement(ins.rows[0]),
      };
    });
  }

  async revokeEntitlement(actor, { userId, documentId, revokedBy, reason = "admin_revoke" }) {
    return this.withActorContext(actor, async (client) => {
      const cur = await client.query(
        "SELECT * FROM entitlements WHERE user_id = $1 AND document_id = $2 FOR UPDATE",
        [userId, documentId],
      );
      const existing = mapPgEntitlement(cur.rows[0]);
      if (!existing) {
        return { changed: false, reason: "not_found" };
      }
      if (existing.status === "revoked") {
        return { changed: false, reason: "already_revoked", entitlement: existing };
      }
      const upd = await client.query(
        `UPDATE entitlements
         SET status = 'revoked', revoked_by = $1, revoked_at = NOW(), revoke_reason = $2,
             version = version + 1
         WHERE id = $3
         RETURNING *`,
        [revokedBy, reason, existing.id],
      );
      return {
        changed: true,
        previousStatus: existing.status,
        entitlement: mapPgEntitlement(upd.rows[0]),
      };
    });
  }

  async listEntitlementsForDocument(actor, documentId) {
    return this.withActorContext(actor, async (client) => {
      const res = await client.query(
        `SELECT e.id, e.user_id, u.display_name, u.email, e.status, e.version,
                e.granted_at, e.expires_at, e.revoked_at, e.revoke_reason
         FROM entitlements e
         JOIN users u ON u.id = e.user_id
         WHERE e.document_id = $1
         ORDER BY u.display_name`,
        [documentId],
      );
      return res.rows.map(mapPgEntitlement);
    });
  }

  async listEntitlements(actor) {
    return this.withActorContext(actor, async (client) => {
      const res = await client.query("SELECT * FROM entitlements ORDER BY granted_at DESC");
      return res.rows.map(mapPgEntitlement);
    });
  }

  async recordProgress(actor, { userId, documentId, page, pageCount }) {
    const cap = Math.max(Number(pageCount) || 1, 1);
    const safePage = Math.min(Math.max(Number(page) || 1, 1), cap);
    return this.withActorContext(actor, async (client) => {
      await client.query(
        `INSERT INTO reading_progress (user_id, document_id, last_page, pages_read, updated_at)
         VALUES ($1, $2, $3, 1, NOW())
         ON CONFLICT (user_id, document_id) DO UPDATE SET
           pages_read = CASE
             WHEN reading_progress.last_page = EXCLUDED.last_page THEN reading_progress.pages_read
             ELSE LEAST($4, reading_progress.pages_read + 1)
           END,
           last_page = EXCLUDED.last_page,
           updated_at = NOW()`,
        [userId, documentId, safePage, cap],
      );
    });
  }

  async getProgress(actor, userId, documentId) {
    return this.withActorContext(actor, async (client) => {
      const res = await client.query(
        "SELECT last_page, pages_read, updated_at FROM reading_progress WHERE user_id = $1 AND document_id = $2",
        [userId, documentId],
      );
      if (res.rowCount === 0) return null;
      const r = res.rows[0];
      return {
        last_page: Number(r.last_page),
        pages_read: Number(r.pages_read),
        updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
      };
    });
  }

  async createPortfolioEnquiry(actor, { id, senderName, senderOrg, senderEmail, topic, message }) {
    return this.withActorContext(actor, async (client, ctx) => {
      await client.query(
        `INSERT INTO portfolio_enquiries
          (id, actor_id, sender_name, sender_org, sender_email, topic, message)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, ctx.userId || null, senderName, senderOrg ?? null, senderEmail, topic, message],
      );
      return id;
    });
  }

  async listPortfolioEnquiries(actor) {
    return this.withActorContext(actor, async (client) => {
      const res = await client.query(
        `SELECT id, created_at, actor_id, sender_name, sender_org, sender_email, topic, message
         FROM portfolio_enquiries ORDER BY created_at DESC LIMIT 100`,
      );
      return res.rows.map((r) => ({
        ...r,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      }));
    });
  }

  async appendAuditLog(actor, entry) {
    // Bind transaction context to match the audit actor (`audit_insert_actor_bound` policy)
    const txRole =
      actor?.role && VALID_ACTOR_ROLES.has(actor.role) ? actor.role : null;
    const runFn = async (client) => {
      await client.query(
        `INSERT INTO audit_log
          (id, created_at, event, outcome, actor_id, actor_role, subject_id, document_id, page, ip, user_agent, detail)
         VALUES ($1, COALESCE($2::timestamptz, NOW()), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
        [
          entry.id,
          entry.createdAt || null,
          entry.event,
          entry.outcome,
          entry.actorId ?? null,
          entry.actorRole ?? null,
          entry.subjectId ?? null,
          entry.documentId ?? null,
          entry.page ?? null,
          entry.ip ?? null,
          entry.userAgent ? String(entry.userAgent).slice(0, 300) : null,
          entry.detail ? JSON.stringify(entry.detail) : null,
        ],
      );
    };

    if (
      txRole === "admin" ||
      (txRole &&
        String(actor.id || actor.userId || "") === String(entry.actorId || "") &&
        txRole === String(entry.actorRole || "anonymous"))
    ) {
      return this.withActorContext(actor, runFn);
    }
    return this._withAuthBootstrapContext(runFn);
  }

  async listAuditLog(actor, { limit = 100, documentId = null, event = null, outcome = null } = {}) {
    return this.withActorContext(actor, async (client) => {
      const clauses = [];
      const params = [];
      if (documentId) {
        params.push(documentId);
        clauses.push(`document_id = $${params.length}`);
      }
      if (event) {
        params.push(event);
        clauses.push(`event = $${params.length}`);
      }
      if (outcome) {
        params.push(outcome);
        clauses.push(`outcome = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
      params.push(safeLimit);
      const res = await client.query(
        `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
        params,
      );
      return res.rows.map((r) => ({
        ...r,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      }));
    });
  }

  async getAdminStats(actor) {
    return this.withActorContext(actor, async (client) => {
      const res = await client.query(`
        SELECT
          (SELECT COUNT(*)::INTEGER FROM users) AS users,
          (SELECT COUNT(*)::INTEGER FROM documents WHERE archived_at IS NULL) AS documents,
          (SELECT COUNT(*)::INTEGER FROM entitlements WHERE status = 'active') AS active_entitlements,
          (SELECT COUNT(*)::INTEGER FROM audit_log WHERE outcome = 'allow') AS audit_allows,
          (SELECT COUNT(*)::INTEGER FROM audit_log WHERE outcome = 'deny') AS audit_denies
      `);
      const r = res.rows[0];
      return {
        users: Number(r.users),
        documents: Number(r.documents),
        activeEntitlements: Number(r.active_entitlements),
        auditAllows: Number(r.audit_allows),
        auditDenies: Number(r.audit_denies),
      };
    });
  }

  /**
   * Attack-resistant shared PostgreSQL rate limiter (`AUD-C4`, `AUD-D2`).
   * Uses `public.cv_check_rate_limit` when migration 002 is present; otherwise
   * falls back to direct SQL with corrected OLDEST-first (`ORDER BY expires_at_ms ASC LIMIT`) eviction.
   */
  async rateLimit(
    key,
    limit,
    windowSeconds,
    { increment = true, maxBuckets = this.maxBuckets, protectLockout = false } = {},
  ) {
    return this.withActorContext({ role: "anonymous" }, async (client) => {
      const now = Date.now();
      const windowMs = Math.max(1, Math.floor(windowSeconds * 1000));

      if (this._hasHardening002 !== false) {
        try {
          const fnRes = await client.query(
            "SELECT * FROM public.cv_check_rate_limit($1, $2, $3, $4, $5, $6, $7)",
            [
              String(key || "").slice(0, 256),
              limit,
              windowMs,
              now,
              Boolean(increment),
              maxBuckets,
              Boolean(protectLockout),
            ],
          );
          if (fnRes.rowCount > 0) {
            this._hasHardening002 = true;
            const r = fnRes.rows[0];
            return {
              allowed: Boolean(r.allowed),
              count: Number(r.current_count),
              remaining: Number(r.remaining),
              ...(r.allowed ? {} : { retryAfter: Math.max(1, Number(r.retry_after_sec || 1)) }),
              ...(r.saturated ? { saturated: true } : {}),
            };
          }
        } catch (err) {
          if (!String(err.message || "").includes("cv_check_rate_limit")) {
            throw err;
          }
          this._hasHardening002 = false;
        }
      }

      // Fallback path for 001-only schema / mock pools — fixes AUD-C4 eviction order (`ASC LIMIT`, never `ASC OFFSET`)!
      await client.query("DELETE FROM rate_limit_buckets WHERE expires_at_ms <= $1", [now]);

      if (!increment) {
        const cur = await client.query(
          "SELECT window_start_ms, expires_at_ms, count FROM rate_limit_buckets WHERE bucket_key = $1",
          [key],
        );
        if (cur.rowCount === 0) {
          return { allowed: true, count: 0, remaining: limit };
        }
        const row = cur.rows[0];
        const count = Number(row.count);
        if (count >= limit) {
          return {
            allowed: false,
            count,
            remaining: 0,
            retryAfter: Math.max(1, Math.ceil((Number(row.expires_at_ms) - now) / 1000)),
          };
        }
        return { allowed: true, count, remaining: Math.max(0, limit - count) };
      }

      const cntRes = await client.query("SELECT COUNT(*)::INTEGER AS n FROM rate_limit_buckets");
      const currentTotal = Number(cntRes.rows[0]?.n ?? 0);
      if (currentTotal >= maxBuckets) {
        const overflow = (currentTotal - maxBuckets) + 1;
        await client.query(
          `DELETE FROM rate_limit_buckets
           WHERE bucket_key IN (
             SELECT bucket_key FROM rate_limit_buckets
             ORDER BY expires_at_ms ASC
             LIMIT $1
           )`,
          [overflow],
        );
      }

      const upsert = await client.query(
        `INSERT INTO rate_limit_buckets (bucket_key, window_start_ms, expires_at_ms, count)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (bucket_key) DO UPDATE SET
           window_start_ms = CASE
             WHEN rate_limit_buckets.expires_at_ms <= $2 THEN $2
             ELSE rate_limit_buckets.window_start_ms
           END,
           expires_at_ms = CASE
             WHEN rate_limit_buckets.expires_at_ms <= $2 THEN $3
             ELSE rate_limit_buckets.expires_at_ms
           END,
           count = CASE
             WHEN rate_limit_buckets.expires_at_ms <= $2 THEN 1
             ELSE rate_limit_buckets.count + 1
           END
         RETURNING expires_at_ms, count`,
        [key, now, now + windowMs],
      );
      const { expires_at_ms: expMs, count: rawCount } = upsert.rows[0];
      const nextCount = Number(rawCount);
      if (nextCount > limit) {
        return {
          allowed: false,
          count: nextCount,
          remaining: 0,
          retryAfter: Math.max(1, Math.ceil((Number(expMs) - now) / 1000)),
        };
      }
      return { allowed: true, count: nextCount, remaining: Math.max(0, limit - nextCount) };
    });
  }

  async clearRateLimit(key) {
    return this.withActorContext({ role: "anonymous" }, async (client) => {
      if (this._hasHardening002 !== false) {
        try {
          await client.query("SELECT public.cv_clear_rate_limit($1)", [String(key || "").slice(0, 256)]);
          return;
        } catch {
          this._hasHardening002 = false;
        }
      }
      await client.query("DELETE FROM rate_limit_buckets WHERE bucket_key = $1", [
        String(key || "").slice(0, 256),
      ]);
    });
  }

  async redeemSingleUseToken(jti, expiresAtEpochSec) {
    return this.withActorContext({ role: "anonymous" }, async (client) => {
      const nowSec = Math.floor(Date.now() / 1000);
      if (this._hasHardening002 !== false) {
        try {
          const fnRes = await client.query(
            "SELECT public.cv_redeem_token($1, $2, $3) AS redeemed",
            [jti, nowSec, expiresAtEpochSec],
          );
          if (fnRes.rowCount > 0 && "redeemed" in fnRes.rows[0]) {
            this._hasHardening002 = true;
            return Boolean(fnRes.rows[0].redeemed);
          }
        } catch (err) {
          if (!String(err.message || "").includes("cv_redeem_token")) {
            throw err;
          }
          this._hasHardening002 = false;
        }
      }

      await client.query("DELETE FROM token_redemptions WHERE expires_at < $1", [nowSec]);
      const ins = await client.query(
        `INSERT INTO token_redemptions (jti, redeemed_at, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (jti) DO NOTHING`,
        [jti, nowSec, expiresAtEpochSec],
      );
      return ins.rowCount === 1;
    });
  }
}

/* ============================================================================
 * 3. Attack-Resistant Shared SQLite Rate Limiter (`AUD-D2` Fixed)
 * ============================================================================
 *   1. Always reclaims expired buckets BEFORE any capacity or eviction decision.
 *   2. Active security lockouts (`is_locked = 1` or `protectLockout && count >= limit`)
 *      are NEVER evicted by high-cardinality key sprays!
 *   3. Evicts soonest-expiring unlocked rows (`WHERE is_locked = 0 ORDER BY expires_at_ms ASC`).
 *   4. Fails closed on new admission if 100% of `maxBuckets` are active lockouts.
 */
export function sharedSqliteRateLimit(
  db,
  key,
  limit,
  windowSeconds,
  { increment = true, maxBuckets = RATE_LIMIT_MAX_BUCKETS, protectLockout = false } = {},
) {
  const safeKey = String(key || "").slice(0, 256);
  const now = Date.now();
  const windowMs = Math.max(1, Math.floor(windowSeconds * 1000));

  // Always reclaim expired rows first so expired records never consume capacity
  db.prepare("DELETE FROM rate_limit_buckets WHERE expires_at_ms <= ?").run(now);

  const existing = db
    .prepare(
      "SELECT window_start_ms, expires_at_ms, count, is_locked FROM rate_limit_buckets WHERE bucket_key = ?",
    )
    .get(safeKey);

  if (!existing) {
    if (!increment) {
      return { allowed: true, count: 0, remaining: Math.max(0, limit) };
    }

    const totalRow = db.prepare("SELECT COUNT(*) AS n FROM rate_limit_buckets").get();
    if ((totalRow?.n ?? 0) >= maxBuckets) {
      const overflow = (totalRow.n - maxBuckets) + 1;
      db.prepare(
        `DELETE FROM rate_limit_buckets
         WHERE bucket_key IN (
           SELECT bucket_key FROM rate_limit_buckets
           WHERE is_locked = 0
           ORDER BY expires_at_ms ASC
           LIMIT ?
         )`,
      ).run(overflow);

      const afterEvict = db.prepare("SELECT COUNT(*) AS n FROM rate_limit_buckets").get();
      if ((afterEvict?.n ?? 0) >= maxBuckets) {
        // Storage is 100% occupied by non-expired security lockouts: fail closed!
        return {
          allowed: false,
          count: limit + 1,
          remaining: 0,
          retryAfter: Math.max(1, Math.ceil(windowMs / 1000)),
          saturated: true,
        };
      }
    }

    const lockNow = protectLockout && 1 >= limit ? 1 : 0;
    db.prepare(
      `INSERT INTO rate_limit_buckets (bucket_key, window_start_ms, expires_at_ms, count, is_locked)
       VALUES (?, ?, ?, 1, ?)`,
    ).run(safeKey, now, now + windowMs, lockNow);

    return {
      allowed: 1 <= limit,
      count: 1,
      remaining: Math.max(0, limit - 1),
      ...(1 > limit ? { retryAfter: Math.max(1, Math.ceil(windowMs / 1000)) } : {}),
    };
  }

  const nextCount = increment ? Number(existing.count) + 1 : Number(existing.count);
  const nextLocked =
    Number(existing.is_locked) === 1 || (protectLockout && nextCount >= limit) ? 1 : 0;

  if (increment) {
    db.prepare(
      "UPDATE rate_limit_buckets SET count = ?, is_locked = ? WHERE bucket_key = ?",
    ).run(nextCount, nextLocked, safeKey);
  }

  if (nextCount > limit || (!increment && nextCount >= limit)) {
    const retryAfter = Math.max(
      1,
      Math.ceil((Number(existing.expires_at_ms) - now) / 1000),
    );
    return { allowed: false, count: nextCount, remaining: 0, retryAfter };
  }
  return { allowed: true, count: nextCount, remaining: Math.max(0, limit - nextCount) };
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/* ============================================================================
 * 4. Active Application Persistence Singleton (Zero Silent Fallback)
 * ============================================================================ */
let activeAdapter = null;
let initPromise = null;

export function setPersistenceAdapter(adapter) {
  activeAdapter = adapter;
  initPromise = adapter ? Promise.resolve(adapter) : null;
}

export function getActivePersistenceAdapterSync() {
  if (activeAdapter) return activeAdapter;
  const backend = resolveDbBackend();
  if (backend === "sqlite") {
    activeAdapter = new SqlitePersistenceAdapter();
    return activeAdapter;
  }
  return null;
}

export async function initializePersistence() {
  if (activeAdapter) return activeAdapter;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const backend = resolveDbBackend();
    if (backend === "postgres") {
      // NEVER touch SQLite (`getDb()`) or fall back to SQLite when PostgreSQL is configured!
      const pgSpec = process.env.CV_PG_MODULE || "pg";
      const pgMod = await import(pgSpec);
      const { Pool } = pgMod.default || pgMod;
      const pool = new Pool(buildPgPoolConfig(process.env.DATABASE_URL));
      const enforceRoleSeparation =
        process.env.CV_ENFORCE_DB_ROLE_SEPARATION !== undefined
          ? process.env.CV_ENFORCE_DB_ROLE_SEPARATION !== "0"
          : true;

      const pgAdapter = new PostgresPersistenceAdapter(pool, {
        // Connect directly as `cv_runtime` (which also holds `cv_app_user`); keep
        // appRole = "cv_app_user" for explicit defense-in-depth inside transactions.
        appRole: "cv_app_user",
        enforceRoleSeparation,
      });
      try {
        await pgAdapter.init();
        const demoCount = isProduction() ? await pgAdapter.countActiveDemoUsers() : 0;
        assertProductionSafety(null, demoCount);
      } catch (err) {
        await pgAdapter.close().catch(() => {});
        throw err;
      }
      activeAdapter = pgAdapter;
      return activeAdapter;
    }

    // Lightweight local development SQLite mode
    const sqliteAdapter = new SqlitePersistenceAdapter();
    await sqliteAdapter.init();
    assertProductionSafety(getDb());
    activeAdapter = sqliteAdapter;
    return activeAdapter;
  })();

  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

export async function getPersistenceAdapter() {
  if (activeAdapter) return activeAdapter;
  return initializePersistence();
}

export async function closePersistenceAdapter() {
  const cur = activeAdapter;
  activeAdapter = null;
  initPromise = null;
  if (cur) {
    await cur.close();
  } else {
    closeDb();
  }
}

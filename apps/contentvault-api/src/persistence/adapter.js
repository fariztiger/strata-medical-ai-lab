/**
 * Pluggable Persistence Adapter (Mission 004 Phase C).
 *
 * Provides a uniform repository & security-coordination boundary across:
 *   1. `SqlitePersistenceAdapter` (default local zero-dependency engine via `node:sqlite`)
 *   2. `PostgresPersistenceAdapter` (production multi-replica PostgreSQL 16 engine with
 *      transaction-scoped `SET LOCAL ROLE cv_app_user` + `app.current_user_id` /
 *      `app.current_user_role` Row-Level Security enforcement).
 */

import { getDb, nowIso } from "../db.js";
import { RATE_LIMIT_MAX_BUCKETS } from "../config.js";

function normalizeActor(actor = {}) {
  return {
    userId: String(actor?.id || actor?.userId || ""),
    role: String(actor?.role || "anonymous"),
  };
}

export class SqlitePersistenceAdapter {
  constructor(dbProvider = getDb) {
    this.kind = "sqlite";
    this._getDb = dbProvider;
  }

  async withActorContext(actor, fn) {
    const ctx = normalizeActor(actor);
    return fn(this._getDb(), ctx);
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
          `SELECT d.*
           FROM documents d
           JOIN entitlements e ON e.document_id = d.id
           WHERE e.user_id = ?
             AND e.status = 'active'
             AND (e.expires_at IS NULL OR e.expires_at > ?)
             AND d.archived_at IS NULL
           ORDER BY d.created_at DESC`,
        )
        .all(ctx.userId, now);
    });
  }

  async listPortfolioEnquiries(actor) {
    return this.withActorContext(actor, (db, ctx) => {
      if (ctx.role !== "admin" && ctx.role !== "reviewer") {
        throw Object.assign(new Error("Forbidden by row-level policy"), { code: "RLS_DENIED" });
      }
      return db
        .prepare("SELECT * FROM portfolio_enquiries ORDER BY created_at DESC LIMIT 50")
        .all();
    });
  }

  async rateLimit(key, limit, windowSeconds, { increment = true, maxBuckets = RATE_LIMIT_MAX_BUCKETS } = {}) {
    return sharedSqliteRateLimit(this._getDb(), key, limit, windowSeconds, {
      increment,
      maxBuckets,
    });
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

/**
 * Production PostgreSQL 16 adapter enforcing database-kernel Row-Level Security.
 * Accepts any `pg.Pool`-compatible client factory (`pool.connect() -> client`).
 */
export class PostgresPersistenceAdapter {
  constructor(pool, { appRole = "cv_app_user", maxBuckets = RATE_LIMIT_MAX_BUCKETS } = {}) {
    if (!pool || typeof pool.connect !== "function") {
      throw new Error("PostgresPersistenceAdapter requires a pg.Pool-compatible instance.");
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(appRole)) {
      throw new Error("Invalid PostgreSQL identifier for appRole.");
    }
    this.kind = "postgres";
    this.pool = pool;
    this.appRole = appRole;
    this.maxBuckets = maxBuckets;
  }

  /**
   * Execute `fn(client, ctx)` inside an isolated PostgreSQL transaction with
   * `SET LOCAL ROLE cv_app_user` and transaction-local RLS session variables.
   */
  async withActorContext(actor, fn) {
    const ctx = normalizeActor(actor);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${this.appRole}`);
      await client.query(
        "SELECT set_config('app.current_user_id', $1, true), set_config('app.current_user_role', $2, true)",
        [ctx.userId, ctx.role],
      );
      const result = await fn(client, ctx);
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

  async listReadableDocuments(actor) {
    // Note: No application-side entitlement join is needed here — PostgreSQL RLS
    // (`documents_read_entitled_or_admin`) enforces row visibility in the DB kernel!
    return this.withActorContext(actor, async (client) => {
      const res = await client.query(
        "SELECT * FROM documents WHERE archived_at IS NULL ORDER BY created_at DESC",
      );
      return res.rows;
    });
  }

  async listEntitlements(actor) {
    return this.withActorContext(actor, async (client) => {
      const res = await client.query("SELECT * FROM entitlements ORDER BY granted_at DESC");
      return res.rows;
    });
  }

  async listPortfolioEnquiries(actor) {
    return this.withActorContext(actor, async (client) => {
      const res = await client.query(
        "SELECT * FROM portfolio_enquiries ORDER BY created_at DESC LIMIT 50",
      );
      return res.rows;
    });
  }

  async appendAuditLog(actor, entry) {
    return this.withActorContext(actor, async (client) => {
      await client.query(
        `INSERT INTO audit_log
          (id, created_at, event, outcome, actor_id, actor_role, subject_id, document_id, page, ip, user_agent, detail)
         VALUES ($1, COALESCE($2::timestamptz, NOW()), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
        [
          entry.id,
          entry.createdAt || null,
          entry.event,
          entry.outcome,
          entry.actorId || null,
          entry.actorRole || null,
          entry.subjectId || null,
          entry.documentId || null,
          entry.page ?? null,
          entry.ip || null,
          entry.userAgent || null,
          entry.detail ? JSON.stringify(entry.detail) : null,
        ],
      );
    });
  }

  async rateLimit(key, limit, windowSeconds, { increment = true } = {}) {
    return this.withActorContext({ role: "anonymous" }, async (client) => {
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
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

      // Enforce strict bucket cardinality bound prior to insert
      await client.query(
        `DELETE FROM rate_limit_buckets
         WHERE bucket_key IN (
           SELECT bucket_key FROM rate_limit_buckets
           ORDER BY expires_at_ms ASC
           OFFSET $1
         )`,
        [Math.max(1, this.maxBuckets - 1)],
      );

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

  async redeemSingleUseToken(jti, expiresAtEpochSec) {
    return this.withActorContext({ role: "anonymous" }, async (client) => {
      const nowSec = Math.floor(Date.now() / 1000);
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

let pruneTick = 0;

/**
 * Shared & strictly bounded SQLite rate-limiter implementation used by default
 * across local HTTP routes and `SqlitePersistenceAdapter`.
 */
export function sharedSqliteRateLimit(
  db,
  key,
  limit,
  windowSeconds,
  { increment = true, maxBuckets = RATE_LIMIT_MAX_BUCKETS } = {},
) {
  const safeKey = String(key || "").slice(0, 256);
  const now = Date.now();
  const windowMs = Math.max(1, Math.floor(windowSeconds * 1000));

  pruneTick = (pruneTick + 1) % 32;
  if (pruneTick === 1) {
    db.prepare("DELETE FROM rate_limit_buckets WHERE expires_at_ms <= ?").run(now);
  }

  const existing = db
    .prepare(
      "SELECT window_start_ms, expires_at_ms, count FROM rate_limit_buckets WHERE bucket_key = ?",
    )
    .get(safeKey);

  if (!existing || Number(existing.expires_at_ms) <= now) {
    if (!increment) {
      return { allowed: true, count: 0, remaining: limit };
    }
    const totalRow = db.prepare("SELECT COUNT(*) AS n FROM rate_limit_buckets").get();
    if ((totalRow?.n ?? 0) >= maxBuckets) {
      db.prepare("DELETE FROM rate_limit_buckets WHERE expires_at_ms <= ?").run(now);
      const afterPrune = db.prepare("SELECT COUNT(*) AS n FROM rate_limit_buckets").get();
      if ((afterPrune?.n ?? 0) >= maxBuckets) {
        const overflow = (afterPrune.n - maxBuckets) + 1;
        db.prepare(
          `DELETE FROM rate_limit_buckets
           WHERE bucket_key IN (
             SELECT bucket_key FROM rate_limit_buckets
             ORDER BY expires_at_ms ASC
             LIMIT ?
           )`,
        ).run(overflow);
      }
    }

    db.prepare(
      `INSERT INTO rate_limit_buckets (bucket_key, window_start_ms, expires_at_ms, count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(bucket_key) DO UPDATE SET
         window_start_ms = excluded.window_start_ms,
         expires_at_ms = excluded.expires_at_ms,
         count = 1`,
    ).run(safeKey, now, now + windowMs);

    return {
      allowed: 1 <= limit,
      count: 1,
      remaining: Math.max(0, limit - 1),
      ...(1 > limit ? { retryAfter: Math.max(1, Math.ceil(windowMs / 1000)) } : {}),
    };
  }

  const nextCount = increment ? Number(existing.count) + 1 : Number(existing.count);
  if (increment) {
    db.prepare("UPDATE rate_limit_buckets SET count = ? WHERE bucket_key = ?").run(
      nextCount,
      safeKey,
    );
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

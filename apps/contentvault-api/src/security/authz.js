/**
 * Authentication and server-side authorisation.
 *
 * Design rule (AGENTS.md s.13): NEVER trust client-submitted identity.
 * The only identity source is the session cookie, looked up in the database on
 * every request. No user id, email or role is ever read from a request body,
 * query string or custom header for authorisation purposes.
 */

import { getDb, nowIso } from "../db.js";
import {
  hashPassword,
  newId,
  randomToken,
  verifyPassword,
  TokenError,
  signToken,
  verifyToken,
} from "./crypto.js";
import {
  SESSION_IDLE_MINUTES,
  SESSION_MAX_HOURS,
  PAGE_TOKEN_TTL_SECONDS,
  AUDIO_TOKEN_TTL_SECONDS,
} from "../config.js";
import { audit } from "./audit.js";

export const SESSION_COOKIE = "cv_session";
export const VALID_ROLES = ["admin", "reviewer", "student"];

function idleMs() {
  return SESSION_IDLE_MINUTES * 60 * 1000;
}

function absoluteMaxMs() {
  return SESSION_MAX_HOURS * 60 * 60 * 1000;
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export function createUser({
  email,
  password,
  displayName,
  role,
  locale = "en",
  isDemo = false,
}) {
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`Invalid role: ${role}`);
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    throw new Error("Invalid email address.");
  }
  const id = newId("usr");
  getDb()
    .prepare(
      `INSERT INTO users (id, email, display_name, role, password_hash, locale, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      normalizedEmail,
      String(displayName).trim(),
      role,
      hashPassword(password),
      locale,
      isDemo ? 1 : 0,
      nowIso(),
    );
  return findUserById(id);
}

export function findUserById(id) {
  if (!id) return null;
  const row = getDb()
    .prepare(
      `SELECT id, email, display_name, role, locale, is_demo, created_at, disabled_at
       FROM users WHERE id = ?`,
    )
    .get(id);
  return row ?? null;
}

export function findUserByEmail(email) {
  if (!email) return null;
  return (
    getDb()
      .prepare(
        `SELECT id, email, display_name, role, locale, is_demo, created_at, disabled_at
         FROM users WHERE email = ? COLLATE NOCASE`,
      )
      .get(String(email).trim().toLowerCase()) ?? null
  );
}

export function listUsers() {
  return getDb()
    .prepare(
      `SELECT id, email, display_name, role, locale, is_demo, created_at, disabled_at
       FROM users ORDER BY role, display_name`,
    )
    .all();
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export function createSessionForUser(user, { ip, userAgent, eventDetail = null } = {}) {
  const sessionId = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + idleMs()).toISOString();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      user.id,
      now.toISOString(),
      now.toISOString(),
      expiresAt,
      userAgent ? String(userAgent).slice(0, 300) : null,
      ip ?? null,
    );

  audit({
    event: "auth.login",
    outcome: "allow",
    actorId: user.id,
    actorRole: user.role,
    ip,
    userAgent,
    detail: eventDetail,
  });

  return { sessionId, user };
}

/**
 * Verify credentials and open a session.
 * Returns { sessionId, user } on success, null on failure.
 */
export function login({ email, password, ip, userAgent }) {
  const user = findUserByEmail(email);
  const stored = user
    ? getDb().prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id)
        ?.password_hash
    : null;

  // Always run a scrypt verification to keep timing comparable for unknown users.
  const ok = stored
    ? verifyPassword(password, stored)
    : (verifyPassword(String(password ?? ""), hashPassword("dummy-password-value")),
      false);

  if (!user || !ok || user.disabled_at) {
    audit({
      event: "auth.login",
      outcome: "deny",
      actorId: user?.id ?? null,
      actorRole: user?.role ?? null,
      ip,
      userAgent,
      detail: {
        reason: user ? (user.disabled_at ? "disabled" : "bad_password") : "unknown_user",
      },
    });
    return null;
  }

  return createSessionForUser(user, { ip, userAgent });
}

/**
 * Resolve a session id to a live user, or null.
 * Enforces BOTH rolling idle timeout AND absolute max session lifetime.
 */
export function resolveSession(sessionId) {
  if (!sessionId || typeof sessionId !== "string") return null;
  const db = getDb();
  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(sessionId);
  if (!session) return null;

  const now = Date.now();
  const createdMs = new Date(session.created_at).getTime();
  const idleExpiresMs = new Date(session.expires_at).getTime();

  if (
    idleExpiresMs <= now ||
    (Number.isFinite(createdMs) && now - createdMs >= absoluteMaxMs())
  ) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    return null;
  }

  const user = findUserById(session.user_id);
  if (!user || user.disabled_at) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    return null;
  }

  // Rolling idle expiry (capped by absolute session lifetime), refreshed at most once a minute.
  if (now - new Date(session.last_seen_at).getTime() > 60_000) {
    const absCapMs = Number.isFinite(createdMs) ? createdMs + absoluteMaxMs() : now + idleMs();
    const nextExpiry = Math.min(now + idleMs(), absCapMs);
    db.prepare(
      "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?",
    ).run(
      new Date(now).toISOString(),
      new Date(nextExpiry).toISOString(),
      sessionId,
    );
  }
  return user;
}

export function logout(sessionId, meta = {}) {
  if (!sessionId) return;
  const session = getDb()
    .prepare("SELECT user_id FROM sessions WHERE id = ?")
    .get(sessionId);
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  if (session) {
    audit({
      event: "auth.logout",
      outcome: "info",
      actorId: session.user_id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Portfolio & Document Authorisation                                  */
/* ------------------------------------------------------------------ */

/**
 * SEC-001: Private M007 portfolio requires an authenticated administrator or
 * explicitly designated reviewer account. Anonymous and student access are denied.
 */
export function canViewPortfolio(user) {
  if (!user || user.disabled_at) return false;
  return user.role === "admin" || user.role === "reviewer";
}

export function getEntitlement(userId, documentId) {
  if (!userId || !documentId) return null;
  return (
    getDb()
      .prepare("SELECT * FROM entitlements WHERE user_id = ? AND document_id = ?")
      .get(userId, documentId) ?? null
  );
}

export function evaluateEntitlement(entitlement) {
  if (!entitlement) return { allowed: false, reason: "no_entitlement" };
  if (entitlement.status === "revoked") {
    return { allowed: false, reason: "revoked" };
  }
  if (entitlement.status === "expired") {
    return { allowed: false, reason: "expired" };
  }
  if (entitlement.expires_at) {
    const expires = new Date(entitlement.expires_at).getTime();
    if (Number.isFinite(expires) && expires <= Date.now()) {
      return { allowed: false, reason: "expired", expiredAt: entitlement.expires_at };
    }
  }
  return { allowed: true, reason: "active" };
}

export function canReadDocument(user, documentId) {
  if (!user) return { allowed: false, reason: "unauthenticated" };
  const entitlement = getEntitlement(user.id, documentId);
  return { ...evaluateEntitlement(entitlement), entitlement };
}

/* ------------------------------------------------------------------ */
/* SEC-005: Single-use Page Tokens & Bounded-Window Audio Stream Tokens*/
/* ------------------------------------------------------------------ */

export function issuePageToken(user, documentId, page, entitlementVersion) {
  return signToken(
    {
      sub: user.id,
      doc: documentId,
      page: Number(page),
      ent: Number(entitlementVersion),
    },
    PAGE_TOKEN_TTL_SECONDS,
    "page",
  );
}

export function verifyPageToken(token) {
  return verifyToken(token, "page");
}

/**
 * Verify AND atomically redeem a single-use page token (`jti`).
 * Any subsequent replay of the same `X-Page-Token` raises TokenError("token_replayed").
 */
export function redeemPageToken(token) {
  const claims = verifyToken(token, "page");
  if (!claims.jti) {
    throw new TokenError("malformed", "Page token is missing jti.");
  }
  const db = getDb();
  const nowSec = Math.floor(Date.now() / 1000);
  db.prepare("DELETE FROM token_redemptions WHERE expires_at < ?").run(nowSec);

  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO token_redemptions (jti, redeemed_at, expires_at)
       VALUES (?, ?, ?)`,
    )
    .run(claims.jti, nowSec, Number(claims.exp));

  if (Number(inserted.changes) !== 1) {
    throw new TokenError("token_replayed", "Page token has already been redeemed.");
  }
  return claims;
}

/**
 * Issue a bounded-window (`60s` TTL) signed audio stream token bound to user,
 * document, chapter/page, and entitlement version. Multi-request HTTP 206 Range
 * playback is permitted within the active window until expiry or revocation.
 */
export function issueAudioToken(user, documentId, page, entitlementVersion, chapterId = null) {
  return signToken(
    {
      sub: user.id,
      doc: documentId,
      page: Number(page),
      ...(chapterId ? { ch: String(chapterId) } : {}),
      ent: Number(entitlementVersion),
    },
    AUDIO_TOKEN_TTL_SECONDS,
    "audio",
  );
}

export function verifyAudioToken(token) {
  return verifyToken(token, "audio");
}

export { TokenError };

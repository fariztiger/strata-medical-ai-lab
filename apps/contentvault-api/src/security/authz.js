/**
 * Authentication and server-side authorisation across PostgreSQL & SQLite (Mission 005).
 *
 * Design rule (AGENTS.md s.13): NEVER trust client-submitted identity.
 * The only identity source is the session cookie, looked up in the active
 * persistence backend on every request.
 */

import { getDb, nowIso } from "../db.js";
import {
  hashPassword,
  newId,
  randomToken,
  verifyPassword,
  verifyPasswordAsync,
  ScryptOverloadError,
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
import { audit, auditAsync } from "./audit.js";
import {
  getPersistenceAdapter,
  getActivePersistenceAdapterSync,
} from "../persistence/adapter.js";

export const SESSION_COOKIE = "cv_session";
export const VALID_ROLES = ["admin", "reviewer", "student"];

function idleMs() {
  return SESSION_IDLE_MINUTES * 60 * 1000;
}

function absoluteMaxMs() {
  return SESSION_MAX_HOURS * 60 * 60 * 1000;
}

function validateUserParams({ email, role }) {
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`Invalid role: ${role}`);
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    throw new Error("Invalid email address.");
  }
  return normalizedEmail;
}

/* ------------------------------------------------------------------ */
/* Users (Async primary + Sync SQLite compatibility for legacy tests)  */
/* ------------------------------------------------------------------ */

export async function createUserAsync(
  actor,
  { email, password, displayName, role, locale = "en", isDemo = false },
) {
  const normalizedEmail = validateUserParams({ email, role });
  const adapter = await getPersistenceAdapter();
  return adapter.createUser(actor || { role: "admin" }, {
    id: newId("usr"),
    email: normalizedEmail,
    displayName: String(displayName).trim(),
    role,
    passwordHash: hashPassword(password),
    locale,
    isDemo,
  });
}

export function createUser({
  email,
  password,
  displayName,
  role,
  locale = "en",
  isDemo = false,
}) {
  const normalizedEmail = validateUserParams({ email, role });
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

export async function findUserByIdAsync(actor, id) {
  if (!id) return null;
  const adapter = await getPersistenceAdapter();
  return adapter.findUserById(actor || { role: "admin" }, id);
}

export function findUserById(id) {
  if (!id) return null;
  return (
    getDb()
      .prepare(
        `SELECT id, email, display_name, role, locale, is_demo, created_at, disabled_at
         FROM users WHERE id = ?`,
      )
      .get(id) ?? null
  );
}

export async function findUserByEmailAsync(actor, email) {
  if (!email) return null;
  const adapter = await getPersistenceAdapter();
  return adapter.findUserByEmail(actor || { role: "admin" }, email);
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

export async function listUsersAsync(actor) {
  const adapter = await getPersistenceAdapter();
  return adapter.listUsers(actor || { role: "admin" });
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

export async function createSessionForUserAsync(
  user,
  { ip, userAgent, eventDetail = null } = {},
) {
  const adapter = await getPersistenceAdapter();
  const sessionId = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + idleMs()).toISOString();

  await adapter.createSession({
    id: sessionId,
    userId: user.id,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt,
    userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
    ip: ip ?? null,
  });

  await auditAsync(
    {
      event: "auth.login",
      outcome: "allow",
      actorId: user.id,
      actorRole: user.role,
      ip,
      userAgent,
      detail: eventDetail,
    },
    user,
  );

  return { sessionId, user };
}

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

// Pre-computed dummy scrypt hash so unknown-user login takes constant scrypt work
// without wasting 2x scrypt (hash + verify) on every miss.
const DUMMY_PASSWORD_HASH = hashPassword("strata-constant-time-dummy-secret#2026");

/**
 * Asynchronous credential verification & session creation against active backend
 * (PostgreSQL `cv_lookup_auth_user` in isolated `auth_bootstrap` tx, or SQLite).
 */
export async function loginAsync({ email, password, ip, userAgent }) {
  const adapter = await getPersistenceAdapter();
  const authRow = await adapter.lookupAuthUserForLogin(email);
  const stored = authRow?.password_hash ?? DUMMY_PASSWORD_HASH;

  const ok = (await verifyPasswordAsync(String(password ?? ""), stored)) && Boolean(authRow);

  if (!authRow || !ok || authRow.disabled_at) {
    await auditAsync({
      event: "auth.login",
      outcome: "deny",
      actorId: authRow?.id ?? null,
      actorRole: authRow?.role ?? null,
      ip,
      userAgent,
      detail: {
        reason: authRow ? (authRow.disabled_at ? "disabled" : "bad_password") : "unknown_user",
      },
    });
    return null;
  }

  const { password_hash: _ph, ...safeUser } = authRow;
  return createSessionForUserAsync(safeUser, { ip, userAgent });
}

export function login({ email, password, ip, userAgent }) {
  const user = findUserByEmail(email);
  const stored = user
    ? getDb().prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id)
        ?.password_hash
    : DUMMY_PASSWORD_HASH;

  const ok = verifyPassword(String(password ?? ""), stored) && Boolean(user);

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
 * Resolve session cookie asynchronously across PostgreSQL or SQLite.
 * Enforces BOTH rolling idle timeout AND absolute max session lifetime.
 */
export async function resolveSessionAsync(sessionId) {
  if (!sessionId || typeof sessionId !== "string") return null;
  const adapter = await getPersistenceAdapter();
  const record = await adapter.resolveSessionRecord(sessionId);
  if (!record || !record.session) return null;

  const { session, user } = record;
  const now = Date.now();
  const createdMs = new Date(session.created_at).getTime();
  const idleExpiresMs = new Date(session.expires_at).getTime();

  if (
    idleExpiresMs <= now ||
    (Number.isFinite(createdMs) && now - createdMs >= absoluteMaxMs())
  ) {
    await adapter.deleteSession(sessionId);
    return null;
  }

  if (!user || user.disabled_at) {
    await adapter.deleteSession(sessionId);
    return null;
  }

  if (now - new Date(session.last_seen_at).getTime() > 60_000) {
    const absCapMs = Number.isFinite(createdMs) ? createdMs + absoluteMaxMs() : now + idleMs();
    const nextExpiry = Math.min(now + idleMs(), absCapMs);
    await adapter.touchSession(sessionId, {
      lastSeenAt: new Date(now).toISOString(),
      expiresAt: new Date(nextExpiry).toISOString(),
    });
  }
  return user;
}

export function resolveSession(sessionId) {
  if (!sessionId || typeof sessionId !== "string") return null;
  const db = getDb();
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
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

  if (now - new Date(session.last_seen_at).getTime() > 60_000) {
    const absCapMs = Number.isFinite(createdMs) ? createdMs + absoluteMaxMs() : now + idleMs();
    const nextExpiry = Math.min(now + idleMs(), absCapMs);
    db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?").run(
      new Date(now).toISOString(),
      new Date(nextExpiry).toISOString(),
      sessionId,
    );
  }
  return user;
}

export async function logoutAsync(sessionId, meta = {}) {
  if (!sessionId) return;
  const adapter = await getPersistenceAdapter();
  const userId = await adapter.deleteSession(sessionId);
  if (userId) {
    await auditAsync({
      event: "auth.logout",
      outcome: "info",
      actorId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }
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

export function canViewPortfolio(user) {
  if (!user || user.disabled_at) return false;
  return user.role === "admin" || user.role === "reviewer";
}

export async function getEntitlementAsync(actor, userId, documentId) {
  if (!userId || !documentId) return null;
  const adapter = await getPersistenceAdapter();
  return adapter.getEntitlement(actor || { id: userId, role: "student" }, userId, documentId);
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

export async function canReadDocumentAsync(user, documentId) {
  if (!user) return { allowed: false, reason: "unauthenticated" };
  const entitlement = await getEntitlementAsync(user, user.id, documentId);
  return { ...evaluateEntitlement(entitlement), entitlement };
}

export function canReadDocument(user, documentId) {
  if (!user) return { allowed: false, reason: "unauthenticated" };
  const entitlement = getEntitlement(user.id, documentId);
  return { ...evaluateEntitlement(entitlement), entitlement };
}

/* ------------------------------------------------------------------ */
/* SEC-005: Crash-Safe Single-Use Page Tokens & Audio Stream Tokens    */
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

export async function redeemPageTokenAsync(token) {
  const claims = verifyToken(token, "page");
  if (!claims.jti) {
    throw new TokenError("malformed", "Page token is missing jti.");
  }
  const adapter = await getPersistenceAdapter();
  const redeemed = await adapter.redeemSingleUseToken(claims.jti, Number(claims.exp));
  if (!redeemed) {
    throw new TokenError("token_replayed", "Page token has already been redeemed.");
  }
  return claims;
}

export function redeemPageToken(token) {
  const claims = verifyToken(token, "page");
  if (!claims.jti) {
    throw new TokenError("malformed", "Page token is missing jti.");
  }
  const syncAdapter = getActivePersistenceAdapterSync();
  if (!syncAdapter || syncAdapter.kind !== "sqlite") {
    throw new Error("redeemPageToken() sync helper requires SQLite; use redeemPageTokenAsync().");
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

export { TokenError, ScryptOverloadError };

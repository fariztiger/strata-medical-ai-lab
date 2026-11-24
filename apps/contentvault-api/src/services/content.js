/**
 * Document, entitlement, chapter and progress services.
 *
 * All authorisation decisions consult `canReadDocument` from the security
 * module. No route reaches the storage layer without passing through here.
 */

import { getDb, nowIso, transaction } from "../db.js";
import { newId } from "../security/crypto.js";
import { audit } from "../security/audit.js";
import { evaluateEntitlement } from "../security/authz.js";

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export function createDocument({
  titleEn,
  titleZh = null,
  author = null,
  description = null,
  storageKey,
  contentHash,
  byteSize,
  pageCount,
  synthetic = true,
  uploadedBy,
}) {
  const id = newId("doc");
  getDb()
    .prepare(
      `INSERT INTO documents
        (id, title_en, title_zh, author, description, storage_key, content_hash,
         byte_size, page_count, synthetic, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      titleEn,
      titleZh,
      author,
      description,
      storageKey,
      contentHash,
      byteSize,
      pageCount,
      synthetic ? 1 : 0,
      uploadedBy,
      nowIso(),
    );
  return findDocument(id);
}

export function findDocument(id) {
  if (!id) return null;
  return (
    getDb()
      .prepare(
        `SELECT id, title_en, title_zh, author, description, storage_key,
                content_hash, byte_size, page_count, synthetic, uploaded_by,
                created_at, archived_at
         FROM documents WHERE id = ?`,
      )
      .get(id) ?? null
  );
}

export function listDocuments() {
  return getDb()
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
}

/**
 * Documents a student may currently read.
 * The SQL narrows candidates; evaluateEntitlement makes the final decision so
 * expiry logic cannot drift between list and read paths.
 */
export function listReadableDocuments(user) {
  if (!user) return [];
  const rows = getDb()
    .prepare(
      `SELECT d.id, d.title_en, d.title_zh, d.author, d.description,
              d.page_count, d.synthetic, d.created_at, d.byte_size,
              e.id AS entitlement_id, e.status AS entitlement_status,
              e.expires_at, e.version
       FROM documents d
       JOIN entitlements e ON e.document_id = d.id
       WHERE e.user_id = ? AND d.archived_at IS NULL
       ORDER BY d.created_at DESC`,
    )
    .all(user.id);

  return rows
    .filter((row) => {
      const verdict = evaluateEntitlement({
        status: row.entitlement_status,
        expires_at: row.expires_at,
      });
      return verdict.allowed;
    })
    .map(({ storage_key, ...rest }) => rest);
}

/* ------------------------------------------------------------------ */
/* Chapters                                                            */
/* ------------------------------------------------------------------ */

export function addChapter({
  documentId,
  ordinal,
  titleEn,
  titleZh = null,
  startPage,
  endPage,
  audioKey = null,
  audioMime = null,
  audioSeconds = null,
}) {
  const id = newId("chap");
  getDb()
    .prepare(
      `INSERT INTO chapters
        (id, document_id, ordinal, title_en, title_zh, start_page, end_page,
         audio_key, audio_mime, audio_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      documentId,
      ordinal,
      titleEn,
      titleZh,
      startPage,
      endPage,
      audioKey,
      audioMime,
      audioSeconds,
    );
  return id;
}

export function listChapters(documentId) {
  if (!documentId) return [];
  return getDb()
    .prepare(
      `SELECT id, document_id, ordinal, title_en, title_zh, start_page, end_page,
              audio_key IS NOT NULL AS has_audio, audio_mime, audio_seconds
       FROM chapters WHERE document_id = ? ORDER BY ordinal`,
    )
    .all(documentId);
}

export function findChapterForPage(documentId, page) {
  if (!documentId) return null;
  return (
    getDb()
      .prepare(
        `SELECT * FROM chapters
         WHERE document_id = ? AND start_page <= ? AND end_page >= ?
         ORDER BY ordinal LIMIT 1`,
      )
      .get(documentId, page, page) ?? null
  );
}

/* ------------------------------------------------------------------ */
/* Entitlements                                                        */
/* ------------------------------------------------------------------ */

/**
 * Grant or re-grant access. Granting an already-active entitlement is a no-op
 * unless the expiry changes. Every mutation bumps `version`, which invalidates
 * any page token already issued.
 */
export function grantEntitlement({
  userId,
  documentId,
  grantedBy,
  expiresAt = null,
  reason = "admin_grant",
}) {
  return transaction((db) => {
    const existing = db
      .prepare("SELECT * FROM entitlements WHERE user_id = ? AND document_id = ?")
      .get(userId, documentId);

    if (existing && existing.status === "active" && existing.expires_at === expiresAt) {
      return { changed: false, entitlement: existing };
    }

    if (existing) {
      db.prepare(
        `UPDATE entitlements
         SET status = 'active', expires_at = ?, granted_by = ?, granted_at = ?,
             revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL,
             version = version + 1
         WHERE id = ?`,
      ).run(expiresAt, grantedBy, nowIso(), existing.id);
      audit({
        event: "entitlement.grant",
        outcome: "allow",
        actorId: grantedBy,
        actorRole: "admin",
        subjectId: userId,
        documentId,
        detail: {
          previousStatus: existing.status,
          expiresAt,
          reason,
          mode: "regrant",
        },
      });
      return {
        changed: true,
        entitlement: db
          .prepare("SELECT * FROM entitlements WHERE id = ?")
          .get(existing.id),
      };
    }

    const id = newId("ent");
    db.prepare(
      `INSERT INTO entitlements
        (id, user_id, document_id, status, version, granted_by, granted_at, expires_at)
       VALUES (?, ?, ?, 'active', 1, ?, ?, ?)`,
    ).run(id, userId, documentId, grantedBy, nowIso(), expiresAt);

    audit({
      event: "entitlement.grant",
      outcome: "allow",
      actorId: grantedBy,
      actorRole: "admin",
      subjectId: userId,
      documentId,
      detail: { expiresAt, reason, mode: "new" },
    });

    return {
      changed: true,
      entitlement: db.prepare("SELECT * FROM entitlements WHERE id = ?").get(id),
    };
  });
}

/** Revoke access. Idempotent; returns whether a change occurred. */
export function revokeEntitlement({
  userId,
  documentId,
  revokedBy,
  reason = "admin_revoke",
}) {
  return transaction((db) => {
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

    // A revoked learner keeps a record of progress but loses all read access.
    audit({
      event: "entitlement.revoke",
      outcome: "allow",
      actorId: revokedBy,
      actorRole: "admin",
      subjectId: userId,
      documentId,
      detail: { reason, previousStatus: existing.status },
    });

    return {
      changed: true,
      entitlement: db
        .prepare("SELECT * FROM entitlements WHERE id = ?")
        .get(existing.id),
    };
  });
}

export function listEntitlementsForDocument(documentId) {
  return getDb()
    .prepare(
      `SELECT e.id, e.user_id, u.display_name, u.email, e.status, e.version,
              e.granted_at, e.expires_at, e.revoked_at, e.revoke_reason
       FROM entitlements e
       JOIN users u ON u.id = e.user_id
       WHERE e.document_id = ?
       ORDER BY u.display_name`,
    )
    .all(documentId);
}

/* ------------------------------------------------------------------ */
/* Reading progress                                                    */
/* ------------------------------------------------------------------ */

export function recordProgress({ userId, documentId, page, pageCount }) {
  const safePage = Math.min(Math.max(Number(page) || 1, 1), Math.max(pageCount, 1));
  getDb()
    .prepare(
      `INSERT INTO reading_progress (user_id, document_id, last_page, pages_read, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(user_id, document_id) DO UPDATE SET
         last_page = excluded.last_page,
         pages_read = pages_read + 1,
         updated_at = excluded.updated_at`,
    )
    .run(userId, documentId, safePage, nowIso());
}

export function getProgress(userId, documentId) {
  return (
    getDb()
      .prepare(
        "SELECT last_page, pages_read, updated_at FROM reading_progress WHERE user_id = ? AND document_id = ?",
      )
      .get(userId, documentId) ?? null
  );
}



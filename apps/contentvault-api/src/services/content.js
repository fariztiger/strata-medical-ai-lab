/**
 * Document, entitlement, chapter and progress services across PostgreSQL & SQLite (Mission 005).
 *
 * Asynchronous `...Async` methods execute through the active `PersistenceAdapter`
 * (enforcing transaction-local PostgreSQL RLS under `cv_runtime` or SQLite queries).
 * Synchronous helpers remain available for SQLite-mode unit tests.
 */

import { getDb, nowIso, transaction } from "../db.js";
import { newId } from "../security/crypto.js";
import { audit, auditAsync } from "../security/audit.js";
import { evaluateEntitlement } from "../security/authz.js";
import { getPersistenceAdapter } from "../persistence/adapter.js";

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export async function createDocumentAsync(
  actor,
  {
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
  },
) {
  const adapter = await getPersistenceAdapter();
  return adapter.createDocument(actor || { id: uploadedBy, role: "admin" }, {
    id: newId("doc"),
    titleEn,
    titleZh,
    author,
    description,
    storageKey,
    contentHash,
    byteSize,
    pageCount,
    synthetic,
    uploadedBy,
  });
}

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

export async function findDocumentAsync(actor, id) {
  if (!id) return null;
  const adapter = await getPersistenceAdapter();
  return adapter.findDocument(actor, id);
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

export async function listDocumentsAsync(actor) {
  const adapter = await getPersistenceAdapter();
  return adapter.listDocuments(actor || { role: "admin" });
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

export async function listReadableDocumentsAsync(user) {
  if (!user) return [];
  const adapter = await getPersistenceAdapter();
  const rows = await adapter.listReadableDocuments(user);
  return rows
    .filter((row) => {
      if (!("entitlement_status" in row)) return true;
      return evaluateEntitlement({
        status: row.entitlement_status,
        expires_at: row.expires_at,
      }).allowed;
    })
    .map(({ storage_key: _sk, content_hash: _ch, ...rest }) => rest);
}

export function listReadableDocuments(user) {
  if (!user) return [];
  const rows = getDb()
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
    .map(({ storage_key: _sk, ...rest }) => rest);
}

/* ------------------------------------------------------------------ */
/* Chapters                                                            */
/* ------------------------------------------------------------------ */

export async function addChapterAsync(
  actor,
  {
    documentId,
    ordinal,
    titleEn,
    titleZh = null,
    startPage,
    endPage,
    audioKey = null,
    audioMime = null,
    audioSeconds = null,
  },
) {
  const adapter = await getPersistenceAdapter();
  return adapter.addChapter(actor || { role: "admin" }, {
    id: newId("chap"),
    documentId,
    ordinal,
    titleEn,
    titleZh,
    startPage,
    endPage,
    audioKey,
    audioMime,
    audioSeconds,
  });
}

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

export async function listChaptersAsync(actor, documentId) {
  if (!documentId) return [];
  const adapter = await getPersistenceAdapter();
  return adapter.listChapters(actor, documentId);
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

export async function findChapterForPageAsync(actor, documentId, page) {
  if (!documentId) return null;
  const adapter = await getPersistenceAdapter();
  return adapter.findChapterForPage(actor, documentId, page);
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

export async function findChapterByIdAsync(actor, documentId, chapterId) {
  if (!documentId || !chapterId) return null;
  const adapter = await getPersistenceAdapter();
  return adapter.findChapterById(actor, documentId, chapterId);
}

export function findChapterById(documentId, chapterId) {
  if (!documentId || !chapterId) return null;
  return (
    getDb()
      .prepare("SELECT * FROM chapters WHERE document_id = ? AND id = ?")
      .get(documentId, chapterId) ?? null
  );
}

export async function attachChapterAudioAsync(
  actor,
  { documentId, chapterId, audioKey, audioMime = "audio/wav", audioSeconds = null },
) {
  const adapter = await getPersistenceAdapter();
  return adapter.attachChapterAudio(actor || { role: "admin" }, {
    documentId,
    chapterId,
    audioKey,
    audioMime,
    audioSeconds,
  });
}

export function attachChapterAudio({
  documentId,
  chapterId,
  audioKey,
  audioMime = "audio/wav",
  audioSeconds = null,
}) {
  const result = getDb()
    .prepare(
      `UPDATE chapters
       SET audio_key = ?, audio_mime = ?, audio_seconds = COALESCE(?, audio_seconds)
       WHERE id = ? AND document_id = ?`,
    )
    .run(audioKey, audioMime, audioSeconds, chapterId, documentId);
  return result.changes > 0;
}

/* ------------------------------------------------------------------ */
/* Entitlements                                                        */
/* ------------------------------------------------------------------ */

export async function grantEntitlementAsync(
  actor,
  { userId, documentId, grantedBy, expiresAt = null, reason = "admin_grant" },
) {
  const adapter = await getPersistenceAdapter();
  const effectiveActor = actor || { id: grantedBy, role: "admin" };
  const result = await adapter.grantEntitlement(effectiveActor, {
    id: newId("ent"),
    userId,
    documentId,
    grantedBy,
    expiresAt,
  });

  if (result.changed) {
    await auditAsync(
      {
        event: "entitlement.grant",
        outcome: "allow",
        actorId: grantedBy,
        actorRole: "admin",
        subjectId: userId,
        documentId,
        detail: {
          ...(result.previousStatus ? { previousStatus: result.previousStatus } : {}),
          expiresAt,
          reason,
          mode: result.mode,
        },
      },
      effectiveActor,
    );
  }
  return { changed: result.changed, entitlement: result.entitlement };
}

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
        entitlement: db.prepare("SELECT * FROM entitlements WHERE id = ?").get(existing.id),
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

export async function revokeEntitlementAsync(
  actor,
  { userId, documentId, revokedBy, reason = "admin_revoke" },
) {
  const adapter = await getPersistenceAdapter();
  const effectiveActor = actor || { id: revokedBy, role: "admin" };
  const result = await adapter.revokeEntitlement(effectiveActor, {
    userId,
    documentId,
    revokedBy,
    reason,
  });

  if (result.changed) {
    await auditAsync(
      {
        event: "entitlement.revoke",
        outcome: "allow",
        actorId: revokedBy,
        actorRole: "admin",
        subjectId: userId,
        documentId,
        detail: { reason, previousStatus: result.previousStatus },
      },
      effectiveActor,
    );
  }
  return result;
}

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
      entitlement: db.prepare("SELECT * FROM entitlements WHERE id = ?").get(existing.id),
    };
  });
}

export async function listEntitlementsForDocumentAsync(actor, documentId) {
  const adapter = await getPersistenceAdapter();
  return adapter.listEntitlementsForDocument(actor || { role: "admin" }, documentId);
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

export async function recordProgressAsync(actor, { userId, documentId, page, pageCount }) {
  const adapter = await getPersistenceAdapter();
  return adapter.recordProgress(actor || { id: userId, role: "student" }, {
    userId,
    documentId,
    page,
    pageCount,
  });
}

export function recordProgress({ userId, documentId, page, pageCount }) {
  const cap = Math.max(Number(pageCount) || 1, 1);
  const safePage = Math.min(Math.max(Number(page) || 1, 1), cap);
  getDb()
    .prepare(
      `INSERT INTO reading_progress (user_id, document_id, last_page, pages_read, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(user_id, document_id) DO UPDATE SET
         pages_read = CASE
           WHEN reading_progress.last_page = excluded.last_page THEN reading_progress.pages_read
           ELSE MIN(?, reading_progress.pages_read + 1)
         END,
         last_page = excluded.last_page,
         updated_at = excluded.updated_at`,
    )
    .run(userId, documentId, safePage, nowIso(), cap);
}

export async function getProgressAsync(actor, userId, documentId) {
  const adapter = await getPersistenceAdapter();
  return adapter.getProgress(actor || { id: userId, role: "student" }, userId, documentId);
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

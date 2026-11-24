/**
 * Append-only audit logging.
 *
 * Every authorisation decision that matters is recorded: grants, revocations,
 * page renders, denials and admin actions. Denials are as important as
 * successes - they are the evidence that controls actually fire.
 */

import { getDb, nowIso } from "./db.js";
import { newId } from "./crypto.js";

/**
 * @param {object} entry
 * @param {string} entry.event      e.g. "page.render"
 * @param {"allow"|"deny"|"info"|"error"} entry.outcome
 * @param {string} [entry.actorId]
 * @param {string} [entry.actorRole]
 * @param {string} [entry.subjectId]
 * @param {string} [entry.documentId]
 * @param {number} [entry.page]
 * @param {string} [entry.ip]
 * @param {string} [entry.userAgent]
 * @param {object} [entry.detail]
 */
export function audit(entry) {
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_log
          (id, created_at, event, outcome, actor_id, actor_role, subject_id,
           document_id, page, ip, user_agent, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId("aud"),
        nowIso(),
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
  } catch (error) {
    // Audit failure must be loud but must never take down the request path.
    console.error("[audit] failed to write entry", entry.event, error.message);
  }
}

export function listAudit({ limit = 100, documentId = null, event = null } = {}) {
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
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const rows = getDb()
    .prepare(
      `SELECT * FROM audit_log ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(...params, safeLimit);
  return rows.map((row) => ({
    ...row,
    detail: row.detail ? safeJson(row.detail) : null,
  }));
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}



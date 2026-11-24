/**
 * Append-only audit logging across SQLite & PostgreSQL (Mission 005 Phase A/B).
 *
 * Every authorisation decision that matters is recorded: grants, revocations,
 * page renders, denials and admin actions.
 */

import { nowIso } from "../db.js";
import { newId } from "./crypto.js";
import {
  getPersistenceAdapter,
  getActivePersistenceAdapterSync,
} from "../persistence/adapter.js";

function normalizeAuditRecord(entry) {
  return {
    id: newId("aud"),
    createdAt: nowIso(),
    event: String(entry.event),
    outcome: String(entry.outcome),
    actorId: entry.actorId ?? null,
    actorRole: entry.actorRole ?? null,
    subjectId: entry.subjectId ?? null,
    documentId: entry.documentId ?? null,
    page: entry.page ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ? String(entry.userAgent).slice(0, 300) : null,
    detail: entry.detail ?? null,
  };
}

/**
 * Asynchronous append-only audit write through the active persistence backend.
 */
export async function auditAsync(entry, actor = null) {
  try {
    const adapter = await getPersistenceAdapter();
    const effectiveActor =
      actor ||
      (entry.actorId && entry.actorRole
        ? { id: entry.actorId, role: entry.actorRole }
        : { role: "anonymous" });
    await adapter.appendAuditLog(effectiveActor, normalizeAuditRecord(entry));
  } catch (error) {
    console.error("[audit] failed to write entry", entry.event, error.message);
  }
}

/**
 * Backwards-compatible synchronous/fire-and-forget audit helper.
 */
export function audit(entry) {
  const syncAdapter = getActivePersistenceAdapterSync();
  if (syncAdapter && syncAdapter.kind === "sqlite") {
    try {
      syncAdapter.appendAuditLog(null, normalizeAuditRecord(entry));
    } catch (error) {
      console.error("[audit] failed to write sqlite entry", entry.event, error.message);
    }
    return;
  }
  void auditAsync(entry);
}

export async function listAuditAsync(
  actor,
  { limit = 100, documentId = null, event = null, outcome = null } = {},
) {
  const adapter = await getPersistenceAdapter();
  return adapter.listAuditLog(actor, { limit, documentId, event, outcome });
}

export function listAudit(filters = {}) {
  const syncAdapter = getActivePersistenceAdapterSync();
  if (!syncAdapter || syncAdapter.kind !== "sqlite") {
    throw new Error("listAudit() sync helper is only available on SQLite; use listAuditAsync().");
  }
  const db = syncAdapter._getDb();
  const clauses = [];
  const params = [];
  if (filters.documentId) {
    clauses.push("document_id = ?");
    params.push(filters.documentId);
  }
  if (filters.event) {
    clauses.push("event = ?");
    params.push(filters.event);
  }
  if (filters.outcome) {
    clauses.push("outcome = ?");
    params.push(filters.outcome);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const safeLimit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
  const rows = db
    .prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
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

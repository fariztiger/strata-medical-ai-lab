-- ============================================================================
-- STRATA ContentVault — PostgreSQL 16 Schema & Row-Level Security (Mission 004 Phase C)
-- ============================================================================
-- Designed to be executed by a migration owner role (e.g. `postgres` / `cv_owner`).
-- Runtime API connections MUST execute inside transactions using `SET LOCAL ROLE cv_app_user`
-- with `app.current_user_id` and `app.current_user_role` bound via `set_config(..., true)`.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cv_app_user') THEN
    CREATE ROLE cv_app_user NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT cv_app_user TO %I', current_user);
END
$$;

CREATE OR REPLACE FUNCTION cv_current_user_id() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.current_user_id', true), ''), '');
$$;

CREATE OR REPLACE FUNCTION cv_current_user_role() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.current_user_role', true), ''), 'anonymous');
$$;

-- 1. Core Identity & Sessions
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'reviewer', 'student')),
  password_hash TEXT NOT NULL,
  locale        TEXT NOT NULL DEFAULT 'en',
  is_demo       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  user_agent    TEXT,
  ip            TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 2. Protected Content, Entitlements, Chapters & Reading Progress
CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  title_en      TEXT NOT NULL,
  title_zh      TEXT,
  author        TEXT,
  description   TEXT,
  storage_key   TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  byte_size     BIGINT NOT NULL,
  page_count    INTEGER NOT NULL DEFAULT 0,
  synthetic     BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_by   TEXT NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS entitlements (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  version       INTEGER NOT NULL DEFAULT 1,
  granted_by    TEXT NOT NULL REFERENCES users(id),
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,
  revoked_by    TEXT REFERENCES users(id),
  revoked_at    TIMESTAMPTZ,
  revoke_reason TEXT,
  UNIQUE (user_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_entitlements_user ON entitlements(user_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_doc_active ON entitlements(document_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS chapters (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal       INTEGER NOT NULL,
  title_en      TEXT NOT NULL,
  title_zh      TEXT,
  start_page    INTEGER NOT NULL,
  end_page      INTEGER NOT NULL,
  audio_key     TEXT,
  audio_mime    TEXT,
  audio_seconds DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_chapters_doc ON chapters(document_id, ordinal);

CREATE TABLE IF NOT EXISTS reading_progress (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  last_page     INTEGER NOT NULL DEFAULT 1,
  pages_read    INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, document_id)
);

-- 3. Append-Only Security Audit Trail & Private Reviewer Portfolio Enquiries
CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event         TEXT NOT NULL,
  outcome       TEXT NOT NULL CHECK (outcome IN ('allow', 'deny', 'info', 'error')),
  actor_id      TEXT,
  actor_role    TEXT,
  subject_id    TEXT,
  document_id   TEXT,
  page          INTEGER,
  ip            TEXT,
  user_agent    TEXT,
  detail        JSONB
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event);

CREATE TABLE IF NOT EXISTS portfolio_enquiries (
  id            TEXT PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id      TEXT REFERENCES users(id),
  sender_name   TEXT NOT NULL,
  sender_org    TEXT,
  sender_email  TEXT NOT NULL,
  topic         TEXT NOT NULL,
  message       TEXT NOT NULL
);

-- 4. Ephemeral Shared Security Tables (UNLOGGED for high-throughput multi-replica coordination)
CREATE UNLOGGED TABLE IF NOT EXISTS token_redemptions (
  jti           TEXT PRIMARY KEY,
  redeemed_at   BIGINT NOT NULL,
  expires_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_token_redemptions_exp ON token_redemptions(expires_at);

CREATE UNLOGGED TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key      TEXT PRIMARY KEY,
  window_start_ms BIGINT NOT NULL,
  expires_at_ms   BIGINT NOT NULL,
  count           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_exp ON rate_limit_buckets(expires_at_ms);

-- ============================================================================
-- Least-Privilege Table Grants (Append-Only Enforcement on audit_log)
-- ============================================================================
GRANT USAGE ON SCHEMA public TO cv_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, sessions, documents, entitlements, chapters, reading_progress,
  portfolio_enquiries, token_redemptions, rate_limit_buckets
TO cv_app_user;

-- Append-only privilege lock: cv_app_user CANNOT UPDATE, DELETE, or TRUNCATE audit_log!
REVOKE ALL ON audit_log FROM cv_app_user;
GRANT SELECT, INSERT ON audit_log TO cv_app_user;

-- ============================================================================
-- Auditable Row-Level Security (ENABLE + FORCE ROW LEVEL SECURITY)
-- ============================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;

ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlements FORCE ROW LEVEL SECURITY;

ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapters FORCE ROW LEVEL SECURITY;

ALTER TABLE reading_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE reading_progress FORCE ROW LEVEL SECURITY;

ALTER TABLE portfolio_enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_enquiries FORCE ROW LEVEL SECURITY;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

-- Helper function (`SECURITY DEFINER`) so entitlements RLS and documents RLS never recurse cyclically
CREATE OR REPLACE FUNCTION cv_has_active_entitlement(doc_id TEXT, uid TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM entitlements e
    WHERE e.document_id = doc_id
      AND e.user_id = uid
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > NOW())
  );
$$;
GRANT EXECUTE ON FUNCTION cv_has_active_entitlement(TEXT, TEXT) TO cv_app_user;

-- Controlled auth bootstrap lookup (`SECURITY DEFINER`) for credential verification prior to session binding
CREATE OR REPLACE FUNCTION cv_lookup_auth_user(lookup_email TEXT)
RETURNS TABLE (
  id TEXT,
  email TEXT,
  display_name TEXT,
  role TEXT,
  password_hash TEXT,
  locale TEXT,
  is_demo BOOLEAN,
  disabled_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.email, u.display_name, u.role, u.password_hash, u.locale, u.is_demo, u.disabled_at
  FROM users u
  WHERE LOWER(u.email) = LOWER(TRIM(lookup_email))
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION cv_lookup_auth_user(TEXT) TO cv_app_user;

-- Users policies: self-read or admin full management
DROP POLICY IF EXISTS users_select_self_or_admin ON users;
CREATE POLICY users_select_self_or_admin ON users
  FOR SELECT TO cv_app_user
  USING (cv_current_user_role() = 'admin' OR id = cv_current_user_id());

DROP POLICY IF EXISTS users_admin_write ON users;
CREATE POLICY users_admin_write ON users
  FOR ALL TO cv_app_user
  USING (cv_current_user_role() = 'admin')
  WITH CHECK (cv_current_user_role() = 'admin');

-- Sessions policies: owner or auth-bootstrap/admin
DROP POLICY IF EXISTS sessions_owner_or_admin ON sessions;
CREATE POLICY sessions_owner_or_admin ON sessions
  FOR ALL TO cv_app_user
  USING (cv_current_user_role() IN ('admin', 'auth_bootstrap') OR user_id = cv_current_user_id())
  WITH CHECK (cv_current_user_role() IN ('admin', 'auth_bootstrap') OR user_id = cv_current_user_id());

-- Entitlements policies: student sees ONLY their own row; only admin mutates
DROP POLICY IF EXISTS entitlements_read_own_or_admin ON entitlements;
CREATE POLICY entitlements_read_own_or_admin ON entitlements
  FOR SELECT TO cv_app_user
  USING (cv_current_user_role() = 'admin' OR user_id = cv_current_user_id());

DROP POLICY IF EXISTS entitlements_admin_write ON entitlements;
CREATE POLICY entitlements_admin_write ON entitlements
  FOR ALL TO cv_app_user
  USING (cv_current_user_role() = 'admin')
  WITH CHECK (cv_current_user_role() = 'admin');

-- Documents policies: admin sees all; student sees ONLY non-archived documents with active, non-expired entitlement
DROP POLICY IF EXISTS documents_read_entitled_or_admin ON documents;
CREATE POLICY documents_read_entitled_or_admin ON documents
  FOR SELECT TO cv_app_user
  USING (
    cv_current_user_role() = 'admin'
    OR (
      cv_current_user_role() = 'student'
      AND archived_at IS NULL
      AND cv_has_active_entitlement(id, cv_current_user_id())
    )
  );

DROP POLICY IF EXISTS documents_admin_write ON documents;
CREATE POLICY documents_admin_write ON documents
  FOR ALL TO cv_app_user
  USING (cv_current_user_role() = 'admin')
  WITH CHECK (cv_current_user_role() = 'admin');

-- Chapters policies: readable only when parent document is entitled or actor is admin
DROP POLICY IF EXISTS chapters_read_entitled_or_admin ON chapters;
CREATE POLICY chapters_read_entitled_or_admin ON chapters
  FOR SELECT TO cv_app_user
  USING (
    cv_current_user_role() = 'admin'
    OR (
      cv_current_user_role() = 'student'
      AND cv_has_active_entitlement(document_id, cv_current_user_id())
    )
  );

DROP POLICY IF EXISTS chapters_admin_write ON chapters;
CREATE POLICY chapters_admin_write ON chapters
  FOR ALL TO cv_app_user
  USING (cv_current_user_role() = 'admin')
  WITH CHECK (cv_current_user_role() = 'admin');

-- Reading progress policies: strictly isolated to the owning student (with active entitlement) or admin
DROP POLICY IF EXISTS progress_owner_or_admin ON reading_progress;
CREATE POLICY progress_owner_or_admin ON reading_progress
  FOR ALL TO cv_app_user
  USING (cv_current_user_role() = 'admin' OR user_id = cv_current_user_id())
  WITH CHECK (
    cv_current_user_role() = 'admin'
    OR (user_id = cv_current_user_id() AND cv_has_active_entitlement(document_id, cv_current_user_id()))
  );

-- Portfolio enquiries policies (SEC-001 at DB kernel): ONLY reviewer or admin may read or insert
DROP POLICY IF EXISTS portfolio_enquiries_reviewer_admin ON portfolio_enquiries;
CREATE POLICY portfolio_enquiries_reviewer_admin ON portfolio_enquiries
  FOR ALL TO cv_app_user
  USING (cv_current_user_role() IN ('admin', 'reviewer'))
  WITH CHECK (cv_current_user_role() IN ('admin', 'reviewer'));

-- Audit log policies: any role may append (INSERT); ONLY admin may read (SELECT)
DROP POLICY IF EXISTS audit_insert_all ON audit_log;
CREATE POLICY audit_insert_all ON audit_log
  FOR INSERT TO cv_app_user
  WITH CHECK (true);

DROP POLICY IF EXISTS audit_select_admin_only ON audit_log;
CREATE POLICY audit_select_admin_only ON audit_log
  FOR SELECT TO cv_app_user
  USING (cv_current_user_role() = 'admin');

COMMIT;

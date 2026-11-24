-- ============================================================================
-- STRATA ContentVault — Mission 005 Phase B: Database Identities, Least-Privilege
-- Runtime Separation, Crash-Safe Ledgers & Hardened RLS (AUD-C2, AUD-C3, AUD-C4, AUD-C5, AUD-D2)
-- ============================================================================
-- Must be applied AFTER `001_postgres_schema_and_rls.sql` by a migration admin.
-- Establishes four distinct database identities:
--   1. `cv_owner`        — Schema & table migration owner (NOLOGIN; never used at runtime)
--   2. `cv_runtime`      — Restricted application runtime login role (NOSUPERUSER, NOBYPASSRLS, owns 0 tables)
--   3. `cv_auth_definer` — Controlled SECURITY DEFINER owner for auth/session/token/rate-limit primitives
--   4. `cv_backup_maint` — Read-only backup & expired-ephemeral maintenance role

BEGIN;

-- 0. Migration tracking ledger
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version     TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1. Create the four separated database roles
DO $$
DECLARE
  runtime_pw TEXT := NULLIF(current_setting('cv.runtime_password', true), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cv_owner') THEN
    CREATE ROLE cv_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cv_auth_definer') THEN
    CREATE ROLE cv_auth_definer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cv_backup_maint') THEN
    CREATE ROLE cv_backup_maint NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cv_runtime') THEN
    IF runtime_pw IS NOT NULL THEN
      EXECUTE format(
        'CREATE ROLE cv_runtime LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION',
        runtime_pw
      );
    ELSE
      CREATE ROLE cv_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
    END IF;
  ELSIF runtime_pw IS NOT NULL THEN
    EXECUTE format(
      'ALTER ROLE cv_runtime WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION',
      runtime_pw
    );
  END IF;

  -- Allow current migration executor to transfer ownership to cv_owner / cv_auth_definer
  EXECUTE format('GRANT cv_owner TO %I', current_user);
  EXECUTE format('GRANT cv_auth_definer TO %I', current_user);
END
$$;

-- Allow cv_runtime to execute inside cv_app_user policies AND its own identity without escalation
GRANT cv_app_user TO cv_runtime;
REVOKE cv_app_user FROM cv_owner;

-- 2. Lock down PUBLIC privileges on schema, tables, and functions
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO cv_owner, cv_auth_definer, cv_app_user, cv_runtime, cv_backup_maint;

-- 3. Crash-safe WAL logging for token_redemptions & rate_limit_buckets (AUD-C5)
--    Replaces UNLOGGED tables so crash recovery and streaming standbys preserve state.
ALTER TABLE public.token_redemptions SET LOGGED;
ALTER TABLE public.rate_limit_buckets SET LOGGED;

ALTER TABLE public.rate_limit_buckets
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

-- 4. Transfer table ownership to dedicated migration owner `cv_owner` (never `cv_runtime`)
ALTER TABLE public.schema_migrations  OWNER TO cv_owner;
ALTER TABLE public.users              OWNER TO cv_owner;
ALTER TABLE public.sessions           OWNER TO cv_owner;
ALTER TABLE public.documents          OWNER TO cv_owner;
ALTER TABLE public.entitlements       OWNER TO cv_owner;
ALTER TABLE public.chapters           OWNER TO cv_owner;
ALTER TABLE public.reading_progress   OWNER TO cv_owner;
ALTER TABLE public.audit_log          OWNER TO cv_owner;
ALTER TABLE public.portfolio_enquiries OWNER TO cv_owner;
ALTER TABLE public.token_redemptions  OWNER TO cv_owner;
ALTER TABLE public.rate_limit_buckets OWNER TO cv_owner;

-- 5. Strict table & column-level privileges (AUD-C3 + AUD-C5)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON public.schema_migrations FROM cv_app_user, cv_runtime;

-- `users`: Revoke broad SELECT so `password_hash` can NEVER be projected directly by cv_runtime / cv_app_user!
REVOKE ALL ON public.users FROM cv_app_user, cv_runtime;
GRANT SELECT (id, email, display_name, role, locale, is_demo, created_at, disabled_at)
  ON public.users TO cv_app_user, cv_runtime;
GRANT INSERT, UPDATE ON public.users TO cv_app_user, cv_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.sessions,
  public.documents,
  public.entitlements,
  public.chapters,
  public.reading_progress,
  public.portfolio_enquiries
TO cv_app_user, cv_runtime;

-- Append-only `audit_log`: SELECT + INSERT only (NO UPDATE, DELETE, or TRUNCATE)
REVOKE ALL ON public.audit_log FROM cv_app_user, cv_runtime;
GRANT SELECT, INSERT ON public.audit_log TO cv_app_user, cv_runtime;

-- Ephemeral security ledgers: revoke direct table access from cv_app_user / cv_runtime
-- so compromised queries CANNOT delete active lockouts or redeemed single-use page tokens!
REVOKE ALL ON public.token_redemptions FROM cv_app_user, cv_runtime;
REVOKE ALL ON public.rate_limit_buckets FROM cv_app_user, cv_runtime;

-- Grant minimal underlying table privileges to `cv_auth_definer` for controlled primitives
GRANT SELECT (id, email, display_name, role, password_hash, locale, is_demo, created_at, disabled_at)
  ON public.users TO cv_auth_definer;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO cv_auth_definer;
GRANT SELECT, INSERT, DELETE ON public.token_redemptions TO cv_auth_definer;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_limit_buckets TO cv_auth_definer;

-- Grant read-only backup + expired-row maintenance rights to `cv_backup_maint`
GRANT SELECT ON
  public.schema_migrations,
  public.users,
  public.sessions,
  public.documents,
  public.entitlements,
  public.chapters,
  public.reading_progress,
  public.audit_log,
  public.portfolio_enquiries,
  public.token_redemptions,
  public.rate_limit_buckets
TO cv_backup_maint;

-- 6. Enable + Force RLS on ALL application & ephemeral tables
ALTER TABLE public.token_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_redemptions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_buckets FORCE ROW LEVEL SECURITY;

-- Policies allowing `cv_auth_definer` and `cv_backup_maint` controlled access under FORCE RLS
DROP POLICY IF EXISTS users_auth_definer_read ON public.users;
CREATE POLICY users_auth_definer_read ON public.users
  FOR SELECT TO cv_auth_definer, cv_backup_maint
  USING (true);

DROP POLICY IF EXISTS sessions_auth_definer_all ON public.sessions;
CREATE POLICY sessions_auth_definer_all ON public.sessions
  FOR ALL TO cv_auth_definer
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS sessions_backup_read ON public.sessions;
CREATE POLICY sessions_backup_read ON public.sessions
  FOR SELECT TO cv_backup_maint
  USING (true);

DROP POLICY IF EXISTS token_redemptions_definer_all ON public.token_redemptions;
CREATE POLICY token_redemptions_definer_all ON public.token_redemptions
  FOR ALL TO cv_auth_definer
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS token_redemptions_backup_read ON public.token_redemptions;
CREATE POLICY token_redemptions_backup_read ON public.token_redemptions
  FOR SELECT TO cv_backup_maint
  USING (true);

DROP POLICY IF EXISTS rate_limit_buckets_definer_all ON public.rate_limit_buckets;
CREATE POLICY rate_limit_buckets_definer_all ON public.rate_limit_buckets
  FOR ALL TO cv_auth_definer
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS rate_limit_buckets_backup_read ON public.rate_limit_buckets;
CREATE POLICY rate_limit_buckets_backup_read ON public.rate_limit_buckets
  FOR SELECT TO cv_backup_maint
  USING (true);

-- Backup read policies on remaining RLS-forced tables
DROP POLICY IF EXISTS documents_backup_read ON public.documents;
CREATE POLICY documents_backup_read ON public.documents FOR SELECT TO cv_backup_maint USING (true);

DROP POLICY IF EXISTS entitlements_backup_read ON public.entitlements;
CREATE POLICY entitlements_backup_read ON public.entitlements FOR SELECT TO cv_backup_maint USING (true);

DROP POLICY IF EXISTS chapters_backup_read ON public.chapters;
CREATE POLICY chapters_backup_read ON public.chapters FOR SELECT TO cv_backup_maint USING (true);

DROP POLICY IF EXISTS progress_backup_read ON public.reading_progress;
CREATE POLICY progress_backup_read ON public.reading_progress FOR SELECT TO cv_backup_maint USING (true);

DROP POLICY IF EXISTS enquiries_backup_read ON public.portfolio_enquiries;
CREATE POLICY enquiries_backup_read ON public.portfolio_enquiries FOR SELECT TO cv_backup_maint USING (true);

DROP POLICY IF EXISTS audit_backup_read ON public.audit_log;
CREATE POLICY audit_backup_read ON public.audit_log FOR SELECT TO cv_backup_maint USING (true);

-- 7. Harden helper & SECURITY DEFINER functions (AUD-C3, safe search_path, REVOKE PUBLIC)
CREATE OR REPLACE FUNCTION public.cv_current_user_id() RETURNS TEXT
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(NULLIF(pg_catalog.current_setting('app.current_user_id', true), ''), '');
$$;
ALTER FUNCTION public.cv_current_user_id() OWNER TO cv_owner;
REVOKE ALL ON FUNCTION public.cv_current_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cv_current_user_id() TO cv_app_user, cv_runtime, cv_auth_definer;

CREATE OR REPLACE FUNCTION public.cv_current_user_role() RETURNS TEXT
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(NULLIF(pg_catalog.current_setting('app.current_user_role', true), ''), 'anonymous');
$$;
ALTER FUNCTION public.cv_current_user_role() OWNER TO cv_owner;
REVOKE ALL ON FUNCTION public.cv_current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cv_current_user_role() TO cv_app_user, cv_runtime, cv_auth_definer;

-- Prevent cross-learner entitlement oracle probing inside cv_has_active_entitlement
CREATE OR REPLACE FUNCTION public.cv_has_active_entitlement(doc_id TEXT, uid TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN public.cv_current_user_role() = 'admin' OR uid = public.cv_current_user_id() THEN
      EXISTS (
        SELECT 1
        FROM public.entitlements e
        WHERE e.document_id = doc_id
          AND e.user_id = uid
          AND e.status = 'active'
          AND (e.expires_at IS NULL OR e.expires_at > NOW())
      )
    ELSE FALSE
  END;
$$;
ALTER FUNCTION public.cv_has_active_entitlement(TEXT, TEXT) OWNER TO cv_owner;
REVOKE ALL ON FUNCTION public.cv_has_active_entitlement(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cv_has_active_entitlement(TEXT, TEXT) TO cv_app_user, cv_runtime;

-- AUD-C3 remediation: `cv_lookup_auth_user` is owned by `cv_auth_definer` and strictly
-- rejects any call from `student`, `reviewer`, `admin`, or `anonymous` contexts!
CREATE OR REPLACE FUNCTION public.cv_lookup_auth_user(lookup_email TEXT)
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
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF COALESCE(pg_catalog.current_setting('app.current_user_role', true), '') <> 'auth_bootstrap'
     OR COALESCE(pg_catalog.current_setting('app.current_user_id', true), '') <> '' THEN
    RAISE EXCEPTION 'permission denied: cv_lookup_auth_user requires isolated auth_bootstrap context'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT u.id, u.email, u.display_name, u.role, u.password_hash, u.locale, u.is_demo, u.disabled_at
    FROM public.users u
    WHERE LOWER(u.email) = LOWER(BTRIM(lookup_email))
    LIMIT 1;
END;
$$;
ALTER FUNCTION public.cv_lookup_auth_user(TEXT) OWNER TO cv_auth_definer;
REVOKE ALL ON FUNCTION public.cv_lookup_auth_user(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cv_lookup_auth_user(TEXT) TO cv_app_user, cv_runtime;

-- Controlled production startup check for active demo accounts (never exposes rows or hashes)
CREATE OR REPLACE FUNCTION public.cv_count_active_demo_users() RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.users u
  WHERE u.disabled_at IS NULL
    AND (
      u.is_demo = TRUE
      OR LOWER(u.email) LIKE '%@strata.local'
      OR LOWER(u.email) LIKE '%.strata.local'
    );
$$;
ALTER FUNCTION public.cv_count_active_demo_users() OWNER TO cv_auth_definer;
REVOKE ALL ON FUNCTION public.cv_count_active_demo_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cv_count_active_demo_users() TO cv_app_user, cv_runtime;

-- Controlled session-cookie resolution (`cv_resolve_session`) returning non-secret user columns
CREATE OR REPLACE FUNCTION public.cv_resolve_session(p_session_id TEXT)
RETURNS TABLE (
  session_id TEXT,
  user_id TEXT,
  session_created_at TIMESTAMPTZ,
  session_last_seen_at TIMESTAMPTZ,
  session_expires_at TIMESTAMPTZ,
  email TEXT,
  display_name TEXT,
  role TEXT,
  locale TEXT,
  is_demo BOOLEAN,
  user_created_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_session_id IS NULL OR LENGTH(BTRIM(p_session_id)) < 16 THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      s.id,
      s.user_id,
      s.created_at,
      s.last_seen_at,
      s.expires_at,
      u.email,
      u.display_name,
      u.role,
      u.locale,
      u.is_demo,
      u.created_at,
      u.disabled_at
    FROM public.sessions s
    JOIN public.users u ON u.id = s.user_id
    WHERE s.id = p_session_id
    LIMIT 1;
END;
$$;
ALTER FUNCTION public.cv_resolve_session(TEXT) OWNER TO cv_auth_definer;
REVOKE ALL ON FUNCTION public.cv_resolve_session(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cv_resolve_session(TEXT) TO cv_app_user, cv_runtime;

-- Controlled session touch & deletion by opaque session token
CREATE OR REPLACE FUNCTION public.cv_touch_session(
  p_session_id TEXT,
  p_last_seen TIMESTAMPTZ,
  p_expires_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE public.sessions
  SET last_seen_at = p_last_seen,
      expires_at = p_expires_at
  WHERE id = p_session_id;
$$;
ALTER FUNCTION public.cv_touch_session(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) OWNER TO cv_auth_definer;
REVOKE ALL ON FUNCTION public.cv_touch_session(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cv_touch_session(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO cv_app_user, cv_runtime;

CREATE OR REPLACE FUNCTION public.cv_delete_session(p_session_id TEXT)
RETURNS TEXT
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  DELETE FROM public.sessions WHERE id = p_session_id RETURNING user_id;
$$;
ALTER FUNCTION public.cv_delete_session(TEXT) OWNER TO cv_auth_definer;
REVOKE ALL ON FUNCTION public.cv_delete_session(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cv_delete_session(TEXT) TO cv_app_user, cv_runtime;

-- Crash-safe single-use token redemption (`AUD-C5`)
CREATE OR REPLACE FUNCTION public.cv_redeem_token(
  p_jti TEXT,
  p_now_sec BIGINT,
  p_expires_sec BIGINT
) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  DELETE FROM public.token_redemptions WHERE expires_at < p_now_sec;

  INSERT INTO public.token_redemptions (jti, redeemed_at, expires_at)
  VALUES (p_jti, p_now_sec, p_expires_sec)
  ON CONFLICT (jti) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count = 1;
END;
$$;
ALTER FUNCTION public.cv_redeem_token(TEXT, BIGINT, BIGINT) OWNER TO cv_auth_definer;
REVOKE ALL ON FUNCTION public.cv_redeem_token(TEXT, BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cv_redeem_token(TEXT, BIGINT, BIGINT) TO cv_app_user, cv_runtime;

-- Attack-resistant bounded rate limiter (`AUD-C4` + `AUD-D2`):
--   1. Reclaims expired buckets FIRST.
--   2. Never evicts active security lockouts (`is_locked = TRUE` or `count >= p_limit` when `p_protect_lockout = TRUE`).
--   3. Evicts OLDEST-expiring unlocked buckets (`ORDER BY expires_at_ms ASC LIMIT overflow`), fixing AUD-C4.
--   4. Fails closed (`allowed = FALSE`) if all `p_max_buckets` slots are occupied by active lockouts.
CREATE OR REPLACE FUNCTION public.cv_check_rate_limit(
  p_key TEXT,
  p_limit INTEGER,
  p_window_ms BIGINT,
  p_now_ms BIGINT,
  p_increment BOOLEAN,
  p_max_buckets INTEGER,
  p_protect_lockout BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  allowed BOOLEAN,
  current_count INTEGER,
  remaining INTEGER,
  retry_after_sec INTEGER,
  saturated BOOLEAN
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_safe_key TEXT := LEFT(COALESCE(p_key, ''), 256);
  v_row public.rate_limit_buckets%ROWTYPE;
  v_total INTEGER;
  v_overflow INTEGER;
  v_deleted INTEGER;
  v_next_count INTEGER;
  v_exp_ms BIGINT;
BEGIN
  -- Always reclaim expired buckets first
  DELETE FROM public.rate_limit_buckets WHERE expires_at_ms <= p_now_ms;

  SELECT * INTO v_row
  FROM public.rate_limit_buckets
  WHERE bucket_key = v_safe_key
  FOR UPDATE;

  IF NOT FOUND THEN
    IF NOT p_increment THEN
      RETURN QUERY SELECT TRUE, 0, GREATEST(0, p_limit), 0, FALSE;
      RETURN;
    END IF;

    SELECT COUNT(*)::INTEGER INTO v_total FROM public.rate_limit_buckets;
    IF v_total >= p_max_buckets THEN
      v_overflow := (v_total - p_max_buckets) + 1;
      DELETE FROM public.rate_limit_buckets
      WHERE bucket_key IN (
        SELECT b.bucket_key
        FROM public.rate_limit_buckets b
        WHERE b.is_locked = FALSE
        ORDER BY b.expires_at_ms ASC
        LIMIT v_overflow
      );
      GET DIAGNOSTICS v_deleted = ROW_COUNT;

      SELECT COUNT(*)::INTEGER INTO v_total FROM public.rate_limit_buckets;
      IF v_total >= p_max_buckets THEN
        -- Storage saturated with active protected lockouts: fail closed on new bucket admission!
        RETURN QUERY SELECT
          FALSE,
          p_limit + 1,
          0,
          GREATEST(1, CEIL(p_window_ms / 1000.0)::INTEGER),
          TRUE;
        RETURN;
      END IF;
    END IF;

    v_exp_ms := p_now_ms + GREATEST(1, p_window_ms);
    INSERT INTO public.rate_limit_buckets (bucket_key, window_start_ms, expires_at_ms, count, is_locked)
    VALUES (
      v_safe_key,
      p_now_ms,
      v_exp_ms,
      1,
      (p_protect_lockout AND 1 >= p_limit)
    )
    ON CONFLICT (bucket_key) DO UPDATE SET
      count = CASE
        WHEN public.rate_limit_buckets.expires_at_ms <= p_now_ms THEN 1
        ELSE public.rate_limit_buckets.count + 1
      END,
      window_start_ms = CASE
        WHEN public.rate_limit_buckets.expires_at_ms <= p_now_ms THEN p_now_ms
        ELSE public.rate_limit_buckets.window_start_ms
      END,
      expires_at_ms = CASE
        WHEN public.rate_limit_buckets.expires_at_ms <= p_now_ms THEN v_exp_ms
        ELSE public.rate_limit_buckets.expires_at_ms
      END,
      is_locked = public.rate_limit_buckets.is_locked
        OR (p_protect_lockout AND (public.rate_limit_buckets.count + 1) >= p_limit)
    RETURNING count, expires_at_ms INTO v_next_count, v_exp_ms;

    IF v_next_count > p_limit THEN
      RETURN QUERY SELECT
        FALSE,
        v_next_count,
        0,
        GREATEST(1, CEIL((v_exp_ms - p_now_ms) / 1000.0)::INTEGER),
        FALSE;
      RETURN;
    END IF;

    RETURN QUERY SELECT TRUE, v_next_count, GREATEST(0, p_limit - v_next_count), 0, FALSE;
    RETURN;
  END IF;

  -- Existing active bucket
  IF NOT p_increment THEN
    IF v_row.count >= p_limit THEN
      RETURN QUERY SELECT
        FALSE,
        v_row.count,
        0,
        GREATEST(1, CEIL((v_row.expires_at_ms - p_now_ms) / 1000.0)::INTEGER),
        FALSE;
    ELSE
      RETURN QUERY SELECT TRUE, v_row.count, GREATEST(0, p_limit - v_row.count), 0, FALSE;
    END IF;
    RETURN;
  END IF;

  v_next_count := v_row.count + 1;
  UPDATE public.rate_limit_buckets
  SET count = v_next_count,
      is_locked = is_locked OR (p_protect_lockout AND v_next_count >= p_limit)
  WHERE bucket_key = v_safe_key;

  IF v_next_count > p_limit THEN
    RETURN QUERY SELECT
      FALSE,
      v_next_count,
      0,
      GREATEST(1, CEIL((v_row.expires_at_ms - p_now_ms) / 1000.0)::INTEGER),
      FALSE;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, v_next_count, GREATEST(0, p_limit - v_next_count), 0, FALSE;
END;
$$;
ALTER FUNCTION public.cv_check_rate_limit(TEXT, INTEGER, BIGINT, BIGINT, BOOLEAN, INTEGER, BOOLEAN) OWNER TO cv_auth_definer;
REVOKE ALL ON FUNCTION public.cv_check_rate_limit(TEXT, INTEGER, BIGINT, BIGINT, BOOLEAN, INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cv_check_rate_limit(TEXT, INTEGER, BIGINT, BIGINT, BOOLEAN, INTEGER, BOOLEAN) TO cv_app_user, cv_runtime;

CREATE OR REPLACE FUNCTION public.cv_clear_rate_limit(p_key TEXT) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  DELETE FROM public.rate_limit_buckets WHERE bucket_key = LEFT(COALESCE(p_key, ''), 256);
$$;
ALTER FUNCTION public.cv_clear_rate_limit(TEXT) OWNER TO cv_auth_definer;
REVOKE ALL ON FUNCTION public.cv_clear_rate_limit(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cv_clear_rate_limit(TEXT) TO cv_app_user, cv_runtime;

-- Operational maintenance helper for `cv_backup_maint`
CREATE OR REPLACE FUNCTION public.cv_purge_expired_ephemeral()
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  d_sessions INTEGER;
  d_tokens   INTEGER;
  d_buckets  INTEGER;
BEGIN
  DELETE FROM public.sessions WHERE expires_at <= NOW();
  GET DIAGNOSTICS d_sessions = ROW_COUNT;

  DELETE FROM public.token_redemptions WHERE expires_at < EXTRACT(EPOCH FROM NOW())::BIGINT;
  GET DIAGNOSTICS d_tokens = ROW_COUNT;

  DELETE FROM public.rate_limit_buckets WHERE expires_at_ms <= (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
  GET DIAGNOSTICS d_buckets = ROW_COUNT;

  RETURN jsonb_build_object(
    'purgedSessions', d_sessions,
    'purgedTokens', d_tokens,
    'purgedRateLimitBuckets', d_buckets
  );
END;
$$;
ALTER FUNCTION public.cv_purge_expired_ephemeral() OWNER TO cv_auth_definer;
REVOKE ALL ON FUNCTION public.cv_purge_expired_ephemeral() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cv_purge_expired_ephemeral() TO cv_backup_maint;

-- 8. Update RLS policies so BOTH `cv_runtime` (direct login) AND `cv_app_user` are covered,
--    isolate reviewer `portfolio_enquiries` per reviewer (`AUD-C5`), and bind `audit_log` actor!
DROP POLICY IF EXISTS users_select_self_or_admin ON public.users;
CREATE POLICY users_select_self_or_admin ON public.users
  FOR SELECT TO cv_app_user, cv_runtime
  USING (public.cv_current_user_role() = 'admin' OR id = public.cv_current_user_id());

DROP POLICY IF EXISTS users_admin_write ON public.users;
CREATE POLICY users_admin_write ON public.users
  FOR ALL TO cv_app_user, cv_runtime
  USING (public.cv_current_user_role() = 'admin')
  WITH CHECK (public.cv_current_user_role() = 'admin');

DROP POLICY IF EXISTS sessions_owner_or_admin ON public.sessions;
CREATE POLICY sessions_owner_or_admin ON public.sessions
  FOR ALL TO cv_app_user, cv_runtime
  USING (
    public.cv_current_user_role() IN ('admin', 'auth_bootstrap')
    OR user_id = public.cv_current_user_id()
  )
  WITH CHECK (
    public.cv_current_user_role() IN ('admin', 'auth_bootstrap')
    OR user_id = public.cv_current_user_id()
  );

DROP POLICY IF EXISTS entitlements_read_own_or_admin ON public.entitlements;
CREATE POLICY entitlements_read_own_or_admin ON public.entitlements
  FOR SELECT TO cv_app_user, cv_runtime
  USING (public.cv_current_user_role() = 'admin' OR user_id = public.cv_current_user_id());

DROP POLICY IF EXISTS entitlements_admin_write ON public.entitlements;
CREATE POLICY entitlements_admin_write ON public.entitlements
  FOR ALL TO cv_app_user, cv_runtime
  USING (public.cv_current_user_role() = 'admin')
  WITH CHECK (public.cv_current_user_role() = 'admin');

DROP POLICY IF EXISTS documents_read_entitled_or_admin ON public.documents;
CREATE POLICY documents_read_entitled_or_admin ON public.documents
  FOR SELECT TO cv_app_user, cv_runtime
  USING (
    public.cv_current_user_role() = 'admin'
    OR (
      public.cv_current_user_role() = 'student'
      AND archived_at IS NULL
      AND public.cv_has_active_entitlement(id, public.cv_current_user_id())
    )
  );

DROP POLICY IF EXISTS documents_admin_write ON public.documents;
CREATE POLICY documents_admin_write ON public.documents
  FOR ALL TO cv_app_user, cv_runtime
  USING (public.cv_current_user_role() = 'admin')
  WITH CHECK (public.cv_current_user_role() = 'admin');

DROP POLICY IF EXISTS chapters_read_entitled_or_admin ON public.chapters;
CREATE POLICY chapters_read_entitled_or_admin ON public.chapters
  FOR SELECT TO cv_app_user, cv_runtime
  USING (
    public.cv_current_user_role() = 'admin'
    OR (
      public.cv_current_user_role() = 'student'
      AND public.cv_has_active_entitlement(document_id, public.cv_current_user_id())
    )
  );

DROP POLICY IF EXISTS chapters_admin_write ON public.chapters;
CREATE POLICY chapters_admin_write ON public.chapters
  FOR ALL TO cv_app_user, cv_runtime
  USING (public.cv_current_user_role() = 'admin')
  WITH CHECK (public.cv_current_user_role() = 'admin');

DROP POLICY IF EXISTS progress_owner_or_admin ON public.reading_progress;
CREATE POLICY progress_owner_or_admin ON public.reading_progress
  FOR ALL TO cv_app_user, cv_runtime
  USING (public.cv_current_user_role() = 'admin' OR user_id = public.cv_current_user_id())
  WITH CHECK (
    public.cv_current_user_role() = 'admin'
    OR (user_id = public.cv_current_user_id() AND public.cv_has_active_entitlement(document_id, public.cv_current_user_id()))
  );

-- AUD-C5 remediation: Reviewer sees and inserts ONLY their own enquiries (`actor_id = cv_current_user_id()`)!
DROP POLICY IF EXISTS portfolio_enquiries_reviewer_admin ON public.portfolio_enquiries;
DROP POLICY IF EXISTS portfolio_enquiries_select_isolated ON public.portfolio_enquiries;
CREATE POLICY portfolio_enquiries_select_isolated ON public.portfolio_enquiries
  FOR SELECT TO cv_app_user, cv_runtime
  USING (
    public.cv_current_user_role() = 'admin'
    OR (
      public.cv_current_user_role() = 'reviewer'
      AND actor_id = public.cv_current_user_id()
    )
  );

DROP POLICY IF EXISTS portfolio_enquiries_insert_isolated ON public.portfolio_enquiries;
CREATE POLICY portfolio_enquiries_insert_isolated ON public.portfolio_enquiries
  FOR INSERT TO cv_app_user, cv_runtime
  WITH CHECK (
    public.cv_current_user_role() = 'admin'
    OR (
      public.cv_current_user_role() = 'reviewer'
      AND actor_id = public.cv_current_user_id()
    )
  );

DROP POLICY IF EXISTS portfolio_enquiries_admin_modify ON public.portfolio_enquiries;
CREATE POLICY portfolio_enquiries_admin_modify ON public.portfolio_enquiries
  FOR UPDATE TO cv_app_user, cv_runtime
  USING (public.cv_current_user_role() = 'admin')
  WITH CHECK (public.cv_current_user_role() = 'admin');

-- AUD-C5 remediation: Bind `audit_log` INSERT `actor_id` / `actor_role` to transaction context
-- for non-admin/non-bootstrap actors so a student/reviewer cannot forge another user's actor_id.
DROP POLICY IF EXISTS audit_insert_all ON public.audit_log;
DROP POLICY IF EXISTS audit_insert_actor_bound ON public.audit_log;
CREATE POLICY audit_insert_actor_bound ON public.audit_log
  FOR INSERT TO cv_app_user, cv_runtime
  WITH CHECK (
    public.cv_current_user_role() IN ('admin', 'auth_bootstrap')
    OR (
      (
        (public.cv_current_user_id() = '' AND actor_id IS NULL)
        OR actor_id = public.cv_current_user_id()
      )
      AND (
        (public.cv_current_user_role() = 'anonymous' AND (actor_role IS NULL OR actor_role = 'anonymous'))
        OR actor_role = public.cv_current_user_role()
      )
    )
  );

DROP POLICY IF EXISTS audit_select_admin_only ON public.audit_log;
CREATE POLICY audit_select_admin_only ON public.audit_log
  FOR SELECT TO cv_app_user, cv_runtime
  USING (public.cv_current_user_role() = 'admin');

-- Record applied migrations
INSERT INTO public.schema_migrations (version, description) VALUES
  ('001_postgres_schema_and_rls', 'Initial PostgreSQL 16 schema, append-only audit_log, and RLS policies'),
  ('002_database_roles_and_hardening', 'Four-role separation, cv_runtime login, column-level password_hash protection, logged ledgers, and lockout-safe rate limit')
ON CONFLICT (version) DO NOTHING;

COMMIT;

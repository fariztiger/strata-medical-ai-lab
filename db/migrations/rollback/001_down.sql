-- ============================================================================
-- Full Tear-Down Rollback (001_down.sql) — FOR CONTROLLED STAGING / DR RECOVERY ONLY
-- ============================================================================
BEGIN;

DROP FUNCTION IF EXISTS public.cv_purge_expired_ephemeral() CASCADE;
DROP FUNCTION IF EXISTS public.cv_clear_rate_limit(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.cv_check_rate_limit(TEXT, INTEGER, BIGINT, BIGINT, BOOLEAN, INTEGER, BOOLEAN) CASCADE;
DROP FUNCTION IF EXISTS public.cv_redeem_token(TEXT, BIGINT, BIGINT) CASCADE;
DROP FUNCTION IF EXISTS public.cv_delete_session(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.cv_touch_session(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) CASCADE;
DROP FUNCTION IF EXISTS public.cv_resolve_session(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.cv_count_active_demo_users() CASCADE;
DROP FUNCTION IF EXISTS public.cv_lookup_auth_user(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.cv_has_active_entitlement(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.cv_current_user_role() CASCADE;
DROP FUNCTION IF EXISTS public.cv_current_user_id() CASCADE;

DROP TABLE IF EXISTS public.rate_limit_buckets CASCADE;
DROP TABLE IF EXISTS public.token_redemptions CASCADE;
DROP TABLE IF EXISTS public.portfolio_enquiries CASCADE;
DROP TABLE IF EXISTS public.audit_log CASCADE;
DROP TABLE IF EXISTS public.reading_progress CASCADE;
DROP TABLE IF EXISTS public.chapters CASCADE;
DROP TABLE IF EXISTS public.entitlements CASCADE;
DROP TABLE IF EXISTS public.documents CASCADE;
DROP TABLE IF EXISTS public.sessions CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.schema_migrations CASCADE;

COMMIT;

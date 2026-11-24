-- ============================================================================
-- Rollback 002 -> 001 (Reverts Mission 005 role hardening while preserving data)
-- ============================================================================
BEGIN;

DROP POLICY IF EXISTS audit_insert_actor_bound ON public.audit_log;
CREATE POLICY audit_insert_all ON public.audit_log
  FOR INSERT TO cv_app_user
  WITH CHECK (true);

DROP POLICY IF EXISTS portfolio_enquiries_select_isolated ON public.portfolio_enquiries;
DROP POLICY IF EXISTS portfolio_enquiries_insert_isolated ON public.portfolio_enquiries;
DROP POLICY IF EXISTS portfolio_enquiries_admin_modify ON public.portfolio_enquiries;
CREATE POLICY portfolio_enquiries_reviewer_admin ON public.portfolio_enquiries
  FOR ALL TO cv_app_user
  USING (public.cv_current_user_role() IN ('admin', 'reviewer'))
  WITH CHECK (public.cv_current_user_role() IN ('admin', 'reviewer'));

DROP POLICY IF EXISTS users_auth_definer_read ON public.users;
DROP POLICY IF EXISTS sessions_auth_definer_all ON public.sessions;
DROP POLICY IF EXISTS sessions_backup_read ON public.sessions;
DROP POLICY IF EXISTS token_redemptions_definer_all ON public.token_redemptions;
DROP POLICY IF EXISTS token_redemptions_backup_read ON public.token_redemptions;
DROP POLICY IF EXISTS rate_limit_buckets_definer_all ON public.rate_limit_buckets;
DROP POLICY IF EXISTS rate_limit_buckets_backup_read ON public.rate_limit_buckets;
DROP POLICY IF EXISTS documents_backup_read ON public.documents;
DROP POLICY IF EXISTS entitlements_backup_read ON public.entitlements;
DROP POLICY IF EXISTS chapters_backup_read ON public.chapters;
DROP POLICY IF EXISTS progress_backup_read ON public.reading_progress;
DROP POLICY IF EXISTS enquiries_backup_read ON public.portfolio_enquiries;
DROP POLICY IF EXISTS audit_backup_read ON public.audit_log;

ALTER TABLE public.token_redemptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_buckets DISABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS public.cv_purge_expired_ephemeral();
DROP FUNCTION IF EXISTS public.cv_clear_rate_limit(TEXT);
DROP FUNCTION IF EXISTS public.cv_check_rate_limit(TEXT, INTEGER, BIGINT, BIGINT, BOOLEAN, INTEGER, BOOLEAN);
DROP FUNCTION IF EXISTS public.cv_redeem_token(TEXT, BIGINT, BIGINT);
DROP FUNCTION IF EXISTS public.cv_delete_session(TEXT);
DROP FUNCTION IF EXISTS public.cv_touch_session(TEXT, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.cv_resolve_session(TEXT);
DROP FUNCTION IF EXISTS public.cv_count_active_demo_users();

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.users, public.token_redemptions, public.rate_limit_buckets
TO cv_app_user;

DELETE FROM public.schema_migrations WHERE version = '002_database_roles_and_hardening';

COMMIT;

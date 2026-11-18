BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='skillmint_tenant_runtime') THEN
  CREATE ROLE skillmint_tenant_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
 END IF;
END $$;
GRANT skillmint_tenant_runtime TO postgres;
GRANT USAGE ON SCHEMA public TO skillmint_tenant_runtime;
CREATE TABLE IF NOT EXISTS public.hrdiary_platform_owner(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),user_id uuid NOT NULL UNIQUE REFERENCES public.users(id));
CREATE TABLE IF NOT EXISTS public.hrdiary_signup_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text NOT NULL, company_name text NOT NULL,email text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz,organization_id uuid REFERENCES public.organizations(id),reviewed_by uuid REFERENCES public.users(id));
CREATE UNIQUE INDEX IF NOT EXISTS hrdiary_pending_email ON public.hrdiary_signup_requests(lower(email)) WHERE status='pending';
CREATE TABLE IF NOT EXISTS public.hrdiary_platform_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES public.users(id),workspace_id uuid REFERENCES public.organizations(id),action text NOT NULL,details jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.hrdiary_google_identities(subject text PRIMARY KEY,user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.hrdiary_registration_attempts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_at timestamptz DEFAULT now() NOT NULL);
CREATE INDEX IF NOT EXISTS hrdiary_registration_attempts_created ON public.hrdiary_registration_attempts(created_at);
DO $$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['hrdiary_platform_owner','hrdiary_signup_requests','hrdiary_platform_audit','hrdiary_google_identities','hrdiary_registration_attempts'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,skillmint_tenant_runtime',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['activities','applications','assignment_history','audit_events','candidates','clients','company_leads','crm_config_options','crm_custom_fields','crm_workflow_settings','daily_reports','duplicate_reviews','followups','handover_batches','import_batches','interviews','jobs','notifications','resume_builder_drafts','resume_versions','stage_history','users'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,skillmint_tenant_runtime',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO skillmint_tenant_runtime',t);
  EXECUTE format('DROP POLICY IF EXISTS hrdiary_tenant ON public.%I',t);
  EXECUTE format('CREATE POLICY hrdiary_tenant ON public.%I FOR ALL TO skillmint_tenant_runtime USING (organization_id = nullif(current_setting(''hrdiary.organization_id'',true),'''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''hrdiary.organization_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organizations FROM PUBLIC,anon,authenticated,skillmint_tenant_runtime;
GRANT SELECT ON public.organizations TO skillmint_tenant_runtime;
DROP POLICY IF EXISTS hrdiary_org ON public.organizations;
CREATE POLICY hrdiary_org ON public.organizations FOR SELECT TO skillmint_tenant_runtime USING (id=nullif(current_setting('hrdiary.organization_id',true),'')::uuid);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sessions,public.login_history FROM PUBLIC,anon,authenticated,skillmint_tenant_runtime;
GRANT SELECT,DELETE ON public.sessions TO skillmint_tenant_runtime;
GRANT SELECT ON public.login_history TO skillmint_tenant_runtime;
DROP POLICY IF EXISTS hrdiary_sessions ON public.sessions;
CREATE POLICY hrdiary_sessions ON public.sessions FOR ALL TO skillmint_tenant_runtime USING(EXISTS(SELECT 1 FROM public.users u WHERE u.id=sessions.user_id AND u.organization_id=nullif(current_setting('hrdiary.organization_id',true),'')::uuid)) WITH CHECK(EXISTS(SELECT 1 FROM public.users u WHERE u.id=sessions.user_id AND u.organization_id=nullif(current_setting('hrdiary.organization_id',true),'')::uuid));
DROP POLICY IF EXISTS hrdiary_logins ON public.login_history;
CREATE POLICY hrdiary_logins ON public.login_history FOR SELECT TO skillmint_tenant_runtime USING(EXISTS(SELECT 1 FROM public.users u WHERE u.id=login_history.user_id AND u.organization_id=nullif(current_setting('hrdiary.organization_id',true),'')::uuid));
COMMIT;
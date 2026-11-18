-- STAGING ONLY until application and cross-tenant tests pass.
-- Run with the administrative migration connection, never the public Data API.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='skillmint_tenant_runtime') THEN
    CREATE ROLE skillmint_tenant_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE skillmint_tenant_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT skillmint_tenant_runtime TO postgres;
GRANT USAGE ON SCHEMA public TO skillmint_tenant_runtime;
CREATE TABLE IF NOT EXISTS public.saas_workspace_access (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  status text NOT NULL CHECK(status IN ('legacy','trial','active','suspended','platform')),
  trial_ends_at timestamptz,
  paid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Preserve existing CRM workspaces without beginning a new trial.
INSERT INTO public.saas_workspace_access(organization_id,status)
SELECT id,'legacy' FROM public.organizations ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.saas_platform_owner (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id)
);
CREATE TABLE IF NOT EXISTS public.saas_registration_invites (
  token_hash text PRIMARY KEY,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.saas_platform_owner ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_registration_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.saas_platform_owner,public.saas_registration_invites FROM PUBLIC,anon,authenticated,skillmint_tenant_runtime;
-- Apply a tenant policy to each existing tenant-owned table, including new SaaS status.
-- The restricted role cannot modify subscriptions or the workspace name.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname='public' AND c.relkind='r'
      AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='organization_id' AND a.attnum>0 AND NOT a.attisdropped)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,skillmint_tenant_runtime',t);
    IF t='saas_workspace_access' THEN
      EXECUTE format('GRANT SELECT ON public.%I TO skillmint_tenant_runtime',t);
    ELSE
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO skillmint_tenant_runtime',t);
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS skillmint_tenant_isolation ON public.%I',t);
    EXECUTE format('CREATE POLICY skillmint_tenant_isolation ON public.%I FOR ALL TO skillmint_tenant_runtime USING (organization_id = nullif(current_setting(''skillmint.organization_id'',true),'''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''skillmint.organization_id'',true),'''')::uuid)',t);
  END LOOP;
END $$;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organizations FROM PUBLIC,anon,authenticated,skillmint_tenant_runtime;
GRANT SELECT ON public.organizations TO skillmint_tenant_runtime;
DROP POLICY IF EXISTS skillmint_tenant_org ON public.organizations;
CREATE POLICY skillmint_tenant_org ON public.organizations FOR SELECT TO skillmint_tenant_runtime
USING(id=nullif(current_setting('skillmint.organization_id',true),'')::uuid);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sessions,public.login_history FROM PUBLIC,anon,authenticated,skillmint_tenant_runtime;
GRANT SELECT,DELETE ON public.sessions TO skillmint_tenant_runtime;
GRANT SELECT ON public.login_history TO skillmint_tenant_runtime;
DROP POLICY IF EXISTS skillmint_tenant_sessions ON public.sessions;
CREATE POLICY skillmint_tenant_sessions ON public.sessions FOR ALL TO skillmint_tenant_runtime
USING(EXISTS(SELECT 1 FROM public.users u WHERE u.id=sessions.user_id AND u.organization_id=nullif(current_setting('skillmint.organization_id',true),'')::uuid))
WITH CHECK(EXISTS(SELECT 1 FROM public.users u WHERE u.id=sessions.user_id AND u.organization_id=nullif(current_setting('skillmint.organization_id',true),'')::uuid));
DROP POLICY IF EXISTS skillmint_tenant_logins ON public.login_history;
CREATE POLICY skillmint_tenant_logins ON public.login_history FOR SELECT TO skillmint_tenant_runtime
USING(EXISTS(SELECT 1 FROM public.users u WHERE u.id=login_history.user_id AND u.organization_id=nullif(current_setting('skillmint.organization_id',true),'')::uuid));
COMMIT;

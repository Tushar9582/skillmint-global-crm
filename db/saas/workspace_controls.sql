-- Apply only after tenant_security.sql on a staging database.
BEGIN;
CREATE TABLE IF NOT EXISTS public.saas_workspace_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 150),
  website text,
  contact_email text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.saas_workspace_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.saas_workspace_settings FROM PUBLIC,anon,authenticated,skillmint_tenant_runtime;
GRANT SELECT,INSERT,UPDATE ON public.saas_workspace_settings TO skillmint_tenant_runtime;
DROP POLICY IF EXISTS skillmint_workspace_settings ON public.saas_workspace_settings;
CREATE POLICY skillmint_workspace_settings ON public.saas_workspace_settings FOR ALL TO skillmint_tenant_runtime
USING(organization_id=nullif(current_setting('skillmint.organization_id',true),'')::uuid)
WITH CHECK(organization_id=nullif(current_setting('skillmint.organization_id',true),'')::uuid);
CREATE TABLE IF NOT EXISTS public.saas_platform_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.users(id),
  workspace_id uuid REFERENCES public.organizations(id),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saas_platform_audit_recent ON public.saas_platform_audit(created_at DESC);
ALTER TABLE public.saas_platform_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.saas_platform_audit FROM PUBLIC,anon,authenticated,skillmint_tenant_runtime;
CREATE INDEX IF NOT EXISTS saas_invites_email_recent ON public.saas_registration_invites(email,created_at DESC);
COMMIT;

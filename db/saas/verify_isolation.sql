-- Run after tenant_security.sql against an isolated staging DB as postgres.
-- All fixtures are rolled back. Any assertion failure aborts the transaction.
BEGIN;
INSERT INTO public.organizations(id,name) VALUES
('8fae0000-0000-4000-8000-000000000001','Isolation test A'),
('8fae0000-0000-4000-8000-000000000002','Isolation test B');
INSERT INTO public.company_leads(id,organization_id,company_name) VALUES
('8fae0000-0000-4000-8000-000000000011','8fae0000-0000-4000-8000-000000000001','A private lead'),
('8fae0000-0000-4000-8000-000000000012','8fae0000-0000-4000-8000-000000000002','B private lead');
SET LOCAL ROLE skillmint_tenant_runtime;
SELECT set_config('skillmint.organization_id','8fae0000-0000-4000-8000-000000000001',true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.company_leads WHERE id IN ('8fae0000-0000-4000-8000-000000000011','8fae0000-0000-4000-8000-000000000012'))<>1 THEN
    RAISE EXCEPTION 'Tenant A read isolation failed'; END IF;
  UPDATE public.company_leads SET company_name='cross tenant update' WHERE id='8fae0000-0000-4000-8000-000000000012';
  IF FOUND THEN RAISE EXCEPTION 'Cross-tenant update was permitted'; END IF;
  DELETE FROM public.company_leads WHERE id='8fae0000-0000-4000-8000-000000000012';
  IF FOUND THEN RAISE EXCEPTION 'Cross-tenant delete was permitted'; END IF;
  BEGIN
    INSERT INTO public.company_leads(organization_id,company_name) VALUES('8fae0000-0000-4000-8000-000000000002','cross tenant insert');
    RAISE EXCEPTION 'Cross-tenant insert was permitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('skillmint.organization_id','8fae0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.company_leads WHERE id='8fae0000-0000-4000-8000-000000000012' AND company_name='B private lead')
    OR EXISTS(SELECT 1 FROM public.company_leads WHERE id='8fae0000-0000-4000-8000-000000000011')
    THEN RAISE EXCEPTION 'Tenant B isolation failed'; END IF;
END $$;
ROLLBACK;

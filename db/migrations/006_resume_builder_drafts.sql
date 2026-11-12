-- Resume Builder cloud drafts for authenticated CRM users.
-- This file mirrors the Supabase migration already applied to SkillmintCRM.
CREATE TABLE IF NOT EXISTS public.resume_builder_drafts (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  owner_id uuid NOT NULL REFERENCES public.users(id),
  candidate_id uuid REFERENCES public.candidates(id),
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resume_draft_content_object CHECK (jsonb_typeof(content)='object')
);
CREATE INDEX IF NOT EXISTS resume_builder_drafts_owner
  ON public.resume_builder_drafts(organization_id,owner_id,updated_at DESC);
ALTER TABLE public.resume_builder_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.resume_builder_drafts FROM anon,authenticated;

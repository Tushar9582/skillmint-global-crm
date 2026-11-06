-- Phase 5: admin-controlled CRM configuration (pick lists, custom fields, workflow settings). Idempotent; run after 004.

-- Pick-list values are data. System values (is_system) back application logic and can never be renamed, removed or deactivated.
CREATE TABLE IF NOT EXISTS crm_config_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  kind text NOT NULL CHECK (kind IN ('company_lead_stage','candidate_stage','priority','company_lead_source','candidate_source','followup_type')),
  value text NOT NULL CHECK (value ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  sort_order integer NOT NULL DEFAULT 100 CHECK (sort_order BETWEEN 0 AND 10000),
  active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,kind,value),
  CHECK (NOT is_system OR active)
);

CREATE TABLE IF NOT EXISTS crm_custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  entity text NOT NULL CHECK (entity IN ('company_leads','candidates')),
  field_key text NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  field_type text NOT NULL CHECK (field_type IN ('text','number','date','select')),
  options text[] NOT NULL DEFAULT '{}',
  required boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100 CHECK (sort_order BETWEEN 0 AND 10000),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,entity,field_key),
  CHECK (field_type <> 'select' OR cardinality(options) BETWEEN 1 AND 40)
);

CREATE TABLE IF NOT EXISTS crm_workflow_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id),
  resume_followup_days integer NOT NULL DEFAULT 1 CHECK (resume_followup_days BETWEEN 0 AND 30),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE company_leads ADD COLUMN IF NOT EXISTS custom jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS custom jsonb NOT NULL DEFAULT '{}'::jsonb;

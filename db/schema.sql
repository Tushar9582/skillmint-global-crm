CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  full_name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','employee')),
  team text,
  active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,email)
);
CREATE INDEX IF NOT EXISTS users_org_active ON users(organization_id,active);
CREATE UNIQUE INDEX IF NOT EXISTS users_global_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  email text NOT NULL,
  success boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  company_name text NOT NULL,
  industry text,
  website text,
  city text,
  contact_name text,
  contact_title text,
  email text,
  phone text,
  source text NOT NULL DEFAULT 'manual',
  priority text NOT NULL DEFAULT 'medium',
  stage text NOT NULL DEFAULT 'new',
  owner_id uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  last_contacted_at timestamptz,
  next_followup_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_scope ON company_leads(organization_id,owner_id,stage);
ALTER TABLE company_leads ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE company_leads ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS leads_active_scope ON company_leads(organization_id,owner_id,stage) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  company_lead_id uuid REFERENCES company_leads(id),
  company_name text NOT NULL,
  industry text,
  city text,
  contact_name text,
  contact_email text,
  contact_phone text,
  service_terms text,
  owner_id uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clients_scope ON clients(organization_id,owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS one_client_per_converted_lead ON clients(organization_id,company_lead_id)
  WHERE company_lead_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  title text NOT NULL,
  department text,
  location text,
  work_mode text,
  skills text[] NOT NULL DEFAULT '{}',
  openings integer NOT NULL DEFAULT 1 CHECK (openings > 0),
  salary_min numeric,
  salary_max numeric,
  experience_min numeric,
  experience_max numeric,
  required_by date,
  priority text NOT NULL DEFAULT 'medium',
  stage text NOT NULL DEFAULT 'open',
  owner_id uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_scope ON jobs(organization_id,owner_id,stage);

CREATE TABLE IF NOT EXISTS candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  full_name text NOT NULL,
  email text,
  phone text,
  normalized_email text,
  normalized_phone text,
  location text,
  skills text[] NOT NULL DEFAULT '{}',
  experience_years numeric,
  expected_ctc numeric,
  notice_period text,
  preferred_role text,
  source text NOT NULL DEFAULT 'manual',
  stage text NOT NULL DEFAULT 'new',
  parse_status text NOT NULL DEFAULT 'not_uploaded',
  owner_id uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidates_scope ON candidates(organization_id,owner_id,stage);
CREATE INDEX IF NOT EXISTS candidates_email ON candidates(organization_id,normalized_email) WHERE normalized_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS candidates_phone ON candidates(organization_id,normalized_phone) WHERE normalized_phone IS NOT NULL;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS candidates_active_scope ON candidates(organization_id,owner_id,stage) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS resume_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  sha256 char(64) NOT NULL,
  original_filename text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  file_size integer NOT NULL,
  extracted_text text,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resume_hash_scope ON resume_versions(organization_id,sha256);
CREATE UNIQUE INDEX IF NOT EXISTS resume_exact_file_unique ON resume_versions(organization_id,sha256);

CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  job_id uuid NOT NULL REFERENCES jobs(id),
  owner_id uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  stage text NOT NULL DEFAULT 'shortlisted',
  fit_notes text,
  submitted_at timestamptz,
  joined_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,candidate_id,job_id)
);
CREATE INDEX IF NOT EXISTS apps_scope ON applications(organization_id,owner_id,stage);

CREATE TABLE IF NOT EXISTS interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  application_id uuid NOT NULL REFERENCES applications(id),
  owner_id uuid REFERENCES users(id),
  round_label text NOT NULL DEFAULT 'Round 1',
  mode text NOT NULL DEFAULT 'video',
  scheduled_at timestamptz NOT NULL,
  meeting_link text,
  location text,
  interviewer text,
  feedback text,
  outcome text NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interviews_scope ON interviews(organization_id,owner_id,scheduled_at);

CREATE TABLE IF NOT EXISTS followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  target_type text NOT NULL CHECK (target_type IN ('company_leads','candidates','applications')),
  target_id uuid NOT NULL,
  owner_id uuid REFERENCES users(id),
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
  priority text NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  channel text,
  outcome text,
  notes text,
  completed_by uuid REFERENCES users(id),
  completed_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS followups_queue ON followups(organization_id,owner_id,status,due_at);

CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  channel text NOT NULL,
  outcome text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_reporting ON activities(organization_id,actor_id,created_at);

CREATE TABLE IF NOT EXISTS stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  old_stage text,
  new_stage text NOT NULL,
  changed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  from_owner uuid REFERENCES users(id),
  to_owner uuid REFERENCES users(id),
  changed_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS handover_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  from_user uuid NOT NULL REFERENCES users(id),
  to_user uuid NOT NULL REFERENCES users(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  lead_count integer NOT NULL DEFAULT 0,
  candidate_count integer NOT NULL DEFAULT 0,
  application_count integer NOT NULL DEFAULT 0,
  followup_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS duplicate_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  matched_candidate_id uuid REFERENCES candidates(id),
  upload_key text NOT NULL,
  upload_hash char(64) NOT NULL,
  upload_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  parsed_data jsonb NOT NULL,
  extracted_text text,
  owner_id uuid REFERENCES users(id),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_pending ON duplicate_reviews(organization_id,status);

CREATE TABLE IF NOT EXISTS daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  report_date date NOT NULL,
  blockers text,
  tomorrow_plan text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,report_date)
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  body text,
  href text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(organization_id,user_id,read_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_recent ON audit_events(organization_id,created_at DESC);

CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  created_by uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  content_hash text NOT NULL,
  inserted integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,kind,content_hash)
);

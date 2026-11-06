-- Phase 1: HR core (employees, holidays, shifts, attendance). Idempotent; run after db/schema.sql.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','hr_manager','employee','finance'));

CREATE TABLE IF NOT EXISTS hr_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  default_weekly_off integer[] NOT NULL DEFAULT '{0}',
  standard_daily_hours numeric NOT NULL DEFAULT 8 CHECK (standard_daily_hours > 0 AND standard_daily_hours <= 24),
  full_day_ratio numeric NOT NULL DEFAULT 0.75 CHECK (full_day_ratio > 0 AND full_day_ratio <= 1),
  half_day_ratio numeric NOT NULL DEFAULT 0.4 CHECK (half_day_ratio > 0 AND half_day_ratio <= 1),
  max_open_hours integer NOT NULL DEFAULT 20 CHECK (max_open_hours BETWEEN 1 AND 48),
  overtime_requires_approval boolean NOT NULL DEFAULT true,
  overtime_min_minutes integer NOT NULL DEFAULT 30 CHECK (overtime_min_minutes >= 0),
  overtime_weekday_multiplier numeric NOT NULL DEFAULT 1.5 CHECK (overtime_weekday_multiplier >= 0),
  overtime_weekoff_multiplier numeric NOT NULL DEFAULT 2 CHECK (overtime_weekoff_multiplier >= 0),
  overtime_holiday_multiplier numeric NOT NULL DEFAULT 2 CHECK (overtime_holiday_multiplier >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hr_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid UNIQUE REFERENCES users(id),
  employee_code text NOT NULL,
  full_name text NOT NULL,
  email text,
  phone text,
  department text,
  designation text,
  location text,
  joining_date date,
  exit_date date,
  employment_status text NOT NULL DEFAULT 'active'
    CHECK (employment_status IN ('probation','active','notice','resigned','terminated','inactive')),
  manager_id uuid REFERENCES hr_employees(id),
  date_of_birth date,
  gender text,
  marital_status text,
  address text,
  emergency_contact_name text,
  emergency_contact_relation text,
  emergency_contact_phone text,
  personal jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,employee_code),
  CHECK (manager_id IS NULL OR manager_id <> id)
);
CREATE INDEX IF NOT EXISTS hr_employees_scope ON hr_employees(organization_id,active,department);

CREATE TABLE IF NOT EXISTS hr_employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  employee_id uuid NOT NULL REFERENCES hr_employees(id),
  doc_type text NOT NULL,
  title text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  file_size integer NOT NULL,
  storage_key text NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS hr_documents_employee ON hr_employee_documents(organization_id,employee_id);

CREATE TABLE IF NOT EXISTS hr_employment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  employee_id uuid NOT NULL REFERENCES hr_employees(id),
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_date date NOT NULL DEFAULT current_date,
  changed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_history_employee ON hr_employment_history(organization_id,employee_id,created_at DESC);

CREATE TABLE IF NOT EXISTS hr_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  holiday_date date NOT NULL,
  holiday_type text NOT NULL DEFAULT 'public' CHECK (holiday_type IN ('public','company','optional','regional')),
  locations text[] NOT NULL DEFAULT '{}',
  teams text[] NOT NULL DEFAULT '{}',
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,holiday_date,name)
);

CREATE TABLE IF NOT EXISTS hr_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'custom' CHECK (kind IN ('morning','evening','night','custom')),
  start_time time NOT NULL,
  end_time time NOT NULL,
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 240),
  grace_minutes integer NOT NULL DEFAULT 0 CHECK (grace_minutes BETWEEN 0 AND 120),
  weekly_off integer[] NOT NULL DEFAULT '{0}',
  working_days integer[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,name)
);

CREATE TABLE IF NOT EXISTS hr_shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  employee_id uuid NOT NULL REFERENCES hr_employees(id),
  shift_id uuid NOT NULL REFERENCES hr_shifts(id),
  effective_from date NOT NULL,
  effective_to date,
  changed_by uuid REFERENCES users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS hr_shift_assign_employee ON hr_shift_assignments(organization_id,employee_id,effective_from DESC);

CREATE TABLE IF NOT EXISTS hr_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  employee_id uuid NOT NULL REFERENCES hr_employees(id),
  work_date date NOT NULL,
  shift_id uuid REFERENCES hr_shifts(id),
  punch_in timestamptz,
  punch_out timestamptz,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','present','half_day','absent','missing_punch')),
  worked_minutes integer NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  late_minutes integer NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  early_minutes integer NOT NULL DEFAULT 0 CHECK (early_minutes >= 0),
  overtime_minutes integer NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
  source text NOT NULL DEFAULT 'self' CHECK (source IN ('self','correction')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,employee_id,work_date),
  CHECK (punch_out IS NULL OR punch_in IS NULL OR punch_out >= punch_in)
);
CREATE INDEX IF NOT EXISTS hr_attendance_date ON hr_attendance(organization_id,work_date);

CREATE TABLE IF NOT EXISTS hr_attendance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  attendance_id uuid NOT NULL REFERENCES hr_attendance(id),
  employee_id uuid NOT NULL REFERENCES hr_employees(id),
  old_values jsonb NOT NULL,
  new_values jsonb NOT NULL,
  reason text NOT NULL,
  corrected_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_corrections_attendance ON hr_attendance_corrections(organization_id,attendance_id);

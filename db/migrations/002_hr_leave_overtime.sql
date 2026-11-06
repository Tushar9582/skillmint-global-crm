-- Phase 2: overtime and leave management. Idempotent; run after 001.

CREATE TABLE IF NOT EXISTS hr_overtime_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  employee_id uuid NOT NULL REFERENCES hr_employees(id),
  attendance_id uuid REFERENCES hr_attendance(id),
  work_date date NOT NULL,
  calculated_minutes integer NOT NULL CHECK (calculated_minutes > 0),
  requested_minutes integer NOT NULL CHECK (requested_minutes > 0),
  approved_minutes integer CHECK (approved_minutes IS NULL OR approved_minutes >= 0),
  day_type text NOT NULL DEFAULT 'working' CHECK (day_type IN ('working','weekly_off','holiday')),
  rate_multiplier numeric,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,employee_id,work_date),
  CHECK (approved_minutes IS NULL OR approved_minutes <= requested_minutes)
);
CREATE INDEX IF NOT EXISTS hr_overtime_status ON hr_overtime_requests(organization_id,status,work_date);

CREATE TABLE IF NOT EXISTS hr_leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  code text NOT NULL,
  annual_quota numeric NOT NULL DEFAULT 0 CHECK (annual_quota >= 0 AND annual_quota <= 366),
  paid boolean NOT NULL DEFAULT true,
  count_weekends boolean NOT NULL DEFAULT false,
  count_holidays boolean NOT NULL DEFAULT false,
  allow_negative boolean NOT NULL DEFAULT false,
  requires_approval boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,code)
);

CREATE TABLE IF NOT EXISTS hr_leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  employee_id uuid NOT NULL REFERENCES hr_employees(id),
  leave_type_id uuid NOT NULL REFERENCES hr_leave_types(id),
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  allocated numeric NOT NULL DEFAULT 0 CHECK (allocated >= 0),
  adjustment numeric NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,employee_id,leave_type_id,year)
);

CREATE TABLE IF NOT EXISTS hr_leave_balance_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  employee_id uuid NOT NULL REFERENCES hr_employees(id),
  leave_type_id uuid NOT NULL REFERENCES hr_leave_types(id),
  year integer NOT NULL,
  change jsonb NOT NULL,
  reason text NOT NULL,
  changed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hr_leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  employee_id uuid NOT NULL REFERENCES hr_employees(id),
  leave_type_id uuid NOT NULL REFERENCES hr_leave_types(id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  half_day boolean NOT NULL DEFAULT false,
  half_day_part text CHECK (half_day_part IN ('first','second')),
  days numeric NOT NULL CHECK (days > 0),
  counted_dates date[] NOT NULL DEFAULT '{}',
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (NOT half_day OR start_date = end_date)
);
CREATE INDEX IF NOT EXISTS hr_leave_employee ON hr_leave_requests(organization_id,employee_id,start_date);
CREATE INDEX IF NOT EXISTS hr_leave_status ON hr_leave_requests(organization_id,status);

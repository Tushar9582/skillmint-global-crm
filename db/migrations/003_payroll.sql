-- Phase 3: payroll (salary structures, statutory rules, runs, payslips). Idempotent; run after 002.

ALTER TABLE hr_settings ADD COLUMN IF NOT EXISTS payroll_lop_basis text NOT NULL DEFAULT 'working_days';
ALTER TABLE hr_settings DROP CONSTRAINT IF EXISTS hr_settings_lop_basis_check;
ALTER TABLE hr_settings ADD CONSTRAINT hr_settings_lop_basis_check CHECK (payroll_lop_basis IN ('working_days','calendar_days','fixed_30'));
ALTER TABLE hr_settings ADD COLUMN IF NOT EXISTS payroll_currency text NOT NULL DEFAULT 'INR';

CREATE TABLE IF NOT EXISTS payroll_salary_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  employee_id uuid NOT NULL REFERENCES hr_employees(id),
  effective_from date NOT NULL,
  basic numeric(14,2) NOT NULL CHECK (basic >= 0),
  allowances jsonb NOT NULL DEFAULT '[]'::jsonb,
  deductions jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,employee_id,effective_from)
);

-- Statutory rates are data, never code. A rule only affects payroll after a named reviewer confirms it.
CREATE TABLE IF NOT EXISTS payroll_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  base text NOT NULL CHECK (base IN ('basic','gross')),
  rate_percent numeric(7,4) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  base_cap numeric(14,2) CHECK (base_cap IS NULL OR base_cap >= 0),
  active boolean NOT NULL DEFAULT true,
  legal_note text,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,code)
);

CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  employee_id uuid NOT NULL REFERENCES hr_employees(id),
  period_year integer NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  kind text NOT NULL CHECK (kind IN ('bonus','deduction')),
  label text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);
CREATE INDEX IF NOT EXISTS payroll_adjustments_period ON payroll_adjustments(organization_id,period_year,period_month);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  period_year integer NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','finalized')),
  employee_count integer NOT NULL DEFAULT 0,
  total_gross numeric(16,2) NOT NULL DEFAULT 0,
  total_deductions numeric(16,2) NOT NULL DEFAULT 0,
  total_overtime numeric(16,2) NOT NULL DEFAULT 0,
  total_net numeric(16,2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  finalized_by uuid REFERENCES users(id),
  finalized_at timestamptz,
  UNIQUE (organization_id,period_year,period_month)
);

CREATE TABLE IF NOT EXISTS payroll_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  run_id uuid NOT NULL REFERENCES payroll_runs(id),
  employee_id uuid NOT NULL REFERENCES hr_employees(id),
  working_days numeric(6,2) NOT NULL,
  lop_days numeric(6,2) NOT NULL,
  payable_days numeric(6,2) NOT NULL,
  basic numeric(14,2) NOT NULL,
  gross numeric(14,2) NOT NULL,
  lop_deduction numeric(14,2) NOT NULL DEFAULT 0,
  overtime_minutes integer NOT NULL DEFAULT 0,
  overtime_pay numeric(14,2) NOT NULL DEFAULT 0,
  bonus numeric(14,2) NOT NULL DEFAULT 0,
  other_deductions numeric(14,2) NOT NULL DEFAULT 0,
  statutory_deductions numeric(14,2) NOT NULL DEFAULT 0,
  total_deductions numeric(14,2) NOT NULL DEFAULT 0,
  net numeric(14,2) NOT NULL,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  employee_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id,employee_id)
);
CREATE INDEX IF NOT EXISTS payroll_items_employee ON payroll_items(organization_id,employee_id);

-- Finalized payroll is immutable at the database level, not only in application code.
CREATE OR REPLACE FUNCTION payroll_block_finalized() RETURNS trigger AS $$
DECLARE run_status text;
BEGIN
  IF TG_TABLE_NAME = 'payroll_runs' THEN
    IF OLD.status = 'finalized' THEN RAISE EXCEPTION 'Finalized payroll runs cannot be changed'; END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT status INTO run_status FROM payroll_runs WHERE id = OLD.run_id;
  IF run_status = 'finalized' THEN RAISE EXCEPTION 'Finalized payroll items cannot be changed'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS payroll_runs_immutable ON payroll_runs;
CREATE TRIGGER payroll_runs_immutable BEFORE UPDATE OR DELETE ON payroll_runs FOR EACH ROW EXECUTE FUNCTION payroll_block_finalized();
DROP TRIGGER IF EXISTS payroll_items_immutable ON payroll_items;
CREATE TRIGGER payroll_items_immutable BEFORE UPDATE OR DELETE ON payroll_items FOR EACH ROW EXECUTE FUNCTION payroll_block_finalized();

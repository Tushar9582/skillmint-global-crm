-- Phase 4: client billing, invoices and manual payment tracking. Idempotent; run after 003.

CREATE TABLE IF NOT EXISTS billing_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id),
  company_name text NOT NULL DEFAULT 'SkillMint Global',
  address text,
  tax_id text,
  invoice_prefix text NOT NULL DEFAULT 'INV' CHECK (invoice_prefix ~ '^[A-Z0-9]{1,8}$'),
  payment_terms_days integer NOT NULL DEFAULT 15 CHECK (payment_terms_days BETWEEN 0 AND 365),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  payment_instructions text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Tax names and rates are configuration; each invoice stores its own snapshot.
CREATE TABLE IF NOT EXISTS billing_tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  rate_percent numeric(7,4) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,name)
);

CREATE TABLE IF NOT EXISTS billing_invoice_sequences (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  invoice_year integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id,invoice_year)
);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  invoice_number text,
  invoice_date date NOT NULL,
  due_date date NOT NULL,
  service_description text NOT NULL,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_breakup jsonb NOT NULL DEFAULT '[]'::jsonb,
  tax_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','partially_paid','paid','cancelled')),
  notes text,
  sent_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_date >= invoice_date),
  CHECK (status = 'draft' OR invoice_number IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_invoice_number ON billing_invoices(organization_id,invoice_number) WHERE invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_invoice_client ON billing_invoices(organization_id,client_id,status);
CREATE INDEX IF NOT EXISTS billing_invoice_due ON billing_invoices(organization_id,status,due_date);

-- Payments are manual records entered by staff. Gateway columns are reserved for a future approved integration.
CREATE TABLE IF NOT EXISTS billing_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  invoice_id uuid NOT NULL REFERENCES billing_invoices(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_on date NOT NULL,
  method text NOT NULL CHECK (method IN ('bank_transfer','cheque','cash','upi','card','other')),
  reference text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','gateway')),
  gateway_transaction_id text,
  notes text,
  recorded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES users(id),
  void_reason text,
  CHECK ((source = 'manual' AND gateway_transaction_id IS NULL) OR (source = 'gateway' AND gateway_transaction_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS billing_payments_invoice ON billing_payments(organization_id,invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS billing_payments_gateway_ref ON billing_payments(organization_id,gateway_transaction_id) WHERE gateway_transaction_id IS NOT NULL;

CREATE TABLE fee_invoices (
  id UUID PRIMARY KEY,
  erp_reference TEXT NOT NULL UNIQUE,
  student_reference TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 100 AND amount_minor <= 1000000000),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (status IN ('UNPAID','PAID')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE payment_orders (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES fee_invoices(id),
  merchant_order_id TEXT NOT NULL UNIQUE,
  gateway_key UUID NOT NULL UNIQUE,
  cf_order_id TEXT,
  payment_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'CREATING',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_order_per_invoice ON payment_orders(invoice_id) WHERE active = TRUE;
CREATE TABLE idempotency_requests (
  key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  order_id UUID NOT NULL REFERENCES payment_orders(id)
);
CREATE TABLE payment_attempts (
  cf_payment_id TEXT PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES payment_orders(id),
  status TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE receipts (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL UNIQUE REFERENCES fee_invoices(id),
  cf_payment_id TEXT NOT NULL UNIQUE REFERENCES payment_attempts(cf_payment_id),
  amount_minor BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY,
  payload_hash TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX webhook_work ON webhook_events(state, next_run_at);
CREATE TABLE payment_status_history (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES payment_orders(id),
  cf_payment_id TEXT,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE payment_exceptions (
  id UUID PRIMARY KEY,
  order_id UUID REFERENCES payment_orders(id),
  reference TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(reference, reason)
);
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY,
  receipt_id UUID NOT NULL UNIQUE REFERENCES receipts(id),
  payload JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT
);
CREATE TABLE mock_erp_payments (
  receipt_id UUID PRIMARY KEY REFERENCES receipts(id),
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE ledger_direction AS ENUM ('debit', 'credit');

CREATE TABLE ledger_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL,
  account_id  UUID NOT NULL REFERENCES accounts(id),
  direction   ledger_direction NOT NULL,
  amount      NUMERIC NOT NULL CHECK (amount > 0),
  currency    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
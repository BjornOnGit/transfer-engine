CREATE TABLE transfers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_account_id   UUID NOT NULL REFERENCES accounts(id),
  receiver_account_id UUID NOT NULL REFERENCES accounts(id),
  source_currency     TEXT NOT NULL,
  dest_currency       TEXT NOT NULL,
  amount              NUMERIC NOT NULL CHECK (amount > 0),
  status              TEXT NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated', 'rate_locked', 'funds_moved', 'completed', 'failed', 'reversed')),
  locked_rate_id      UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_transfer_id_fkey
  FOREIGN KEY (transfer_id) REFERENCES transfers(id);
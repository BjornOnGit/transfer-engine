CREATE TABLE fx_rate_locks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id     UUID NOT NULL UNIQUE REFERENCES transfers(id),
  rate            NUMERIC NOT NULL CHECK (rate > 0),
  source_currency TEXT NOT NULL,
  dest_currency   TEXT NOT NULL,
  locked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL
);

ALTER TABLE transfers
  ADD CONSTRAINT transfers_locked_rate_id_fkey
  FOREIGN KEY (locked_rate_id) REFERENCES fx_rate_locks(id);
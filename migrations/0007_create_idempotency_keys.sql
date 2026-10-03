CREATE TABLE idempotency_keys (
  key               TEXT PRIMARY KEY,
  request_hash      TEXT NOT NULL,
  response_snapshot JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
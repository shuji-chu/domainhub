CREATE TABLE quota_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  delta INTEGER NOT NULL CHECK (delta <> 0),
  source_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  related_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quota_ledger_source_nonempty CHECK (length(trim(source_type)) > 0),
  CONSTRAINT quota_ledger_reason_nonempty CHECK (length(trim(reason)) > 0)
);
CREATE INDEX quota_ledger_user_created_idx ON quota_ledger(user_id, created_at DESC);

CREATE TABLE rate_limit_buckets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dimension TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT rate_limit_bucket_window_uq UNIQUE(dimension, subject_hash, window_start)
);
CREATE INDEX rate_limit_buckets_expires_idx ON rate_limit_buckets(expires_at);

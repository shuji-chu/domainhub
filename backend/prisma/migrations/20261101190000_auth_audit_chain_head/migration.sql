CREATE TABLE audit_chain_heads (
  shard_id UUID PRIMARY KEY REFERENCES audit_shards(id) ON DELETE RESTRICT,
  chain_id UUID NOT NULL UNIQUE,
  sequence_no BIGINT NOT NULL DEFAULT 0 CHECK (sequence_no >= 0),
  last_hash BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audit_chain_head_shard_chain_fk FOREIGN KEY (shard_id, chain_id)
    REFERENCES audit_shards(id, chain_id) ON DELETE RESTRICT
);

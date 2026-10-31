CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_status AS ENUM ('pending_verification','active','suspended','deleted');
CREATE TYPE oauth_purpose AS ENUM ('login','link');
CREATE TYPE audit_shard_kind AS ENUM ('primary','compensation');
CREATE TYPE audit_shard_state AS ENUM ('open','closing','sealed');
CREATE TYPE audit_outcome AS ENUM ('success','failure','blocked');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  email_verified_at TIMESTAMPTZ,
  status user_status NOT NULL DEFAULT 'pending_verification',
  -- DEPRECATED: compatibility-only; must never be used as an authorization source.
  role TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT users_email_normalized_nonempty CHECK (length(trim(email_normalized)) > 0)
);
CREATE INDEX users_status_created_at_idx ON users(status, created_at);

CREATE TABLE credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_changed_at TIMESTAMPTZ NOT NULL,
  password_version INTEGER NOT NULL DEFAULT 1 CHECK (password_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_renewed_at TIMESTAMPTZ,
  idle_expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip_prefix INET,
  user_agent_hash BYTEA,
  password_version INTEGER NOT NULL CHECK (password_version > 0),
  CONSTRAINT sessions_expiry_order CHECK (idle_expires_at <= absolute_expires_at)
);
CREATE INDEX sessions_user_active_lookup_idx ON sessions(user_id, revoked_at, idle_expires_at, absolute_expires_at);
CREATE INDEX sessions_user_last_seen_idx ON sessions(user_id, last_seen_at DESC);

CREATE TABLE email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  request_ip_prefix INET,
  CONSTRAINT email_verification_token_expiry CHECK (expires_at > created_at)
);
CREATE INDEX email_verification_tokens_expires_at_idx ON email_verification_tokens(expires_at);
CREATE INDEX email_verification_tokens_user_created_idx ON email_verification_tokens(user_id, created_at);

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  request_ip_prefix INET,
  credential_password_version INTEGER NOT NULL CHECK (credential_password_version > 0),
  CONSTRAINT password_reset_token_expiry CHECK (expires_at > created_at)
);
CREATE INDEX password_reset_tokens_expires_at_idx ON password_reset_tokens(expires_at);
CREATE INDEX password_reset_tokens_user_created_idx ON password_reset_tokens(user_id, created_at);

CREATE TABLE oauth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_login TEXT,
  provider_email CITEXT,
  provider_email_normalized TEXT,
  provider_email_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  CONSTRAINT oauth_provider_nonempty CHECK (length(trim(provider)) > 0),
  CONSTRAINT oauth_provider_user_nonempty CHECK (length(trim(provider_user_id)) > 0)
);
CREATE UNIQUE INDEX oauth_accounts_provider_subject_uq ON oauth_accounts(provider, provider_user_id);
CREATE INDEX oauth_accounts_user_id_idx ON oauth_accounts(user_id);
CREATE UNIQUE INDEX oauth_accounts_verified_email_uq ON oauth_accounts(provider, provider_email_normalized)
  WHERE provider_email_verified = true AND provider_email_normalized IS NOT NULL;

CREATE TABLE oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash BYTEA NOT NULL UNIQUE,
  cookie_binding_hash BYTEA NOT NULL,
  purpose oauth_purpose NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_binding_hash BYTEA,
  pkce_verifier_encrypted BYTEA NOT NULL,
  redirect_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  request_ip_prefix INET,
  CONSTRAINT oauth_state_expiry CHECK (expires_at > created_at),
  CONSTRAINT oauth_link_requires_user CHECK (purpose <> 'link' OR user_id IS NOT NULL),
  CONSTRAINT oauth_login_has_no_user CHECK (purpose <> 'login' OR user_id IS NULL)
);
CREATE INDEX oauth_states_expires_at_idx ON oauth_states(expires_at);
CREATE INDEX oauth_states_user_created_idx ON oauth_states(user_id, created_at);

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT roles_code_nonempty CHECK (length(trim(code)) > 0)
);
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  CONSTRAINT permissions_code_nonempty CHECK (length(trim(code)) > 0)
);
CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX role_permissions_permission_id_idx ON role_permissions(permission_id);

CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  granted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  reason TEXT
);
CREATE INDEX user_roles_user_revoked_idx ON user_roles(user_id, revoked_at);
CREATE INDEX user_roles_role_id_idx ON user_roles(role_id);
CREATE UNIQUE INDEX user_roles_one_active_assignment_uq ON user_roles(user_id, role_id) WHERE revoked_at IS NULL;

CREATE TABLE audit_shards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shard_key TEXT NOT NULL UNIQUE,
  chain_id UUID NOT NULL UNIQUE,
  kind audit_shard_kind NOT NULL,
  state audit_shard_state NOT NULL DEFAULT 'open',
  hour_started_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  source_shard_id UUID REFERENCES audit_shards(id) ON DELETE RESTRICT,
  source_manifest_hash BYTEA,
  previous_manifest_hash BYTEA,
  genesis_anchor_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sealed_at TIMESTAMPTZ,
  CONSTRAINT audit_shard_primary_hour CHECK (kind <> 'primary' OR hour_started_at IS NOT NULL),
  CONSTRAINT audit_shard_compensation_source CHECK (kind <> 'compensation' OR (source_shard_id IS NOT NULL AND source_manifest_hash IS NOT NULL AND received_at IS NOT NULL)),
  CONSTRAINT audit_shard_seal_time CHECK ((state <> 'sealed') OR sealed_at IS NOT NULL)
);
CREATE UNIQUE INDEX audit_shards_primary_hour_uq ON audit_shards(hour_started_at) WHERE kind = 'primary';
CREATE INDEX audit_shards_kind_state_created_idx ON audit_shards(kind, state, created_at);
CREATE INDEX audit_shards_source_shard_idx ON audit_shards(source_shard_id);

CREATE TABLE audit_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shard_id UUID NOT NULL UNIQUE REFERENCES audit_shards(id) ON DELETE RESTRICT,
  manifest_hash BYTEA NOT NULL UNIQUE,
  previous_manifest_hash BYTEA,
  source_manifest_hash BYTEA,
  genesis_anchor_hash BYTEA NOT NULL,
  first_sequence_no BIGINT,
  last_sequence_no BIGINT,
  row_count BIGINT NOT NULL CHECK (row_count >= 0),
  first_entry_hash BYTEA,
  last_entry_hash BYTEA,
  signature BYTEA NOT NULL,
  signature_key_id TEXT NOT NULL,
  signature_algorithm TEXT NOT NULL,
  canonicalization_version TEXT NOT NULL,
  sealed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audit_manifest_sequence_bounds CHECK (
    (row_count = 0 AND first_sequence_no IS NULL AND last_sequence_no IS NULL) OR
    (row_count > 0 AND first_sequence_no IS NOT NULL AND last_sequence_no IS NOT NULL AND first_sequence_no <= last_sequence_no)
  )
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shard_id UUID NOT NULL REFERENCES audit_shards(id) ON DELETE RESTRICT,
  shard_kind audit_shard_kind NOT NULL,
  chain_id UUID NOT NULL,
  sequence_no BIGINT NOT NULL CHECK (sequence_no > 0),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_occurred_at TIMESTAMPTZ,
  source_shard_id UUID REFERENCES audit_shards(id) ON DELETE RESTRICT,
  source_manifest_hash BYTEA,
  prev_hash BYTEA NOT NULL,
  entry_hash BYTEA NOT NULL,
  manifest_anchor_hash BYTEA NOT NULL,
  compensation_manifest_prev_hash BYTEA,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_ref TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome audit_outcome NOT NULL,
  request_id TEXT,
  ip_prefix INET,
  user_agent_hash BYTEA,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_log_actor_ref_nonempty CHECK (length(trim(actor_ref)) > 0),
  CONSTRAINT audit_log_action_nonempty CHECK (length(trim(action)) > 0),
  CONSTRAINT audit_log_shard_kind_consistent CHECK (
    (shard_kind = 'primary' AND source_occurred_at IS NULL AND source_shard_id IS NULL AND source_manifest_hash IS NULL) OR
    (shard_kind = 'compensation' AND source_occurred_at IS NOT NULL AND source_shard_id IS NOT NULL AND source_manifest_hash IS NOT NULL AND source_shard_id <> shard_id)
  ),
  CONSTRAINT audit_log_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE(chain_id, sequence_no)
);
CREATE INDEX audit_logs_occurred_at_idx ON audit_logs(occurred_at);
CREATE INDEX audit_logs_actor_occurred_idx ON audit_logs(actor_user_id, occurred_at);
CREATE INDEX audit_logs_action_occurred_idx ON audit_logs(action, occurred_at);
CREATE INDEX audit_logs_shard_sequence_idx ON audit_logs(shard_id, sequence_no);
CREATE INDEX audit_logs_source_shard_idx ON audit_logs(source_shard_id);

-- Enforce immutable sealed manifests and prevent ordinary mutation of sealed shards/logs.
CREATE FUNCTION prevent_sealed_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE shard_state audit_shard_state;
BEGIN
  IF TG_TABLE_NAME = 'audit_manifests' THEN
    RAISE EXCEPTION 'audit manifests are immutable';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    SELECT state INTO shard_state FROM audit_shards WHERE id = OLD.shard_id;
    IF shard_state = 'sealed' THEN
      RAISE EXCEPTION 'sealed audit shard is immutable';
    END IF;
    RETURN OLD;
  END IF;
  SELECT state INTO shard_state FROM audit_shards WHERE id = NEW.shard_id;
  IF shard_state = 'sealed' THEN
    RAISE EXCEPTION 'sealed audit shard is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_manifests_immutable BEFORE UPDATE OR DELETE ON audit_manifests
FOR EACH ROW EXECUTE FUNCTION prevent_sealed_audit_mutation();
CREATE TRIGGER audit_logs_immutable_when_sealed BEFORE INSERT OR UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_sealed_audit_mutation();

-- Composite integrity constraints keep each event bound to its shard chain and genesis anchor.
ALTER TABLE audit_shards ADD CONSTRAINT audit_shards_id_chain_id_uq UNIQUE (id, chain_id);
ALTER TABLE audit_shards ADD CONSTRAINT audit_shards_id_genesis_anchor_uq UNIQUE (id, genesis_anchor_hash);
ALTER TABLE audit_manifests ADD CONSTRAINT audit_manifests_shard_hash_uq UNIQUE (shard_id, manifest_hash);
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_shard_chain_fk
  FOREIGN KEY (shard_id, chain_id) REFERENCES audit_shards(id, chain_id) ON DELETE RESTRICT,
  ADD CONSTRAINT audit_logs_shard_anchor_fk
  FOREIGN KEY (shard_id, manifest_anchor_hash) REFERENCES audit_shards(id, genesis_anchor_hash) ON DELETE RESTRICT,
  ADD CONSTRAINT audit_logs_source_manifest_fk
  FOREIGN KEY (source_shard_id, source_manifest_hash) REFERENCES audit_manifests(shard_id, manifest_hash) ON DELETE RESTRICT;

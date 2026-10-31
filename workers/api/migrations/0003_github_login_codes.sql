-- One-time exchange codes for the GitHub OAuth browser redirect.
-- Raw codes are never stored; only SHA-256 hashes are persisted.
CREATE TABLE IF NOT EXISTS oauth_login_codes (
  id TEXT PRIMARY KEY,
  code_hash BLOB NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS oauth_login_codes_expiry_idx ON oauth_login_codes(expires_at);
CREATE INDEX IF NOT EXISTS oauth_login_codes_user_idx ON oauth_login_codes(user_id, created_at);

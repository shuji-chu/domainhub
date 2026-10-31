-- Record explicit acceptance of the current user agreement and privacy policy.
CREATE TABLE IF NOT EXISTS legal_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK(document_type IN ('terms','privacy')),
  document_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  UNIQUE(user_id, document_type, document_version),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS legal_consents_user_idx
  ON legal_consents(user_id, accepted_at DESC);

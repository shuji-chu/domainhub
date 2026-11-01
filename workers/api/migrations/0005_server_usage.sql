-- Per-user audit trail for DigitalOcean server lifecycle operations.
CREATE TABLE IF NOT EXISTS server_usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  droplet_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('power_on','power_off','reboot','rebuild','delete')),
  status TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS server_usage_events_user_created_idx
  ON server_usage_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS server_usage_events_droplet_idx
  ON server_usage_events(droplet_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tld_orders (
 id TEXT PRIMARY KEY,
 order_no TEXT NOT NULL UNIQUE,
 user_id TEXT NOT NULL,
 domain TEXT NOT NULL,
 provider TEXT NOT NULL DEFAULT 'spaceship',
 status TEXT NOT NULL,
 provider_operation_id TEXT,
 provider_response TEXT,
 provider_error TEXT,
 provider_status INTEGER,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_tld_orders_user_created ON tld_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tld_orders_domain_status ON tld_orders(domain, status);
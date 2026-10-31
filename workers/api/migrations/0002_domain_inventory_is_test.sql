ALTER TABLE domain_inventory ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK(is_test IN (0,1));
CREATE INDEX IF NOT EXISTS domain_inventory_test_status_idx ON domain_inventory(is_test,status);

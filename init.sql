-- DomainHub one-time bootstrap. Run only against the intended production D1 database.
-- Initial admin password: Admin123456! (change immediately after first login).
PRAGMA foreign_keys=ON;
INSERT INTO users(id,email,email_normalized,status,role,display_name,created_at,updated_at)
VALUES('dh-admin-boss','boss@lynli.me','boss@lynli.me','active','admin','DomainHub 管理员',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(email_normalized) DO UPDATE SET role='admin',status='active',updated_at=CURRENT_TIMESTAMP;
INSERT INTO credentials(id,user_id,password_hash,password_changed_at,password_version,created_at,updated_at)
SELECT 'dh-admin-boss-credential',id,'pbkdf2-sha256$210000$6dk91jAU2oNA2ptzFLVKpQ$wS9QWYoX8J03Us36p7c5c-AN4p9vPTr3KLEPJ6IUSbA',CURRENT_TIMESTAMP,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM users WHERE email_normalized='boss@lynli.me'
ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash,password_changed_at=CURRENT_TIMESTAMP,password_version=credentials.password_version+1,updated_at=CURRENT_TIMESTAMP;
INSERT OR IGNORE INTO roles(id,code,name,is_system) VALUES('role-admin','admin','管理员',1);
INSERT OR IGNORE INTO user_roles(id,user_id,role_id,reason) SELECT 'dh-admin-role',id,'role-admin','初始化管理员' FROM users WHERE email_normalized='boss@lynli.me';
INSERT OR IGNORE INTO quota_ledger(id,user_id,delta,source_type,idempotency_key,reason,created_at) SELECT 'dh-admin-initial-quota',id,100,'bootstrap','bootstrap:boss@lynli.me','管理员初始配额',CURRENT_TIMESTAMP FROM users WHERE email_normalized='boss@lynli.me';
INSERT INTO domain_inventory(id,zone_id,domain,status,source,is_test,created_at,updated_at) VALUES
('dh-test-inv-01','fake-zone-test-01','test1.de5.net','available','bootstrap-test',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('dh-test-inv-02','fake-zone-test-02','test2.cc.cd','available','bootstrap-test',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('dh-test-inv-03','fake-zone-test-03','test3.de5.net','available','bootstrap-test',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('dh-test-inv-04','fake-zone-test-04','test4.cc.cd','available','bootstrap-test',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('dh-test-inv-05','fake-zone-test-05','test5.de5.net','available','bootstrap-test',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(zone_id) DO UPDATE SET domain=excluded.domain,status='available',source='bootstrap-test',is_test=1,updated_at=CURRENT_TIMESTAMP;

# DomainHub 账号体系架构设计

> 设计稿，待负责人确认；本次仅提交文档，不实现业务接口。

## 1. 范围与原则

账号体系仅负责注册、邮箱验证、密码登录、会话、密码重置、GitHub OAuth 和审计。账号身份不自动获得域名额度或管理权限。所有授权由服务端校验，前端隐藏入口不构成安全控制。

明确不实现：域名领取、DNS 写入、TG 验证、支付/USDT、云服务器产品或开通。

## 2. 服务端技术栈与部署形态

**建议技术栈：** Node.js 22 LTS + TypeScript + NestJS（Fastify adapter）；Prisma 管理 PostgreSQL schema 与迁移；PostgreSQL 16+ 作为唯一持久化事实来源；Redis 可选，用于跨实例限流计数和短时挑战状态。邮件通过 SMTP 适配层异步发送。结构化 JSON 日志、request_id、健康检查和错误追踪必须过滤凭据。

**DigitalOcean：** 推荐 App Platform Web Service + Managed PostgreSQL，按需增加 Managed Redis。应用通过私网连接数据库；生产入口 HTTPS；数据库启用备份/PITR（套餐支持时）。需要更细网络控制时可用 Droplet + Docker Compose，但数据库仍建议托管。多实例共享 PostgreSQL session store；限流使用 Redis 原子操作。仅信任明确配置的反向代理跳数，不盲信任任意 X-Forwarded-For。

## 3. 数据库表结构

统一使用 UUID 主键、UTC timestamptz、created_at/updated_at。邮箱 trim 后按统一规则规范化；不擅自折叠 Gmail 点号或加号。以下为逻辑结构，实施时用 Prisma migration 建立索引、外键和 CHECK/enum 约束。

### users

| 字段 | 类型 | 约束 / 说明 |
|---|---|---|
| id | uuid | PK |
| email | citext | NOT NULL |
| email_normalized | text | NOT NULL UNIQUE |
| email_verified_at | timestamptz | NULL 表示未验证 |
| status | text | NOT NULL：pending_verification / active / suspended / deleted |
| role | text | NOT NULL DEFAULT user；仅服务端可改 |
| display_name | text | NULL |
| created_at / updated_at | timestamptz | NOT NULL |
| last_login_at | timestamptz | NULL |
| deleted_at | timestamptz | NULL，软删除 |

email_normalized 唯一；status、role 加 CHECK/enum。用户删除时按保留政策匿名化，不能因级联删除审计记录。

### credentials

| 字段 | 类型 | 约束 / 说明 |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK users(id)，NOT NULL UNIQUE |
| password_hash | text | NOT NULL，Argon2id PHC 字符串 |
| password_changed_at | timestamptz | NOT NULL |
| password_version | integer | NOT NULL DEFAULT 1 |
| created_at / updated_at | timestamptz | NOT NULL |

不存明文、可逆加密密码或密码提示。MFA 将来单独建表。

### sessions

| 字段 | 类型 | 约束 / 说明 |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK users(id)，NOT NULL |
| token_hash | bytea | NOT NULL UNIQUE，session secret 的 SHA-256 |
| created_at / last_seen_at | timestamptz | NOT NULL |
| expires_at | timestamptz | NOT NULL，建索引 |
| revoked_at | timestamptz | NULL |
| ip_prefix | inet | NULL，按隐私政策截断 |
| user_agent_hash | bytea | NULL |
| password_version | integer | NOT NULL，创建时复制凭据版本 |

Cookie 只携带高熵随机值，数据库不存原始值。密码修改/重置、冻结账号时撤销会话。清理过期和已撤销记录。

### email_verification_tokens

| 字段 | 类型 | 约束 / 说明 |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK users(id)，NOT NULL |
| token_hash | bytea | NOT NULL UNIQUE |
| created_at / expires_at | timestamptz | NOT NULL，expires_at 建索引 |
| consumed_at | timestamptz | NULL |
| request_ip_prefix | inet | NULL |

使用 CSPRNG 生成至少 32 字节随机 token，数据库只存 SHA-256(token)。有效期 30 分钟；事务内检查未过期、未消费，再更新用户验证状态并写 consumed_at。重复点击不能重复触发副作用。

### password_reset_tokens

包含 id、user_id FK、token_hash UNIQUE、created_at、expires_at（建议 20 分钟）、consumed_at、request_ip_prefix，以及 credential_password_version（发起时的密码版本）。token 同样一次性、至少 32 字节随机、仅存哈希。重置成功在一个事务内消费 token、更新密码哈希、递增 password_version、撤销该用户全部 sessions 并写审计。

### oauth_accounts

| 字段 | 类型 | 约束 / 说明 |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK users(id)，NOT NULL |
| provider | text | NOT NULL，当前仅 github |
| provider_user_id | text | NOT NULL |
| provider_login | text | NULL，仅展示 |
| provider_email | citext | NULL，不默认视为已验证 |
| created_at / updated_at | timestamptz | NOT NULL |
| last_used_at | timestamptz | NULL |

(provider, provider_user_id) 唯一；user_id 建索引。默认不持久化 GitHub access token；若未来确有必要，须 KMS/服务端加密并单独评审。未经验证的 OAuth 邮箱不得自动合并本地账号。

### audit_logs

| 字段 | 类型 | 约束 / 说明 |
|---|---|---|
| id | uuid | PK |
| occurred_at | timestamptz | NOT NULL，默认 now()，分区/索引键 |
| actor_user_id / target_user_id | uuid | NULL，关联 users |
| action | text | NOT NULL，如 auth.login.failed |
| outcome | text | NOT NULL：success / failure / blocked |
| request_id | text | NULL |
| ip_prefix | inet | NULL |
| user_agent_hash | bytea | NULL |
| metadata | jsonb | NOT NULL DEFAULT {}，仅白名单字段 |
| risk_score | smallint | NULL |

索引 occurred_at、(actor_user_id, occurred_at)、(action, occurred_at)。高写入量按月分区。追加写入，不开放普通更新接口。

## 4. 密码哈希方案

采用 Argon2id，建议初始参数：memory cost 65536 KiB（64 MiB）、time cost 3、parallelism 1、salt 16 字节独立随机、输出 32 字节，使用 PHC 字符串保存算法和参数。上线前在目标 DO 实例压测，单次验证目标约 200–500ms，并限制并发哈希任务防止内存耗尽。新密码建议至少 12 字符，允许长密码和密码管理器粘贴，拒绝常见泄露密码；登录成功后可渐进重哈希升级参数。

## 5. 会话与 CSRF

**选择服务端 Session，不选浏览器 JWT。** Cookie 名称建议 __Host-domainhub_session，属性 HttpOnly、Secure、SameSite=Lax、Path=/，不设置 Domain；生产强制 HTTPS。session secret 由 CSPRNG 生成至少 32 字节，数据库只存 SHA-256 哈希。登录后轮换 session ID；退出时服务端撤销并清除 Cookie。建议空闲超时 30 分钟、绝对有效期 7 天；高风险操作要求重新验证密码。每次请求检查 session、用户状态和 password_version。

CSRF 使用 session 绑定的同步器 token：同源接口获取，写请求通过 X-CSRF-Token 提交，服务端常量时间比较；同时校验 Origin/Referer 白名单。SameSite=Lax 是纵深防御，不能替代 CSRF token。CORS 只允许明确前端源且不得任意来源携带凭据。OAuth state 独立于普通 CSRF token。

## 6. 邮箱验证与密码重置

- Token 至少 32 字节随机、URL-safe 编码；数据库只存 SHA-256 哈希，原文仅通过邮件链接发送一次。
- 邮箱验证有效期 30 分钟；密码重置 20 分钟；一次性消费，过期/重放均失败。
- 重新发送时使同用途旧 token 失效；成功消费与状态更新放在同一事务。
- 注册响应对新邮箱和已存在邮箱保持一致；密码重置始终返回“如果该邮箱对应可用账号，我们会发送邮件”。
- 发信异步排队；失败不向客户端泄露账号状态。未验证账号可在 7 天后清理。
- 不在日志、追踪、审计 metadata 中记录原始 token、完整链接或邮件正文。

## 7. GitHub OAuth

采用 Authorization Code Flow。服务端生成至少 256-bit 随机 state，保存 5–10 分钟并一次性校验；建议启用 PKCE S256。回调 URI 必须与 OAuth App 登记的 HTTPS URI 完全匹配，服务端固定白名单，不接受任意 redirect_uri、通配符或开放重定向。最小 scope 优先 read:user、user:email；若只需公开资料则进一步缩小，不申请 repo/workflow/admin。code 仅由服务端交换。登录成功后轮换 session。账号关联必须由已登录用户主动发起并重新验证当前身份，不按未经验证邮箱自动合并。client secret 永不进入浏览器。

## 8. 限流策略

服务端双维叠加：IP + 规范化账号。推荐 Redis 原子计数（滑动窗口/token bucket），无 Redis 时以 PostgreSQL 原子 upsert 降级。账号 key 使用 HMAC 派生标识，不把明文邮箱写入 Redis key。正确配置可信代理，禁止信任任意 X-Forwarded-For。

| 场景 | IP 维度 | 账号维度 | 其他 |
|---|---|---|---|
| 注册 | 5 次/小时，20 次/天 | 每邮箱 3 次/天 | 蜜罐；风险触发 CAPTCHA |
| 登录 | 10 次/10 分钟，50 次/天 | 5 次/15 分钟 | 指数退避；失败提示统一 |
| 验证邮件 | 5 次/小时，10 次/天 | 每邮箱 3 次/小时、5 次/天 | 60 秒重发冷却 |
| 重置邮件 | 5 次/小时 | 每邮箱 3 次/小时 | 对外响应一致 |

超限返回统一限流响应和 Retry-After。根据实际流量调整阈值，避免共享 NAT 误伤；必要时叠加设备、ASN、验证码风险信号。

## 9. 审计日志与保留

记录注册、邮箱验证、登录成功/失败、退出、密码修改/重置、OAuth 开始/回调/关联解绑、会话撤销、账号冻结、权限变化、限流拦截。字段至少包括时间、actor、target、action、outcome、request_id、IP 前缀、UA 哈希、risk_score、白名单 metadata。

绝不记录密码/密码哈希、Cookie、Authorization header、OAuth code/access token、邮件 token、完整重置链接或任何密钥。建议安全审计保留 365 天；认证失败明细保留 90 天后聚合或删除；运维访问日志 30–90 天。上线前按运营地法律与隐私政策复核。日志只允许授权运维读取，访问本身也需审计；支持按月归档和静态加密。

## 10. 环境变量清单（仅变量名）

以下只列名称，不提供值。所有 secret 仅放 DigitalOcean App Platform Secrets / Droplet secret manager，不写入仓库、前端构建参数或客户端日志。

**服务端：**
- NODE_ENV
- PORT
- PUBLIC_APP_URL
- TRUSTED_PROXY_HOPS
- DATABASE_URL
- REDIS_URL（可选）
- SESSION_COOKIE_NAME
- SESSION_IDLE_TIMEOUT_SECONDS
- SESSION_ABSOLUTE_TIMEOUT_SECONDS
- SESSION_HASH_PEPPER
- CSRF_SECRET
- TOKEN_HASH_PEPPER

**邮件：**
- SMTP_HOST
- SMTP_PORT
- SMTP_SECURE
- SMTP_USERNAME
- SMTP_PASSWORD
- MAIL_FROM
- MAIL_REPLY_TO

**GitHub OAuth：**
- GITHUB_OAUTH_CLIENT_ID
- GITHUB_OAUTH_CLIENT_SECRET
- GITHUB_OAUTH_CALLBACK_URL
- GITHUB_OAUTH_ALLOWED_REDIRECTS

**安全与运维：**
- RATE_LIMIT_HMAC_KEY
- LOG_LEVEL
- AUDIT_RETENTION_DAYS
- SENTRY_DSN（可选，须过滤敏感字段）

VITE_ 前缀变量会进入浏览器构建产物，只能放非敏感公开配置；以上任何 secret 均不得使用 VITE_ 前缀。

## 11. 分阶段实施与验收标准

| 阶段 | 范围 | 验收标准 |
|---|---|---|
| A 基础设施 | NestJS 骨架、PostgreSQL migration、健康检查、结构化日志 | 空库可从零迁移；迁移可重复部署；应用启动不自动执行破坏性迁移；secret 仅服务端读取 |
| B 注册验证 | 注册、邮件队列、一次性验证 token、未验证账号清理 | 原始 token 不落库；过期/重放失败；响应不泄露邮箱是否存在；IP 与账号双维限流 |
| C 登录会话 | Argon2id、服务端 session、Cookie、CSRF、轮换/撤销 | Cookie 属性正确；session fixation 测试通过；CSRF 缺失/错误请求被拒；退出立即失效；密码变更撤销旧 session |
| D 密码重置 | 统一响应、一次性 token、密码版本递增 | 未知/已知邮箱响应一致；token 过期/重放失败；重置后旧密码和旧 session 失效 |
| E GitHub OAuth | state、PKCE、回调白名单、最小 scope、显式账号关联 | state 缺失/错误/重放失败；任意 redirect 被拒；secret 不在浏览器产物；邮箱不可信时不自动合并 |
| F 上线加固 | Redis 限流、审计保留、备份恢复、告警、安全测试 | 双维限流生效；审计无敏感凭据；恢复演练通过；HTTPS/Cookie/CORS/CSRF/代理 IP 检查通过 |

## 12. 明确不在本阶段实现

不包含域名领取或库存预留、DNS 记录写入、TG 群组/机器人验证、支付/USDT、云服务器购买或开通。上述功能必须另行设计并经负责人确认后再排期。


## 13. P0 补充决策（本节优先于前文未定案内容）

本节为明确设计决策，不代表已创建数据库表、索引、Redis 实例或业务接口。

### 13.1 RBAC：采用关系表

采用 roles、permissions、role_permissions、user_roles 四张关系表，不再以 users.role 单字段作为最终授权来源；旧字段仅作迁移兼容。系统角色固定为 user、admin、super_admin，不允许删除。

| 角色 | 权限范围 |
|---|---|
| user | 仅访问自己的资料、凭据、会话和 OAuth 关联 |
| admin | 读取脱敏账号支持信息；冻结/恢复普通账号；撤销用户会话；读取脱敏审计视图 |
| super_admin | 管理角色分配、角色权限和安全配置；执行高风险管理操作 |

权限点采用 resource.action：
- user.read_self、user.update_self、session.read_self、session.revoke_self、oauth.link_self、oauth.unlink_self；
- admin.user.read、admin.user.suspend、admin.user.restore、admin.session.revoke、admin.audit.read；
- rbac.role.read、rbac.role.assign、rbac.role.revoke、rbac.permission.manage；
- security.config.read、security.config.update。

admin 不得读取密码哈希、原始 session/token、OAuth secret；不得修改邮箱归属、验证状态、密码或 MFA；不得授予/撤销角色、修改权限或安全配置。普通用户资料接口必须拒绝 role/roles/permissions 字段。admin 不能自提权，也不能通过批量操作间接提权。只有受控授权服务允许写 user_roles/role_permissions；应用普通运行数据库角色不应直接拥有这些表的写权限。super_admin 的授权变更需重新认证、填写原因并审计操作者、目标、变更前后角色及 request_id；建议双人复核，至少保留两名受控 super_admin。

逻辑字段：roles(id, code UNIQUE, name, is_system, created_at)；permissions(id, code UNIQUE, description)；role_permissions(role_id, permission_id, PRIMARY KEY(role_id, permission_id))；user_roles(user_id, role_id, granted_by_user_id, granted_at, revoked_at, reason)。有效 user_roles 对同一 user/role 只能一条，使用部分唯一索引或事务约束。为 user_roles(user_id, revoked_at)、role_permissions(role_id) 建索引。授权默认拒绝，所有权限由服务端检查。

### 13.2 OAuth state：PostgreSQL 持久化并绑定浏览器

state 使用 PostgreSQL 表作为一次性事实来源，Redis 只能作为可选缓存，不能依赖进程内存。生成至少 32 字节 CSPRNG state，数据库只存 SHA-256(state)。oauth_states 逻辑字段：id UUID PK、state_hash BYTEA UNIQUE NOT NULL、browser_binding_hash BYTEA NOT NULL、purpose（login/link）、user_id nullable FK、pkce_verifier_encrypted BYTEA、redirect_key、created_at、expires_at、consumed_at、request_ip_prefix。索引 state_hash 唯一、expires_at、(user_id, created_at)。有效期固定 10 分钟。

发起前设置独立临时 Cookie __Host-domainhub_oauth_bind，至少 32 字节随机值，HttpOnly、Secure、SameSite=Lax、Path=/、不设 Domain，最长 10 分钟。数据库只存其 SHA-256 哈希。link 流程同时记录发起用户和当前 session 标识哈希。callback 必须同时匹配 state 与原浏览器 Cookie，常量时间比较；缺失、错配、过期、已消费均拒绝。数据库事务用条件更新（consumed_at IS NULL AND expires_at > now()）原子消费，只有成功更新一行才继续。link callback 还必须确认当前 session 仍有效且 user_id 与发起时一致；退出、换用户或 session 轮换后拒绝。callback URI 固定 HTTPS；redirect_key 只映射服务端白名单，不接受任意 redirect 参数。PKCE S256 必须启用。此机制防止将攻击者浏览器发起的 OAuth 回调替换到受害者浏览器。

### 13.3 并发 Session 上限

每账号最多 5 个活跃 session。活跃定义：revoked_at IS NULL、idle_expires_at > now()、absolute_expires_at > now()，用户 active 且 password_version 匹配。超限策略为拒绝新登录，不静默踢出最旧设备；提示用户进入会话管理页主动撤销旧 session 后重试。后续若增加踢出交互，必须由用户明确选择。

创建 session 前，在同一事务对 user_id 获取事务级 advisory lock（或锁用户行），重新查询活跃数，再插入，避免并发竞态。查询示意：SELECT id, created_at, last_seen_at FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND idle_expires_at>now() AND absolute_expires_at>now() ORDER BY last_seen_at DESC。索引建议 sessions(user_id, revoked_at, idle_expires_at, absolute_expires_at) 和 sessions(user_id, last_seen_at DESC)，保留 token_hash UNIQUE。动态过期时间不得写入使用 now() 的部分索引谓词。

### 13.4 Session 续期

以 idle_expires_at 和 absolute_expires_at 替代原 expires_at。idle_expires_at 初始为创建时间 + 30 分钟；absolute_expires_at 初始为创建时间 + 7 天，创建后永不延长。保留 created_at、last_seen_at、revoked_at。

采用节流续期：每个请求仍检查撤销、用户状态、password_version，以及 now() 同时早于两个期限；但仅当距上次续期至少 5 分钟时写数据库。更新 last_seen_at=now()，idle_expires_at=LEAST(now()+30 minutes, absolute_expires_at)。未达到 5 分钟窗口不写数据库。多实例用条件 UPDATE 保证并发安全。absolute_expires_at 到期必须重新登录，任何续期不得延长 7 天绝对期限。高风险操作仍要求重新认证。

### 13.5 audit_logs 防篡改与删除保留

应用运行数据库角色对 audit_logs 仅授予 INSERT，不授予 UPDATE、DELETE、TRUNCATE、ALTER、DROP 或表所有者权限；读取使用独立只读角色；迁移使用独立部署身份。分区表各分区也必须维持相同权限边界，应用角色不得绕过父表直接改分区。

采用哈希链：entry_hash = SHA-256(chain_id || sequence_no || occurred_at || canonical_event || previous_hash)。通过 audit_chain_heads 单行链头在事务中加锁、分配 sequence_no、插入事件并推进链头，确保并发顺序一致。普通应用角色不能直接改链头。至少每日将链头由独立密钥管理系统签名，并将事件批次、链头、签名、行数、首尾序号及校验清单写入独立启用对象锁/WORM 的归档存储。定期重算哈希链并校验签名，任何缺口、重排、修改或归档失败均告警。哈希链本身不能抵御数据库完全控制者重写整链，因此外部签名和不可变归档不可省略。

audit_logs.actor_user_id、target_user_id 外键使用 ON DELETE SET NULL，禁止级联删除。另保存不含个人信息的 actor_ref（例如用户 UUID 的不可逆 HMAC 派生标识）及 actor_type。用户软删除/匿名化后 actor_user_id 可置 NULL，但 actor_ref、事件、哈希链及归档仍保留。不得冗余存储邮箱、姓名；如依法需处理可识别 metadata，应通过隐私处理事件记录，不得静默破坏链条。按月加密归档，建议安全审计保留至少 365 天，具体按运营地法律复核。

### 13.6 生产迁移流程

Prisma migration 目录命名使用 UTC 时间戳 + snake_case 描述，例如 20261101123000_add_session_expiry_columns/migration.sql。每个迁移入库审查，说明可逆性、锁表风险、预计耗时、回填策略和恢复方案。

生产只由受控发布 job 使用独立 migration 数据库身份执行 npx prisma migrate deploy；禁止应用启动时自动迁移，禁止生产执行 prisma migrate reset，禁止手工执行未入库 SQL。流程：CI 在临时空库执行全量迁移，并在最近生产快照副本演练升级；发布前检查数据库健康、磁盘和连接数，创建并验证迁移前快照或 pg_dump --format=custom 备份；执行 migrate deploy；成功后再滚动发布应用。采用 expand-and-contract 保持新旧版本兼容，先加字段/索引，再切换读写，最后单独清理旧结构。

不承诺所有迁移均可自动 down。优先 forward fix 或回滚应用版本；破坏性数据变更无法安全逆转时，暂停写入并按审批流程从迁移前快照/PITR 恢复到隔离环境，核对数据损失窗口后决定切换。不得未经演练直接回滚已执行 DDL。保存迁移版本、操作者、发布号、日志和耗时。

### 13.7 限流：生产强制 Redis

多实例生产的认证限流强制依赖 Redis，使用 Lua 或等价原子操作实现 IP + 账号双维计数。PostgreSQL 原子 upsert 不作为高频认证限流的常规降级：热点行锁竞争、WAL/索引写放大和连接池压力会在高并发时拖慢认证数据库。

Redis 故障时，注册、登录、验证邮件、密码重置等敏感入口 fail-closed，返回可重试的 503，不绕过限流继续处理。进程内 emergency ceiling 只能作为短时附加保护，不是跨实例安全控制。单实例开发环境可用内存计数器，生产不得使用。PostgreSQL 仅可用于低频管理计数或经容量测试的临时方案，不作为 P0 限流保障。

### 13.8 provider_email 唯一性与冲突

同一已验证 GitHub 邮箱不得绑定到多个本地账号。真正身份主键始终是 (provider, provider_user_id)，一个 GitHub 身份只能绑定一个本地账号。邮箱相同不得触发自动登录、合并或绑定；未验证的 GitHub 邮箱不参与匹配、不覆盖本地邮箱。

设计 schema 时增加 provider_email_normalized、provider_email_verified；对 verified=true 且非空的规范化邮箱建立唯一约束/部分唯一索引。当前仅有 provider_email 的字段不足以可靠表达验证状态，实施 migration 前必须补齐。已验证邮箱冲突时拒绝绑定并进入支持流程，不得以邮箱相同绕过凭据。关联仍要求已登录用户主动发起、重新认证及 OAuth state 浏览器绑定。

### 13.9 CSRF token 获取接口的 Origin 校验

获取 CSRF token 的接口自身也必须校验来源：Origin 必须与配置的前端源精确匹配 scheme、host、port；不得后缀匹配、通配符或反射 Origin。Origin 缺失时检查 Referer origin；二者均缺失或不匹配的浏览器请求拒绝。Sec-Fetch-Site: cross-site 必须拒绝。响应设置 Cache-Control: no-store，CORS 只允许精确可信源。token 绑定当前 session；匿名流程使用独立短期匿名会话 Cookie，不签发通用 token。写请求仍校验 Origin/Referer、token、session 三者一致。失败审计不得包含 token/cookie。

## 14. P0 补充验收清单

- RBAC：三种角色权限矩阵通过测试；admin 无角色管理权限；普通资料接口无法自提权。
- OAuth：state 绑定原浏览器、10 分钟过期、原子一次性消费；跨浏览器替换、重放及 link session 变化均失败。
- Session：最多 5 个活跃会话；第 6 个拒绝；并发登录不超限；idle 30 分钟、每 5 分钟最多续期写一次、absolute 7 天不可延长。
- Audit：应用角色只有 INSERT；哈希链、外部签名、WORM 归档验证通过；用户删除不级联丢失审计。
- Migration：空库与快照升级演练通过；生产仅受控 job 执行 migrate deploy；备份可恢复；应用启动不迁移。
- Rate limit：生产 Redis 故障时敏感入口 fail-closed。
- OAuth email：已验证邮箱跨本地账号冲突拒绝；未验证邮箱不参与匹配。
- CSRF：token 获取接口拒绝不可信 Origin、跨站请求和无来源浏览器请求。

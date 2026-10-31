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


## 15. P0 最终实施细节（本节覆盖第 13 节相应条款）

本节进一步收敛 RBAC 权限矩阵、审计哈希链写入/校验/归档、审计主体外键和会话管理产品兜底。仍然只是设计文档；不表示已创建 schema、API 或页面。

### 15.1 RBAC 最终权限矩阵与 users.role 处置

**最终授权模型：只以四张 RBAC 关系表为准。** users.role 是历史单角色字段，不作为缓存，不参与授权判断。迁移期先将现有 role 值映射到 user_roles；完成数据核对后，将 users.role 标记为 deprecated 并在后续独立 migration 删除。不得长期双写 users.role 与 user_roles，避免权限分歧。新用户只创建 user 角色关联；所有授权决策从 user_roles → roles → role_permissions → permissions 读取，默认拒绝。角色分配变更必须审计。

固定角色：
- user：普通用户自身资源权限。
- admin：受限运营支持权限，不具备授权管理权限。
- super_admin：最高管理权限，可管理 RBAC 和安全策略；高风险动作必须重新认证、填写原因并审计。

权限点采用 resource.action。以下为本阶段权限注册表；未列出的动作一律无权执行。

| 资源 | 权限点 | admin | super_admin | 边界 |
|---|---|---:|---:|---|
| 用户 | admin.user.read | 允许 | 允许 | 仅必要资料，敏感字段脱敏 |
| 用户 | admin.user.suspend / admin.user.restore | 允许 | 允许 | admin 只能封禁/恢复普通 user；不得封禁 admin/super_admin |
| 用户 | admin.user.delete | 禁止 | 禁止 | 用户删除走独立隐私流程，不作为后台按钮 |
| 配额 | admin.quota.read | 允许 | 允许 | 只读查看当前配额与变更记录 |
| 配额 | admin.quota.adjust | 允许（受限） | 允许 | admin 仅能在已批准的运营上下限内调整普通用户配额，必须填写原因；超出上限、负向/批量异常调整需 super_admin 审批 |
| 订单 | admin.order.read | 允许 | 允许 | 只读查看订单状态、金额摘要和关联用户；支付凭据/密钥脱敏 |
| 订单 | admin.order.refund / admin.order.cancel / admin.order.mark_paid | 禁止 | 禁止（本阶段） | 支付/退款业务未设计，不得伪造订单状态或手工标记已支付 |
| 域名 | admin.domain.read / admin.domain.status.read | 允许 | 允许 | 只读查看域名记录、审核状态和状态变更历史 |
| 域名 | admin.domain.status.update | 禁止（本阶段） | 禁止（本阶段） | 本阶段不实现域名领取、库存、DNS 或域名状态写操作 |
| 域名 | admin.domain.claim / admin.dns.write | 禁止 | 禁止 | 明确不在账号体系范围 |
| 会话 | admin.session.read / admin.session.revoke | 允许 | 允许 | 只可查看必要设备摘要并撤销目标用户 session；不能读取原始 token |
| 审计 | admin.audit.read | 允许 | 允许 | 只读脱敏视图；不得导出秘密字段或更改审计数据 |
| RBAC | rbac.role.read | 禁止 | 允许 | admin 不得查看或管理内部授权配置 |
| RBAC | rbac.role.assign / rbac.role.revoke / rbac.permission.manage | 禁止 | 允许 | super_admin 操作需重新认证、原因、审计；建议双人复核 |
| 安全配置 | security.config.read / security.config.update | 禁止 | 允许 | secret 值不可回显；更新需审计与重新认证 |
| 自身账号 | user.read_self / user.update_self | 仅本人 | 仅本人 | 不可修改角色、状态、配额或其他用户资料 |
| 自身会话 | session.read_self / session.revoke_self | 仅本人 | 仅本人 | 用户可撤销自己的其他设备 session |
| OAuth | oauth.link_self / oauth.unlink_self | 仅本人 | 仅本人 | 需重新认证并验证 OAuth state |

**admin 配额调整限制：** 本表只定义权限边界，不定义任何具体产品配额、计费或域名额度规则。配额调整必须记录 before/after、单位、原因、操作者、目标用户、request_id；不能通过普通用户资料接口修改。admin 不可调整管理员账号配额。super_admin 可管理策略上限，但不得借此绕过未来独立的产品/财务审批规则。

**数据库约束：** roles、permissions、role_permissions、user_roles 仍是唯一授权关系。普通 Web 应用 DB role 不应拥有 user_roles/role_permissions 的直接 INSERT/UPDATE/DELETE 权限；授权写操作经受控服务路径执行。用户注册 DTO/更新 DTO 不包含 role 字段，服务端拒绝客户端传入 role、roles、permissions、status 等受保护字段。

### 15.2 audit_logs 哈希链：最终字段、写入和校验流程

**最终 audit_logs 追加字段：**
- chain_id UUID NOT NULL：链标识；单链部署可固定一个链 ID。
- sequence_no BIGINT NOT NULL：链内顺序号；对 (chain_id, sequence_no) 建 UNIQUE。
- prev_hash BYTEA NOT NULL：上一条事件 entry_hash；首条使用固定 genesis hash。
- entry_hash BYTEA NOT NULL：当前事件哈希。
- actor_ref TEXT NOT NULL：匿名稳定主体标识；不含邮箱、姓名等个人信息。
- actor_type TEXT NOT NULL：user、admin、super_admin、system、anonymous 等受控枚举值。

原字段 actor_user_id、target_user_id 保留为可空 UUID 外键；最终 FK 均为 ON DELETE SET NULL。用户软删除时不删除审计行，匿名化时可将 actor_user_id 置 NULL，actor_ref 保留用于关联同一匿名主体。target_user_id 同理可置 NULL；如需保留目标关联，也使用不含直接身份信息的 target_ref。禁止 ON DELETE CASCADE。

**prev_hash 的生成责任：** prev_hash 和 entry_hash 均由服务端审计写入模块在 INSERT 前计算，并作为 INSERT 字段写入 audit_logs；数据库不依赖触发器替应用补算，也不允许应用先插空值再回填。规范化事件内容使用固定 canonical JSON 序列化（字段排序、UTF-8、时间统一 UTC、数字格式稳定），entry_hash = SHA-256(chain_id || sequence_no || occurred_at || canonical_event || prev_hash)。哈希字段使用固定长度 BYTEA。

**并发写入串行化：** 审计写入模块在同一数据库事务开始时取得固定 chain_id 对应的事务级 advisory lock；取得锁后读取该链最新一条 audit_logs 的 sequence_no 和 entry_hash，生成下一 sequence_no、prev_hash、entry_hash，再执行单条 INSERT 并提交。由于锁持有至事务结束，同一链的并发写入会串行，不会产生分叉。可用数据库 sequence 分配 sequence_no，但必须接受回滚造成的编号空洞；校验逻辑以 prev_hash 链接关系为准，不要求 sequence_no 连续。若采用 sequence，仍必须在 advisory lock 下读取上一条已提交哈希。应用角色只有 INSERT 权限；读取链尾需要单独授予 audit writer 最小 SELECT 权限（仅允许读取 chain_id、sequence_no、entry_hash），不得授予 UPDATE/DELETE。更严格部署可把读取链尾封装在受控 SECURITY DEFINER 函数中，但函数不得提供修改/删除能力。

**校验任务：**
- 每小时由独立调度器触发一次完整在线链校验；小规模可用 Kubernetes CronJob / DigitalOcean 定时任务 / 外部 CI scheduler，生产推荐独立 worker + scheduler，不依赖 Web 实例存活。
- 每次校验从最近一次已签名检查点开始，重算 canonical event、prev_hash 和 entry_hash，验证 sequence 顺序、唯一性及链头一致性。
- 每日 UTC 02:00 生成全量/分区校验报告与签名检查点；校验失败、缺行、链断裂、哈希不符或任务连续两次未运行时，向运维告警并冻结归档成功标记。
- 每次归档前必须再次校验待归档分区；恢复演练时从归档对象独立验证签名与哈希链。

**WORM 目标与保留：** 生产归档目标明确采用 AWS S3 Bucket + S3 Object Lock，启用版本控制和默认 Compliance mode retention；每日写入加密归档对象（SSE-KMS），对象名按环境/年月/分区/批次生成，写入后禁止覆盖或删除。归档保留期设为 **7 年**；如运营地法律要求更长则从其规定，若法律要求更短则先经法律/隐私审查后调整。签名私钥由独立 KMS/HSM 管理，不能与应用数据库权限共用。R2 可作为普通副本或跨区域副本，但本设计不把它作为唯一 WORM 合规归档目标。归档读取必须独立授权并记录访问审计。

### 15.3 actor_user_id 最终外键定义

最终定义明确为：
- audit_logs.actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL；
- audit_logs.target_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL；
- audit_logs.actor_ref TEXT NOT NULL；
- audit_logs.actor_type TEXT NOT NULL；
- 可选 target_ref TEXT NULL，用于目标用户删除后仍保留匿名关联。

不采用级联删除，也不强制保留已删除用户的 users 行。创建审计事件时即生成 actor_ref：登录用户使用服务端 HMAC_KEY 对稳定内部 user UUID 派生；匿名/系统事件使用对应主体类型和不可逆标识。HMAC 密钥轮换需保留 key version 标记（例如 actor_ref_key_version），但不得将密钥写入数据库。用户删除或匿名化不修改既有哈希链内容；必要的隐私处理以新的审计事件表达。

### 15.4 会话管理页面与接口：超限自助处理

**产品页面：** 在账户安全设置中提供“会话管理”页面，列出当前账号全部有效 session，字段仅展示：
- 当前设备标记（当前会话显示“本设备”）；
- 设备/浏览器摘要（由 user_agent 解析后截断，不显示完整原始 UA）；
- 最近活动时间 last_seen_at；
- 创建时间 created_at；
- 大致 IP 前缀/地区提示（按隐私政策；不展示精确地址）；
- 空闲过期时间和绝对过期时间；
- 当前会话标记及“退出此设备”操作。

列表按最近活动时间倒序。页面顶部显示活跃设备数量与上限 5。用户可撤销任意一个非当前 session，也可撤销当前 session（撤销后清 Cookie 并跳转登录页）；提供“退出其他所有设备”按钮，保留当前 session。不要向前端暴露 session token、token_hash、内部风控秘密或可用于接管会话的凭据。

**接口设计（仅设计，不实现）：**
- GET /api/v1/me/sessions：需要有效登录 session；返回当前用户自己的 session 摘要、current_session_id、active_count、max_active_sessions=5。只返回当前 user_id 的记录。
- DELETE /api/v1/me/sessions/:sessionId：需要有效登录 session + CSRF token + 精确 Origin 校验；服务端从认证上下文取得 actor_user_id，并在 SQL 条件中同时限定 sessionId 与 user_id=actor_user_id。不能接受客户端传入 actor_user_id。撤销目标 session 后清理对应 Cookie 仅在撤销的是当前 session 时执行。
- POST /api/v1/me/sessions/revoke-others：需要有效登录 session + CSRF + Origin 校验；只撤销 user_id=当前用户且 id 不等于当前 session 的其他会话。
- 对 session 列表不允许通过 IDOR 查询其他用户 session；不存在与不属于当前用户的 session 对外返回相同结果，避免枚举。

**审计要求：** 每次撤销写入 audit_logs：
- action=session.revoke_self，target_user_id 为本人，metadata 包含被撤销 session 的内部 ID、是否当前会话、原因类别（user_device_management）；
- 批量撤销使用 action=session.revoke_others，记录数量及 session ID 列表的不可逆摘要，不记录 token 或 token_hash；
- 管理员代用户撤销仍使用独立 action=session.revoke_admin，记录 admin actor、目标用户、原因和工单号；必须具备 admin.session.revoke 权限并重新认证。
- 用户撤销当前 session 后，审计事件必须先成功提交，再清除 Cookie 并返回成功；审计写入失败时撤销操作失败关闭，不允许静默完成而无审计。

**与登录超限衔接：** 第 6 个并发登录被拒时，认证响应提供明确错误码 SESSION_LIMIT_REACHED，并引导用户登录已有设备打开会话管理页，撤销旧设备后再登录。若用户已无法访问旧设备，不提供绕过上限的匿名接口；走邮箱验证后的安全恢复流程（另行设计）或人工支持。不可在未认证状态下按用户提交的 sessionId 踢设备。

## 16. 本轮验收补充

- RBAC：users.role 在迁移完成后废弃并删除，不作缓存；权限矩阵未列出的操作默认拒绝；admin 无法操作管理员账号、支付状态或域名写状态。
- Audit：prev_hash、entry_hash 在 INSERT 前由服务端写入；链写入串行化；每小时校验、每日签名归档；S3 Object Lock Compliance mode 保留 7 年。
- Actor FK：actor_user_id/target_user_id 均 ON DELETE SET NULL；actor_ref/actor_type 保留匿名关联。
- Sessions：用户可查看自己的会话并主动撤销设备；所有接口校验当前 session、user_id 归属、CSRF 和 Origin；撤销行为先审计后成功。


## 17. 本轮兜底设计修订（优先于第 15.2、15.4 节及第 16 节中对应旧条款）

本节仅修订设计决策，不创建或修改业务代码、数据库 schema、迁移、云资源或存储桶。

### 17.1 审计哈希链按 UTC 小时分片并发写入

**分片模型：** 将原先单一全局链改为按服务端首次接收时间对应的 UTC 小时建立独立链分片。每个分片使用稳定的 shard_id（格式 YYYYMMDDHH，UTC）和独立 chain_id；分片内 sequence_no 从 1 递增，(chain_id, sequence_no) 唯一。事件写入后不得因客户端时间或后续修正而迁移分片。业务发生时间可另存用于展示，但不能改变分片归属。

**锁粒度：** advisory lock key 由固定命名空间与 shard_id 经稳定 64-bit 哈希导出。同一小时写入取得同一事务级 advisory lock，不同小时使用不同 lock key；取得锁后只读取该小时分片链尾、分配 sequence_no、计算 prev_hash/entry_hash 并 INSERT，锁持有至事务提交。分片表/链头仍以完整 shard_id/chain_id 为唯一事实标识，lock key 只用于互斥；若 64-bit 哈希碰撞导致不同 shard 映射到同一 key，只允许额外串行，不得合并链。这样串行范围限制在单个小时，不再让全站所有时段共享一个全局锁。

**分片边界与封存：**
- 每个小时分片有 open、closing、sealed 状态。小时结束后进入 closing；等待迟到宽限期（建议 5 分钟）并完成该分片待处理事务后，执行最终链尾校验、生成分片清单和签名检查点，再标记 sealed。
- 下一个小时分片的 genesis anchor 必须引用前一小时已 sealed 分片的清单哈希/签名检查点摘要。新小时可以先并行写入自己的临时链，但不得在前序分片尚未封存时标记为最终 sealed 或完成跨分片归档。封存任务按小时顺序推进；前一分片失败或缺失时，后续分片保持待封存并告警，不得跳过边界。
- 对已 sealed 小时到达的迟到事件，不得回写或重开旧链；将事件写入当前 open 分片，并在事件内容中保留原始发生时间、迟到标记及关联原分片。不得静默丢弃迟到事件。
- 无事件小时也生成明确的空分片清单，记录 shard_id、前序分片摘要、空分片标志和签名，避免把“没有事件”与“分片缺失”混淆。

**链校验：**
- 分片内从 genesis anchor 开始，按 sequence_no 重算 canonical event、prev_hash 和 entry_hash，校验唯一性、顺序、行数及链尾。
- 分片间按 UTC 小时顺序校验：当前分片 genesis anchor 必须等于前一小时 sealed manifest 的摘要；同时核对前一分片结束链头、当前分片起始锚、manifest 签名及小时编号连续性。空分片同样验证签名锚接。
- 每小时检查最近活动分片；每日执行从最近可信签名检查点起的跨分片全链验证。发现小时缺档、前序摘要不匹配、签名无效、链内断裂、封存超时或重复分片编号时告警，并阻止该分片及后续分片标记为归档完成。
- 分片签名检查点包含 shard_id、前序 manifest hash、genesis anchor、首尾 sequence_no、首尾 entry_hash、事件行数、封存时间和规范化算法版本。不同小时可并行写入；跨小时只在封存/锚接阶段按序推进，不对每条审计事件做全局串行。

### 17.2 会话全丢后的密码重置恢复

**恢复规则：** 用户没有任何活跃 session，且通过有效的一次性密码重置 token 成功重置密码时，重置成功事务必须原子完成：
1. 锁定该用户 credentials/users 行，确保与并发登录、密码重置和会话创建互斥。
2. 校验 token 未过期、未消费，且 token 绑定的 credential_password_version 与当前密码版本一致。
3. 更新 Argon2id password_hash、password_changed_at，并递增 password_version。
4. 撤销该用户全部 sessions（包括任何仍有效的会话），设置 revoked_at；不可只撤销判定为活跃的部分。
5. 消费 password_reset_token，并写入 auth.password_reset.succeeded 审计事件。
6. 以上操作在同一数据库事务提交；任一步失败则整体回滚，不得出现密码已改但旧会话仍有效、或 token 已消费但密码未更新的半完成状态。

**立即重新登录：** 密码重置成功后不自动创建 session，不向重置链接发放登录 Cookie。用户可立即使用新密码重新登录；重置事务已撤销全部旧 sessions，因此活跃会话计数为 0，新登录正常创建第一个 session。事务提交后，新登录仍按普通流程校验新密码、账号状态、限流及并发上限。

**与“第 6 个会话拒绝登录”的优先级：**
- 每账号最多 5 个活跃 session、第 6 个拒绝，仍是普通登录的默认规则。
- 密码重置成功是独立账号恢复路径，先在事务内撤销全部 sessions；它优先于重置前的 session 数量状态，不能因为重置前已有 5 个活跃 session 而拒绝密码重置。
- 第 6 个会话拒绝规则不阻止密码重置事务；重置完成后旧会话全部失效，用户使用新密码立即登录时从 0 个活跃 session 重新计数。
- 密码重置与登录并发时使用相同的 user_id 行锁/事务级互斥顺序。若重置先取得锁并提交，后续登录只接受新密码且按 0 个旧活跃 session 计数；若登录先完成，则重置随后取得锁并撤销该新建 session。不得发生重置成功后仍存在可用旧密码会话的竞态。
- 账号 suspended/deleted、token 无效或风险策略拒绝恢复时，仍不得登录；密码重置不绕过账号状态、限流或风险控制。

### 17.3 归档存储决策：采用 Cloudflare R2 Bucket Locks + 外部签名，不宣称等同 S3 Compliance Lock

**本项目当前成本优先决策：** 审计归档主存储改为 Cloudflare R2；启用 R2 Bucket Locks，对归档前缀设置至少 7 年保留规则，并使用独立归档写入与验证凭证。Cloudflare R2 当前提供 Bucket Locks，可按前缀阻止对象在保留期内被覆盖或删除；因此不能再描述为“R2 没有任何对象锁能力”。（官方说明：https://developers.cloudflare.com/r2/buckets/bucket-locks/）

**安全边界：** R2 Bucket Locks 不在本设计中宣称与 AWS S3 Object Lock Compliance mode 完全等价；Bucket Lock 规则本身仍属于可由具备存储桶配置权限的账号管理的配置。采用 R2 时必须：
- 将归档写入身份与日常应用身份隔离；应用运行身份不得拥有归档对象删除、覆盖、列举全部归档或修改 Bucket Lock 规则的权限。
- 日常校验使用独立只读凭证；验证器只能读取归档对象和清单，不能修改/删除对象或调整保留策略。
- 每日分片 manifest、链头和校验报告由独立 KMS/HSM 管理的外部签名密钥签名；签名私钥不得存于 R2、应用主机或数据库。签名公钥/验证材料另行备份。
- 使用独立账号/权限边界保存签名检查点或第二份清单；对 Bucket Lock 配置变化、凭证变更、归档缺失及校验失败进行外部告警。
- 归档对象使用唯一不可复用 key；写入采用条件创建，禁止覆盖同名对象；定期执行独立恢复与签名验证演练。

**风险结论：** R2 Bucket Locks + 外部签名 + 只读验证凭证，作为本项目当前成本优先的防篡改/可检测设计可以接受，但不能宣称具备 AWS S3 Object Lock Compliance mode 同等级、不可由存储账号管理员绕过的保留保证。若未来出现法定 WORM、监管留存或必须防止存储账号管理员提前解除保留的要求，应改用 AWS S3 Object Lock Compliance mode 或经专项评审的等效合规存储。R2 作为当前主归档目标，AWS S3 不再是本阶段强制依赖。

## 18. 本轮新增验收标准

- 审计写入：锁 key 按 UTC 小时分片，不同小时不共享全局互斥锁；同一小时链顺序无分叉。
- 审计边界：跨小时 manifest/genesis anchor 连续；空小时有签名清单；迟到事件不回写 sealed 分片；缺档或边界签名错误阻止后续封存。
- 会话恢复：有效密码重置在同一事务内消费 token、更新密码版本、撤销全部 sessions、写审计；失败整体回滚。
- 登录优先级：重置成功不受原有 5 个活跃会话阻挡；随后新密码登录从 0 个活跃会话计数；普通第 6 个登录仍拒绝。
- 归档：R2 Bucket Locks 配置、独立签名、只读验证身份、外部告警及恢复演练均有明确验收证据；不得将其标注为 S3 Compliance mode 等价物。


## 19. 已封存分片的迟到事件（最终决策：A）

**选择 A：迟到事件不进入原分片，写入独立补偿分片/补偿链。** 不采用重算原分片及其后续所有 manifest 的方案。

理由：已封存分片的 manifest、签名检查点和外部归档代表某一时点已验证的审计事实。重算会改变历史哈希、签名与后续锚接，扩大故障半径，并要求重新签署及重新归档所有后续分片；也会削弱“封存后不可变”的审计承诺。补偿链能保留迟到事实，同时不改变既有归档。

### 19.1 迟到事件处理规则

- 已封存的 primary 分片永久只读，禁止 INSERT、UPDATE、DELETE、重开、重算或替换 manifest。
- 迟到事件写入新的 compensation 分片/链，按补偿事件接收时间分配独立 shard_id 和 chain_id；每个补偿分片自身按 sequence_no、prev_hash、entry_hash 构成哈希链并生成独立签名 manifest。
- 补偿事件必须保存原始事件发生时间 source_occurred_at、原目标 source_shard_id、原目标 manifest 哈希 source_manifest_hash，以及迟到原因/检测来源。不得将迟到事件伪装成原小时内正常到达的事件。
- 补偿分片 manifest 锚接到当前已封存的主链检查点，并包含被补偿分片 manifest 哈希；如果同一来源分片有多批迟到事件，每批补偿 manifest 还要引用前一批补偿 manifest，形成可验证的补偿序列。
- 校验器分别校验 primary 链、compensation 链，并验证每条补偿记录引用的 source_shard_id 与 source_manifest_hash 确实存在且签名有效。原分片哈希不匹配、引用不存在或重复补偿编号均告警；补偿事件不得反向修改原分片或原 manifest。
- 迟到事件的展示/查询按原始发生时间归类，同时显式标注“迟到补偿记录”及实际接收/补偿时间，避免时间线误导。

### 19.2 最终 audit_logs 字段

以下是逻辑字段定稿；数据库类型与索引以 Prisma schema 和首个 migration 为准。

| 字段 | 类型 | 约束与用途 |
|---|---|---|
| id | UUID | PK |
| shard_id | UUID | NOT NULL，FK audit_shards(id)，分片归属 |
| shard_kind | enum | NOT NULL：primary / compensation，冗余类型用于约束校验 |
| chain_id | UUID | NOT NULL，当前分片独立链标识 |
| sequence_no | BIGINT | NOT NULL，同一 chain_id 内唯一 |
| occurred_at | timestamptz | NOT NULL，服务端接收/入链时间 |
| source_occurred_at | timestamptz | NULL；补偿事件的原始发生时间 |
| source_shard_id | UUID | NULL，补偿事件原本应归属的分片 |
| source_manifest_hash | BYTEA | NULL，原分片已签名 manifest 哈希 |
| prev_hash | BYTEA | NOT NULL，当前分片上一事件哈希；首条使用 genesis anchor |
| entry_hash | BYTEA | NOT NULL，当前事件哈希 |
| manifest_anchor_hash | BYTEA | NOT NULL，当前分片 genesis 所引用的前序 manifest 摘要 |
| compensation_manifest_prev_hash | BYTEA | NULL，补偿批次链的前一补偿 manifest 摘要 |
| actor_user_id / target_user_id | UUID | NULL，FK users(id) ON DELETE SET NULL |
| actor_ref / actor_type | text | NOT NULL，匿名主体引用及类型 |
| action / outcome | text | NOT NULL，事件动作与结果 |
| request_id | text | NULL |
| ip_prefix | inet | NULL |
| user_agent_hash | BYTEA | NULL |
| metadata | JSONB | NOT NULL，白名单字段；禁止秘密/令牌 |

约束：UNIQUE(chain_id, sequence_no)；shard_kind='primary' 时 source_shard_id、source_manifest_hash、source_occurred_at 为空；shard_kind='compensation' 时三者必填且 source_shard_id 不得等于 shard_id；source_shard_id 引用 audit_shards(id)，删除策略为 RESTRICT；manifest_anchor_hash 必须等于 audit_shards.genesis_anchor_hash。补偿批次的 compensation_manifest_prev_hash 在首批可为空，后续必须指向同一来源分片上一批已签名补偿 manifest。

### 19.3 分片与 manifest 表

audit_shards 是分片/链目录，至少包含：id UUID PK、shard_key UNIQUE、chain_id UUID UNIQUE、kind（primary/compensation）、state（open/closing/sealed）、hour_started_at（primary 小时起点）、received_at（补偿分片创建时间）、source_shard_id nullable、source_manifest_hash nullable、previous_manifest_hash nullable、genesis_anchor_hash BYTEA NOT NULL、created_at、sealed_at。primary 分片按 UTC 小时唯一；compensation 分片必须引用已 sealed 的 primary 分片及其 manifest。

audit_manifests 是不可变封存清单，至少包含：id UUID PK、shard_id UUID UNIQUE、manifest_hash BYTEA UNIQUE、previous_manifest_hash nullable、source_manifest_hash nullable、genesis_anchor_hash BYTEA、first_sequence_no、last_sequence_no、row_count、first_entry_hash、last_entry_hash、signature BYTEA、signature_key_id、signature_algorithm、canonicalization_version、sealed_at、created_at。sealed 后不允许更新或删除；同一 shard 只允许一个最终 manifest。补偿 manifest 的 source_manifest_hash 必须与 audit_shards.source_manifest_hash 一致。

所有 manifest 哈希、签名与锚接字段均为二进制定长值；校验器必须验证分片内哈希链、分片 manifest 签名、primary 小时边界锚接及 compensation → source manifest 引用。schema 只定义持久化结构，不实现审计写入、签名、归档或校验逻辑。

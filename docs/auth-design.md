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

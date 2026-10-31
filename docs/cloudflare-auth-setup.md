# Cloudflare 认证服务配置

认证运行在 `workers/api`，账户、凭据、会话、邮件令牌和 GitHub OAuth 状态保存在 Cloudflare D1（`domainhub-db`）。前端由 Cloudflare Pages 提供。

## 必需的 Worker Secrets

在 Cloudflare Dashboard → Workers & Pages → `domainhub-api` → Settings → Variables and Secrets 中添加以下 **Secret**：

| 名称 | 用途 |
|---|---|
| `RESEND_API_KEY` | Resend 邮件发送 API 密钥 |
| `RESEND_FROM_EMAIL` | 已在 Resend 验证的发件人，例如 `DomainHub <no-reply@your-verified-domain>` |
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Client Secret |
| `OAUTH_STATE_ENCRYPTION_KEY` | 加密暂存 PKCE verifier 的 32 字节密钥，Base64 编码 |

可在本地生成 OAuth 加密密钥：`openssl rand -base64 32`。只把生成结果保存为 Worker Secret，不提交到 Git。

`RESEND_FROM_EMAIL` 必须是 Resend 已验证的发件地址。若没有 Resend 账户或已验证发件域名，注册验证和密码重置邮件不会送达；Worker 会返回邮件服务未配置，而不会假装发送成功。

## GitHub OAuth App

创建 GitHub OAuth App，设置：
- Homepage URL：`https://dns.lynli.me`
- Authorization callback URL：`https://domainhub-api.chulingli1988.workers.dev/auth/github/callback`

权限使用 OAuth App 的用户授权流程，代码只请求 `read:user user:email`。不要把 Client Secret 放进前端、Pages 环境变量或仓库。

## 已写入 Wrangler 的公开配置

- `APP_ORIGIN=https://dns.lynli.me`
- `GITHUB_CALLBACK_URL=https://domainhub-api.chulingli1988.workers.dev/auth/github/callback`

## 认证接口

- `POST /auth/register`：创建待验证账户并发送 30 分钟邮箱验证链接。
- `POST /auth/email/verification/send`：重新发送验证链接。
- `GET /auth/email/verify?token=...`：一次性验证邮箱。
- `POST /auth/login`：仅允许已验证邮箱登录。
- `POST /auth/password/forgot`：统一响应，发送 20 分钟密码重置链接。
- `POST /auth/password/reset`：一次性重置密码并撤销旧会话。
- `GET /auth/github/start`：启动 GitHub OAuth，使用 state、浏览器绑定 Cookie 和 PKCE S256。
- `GET /auth/github/callback`：验证回调、创建或查找 GitHub 身份。
- `POST /auth/github/exchange`：兑换 60 秒有效的一次性前端登录码。

GitHub 身份以 `(provider, provider_user_id)` 作为主键。未经用户主动关联，不会因为邮箱相同而自动合并已有邮箱账户。

## 发布

在安装 Wrangler 并登录 Cloudflare 的环境中运行：

```sh
npx wrangler deploy --config workers/api/wrangler.toml
```

首次或新增 D1 migration 后运行：

```sh
npx wrangler d1 migrations apply domainhub-db --remote --config workers/api/wrangler.toml
```

本次新增 migration：`0003_github_login_codes.sql`。生产 D1 已应用该表结构。

# Cloudflare 认证服务配置

认证后端统一运行在 Cloudflare Workers，账户、凭据、会话、邮件令牌和 GitHub OAuth 状态保存在 Cloudflare D1（`domainhub-db`）。前端由 Cloudflare Pages 提供。

## 邮件发送：Resend

Worker 使用 Resend Email API 发送注册验证码、邮箱验证验证码和密码重置验证码。邮件凭据只保存在 Cloudflare Worker Secrets，不进入前端。

需要配置：

| 名称 | 用途 |
|---|---|
| `RESEND_API_KEY` | Resend API Key（Secret） |
| `RESEND_FROM_EMAIL` | 已在 Resend 验证的发件人，例如 `DomainHub <noreply@lynli.me>`（Secret） |

生产 Worker 已配置上述变量。发件域名必须在 Resend 控制台完成验证，且发件地址需属于已验证域名。

## GitHub OAuth

DomainHub 复用了现有 `lynli` Pages 项目中已配置的 GitHub OAuth App 凭据，已安全写入 `domainhub-api` Worker Secrets：

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `OAUTH_STATE_ENCRYPTION_KEY`（独立生成的 32 字节 Base64URL 密钥）

GitHub OAuth App 已登记的回调地址为：

`https://lynli.me/api/github-oauth/callback`

Cloudflare Worker Route 已绑定：

`lynli.me/api/github-oauth/* → domainhub-api`

登录从同一主机的 `/api/github-oauth/start` 发起，使 HttpOnly、Secure、SameSite=Lax 的浏览器绑定 Cookie 能随回调返回。授权流程使用 state、一次性状态记录、PKCE S256 和服务端会话。

## 公开配置

- `APP_ORIGIN=https://dns.lynli.me`
- `GITHUB_CALLBACK_URL=https://lynli.me/api/github-oauth/callback`

## 认证接口

- `POST /auth/register`：创建待验证账户并发送 10 分钟、6 位数字邮箱验证码。
- `POST /auth/email/verification/send`：重新发送 6 位数字验证码。
- `GET /auth/email/verify?token=...`：一次性验证邮箱。
- `POST /auth/login`：仅允许已验证邮箱登录。
- `POST /auth/password/forgot`：统一响应，发送 10 分钟、6 位数字密码重置验证码。
- `POST /auth/password/reset`：一次性重置密码并撤销旧会话。
- `GET /api/github-oauth/start`：启动 GitHub OAuth。
- `GET /api/github-oauth/callback`：处理 GitHub OAuth 回调。
- `POST /auth/github/exchange`：兑换 60 秒有效的一次性前端登录码。

GitHub 身份以 `(provider, provider_user_id)` 作为主键。未经用户主动关联，不会因为邮箱相同而自动合并已有邮箱账户。

## 发布与迁移

```sh
npx wrangler deploy --config workers/api/wrangler.toml
npx wrangler d1 migrations apply domainhub-db --remote --config workers/api/wrangler.toml
```

本次新增迁移：`0003_github_login_codes.sql`（GitHub OAuth 一次性登录码）和 `0004_legal_consents.sql`（用户协议/隐私政策同意记录）。部署本分支后，先执行 `npx wrangler d1 migrations apply domainhub-db --remote --config workers/api/wrangler.toml`，再开放注册。注册接口要求 `termsAccepted=true`、`privacyAccepted=true`，并将协议版本 `1.0` 与接受时间写入 D1。

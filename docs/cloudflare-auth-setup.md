# Cloudflare 认证服务配置

认证后端统一运行在 Cloudflare Workers，账户、凭据、会话、邮件令牌和 GitHub OAuth 状态保存在 Cloudflare D1（`domainhub-db`）。前端由 Cloudflare Pages 提供。

## 邮件发送：阿里云 DirectMail

Worker 使用阿里云 DirectMail `SingleSendMail` API（HMAC-SHA1 签名），无需把邮件密钥放进前端。

需要在 `domainhub-api` Worker 的 Settings → Variables and Secrets 中设置以下 Secret：

| 名称 | 用途 |
|---|---|
| `ALI_ACCESS_KEY_ID` | 阿里云 RAM AccessKey ID |
| `ALI_ACCESS_KEY_SECRET` | 阿里云 RAM AccessKey Secret |
| `ALI_DM_ACCOUNT` | DirectMail 控制台已验证的发件地址 |
| `ALI_DM_REGION` | 发件地址所在区域，默认 `cn-hangzhou` |

这些变量此前已存在于 Cloudflare Pages 项目 `lynli` 的生产环境。请将其安全迁移到 Worker Secret，不要提交到 Git 或放入 `VITE_` 前端变量。发件地址必须已在同一区域的 DirectMail 控制台验证。

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

- `POST /auth/register`：创建待验证账户并发送 30 分钟邮箱验证链接。
- `POST /auth/email/verification/send`：重新发送验证链接。
- `GET /auth/email/verify?token=...`：一次性验证邮箱。
- `POST /auth/login`：仅允许已验证邮箱登录。
- `POST /auth/password/forgot`：统一响应，发送 20 分钟密码重置链接。
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

本次新增迁移：`0003_github_login_codes.sql`。生产 D1 已应用该迁移。

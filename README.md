# DomainHub

DomainHub 是独立的域名查询与 DNS 管理平台。产品方向参考 DNSHE：蓝白配色、信息密度适中、以查询和管理工具为中心，不采用商城式首页。

## 本地启动

要求 Node.js 20、npm。

```bash
npm install
npm run dev
```

生产构建与预览：

```bash
npm run build
npm run preview
```

## 环境变量

复制 `.env.example` 为 `.env.local`。当前阶段不需要配置任何密钥。环境变量文件已加入忽略规则；不要把 API Token、OAuth Secret、Bot Token、数据库密码或支付密钥放入前端变量或提交到仓库。

## 当前已完成

- 响应式工具型首页与移动端导航
- 演示域名数据集中在 `src/mock/domains.ts`，每条数据带 `isDemo: true`
- 本地关键词搜索、后缀下拉筛选和快捷后缀筛选
- 未开放功能明确禁用或标记，不会触发假操作
- GitHub Actions 使用 Node.js 20，执行依赖安装、TypeScript 检查、Vite 构建并上传 `dist/`

## 尚未完成

- 账号体系：邮箱注册/登录、GitHub OAuth
- 风控底座：限流、验证码、配额、审计
- 真实只读域名列表与搜索 API
- 领取：幂等、事务、库存预占与回滚（未开始，需另行确认）
- Telegram 身份验证与活动管理
- 本站权威 DNS 与 Cloudflare DNS API
- 支付、USDT、云服务器商品与订单

## 开发顺序

账号体系 → 风控底座 → 只读域名列表/搜索 →（确认后）领取 → TG 验证 → DNS/Cloudflare → 支付。

> 当前域名数据为本地演示内容，不代表真实库存、可用性或注册状态。当前版本不执行注册、领取、DNS 修改、支付或资金操作。独立管理面板前端已从本仓库移除；Workers 后端、管理员鉴权及主站内的管理员权限判断仍保留，不在本次删除范围内。

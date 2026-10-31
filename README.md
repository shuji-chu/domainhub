# DomainHub

DomainHub 是一个独立的域名领取与 DNS 管理平台前端项目，采用简洁的工具型界面，适配桌面端与手机端。

## 当前阶段

- [x] 响应式首页与移动端导航
- [x] 域名搜索与后缀筛选演示
- [x] TG 机器人绑定、加入 TG 群组的奖励入口（前端占位）
- [x] DNS、Cloudflare、云服务器、USDT 充值功能入口
- [x] GitHub Actions 自动安装依赖、类型检查、构建并上传 dist 产物
- [ ] 邮箱注册与 GitHub OAuth（需后端与 OAuth App 配置）
- [ ] Telegram Bot 任务验证及活动管理
- [ ] 域名库存、领取、续期与回收 API
- [ ] 权威 DNS 服务与 Cloudflare DNS API
- [ ] USDT 支付与订单系统
- [ ] 云服务器商品与订单管理

## 本地开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
npm run preview
```

> 注意：当前页面包含演示数据和前端占位交互，不会真实注册域名、写入 DNS、发放奖励或处理资金。正式接入时需配置安全的服务端 API；任何 Bot Token、DNS Token、OAuth Secret 和支付密钥都不得写入前端或提交到仓库。

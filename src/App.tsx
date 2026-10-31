import { useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2, ChevronDown, Cloud, Github, Globe2, Menu, Search, Server, ShieldCheck, Users, Wallet, X, Send } from 'lucide-react'

const suffixes = ['全部后缀', '.com', '.net', '.org', '.xyz', '.top', '.site', '.online', '.tech']
const sampleDomains = ['.site', '.online', '.xyz', '.top', '.tech'].map((suffix, i) => ({ name: ['mybrand', 'cloudbox', 'hello-world', 'fastnode', 'project'][i], suffix }))
const tasks = [
  { icon: Send, title: '绑定 TG 机器人', desc: '启动官方机器人，验证 Telegram 身份', reward: '+1 名额' },
  { icon: Users, title: '加入官方 TG 群组', desc: '加入社群并完成成员身份验证', reward: '+1 名额' },
]
export default function App() {
  const [keyword, setKeyword] = useState('')
  const [suffix, setSuffix] = useState('全部后缀')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [message, setMessage] = useState('')
  const results = useMemo(() => sampleDomains.filter(d => (!keyword || (d.name + d.suffix).toLowerCase().includes(keyword.toLowerCase())) && (suffix === '全部后缀' || suffix === d.suffix)), [keyword, suffix])
  const comingSoon = (name: string) => setMessage(name + '功能正在接入，当前页面为前端预览。')
  return <div className="site">
    <header className="header">
      <a className="brand" href="#"><img src="/logo.svg" /><span>Domain<span>Hub</span></span></a>
      <button className="menu-toggle" onClick={() => setMobileMenu(!mobileMenu)} aria-label="菜单">{mobileMenu ? <X/> : <Menu/>}</button>
      <nav className={mobileMenu ? 'nav open' : 'nav'}>
        <a href="#home" onClick={() => setMobileMenu(false)}>首页</a><a href="#domains" onClick={() => setMobileMenu(false)}>域名注册</a><a href="#dns" onClick={() => setMobileMenu(false)}>DNS 管理</a><a href="#tasks" onClick={() => setMobileMenu(false)}>任务奖励</a><a href="#services" onClick={() => setMobileMenu(false)}>服务与帮助</a>
      </nav>
      <div className="auth"><button className="login" onClick={() => comingSoon('登录')}>登录</button><button className="primary small" onClick={() => comingSoon('注册')}>注册</button></div>
    </header>
    <main id="home">
      <section className="intro">
        <div><div className="kicker"><span/> DOMAIN SERVICE PLATFORM</div><h1>免费域名，<em>轻松拥有</em></h1><p>简单、快速的域名领取与 DNS 管理服务。</p><div className="intro-points"><span><ShieldCheck/> 安全可靠</span><span><Globe2/> 多种后缀</span><span><ZapIcon/> 简单易用</span></div><a className="primary start" href="#domains">开始注册 <ArrowRight size={17}/></a></div>
        <div className="intro-graphic"><div className="globe"><Globe2/></div><div className="orbit"></div><div className="mini-cloud"><Cloud/></div><div className="graphic-label"><CheckCircle2/> DNS 智能管理</div></div>
      </section>
      <section className="panel task-panel" id="tasks">
        <div className="section-title"><div><span className="blue-icon"><GiftIcon/></span><div><h2>任务奖励</h2><p>完成社区任务，领取免费域名名额</p></div></div><b className="quota">新人奖励 <strong>2 个名额</strong></b></div>
        <div className="task-grid">{tasks.map(t => <article className="task" key={t.title}><div className="task-symbol"><t.icon/></div><div className="task-info"><b>{t.title}</b><p>{t.desc}</p></div><button onClick={() => comingSoon(t.title)}>{t.reward}<ArrowRight size={15}/></button></article>)}</div>
        <div className="task-foot">后续活动将由官方 TG 管理机器人发布，奖励规则以活动页面为准。</div>
      </section>
      <section className="panel domain-panel" id="domains">
        <div className="section-title"><div><span className="blue-icon"><Globe2/></span><div><h2>查找你的域名</h2><p>输入名称，选择后缀，查找可用域名</p></div></div><span className="soft-tag">快速查询</span></div>
        <div className="searchbar"><Search/><input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="输入你想注册的域名，例如 myname" aria-label="域名关键词"/><label><select value={suffix} onChange={e => setSuffix(e.target.value)}>{suffixes.map(s => <option key={s}>{s}</option>)}</select><ChevronDown size={15}/></label><button className="primary" onClick={() => setMessage('已更新域名筛选结果。')}>查询域名</button></div>
        <div className="suffix-list">{suffixes.slice(1).map(s => <button className={suffix === s ? 'suffix active' : 'suffix'} key={s} onClick={() => setSuffix(s)}>{s}</button>)}</div>
        <div className="results-head"><b>推荐域名</b><span>{results.length} 条演示结果</span></div>
        {results.length ? results.map(d => <div className="domain-row" key={d.name+d.suffix}><div className="domain-symbol"><Globe2/></div><div className="domain-text"><b>{d.name}{d.suffix}</b><small>可用于个人项目、网站或服务</small></div><span className="available"><i/> 演示可用</span><button className="outline" onClick={() => comingSoon('域名领取')}>领取 <ArrowRight size={15}/></button></div>) : <div className="empty">没有匹配结果，请更换关键词或后缀。</div>}
        <p className="demo-hint">当前为演示数据；真实域名库存、注册和领取将在后端服务接入后启用。</p>
      </section>
      <section className="services" id="services"><div className="section-title"><div><span className="blue-icon"><Server/></span><div><h2>平台服务</h2><p>域名、解析与云端服务，一站式管理</p></div></div></div><div className="service-grid">
        <article><Globe2/><b>域名领取</b><p>多种域名后缀，按规则免费领取。</p><a href="#domains">进入域名中心 <ArrowRight/></a></article>
        <article id="dns"><Cloud/><b>DNS 解析</b><p>支持本站 DNS 与 Cloudflare 管理模式。</p><button onClick={() => comingSoon('DNS 管理')}>管理解析 <ArrowRight/></button></article>
        <article><Server/><b>云服务器</b><p>预留云服务器展示、购买与订单入口。</p><span className="coming">即将开放</span></article>
        <article><Wallet/><b>USDT 充值</b><p>预留余额充值、支付记录与订单查询。</p><span className="coming">即将开放</span></article>
      </div></section>
      <section className="auth-note"><div className="auth-icon"><Github/></div><div><b>安全便捷的账号登录</b><p>支持 GitHub 一键登录与邮箱注册；Telegram 仅用于任务验证，不提供 TG 登录。</p></div><button className="outline" onClick={() => comingSoon('GitHub 登录')}>GitHub 登录 <ArrowRight/></button></section>
    </main>
    <footer><div className="footer-brand"><a className="brand" href="#"><img src="/logo.svg"/><span>Domain<span>Hub</span></span></a><p>让域名服务更简单。</p></div><div className="footer-links"><a href="#domains">域名注册</a><a href="#dns">DNS 管理</a><a href="#tasks">任务奖励</a><a href="#services">云服务器</a><a href="#services">USDT 充值</a></div><span>© {new Date().getFullYear()} DomainHub</span></footer>
    {message && <div className="toast" role="status">{message}<button onClick={() => setMessage('')} aria-label="关闭"><X size={16}/></button></div>}
  </div>
}
function ZapIcon(){return <span className="zap">✦</span>}
function GiftIcon(){return <span className="gift">✧</span>}

import { useMemo, useState } from 'react'
import { Search, Globe2, ChevronDown, Menu, X, Github, Send, Users, ShieldCheck } from 'lucide-react'
import { demoDomains, demoSuffixes } from './mock/domains'

export default function App() {
  const [keyword, setKeyword] = useState('')
  const [suffix, setSuffix] = useState('全部后缀')
  const [menuOpen, setMenuOpen] = useState(false)

  const results = useMemo(() => {
    const term = keyword.trim().toLowerCase()
    return demoDomains.filter((domain) => {
      const matchesName = !term || domain.fqdn.toLowerCase().includes(term)
      const matchesSuffix = suffix === '全部后缀' || domain.suffix === suffix
      return matchesName && matchesSuffix
    })
  }, [keyword, suffix])

  return <div className="site">
    <header className="header">
      <a className="brand" href="#home" aria-label="DomainHub 首页">
        <img src="/logo.svg" alt="" /><span>Domain<span>Hub</span></span>
      </a>
      <button className="menu-toggle" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? '关闭菜单' : '打开菜单'} aria-expanded={menuOpen}>
        {menuOpen ? <X size={21}/> : <Menu size={21}/>}
      </button>
      <nav className={menuOpen ? 'nav open' : 'nav'} aria-label="主导航">
        <a href="#domains" onClick={() => setMenuOpen(false)}>域名查询</a>
        <a href="#features" onClick={() => setMenuOpen(false)}>功能说明</a>
        <a href="#tasks" onClick={() => setMenuOpen(false)}>活动规则</a>
        <a href="#help" onClick={() => setMenuOpen(false)}>帮助</a>
      </nav>
      <div className="account-actions">
        <span className="not-open-label">账号功能未开放</span>
      </div>
    </header>

    <main id="home">
      <section className="intro">
        <div className="intro-copy">
          <div className="eyebrow"><span/> DOMAINHUB · 域名服务</div>
          <h1>免费域名查询与<br/><em>DNS 管理平台</em></h1>
          <p>简洁、直接地查询域名，管理你的网络入口。</p>
          <a className="primary" href="#domains">查询域名 <Search size={16}/></a>
        </div>
        <div className="intro-aside">
          <div><Globe2/><b>域名查询</b><span>搜索可用后缀与域名</span></div>
          <div><ShieldCheck/><b>安全优先</b><span>账号与风控先行建设</span></div>
        </div>
      </section>

      <section className="panel domain-panel" id="domains">
        <div className="section-head">
          <div><h2>域名查询</h2><p>输入名称并选择后缀，筛选当前演示列表。</p></div>
          <span className="demo-badge">演示数据</span>
        </div>
        <div className="searchbar">
          <Search className="search-icon" size={19}/>
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setKeyword('') }} placeholder="输入域名前缀或完整域名" aria-label="搜索域名"/>
          <label className="suffix-select">
            <select value={suffix} onChange={(event) => setSuffix(event.target.value)} aria-label="域名后缀">
              {demoSuffixes.map((item) => <option key={item}>{item}</option>)}
            </select>
            <ChevronDown size={15}/>
          </label>
          <button className="search-button" type="button" onClick={() => document.getElementById('domain-results')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}>查询</button>
        </div>
        <div className="suffix-chips" aria-label="快速筛选后缀">
          {demoSuffixes.map((item) => <button type="button" key={item} className={suffix === item ? 'chip selected' : 'chip'} onClick={() => setSuffix(item)}>{item === '全部后缀' ? '全部' : item}</button>)}
        </div>
        <div className="results-heading" id="domain-results"><b>查询结果</b><span>{results.length} 条演示记录</span></div>
        {results.length > 0 ? <div className="domain-list">{results.map((domain) => <article className="domain-row" key={domain.fqdn}>
          <div className="domain-icon"><Globe2 size={18}/></div>
          <div className="domain-info"><b>{domain.fqdn}</b><small>{domain.note}</small></div>
          <span className="preview-status">演示条目</span>
          <span className="not-available">领取未开放</span>
        </article>)}</div> : <div className="empty-state">没有匹配的演示域名，请更换关键词或后缀。</div>}
        <p className="data-disclaimer">以上仅为本地演示数据，不代表真实注册状态、库存或域名可用性。当前版本仅提供前端筛选，不会执行注册或领取。</p>
      </section>

      <section className="panel feature-panel" id="features">
        <div className="section-head"><div><h2>平台功能</h2><p>按安全顺序逐步开放，未开放功能不会执行操作。</p></div></div>
        <div className="feature-list">
          <article><div className="feature-icon"><Github/></div><div><b>GitHub 登录 / 邮箱账号</b><p>账号体系建设中，暂未开放注册和登录。</p></div><span className="state">未开放</span></article>
          <article><div className="feature-icon"><Globe2/></div><div><b>域名列表与查询</b><p>当前仅展示演示数据；真实只读数据接口尚未接入。</p></div><span className="state">演示阶段</span></article>
          <article><div className="feature-icon"><ShieldCheck/></div><div><b>DNS / Cloudflare</b><p>待账号、风控和域名数据模块完成后开发。</p></div><span className="state">未开放</span></article>
        </div>
      </section>

      <section className="panel task-panel" id="tasks">
        <div className="section-head"><div><h2>社区活动</h2><p>Telegram 仅用于身份绑定、任务验证和通知，不作为登录方式。</p></div><span className="state">未开放</span></div>
        <div className="task-note"><Send size={19}/><div><b>TG 任务奖励规则</b><p>绑定机器人并加入指定群组，两项完成后合计奖励 1 个名额。验证功能尚未开放。</p></div></div>
        <div className="task-actions"><button disabled><Send size={16}/>绑定机器人 · 未开放</button><button disabled><Users size={16}/>群组验证 · 未开放</button></div>
      </section>
    </main>

    <footer id="help"><a className="brand" href="#home"><img src="/logo.svg" alt=""/><span>Domain<span>Hub</span></span></a><p>DomainHub · 域名查询与 DNS 管理平台</p><small>当前为开发预览，真实域名注册、领取、DNS 修改及支付均未开放。</small></footer>
  </div>
}

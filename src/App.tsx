import { useEffect, useState, type FormEvent } from "react";
import { Github } from "lucide-react";
import "./styles.css";

const API = "https://domainhub-api.chulingli1988.workers.dev";
const TOKEN_KEY = "domainhub_token";
type Mode = "login" | "register" | "verify";
type ApiResult = { ok?: boolean; message?: string; error?: string; testMode?: boolean; verificationCode?: string; token?: string; quota?: number; user?: { id: string; email: string; displayName?: string | null; quota?: number }; domains?: Array<{id:string;domain:string;status?:string}> };

async function request(path: string, body: Record<string, unknown>): Promise<ApiResult> {
  const response = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as ApiResult;
  if (!response.ok) throw new Error(result.error || result.message || "请求失败，请稍后重试");
  return result;
}

export default function App() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [signedIn, setSignedIn] = useState<{ email: string; quota: number } | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [domains, setDomains] = useState<Array<{id:string;domain:string;status?:string}>>([]);
  const [myDomains, setMyDomains] = useState<Array<{id:string;domain:string;status?:string}>>([]);
  const [domainQuery, setDomainQuery] = useState("");
  const [domainsLoading, setDomainsLoading] = useState(false);
  const [claiming, setClaiming] = useState("");

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => setCountdown(value => Math.max(0, value - 1)), 1000);
    return (
    <main className="auth-shell home-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <a className="brand" href="/" aria-label="DomainHub 首页">
          <img className="brand-mark" src="/logo.svg" alt="" />
          <span>Domain<span className="brand-light">Hub</span></span>
        </a>
        <div className="home-nav">
          {signedIn ? (
            <>
              <span className="home-user">{signedIn.email}</span>
              <span className="quota-chip">可用配额 <b>{signedIn.quota}</b></span>
              <button className="nav-button nav-button-quiet" onClick={logout}>退出</button>
            </>
          ) : (
            <>
              <button className="nav-button nav-button-quiet" onClick={() => switchMode("login")}>登录</button>
              <button className="nav-button nav-button-primary" onClick={() => switchMode("register")}>注册账户</button>
            </>
          )}
        </div>
      </header>

      <section className="home-content">
        <div className="home-heading">
          <div className="eyebrow"><span /> 域名资源中心</div>
          <h1>寻找合适的域名。<br /><span>从这里开始。</span></h1>
          <p>搜索可用域名，登录后即可领取并管理。</p>
        </div>

        <label className="domain-search home-search">
          <span>⌕</span>
          <input value={domainQuery} onChange={e => setDomainQuery(e.target.value)} placeholder="输入关键词搜索域名…" aria-label="搜索域名" />
        </label>

        {error && <div className="feedback feedback-error home-feedback" role="alert">{error}</div>}
        {notice && <div className="feedback feedback-success home-feedback" role="status">{notice}</div>}

        <div className="domain-section-head">
          <h3>可领取域名</h3>
          <span>{filteredDomains.length} 个</span>
        </div>
        <div className="domain-list public-domain-list">
          {domainsLoading ? <div className="empty-domains">正在加载域名…</div> : filteredDomains.length ? filteredDomains.map(item => (
            <div className="domain-row" key={item.id}>
              <div className="domain-name"><span className="domain-dot" /><b>{item.domain}</b></div>
              <button className="claim-button" disabled={!!claiming || (!!signedIn && signedIn.quota < 1)} onClick={() => signedIn ? void claimDomain(item.id) : switchMode("login")}>
                {claiming === item.id ? "处理中…" : signedIn ? (signedIn.quota > 0 ? "领取" : "配额不足") : "登录后领取"}
              </button>
            </div>
          )) : <div className="empty-domains">{domainQuery ? "没有匹配的域名" : "暂无可领取域名"}</div>}
        </div>

        {signedIn && (
          <>
            <div className="domain-section-head mine-head"><h3>我的域名</h3><span>{myDomains.length} 个</span></div>
            <div className="domain-list mine-list">
              {myDomains.length ? myDomains.map(item => (
                <div className="domain-row" key={item.id}>
                  <div className="domain-name"><span className="domain-dot owned" /><b>{item.domain}</b></div>
                  <span className="domain-status">已领取</span>
                </div>
              )) : <div className="empty-domains">还没有领取域名</div>}
            </div>
          </>
        )}
      </section>

      <footer className="site-footer"><span>© {new Date().getFullYear()} DomainHub</span><span>安全 · 简洁 · 自主掌控</span></footer>

      {authOpen && !signedIn && (
        <div className="auth-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setAuthOpen(false); }}>
          <section className="auth-card auth-modal" aria-labelledby="auth-title">
            <button className="auth-close" type="button" aria-label="关闭" onClick={() => setAuthOpen(false)}>×</button>
          {signedIn ? (
            <div className="domain-home">
              <div className="dashboard-top">
                <div><p className="card-kicker">域名控制台</p><h2 id="auth-title">域名管理</h2><p className="muted">{signedIn.email}</p></div>
                <div className="quota-chip">可用配额 <b>{signedIn.quota}</b></div>
              </div>
              <label className="domain-search"><span>⌕</span><input value={domainQuery} onChange={e=>setDomainQuery(e.target.value)} placeholder="搜索可用域名…" aria-label="搜索可用域名"/></label>
              {error && <div className="feedback feedback-error" role="alert">{error}</div>}
              {notice && <div className="feedback feedback-success" role="status">{notice}</div>}
              <div className="domain-section-head"><h3>可领取域名</h3><span>{filteredDomains.length} 个</span></div>
              <div className="domain-list">
                {domainsLoading ? <div className="empty-domains">正在加载域名…</div> : filteredDomains.length ? filteredDomains.map(item=><div className="domain-row" key={item.id}><div className="domain-name"><span className="domain-dot"/><b>{item.domain}</b></div><button className="claim-button" disabled={!!claiming || signedIn.quota < 1} onClick={()=>void claimDomain(item.id)}>{claiming===item.id?"处理中…":"领取"}</button></div>) : <div className="empty-domains">{domainQuery?"没有匹配的域名":"暂无可领取域名"}</div>}
              </div>
              <div className="domain-section-head mine-head"><h3>我的域名</h3><span>{myDomains.length} 个</span></div>
              <div className="domain-list mine-list">{myDomains.length ? myDomains.map(item=><div className="domain-row" key={item.id}><div className="domain-name"><span className="domain-dot owned"/><b>{item.domain}</b></div><span className="domain-status">已领取</span></div>) : <div className="empty-domains">还没有领取域名</div>}</div>
              <button className="button button-logout" onClick={logout}>退出登录</button>
            </div>
          ) : (
            <>
              <div className="card-heading">
                {mode === "register" && <div className="card-brand"><img src="/logo.svg" alt="DomainHub" /><span>Domain<span>Hub</span></span></div>}
                <p className="card-kicker">欢迎使用</p>
                <h2 id="auth-title">{mode === "register" ? "创建账户" : mode === "verify" ? "验证邮箱" : "欢迎回来"}</h2>
                <p>{mode === "register" ? "填写信息，创建账户。" : mode === "verify" ? "输入发送到邮箱的 6 位验证码。" : "登录后管理你的域名。"}</p>
              </div>

              {mode !== "verify" && (
                <div className="mode-switch" role="tablist" aria-label="登录或注册">
                  <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>登录</button>
                  <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>注册</button>
                </div>
              )}

              {error && <div className="feedback feedback-error" role="alert">{error}</div>}
              {notice && <div className="feedback feedback-success" role="status">{notice}</div>}

              {mode === "login" && (
                <form onSubmit={handleLogin} className="auth-form">
                  <label>邮箱地址<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></label>
                  <label>登录密码<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入密码" /></label>
                  <button className="button button-primary" type="submit" disabled={busy}>{busy ? "正在登录…" : "登录账户"}<span>→</span></button>
                  <button className="button button-oauth" type="button" onClick={startGithub} disabled={busy}><Github size={18} strokeWidth={2.2} aria-hidden="true" /> 使用 GitHub 授权登录</button>
                  <p className="form-foot">还没有账户？ <button type="button" className="text-button" onClick={() => switchMode("register")}>立即注册</button></p>
                </form>
              )}

              {mode === "register" && (
                <form onSubmit={handleRegister} className="auth-form">
                  <label>显示名称 <span className="optional">选填</span><input autoComplete="nickname" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="你希望如何称呼你" maxLength={60} disabled={codeSent} /></label>
                  <label>邮箱地址<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" disabled={codeSent} /></label>
                  <label>设置密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 12 位，最多 128 位" disabled={codeSent} /></label>
                  <div className="verification-row">
                    <label>邮箱验证码<input className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="输入 6 位验证码" /></label>
                    <button className="button button-code" type="button" onClick={() => void handleGetCode()} disabled={busy || countdown > 0 || !email || !password || !termsAccepted || !privacyAccepted}>{busy ? "发送中…" : countdown > 0 ? `${countdown} 秒后重发` : codeSent ? "重新获取" : "获取验证码"}</button>
                  </div>
                  <p className="hint">{codeSent ? "验证码已发送至邮箱，有效期 10 分钟；邮箱、密码和显示名称已锁定。" : "请先填写邮箱和密码，并勾选下方协议后获取验证码。"}</p>
                  <div className="consents">
                    <label className="check-row"><input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} disabled={codeSent} /><span>我已阅读并同意 <a href="#terms">用户服务协议</a></span></label>
                    <label className="check-row"><input type="checkbox" checked={privacyAccepted} onChange={e => setPrivacyAccepted(e.target.checked)} disabled={codeSent} /><span>我已阅读并同意 <a href="#privacy">隐私政策</a></span></label>
                  </div>
                  <button className="button button-primary" type="submit" disabled={busy || !termsAccepted || !privacyAccepted || !codeSent || code.length !== 6}>{busy ? "正在验证并创建…" : "创建账户"}<span>→</span></button>
                  <p className="form-foot">已有账户？ <button type="button" className="text-button" onClick={() => switchMode("login")}>返回登录</button></p>
                </form>
              )}

              {mode === "verify" && (
                <form onSubmit={handleVerify} className="auth-form">
                  <div className="verify-email">{email}</div>
                  <label>6 位邮箱验证码<input className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></label>
                  <button className="button button-primary" type="submit" disabled={busy || code.length !== 6}>{busy ? "正在验证…" : "验证邮箱"}<span>→</span></button>
                  <div className="verify-actions"><button type="button" className="text-button" onClick={() => void resendCode()} disabled={busy}>重新发送验证码</button><button type="button" className="text-button subtle" onClick={() => switchMode("register")}>返回修改信息</button></div>
                  <p className="hint">验证码有效期为 10 分钟。若未收到，请检查垃圾邮件文件夹。</p>
                </form>
              )}
            </>
          )}
          </section>
        </div>
      )}
    </main>
  );
}
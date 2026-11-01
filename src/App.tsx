import { useEffect, useState, type FormEvent } from "react";
import "./styles.css";

const API = "https://domainhub-api.chulingli1988.workers.dev";
type Mode = "login" | "register" | "verify";
type ApiResult = { ok?: boolean; message?: string; error?: string; token?: string; user?: { id: string; email: string; displayName?: string | null; quota?: number } };

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
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [signedIn, setSignedIn] = useState<{ email: string; quota: number } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthCode = params.get("oauth_code");
    const authError = params.get("auth_error");
    if (authError) {
      const messages: Record<string, string> = {
        github_unconfigured: "GitHub 授权登录暂不可用，请使用邮箱密码登录。",
        oauth_consent_required: "请先阅读并同意用户服务协议和隐私政策。",
        github_state: "授权状态已失效，请重新发起登录。",
        github_failed: params.get("reason") || "GitHub 授权失败，请重试。",
      };
      setError(messages[authError] || "授权登录未完成，请重试。");
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    if (oauthCode) {
      setBusy(true);
      request("/auth/github/exchange", { code: oauthCode })
        .then(result => {
          if (!result.token || !result.user) throw new Error("授权登录响应不完整，请重试");
          sessionStorage.setItem("domainhub_token", result.token);
          setSignedIn({ email: result.user.email, quota: Number(result.user.quota || 0) });
          window.history.replaceState({}, "", window.location.pathname);
        })
        .catch(err => setError(err instanceof Error ? err.message : "GitHub 授权登录失败"))
        .finally(() => setBusy(false));
    }
  }, []);

  const startGithub = () => {
    const query = mode === "register" ? "?mode=register&terms=1.0&privacy=1.0" : "";
    window.location.assign(API + "/auth/github/start" + query);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
    setNotice("");
  };

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await request("/auth/login", { email, password });
      if (!result.token || !result.user) throw new Error("登录响应不完整，请重试");
      sessionStorage.setItem("domainhub_token", result.token);
      setSignedIn({ email: result.user.email, quota: Number(result.user.quota || 0) });
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally { setBusy(false); }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await request("/auth/register", {
        email, password, displayName, termsAccepted, privacyAccepted,
        termsVersion: "1.0", privacyVersion: "1.0",
      });
      setNotice(result.message || "请检查邮箱并完成验证。");
      setCode("");
      setMode("verify");
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally { setBusy(false); }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await request("/auth/email/verify", { email, code });
      setNotice(result.message || "邮箱验证成功，请登录。");
      setCode("");
      setPassword("");
      setMode("login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证失败");
    } finally { setBusy(false); }
  }

  async function resendCode() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await request("/auth/email/verification/send", { email });
      setNotice(result.message || "如果该邮箱对应待验证账户，我们会发送验证邮件。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally { setBusy(false); }
  }

  function logout() {
    sessionStorage.removeItem("domainhub_token");
    setSignedIn(null);
    setEmail("");
    setPassword("");
    setMode("login");
    setNotice("已安全退出登录。");
  }

  return (
    <main className="auth-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <a className="brand" href="/" aria-label="DomainHub 首页">
          <span className="brand-mark">D</span>
          <span>Domain<span className="brand-light">Hub</span></span>
        </a>
        <span className="topbar-note">DOMAIN MANAGEMENT PLATFORM</span>
      </header>

      <section className="auth-layout">
        <div className="intro">
          <div className="eyebrow"><span /> DOMAIN INFRASTRUCTURE, SIMPLIFIED</div>
          <h1>你的域名，<br /><span>由你掌控。</span></h1>
          <p>在一个清晰、可靠的工作空间中管理域名与 DNS。安全登录，从这里开始。</p>
          <div className="intro-points">
            <div><i>01</i><span><b>统一管理</b><small>域名与解析信息一处查看</small></span></div>
            <div><i>02</i><span><b>账户安全</b><small>邮箱验证与安全会话保护</small></span></div>
            <div><i>03</i><span><b>清晰可控</b><small>每项操作都由你主动发起</small></span></div>
          </div>
          <div className="intro-foot"><span className="status-dot" /> DOMAINHUB ACCOUNT GATEWAY</div>
        </div>

        <section className="auth-card" aria-labelledby="auth-title">
          {signedIn ? (
            <div className="success-state">
              <div className="success-icon">✓</div>
              <p className="card-kicker">AUTHENTICATION COMPLETE</p>
              <h2 id="auth-title">登录成功</h2>
              <p className="muted">当前已通过身份验证。</p>
              <div className="account-summary"><span>账户邮箱</span><b>{signedIn.email}</b><span>当前配额</span><b>{signedIn.quota}</b></div>
              <button className="button button-primary" onClick={logout}>退出登录</button>
            </div>
          ) : (
            <>
              <div className="card-heading">
                <p className="card-kicker">WELCOME TO DOMAINHUB</p>
                <h2 id="auth-title">{mode === "register" ? "创建账户" : mode === "verify" ? "验证邮箱" : "欢迎回来"}</h2>
                <p>{mode === "register" ? "填写信息，开启你的域名管理空间。" : mode === "verify" ? "输入发送到邮箱的 6 位验证码。" : "登录你的账户以继续使用 DomainHub。"}</p>
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
                  <label>登录密码<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入密码（至少 12 位）" /></label>
                  <button className="button button-primary" type="submit" disabled={busy}>{busy ? "正在登录…" : "登录账户"}<span>→</span></button>
                  <button className="button button-oauth" type="button" onClick={startGithub} disabled={busy}><span className="github-mark">●</span> 使用 GitHub 授权登录</button>
                  <button type="button" className="text-button forgot-link" onClick={() => { setError(""); setNotice("密码找回功能即将接入。"); }}>忘记密码？</button>
                  <p className="form-foot">尚未拥有账户？ <button type="button" className="text-button" onClick={() => switchMode("register")}>立即注册</button></p>
                </form>
              )}

              {mode === "register" && (
                <form onSubmit={handleRegister} className="auth-form">
                  <label>显示名称 <span className="optional">选填</span><input autoComplete="nickname" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="你希望如何称呼你" maxLength={60} /></label>
                  <label>邮箱地址<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></label>
                  <label>设置密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 12 位，最多 128 位" /></label>
                  <div className="consents">
                    <label className="check-row"><input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} /><span>我已阅读并同意 <a href="#terms">用户服务协议</a></span></label>
                    <label className="check-row"><input type="checkbox" checked={privacyAccepted} onChange={e => setPrivacyAccepted(e.target.checked)} /><span>我已阅读并同意 <a href="#privacy">隐私政策</a></span></label>
                  </div>
                  <button className="button button-primary" type="submit" disabled={busy || !termsAccepted || !privacyAccepted}>{busy ? "正在创建账户…" : "创建账户"}<span>→</span></button>
                  <button className="button button-oauth" type="button" onClick={startGithub} disabled={busy || !termsAccepted || !privacyAccepted}><span className="github-mark">●</span> 使用 GitHub 授权注册</button>
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
      </section>

      <footer className="site-footer"><span>© {new Date().getFullYear()} DOMAINHUB</span><span>SECURE ACCESS · PRIVATE BY DESIGN</span></footer>
    </main>
  );
}

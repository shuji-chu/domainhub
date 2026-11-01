import { useEffect, useState, type FormEvent } from "react";
import { Github } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import "./styles.css";

const API = (import.meta.env.VITE_API_BASE_URL || "https://domainhub-api.chulingli1988.workers.dev").replace(/\/$/, "");
const TOKEN_KEY = "domainhub_token";
type Mode = "login" | "register" | "verify";
type ApiResult = { ok?: boolean; message?: string; error?: string; token?: string; quota?: number; price_usdt?: number; order?: { order_no:string; domain:string; price_usdt:number; currency:string; status:string }; user?: { id: string; email: string; displayName?: string | null; quota?: number }; domains?: Array<{id:string;domain:string;status?:string}> };
type TldQuote = { domain:string; availability:"available"|"unavailable"|"unknown"; availabilityRaw?:string; available:boolean; price:number|null; currency:string; priceClass:string; provider:string; period:string };
type TldOrder = { order_no:string; domain:string; status:string; provider_status?:string|null; provider_error?:string|null };

async function request(path: string, body: Record<string, unknown>): Promise<ApiResult> {
  const response = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as ApiResult;
  if (!response.ok) throw new Error(result.message || (result.error === "internal_error" ? "服务器内部错误，请查看服务端诊断信息" : result.error) || "请求失败，请稍后重试");
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
  const [authOpen, setAuthOpen] = useState(true);
  const [domains, setDomains] = useState<Array<{id:string;domain:string;status?:string}>>([]);
  const [myDomains, setMyDomains] = useState<Array<{id:string;domain:string;status?:string}>>([]);
  const [domainQuery, setDomainQuery] = useState("");
  const [domainsLoading, setDomainsLoading] = useState(false);
  const [claiming, setClaiming] = useState("");
  const [activeTab, setActiveTab] = useState<"subdomains" | "tld">("subdomains");
  const [tldInput, setTldInput] = useState("");
  const [tldQuote, setTldQuote] = useState<TldQuote | null>(null);
  const [tldLoading, setTldLoading] = useState(false);
  const [tldOrderLoading, setTldOrderLoading] = useState(false);
  const [tldOrderStatus, setTldOrderStatus] = useState<TldOrder | null>(null);
  const [page, setPage] = useState("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dnsDomainId, setDnsDomainId] = useState("");
  const [dnsRecords, setDnsRecords] = useState<Array<Record<string, unknown>>>([]);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [serverRows, setServerRows] = useState<Array<Record<string, unknown>>>([]);
  const [serversLoading, setServersLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const menu = [
    { id:"overview", label:"工作台总览", icon:"⌂" },
    { id:"domains", label:"免费二级域名", icon:"◇" },
    { id:"tld", label:"购买顶级域名", icon:"◎" },
    { id:"mine", label:"我的域名", icon:"▤" },
    { id:"dns", label:"DNS 管理", icon:"⌘" },
    { id:"servers", label:"云服务器", icon:"▦" },
    { id:"map", label:"全球资产地图", icon:"◎" },
    { id:"rewards", label:"奖励中心", icon:"✧" },
    { id:"orders", label:"订单记录", icon:"▧" },
    { id:"quota", label:"余额与配额", icon:"◈" },
    { id:"settings", label:"账户设置", icon:"⚙" },
  ];
  function navigate(next: string) {
    setPage(next); setDrawerOpen(false); setPageError(""); setError(""); setNotice("");
    if (next === "domains") setActiveTab("subdomains");
    if (next === "tld") setActiveTab("tld");
    if ((next === "dns" || next === "servers") && !signedIn) { switchMode("login"); return; }
    if (next === "dns" && signedIn) void loadDns();
    if (next === "servers" && signedIn) void loadServers();
  }
  async function loadDns() {
    if (!myDomains.length) { setDnsRecords([]); setPageError("当前账户还没有可管理的 DNSHE 域名。"); return; }
    const chosen = myDomains.find(x => x.id === dnsDomainId) || myDomains[0];
    setDnsDomainId(chosen.id); setDnsLoading(true); setPageError("");
    try {
      const token=sessionStorage.getItem(TOKEN_KEY);
      const res=await fetch(API+"/dns/records?zoneId="+encodeURIComponent(String((chosen as any).dnshe_zone_id||"")),{headers:{Authorization:"Bearer "+token}});
      const data=await res.json();
      if(!res.ok) throw new Error(data.error||"DNS 记录加载失败");
      setDnsRecords(data.records||[]);
    } catch(e) { setPageError(e instanceof Error?e.message:"DNS 记录加载失败"); }
    finally { setDnsLoading(false); }
  }
  async function loadServers() {
    setServersLoading(true); setPageError("");
    try {
      const token=sessionStorage.getItem(TOKEN_KEY);
      const res=await fetch(API+"/api/servers/list",{headers:{Authorization:"Bearer "+token}});
      const data=await res.json();
      if(!res.ok) throw new Error(data.error||"服务器列表加载失败");
      setServerRows(data.droplets||[]);
    } catch(e) { setPageError(e instanceof Error?e.message:"服务器列表加载失败"); }
    finally { setServersLoading(false); }
  }


  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => setCountdown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [countdown > 0]);

  useEffect(() => {
    const savedToken = sessionStorage.getItem(TOKEN_KEY);
    if (savedToken) {
      fetch(API + "/auth/me", { headers: { Authorization: `Bearer ${savedToken}` } })
        .then(async response => {
          const result = await response.json().catch(() => ({})) as ApiResult;
          if (!response.ok || !result.user) throw new Error("会话已失效");
          setSignedIn({ email: result.user.email, quota: Number(result.user.quota || 0) });
          setAuthOpen(false);
        })
        .catch(() => {
          sessionStorage.removeItem(TOKEN_KEY);
          setAuthOpen(true);
          setMode("login");
        });
    }
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
          sessionStorage.setItem(TOKEN_KEY, result.token);
          setSignedIn({ email: result.user.email, quota: Number(result.user.quota || 0) });
          setAuthOpen(false);
          window.history.replaceState({}, "", window.location.pathname);
        })
        .catch(err => setError(err instanceof Error ? err.message : "GitHub 授权登录失败"))
        .finally(() => setBusy(false));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const token = sessionStorage.getItem(TOKEN_KEY);
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    setDomainsLoading(true);
    const mineRequest = signedIn
      ? fetch(API + "/domains/mine", { headers }).then(r => r.json())
      : Promise.resolve({ ok: true, domains: [] });
    Promise.all([
      fetch(API + "/domains", { headers }).then(r => r.json()),
      mineRequest,
    ]).then(([available, mine]) => {
      if (cancelled) return;
      if (available?.ok) setDomains(available.domains || []);
      else if (available?.error) setError(available.error);
      if (mine?.ok) setMyDomains(mine.domains || []);
      if (signedIn && available?.quota !== undefined) setSignedIn(v => v ? { ...v, quota: Number(available.quota) } : v);
    }).catch(() => {
      if (!cancelled) setError("域名列表暂时无法加载，请稍后重试");
    }).finally(() => {
      if (!cancelled) setDomainsLoading(false);
    });
    return () => { cancelled = true; };
  }, [signedIn?.email]);

  const claimDomain = async (id:string) => {
    setClaiming(id); setError(""); setNotice("");
    try {
      const token = sessionStorage.getItem(TOKEN_KEY);
      const response = await fetch(API + "/domains/claim", {method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({inventoryId:id})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "领取域名失败");
      setNotice("域名已成功领取");
      setDomains(v => v.filter(x => x.id !== id));
      setMyDomains(v => [result.domain, ...v]);
      setSignedIn(v => v ? {...v, quota:Number(result.quota ?? Math.max(0,v.quota-1))} : v);
    } catch(err) { setError(err instanceof Error ? err.message : "领取域名失败"); }
    finally { setClaiming(""); }
  };

  const filteredDomains = domains.filter(x => x.domain.toLowerCase().includes(domainQuery.trim().toLowerCase()));

  async function searchTld() {
    setTldLoading(true); setError(""); setNotice(""); setTldQuote(null);
    try {
      const response = await fetch(API + "/tld/search?domain=" + encodeURIComponent(tldInput.trim()));
      const result = await response.json() as TldQuote & { error?: string };
      if (!response.ok) throw new Error(result.error || "Spaceship 实时查询失败");
      setTldQuote(result);
    } catch (err) { setError(err instanceof Error ? err.message : "查询失败，请重试"); }
    finally { setTldLoading(false); }
  }

  async function buyTld() {
    if (!tldQuote) return;
    if (!signedIn) { switchMode("login"); return; }
    setTldOrderLoading(true); setError(""); setNotice(""); setTldOrderStatus(null);
    try {
      const token = sessionStorage.getItem(TOKEN_KEY);
      const response = await fetch(API + "/tld/orders", { method:"POST", headers:{ "Content-Type":"application/json", Authorization:"Bearer " + token }, body:JSON.stringify({domain:tldQuote.domain}) });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.ok || !result.order?.order_no) throw new Error(result.error || "注册商拒绝了本次注册请求");
      let latest: TldOrder = {order_no:result.order.order_no,domain:result.order.domain,status:result.order.status};
      setTldOrderStatus(latest);
      if (latest.status === "pending") {
        for (let attempt=0; attempt<20; attempt++) {
          await new Promise(resolve => window.setTimeout(resolve, 3000));
          const statusResponse = await fetch(API + "/tld/orders/" + encodeURIComponent(latest.order_no), {headers:{Authorization:"Bearer " + token}});
          const statusResult = await statusResponse.json() as {ok?:boolean;error?:string;order?:TldOrder};
          if (!statusResponse.ok || !statusResult.ok || !statusResult.order) throw new Error(statusResult.error || "查询注册进度失败");
          latest = statusResult.order;
          setTldOrderStatus(latest);
          if (latest.status === "completed" || latest.status === "failed") break;
        }
      }
      if (latest.status === "completed") setNotice("域名注册成功，订单号：" + latest.order_no);
      else if (latest.status === "failed") setError(latest.provider_error || "Spaceship 注册失败，请查看订单详情。");
      else setNotice("注册请求已提交，订单号：" + latest.order_no + "；当前状态：" + (latest.status === "pending" ? "注册商仍在处理中，请稍后重新查询订单状态" : "等待注册商确认") + "。");
    } catch (err) { setError(err instanceof Error ? err.message : "订单创建失败"); }
    finally { setTldOrderLoading(false); }
  }

  const startGithub = (purpose: "login" | "register" = "login") => {
    const consent = purpose === "register" ? "?mode=register&terms=1.0&privacy=1.0" : "";
    window.location.assign("https://lynli.me/api/github-oauth/start" + consent);
  };

  const switchMode = (next: Mode) => {
    setAuthOpen(true);
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
      sessionStorage.setItem(TOKEN_KEY, result.token);
      setSignedIn({ email: result.user.email, quota: Number(result.user.quota || 0) });
      setAuthOpen(false);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally { setBusy(false); }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!codeSent || code.length !== 6 || !termsAccepted || !privacyAccepted) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await request("/auth/email/verify", { email, code });
      if (!result.token || !result.user) throw new Error("验证成功，但自动登录响应不完整，请重试");
      sessionStorage.setItem(TOKEN_KEY, result.token);
      setSignedIn({ email: result.user.email, quota: Number(result.user.quota || 0) });
      setAuthOpen(false);
      setNotice(result.message || "注册成功，已自动登录");
      setCode(""); setCodeSent(false);  setCountdown(0);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证码错误或已过期");
    } finally { setBusy(false); }
  }

  async function handleGetCode() {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("请先填写有效的邮箱地址。"); return;
    }
    if (password.length < 12 || password.length > 128) {
      setError("密码长度必须为 12 至 128 位。"); return;
    }
    if (!termsAccepted || !privacyAccepted) {
      setError("请先阅读并同意用户服务协议和隐私政策。"); return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      await (!codeSent
        ? request("/auth/register", {
            email, password, displayName, termsAccepted, privacyAccepted,
            termsVersion: "1.0", privacyVersion: "1.0",
          })
        : request("/auth/email/verification/send", { email }));

      setNotice("发送成功，请去邮箱查看");
      setCodeSent(true);
      setCountdown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证码发送失败");
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
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token) void fetch(API + "/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    sessionStorage.removeItem(TOKEN_KEY);
    setSignedIn(null);
    setAuthOpen(true);
    setEmail("");
    setPassword("");
    setMode("login");
    setNotice("已安全退出登录。");
  }
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

      {signedIn && <button className="drawer-trigger" type="button" aria-label="打开导航菜单" aria-expanded={drawerOpen} onClick={()=>setDrawerOpen(true)}>☰ <span>菜单</span></button>}
      {drawerOpen && <button className="drawer-backdrop" aria-label="关闭导航菜单" onClick={()=>setDrawerOpen(false)} />}
      {signedIn && <aside className={"app-drawer"+(drawerOpen?" open":"")} aria-label="主导航">
        <div className="drawer-head"><strong>DomainHub</strong><button type="button" aria-label="关闭菜单" onClick={()=>setDrawerOpen(false)}>✕</button></div>
        <div className="drawer-user">{signedIn.email}<small>可用二级域名名额：{signedIn.quota}</small></div>
        <nav>{menu.map(item=><button key={item.id} type="button" className={"drawer-item"+(page===item.id?" selected":"")} onClick={()=>navigate(item.id)}><b aria-hidden="true">{item.icon}</b><span>{item.label}</span><i>›</i></button>)}</nav>
        <button className="drawer-logout" type="button" onClick={logout}>退出登录</button>
      </aside>}
      {(!signedIn || page==="domains" || page==="tld") ?       <motion.section className="home-content" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }}>
        <div className="home-heading">
          <div className="eyebrow"><span /> 域名资源中心</div>
          <h1>寻找合适的域名。<br /><span>从这里开始。</span></h1>
          <p>查找可用域名，登录后即可领取与管理。</p>
        </div>
                <div className="domain-tabs" role="tablist" aria-label="域名类型">
          <button type="button" role="tab" aria-selected={activeTab === "subdomains"} className={activeTab === "subdomains" ? "active" : ""} onClick={() => setActiveTab("subdomains")}>二级域名库存</button>
          <button type="button" role="tab" aria-selected={activeTab === "tld"} className={activeTab === "tld" ? "active" : ""} onClick={() => setActiveTab("tld")}>顶级域名搜索</button>
        </div>
        {error && !authOpen && <div className="feedback feedback-error home-feedback" role="alert">{error}</div>}
        {notice && !authOpen && <div className="feedback feedback-success home-feedback" role="status">{notice}</div>}
        {activeTab === "subdomains" ? (
          <>
            <label className="domain-search home-search">
              <span>⌕</span>
              <input value={domainQuery} onChange={e => setDomainQuery(e.target.value)} placeholder="搜索 DNSHE 实时库存…" aria-label="搜索二级域名库存" />
            </label>
            <div className="domain-section-head"><h3>DNSHE 可领取库存</h3><span>{filteredDomains.length} 个</span></div>
            <div className="domain-list public-domain-list">
              {domainsLoading ? <div className="empty-domains">正在加载域名…</div> : filteredDomains.length ? filteredDomains.map(item => (
                <div className="domain-row" key={item.id}>
                  <div className="domain-name"><span className="domain-dot" /><b>{item.domain}</b></div>
                  <button className="claim-button" disabled={!!claiming || (!!signedIn && signedIn.quota < 1)} onClick={() => signedIn ? void claimDomain(item.id) : switchMode("login")}>
                    {claiming === item.id ? "处理中…" : signedIn ? (signedIn.quota > 0 ? "领取" : "配额不足") : "登录后领取"}
                  </button>
                </div>
              )) : <div className="empty-domains">{domainQuery ? "没有匹配的域名" : "DNSHE 暂无可领取库存"}</div>}
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
          </>
        ) : (
          <div className="tld-panel">
            <p className="tld-intro">输入完整域名查询 Spaceship 实时价格与可用状态，例如 myname.com。点击“立即下单”将直接向注册商提交注册请求。</p>
            <div className="domain-search tld-search">
              <span>⌕</span>
              <input value={tldInput} onChange={e => setTldInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void searchTld(); }} placeholder="myname.com" aria-label="输入顶级域名" />
              <button type="button" className="claim-button" disabled={tldLoading || !tldInput.trim()} onClick={() => void searchTld()}>{tldLoading ? "查询中…" : "查价"}</button>
            </div>
            {tldQuote && (
              <div className="tld-quote">
                <div><span className="tld-label">查询域名</span><strong>{tldQuote.domain}</strong></div>
                <div><span className="tld-label">实时可用性</span><strong className={tldQuote.available ? "tld-available" : "tld-unavailable"}>{tldQuote.availability === "available" ? "可以注册" : tldQuote.availability === "unavailable" ? "已被注册" : "暂时无法确认"}</strong></div>
                <div><span className="tld-label">Spaceship 实时报价</span><strong className="tld-price">{tldQuote.price == null ? "暂无报价" : tldQuote.price.toFixed(2) + " " + tldQuote.currency} <small>/ 年</small></strong></div>
                <p>数据来自 Spaceship 实时 API；域名价格可能因高级域名、促销和注册局规则变化。</p>
                {tldOrderStatus && <p role="status">订单 {tldOrderStatus.order_no}：{tldOrderStatus.status === "completed" ? "注册成功" : tldOrderStatus.status === "failed" ? "注册失败" : tldOrderStatus.status === "pending" ? "注册商处理中" : "已提交"}</p>}
                <button type="button" className="button button-primary tld-buy" disabled={tldOrderLoading || !tldQuote.available} onClick={() => void buyTld()}>{tldOrderLoading ? "正在提交注册…" : tldQuote.available ? "立即下单" : "当前不可注册"}</button>
              </div>
            )}
          </div>
        )}
      </motion.section>
      : <motion.section className="home-content workspace-content" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}>
          <div className="workspace-page-head"><div className="eyebrow"><span/> DOMAINHUB WORKSPACE</div><h1>{menu.find(x=>x.id===page)?.label}</h1><p>通过真实账户数据与已连接的服务管理你的资产。</p></div>
          {pageError && <div className="feedback feedback-error" role="alert">{pageError}</div>}
          {page==="overview" && <><div className="overview-grid">
            <button onClick={()=>navigate("mine")}><span>我的域名</span><strong>{myDomains.length}</strong><small>查看已领取域名</small></button>
            <button onClick={()=>navigate("quota")}><span>可用配额</span><strong>{signedIn?.quota??0}</strong><small>查看名额来源</small></button>
            <button onClick={()=>navigate("servers")}><span>云服务器</span><strong>查看</strong><small>读取 DigitalOcean 账户资源</small></button>
          </div><section className="workspace-card"><h2>快捷入口</h2><div className="workspace-shortcuts"><button onClick={()=>navigate("domains")}>领取免费二级域名 →</button><button onClick={()=>navigate("tld")}>查询顶级域名 →</button><button onClick={()=>navigate("dns")}>管理 DNS 记录 →</button></div></section></>}
          {page==="mine" && <section className="workspace-card"><h2>我的域名 <small>{myDomains.length} 个</small></h2>{myDomains.length?myDomains.map(d=><div className="asset-row" key={d.id}><strong>{d.domain}</strong><span>{d.status||"active"}</span><button onClick={()=>{setDnsDomainId(d.id);navigate("dns");}}>管理 DNS</button></div>):<p>账户尚未领取域名。前往免费二级域名页面领取。</p>}</section>}
          {page==="dns" && <section className="workspace-card"><h2>DNS 记录管理</h2><div className="workspace-toolbar"><select aria-label="选择域名" value={dnsDomainId} onChange={e=>{setDnsDomainId(e.target.value);}}>{myDomains.map(d=><option key={d.id} value={d.id}>{d.domain}</option>)}</select><button onClick={()=>void loadDns()} disabled={dnsLoading||!myDomains.length}>{dnsLoading?"加载中…":"刷新记录"}</button></div>{dnsLoading?<p>正在读取 DNSHE 记录…</p>:dnsRecords.length?<div className="dns-table"><div className="dns-row dns-head"><b>类型</b><b>名称</b><b>内容</b><b>TTL</b></div>{dnsRecords.map((r,i)=><div className="dns-row" key={String(r.id||i)}><span>{String(r.type||"—")}</span><span>{String(r.name||"—")}</span><span>{String(r.content||r.value||"—")}</span><span>{String(r.ttl||"自动")}</span></div>)}</div>:<p>没有读取到 DNS 记录，或当前域名暂无记录。</p>}<p className="reward-note">当前页面读取 DNSHE 实时记录；新增、修改和删除操作将在对应接口与权限校验完整后开放。</p></section>}
          {page==="servers" && <section className="workspace-card"><h2>DigitalOcean 云服务器</h2><div className="workspace-toolbar"><span>仅显示当前账户关联的真实 Droplet</span><button onClick={()=>void loadServers()} disabled={serversLoading}>{serversLoading?"同步中…":"刷新列表"}</button></div>{serversLoading?<p>正在读取 DigitalOcean…</p>:serverRows.length?serverRows.map((d,i)=><div className="asset-row" key={String(d.id||i)}><div><strong>{String(d.name||"Droplet")}</strong><small>{String(d.region||"")} · {String(d.size||"")}</small></div><span>{String(d.status||"unknown")}</span><code>{String(d.ip||"尚无公网 IP")}</code></div>):<p>当前账户暂无关联的云服务器。服务器创建目前受后端管理员权限和计费配置限制。</p>}</section>}
          {page==="quota" && <section className="workspace-card"><h2>域名配额</h2><div className="quota-large">{signedIn?.quota??0}</div><p>当前可用二级域名领取名额。注册赠送与活动奖励以服务端配额账本为准。</p><button onClick={()=>navigate("rewards")}>查看奖励规则</button></section>}
          {page==="map" && <section className="workspace-card"><h2>全球资产地图</h2><div className="map-notice"><strong>地图数据准备中</strong><p>地图将只标记已关联的真实服务器区域与域名资产。当前服务器区域接口尚未接入地图数据源，因此不会显示虚构坐标。</p><button onClick={()=>navigate("servers")}>查看真实服务器资源</button></div></section>}
          {page==="rewards" && <section className="workspace-card"><h2>新用户奖励规则</h2><div className="reward-row"><div><strong>完成注册</strong><span>新账户注册成功赠送 1 个二级域名名额</span></div><b>+1 名额</b></div><div className="reward-row"><div><strong>GitHub Star</strong><span>关注项目并为 shuji-chu/domainhub 点 Star，待服务端核验后发放</span></div><a href="https://github.com/shuji-chu/domainhub" target="_blank" rel="noreferrer">打开 GitHub</a></div><div className="reward-row"><div><strong>Telegram 社群与机器人</strong><span>加入官方群并启动 @DNSlynlimeBOT 后核验发放；机器人部署完成后启用</span></div><b>+1 名额</b></div><p className="reward-note">奖励状态与领取接口尚未接入，此处仅展示已确定的规则，不会提前增加配额。</p></section>}
          {page==="orders" && <section className="workspace-card"><h2>订单记录</h2><p>当前 Worker 已提供顶级域名下单接口，但尚未提供用户订单查询接口。为避免展示不完整或伪造的订单，订单列表暂不显示。</p><button onClick={()=>navigate("tld")}>前往域名查询与下单</button></section>}
          {page==="settings" && <section className="workspace-card"><h2>账户信息</h2><div className="asset-row"><strong>登录邮箱</strong><span>{signedIn?.email}</span></div><div className="asset-row"><strong>当前配额</strong><span>{signedIn?.quota??0}</span></div><p>账户安全设置与密码修改接口尚未开放。</p><button className="drawer-logout" onClick={logout}>退出登录</button></section>}
        </motion.section>}

      <footer className="site-footer"><span>© {new Date().getFullYear()} DomainHub</span><span>安全 · 简洁 · 自主掌控</span></footer>
      {authOpen && !signedIn && (
        <div className="auth-overlay" role="dialog" aria-modal="true" aria-labelledby="auth-title">
          <div className="flex min-h-screen w-full items-center justify-center px-4 py-6">
            <section className="auth-card auth-modal w-full max-w-md min-w-0" aria-labelledby="auth-title">
              <div className="auth-card-toolbar">
                <span aria-hidden="true" />
              </div>
              <div className="card-heading">
                <div className="card-brand"><img src="/logo.svg" alt="DomainHub" /><span>Domain<span>Hub</span></span></div>
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
                  <label>邮箱地址<Input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="请输入邮箱地址" /></label>
                  <label>登录密码<Input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入密码" /></label>
                  <Button className="button button-primary" type="submit" disabled={busy}>{busy ? "正在登录…" : "登录账户"}<span>→</span></Button>
                  <div className="consents oauth-consents">
                    <label className="check-row"><input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} /><span>我已阅读并同意 <a href="#terms">用户服务协议</a></span></label>
                    <label className="check-row"><input type="checkbox" checked={privacyAccepted} onChange={e => setPrivacyAccepted(e.target.checked)} /><span>我已阅读并同意 <a href="#privacy">隐私政策</a></span></label>
                  </div>
                  <button className="button button-oauth" type="button" onClick={() => startGithub("register")} disabled={busy || !termsAccepted || !privacyAccepted}><Github size={18} strokeWidth={2.2} aria-hidden="true" /> 使用 GitHub 授权登录 / 新用户自动注册</button>
                  <p className="form-foot">还没有账户？ <button type="button" className="text-button" onClick={() => switchMode("register")}>立即注册</button></p>
                </form>
              )}

              {mode === "register" && (
                <form onSubmit={handleRegister} className="auth-form">
                  <label>显示名称 <span className="optional">选填</span><Input autoComplete="nickname" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="请输入显示名称" maxLength={60} disabled={codeSent} /></label>
                  <label>邮箱地址<Input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="请输入邮箱地址" disabled={codeSent} /></label>
                  <label>设置密码<Input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入 12 至 128 位密码" disabled={codeSent} /></label>
                  <div className="verification-row">
                    <label>邮箱验证码<Input className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="输入 6 位验证码" /></label>
                    <button className="button button-code" type="button" onClick={() => void handleGetCode()} disabled={busy || countdown > 0 || !email || !password || !termsAccepted || !privacyAccepted}>{busy ? "发送中…" : countdown > 0 ? `${countdown} 秒后重发` : codeSent ? "重新获取" : "获取验证码"}</button>
                  </div>
                  <p className="hint">{codeSent ? "验证码已发送至邮箱，有效期 10 分钟；邮箱、密码和显示名称已锁定。" : "请先填写邮箱和密码，并勾选下方协议后获取验证码。"}</p>
                  <div className="consents">
                    <label className="check-row"><input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} disabled={codeSent} /><span>我已阅读并同意 <a href="#terms">用户服务协议</a></span></label>
                    <label className="check-row"><input type="checkbox" checked={privacyAccepted} onChange={e => setPrivacyAccepted(e.target.checked)} disabled={codeSent} /><span>我已阅读并同意 <a href="#privacy">隐私政策</a></span></label>
                  </div>
                  <Button className="button button-primary" type="submit" disabled={busy || !termsAccepted || !privacyAccepted || !codeSent || code.length !== 6}>{busy ? "正在验证并创建…" : "创建账户"}<span>→</span></Button>
                  <button className="button button-oauth" type="button" onClick={() => startGithub("register")} disabled={busy || !termsAccepted || !privacyAccepted}><Github size={18} strokeWidth={2.2} aria-hidden="true" /> 使用 GitHub 授权注册 / 登录</button>
                  <p className="form-foot">已有账户？ <button type="button" className="text-button" onClick={() => switchMode("login")}>返回登录</button></p>
                </form>
              )}

              {mode === "verify" && (
                <form onSubmit={handleVerify} className="auth-form">
                  <div className="verify-email">{email}</div>
                  <label>6 位邮箱验证码<Input className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="输入 6 位验证码" /></label>
                  <Button className="button button-primary" type="submit" disabled={busy || code.length !== 6}>{busy ? "正在验证…" : "验证邮箱"}<span>→</span></Button>
                  <div className="verify-actions"><button type="button" className="text-button" onClick={() => void resendCode()} disabled={busy}>重新发送验证码</button><button type="button" className="text-button subtle" onClick={() => switchMode("register")}>返回修改信息</button></div>
                  <p className="hint">验证码有效期为 10 分钟。若未收到，请检查垃圾邮件文件夹。</p>
                </form>
              )}
            </section>
          </div>
        </div>
      )}
    </main>
  );
}
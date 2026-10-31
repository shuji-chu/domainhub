import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  return (
    <main className="page">
      <section className="panel">
        <div className="mark">DH</div>
        <p className="eyebrow">DOMAINHUB</p>
        <h1>管理后台开发中</h1>
        <p className="description">管理后台正在建设中，敬请期待。</p>
        <span className="status">即将上线</span>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);

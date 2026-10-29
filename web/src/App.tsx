import { useEffect, useState } from 'react';

type PanelVersion = { product: string; version: string; stage: string };

const modules = [
  { mark: '01', title: '节点资源管理', detail: 'VPS / NAT / 地址和端口映射资源模型', status: 'M1 规划' },
  { mark: '02', title: '代理服务编排', detail: 'sing-box / Xray / Realm 生命周期与配置版本', status: 'M2–M3 规划' },
  { mark: '03', title: '任务与审计', detail: '有界任务、状态回执、失败回滚和操作追踪', status: 'M0–M2 规划' },
  { mark: '04', title: '订阅与拓扑', detail: 'Mihomo / Loon 订阅、多节点中转链路', status: 'M3–M4 规划' },
];

export default function App() {
  const [version, setVersion] = useState<PanelVersion | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/version', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as PanelVersion;
      })
      .then(setVersion)
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '未知错误');
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="导航">
        <div className="brand"><span className="brand-icon">V</span><div><b>Viorka</b><small>by Vioira</small></div></div>
        <p className="nav-label">WORKSPACE</p>
        <div className="nav active">◈ <span>Overview</span></div>
        <div className="nav muted">▤ <span>Nodes <em>Planned</em></span></div>
        <div className="nav muted">◇ <span>Services <em>Planned</em></span></div>
        <div className="nav muted">↗ <span>Topology <em>Planned</em></span></div>
        <div className="nav muted">◷ <span>Tasks <em>Planned</em></span></div>
        <div className="side-bottom">Scaffold · 0.1.0<br /><span>Not production-ready</span></div>
      </aside>
      <main className="content">
        <div className="topbar"><span>Infrastructure / Overview</span><span className="top-pill">ARCHITECTURE PREVIEW</span></div>
        <header className="intro"><div className="eyebrow">VIORKA CONTROL PLANE</div><h1>One console.<br /><span>Every server. Every service.</span></h1><p>以轻量 Agent 统一管理 VPS / NAT 资源，并对代理与中转服务进行声明式编排。</p></header>
        <section className="status-area" aria-label="后端状态">
          <div><div className="subhead">API CONNECTIVITY</div><h2>{version ? 'Backend connected' : error ? 'Backend unavailable' : 'Connecting...'}</h2><div className="subtle">{version ? `${version.product} ${version.version}` : error ? `请启动 Go Server：${error}` : 'Checking /api/v1/version'}</div></div>
          <span className={`state ${version ? 'good' : error ? 'bad' : 'waiting'}`}>{version ? 'HTTP API UP' : error ? 'DISCONNECTED' : 'CHECKING'}</span>
        </section>
        <div className="section-title"><h2>Planned modules</h2><span>设计清单 · 未实现</span></div>
        <div className="cards">{modules.map((item) => <article className="card" key={item.mark}><div className="number">{item.mark}</div><h3>{item.title}</h3><p>{item.detail}</p><small>{item.status}</small></article>)}</div>
        <footer>Viorka is an architecture scaffold. UI controls for managing real servers are intentionally not enabled.</footer>
      </main>
    </div>
  );
}

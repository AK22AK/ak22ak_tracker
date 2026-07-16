"use client";

import { useSyncExternalStore } from "react";

function subscribeToNetworkState(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

export function DashboardShell({ today }: { today: string }) {
  const online = useSyncExternalStore(
    subscribeToNetworkState,
    () => navigator.onLine,
    () => true,
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">AK Tracker</p>
          <h1>{today}</h1>
        </div>
        <div className={`network-pill ${online ? "online" : "offline"}`}>
          <span aria-hidden="true" />
          {online ? "已联网" : "离线记录"}
        </div>
      </header>

      <section className="hero-card" aria-labelledby="today-plan-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow light">今日计划</p>
            <h2 id="today-plan-title">等待导入私人计划</h2>
          </div>
          <span className="count-badge">0 / 0</span>
        </div>
        <p className="hero-copy">
          工程骨架已经就绪。接通身份认证和私人数据库后，这里会按当前计划版本显示任务。
        </p>
        <div className="empty-task">
          <span className="empty-checkbox" aria-hidden="true" />
          <div>
            <strong>计划任务由你手动确认完成</strong>
            <p>Garmin 记录只提供关联建议，不会自动勾选。</p>
          </div>
        </div>
      </section>

      <section className="feedback-card" aria-labelledby="feedback-title">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">每日反馈</p>
            <h2 id="feedback-title">今天还没有记录</h2>
          </div>
          <span className="status-dot" aria-label="待反馈" />
        </div>
        <p>计划启用后，可随时提交疼痛、肿胀、功能表现和主观感受。</p>
        <button type="button" disabled>
          添加反馈
        </button>
      </section>

      <section className="status-grid" aria-label="同步状态">
        <article>
          <span className="status-icon">G</span>
          <div>
            <strong>Garmin</strong>
            <p>等待配置</p>
          </div>
        </article>
        <article>
          <span className="status-icon">↗</span>
          <div>
            <strong>数据镜像</strong>
            <p>等待配置</p>
          </div>
        </article>
      </section>

      <nav className="bottom-nav" aria-label="主导航">
        <a href="#" aria-current="page">
          <span aria-hidden="true">⌂</span>
          今日
        </a>
        <a href="#">
          <span aria-hidden="true">✓</span>
          记录
        </a>
        <a href="#">
          <span aria-hidden="true">⌁</span>
          趋势
        </a>
        <a href="#">
          <span aria-hidden="true">•••</span>
          设置
        </a>
      </nav>
    </main>
  );
}

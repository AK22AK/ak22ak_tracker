export default function ProtectedRouteLoading() {
  return (
    <main className="app-shell page-frame" aria-busy="true">
      <header className="topbar">
        <div>
          <p className="eyebrow">AK Tracker</p>
          <h1>正在切换页面</h1>
        </div>
      </header>
      <section className="feedback-card page-section-loading" role="status">
        正在加载页面内容…
      </section>
    </main>
  );
}

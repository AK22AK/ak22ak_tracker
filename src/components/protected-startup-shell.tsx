export function ProtectedStartupShell() {
  return (
    <main
      className="app-shell page-frame protected-startup-shell"
      data-startup-shell="true"
      aria-label="AK Tracker 启动页面"
      aria-busy="true"
    >
      <header className="topbar">
        <div>
          <p className="eyebrow">AK Tracker</p>
          <h1>正在安全打开</h1>
        </div>
      </header>
      <section className="surface-card page-section-loading" role="status">
        正在准备应用…
      </section>
    </main>
  );
}

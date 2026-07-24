const tabLabels = {
  "/": "今日",
  "/calendar": "日历",
  "/trends": "趋势",
  "/settings": "设置",
} as const;

function labelForPath(pathname: string) {
  return (
    Object.entries(tabLabels).find(([path]) =>
      path === "/" ? pathname === path : pathname.startsWith(path),
    )?.[1] ?? "页面"
  );
}

export function TabTransitionFrame({ pathname }: { pathname: string }) {
  const label = labelForPath(pathname);
  return (
    <main
      className="app-shell page-frame"
      aria-label={`${label}页面框架`}
      aria-busy="true"
    >
      <header className="topbar">
        <div>
          <p className="eyebrow">AK Tracker</p>
          <h1>{label}</h1>
        </div>
      </header>
      <section className="feedback-card page-section-loading" role="status">
        正在切换到{label}…
      </section>
    </main>
  );
}

export function UnavailableFeaturePage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <main className="app-shell page-frame" aria-label={`${title}页面`}>
      <header className="topbar">
        <div>
          <p className="eyebrow">AK Tracker</p>
          <h1>{title}</h1>
        </div>
      </header>
      <section className="feedback-card empty-tab-state">
        <h2>暂未开放</h2>
        <p>{description}</p>
      </section>
    </main>
  );
}

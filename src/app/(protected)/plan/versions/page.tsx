import Link from "next/link";

export default function PlanVersionsPage() {
  return (
    <main className="app-shell page-frame settings-detail-page">
      <header className="settings-detail-header">
        <div>
          <p className="eyebrow">计划</p>
          <h1>计划版本</h1>
        </div>
        <Link href="/plan">返回</Link>
      </header>
      <section className="surface-card">
        <h2>版本记录</h2>
        <p>接受调整或执行回滚后，版本变化会在调整方案中保留完整记录。</p>
        <Link href="/plan/advice">查看调整方案</Link>
      </section>
    </main>
  );
}

import { expect, test } from "@playwright/test";

test("pending-command status and confirmation fit a mobile viewport", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.evaluate(() => {
    document.body.innerHTML = `
      <div class="protected-app-shell">
        <section class="pwa-update-banner" aria-labelledby="pwa-update-title">
          <div aria-live="polite"><strong id="pwa-update-title">新版本可用</strong><p>更新不会删除 2 条仅保存在本机的记录。</p></div>
          <div class="pwa-update-actions"><button class="secondary-button" type="button">稍后</button><button class="primary-button" type="button">立即更新</button></div>
        </section>
        <main class="app-shell page-frame pending-command-page">
          <header class="topbar pending-command-header">
            <div><p class="eyebrow">隐私与离线</p><h1>待同步记录</h1></div>
            <a class="text-button" href="/settings">返回设置</a>
          </header>
          <section class="surface-card pending-command-intro">
            <div><strong>2 条本机记录</strong><p>最早一条处理完成后，后面的记录会继续同步。</p></div>
            <span class="status-pill" data-tone="success">当前在线</span>
          </section>
          <section class="pending-command-list" aria-label="待同步队列">
            <article class="surface-card pending-command-card">
              <div class="pending-command-card-heading">
                <div><span class="queue-position">最早一条</span><h2>任务更新</h2></div>
                <span class="status-pill" data-tone="attention">需要人工处理</span>
              </div>
              <dl class="pending-command-facts">
                <div><dt>计划日期</dt><dd>2026-07-20</dd></div>
                <div><dt>发生时间</dt><dd>18:00</dd></div>
              </dl>
              <p class="pending-command-summary">标记任务完成</p>
              <p class="pending-command-explanation">这条记录暂时无法自动同步，需要你决定如何处理。</p>
              <div class="pending-command-confirmation" role="alert">
                <strong>确认放弃这条本机记录？</strong>
                <p>确认当前记录后再移除这一条；后续记录不会被删除。</p>
                <div>
                  <button class="secondary-button" type="button">取消</button>
                  <button class="primary-button" type="button">确认放弃</button>
                </div>
              </div>
            </article>
            <article class="surface-card pending-command-card">
              <div class="pending-command-card-heading">
                <div><span class="queue-position">等待前一条</span><h2>身体反馈</h2></div>
                <span class="status-pill" data-tone="warning">等待重试</span>
              </div>
              <p class="pending-command-summary">训练后反馈 · 本机预估绿灯</p>
            </article>
          </section>
        </main>
      </div>`;
  });

  await expect(page.getByRole("heading", { name: "待同步记录" })).toBeVisible();
  await expect(page.getByText("新版本可用")).toBeVisible();
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    buttons: [...document.querySelectorAll("button")].map(
      (button) => button.getBoundingClientRect().height,
    ),
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
  expect(viewport.buttons.every((height) => height >= 44)).toBe(true);
});

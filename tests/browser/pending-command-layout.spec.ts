import { expect, test } from "@playwright/test";

test("pending-command status and confirmation fit a mobile viewport", async ({
  page,
}) => {
  await page.goto("/login");
  await page.evaluate(() => {
    document.body.innerHTML = `
      <div class="protected-app-shell">
        <main class="app-shell page-frame pending-command-page">
          <header class="topbar pending-command-header">
            <div><p class="eyebrow">隐私与离线</p><h1>待同步记录</h1></div>
            <a class="text-button" href="/settings">返回设置</a>
          </header>
          <section class="surface-card pending-command-intro">
            <div><strong>2 条本机记录</strong><p>系统严格按创建顺序处理；队首未解决时，后续记录不会越过它。</p></div>
            <span class="status-pill" data-tone="success">当前在线</span>
          </section>
          <section class="pending-command-list" aria-label="待同步队列">
            <article class="surface-card pending-command-card">
              <div class="pending-command-card-heading">
                <div><span class="queue-position">队首</span><h2>任务更新</h2></div>
                <span class="status-pill" data-tone="attention">需要人工处理</span>
              </div>
              <dl class="pending-command-facts">
                <div><dt>计划日期</dt><dd>2026-07-20</dd></div>
                <div><dt>发生时间</dt><dd>18:00</dd></div>
              </dl>
              <p class="pending-command-summary">标记任务完成</p>
              <p class="pending-command-explanation">服务器中的记录已变化，需要人工决定如何处理这条本机记录。</p>
              <div class="pending-command-confirmation" role="alert">
                <strong>确认放弃队首本机记录？</strong>
                <p>系统会先在线确认服务器状态，再移除这一条；后续记录不会被删除。</p>
                <div>
                  <button class="secondary-button" type="button">取消</button>
                  <button class="primary-button" type="button">确认放弃</button>
                </div>
              </div>
            </article>
            <article class="surface-card pending-command-card">
              <div class="pending-command-card-heading">
                <div><span class="queue-position">被队首阻塞</span><h2>身体反馈</h2></div>
                <span class="status-pill" data-tone="warning">等待重试</span>
              </div>
              <p class="pending-command-summary">训练后反馈 · 本机预判绿灯</p>
            </article>
          </section>
        </main>
      </div>`;
  });

  await expect(page.getByRole("heading", { name: "待同步记录" })).toBeVisible();
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

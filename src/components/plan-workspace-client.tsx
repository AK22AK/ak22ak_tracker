"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { trackerQueryKeys } from "@/client/query-keys";
import { fetchPlanWorkspace } from "@/client/tracker-api";

const trackerKey = "knee-rehab";

function shortDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00+08:00`));
}

export function PlanWorkspaceClient() {
  const query = useQuery({
    queryKey: trackerQueryKeys.planWorkspace(trackerKey),
    queryFn: ({ signal }) => fetchPlanWorkspace(trackerKey, signal),
    staleTime: 60_000,
  });
  const data = query.data;

  return (
    <main
      className="app-shell page-frame plan-workspace-page"
      aria-label="计划页面"
    >
      <header className="trend-page-header">
        <div>
          <p className="eyebrow">康复安排</p>
          <h1>计划</h1>
        </div>
      </header>

      {!data && query.isPending ? (
        <section className="surface-card page-section-loading" role="status">
          正在整理计划…
        </section>
      ) : null}
      {!data && query.isError ? (
        <section className="surface-card" role="alert">
          <h2>计划暂时无法加载</h2>
          <p>可以稍后重试；今天的任务和已保存记录不受影响。</p>
        </section>
      ) : null}
      {data ? (
        <section className="surface-card plan-workspace-summary">
          <div className="plan-workspace-heading-row">
            <div>
              <p className="eyebrow">当前计划</p>
              <h2>
                {data.currentWeek ? `第 ${data.currentWeek} 周` : "尚未开始"}
              </h2>
            </div>
            {data.plan ? <span>版本 {data.plan.version}</span> : null}
          </div>
          <div>
            <strong>当前目标</strong>
            <p>{data.goals[0] ?? "尚未填写康复目标"}</p>
          </div>
          <div>
            <strong>下一次训练</strong>
            {data.nextTraining ? (
              <>
                <p>
                  {shortDate(data.nextTraining.localDate)} ·{" "}
                  {data.nextTraining.taskCount} 项训练
                </p>
                {data.nextTraining.titles.length > 0 ? (
                  <p>{data.nextTraining.titles.join("、")}</p>
                ) : null}
              </>
            ) : (
              <p>当前计划里没有后续训练</p>
            )}
          </div>
          <Link href="/calendar">打开训练日历</Link>
        </section>
      ) : null}

      <section className="surface-card plan-assistant-entry">
        <p className="eyebrow">康复助手</p>
        <h2>说说最近的训练和身体感受</h2>
        <p>助手会结合当前计划和近期记录回答，不会自动修改计划。</p>
        <Link className="primary-button" href="/plan/conversation">
          和康复助手聊聊
        </Link>
      </section>

      {data?.pendingAdviceCount ? (
        <Link className="surface-card plan-pending-advice" href="/plan/advice">
          <span>待确认建议</span>
          <strong>{data.pendingAdviceCount} 条待确认建议</strong>
        </Link>
      ) : null}

      <nav className="plan-workspace-links" aria-label="计划工具">
        <Link href="/plan/review">近期回顾</Link>
        <Link href="/plan/advice">调整方案</Link>
        <Link href="/plan/evaluation">阶段评估</Link>
        <Link href="/plan/versions">计划版本</Link>
        <Link href="/plan/profile">康复档案</Link>
        <Link href="/plan/memories">助手记忆</Link>
      </nav>
    </main>
  );
}

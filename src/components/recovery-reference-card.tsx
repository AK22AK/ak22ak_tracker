import type { GarminRecoveryReference } from "@/domain/garmin";

import { SectionHeading, StatusPill, SurfaceCard } from "./ui/primitives";

function formatSleep(seconds: number) {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} 小时 ${minutes} 分钟`;
}

function formatSyncedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export function RecoveryReferenceCard({
  reference,
  compact = false,
}: {
  reference: GarminRecoveryReference | null | undefined;
  compact?: boolean;
}) {
  if (!reference) {
    return (
      <SurfaceCard className="recovery-reference-card" aria-label="恢复参考">
        <SectionHeading eyebrow="恢复参考" title="暂无睡眠与步数记录" />
        <p className="empty-state-copy">可在设置中选择一天同步 Garmin 数据。</p>
        <small>仅作恢复参考，不代替身体反馈。</small>
      </SurfaceCard>
    );
  }
  const latestSync =
    reference.steps.syncedAt > reference.sleep.syncedAt
      ? reference.steps.syncedAt
      : reference.sleep.syncedAt;
  return (
    <SurfaceCard className="recovery-reference-card" aria-label="恢复参考">
      <SectionHeading
        eyebrow="恢复参考"
        title={compact ? "睡眠与步数" : "昨夜睡眠与今日步数"}
        aside={<StatusPill tone="brand">Garmin</StatusPill>}
      />
      <div className="recovery-reference-grid">
        <div>
          <span>睡眠</span>
          <strong>
            {reference.sleep.status === "available" &&
            reference.sleep.totalSleepSeconds !== null
              ? formatSleep(reference.sleep.totalSleepSeconds)
              : "暂无数据"}
          </strong>
          {reference.sleep.sleepScore !== null ? (
            <small>睡眠评分 {reference.sleep.sleepScore}</small>
          ) : null}
        </div>
        <div>
          <span>步数</span>
          <strong>
            {reference.steps.status === "available" &&
            reference.steps.totalSteps !== null
              ? `${reference.steps.totalSteps.toLocaleString("zh-CN")} 步`
              : "暂无数据"}
          </strong>
          {reference.steps.stepGoal !== null ? (
            <small>
              目标 {reference.steps.stepGoal.toLocaleString("zh-CN")} 步
            </small>
          ) : null}
        </div>
      </div>
      <p className="recovery-reference-meta">
        截至最近同步：{formatSyncedAt(latestSync)}
      </p>
      <small>仅作恢复参考，不代替身体反馈。</small>
    </SurfaceCard>
  );
}

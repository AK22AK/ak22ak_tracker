"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { trackerQueryKeys } from "@/client/query-keys";
import { fetchTodayAggregate } from "@/client/tracker-api";
import type { TodayAggregate } from "@/domain/api-contracts";
import {
  createOrReuseClientCommand,
  type PendingClientCommand,
} from "@/domain/client-command";
import { localDateInTimeZone } from "@/domain/planning-time";
import {
  safetyPolicyReference,
  type SafetyLevel,
  type TrackerSafetyPolicy,
} from "@/domain/safety-policy";
import {
  evaluateKneeCheckIn,
  kneeCheckInInputSchema,
  type KneeCheckInInput,
} from "@/modules/knee-rehab/check-in";

import { StatusPill } from "./ui/primitives";
import { useOfflineCommands } from "@/offline/offline-command-context";
import { usePrivateOfflineIdentity } from "@/offline/private-offline-context";
import { useQuerySnapshot } from "@/offline/use-query-snapshot";
import type { OfflineTodaySnapshot } from "@/offline/snapshot-contracts";
import { readSafetyPolicy, saveSafetyPolicy } from "@/offline/safety-policies";
import { offlineDatabase } from "@/offline/store";
import { projectTodayPendingCommands } from "@/offline/command-projection";

const trackerKey = "knee-rehab";
const planningTimeZone = "Asia/Shanghai";

const emptyDraft: KneeCheckInInput = {
  timing: "post_training",
  leftPain: 0,
  rightPain: 0,
  swelling: "none",
  stiffness: false,
  mechanicalSymptoms: false,
  weightBearingIssue: false,
  localizedBonePain: false,
  nightOrRestPain: false,
  note: "",
};

function safetyLabel(level: SafetyLevel) {
  if (level === "red") return "红灯";
  if (level === "yellow") return "黄灯";
  return "绿灯";
}

function safetyGuidance(level: SafetyLevel) {
  if (level === "red") {
    return "停止相关诱发负荷；若未迅速恢复或反复出现，应联系专业人员。";
  }
  if (level === "yellow") {
    return "今天不要升级，优先回到上一绿灯水平或减少最近增量。";
  }
  return "当前反馈支持维持计划；升级仍需连续满足计划条件。";
}

function safetyTone(level: SafetyLevel) {
  if (level === "red") return "danger" as const;
  if (level === "yellow") return "warning" as const;
  return "success" as const;
}

export function FeedbackFlowClient({
  presentation,
}: {
  presentation: "page" | "overlay";
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const githubUserId = usePrivateOfflineIdentity();
  const { commands, confirmedCommandIds, enqueue } = useOfflineCommands();
  const localDate = localDateInTimeZone(new Date(), planningTimeZone);
  const todayQueryKey = trackerQueryKeys.today(trackerKey, localDate);
  const query = useQuery({
    queryKey: todayQueryKey,
    queryFn: ({ signal }) => fetchTodayAggregate(trackerKey, localDate, signal),
    staleTime: 60_000,
  });
  const {
    data: snapshotData,
    isPending: snapshotPending,
    persist: persistSnapshot,
  } = useQuerySnapshot<OfflineTodaySnapshot>({
    trackerKey,
    kind: "today",
    scope: localDate,
  });
  const [draft, setDraft] = useState<KneeCheckInInput>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [result, setResult] = useState<{
    id: string;
    safetyLevel: SafetyLevel | null;
    safetyPolicy: ReturnType<typeof safetyPolicyReference> | null;
  } | null>(null);
  const [offlinePolicy, setOfflinePolicy] =
    useState<TrackerSafetyPolicy | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const pendingCommand = useRef<PendingClientCommand | null>(null);
  const submitting = useRef(false);

  useEffect(() => {
    if (presentation !== "overlay") return;
    const appShell = document.querySelector<HTMLElement>(
      ".protected-app-shell",
    );
    const previousOverflow = document.body.style.overflow;
    const previousAriaHidden = appShell?.getAttribute("aria-hidden") ?? null;
    const hadInert = appShell?.hasAttribute("inert") ?? false;
    document.body.style.overflow = "hidden";
    appShell?.setAttribute("inert", "");
    appShell?.setAttribute("aria-hidden", "true");
    const initialFocus = overlayRef.current?.querySelector<HTMLElement>(
      "[data-feedback-initial-focus]",
    );
    (initialFocus ?? overlayRef.current)?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (appShell) {
        if (!hadInert) appShell.removeAttribute("inert");
        if (previousAriaHidden === null) {
          appShell.removeAttribute("aria-hidden");
        } else {
          appShell.setAttribute("aria-hidden", previousAriaHidden);
        }
        appShell.querySelector<HTMLElement>('a[href="/feedback"]')?.focus();
      }
    };
  }, [presentation]);

  useEffect(() => {
    if (!result || presentation !== "overlay") return;
    resultHeadingRef.current?.focus();
  }, [presentation, result]);

  useEffect(() => {
    if (!query.data || !githubUserId) return;
    const savedAt = new Date(query.dataUpdatedAt).toISOString();
    void persistSnapshot(
      {
        tracker: query.data.tracker,
        targetDate: query.data.targetDate,
        plan: query.data.plan,
        day: query.data.day,
        safetyPolicy: safetyPolicyReference(query.data.safetyPolicy),
        execution: query.data.execution,
      },
      `plan:${query.data.plan?.version ?? "none"};policy:${query.data.safetyPolicy.version}:${query.data.safetyPolicy.hash}`,
      query.dataUpdatedAt,
    );
    void saveSafetyPolicy(offlineDatabase, {
      githubUserId,
      trackerKey,
      policy: query.data.safetyPolicy,
      savedAt,
      expiresAt: new Date(
        query.dataUpdatedAt + 30 * 24 * 60 * 60 * 1_000,
      ).toISOString(),
    });
  }, [githubUserId, persistSnapshot, query.data, query.dataUpdatedAt]);

  useEffect(() => {
    if (query.data || !snapshotData?.data || !githubUserId) return;
    void readSafetyPolicy(offlineDatabase, {
      githubUserId,
      trackerKey,
      reference: snapshotData.data.safetyPolicy,
    }).then(setOfflinePolicy);
  }, [githubUserId, query.data, snapshotData]);

  const returnToday = () => {
    if (presentation === "overlay") {
      router.back();
      return;
    }
    router.push("/", { scroll: false });
  };

  const aggregate = query.data ?? snapshotData?.data;

  if (
    !aggregate &&
    (snapshotPending || (query.isPending && query.fetchStatus !== "paused"))
  ) {
    return (
      <div
        ref={overlayRef}
        className={`feedback-flow-layer ${presentation}`}
        role={presentation === "overlay" ? "dialog" : undefined}
        aria-modal={presentation === "overlay" ? "true" : undefined}
        aria-labelledby={
          presentation === "overlay" ? "feedback-loading-title" : undefined
        }
        tabIndex={presentation === "overlay" ? -1 : undefined}
      >
        <main className="feedback-flow-page" aria-busy="true">
          <section className="surface-card feedback-flow-loading" role="status">
            <h1 id="feedback-loading-title">正在准备反馈表单</h1>
            <p>请稍候，尚未产生或保存任何反馈。</p>
          </section>
        </main>
      </div>
    );
  }

  if (!aggregate) {
    return (
      <div
        ref={overlayRef}
        className={`feedback-flow-layer ${presentation}`}
        role={presentation === "overlay" ? "dialog" : undefined}
        aria-modal={presentation === "overlay" ? "true" : undefined}
        aria-labelledby={
          presentation === "overlay" ? "feedback-error-title" : undefined
        }
        tabIndex={presentation === "overlay" ? -1 : undefined}
      >
        <main className="feedback-flow-page">
          <section className="surface-card feedback-flow-error" role="alert">
            <h1 id="feedback-error-title">反馈表单暂时无法加载</h1>
            <p>尚未产生或保存任何反馈，可以稍后重试。</p>
            <div className="feedback-result-actions">
              <button
                className="primary-button"
                type="button"
                data-feedback-initial-focus
                autoFocus={presentation === "overlay"}
                onClick={() => void query.refetch()}
              >
                重试加载
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={returnToday}
              >
                返回今日
              </button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const policy = query.data?.safetyPolicy ?? offlinePolicy;
  const clientSafetyLevel = policy
    ? evaluateKneeCheckIn(draft, policy.rules)
    : null;
  const resultCommand = result
    ? commands.find((command) => command.id === result.id)
    : null;
  const resultConfirmed = result
    ? (confirmedCommandIds?.includes(result.id) ?? false)
    : false;
  const canonicalFeedback = resultConfirmed
    ? query.data?.day.feedbacks.find((feedback) => feedback.id === result?.id)
    : null;
  const displayedSafetyLevel =
    canonicalFeedback?.safetyLevel ?? result?.safetyLevel ?? null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setSaveFailed(false);
    try {
      const payload = kneeCheckInInputSchema.parse(draft);
      const command = createOrReuseClientCommand(
        pendingCommand.current,
        payload,
      );
      pendingCommand.current = command;
      if (!githubUserId) throw new Error("offline_identity_unavailable");
      const queued = await enqueue({
        id: command.metadata.commandId,
        githubUserId,
        trackerKey,
        kind: "symptom_check_in",
        createdAt: command.metadata.occurredAt,
        occurredAt: command.metadata.occurredAt,
        localDate,
        occurredTimeZone: command.metadata.occurredTimeZone,
        occurredUtcOffsetMinutes: command.metadata.occurredUtcOffsetMinutes,
        payload: {
          checkIn: payload,
          clientSafetyPolicy: policy ? safetyPolicyReference(policy) : null,
          localSafetyLevel: clientSafetyLevel,
        },
      });
      queryClient.setQueryData<TodayAggregate>(todayQueryKey, (current) =>
        current ? projectTodayPendingCommands(current, [queued]).data : current,
      );
      setResult({
        id: command.metadata.commandId,
        safetyLevel: clientSafetyLevel,
        safetyPolicy: policy ? safetyPolicyReference(policy) : null,
      });
    } catch {
      setSaveFailed(true);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  const updateDraft = <Key extends keyof KneeCheckInInput>(
    key: Key,
    value: KneeCheckInInput[Key],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div
      ref={overlayRef}
      className={`feedback-flow-layer ${presentation}`}
      role={presentation === "overlay" ? "dialog" : undefined}
      aria-modal={presentation === "overlay" ? "true" : undefined}
      aria-labelledby={
        presentation === "overlay"
          ? result
            ? "feedback-result-title"
            : "feedback-form-title"
          : undefined
      }
      tabIndex={presentation === "overlay" ? -1 : undefined}
    >
      <main className="feedback-flow-page">
        {result ? (
          <section
            className={`feedback-result-card ${displayedSafetyLevel ?? "pending"}`}
            aria-live="polite"
          >
            <p className="eyebrow">身体反馈</p>
            <h1 id="feedback-result-title" ref={resultHeadingRef} tabIndex={-1}>
              {resultConfirmed ? "反馈已保存" : "反馈已保存在本机"}
            </h1>
            {displayedSafetyLevel ? (
              <StatusPill
                tone={safetyTone(displayedSafetyLevel)}
                icon={displayedSafetyLevel === "green" ? "✓" : "!"}
              >
                {resultConfirmed ? "已确认" : "本机预估"}
              </StatusPill>
            ) : (
              <StatusPill tone="attention" icon="!">
                等待联网确认
              </StatusPill>
            )}
            <div className="feedback-result-level">
              <h2>
                {displayedSafetyLevel
                  ? safetyLabel(displayedSafetyLevel)
                  : "暂不判断安全级别"}
              </h2>
              <p>
                {displayedSafetyLevel
                  ? safetyGuidance(displayedSafetyLevel)
                  : "当前无法预估安全级别。先不要增加训练量，联网保存后再查看结果。"}
              </p>
            </div>
            <p className="feedback-policy-note">
              {resultConfirmed
                ? "已根据反馈发生时间确认安全级别。"
                : resultCommand?.status === "syncing"
                  ? "正在保存，完成后以页面结果为准。"
                  : resultCommand?.status === "waiting_auth" ||
                      resultCommand?.status === "needs_attention"
                    ? "当前记录仍在本机，需要联网后处理。这条反馈会继续保留。"
                    : "当前记录尚未确认，联网后会自动保存。"}
            </p>
            <div className="feedback-result-actions">
              <button
                className="primary-button"
                type="button"
                onClick={returnToday}
              >
                返回今日
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setDraft(emptyDraft);
                  setResult(null);
                  setSaveFailed(false);
                  pendingCommand.current = null;
                }}
              >
                继续添加反馈
              </button>
            </div>
          </section>
        ) : (
          <>
            <header className="feedback-flow-header">
              <button
                className="feedback-back-button"
                type="button"
                aria-label="返回今日"
                data-feedback-initial-focus
                autoFocus={presentation === "overlay"}
                onClick={returnToday}
              >
                <span aria-hidden="true">‹</span>
                今日
              </button>
              <div>
                <p className="eyebrow">身体反馈</p>
                <h1 id="feedback-form-title">记录身体反馈</h1>
              </div>
            </header>

            <form className="feedback-flow-form" onSubmit={submit}>
              <section className="surface-card feedback-form-section">
                <div className="feedback-section-heading">
                  <span>1</span>
                  <div>
                    <h2>反馈时机</h2>
                    <p>选择这次感受发生在训练的哪个阶段。</p>
                  </div>
                </div>
                <label className="feedback-field">
                  反馈时机
                  <select
                    value={draft.timing}
                    onChange={(event) =>
                      updateDraft(
                        "timing",
                        event.target.value as KneeCheckInInput["timing"],
                      )
                    }
                  >
                    <option value="morning">晨间／训练前</option>
                    <option value="post_training">训练后</option>
                    <option value="next_day">次日反应</option>
                    <option value="incident">突发情况</option>
                  </select>
                </label>
              </section>

              <section className="surface-card feedback-form-section">
                <div className="feedback-section-heading">
                  <span>2</span>
                  <div>
                    <h2>左右膝疼痛</h2>
                    <p>0 表示没有疼痛，10 表示最严重。</p>
                  </div>
                </div>
                <div className="feedback-pain-grid">
                  <label className="feedback-field">
                    左膝疼痛（0–10）
                    <input
                      type="number"
                      min="0"
                      max="10"
                      step="1"
                      required
                      value={draft.leftPain}
                      onChange={(event) =>
                        updateDraft("leftPain", Number(event.target.value))
                      }
                    />
                  </label>
                  <label className="feedback-field">
                    右膝疼痛（0–10）
                    <input
                      type="number"
                      min="0"
                      max="10"
                      step="1"
                      required
                      value={draft.rightPain}
                      onChange={(event) =>
                        updateDraft("rightPain", Number(event.target.value))
                      }
                    />
                  </label>
                </div>
              </section>

              <section className="surface-card feedback-form-section">
                <div className="feedback-section-heading">
                  <span>3</span>
                  <div>
                    <h2>肿胀与僵硬</h2>
                    <p>记录现在能观察到的反应。</p>
                  </div>
                </div>
                <label className="feedback-field">
                  肿胀
                  <select
                    value={draft.swelling}
                    onChange={(event) =>
                      updateDraft(
                        "swelling",
                        event.target.value as KneeCheckInInput["swelling"],
                      )
                    }
                  >
                    <option value="none">无</option>
                    <option value="mild">轻度</option>
                    <option value="obvious">明显</option>
                  </select>
                </label>
                <label className="feedback-symptom-option">
                  <input
                    type="checkbox"
                    checked={draft.stiffness}
                    onChange={(event) =>
                      updateDraft("stiffness", event.target.checked)
                    }
                  />
                  <span>僵硬</span>
                </label>
              </section>

              <section className="surface-card feedback-form-section">
                <div className="feedback-section-heading">
                  <span>4</span>
                  <div>
                    <h2>需要留意的症状</h2>
                    <p>勾选现在出现的情况。</p>
                  </div>
                </div>
                <div className="feedback-symptom-list">
                  {(
                    [
                      ["mechanicalSymptoms", "卡锁、伸不直或打软腿"],
                      ["weightBearingIssue", "跛行或无法正常负重"],
                      ["localizedBonePain", "固定骨性位置疼痛"],
                      ["nightOrRestPain", "夜间或静息痛加重"],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="feedback-symptom-option" key={key}>
                      <input
                        type="checkbox"
                        checked={draft[key]}
                        onChange={(event) =>
                          updateDraft(key, event.target.checked)
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </section>

              <section className="surface-card feedback-form-section">
                <div className="feedback-section-heading">
                  <span>5</span>
                  <div>
                    <h2>主观补充</h2>
                    <p>可以补充触发动作、训练感受或恢复变化。</p>
                  </div>
                </div>
                <label className="feedback-field">
                  主观补充
                  <textarea
                    maxLength={2000}
                    rows={5}
                    value={draft.note}
                    placeholder="选填；请描述这次感受中表单未覆盖的内容"
                    onChange={(event) =>
                      updateDraft("note", event.target.value)
                    }
                  />
                </label>
              </section>

              <section
                className={`feedback-safety-preview ${clientSafetyLevel ?? "pending"}`}
                aria-live="polite"
              >
                {clientSafetyLevel ? (
                  <>
                    <StatusPill tone={safetyTone(clientSafetyLevel)}>
                      当前预估：{safetyLabel(clientSafetyLevel)}
                    </StatusPill>
                    <p>保存后确认；结果出来前不要据此增加训练量。</p>
                  </>
                ) : (
                  <>
                    <StatusPill tone="attention">暂无法预估</StatusPill>
                    <p>仍可保存反馈；联网前不会显示未经确认的绿灯。</p>
                  </>
                )}
              </section>

              {saveFailed ? (
                <div className="feedback-save-error" role="alert">
                  <strong>尚未保存到本机，请重试。</strong>
                  <span>表单内容仍保留在当前页面。</span>
                </div>
              ) : null}

              <button
                className="primary-button feedback-submit-button"
                type="submit"
                disabled={saving}
              >
                {saving ? "保存中…" : saveFailed ? "重试保存" : "保存反馈"}
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}

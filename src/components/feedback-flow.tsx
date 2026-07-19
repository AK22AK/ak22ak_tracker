"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { trackerQueryKeys } from "@/client/query-keys";
import { fetchTodayAggregate } from "@/client/tracker-api";
import {
  createOrReuseClientCommand,
  type PendingClientCommand,
} from "@/domain/client-command";
import type { TodayAggregate } from "@/domain/api-contracts";
import { localDateInTimeZone } from "@/domain/planning-time";
import {
  safetyPolicyReference,
  type SafetyLevel,
} from "@/domain/safety-policy";
import {
  evaluateKneeCheckIn,
  kneeCheckInInputSchema,
  kneeCheckInSaveResultSchema,
  type KneeCheckInInput,
} from "@/modules/knee-rehab/check-in";

import { StatusPill } from "./ui/primitives";

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

function updateTodayFeedback(
  current: TodayAggregate | undefined,
  draft: KneeCheckInInput,
  occurredAt: string,
  result: ReturnType<typeof kneeCheckInSaveResultSchema.parse>,
) {
  if (!current) return current;
  if (current.day.feedbacks.some((feedback) => feedback.id === result.id)) {
    return current;
  }
  return {
    ...current,
    day: {
      ...current.day,
      feedbackCount: current.day.feedbackCount + 1,
      feedbacks: [
        ...current.day.feedbacks,
        {
          id: result.id,
          occurredAt,
          timing: draft.timing,
          leftPain: draft.leftPain,
          rightPain: draft.rightPain,
          swelling: draft.swelling,
          safetyLevel: result.safetyLevel,
          safetyPolicy: result.safetyPolicy,
          note: draft.note,
        },
      ],
    },
  };
}

export function FeedbackFlowClient({
  presentation,
}: {
  presentation: "page" | "overlay";
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const localDate = localDateInTimeZone(new Date(), planningTimeZone);
  const todayQueryKey = trackerQueryKeys.today(trackerKey, localDate);
  const query = useQuery({
    queryKey: todayQueryKey,
    queryFn: ({ signal }) => fetchTodayAggregate(trackerKey, localDate, signal),
    staleTime: 60_000,
  });
  const [draft, setDraft] = useState<KneeCheckInInput>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [result, setResult] = useState<ReturnType<
    typeof kneeCheckInSaveResultSchema.parse
  > | null>(null);
  const pendingCommand = useRef<PendingClientCommand | null>(null);
  const submitting = useRef(false);

  useEffect(() => {
    if (presentation !== "overlay") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [presentation]);

  const returnToday = () => {
    if (presentation === "overlay") {
      router.back();
      return;
    }
    router.push("/", { scroll: false });
  };

  if (query.isPending) {
    return (
      <div className={`feedback-flow-layer ${presentation}`}>
        <main className="feedback-flow-page" aria-busy="true">
          <section className="surface-card feedback-flow-loading" role="status">
            正在准备反馈表单…
          </section>
        </main>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className={`feedback-flow-layer ${presentation}`}>
        <main className="feedback-flow-page">
          <section className="surface-card feedback-flow-error" role="alert">
            <h1>反馈表单暂时无法加载</h1>
            <p>尚未产生或保存任何反馈，可以稍后重试。</p>
            <div className="feedback-result-actions">
              <button
                className="primary-button"
                type="button"
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

  const policy = query.data.safetyPolicy;
  const clientSafetyLevel = evaluateKneeCheckIn(draft, policy.rules);

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
      const response = await fetch("/api/check-ins", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...payload,
          ...command.metadata,
          clientSafetyPolicy: safetyPolicyReference(policy),
        }),
      });
      if (!response.ok) throw new Error("check_in_failed");
      const saved = kneeCheckInSaveResultSchema.parse(await response.json());
      queryClient.setQueryData<TodayAggregate>(todayQueryKey, (current) =>
        updateTodayFeedback(
          current,
          payload,
          command.metadata.occurredAt,
          saved,
        ),
      );
      void queryClient.invalidateQueries({
        queryKey: trackerQueryKeys.day(trackerKey, localDate),
      });
      void queryClient.invalidateQueries({
        queryKey: trackerQueryKeys.calendar(trackerKey, localDate.slice(0, 7)),
      });
      pendingCommand.current = null;
      setResult(saved);
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
    <div className={`feedback-flow-layer ${presentation}`}>
      <main className="feedback-flow-page">
        {result ? (
          <section
            className={`feedback-result-card ${result.safetyLevel}`}
            aria-live="polite"
          >
            <p className="eyebrow">身体反馈</p>
            <h1>反馈已保存</h1>
            <StatusPill
              tone={safetyTone(result.safetyLevel)}
              icon={result.safetyLevel === "green" ? "✓" : "!"}
            >
              服务端已确认
            </StatusPill>
            <div className="feedback-result-level">
              <h2>{safetyLabel(result.safetyLevel)}</h2>
              <p>{safetyGuidance(result.safetyLevel)}</p>
            </div>
            {result.clientPolicyOutdated ? (
              <p className="feedback-policy-note">
                安全规则在提交期间已更新，本结果采用服务端最新规则。
              </p>
            ) : null}
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
                onClick={returnToday}
              >
                <span aria-hidden="true">‹</span>
                今日
              </button>
              <div>
                <p className="eyebrow">身体反馈</p>
                <h1>记录身体反馈</h1>
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
                    <p>已选异常会持续保持展开并参与安全判断。</p>
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
                className={`feedback-safety-preview ${clientSafetyLevel}`}
                aria-live="polite"
              >
                <StatusPill tone={safetyTone(clientSafetyLevel)}>
                  当前输入预判：{safetyLabel(clientSafetyLevel)}
                </StatusPill>
                <p>提交后由服务端按实际生效的私人安全策略给出权威结果。</p>
              </section>

              {saveFailed ? (
                <div className="feedback-save-error" role="alert">
                  <strong>尚未保存，请检查网络后重试。</strong>
                  <span>表单内容仍保留在当前页面；关闭页面前请先重试。</span>
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

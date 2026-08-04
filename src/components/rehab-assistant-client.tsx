"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { trackerQueryKeys } from "@/client/query-keys";
import {
  fetchAssistantConversation,
  saveAssistantFeedback,
  sendAssistantTurn,
} from "@/client/tracker-api";
import { useNetworkState } from "@/client/use-network-state";
import type {
  AssistantAssociation,
  AssistantFeedbackDraft,
} from "@/domain/rehab-assistant";
import {
  instantAtLocalNoon,
  localDateInTimeZone,
} from "@/domain/planning-time";

const trackerKey = "knee-rehab";
const planningTimeZone = "Asia/Shanghai";
const draftStorageKey = "ak-tracker:rehab-assistant-draft:v1";

const memoryLabels = {
  goal: "目标",
  preference: "偏好",
  schedule: "时间安排",
  equipment: "器械条件",
  routine: "训练习惯",
  stable_constraint: "稳定限制",
} as const;

function associationFromSearch(
  search: ReturnType<typeof useSearchParams>,
): AssistantAssociation {
  const date = search.get("date");
  const taskInstanceId = search.get("task");
  const externalRecordId = search.get("activity");
  if (date && taskInstanceId) {
    return { kind: "task", localDate: date, taskInstanceId };
  }
  if (date && externalRecordId) {
    return { kind: "activity", localDate: date, externalRecordId };
  }
  return date ? { kind: "date", localDate: date } : { kind: "auto" };
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: planningTimeZone,
    month: "long",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00+08:00`));
}

function FeedbackConfirmation({
  turnId,
  initial,
  saved,
}: {
  turnId: string;
  initial: AssistantFeedbackDraft;
  saved: boolean;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const commandId = useRef<string | null>(null);
  const today = localDateInTimeZone(new Date(), planningTimeZone);

  async function confirm() {
    if (saving || saved || draft.localDate > today) return;
    setSaving(true);
    setMessage(null);
    commandId.current ??= crypto.randomUUID();
    try {
      const result = await saveAssistantFeedback(trackerKey, {
        commandId: commandId.current,
        turnId,
        occurredAt: instantAtLocalNoon(
          draft.localDate,
          planningTimeZone,
        ).toISOString(),
        occurredTimeZone: planningTimeZone,
        occurredUtcOffsetMinutes: 480,
        feedback: {
          localDate: draft.localDate,
          timing: draft.timing,
          leftPain: draft.leftPain,
          rightPain: draft.rightPain,
          swelling: draft.swelling,
          stiffness: draft.stiffness,
          mechanicalSymptoms: draft.mechanicalSymptoms,
          weightBearingIssue: draft.weightBearingIssue,
          localizedBonePain: draft.localizedBonePain,
          nightOrRestPain: draft.nightOrRestPain,
          note: draft.note,
        },
      });
      queryClient.setQueryData(
        trackerQueryKeys.assistant(trackerKey),
        result.conversation,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: trackerQueryKeys.day(trackerKey, draft.localDate),
        }),
        queryClient.invalidateQueries({
          queryKey: trackerQueryKeys.calendar(
            trackerKey,
            draft.localDate.slice(0, 7),
          ),
        }),
      ]);
      if (draft.localDate === today) {
        await queryClient.invalidateQueries({
          queryKey: trackerQueryKeys.today(trackerKey, today),
        });
      }
      setMessage(
        result.safetyLevel === "red"
          ? "反馈已保存。当前是红灯，请停止相关训练并重新评估。"
          : "反馈已保存。",
      );
    } catch {
      setMessage("没有保存成功，内容仍保留，可以直接重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="assistant-feedback-confirmation"
      aria-label="确认身体反馈"
    >
      <div>
        <p className="eyebrow">保存前确认</p>
        <h3>助手整理了一条身体反馈</h3>
      </div>
      <label>
        日期
        <input
          type="date"
          max={today}
          value={draft.localDate}
          disabled={saved}
          onChange={(event) => {
            commandId.current = null;
            setDraft((current) => ({
              ...current,
              localDate: event.target.value,
            }));
          }}
        />
      </label>
      <div className="assistant-pain-grid">
        <label>
          反馈时机
          <select
            aria-label="反馈时机"
            value={draft.timing}
            disabled={saved}
            onChange={(event) => {
              commandId.current = null;
              setDraft((current) => ({
                ...current,
                timing: event.target.value as AssistantFeedbackDraft["timing"],
              }));
            }}
          >
            <option value="morning">晨间／训练前</option>
            <option value="post_training">训练后</option>
            <option value="next_day">次日反应</option>
            <option value="incident">突发情况</option>
          </select>
        </label>
        <label>
          肿胀
          <select
            aria-label="肿胀"
            value={draft.swelling}
            disabled={saved}
            onChange={(event) => {
              commandId.current = null;
              setDraft((current) => ({
                ...current,
                swelling: event.target
                  .value as AssistantFeedbackDraft["swelling"],
              }));
            }}
          >
            <option value="none">无</option>
            <option value="mild">轻微</option>
            <option value="obvious">明显</option>
          </select>
        </label>
      </div>
      <div className="assistant-pain-grid">
        <label>
          左膝疼痛
          <input
            type="number"
            min="0"
            max="10"
            value={draft.leftPain}
            disabled={saved}
            onChange={(event) => {
              commandId.current = null;
              setDraft((current) => ({
                ...current,
                leftPain: Number(event.target.value),
              }));
            }}
          />
        </label>
        <label>
          右膝疼痛
          <input
            type="number"
            min="0"
            max="10"
            value={draft.rightPain}
            disabled={saved}
            onChange={(event) => {
              commandId.current = null;
              setDraft((current) => ({
                ...current,
                rightPain: Number(event.target.value),
              }));
            }}
          />
        </label>
      </div>
      <label>
        补充说明
        <textarea
          value={draft.note}
          disabled={saved}
          onChange={(event) => {
            commandId.current = null;
            setDraft((current) => ({ ...current, note: event.target.value }));
          }}
        />
      </label>
      <details>
        <summary>检查其他症状</summary>
        <div className="assistant-symptom-grid">
          {(
            [
              ["stiffness", "僵硬"],
              ["mechanicalSymptoms", "卡住、打软或异常响声"],
              ["weightBearingIssue", "承重困难"],
              ["localizedBonePain", "局部骨性压痛"],
              ["nightOrRestPain", "夜间或静息痛"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={draft[key]}
                disabled={saved}
                onChange={(event) => {
                  commandId.current = null;
                  setDraft((current) => ({
                    ...current,
                    [key]: event.target.checked,
                  }));
                }}
              />
              {label}
            </label>
          ))}
        </div>
      </details>
      <button
        className="primary-button"
        type="button"
        disabled={saving || saved || draft.localDate > today}
        onClick={() => void confirm()}
      >
        {saved ? "已保存为身体反馈" : saving ? "正在保存…" : "确认并保存反馈"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

export function RehabAssistantClient({
  compact = false,
}: {
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const search = useSearchParams();
  const online = useNetworkState();
  const association = useMemo(() => associationFromSearch(search), [search]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const commandId = useRef<string | null>(null);
  const query = useQuery({
    queryKey: trackerQueryKeys.assistant(trackerKey),
    queryFn: ({ signal }) => fetchAssistantConversation(trackerKey, signal),
    staleTime: 30_000,
  });

  useEffect(() => {
    const stored = localStorage.getItem(draftStorageKey);
    if (!stored) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setMessage(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (message) localStorage.setItem(draftStorageKey, message);
    else localStorage.removeItem(draftStorageKey);
  }, [message]);

  async function send() {
    const value = message.trim();
    if (!value || sending || !online) return;
    setSending(true);
    setSendError(null);
    commandId.current ??= crypto.randomUUID();
    try {
      const conversation = await sendAssistantTurn(trackerKey, {
        commandId: commandId.current,
        message: value,
        association,
      });
      queryClient.setQueryData(
        trackerQueryKeys.assistant(trackerKey),
        conversation,
      );
      const latest = conversation.turns.at(-1);
      if (latest?.status === "succeeded") {
        setMessage("");
        commandId.current = null;
      } else {
        setSendError("这次没有完成，可以直接重试。你的文字仍保留。 ");
      }
    } catch {
      setSendError("暂时无法联系康复助手，可以直接重试。你的文字仍保留。");
    } finally {
      setSending(false);
    }
  }

  const turns = query.data?.turns ?? [];
  const visibleTurns = compact ? turns.slice(-1) : turns;

  return (
    <section
      className={compact ? "plan-assistant-compact" : "assistant-conversation"}
    >
      {!compact ? (
        <header className="settings-detail-header">
          <div>
            <p className="eyebrow">计划</p>
            <h1>康复助手</h1>
          </div>
          <Link href="/plan">返回</Link>
        </header>
      ) : null}

      {query.isPending ? <p role="status">正在打开对话…</p> : null}
      {visibleTurns.map((turn) => (
        <article className="assistant-turn" key={turn.id}>
          <div className="assistant-user-message">
            <small>
              {new Date(turn.createdAt).toLocaleDateString("zh-CN")}
            </small>
            <p>{turn.message}</p>
          </div>
          {turn.response ? (
            <div className="assistant-reply">
              <p>{turn.response.reply}</p>
              {turn.response.followUpQuestions.length > 0 ? (
                <ul>
                  {turn.response.followUpQuestions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              ) : null}
              {turn.response.memoryActions.some(
                (action) => action.type === "remember",
              ) ? (
                <details>
                  <summary>这次记住了什么</summary>
                  <ul>
                    {turn.response.memoryActions
                      .filter((action) => action.type === "remember")
                      .map((action) => (
                        <li key={`${action.category}-${action.content}`}>
                          {memoryLabels[action.category]}：{action.content}
                        </li>
                      ))}
                  </ul>
                </details>
              ) : null}
              {turn.response.evidenceReferences.length > 0 ? (
                <details>
                  <summary>本次参考了什么</summary>
                  <p>
                    {[
                      ...new Set(
                        turn.response.evidenceReferences.map((item) =>
                          dateLabel(item.localDate),
                        ),
                      ),
                    ].join("、")}
                  </p>
                </details>
              ) : null}
              {turn.response.feedbackDraft ? (
                <FeedbackConfirmation
                  turnId={turn.id}
                  initial={turn.response.feedbackDraft}
                  saved={turn.confirmedFeedbackId !== null}
                />
              ) : null}
              {turn.response.planReview === "suggested" ? (
                <Link
                  className="secondary-button"
                  href={`/plan/advice?turn=${turn.id}`}
                >
                  生成调整方案
                </Link>
              ) : null}
            </div>
          ) : turn.status === "failed" ? (
            <p role="status">这次没有完成，可以保留原文重试。</p>
          ) : (
            <p role="status">康复助手正在整理…</p>
          )}
        </article>
      ))}

      <div className="assistant-composer">
        <label
          htmlFor={compact ? "assistant-compact-message" : "assistant-message"}
        >
          {association.kind === "auto"
            ? "训练、身体感受或计划问题"
            : `补充 ${dateLabel(association.localDate)}`}
        </label>
        <textarea
          id={compact ? "assistant-compact-message" : "assistant-message"}
          value={message}
          placeholder="例如：昨天做完腿举后右膝有点紧，今天已经恢复。"
          onChange={(event) => {
            commandId.current = null;
            setMessage(event.target.value);
          }}
        />
        {!online ? (
          <p role="status">当前离线，草稿会保留，联网后再发送。</p>
        ) : null}
        {sendError ? <p role="alert">{sendError}</p> : null}
        <button
          className="primary-button"
          type="button"
          disabled={!online || sending || !message.trim()}
          onClick={() => void send()}
        >
          {sending ? "正在发送…" : "发送给康复助手"}
        </button>
      </div>
      {compact ? <Link href="/plan/conversation">打开完整对话</Link> : null}
    </section>
  );
}

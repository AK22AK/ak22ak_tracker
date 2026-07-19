"use client";

import { useRef, useState } from "react";

import { saveExternalRecordAssociation } from "@/client/tracker-api";
import {
  createOrReuseClientCommand,
  type PendingClientCommand,
} from "@/domain/client-command";
import type {
  ExternalRecordAssociation,
  ExternalTrainingRecord,
} from "@/domain/external-training";
import type { DashboardTask } from "@/server/dashboard";

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function durationLabel(seconds: number) {
  const minutes = Math.round(seconds / 60);
  return minutes < 60
    ? `${minutes} 分钟`
    : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

function metric(value: string | number | null, suffix = "") {
  return value === null ? null : `${value}${suffix}`;
}

type TrainingSetDetails =
  ExternalTrainingRecord["details"]["movements"][number]["sets"][number];

function setDetailSummary(set: Omit<TrainingSetDetails, "index" | "items">) {
  const duration =
    set.duration === null
      ? null
      : set.durationUnit === "s"
        ? `${set.duration} 秒`
        : set.durationUnit
          ? `${set.duration} ${set.durationUnit}`
          : `计时 ${set.duration}`;
  return [
    set.completed === true
      ? "已完成"
      : set.completed === false
        ? "未完成"
        : null,
    set.selfWeight === true ? "自重" : null,
    metric(set.weight, set.unit ? ` ${set.unit}` : ""),
    metric(set.reps, " 次"),
    duration,
    metric(set.rpe, " RPE"),
    metric(set.restSeconds, " 秒休息"),
  ]
    .filter(Boolean)
    .join(" · ");
}

function setSummary(set: TrainingSetDetails) {
  return setDetailSummary(set);
}

const difficultyLabels = {
  easy: "轻松",
  normal: "适中",
  hard: "困难",
} as const;

function associationLabel(
  association: ExternalRecordAssociation | null,
  tasks: DashboardTask[],
) {
  if (!association) return "尚未关联";
  if (association.status === "unrelated") return "已标记为与计划无关";
  const task = tasks.find((item) => item.id === association.taskId);
  return association.status === "confirmed"
    ? `已关联：${task?.title ?? "其他任务"}`
    : "等待确认";
}

function ExternalTrainingCard({
  trackerKey,
  record,
  tasks,
  onUpdated,
}: {
  trackerKey: string;
  record: ExternalTrainingRecord;
  tasks: DashboardTask[];
  onUpdated: (recordId: string, association: ExternalRecordAssociation) => void;
}) {
  const [selectedTaskId, setSelectedTaskId] = useState(
    record.association?.taskId ??
      record.suggestion?.taskId ??
      tasks[0]?.id ??
      "",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pendingCommand = useRef<PendingClientCommand | null>(null);

  async function decide(decision: "link" | "unrelated") {
    if (decision === "link" && !selectedTaskId) return;
    const payload =
      decision === "link"
        ? {
            externalRecordId: record.id,
            sourceVersion: record.sourceVersion,
            decision,
            taskId: selectedTaskId,
          }
        : {
            externalRecordId: record.id,
            sourceVersion: record.sourceVersion,
            decision,
          };
    const command = createOrReuseClientCommand(pendingCommand.current, payload);
    pendingCommand.current = command;
    setSaving(true);
    setMessage(null);
    try {
      const result = await saveExternalRecordAssociation(
        trackerKey,
        decision === "link"
          ? {
              ...payload,
              ...command.metadata,
              decision,
              taskId: selectedTaskId,
            }
          : { ...payload, ...command.metadata, decision },
      );
      pendingCommand.current = null;
      onUpdated(record.id, result.association);
      setMessage(
        result.association.status === "unrelated"
          ? "已记录为与计划无关"
          : "关联已保存；任务完成状态没有改变",
      );
    } catch (error) {
      setMessage(
        String(error).includes("409")
          ? "训记来源已更新，请刷新后重新确认"
          : "关联保存失败，请稍后重试",
      );
    } finally {
      setSaving(false);
    }
  }

  const currentTaskId = record.association?.taskId;
  const linkButtonLabel = currentTaskId
    ? currentTaskId === selectedTaskId
      ? "重新确认此任务"
      : "更换任务"
    : "关联到此任务";

  return (
    <article className="external-training-card">
      <div className="external-training-heading">
        <div>
          <span className="external-source-badge">训记</span>
          <h3>{record.details.title}</h3>
        </div>
        <span>{durationLabel(record.details.durationSeconds)}</span>
      </div>
      <p className="external-training-time">
        {timeLabel(record.details.startedAt)}–
        {timeLabel(record.details.endedAt)}
        {record.details.rpe !== null ? ` · RPE ${record.details.rpe}` : ""}
      </p>
      {record.details.movements.length > 0 && (
        <div className="external-movement-list">
          {record.details.movements.map((movement, movementIndex) => (
            <div key={`${movement.name}-${movementIndex}`}>
              <strong>{movement.name}</strong>
              {movement.difficulty && (
                <span className="external-movement-difficulty">
                  难度：{difficultyLabels[movement.difficulty]}
                </span>
              )}
              {movement.sets.length > 0 && (
                <ol>
                  {movement.sets.map((set) => (
                    <li key={set.index}>
                      第 {set.index} 组：{setSummary(set) || "已记录"}
                      {set.note ? ` · ${set.note}` : ""}
                      {set.items.length > 0 && (
                        <ul className="external-set-items">
                          {set.items.map((item, itemIndex) => (
                            <li key={`${item.name}-${itemIndex}`}>
                              {item.name}：{setDetailSummary(item) || "已记录"}
                              {item.note ? ` · ${item.note}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {movement.note && <p>{movement.note}</p>}
            </div>
          ))}
        </div>
      )}
      {record.details.note && (
        <p className="external-training-note">备注：{record.details.note}</p>
      )}

      <div className="external-association">
        <strong>{associationLabel(record.association, tasks)}</strong>
        {record.association?.needsReview && (
          <p role="status">训记内容已更新，请重新确认关联。</p>
        )}
        {!record.association && record.suggestion && (
          <p>建议：{record.suggestion.reason}</p>
        )}
        {tasks.length > 0 && (
          <label>
            康复任务
            <select
              value={selectedTaskId}
              disabled={saving}
              onChange={(event) => setSelectedTaskId(event.target.value)}
            >
              {tasks.map((task) => (
                <option value={task.id} key={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="external-association-actions">
          {tasks.length > 0 && (
            <button
              type="button"
              disabled={saving || !selectedTaskId}
              onClick={() => void decide("link")}
            >
              {saving ? "保存中…" : linkButtonLabel}
            </button>
          )}
          <button
            className="quiet"
            type="button"
            disabled={saving}
            onClick={() => void decide("unrelated")}
          >
            与计划无关
          </button>
        </div>
        <p className="external-association-hint">
          关联只归类训练来源，不会替你勾选任务完成。
        </p>
        {message && <p role="status">{message}</p>}
      </div>
    </article>
  );
}

export function ExternalTrainingSection({
  trackerKey,
  records,
  tasks,
  onUpdated,
}: {
  trackerKey: string;
  records: ExternalTrainingRecord[];
  tasks: DashboardTask[];
  onUpdated: (recordId: string, association: ExternalRecordAssociation) => void;
}) {
  if (records.length === 0) return null;
  return (
    <section className="external-training-section" aria-label="训记训练记录">
      <div className="external-section-title">
        <h2>当天训练记录</h2>
        <span>{records.length} 条</span>
      </div>
      {records.map((record) => (
        <ExternalTrainingCard
          key={record.id}
          trackerKey={trackerKey}
          record={record}
          tasks={tasks}
          onUpdated={onUpdated}
        />
      ))}
    </section>
  );
}

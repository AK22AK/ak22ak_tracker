"use client";

import { useRef, useState } from "react";

import {
  createExecutionContext,
  endExecutionContext,
  setExecutionDay,
} from "@/client/tracker-api";
import {
  createOrReuseClientCommand,
  type PendingClientCommand,
} from "@/domain/client-command";
import type {
  ExecutionContextToday,
  ExecutionDayConditions,
} from "@/domain/execution-context";

import { SectionHeading, StatusPill, SurfaceCard } from "./ui/primitives";

const venueLabels: Record<ExecutionDayConditions["venue"], string> = {
  hotel_gym: "酒店健身房",
  room: "房间",
  stairs: "楼梯区域",
  outdoors: "户外平坦场地",
  transit: "交通途中",
  none: "没有可用场地",
};

const equipmentLabels: Record<
  ExecutionDayConditions["equipment"][number],
  string
> = {
  machines: "固定器械",
  dumbbells: "哑铃",
  chair: "稳定椅子",
  stairs: "安全楼梯",
  backpack: "背包",
  none: "无器械",
};

type PendingCreate = {
  command: PendingClientCommand;
  contextId: string;
};

function contextKindLabel(kind: "travel" | "equipment_limited") {
  return kind === "travel" ? "出差维持" : "器械受限";
}

function safetyReason(reason: ExecutionContextToday["safety"]["reason"]) {
  if (reason === "red_feedback") return "今天已有红灯反馈";
  if (reason === "illness") return "当前记录为生病状态";
  if (reason === "acute_symptom") return "当前记录为急性症状";
  return "当前状态不适合使用普通出差降级方案";
}

export function ExecutionContextCard({
  trackerKey,
  localDate,
  planVersion,
  execution,
  onChanged,
}: {
  trackerKey: string;
  localDate: string;
  planVersion: number | null;
  execution: ExecutionContextToday;
  onChanged: () => Promise<unknown>;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [contextKind, setContextKind] = useState<
    "travel" | "equipment_limited"
  >("travel");
  const [startDate, setStartDate] = useState(localDate);
  const [endDate, setEndDate] = useState(localDate);
  const [availableMinutes, setAvailableMinutes] = useState(
    execution.day?.conditions.availableMinutes ?? 20,
  );
  const [venue, setVenue] = useState<ExecutionDayConditions["venue"]>(
    execution.day?.conditions.venue ?? "room",
  );
  const [equipment, setEquipment] = useState<
    ExecutionDayConditions["equipment"]
  >(execution.day?.conditions.equipment ?? []);
  const [healthStatus, setHealthStatus] = useState<
    ExecutionDayConditions["healthStatus"]
  >(execution.day?.conditions.healthStatus ?? "normal");
  const [conditionNote, setConditionNote] = useState(
    execution.day?.conditions.note ?? "",
  );
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(
    execution.day?.selection?.optionId ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const pendingCreate = useRef<PendingCreate | null>(null);
  const pendingDay = useRef<PendingClientCommand | null>(null);
  const pendingEnd = useRef<PendingClientCommand | null>(null);

  const localSafetyBlocked =
    execution.safety.blocked || healthStatus !== "normal";
  const selectedAlternative = execution.alternatives.find(
    (option) => option.id === selectedOptionId,
  );

  async function saveCreate() {
    setSaving(true);
    setMessage(null);
    setFailed(false);
    try {
      const payload = { kind: contextKind, startDate, endDate };
      const command = createOrReuseClientCommand(
        pendingCreate.current?.command ?? null,
        payload,
      );
      if (command !== pendingCreate.current?.command) {
        pendingCreate.current = { command, contextId: crypto.randomUUID() };
      }
      const pending = pendingCreate.current!;
      await createExecutionContext(trackerKey, {
        ...payload,
        ...pending.command.metadata,
        contextId: pending.contextId,
      });
      pendingCreate.current = null;
      setMessage("执行上下文已保存");
      setCreateOpen(false);
      await onChanged();
    } catch {
      setFailed(true);
      setMessage("尚未保存，请检查日期或稍后重试");
    } finally {
      setSaving(false);
    }
  }

  async function saveDay() {
    if (!execution.context) return;
    setSaving(true);
    setMessage(null);
    setFailed(false);
    try {
      const conditions: ExecutionDayConditions = {
        availableMinutes,
        venue,
        equipment,
        healthStatus,
        ...(conditionNote ? { note: conditionNote } : {}),
      };
      const selection =
        localSafetyBlocked || !selectedAlternative
          ? null
          : {
              optionId: selectedAlternative.id,
              optionVersion: selectedAlternative.version,
            };
      const payload = {
        contextId: execution.context.id,
        localDate,
        conditions,
        selection,
      };
      const command = createOrReuseClientCommand(pendingDay.current, payload);
      pendingDay.current = command;
      await setExecutionDay(trackerKey, {
        ...payload,
        ...command.metadata,
      });
      pendingDay.current = null;
      setMessage(
        localSafetyBlocked ? "已记录停止并重新评估" : "今天的执行方式已保存",
      );
      await onChanged();
    } catch {
      setFailed(true);
      setMessage("尚未保存，请重试");
    } finally {
      setSaving(false);
    }
  }

  async function endContext() {
    if (!execution.context) return;
    setSaving(true);
    setMessage(null);
    setFailed(false);
    try {
      const payload = { contextId: execution.context.id };
      const command = createOrReuseClientCommand(pendingEnd.current, payload);
      pendingEnd.current = command;
      await endExecutionContext(trackerKey, {
        ...payload,
        ...command.metadata,
      });
      pendingEnd.current = null;
      setMessage("执行上下文已结束");
      await onChanged();
    } catch {
      setFailed(true);
      setMessage("结束失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  if (!execution.context) {
    return (
      <SurfaceCard className="execution-context-card" aria-label="执行环境">
        <SectionHeading
          eyebrow="执行环境"
          title="正常计划"
          aside={<StatusPill tone="neutral">未启用临时模式</StatusPill>}
        />
        <p className="execution-supporting-copy">
          出差或器械受限时，可临时记录当天条件；基础计划不会因此被改写。
        </p>
        {!createOpen ? (
          <button
            className="secondary-button"
            type="button"
            onClick={() => setCreateOpen(true)}
          >
            安排出差或受限模式
          </button>
        ) : (
          <div className="execution-context-form">
            <label>
              执行情形
              <select
                value={contextKind}
                onChange={(event) =>
                  setContextKind(
                    event.target.value as "travel" | "equipment_limited",
                  )
                }
              >
                <option value="travel">出差</option>
                <option value="equipment_limited">器械受限</option>
              </select>
            </label>
            <div className="execution-date-grid">
              <label>
                开始日期
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </label>
              <label>
                结束日期
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </label>
            </div>
            <div className="execution-form-actions">
              <button
                className="primary-button"
                type="button"
                disabled={saving}
                onClick={() => void saveCreate()}
              >
                {saving ? "保存中…" : "保存执行上下文"}
              </button>
              <button
                className="text-button"
                type="button"
                disabled={saving}
                onClick={() => setCreateOpen(false)}
              >
                取消
              </button>
            </div>
          </div>
        )}
        {message ? (
          <p
            className={failed ? "execution-message error" : "execution-message"}
            role="status"
          >
            {message}
          </p>
        ) : null}
      </SurfaceCard>
    );
  }

  const { context } = execution;
  if (context.status === "upcoming") {
    return (
      <SurfaceCard className="execution-context-card" aria-label="执行环境">
        <SectionHeading
          eyebrow="执行环境"
          title={`已安排${contextKindLabel(context.kind)}`}
          aside={<StatusPill tone="brand">即将开始</StatusPill>}
        />
        <p className="execution-context-range">
          {context.startDate} 至 {context.endDate}
        </p>
        <p className="execution-supporting-copy">
          到达开始日期后再记录当天条件和选择方案；计划日仍按 Asia/Shanghai
          计算。
        </p>
        <button
          className="text-button"
          type="button"
          disabled={saving}
          onClick={() => void endContext()}
        >
          取消这个上下文
        </button>
        {message ? (
          <p
            className={failed ? "execution-message error" : "execution-message"}
            role="status"
          >
            {message}
          </p>
        ) : null}
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard
      className="execution-context-card active"
      aria-label="执行环境"
    >
      <SectionHeading
        eyebrow="执行环境"
        title={contextKindLabel(context.kind)}
        aside={<StatusPill tone="brand">当前生效</StatusPill>}
      />
      <p className="execution-context-range">
        {context.startDate} 至 {context.endDate}
      </p>
      <p className="execution-plan-invariant">
        基础计划{planVersion ? ` v${planVersion}` : ""} 保持不变
      </p>

      <div className="execution-day-form">
        <h3>今天的实际条件</h3>
        <div className="execution-condition-grid">
          <label>
            可用时间（分钟）
            <input
              type="number"
              min="0"
              max="240"
              value={availableMinutes}
              onChange={(event) =>
                setAvailableMinutes(Number(event.target.value))
              }
            />
          </label>
          <label>
            场地条件
            <select
              value={venue}
              onChange={(event) =>
                setVenue(event.target.value as ExecutionDayConditions["venue"])
              }
            >
              {Object.entries(venueLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="execution-equipment-options">
          <legend>可用器械</legend>
          {Object.entries(equipmentLabels).map(([value, label]) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={equipment.includes(
                  value as ExecutionDayConditions["equipment"][number],
                )}
                onChange={(event) => {
                  const item =
                    value as ExecutionDayConditions["equipment"][number];
                  setEquipment((current) => {
                    if (event.target.checked) {
                      return item === "none"
                        ? ["none"]
                        : [
                            ...current.filter((entry) => entry !== "none"),
                            item,
                          ];
                    }
                    return current.filter((entry) => entry !== item);
                  });
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        <label>
          当前健康状态
          <select
            value={healthStatus}
            onChange={(event) => {
              const next = event.target
                .value as ExecutionDayConditions["healthStatus"];
              setHealthStatus(next);
              if (next !== "normal") setSelectedOptionId(null);
            }}
          >
            <option value="normal">没有生病或新的急性症状</option>
            <option value="illness">生病或急性感染</option>
            <option value="acute_symptom">新的损伤或急性症状</option>
          </select>
        </label>

        <label>
          当天条件补充
          <textarea
            value={conditionNote}
            maxLength={500}
            placeholder="可选：行程、场地或身体状态的补充"
            onChange={(event) => setConditionNote(event.target.value)}
          />
        </label>

        {localSafetyBlocked ? (
          <div className="execution-stop-alert" role="alert">
            <strong>停止并重新评估</strong>
            <p>
              {execution.safety.blocked
                ? safetyReason(execution.safety.reason)
                : "生病或新的急性症状不使用普通出差降级方案。"}
              先以恢复和安全评估为主，必要时联系专业人员。
            </p>
          </div>
        ) : (
          <fieldset className="execution-alternative-list">
            <legend>选择今天采用的私人备选方案</legend>
            {execution.alternatives.length > 0 ? (
              execution.alternatives.map((option) => (
                <label key={option.id} className="execution-alternative-option">
                  <input
                    type="radio"
                    name="execution-alternative"
                    checked={selectedOptionId === option.id}
                    onChange={() => setSelectedOptionId(option.id)}
                  />
                  <span>
                    <strong>{option.title}</strong>
                    <small>
                      {option.kind === "micro_training" ? "微训练" : "备选方案"}
                      {` · ${option.estimatedMinutes.min}–${option.estimatedMinutes.max} 分钟`}
                    </small>
                    <span>{option.summary}</span>
                    <ol>
                      {option.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </span>
                </label>
              ))
            ) : (
              <p className="empty-state-copy">私人备选方案尚未配置。</p>
            )}
          </fieldset>
        )}

        <div className="execution-form-actions">
          <button
            className="primary-button"
            type="button"
            disabled={saving}
            onClick={() => void saveDay()}
          >
            {saving ? "保存中…" : "保存今天的执行方式"}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={saving}
            onClick={() => void endContext()}
          >
            结束这个上下文
          </button>
        </div>
      </div>

      {message ? (
        <p
          className={failed ? "execution-message error" : "execution-message"}
          role="status"
        >
          {message}
        </p>
      ) : null}
    </SurfaceCard>
  );
}

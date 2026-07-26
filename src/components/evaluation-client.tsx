"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { trackerQueryKeys } from "@/client/query-keys";
import {
  createEvaluationSession,
  fetchEvaluation,
  submitEvaluationDecision,
  submitEvaluationResult,
} from "@/client/tracker-api";
import {
  createOrReuseClientCommand,
  type PendingClientCommand,
} from "@/domain/client-command";
import type {
  EvaluationPageDto,
  EvaluationDecisionDocument,
  EvaluationDecisionInput,
  EvaluationResultAnswers,
  EvaluationResultDocument,
  EvaluationSessionSnapshot,
} from "@/domain/evaluation";

const trackerKey = "knee-rehab";
const evaluationQueryKey = trackerQueryKeys.evaluation(trackerKey);

const emptyResultDraft: EvaluationResultAnswers = {
  goalCompletion: "uncertain",
  sides: {
    left: {
      symptomResponse: "not_assessed",
      strengthAndControl: "not_assessed",
      loadTolerance: "not_assessed",
    },
    right: {
      symptomResponse: "not_assessed",
      strengthAndControl: "not_assessed",
      loadTolerance: "not_assessed",
    },
  },
  nextStageIntent: "undecided",
  note: "",
};

const symptomLabels = {
  none: "没有不适反应",
  mild: "轻微反应",
  moderate: "中等反应",
  severe: "明显反应",
  not_assessed: "尚未评估",
} as const;

const capacityLabels = {
  ready: "表现稳定",
  limited: "仍有限制",
  not_assessed: "尚未评估",
} as const;

const goalLabels = {
  met: "已达到",
  partially_met: "部分达到",
  not_met: "尚未达到",
  uncertain: "暂不确定",
} as const;

const intentLabels = {
  maintain: "倾向维持",
  progress: "倾向进阶",
  extend: "倾向延长当前阶段",
  professional_review: "倾向人工复评",
  undecided: "暂未决定",
} as const;

const weeklyStatusLabels = {
  effective: "计为有效",
  not_effective: "不计为有效",
  uncertain: "暂不确定",
} as const;

const weeklyReasonLabels = {
  completed_as_intended: "按预期完成",
  interrupted: "受到中断",
  safety_response: "出现需要留意的反应",
  insufficient_evidence: "记录不足",
  other: "其他原因",
} as const;

const branchLabels = {
  maintain: "维持当前能力",
  progress: "进入专项进阶",
  extend: "延长当前阶段",
  professional_review: "联系专业人员复评",
} as const;

function weekLabel(week: EvaluationSessionSnapshot["weeks"][number]) {
  return `${week.weekStart.slice(5).replace("-", "/")}–${week.weekEnd
    .slice(5)
    .replace("-", "/")}`;
}

function safetyLabel(level: "green" | "yellow" | "red" | null) {
  if (level === "red") return "红灯";
  if (level === "yellow") return "黄灯";
  if (level === "green") return "绿灯";
  return "无反馈";
}

function Evidence({ snapshot }: { snapshot: EvaluationSessionSnapshot }) {
  return (
    <section className="surface-card evaluation-evidence-card">
      <p className="eyebrow">{snapshot.evidenceRange.from} 起</p>
      <h2>训练周证据</h2>
      <p className="evaluation-guidance">
        有效训练周需要结合私人规则确认；当前只展示已经保存的事实。
      </p>
      <div className="evaluation-week-list">
        {snapshot.weeks.map((week) => (
          <article className="evaluation-week" key={week.weekStart}>
            <div className="evaluation-week-heading">
              <strong>{weekLabel(week)}</strong>
              <span>{safetyLabel(week.feedback.worstSafetyLevel)}</span>
            </div>
            <p>
              完成 {week.tasks.completed} / {week.tasks.total} 项
              {week.tasks.skipped > 0 ? ` · 跳过 ${week.tasks.skipped} 项` : ""}
            </p>
            <p>
              反馈 {week.feedback.feedbackDays} / {week.feedback.expectedDays}{" "}
              天
              {week.feedback.maxPain === null
                ? " · 暂无疼痛记录"
                : ` · 最高疼痛 ${week.feedback.maxPain} / 10`}
            </p>
            <p>
              暂停 {week.execution.pauseDays} 天 · 出差{" "}
              {week.execution.travelDays} 天
              {week.execution.equipmentLimitedDays > 0
                ? ` · 器械受限 ${week.execution.equipmentLimitedDays} 天`
                : ""}
              {week.execution.degradedDays > 0
                ? ` · 降级 ${week.execution.degradedDays} 天`
                : ""}
            </p>
            <p>
              时长覆盖 {week.loadCoverage.durationCoveredTasks} /{" "}
              {week.loadCoverage.completedTasks} 个完成任务
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ResultSummary({ result }: { result: EvaluationResultDocument }) {
  return (
    <section className="surface-card evaluation-result-card">
      <p className="eyebrow">不可变记录</p>
      <h2>评估结果已保存</h2>
      <p className="evaluation-guidance">
        这份结果不会被覆盖。记录评估结果不等于完成，也不会自动修改计划。
      </p>
      <ResultDetails result={result} />
    </section>
  );
}

function DecisionSummary({
  decision,
}: {
  decision: EvaluationDecisionDocument;
}) {
  return (
    <section className="surface-card evaluation-decision-card">
      <p className="eyebrow">你的决定</p>
      <h2>已由你完成选择</h2>
      <p className="evaluation-guidance">
        这是你根据记录作出的选择，不代表系统判定康复完成，也没有修改未来计划。
      </p>
      <p>
        <strong>{branchLabels[decision.branch]}</strong>
      </p>
      <p>
        {decision.branch === "professional_review"
          ? "下一步：联系医生或康复专业人员复评。"
          : "决定已记录；未来训练计划仍需单独制定、查看差异并确认。"}
      </p>
    </section>
  );
}

function DecisionDetails({ decision }: { decision: EvaluationDecisionInput }) {
  return (
    <>
      <div className="evaluation-week-confirmation-summary">
        {decision.weeklyConfirmations.map((week) => (
          <div key={week.weekStart}>
            <strong>
              {week.weekStart}–{week.weekEnd}
            </strong>
            <span>{weeklyStatusLabels[week.status]}</span>
            {week.reason ? (
              <small>{weeklyReasonLabels[week.reason]}</small>
            ) : null}
          </div>
        ))}
      </div>
      <p>
        <strong>下一步：{branchLabels[decision.branch]}</strong>
      </p>
      {decision.note ? (
        <p className="evaluation-result-note">{decision.note}</p>
      ) : null}
    </>
  );
}

function DecisionConfirmation({
  decision,
  saving,
  error,
  onEdit,
  onConfirm,
}: {
  decision: EvaluationDecisionInput;
  saving: boolean;
  error: string | null;
  onEdit: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className="surface-card evaluation-decision-confirmation">
      <p className="eyebrow">保存前检查</p>
      <h2>确认训练周和下一步</h2>
      <p className="evaluation-guidance">
        确认后不能修改。这是你的人工选择，不会自动宣布完成或改写计划。
      </p>
      <DecisionDetails decision={decision} />
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="evaluation-confirmation-actions">
        <button
          className="secondary-button"
          disabled={saving}
          type="button"
          onClick={onEdit}
        >
          返回修改
        </button>
        <button
          className="primary-button"
          disabled={saving}
          type="button"
          onClick={onConfirm}
        >
          {saving ? "正在保存…" : error ? "重试保存" : "确认并保存选择"}
        </button>
      </div>
    </section>
  );
}

function DecisionForm({
  draft,
  allowedBranches,
  progressBlockedReason,
  onChange,
  onSubmit,
}: {
  draft: EvaluationDecisionInput;
  allowedBranches: EvaluationDecisionInput["branch"][];
  progressBlockedReason:
    "red_safety" | "yellow_evidence" | "missing_green_evidence" | null;
  onChange: (draft: EvaluationDecisionInput) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      className="surface-card evaluation-result-form evaluation-decision-form"
      onSubmit={onSubmit}
    >
      <div>
        <p className="eyebrow">你的选择</p>
        <h2>确认训练周和下一步</h2>
        <p className="evaluation-guidance">
          每周是否有效由你根据冻结证据确认；系统不会代替你作医学判断。
        </p>
      </div>
      <div className="evaluation-week-decision-list">
        {draft.weeklyConfirmations.map((week, index) => (
          <fieldset key={week.weekStart}>
            <legend>
              {week.weekStart}–{week.weekEnd}
            </legend>
            <label>
              <span>这一周</span>
              <select
                value={week.status}
                onChange={(event) => {
                  const weeklyConfirmations = [...draft.weeklyConfirmations];
                  weeklyConfirmations[index] = {
                    ...week,
                    status: event.target.value as typeof week.status,
                  };
                  onChange({ ...draft, weeklyConfirmations });
                }}
              >
                {Object.entries(weeklyStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>原因（可选）</span>
              <select
                value={week.reason ?? ""}
                onChange={(event) => {
                  const weeklyConfirmations = [...draft.weeklyConfirmations];
                  weeklyConfirmations[index] = {
                    ...week,
                    reason: event.target.value
                      ? (event.target.value as NonNullable<typeof week.reason>)
                      : undefined,
                  };
                  onChange({ ...draft, weeklyConfirmations });
                }}
              >
                <option value="">不选择原因</option>
                {Object.entries(weeklyReasonLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        ))}
      </div>
      <label>
        <span>下一步</span>
        <select
          value={draft.branch}
          onChange={(event) =>
            onChange({
              ...draft,
              branch: event.target.value as EvaluationDecisionInput["branch"],
            })
          }
        >
          {allowedBranches.map((branch) => (
            <option key={branch} value={branch}>
              {branchLabels[branch]}
            </option>
          ))}
        </select>
      </label>
      {progressBlockedReason ? (
        <p className="evaluation-guidance">
          {progressBlockedReason === "red_safety"
            ? "记录中有红灯信号，当前只能选择联系专业人员复评。"
            : "记录中有黄灯或缺少完整绿灯证据，当前不能选择专项进阶。"}
        </p>
      ) : null}
      <label>
        <span>补充说明（可选）</span>
        <textarea
          maxLength={2_000}
          value={draft.note ?? ""}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
        />
      </label>
      <button className="primary-button" type="submit">
        检查你的选择
      </button>
    </form>
  );
}

function ResultDetails({ result }: { result: EvaluationResultAnswers }) {
  return (
    <>
      <dl className="evaluation-result-summary">
        <div>
          <dt>目标完成情况</dt>
          <dd>{goalLabels[result.goalCompletion]}</dd>
        </div>
        <div>
          <dt>左侧</dt>
          <dd>
            {symptomLabels[result.sides.left.symptomResponse]} ·{" "}
            {capacityLabels[result.sides.left.strengthAndControl]} ·{" "}
            {capacityLabels[result.sides.left.loadTolerance]}
          </dd>
        </div>
        <div>
          <dt>右侧</dt>
          <dd>
            {symptomLabels[result.sides.right.symptomResponse]} ·{" "}
            {capacityLabels[result.sides.right.strengthAndControl]} ·{" "}
            {capacityLabels[result.sides.right.loadTolerance]}
          </dd>
        </div>
        <div>
          <dt>下一阶段意向</dt>
          <dd>{intentLabels[result.nextStageIntent]}</dd>
        </div>
      </dl>
      {result.note ? (
        <p className="evaluation-result-note">{result.note}</p>
      ) : null}
    </>
  );
}

function ResultConfirmation({
  result,
  saving,
  error,
  onEdit,
  onConfirm,
}: {
  result: EvaluationResultAnswers;
  saving: boolean;
  error: string | null;
  onEdit: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className="surface-card evaluation-result-confirmation">
      <p className="eyebrow">保存前检查</p>
      <h2>确认评估结果</h2>
      <p className="evaluation-guidance">
        确认保存后不能修改。记录评估结果不等于康复完成，也不会自动修改计划。
      </p>
      <ResultDetails result={result} />
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="evaluation-confirmation-actions">
        <button
          className="secondary-button"
          disabled={saving}
          type="button"
          onClick={onEdit}
        >
          返回修改
        </button>
        <button
          className="primary-button"
          disabled={saving}
          type="button"
          onClick={onConfirm}
        >
          {saving ? "正在保存…" : error ? "重试保存" : "确认并保存"}
        </button>
      </div>
    </section>
  );
}

function ResultForm({
  draft,
  onChange,
  onSubmit,
}: {
  draft: EvaluationResultAnswers;
  onChange: (draft: EvaluationResultAnswers) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const updateSide = (
    side: "left" | "right",
    field: keyof EvaluationResultAnswers["sides"]["left"],
    value: string,
  ) =>
    onChange({
      ...draft,
      sides: {
        ...draft.sides,
        [side]: { ...draft.sides[side], [field]: value },
      },
    } as EvaluationResultAnswers);

  return (
    <form className="surface-card evaluation-result-form" onSubmit={onSubmit}>
      <div>
        <p className="eyebrow">你的评估</p>
        <h2>记录评估结果</h2>
        <p className="evaluation-guidance">
          左右侧分别记录。保存只会留下事实，不会自动判定完成或调整计划。
        </p>
      </div>
      <label>
        <span>目标完成情况</span>
        <select
          value={draft.goalCompletion}
          onChange={(event) =>
            onChange({
              ...draft,
              goalCompletion: event.target
                .value as EvaluationResultAnswers["goalCompletion"],
            })
          }
        >
          {Object.entries(goalLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {(["left", "right"] as const).map((side) => {
        const sideLabel = side === "left" ? "左侧" : "右侧";
        return (
          <fieldset key={side}>
            <legend>{sideLabel}</legend>
            <label>
              <span>{sideLabel}反应</span>
              <select
                value={draft.sides[side].symptomResponse}
                onChange={(event) =>
                  updateSide(side, "symptomResponse", event.target.value)
                }
              >
                {Object.entries(symptomLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{sideLabel}力量和动作控制</span>
              <select
                value={draft.sides[side].strengthAndControl}
                onChange={(event) =>
                  updateSide(side, "strengthAndControl", event.target.value)
                }
              >
                {Object.entries(capacityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{sideLabel}负荷耐受</span>
              <select
                value={draft.sides[side].loadTolerance}
                onChange={(event) =>
                  updateSide(side, "loadTolerance", event.target.value)
                }
              >
                {Object.entries(capacityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        );
      })}
      <label>
        <span>下一阶段意向</span>
        <select
          value={draft.nextStageIntent}
          onChange={(event) =>
            onChange({
              ...draft,
              nextStageIntent: event.target
                .value as EvaluationResultAnswers["nextStageIntent"],
            })
          }
        >
          {Object.entries(intentLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>补充说明（可选）</span>
        <textarea
          maxLength={2_000}
          value={draft.note ?? ""}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
        />
      </label>
      <button className="primary-button" type="submit">
        检查评估结果
      </button>
    </form>
  );
}

export function EvaluationClient() {
  const queryClient = useQueryClient();
  const queryKey = evaluationQueryKey;
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchEvaluation(trackerKey, signal),
    staleTime: 60_000,
  });
  const pending = useRef<PendingClientCommand | null>(null);
  const resultPending = useRef<PendingClientCommand | null>(null);
  const resultInFlight = useRef(false);
  const decisionPending = useRef<PendingClientCommand | null>(null);
  const decisionInFlight = useRef(false);
  const decisionSession = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [resultDraft, setResultDraft] =
    useState<EvaluationResultAnswers>(emptyResultDraft);
  const [resultSaving, setResultSaving] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const [resultConfirmation, setResultConfirmation] =
    useState<EvaluationResultAnswers | null>(null);
  const [decisionDraft, setDecisionDraft] = useState<EvaluationDecisionInput>({
    weeklyConfirmations: [],
    branch: "professional_review",
    note: "",
  });
  const [decisionConfirmation, setDecisionConfirmation] =
    useState<EvaluationDecisionInput | null>(null);
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  useEffect(() => {
    const trackedQuery = queryClient
      .getQueryCache()
      .find({ queryKey, exact: true });
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.query !== trackedQuery) return;
      const data = event.query.state.data as EvaluationPageDto | undefined;
      if (data?.state === "opened" && data.resultSubmission.allowed) {
        return;
      }
      setResultConfirmation(null);
      if (
        data?.state === "opened" &&
        data.decisionSubmission.allowed &&
        decisionConfirmation &&
        data.decisionSubmission.allowedBranches.includes(
          decisionConfirmation.branch,
        )
      ) {
        return;
      }
      setDecisionConfirmation(null);
      if (
        data?.state === "opened" &&
        data.result &&
        !data.decision &&
        !data.decisionSubmission.allowedBranches.includes(decisionDraft.branch)
      ) {
        const firstAllowed =
          data.decisionSubmission.allowedBranches[0] ?? "professional_review";
        setDecisionDraft((current) => ({ ...current, branch: firstAllowed }));
        decisionPending.current = null;
      }
    });
  }, [decisionConfirmation, decisionDraft.branch, queryClient, queryKey]);

  useEffect(() => {
    if (
      query.data?.state !== "opened" ||
      !query.data.result ||
      query.data.decision ||
      decisionSession.current === query.data.session.id
    ) {
      return;
    }
    decisionSession.current = query.data.session.id;
    const firstAllowed =
      query.data.decisionSubmission.allowedBranches[0] ?? "professional_review";
    setDecisionDraft({
      weeklyConfirmations: query.data.session.weeks.map((week) => ({
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        status: "uncertain",
      })),
      branch: firstAllowed,
      note: "",
    });
    decisionPending.current = null;
    setDecisionConfirmation(null);
    setDecisionError(null);
  }, [query.data]);

  const resultSubmissionAllowed =
    query.data?.state === "opened" && query.data.resultSubmission.allowed;

  async function openEvaluation() {
    setSaving(true);
    setSaveError(false);
    pending.current = createOrReuseClientCommand(pending.current, {
      kind: "final",
    });
    try {
      const result = await createEvaluationSession(trackerKey, {
        ...pending.current.metadata,
        kind: "final",
      });
      queryClient.setQueryData(queryKey, result);
      pending.current = null;
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  function prepareResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resultSubmissionAllowed) return;
    const answers: EvaluationResultAnswers = {
      ...resultDraft,
      ...(resultDraft.note?.trim()
        ? { note: resultDraft.note.trim() }
        : { note: undefined }),
    };
    resultPending.current = createOrReuseClientCommand(
      resultPending.current,
      answers,
    );
    setResultError(null);
    setResultConfirmation(answers);
  }

  async function saveResult() {
    if (
      resultInFlight.current ||
      !resultConfirmation ||
      query.data?.state !== "opened" ||
      !query.data.resultSubmission.allowed
    ) {
      return;
    }
    resultInFlight.current = true;
    setResultSaving(true);
    setResultError(null);
    const pendingCommand = resultPending.current;
    if (!pendingCommand) {
      resultInFlight.current = false;
      setResultSaving(false);
      return;
    }
    try {
      const result = await submitEvaluationResult(trackerKey, {
        ...pendingCommand.metadata,
        sessionId: query.data.session.id,
        answers: resultConfirmation,
      });
      queryClient.setQueryData(queryKey, result);
      resultPending.current = null;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setResultError(
        code === "red_safety"
          ? "当前有红灯反馈，请先停止并重新评估。草稿仍会保留。"
          : code === "evaluation_result_context_changed"
            ? "近期记录或计划已经变化，请保留当前内容并重试。"
            : "暂时无法保存，当前内容仍会保留，请重试。",
      );
    } finally {
      resultInFlight.current = false;
      setResultSaving(false);
    }
  }

  function prepareDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      query.data?.state !== "opened" ||
      !query.data.decisionSubmission.allowed ||
      !query.data.decisionSubmission.allowedBranches.includes(
        decisionDraft.branch,
      )
    )
      return;
    const decision: EvaluationDecisionInput = {
      ...decisionDraft,
      ...(decisionDraft.note?.trim()
        ? { note: decisionDraft.note.trim() }
        : { note: undefined }),
    };
    decisionPending.current = createOrReuseClientCommand(
      decisionPending.current,
      decision,
    );
    setDecisionError(null);
    setDecisionConfirmation(decision);
  }

  async function saveDecision() {
    if (
      decisionInFlight.current ||
      !decisionConfirmation ||
      !decisionPending.current ||
      query.data?.state !== "opened" ||
      !query.data.decisionSubmission.allowed ||
      !query.data.decisionSubmission.allowedBranches.includes(
        decisionConfirmation.branch,
      )
    )
      return;
    decisionInFlight.current = true;
    setDecisionSaving(true);
    setDecisionError(null);
    try {
      const result = await submitEvaluationDecision(trackerKey, {
        ...decisionPending.current.metadata,
        sessionId: query.data.session.id,
        decision: decisionConfirmation,
      });
      queryClient.setQueryData(queryKey, result);
      decisionPending.current = null;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setDecisionError(
        code === "red_safety"
          ? "当前有红灯记录，只能选择联系专业人员复评。草稿仍会保留。"
          : code === "yellow_evidence" || code === "missing_green_evidence"
            ? "当前记录不支持专项进阶，请返回修改选择。"
            : code === "evaluation_decision_context_changed"
              ? "近期记录或计划已经变化，请保留当前内容并重新检查。"
              : "暂时无法保存，当前选择仍会保留，请重试。",
      );
    } finally {
      decisionInFlight.current = false;
      setDecisionSaving(false);
    }
  }

  if (!query.data && query.isPending) {
    return (
      <main className="app-shell page-frame evaluation-page" aria-busy="true">
        <header className="evaluation-page-header">
          <p className="eyebrow">计划阶段</p>
          <h1>阶段评估</h1>
        </header>
        <section className="surface-card page-section-loading" role="status">
          正在整理评估条件…
        </section>
      </main>
    );
  }

  if (!query.data) {
    return (
      <main className="app-shell page-frame evaluation-page">
        <header className="evaluation-page-header">
          <p className="eyebrow">计划阶段</p>
          <h1>阶段评估</h1>
        </header>
        <section className="surface-card trend-error-card" role="alert">
          <h2>评估暂时无法加载</h2>
          <p>请检查网络后重试，已有记录不会受影响。</p>
          <button
            className="primary-button"
            onClick={() => void query.refetch()}
          >
            重试
          </button>
        </section>
      </main>
    );
  }

  const data = query.data;
  return (
    <main
      className="app-shell page-frame evaluation-page"
      aria-label="阶段评估页面"
    >
      <header className="evaluation-page-header">
        <div>
          <p className="eyebrow">计划阶段</p>
          <h1>阶段评估</h1>
        </div>
        <Link className="secondary-button" href="/trends">
          返回趋势
        </Link>
      </header>

      <section className="surface-card evaluation-status-card">
        <h2>评估尚未等于完成</h2>
        {data.state === "before_target" ? (
          <p>到达计划目标日 {data.targetDate} 后，才会开放评估。</p>
        ) : data.state === "eligible" ? (
          <>
            <p>已到达计划目标日。开启后只会冻结证据，不会自动宣布完成。</p>
            <button
              className="primary-button"
              type="button"
              disabled={saving}
              onClick={() => void openEvaluation()}
            >
              {saving ? "正在开启…" : "开启评估"}
            </button>
          </>
        ) : data.state === "expired" ? (
          <>
            <h3>这次评估已过期</h3>
            <p>近期计划已经变化，需要按当前安排重新整理证据。</p>
            {data.canOpenReplacement ? (
              <button
                className="primary-button"
                type="button"
                disabled={saving}
                onClick={() => void openEvaluation()}
              >
                {saving ? "正在开启…" : "重新开启评估"}
              </button>
            ) : (
              <p>到达新的目标日 {data.targetDate} 后可重新开启。</p>
            )}
          </>
        ) : data.state === "unavailable" ? (
          <p>当前计划还没有可用于评估的目标任务日期。</p>
        ) : (
          <p>
            {data.result
              ? "评估结果已经保存，可继续回顾冻结证据。"
              : "证据已冻结，可以分别记录左右侧评估。"}
          </p>
        )}
        {saveError ? (
          <p className="inline-error" role="alert">
            暂时无法开启，内容没有保存，请稍后重试。
          </p>
        ) : null}
      </section>

      {data.state === "opened" && data.result ? (
        <ResultSummary result={data.result} />
      ) : null}

      {data.state === "opened" && data.decision ? (
        <DecisionSummary decision={data.decision} />
      ) : null}

      {data.state === "opened" &&
      data.result &&
      !data.decision &&
      data.decisionSubmission.allowed &&
      decisionConfirmation ? (
        <DecisionConfirmation
          decision={decisionConfirmation}
          saving={decisionSaving}
          error={decisionError}
          onEdit={() => {
            setDecisionConfirmation(null);
            setDecisionError(null);
          }}
          onConfirm={() => void saveDecision()}
        />
      ) : null}

      {data.state === "opened" &&
      data.result &&
      !data.decision &&
      data.decisionSubmission.allowed &&
      !decisionConfirmation &&
      decisionDraft.weeklyConfirmations.length === data.session.weeks.length ? (
        <DecisionForm
          draft={decisionDraft}
          allowedBranches={data.decisionSubmission.allowedBranches}
          progressBlockedReason={data.decisionSubmission.progressBlockedReason}
          onChange={(next) => {
            setDecisionDraft(next);
            decisionPending.current = null;
          }}
          onSubmit={prepareDecision}
        />
      ) : null}

      {data.state === "opened" &&
      !data.result &&
      data.resultSubmission.allowed &&
      resultConfirmation ? (
        <ResultConfirmation
          result={resultConfirmation}
          saving={resultSaving}
          error={resultError}
          onEdit={() => {
            setResultConfirmation(null);
            setResultError(null);
          }}
          onConfirm={() => void saveResult()}
        />
      ) : null}

      {data.state === "opened" &&
      !data.result &&
      data.resultSubmission.allowed &&
      !resultConfirmation ? (
        <ResultForm
          draft={resultDraft}
          onChange={setResultDraft}
          onSubmit={prepareResult}
        />
      ) : null}

      {data.state === "opened" &&
      !data.result &&
      data.resultSubmission.blockedReason === "red_safety" ? (
        <section
          className="surface-card evaluation-result-blocked"
          role="alert"
        >
          <h2>先停止并重新评估</h2>
          <p>当前有红灯反馈，暂不保存阶段评估结果。</p>
        </section>
      ) : null}

      {(data.state === "opened" || data.state === "expired") && data.session ? (
        <Evidence snapshot={data.session} />
      ) : null}
    </main>
  );
}

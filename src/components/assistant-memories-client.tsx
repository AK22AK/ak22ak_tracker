"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { trackerQueryKeys } from "@/client/query-keys";
import {
  deleteAssistantMemory,
  fetchAssistantConversation,
  updateAssistantMemory,
} from "@/client/tracker-api";
import type { AssistantConversationDto } from "@/domain/rehab-assistant";

const trackerKey = "knee-rehab";
const labels = {
  goal: "目标",
  preference: "偏好",
  schedule: "时间安排",
  equipment: "器械条件",
  routine: "训练习惯",
  stable_constraint: "稳定限制",
} as const;

type Memory = AssistantConversationDto["memories"][number];

function MemoryEditor({
  memory,
  onUpdated,
}: {
  memory: Memory;
  onUpdated: (value: AssistantConversationDto) => void;
}) {
  const [category, setCategory] = useState(memory.category);
  const [content, setContent] = useState(memory.content);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    if (!content.trim() || saving) return;
    setSaving(true);
    setStatus(null);
    try {
      onUpdated(
        await updateAssistantMemory(trackerKey, memory.id, {
          category,
          content,
        }),
      );
      setStatus("记忆已更新");
    } catch {
      setStatus("没有保存成功，修改仍保留。");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (saving) return;
    setSaving(true);
    setStatus(null);
    try {
      onUpdated(await deleteAssistantMemory(trackerKey, memory.id));
    } catch {
      setStatus("没有删除成功，可以重试。");
      setSaving(false);
    }
  }

  return (
    <article className="assistant-memory-item">
      <label>
        类型
        <select
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as Memory["category"])
          }
        >
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        记忆内容
        <textarea
          aria-label="记忆内容"
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
      </label>
      <div className="button-row">
        <button
          className="secondary-button"
          type="button"
          disabled={saving || !content.trim()}
          onClick={() => void save()}
        >
          保存修改
        </button>
        {!confirmingDelete ? (
          <button
            className="text-button"
            type="button"
            disabled={saving}
            onClick={() => setConfirmingDelete(true)}
          >
            删除
          </button>
        ) : (
          <div className="assistant-memory-delete-confirmation">
            <span>确定删除这条记忆？</span>
            <button
              type="button"
              disabled={saving}
              onClick={() => void remove()}
            >
              确认删除
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setConfirmingDelete(false)}
            >
              取消
            </button>
          </div>
        )}
      </div>
      {status ? <p role="status">{status}</p> : null}
    </article>
  );
}

export function AssistantMemoriesClient() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: trackerQueryKeys.assistant(trackerKey),
    queryFn: ({ signal }) => fetchAssistantConversation(trackerKey, signal),
    staleTime: 30_000,
  });
  const active =
    query.data?.memories.filter((memory) => memory.status === "active") ?? [];
  const update = (value: AssistantConversationDto) => {
    queryClient.setQueryData(trackerQueryKeys.assistant(trackerKey), value);
    void queryClient.invalidateQueries({
      queryKey: trackerQueryKeys.planWorkspace(trackerKey),
    });
  };

  return (
    <main
      className="app-shell page-frame settings-detail-page"
      aria-label="助手记忆"
    >
      <header className="settings-detail-header">
        <div>
          <p className="eyebrow">康复助手</p>
          <h1>助手记忆</h1>
        </div>
        <Link href="/plan">返回</Link>
      </header>
      <section className="surface-card assistant-privacy-note">
        <h2>只保留稳定、可复用的信息</h2>
        <p>
          目标、偏好、时间、器械和训练习惯可以记住；身体状态、风险判断、康复档案和计划不会由记忆改写。
        </p>
      </section>
      {query.isPending ? <p role="status">正在读取记忆…</p> : null}
      {query.isError ? <p role="alert">记忆暂时无法加载。</p> : null}
      {!query.isPending && !query.isError && active.length === 0 ? (
        <section className="surface-card">
          <h2>还没有助手记忆</h2>
          <p>在对话中提到稳定目标或器械条件后，可在这里查看和管理。</p>
        </section>
      ) : null}
      {active.length > 0 ? (
        <section
          className="surface-card assistant-memory-list"
          aria-label="有效记忆"
        >
          {active.map((memory) => (
            <MemoryEditor key={memory.id} memory={memory} onUpdated={update} />
          ))}
        </section>
      ) : null}
    </main>
  );
}

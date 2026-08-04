"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";

import { trackerQueryKeys } from "@/client/query-keys";
import {
  fetchAssistantConversation,
  saveRehabProfile,
} from "@/client/tracker-api";
import type { RehabProfileDocument } from "@/domain/rehab-assistant";

const trackerKey = "knee-rehab";
const emptyProfile: RehabProfileDocument = {
  schemaVersion: "1.0.0",
  goals: [],
  background: [],
  clinicianGuidance: [],
  hardConstraints: [],
  trainingPreferences: [],
};

const fields = [
  ["goals", "康复目标", "每行一条稳定目标"],
  ["background", "康复背景", "只填写整理后的背景，不粘贴原始报告"],
  ["clinicianGuidance", "专业指导", "每行一条已经确认的指导"],
  ["hardConstraints", "明确限制", "每行一条需要始终遵守的限制"],
  ["trainingPreferences", "训练偏好", "每行一条长期偏好"],
] as const;

function toText(values: string[]) {
  return values.join("\n");
}

function fromText(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function RehabProfileClient() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: trackerQueryKeys.assistant(trackerKey),
    queryFn: ({ signal }) => fetchAssistantConversation(trackerKey, signal),
    staleTime: 30_000,
  });
  const [draft, setDraft] = useState<RehabProfileDocument>(emptyProfile);
  const [sourceVersion, setSourceVersion] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const profile = query.data?.profile;
    if (!profile || profile.version === sourceVersion) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setDraft(profile.document);
      setSourceVersion(profile.version);
    });
    return () => {
      cancelled = true;
    };
  }, [query.data?.profile, sourceVersion]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setStatus(null);
    try {
      const profile = await saveRehabProfile(trackerKey, draft);
      queryClient.setQueryData(
        trackerQueryKeys.assistant(trackerKey),
        (current: typeof query.data) =>
          current ? { ...current, profile } : current,
      );
      setSourceVersion(profile.version);
      setStatus(`已保存为版本 ${profile.version}`);
      void queryClient.invalidateQueries({
        queryKey: trackerQueryKeys.planWorkspace(trackerKey),
      });
    } catch {
      setStatus("没有保存成功，修改仍保留，可以直接重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main
      className="app-shell page-frame settings-detail-page"
      aria-label="康复档案"
    >
      <header className="settings-detail-header">
        <div>
          <p className="eyebrow">计划</p>
          <h1>康复档案</h1>
        </div>
        <Link href="/plan">返回</Link>
      </header>
      <section className="surface-card assistant-privacy-note">
        <h2>只保存整理后的结构化资料</h2>
        <p>
          原始 MRI、PDF、笔记全文和本机路径不会保存在这里，也不会发送给模型。
        </p>
      </section>
      {query.isPending ? <p role="status">正在读取档案…</p> : null}
      {query.isError ? (
        <p role="alert">档案暂时无法加载，请稍后再试。</p>
      ) : null}
      {!query.isPending && !query.isError ? (
        <section className="surface-card rehab-profile-form">
          <p>
            {sourceVersion ? `当前版本 ${sourceVersion}` : "还没有档案版本"}
          </p>
          {fields.map(([key, label, help]) => (
            <label key={key}>
              <span>{label}</span>
              <small>{help}</small>
              <textarea
                aria-label={label}
                value={toText(draft[key])}
                onChange={(event) => {
                  setStatus(null);
                  setDraft((current) => ({
                    ...current,
                    [key]: fromText(event.target.value),
                  }));
                }}
              />
            </label>
          ))}
          <button
            className="primary-button"
            type="button"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "正在保存…" : "保存为新版本"}
          </button>
          {status ? <p role="status">{status}</p> : null}
        </section>
      ) : null}
    </main>
  );
}

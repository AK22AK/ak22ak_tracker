"use client";

import { useMemo, useState, useSyncExternalStore } from "react";

export const SHELL_DIAGNOSTICS_ENABLED_KEY = "ak.shellDiagnostics.enabled.v1";
export const SHELL_DIAGNOSTICS_REPORT_KEY = "ak.shellDiagnostics.report.v1";

type ShellDiagnosticsReport = {
  schemaVersion: number;
  environment?: {
    displayMode?: string;
    screen?: {
      width?: number;
      height?: number;
      devicePixelRatio?: number;
    };
  };
  events?: unknown[];
};

const diagnosticsChangeEvent = "ak-shell-diagnostics-change";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(diagnosticsChangeEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(diagnosticsChangeEvent, onStoreChange);
  };
}

function readArmed() {
  try {
    const preference = localStorage.getItem(SHELL_DIAGNOSTICS_ENABLED_KEY);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return preference === "1" || (preference !== "0" && standalone);
  } catch {
    return false;
  }
}

function readReportValue() {
  try {
    return localStorage.getItem(SHELL_DIAGNOSTICS_REPORT_KEY);
  } catch {
    return null;
  }
}

function parseReport(value: string | null): ShellDiagnosticsReport | null {
  try {
    return value ? (JSON.parse(value) as ShellDiagnosticsReport) : null;
  } catch {
    return null;
  }
}

function publishStorageChange() {
  window.dispatchEvent(new Event(diagnosticsChangeEvent));
}

function reportText(report: ShellDiagnosticsReport) {
  return JSON.stringify(report, null, 2);
}

export function ShellViewportDiagnosticsPanel() {
  const armed = useSyncExternalStore(subscribe, readArmed, () => false);
  const reportValue = useSyncExternalStore(
    subscribe,
    readReportValue,
    () => null,
  );
  const report = useMemo(() => parseReport(reportValue), [reportValue]);
  const [message, setMessage] = useState("");

  const armCapture = () => {
    localStorage.setItem(SHELL_DIAGNOSTICS_ENABLED_KEY, "1");
    localStorage.removeItem(SHELL_DIAGNOSTICS_REPORT_KEY);
    publishStorageChange();
    setMessage("下一次启动将采集匿名布局数据");
  };

  const stopCapture = () => {
    localStorage.setItem(SHELL_DIAGNOSTICS_ENABLED_KEY, "0");
    publishStorageChange();
    setMessage("后续启动不会继续采集");
  };

  const copyReport = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(reportText(report));
    setMessage("匿名诊断已复制");
  };

  const downloadReport = () => {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([reportText(report)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "ak-shell-diagnostics.json";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("匿名诊断已下载");
  };

  return (
    <section
      className="shell-diagnostics-panel"
      aria-labelledby="shell-diagnostics-title"
    >
      <div>
        <p className="eyebrow">仅用于本次排查</p>
        <h2 id="shell-diagnostics-title">iOS 布局诊断</h2>
      </div>
      <p>
        只在这台设备本地记录视口、safe area
        和页面容器尺寸；不记录账号、健康内容或 Provider 数据，也不会自动上传。
      </p>
      {report ? (
        <p role="status">已采集 {report.events?.length ?? 0} 个时间点</p>
      ) : (
        <p role="status">
          {armed
            ? "已准备采集；请完全关闭后从主屏重新打开。"
            : "尚未准备采集。"}
        </p>
      )}
      <div className="shell-diagnostics-actions">
        <button className="secondary-button" type="button" onClick={armCapture}>
          准备下一次冷启动采集
        </button>
        {report ? (
          <>
            <button
              className="secondary-button"
              type="button"
              onClick={copyReport}
            >
              复制匿名诊断
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={downloadReport}
            >
              下载匿名诊断
            </button>
          </>
        ) : null}
        {armed ? (
          <button className="text-button" type="button" onClick={stopCapture}>
            停止后续采集
          </button>
        ) : null}
      </div>
      {message ? <p aria-live="polite">{message}</p> : null}
    </section>
  );
}

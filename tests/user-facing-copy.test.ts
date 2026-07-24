import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx", ".js"].includes(extname(path)) ? [path] : [];
  });
}

const userSurfaceFiles = [
  ...sourceFiles(join(process.cwd(), "src/components")),
  ...sourceFiles(join(process.cwd(), "src/app/(protected)")),
  join(process.cwd(), "src/app/login/page.tsx"),
  join(process.cwd(), "public/offline.js"),
  join(process.cwd(), "public/offline.html"),
];
const userSurfaceCopy = userSurfaceFiles
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

describe("user-facing copy boundary", () => {
  it("does not expose implementation and acceptance-test language", () => {
    for (const phrase of [
      "服务端",
      "服务器",
      "权威",
      "白名单",
      "安全规则",
      "只读快照",
      "计划处方",
      "执行上下文",
      "计划时间线",
      "不可变计划版本",
      "输入轮换后的 Key",
      "GitHub 私人镜像",
      "待镜像",
      "追赶同步",
      "队首",
      "基础计划不会因此被改写",
      "镜像失败不会影响",
      "来源关联不会自动完成任务",
      "外部集成状态请在",
      "离线缓存",
      "本机缓存",
    ]) {
      expect(
        userSurfaceCopy,
        `unexpected user-facing phrase: ${phrase}`,
      ).not.toContain(phrase);
    }
  });

  it("keeps safety, unsaved-state, and destructive-action guidance", () => {
    for (const phrase of [
      "0 表示没有疼痛，10 表示最严重",
      "停止相关诱发负荷",
      "尚未保存",
      "仅保存在本机",
      "等待联网确认",
      "永久丢弃",
      "当前离线",
      "API Key",
      "GitHub 私人仓库",
    ]) {
      expect(
        userSurfaceCopy,
        `missing required user guidance: ${phrase}`,
      ).toContain(phrase);
    }
  });
});

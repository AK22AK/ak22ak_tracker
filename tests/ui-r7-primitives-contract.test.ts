import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function componentFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return componentFiles(entryPath);
    return /\.(ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

describe("production UI primitive contract", () => {
  it("keeps every exported primitive consumed by formal components", () => {
    const primitivesPath = path.join(
      process.cwd(),
      "src/components/ui/primitives.tsx",
    );
    const primitivesSource = readFileSync(primitivesPath, "utf8");
    const exportedFunctions = [
      ...primitivesSource.matchAll(/export function ([A-Z][A-Za-z0-9_]*)/g),
    ].map((match) => match[1]);
    const consumers = componentFiles(path.join(process.cwd(), "src/components"))
      .filter((filePath) => filePath !== primitivesPath)
      .map((filePath) => readFileSync(filePath, "utf8"))
      .join("\n");

    expect(exportedFunctions.length).toBeGreaterThan(0);
    for (const name of exportedFunctions) {
      expect(consumers).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});

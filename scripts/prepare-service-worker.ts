import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveServiceWorkerBuildRevision } from "../src/service-worker/build-revision";
import { buildServiceWorkerSource } from "../src/service-worker/source";

const revision = resolveServiceWorkerBuildRevision();
const outputPath = resolve(process.cwd(), "public/sw.js");

async function main() {
  await mkdir(resolve(process.cwd(), "public"), { recursive: true });
  await writeFile(outputPath, buildServiceWorkerSource(revision), "utf8");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

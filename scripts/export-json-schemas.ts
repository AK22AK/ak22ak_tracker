import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import {
  externalRecordSchema,
  planChangeProposalSchema,
  planVersionSchema,
  trackerEventSchema,
} from "../src/domain/schemas";

const schemas = {
  "plan-version.schema.json": planVersionSchema,
  "event.schema.json": trackerEventSchema,
  "external-record.schema.json": externalRecordSchema,
  "plan-change-proposal.schema.json": planChangeProposalSchema,
};

async function main() {
  const outputDirectory = resolve(process.argv[2] ?? "schemas/v1");
  await mkdir(outputDirectory, { recursive: true });

  await Promise.all(
    Object.entries(schemas).map(async ([filename, schema]) => {
      const document = z.toJSONSchema(schema, {
        target: "draft-2020-12",
        unrepresentable: "any",
      });
      await writeFile(
        resolve(outputDirectory, filename),
        `${JSON.stringify(document, null, 2)}\n`,
        "utf8",
      );
    }),
  );

  console.log(
    `Exported ${Object.keys(schemas).length} schemas to ${outputDirectory}`,
  );
}

void main();

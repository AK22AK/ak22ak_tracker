import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import {
  externalRecordSchema,
  planChangeProposalSchema,
  planVersionSchema,
  trackerEventSchema,
} from "../src/domain/schemas";
import { trackerSafetyPolicyDocumentSchema } from "../src/domain/safety-policy";
import { executionAlternativeBundleSchema } from "../src/domain/execution-context";

const schemas = {
  "plan-version.schema.json": planVersionSchema,
  "event.schema.json": trackerEventSchema,
  "external-record.schema.json": externalRecordSchema,
  "plan-change-proposal.schema.json": planChangeProposalSchema,
  "tracker-safety-policy.schema.json": trackerSafetyPolicyDocumentSchema,
  "execution-alternative-bundle.schema.json": executionAlternativeBundleSchema,
};

async function main() {
  const outputArgument = process.argv
    .slice(2)
    .find((argument) => argument !== "--");
  const outputDirectory = resolve(outputArgument ?? "schemas/v1");
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

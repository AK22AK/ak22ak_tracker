import { localDateSchema } from "./schemas";

export interface PlanImportArguments {
  planPath: string;
  trackerStartedOn?: string;
}

export function parsePlanImportArguments(
  arguments_: readonly string[],
): PlanImportArguments {
  const normalized = arguments_.filter((argument) => argument !== "--");
  let planPath: string | undefined;
  let trackerStartedOn: string | undefined;

  for (let index = 0; index < normalized.length; index += 1) {
    const argument = normalized[index];
    if (!argument) continue;

    if (argument === "--tracker-started-on") {
      const value = normalized[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--tracker-started-on requires a YYYY-MM-DD value");
      }
      trackerStartedOn = parseLocalDate(value);
      index += 1;
      continue;
    }

    if (argument.startsWith("--tracker-started-on=")) {
      trackerStartedOn = parseLocalDate(
        argument.slice(argument.indexOf("=") + 1),
      );
      continue;
    }

    if (argument.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    }

    if (planPath) {
      throw new Error("Only one plan document may be imported at a time");
    }
    planPath = argument;
  }

  if (!planPath) {
    throw new Error("A plan document path is required");
  }

  return { planPath, trackerStartedOn };
}

function parseLocalDate(value: string) {
  const parsed = localDateSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Tracker start date must be a valid YYYY-MM-DD date");
  }
  return parsed.data;
}

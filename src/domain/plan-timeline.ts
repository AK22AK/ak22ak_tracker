import { isLocalDate } from "./calendar";

export type EffectivePlanVersion = {
  effectiveFrom: string;
  version: number;
};

export function resolveEffectivePlanVersion<T extends EffectivePlanVersion>(
  versions: readonly T[],
  targetDate: string,
): T | null {
  if (!isLocalDate(targetDate)) {
    throw new Error("Invalid target date");
  }

  return (
    versions
      .filter((version) => version.effectiveFrom <= targetDate)
      .toSorted((left, right) => {
        const dateOrder = right.effectiveFrom.localeCompare(left.effectiveFrom);
        return dateOrder !== 0 ? dateOrder : right.version - left.version;
      })[0] ?? null
  );
}

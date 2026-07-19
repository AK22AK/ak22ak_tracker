import { describe, expect, it } from "vitest";

import { resolveEffectivePlanVersion } from "@/domain/plan-timeline";

const versions = [
  { id: "v1", version: 1, effectiveFrom: "2026-07-18" },
  { id: "v2", version: 2, effectiveFrom: "2026-07-25" },
];

describe("effective plan timeline (P0-01)", () => {
  it("does not expose a version before its effective date", () => {
    expect(resolveEffectivePlanVersion(versions, "2026-07-17")).toBeNull();
  });

  it("uses v1 before v2 and v2 from its effective date", () => {
    expect(resolveEffectivePlanVersion(versions, "2026-07-18")?.id).toBe("v1");
    expect(resolveEffectivePlanVersion(versions, "2026-07-24")?.id).toBe("v1");
    expect(resolveEffectivePlanVersion(versions, "2026-07-25")?.id).toBe("v2");
  });

  it("uses the highest version when two versions share an effective date", () => {
    expect(
      resolveEffectivePlanVersion(
        [...versions, { id: "v3", version: 3, effectiveFrom: "2026-07-25" }],
        "2026-07-25",
      )?.id,
    ).toBe("v3");
  });
});

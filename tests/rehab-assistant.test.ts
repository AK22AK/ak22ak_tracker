import { describe, expect, it } from "vitest";

import {
  assistantAssociationForModel,
  assistantTurnResponseSchema,
  rehabProfileDocumentSchema,
  saveAssistantFeedbackCommandSchema,
} from "@/domain/rehab-assistant";

describe("rehabilitation assistant public contracts", () => {
  it("accepts a bounded reply with a reviewable feedback draft and safe memory actions", () => {
    expect(
      assistantTurnResponseSchema.parse({
        reply: "先确认昨天的训练反应，再决定是否需要调整。",
        followUpQuestions: ["今天走路时还有不适吗？"],
        feedbackDraft: {
          localDate: "2026-08-03",
          timing: "next_day",
          leftPain: 0,
          rightPain: 2,
          swelling: "none",
          stiffness: true,
          mechanicalSymptoms: false,
          weightBearingIssue: false,
          localizedBonePain: false,
          nightOrRestPain: false,
          note: "腿举后右膝轻微发紧，今天已缓解。",
          association: { kind: "date", localDate: "2026-08-03" },
        },
        planReview: "suggested",
        memoryActions: [
          {
            type: "remember",
            category: "equipment",
            content: "可以使用腿举机和史密斯机。",
          },
        ],
        evidenceReferences: [
          { localDate: "2026-08-03", category: "user_message" },
        ],
      }).planReview,
    ).toBe("suggested");
  });

  it("rejects provider identifiers, raw documents and unsafe memory categories", () => {
    expect(
      assistantTurnResponseSchema.safeParse({
        reply: "收到。",
        followUpQuestions: [],
        feedbackDraft: null,
        planReview: "not_needed",
        memoryActions: [
          { type: "remember", category: "diagnosis", content: "匿名诊断" },
        ],
        evidenceReferences: [],
        providerRecordId: "private-provider-id",
      }).success,
    ).toBe(false);
  });

  it("keeps task and provider record identifiers out of model associations", () => {
    expect(
      assistantAssociationForModel({
        kind: "activity",
        localDate: "2026-08-03",
        externalRecordId: "019c1000-0000-7000-8000-000000000299",
      }),
    ).toEqual({ kind: "activity", localDate: "2026-08-03" });
    expect(
      JSON.stringify(
        assistantAssociationForModel({
          kind: "task",
          localDate: "2026-08-03",
          taskInstanceId: "019c1000-0000-7000-8000-000000000298",
        }),
      ),
    ).not.toContain("019c1000");
  });

  it("requires explicit confirmation metadata before saving inferred feedback", () => {
    expect(
      saveAssistantFeedbackCommandSchema.safeParse({
        commandId: crypto.randomUUID(),
        turnId: crypto.randomUUID(),
        occurredAt: "2026-08-04T01:00:00.000Z",
        occurredTimeZone: "Asia/Shanghai",
        occurredUtcOffsetMinutes: 480,
        feedback: {
          localDate: "2026-08-03",
          timing: "next_day",
          leftPain: 0,
          rightPain: 2,
          swelling: "none",
          stiffness: false,
          mechanicalSymptoms: false,
          weightBearingIssue: false,
          localizedBonePain: false,
          nightOrRestPain: false,
          note: "匿名反馈",
        },
      }).success,
    ).toBe(true);
  });

  it("keeps the reviewed rehab profile structured and source text out of the model document", () => {
    const parsed = rehabProfileDocumentSchema.parse({
      schemaVersion: "1.0.0",
      goals: ["逐步恢复稳定训练"],
      background: ["膝部康复训练中"],
      clinicianGuidance: ["异常反应时停止并复评"],
      hardConstraints: ["红灯时不进阶"],
      trainingPreferences: ["优先使用可控负荷"],
    });
    expect(parsed.goals).toHaveLength(1);
    expect(parsed).not.toHaveProperty("rawNotes");
    expect(parsed).not.toHaveProperty("sourcePath");
  });
});

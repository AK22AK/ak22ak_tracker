import "server-only";

export const integrationProviderDefinitions = {
  deepseek: {
    provider: "deepseek",
    displayName: "DeepSeek",
    description: "生成受约束的训练调整建议。",
    capabilities: ["plan-advice:read"] as const,
  },
  garmin: {
    provider: "garmin",
    displayName: "Garmin",
    description: "只读同步活动时间、距离、配速和平均心率。",
    capabilities: ["activity:read"] as const,
  },
  xunji: {
    provider: "xunji",
    displayName: "训记",
    description: "只读同步力量训练动作、重量、组次与训练备注。",
    capabilities: ["training:read"] as const,
  },
} as const;

export type SupportedIntegrationProvider =
  keyof typeof integrationProviderDefinitions;

export function isSupportedIntegrationProvider(
  value: string,
): value is SupportedIntegrationProvider {
  return Object.hasOwn(integrationProviderDefinitions, value);
}

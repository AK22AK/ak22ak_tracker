export const trackerQueryKeys = {
  tracker: (trackerKey: string) => ["tracker", trackerKey] as const,
  safetyPolicy: (trackerKey: string, version: number) =>
    ["safety-policy", trackerKey, version] as const,
  today: (trackerKey: string, localDate: string) =>
    ["today", trackerKey, localDate] as const,
  day: (trackerKey: string, localDate: string) =>
    ["day", trackerKey, localDate] as const,
  calendar: (trackerKey: string, month: string) =>
    ["calendar", trackerKey, month] as const,
  trends: (trackerKey: string) => ["trends", trackerKey] as const,
  planAdvice: (trackerKey: string) =>
    ["proposals", trackerKey, "latest"] as const,
  resumptionAssessment: (trackerKey: string, assessmentId: string) =>
    ["resumption-assessment", trackerKey, assessmentId] as const,
};

export const integrationQueryKeys = {
  providerStatus: (trackerKey: string, provider: string) =>
    ["integrations", trackerKey, provider, "status"] as const,
  githubMirrorStatus: () =>
    ["integrations", "github-mirror", "status"] as const,
};

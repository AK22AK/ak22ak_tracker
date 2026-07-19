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
};

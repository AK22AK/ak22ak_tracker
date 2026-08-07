const scheduledTitlePrefix = /^第\s*\d+\s*周\s*[·•]\s*/u;

export function userFacingTaskTitle(title: string) {
  const stripped = title.replace(scheduledTitlePrefix, "").trim();
  return stripped || title;
}

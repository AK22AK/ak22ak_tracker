function normalizedGithubId(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  return value;
}

export function isAllowedGithubId(
  githubId: string | number | null | undefined,
  allowedId: string | null | undefined,
) {
  const normalizedId = normalizedGithubId(githubId);
  const normalizedAllowedId = normalizedGithubId(allowedId);
  if (!normalizedId || !normalizedAllowedId) {
    return false;
  }

  return normalizedId === normalizedAllowedId;
}

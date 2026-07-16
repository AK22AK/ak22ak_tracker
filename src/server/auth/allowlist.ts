export function isAllowedGithubLogin(
  login: string | null | undefined,
  allowedLogin: string | null | undefined,
) {
  if (!login || !allowedLogin) {
    return false;
  }

  return (
    login.toLocaleLowerCase("en-US") === allowedLogin.toLocaleLowerCase("en-US")
  );
}

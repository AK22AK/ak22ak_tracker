"use client";

import { signIn } from "next-auth/react";

export function GithubSignInButton() {
  return (
    <button
      className="sign-in-button"
      type="button"
      onClick={() => signIn("github", { callbackUrl: "/" })}
    >
      使用 GitHub 登录
    </button>
  );
}

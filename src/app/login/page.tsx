import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { GithubSignInButton } from "@/components/github-sign-in-button";
import { authOptions } from "@/server/auth/options";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getServerSession(authOptions);
  if (session) {
    redirect("/");
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <p className="eyebrow light">AK Tracker</p>
        <h1 id="login-title">私人追踪空间</h1>
        <p>仅允许预设的 GitHub 账号进入。康复计划、反馈和同步数据不会公开。</p>
        <GithubSignInButton />
      </section>
    </main>
  );
}

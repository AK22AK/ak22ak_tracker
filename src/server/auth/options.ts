import type { NextAuthOptions } from "next-auth";
import GitHubProvider, { type GithubProfile } from "next-auth/providers/github";

import { isAllowedGithubId } from "./allowlist";

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET ?? "",
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      const githubProfile = profile as GithubProfile | undefined;
      return isAllowedGithubId(
        githubProfile?.id,
        process.env.ALLOWED_GITHUB_ID,
      );
    },
    async jwt({ token, profile }) {
      const githubProfile = profile as GithubProfile | undefined;
      if (githubProfile?.id) {
        token.githubId = String(githubProfile.id);
      }
      return token;
    },
    async session({ session, token }) {
      const githubId =
        typeof token.githubId === "string" ? token.githubId : token.sub;
      if (session.user && typeof githubId === "string") {
        session.user.githubId = githubId;
      }
      return session;
    },
  },
};

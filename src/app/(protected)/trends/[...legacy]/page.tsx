import { redirect } from "next/navigation";

export default async function LegacyTrendsPage({
  params,
}: {
  params: Promise<{ legacy: string[] }>;
}) {
  const suffix = (await params).legacy.join("/");
  const knownTargets: Record<string, string> = {
    advice: "/plan/advice",
    evaluation: "/plan/evaluation",
    review: "/plan/review",
    versions: "/plan/versions",
  };
  redirect(knownTargets[suffix] ?? "/plan/review");
}

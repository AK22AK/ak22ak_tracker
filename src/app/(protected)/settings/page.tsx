import { IntegrationCard } from "@/components/integration-card";
import { integrationStatusSchema } from "@/domain/integrations";
import { getIntegrationStatus } from "@/server/integrations/credentials/repository";
import { integrationProviderDefinitions } from "@/server/integrations/providers";
import { LocalDataCard } from "@/components/local-data-card";
import { GitHubMirrorCard } from "@/components/github-mirror-card";
import { getGitHubMirrorStatus } from "@/server/mirror/runtime";

const trackerKey = "knee-rehab";
export default async function SettingsPage() {
  const [status, mirrorStatus] = await Promise.all([
    getIntegrationStatus(trackerKey, "xunji").then((value) =>
      integrationStatusSchema.parse(value),
    ),
    getGitHubMirrorStatus(),
  ]);
  const definition = integrationProviderDefinitions.xunji;

  return (
    <main className="app-shell page-frame" aria-label="设置页面">
      <header className="topbar">
        <div>
          <p className="eyebrow">AK Tracker</p>
          <h1>设置</h1>
        </div>
      </header>
      <IntegrationCard
        trackerKey={trackerKey}
        definition={definition}
        initialStatus={status}
      />
      <GitHubMirrorCard initialStatus={mirrorStatus} />
      <LocalDataCard />
    </main>
  );
}

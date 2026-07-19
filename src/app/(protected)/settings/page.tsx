import { IntegrationCard } from "@/components/integration-card";
import { integrationStatusSchema } from "@/domain/integrations";
import { getIntegrationStatus } from "@/server/integrations/credentials/repository";
import { integrationProviderDefinitions } from "@/server/integrations/providers";

const trackerKey = "knee-rehab";
const planningTimeZone = "Asia/Shanghai";

export default async function SettingsPage() {
  const status = integrationStatusSchema.parse(
    await getIntegrationStatus(trackerKey, "xunji"),
  );
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
        planningTimeZone={planningTimeZone}
        definition={definition}
        initialStatus={status}
      />
    </main>
  );
}

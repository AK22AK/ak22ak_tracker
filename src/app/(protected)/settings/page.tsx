import { SettingsClient } from "@/components/settings-client";

export default function SettingsPage() {
  return (
    <div className="root-tab-route-content" data-root-tab-content="settings">
      <SettingsClient />
    </div>
  );
}

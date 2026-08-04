import { Suspense } from "react";

import { RehabAssistantClient } from "@/components/rehab-assistant-client";

export default function PlanConversationPage() {
  return (
    <main className="app-shell page-frame assistant-conversation-page">
      <Suspense fallback={<p role="status">正在打开康复助手…</p>}>
        <RehabAssistantClient />
      </Suspense>
    </main>
  );
}

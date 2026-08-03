import { TodayClient } from "@/components/today-client";

export default function Home() {
  return (
    <div className="root-tab-route-content" data-root-tab-content="today">
      <TodayClient />
    </div>
  );
}

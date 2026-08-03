import { createXunjiRecoveryCronHandler } from "@/server/integrations/xunji/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export const GET = createXunjiRecoveryCronHandler();

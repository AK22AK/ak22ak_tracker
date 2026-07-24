import { createGarminRecoveryCronHandler } from "@/server/integrations/garmin/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export const GET = createGarminRecoveryCronHandler();

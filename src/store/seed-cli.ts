import { resolve } from "node:path";

import { createFixedClock } from "../lib/clock";
import { FileLeadRepository } from "./fileLeadStore";
import { DEMO_NOW_ISO, resetDemoData, seedDemoData } from "./seed";

async function main(): Promise<void> {
  const reset = process.argv.includes("--reset");
  const filePath = resolve(process.env["HAIKA_STORE_PATH"] ?? "data/demo-store.json");
  const clock = createFixedClock(process.env["HAIKA_NOW"] ?? DEMO_NOW_ISO);
  const repository = new FileLeadRepository({ filePath });

  const state = reset
    ? await resetDemoData(repository, { clock })
    : await seedDemoData(repository, { clock });

  console.log(
    `${reset ? "Reset" : "Seeded"} ${state.leads.length} leads, ${state.tasks.length} tasks, ${state.outboxMessages.length} outbox messages, ${state.activityLog.length} activity entries.`,
  );
  console.log(`Store: ${filePath}`);
  console.log(`Demo now: ${clock.now().toISOString()}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

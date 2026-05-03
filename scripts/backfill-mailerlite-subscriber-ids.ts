// One-off backfill: pull subscriber IDs from MailerLite into our users table.
// Run with: npx tsx scripts/backfill-mailerlite-subscriber-ids.ts
//
// Loads .env.local via @next/env (the same loader Next.js uses), then calls
// the production code path. Future syncs maintain IDs automatically — this
// script just catches up the existing 2,070 subscribers.

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { pullSubscriberIdsFromMailerLite } = await import(
    "../lib/mailerlite/sync"
  );
  const result = await pullSubscriberIdsFromMailerLite();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

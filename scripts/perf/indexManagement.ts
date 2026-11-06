/**
 * Index ajoutés par la migration `20251106140100_add_load_test_indexes` — utilisés pour mesurer avant/après.
 */

export const PERF_INDEX_NAMES = [
  "EmailCampaignContact_campaignId_idx",
  "EmailCampaignContact_contactId_idx",
  "PapSession_contactId_startedAt_idx",
  "FormInbound_status_createdAt_idx",
  "Contact_status_city_updatedAt_idx",
  "Contact_search_trgm_idx",
] as const;

export async function dropPerfIndexes(client: {
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
}): Promise<void> {
  for (const name of PERF_INDEX_NAMES) {
    await client.$executeRawUnsafe(`DROP INDEX IF EXISTS "${name}";`);
  }
}

export async function createPerfIndexes(client: {
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
}): Promise<void> {
  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "EmailCampaignContact_campaignId_idx"
    ON "EmailCampaignContact"("campaignId");
  `);
  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "EmailCampaignContact_contactId_idx"
    ON "EmailCampaignContact"("contactId");
  `);
  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PapSession_contactId_startedAt_idx"
    ON "PapSession"("contactId", "startedAt");
  `);
  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "FormInbound_status_createdAt_idx"
    ON "FormInbound"("status", "createdAt" DESC);
  `);
  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Contact_status_city_updatedAt_idx"
    ON "Contact"("status", "city", "updatedAt" DESC);
  `);
  await client.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Contact_search_trgm_idx" ON "Contact" USING gin (
      (lower("firstName" || ' ' || "lastName" || ' ' || "email")) gin_trgm_ops
    );
  `);
}

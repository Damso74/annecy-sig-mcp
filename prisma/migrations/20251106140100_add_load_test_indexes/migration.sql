-- Index pour requêtes type listes filtrées, jointures campagne↔contact, sessions PAP par contact, file d'entrée triée.

CREATE INDEX "EmailCampaignContact_campaignId_idx" ON "EmailCampaignContact"("campaignId");
CREATE INDEX "EmailCampaignContact_contactId_idx" ON "EmailCampaignContact"("contactId");

CREATE INDEX "PapSession_contactId_startedAt_idx" ON "PapSession"("contactId", "startedAt");

CREATE INDEX "FormInbound_status_createdAt_idx" ON "FormInbound"("status", "createdAt" DESC);

-- Liste contacts filtrée (statut + ville + tri récent).
CREATE INDEX "Contact_status_city_updatedAt_idx" ON "Contact"("status", "city", "updatedAt" DESC);

-- Recherche type tableau (trigram) — extension pg_trgm créée par scripts/perf/init-pg.sql au bootstrap Docker.
CREATE INDEX "Contact_search_trgm_idx" ON "Contact" USING gin (
  (lower("firstName" || ' ' || "lastName" || ' ' || "email")) gin_trgm_ops
);

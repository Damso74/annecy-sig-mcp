/**
 * Seed factice multi-échelle : x1, x10, x100 (facteur sur le volume de base).
 * Usage : PERF_SCALE=10 npm run perf:seed
 */

import { createPerfPrisma } from "./createPerfPrisma.js";
import {
  CampaignStatus,
  ContactStatus,
  InboundStatus,
  PapSessionOutcome,
} from "@prisma/client";

const BASE_CONTACTS = 500;
const BASE_CAMPAIGNS = 12;
/** Limite le nombre de lignes de jointure campagne↔contact. */
const BASE_SENDS_PER_CAMPAIGN = 100;
const BASE_PAP_PER_CONTACT = 2;
const BASE_INBOUND = 800;

export function envScale(): number {
  const raw = process.env.PERF_SCALE ?? "1";
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`PERF_SCALE invalide : ${raw}`);
  }
  return n;
}

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]!;
}

export async function seedLoadTest(scale: number): Promise<void> {
  if (process.env.PERF_SKIP_SEED === "1") {
    console.log("PERF_SKIP_SEED=1 — seed ignoré.");
    return;
  }

  const nContacts = BASE_CONTACTS * scale;
  const nCampaigns = Math.min(BASE_CAMPAIGNS * scale, 360);
  /** Plafond pour garder des runs x100 réalisables (sinon millions de lignes de jointure). */
  const sendsPerCampaign = Math.min(
    500,
    BASE_SENDS_PER_CAMPAIGN * scale,
    Math.max(50, Math.floor(nContacts * 0.25))
  );
  const papPerContact = Math.min(12, BASE_PAP_PER_CONTACT * scale);
  const nInbound = BASE_INBOUND * scale;

  const prisma = createPerfPrisma();

  const cities = ["Annecy", "Cran-Gevrier", "Seynod", "Pringy", "Meythet"];
  const segments = ["citoyen", "pro", "associatif", "presse"];
  const channels = ["tel", "visio", "terrain"];
  const inboundSubjects = ["Question voirie", "Urbanisme", "Eau", "Déchets", "Éclairage"];

  console.log(
    JSON.stringify(
      {
        scale,
        nContacts,
        nCampaigns,
        sendsPerCampaign,
        papPerContact,
        nInbound,
      },
      null,
      2
    )
  );

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `TRUNCATE TABLE "FormInbound", "PapSession", "EmailCampaignContact", "EmailCampaign", "Contact" RESTART IDENTITY CASCADE;`
      );

      const contacts = Array.from({ length: nContacts }, (_, i) => ({
        id: `c_${i}`,
        email: `contact${i}@loadtest.local`,
        firstName: `Prénom${i % 200}`,
        lastName: `Nom${Math.floor(i / 200)}`,
        status: pick(
          [ContactStatus.ACTIVE, ContactStatus.ACTIVE, ContactStatus.UNSUBSCRIBED, ContactStatus.BOUNCED],
          i
        ),
        city: pick(cities, i),
        segment: pick(segments, i),
      }));

      const campaigns = Array.from({ length: nCampaigns }, (_, i) => ({
        id: `camp_${i}`,
        name: `Campagne perf ${i}`,
        status: pick(
          [CampaignStatus.COMPLETED, CampaignStatus.SCHEDULED, CampaignStatus.DRAFT],
          i
        ),
        scheduledAt: new Date(Date.now() - (i % 90) * 86400000),
      }));

      // Chunk pour limiter la mémoire côté driver
      const chunk = 2000;
      for (let o = 0; o < contacts.length; o += chunk) {
        await tx.contact.createMany({ data: contacts.slice(o, o + chunk) });
      }
      for (let o = 0; o < campaigns.length; o += chunk) {
        await tx.emailCampaign.createMany({ data: campaigns.slice(o, o + chunk) });
      }

      const sends: {
        id: string;
        campaignId: string;
        contactId: string;
        sentAt: Date | null;
        openedAt: Date | null;
      }[] = [];
      let sendIdx = 0;
      for (let c = 0; c < nCampaigns; c++) {
        const campaignId = `camp_${c}`;
        for (let s = 0; s < sendsPerCampaign; s++) {
          const contactId = `c_${(c * sendsPerCampaign + s) % nContacts}`;
          sends.push({
            id: `ecc_${sendIdx++}`,
            campaignId,
            contactId,
            sentAt: new Date(Date.now() - (sendIdx % 5000) * 60000),
            openedAt: sendIdx % 3 === 0 ? new Date() : null,
          });
        }
      }
      for (let o = 0; o < sends.length; o += chunk) {
        await tx.emailCampaignContact.createMany({ data: sends.slice(o, o + chunk) });
      }

      const paps: {
        id: string;
        contactId: string;
        channel: string;
        outcome: PapSessionOutcome;
        startedAt: Date;
        endedAt: Date | null;
      }[] = [];
      let papIdx = 0;
      for (let ci = 0; ci < nContacts; ci++) {
        for (let p = 0; p < papPerContact; p++) {
          paps.push({
            id: `pap_${papIdx++}`,
            contactId: `c_${ci}`,
            channel: pick(channels, ci + p),
            outcome: pick(
              [PapSessionOutcome.RESOLVED, PapSessionOutcome.PENDING, PapSessionOutcome.ESCALATED],
              ci + p
            ),
            startedAt: new Date(Date.now() - (papIdx % 10000) * 3600000),
            endedAt: papIdx % 4 === 0 ? new Date() : null,
          });
        }
      }
      for (let o = 0; o < paps.length; o += chunk) {
        await tx.papSession.createMany({ data: paps.slice(o, o + chunk) });
      }

      const inbounds = Array.from({ length: nInbound }, (_, i) => ({
        id: `inb_${i}`,
        contactId: i % 5 === 0 ? `c_${i % nContacts}` : null,
        email: `inbound${i}@example.org`,
        subject: `${pick(inboundSubjects, i)} #${i}`,
        body: `Message de test ${i} `.repeat(5),
        status: pick([InboundStatus.NEW, InboundStatus.TRIAGED, InboundStatus.CLOSED], i),
        createdAt: new Date(Date.now() - (i % 120) * 3600000),
      }));
      for (let o = 0; o < inbounds.length; o += chunk) {
        await tx.formInbound.createMany({ data: inbounds.slice(o, o + chunk) });
      }
    },
    { timeout: 600_000 }
  );

  await prisma.$disconnect();
  console.log("Seed terminé.");
}

async function main(): Promise<void> {
  await seedLoadTest(envScale());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

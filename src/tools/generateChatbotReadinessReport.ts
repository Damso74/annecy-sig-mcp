import type { AppConfig } from "../config.js";
import type { VisibilityMode } from "../registry.js";
import {
  CHATBOT_CITIZEN_LAYERS,
  chatbotReportFamily,
  getChatbotProfile,
  getLayerEntry,
  type ChatbotReportFamily,
} from "../registry.js";
import { runInventoryAllLayers, type InventoryLayerRow } from "./inventoryAllLayers.js";
import type { InventoryTarget } from "../inventory/types.js";
import { clampSampleLimit } from "../utils/validation.js";
import {
  executiveSummaryHeading,
  mdBullet,
  mdH1,
  mdH2,
  mdH3,
  mdParagraph,
} from "../utils/reportMarkdown.js";
import type { ReportFormat } from "./generateInventoryReport.js";
import { writeReportOutput, type ReportOutput, type ReportExportMeta } from "../utils/reportOutput.js";
import { CHATBOT_SCHEMA_VERSION, SERVER_VERSION } from "../runtime/version.js";
import { ChatbotReadinessReportSchema, validateContract } from "../contracts/index.js";

/** @deprecated préférer `CHATBOT_CITIZEN_LAYERS` depuis `registry` — alias pour compatibilité. */
export const CHATBOT_LAYER_KEYS = CHATBOT_CITIZEN_LAYERS;

function layerKey(sk: string, id: number): string {
  return `${sk}:${id}`;
}

function nullRate(row: InventoryLayerRow, field: string): number {
  return row.nullRateSummary[field.toLowerCase()] ?? 0;
}

function coverage(row: InventoryLayerRow, mappingKey: string): number | null {
  return row.semanticCoverage.coverageByMapping[mappingKey]?.coverageRatio ?? null;
}

export type ChatbotCitizenTier =
  | "ready"
  | "usable_now"
  | "usable_with_caution"
  | "not_ready"
  | "unknown_requires_check";

export type ChatbotAssessment = {
  tier: ChatbotCitizenTier;
  checklist: {
    readableName: boolean;
    addressPresent: boolean;
    geometryPresent: boolean;
    categoryPresent: boolean;
    lowRisk: boolean;
    publicData: boolean;
  };
  reasons: string[];
};

export type ChatbotLayerDetail = {
  serviceKey: string;
  layerId: number;
  layerName: string;
  label: string;
  tier: ChatbotCitizenTier;
  missingForGoodCitizenAnswer: string[];
  safeAnswerRules: string[];
  mustQualifyAnswer: boolean;
  hallucinationRisks: string[];
  reasons: string[];
};

type Family = ChatbotReportFamily;

function familyFor(row: InventoryLayerRow): Family {
  return chatbotReportFamily(row.serviceKey, row.layerId);
}

function labelPresent(row: InventoryLayerRow): boolean {
  const covLabel = coverage(row, "labelField");
  const covId = coverage(row, "identifierField");
  if (covLabel !== null) return covLabel < 0.4 ? false : true;
  if (covId !== null) return covId < 0.4 ? false : true;
  return nullRate(row, "denomination") < 0.35 || nullRate(row, "nom") < 0.35;
}

function buildChatbotLayerDetail(row: InventoryLayerRow, label: string): ChatbotLayerDetail {
  const a = assessChatbotReadiness(row);
  const fam = familyFor(row);
  const missingForGoodCitizenAnswer: string[] = [];
  const entry = getLayerEntry(row.serviceKey, row.layerId);
  const profile = entry ? getChatbotProfile(entry) : undefined;
  const safeAnswerRules: string[] = [
    "Ne répondre qu’à partir des champs effectivement renseignés sur l’entité retournée.",
    "Si une information manque, répondre explicitement « donnée non renseignée dans l’open data ».",
    "Ne jamais inférer horaires, accessibilité PMR ou places disponibles sans champ fiable.",
    "Pour toute donnée à impact (santé, sécurité, accessibilité), recommander une vérification sur le site officiel de la Ville.",
    ...(profile?.safeAnswerRules ?? []),
  ];
  const hallucinationRisks: string[] = [
    "Confondre un libellé générique avec un service encore ouvert.",
    "Interpoleter géographiquement si la géométrie est absente ou imprécise.",
  ];

  const geomOk = row.geometryStatus === "present";
  if (!geomOk) missingForGoodCitizenAnswer.push("Géométrie fiable pour le « près de moi ».");
  if (!labelPresent(row)) missingForGoodCitizenAnswer.push("Libellé ou identifiant lisible pour l’usager.");

  if (fam === "wc") {
    const o = coverage(row, "openingField");
    const p = coverage(row, "pmrField");
    if (o !== null && o < 0.3) missingForGoodCitizenAnswer.push("Indication claire d’ouverture / fermeture.");
    if (p !== null && p < 0.3) missingForGoodCitizenAnswer.push("Information PMR / accessibilité.");
    const sched = coverage(row, "scheduleField");
    if (sched !== null && sched < 0.25) {
      hallucinationRisks.push("Horaires souvent absents : ne pas inventer d’horaires d’ouverture.");
      safeAnswerRules.push("Si l’horaire n’est pas dans les données, préciser que les horaires ne sont pas garantis par le chatbot.");
    }
  }

  if (fam === "school" || fam === "petite") {
    const addr = coverage(row, "addressField");
    const com = coverage(row, "communeField");
    if (addr !== null && addr < 0.35) missingForGoodCitizenAnswer.push("Adresse utile pour orienter les familles.");
    if (com !== null && com < 0.35) missingForGoodCitizenAnswer.push("Commune pour lever l’ambiguïté toponymique.");
  }

  if (fam === "culture_sport") {
    const cat = coverage(row, "categoryField");
    if (cat !== null && cat < 0.35) missingForGoodCitizenAnswer.push("Catégorie d’équipement pour contextualiser la réponse.");
  }

  if (fam === "mobil_geo") {
    if (!geomOk) missingForGoodCitizenAnswer.push("Géométrie obligatoire pour stationnement / mobilité.");
    if (!labelPresent(row)) missingForGoodCitizenAnswer.push("Libellé ou identifiant de site (nom de parking, borne, etc.).");
  }

  const mustQualifyAnswer =
    a.tier === "usable_with_caution" ||
    a.tier === "usable_now" ||
    (coverage(row, "scheduleField") !== null && (coverage(row, "scheduleField") ?? 1) < 0.35);

  return {
    serviceKey: row.serviceKey,
    layerId: row.layerId,
    layerName: row.layerName,
    label,
    tier: a.tier,
    missingForGoodCitizenAnswer,
    safeAnswerRules,
    mustQualifyAnswer,
    hallucinationRisks,
    reasons: a.reasons,
  };
}

/** Heuristique de maturité chatbot (V0.5 — sémantique + inventaire). */
export function assessChatbotReadiness(row: InventoryLayerRow): ChatbotAssessment {
  if (row.sampleStatus !== "ok") {
    const msg =
      row.sampleStatus === "failed"
        ? `Échantillon non récupéré : ${row.sampleError ?? "erreur ArcGIS ou requête refusée"}.`
        : "Échantillon vide : impossible d’évaluer la maturité chatbot sur données réelles.";
    return {
      tier: "unknown_requires_check",
      checklist: {
        readableName: false,
        addressPresent: false,
        geometryPresent: false,
        categoryPresent: false,
        lowRisk: row.riskLevel === "green",
        publicData: row.visibility === "public",
      },
      reasons: [msg, "Ne pas conclure « prêt / non prêt » sans nouvelle passe d’inventaire ou correction `outFields` / registre."],
    };
  }

  if (row.visibility !== "public") {
    return {
      tier: "not_ready",
      checklist: {
        readableName: labelPresent(row),
        addressPresent: false,
        geometryPresent: row.geometryStatus === "present",
        categoryPresent: false,
        lowRisk: row.riskLevel === "green",
        publicData: false,
      },
      reasons: ["Couche non publique (internal) : ne pas exposer sur chatbot citoyen sans périmètre dédié."],
    };
  }

  const fam = familyFor(row);

  const nameOk = labelPresent(row);
  const addrOk =
    coverage(row, "addressField") !== null
      ? (coverage(row, "addressField") ?? 0) >= 0.35
      : nullRate(row, "adresse") < 0.4;
  const geomOk = row.geometryStatus === "present";
  const catOk =
    coverage(row, "categoryField") !== null
      ? (coverage(row, "categoryField") ?? 0) >= 0.35
      : fam === "mobil_geo" || fam === "culture_sport"
        ? nullRate(row, "categorie") < 0.45
        : true;
  const lowRisk = row.riskLevel === "green";
  const publicData = row.visibility === "public";

  const reasons: string[] = [];
  if (!geomOk) reasons.push("Géométrie absente sur l’échantillon récupéré.");
  if (!nameOk) reasons.push("Libellé ou identifiant souvent absent (champs sémantiques).");
  if (!addrOk && (fam === "school" || fam === "petite" || fam === "wc")) reasons.push("Adresse souvent absente.");
  if (!catOk && (fam === "culture_sport" || fam === "mobil_geo")) reasons.push("Catégorie souvent absente.");
  if (!lowRisk) reasons.push("Risque orange ou supérieur.");

  let tier: ChatbotCitizenTier;
  if (!publicData || row.riskLevel === "red") tier = "not_ready";
  else if (row.usageStatus === "ready" && nameOk && geomOk && lowRisk && (fam === "mobil_geo" ? true : addrOk || fam === "culture_sport")) {
    tier = catOk || fam === "wc" ? "ready" : "usable_with_caution";
  } else if (row.usageStatus === "usable_now" && geomOk && nameOk) {
    tier = "usable_now";
  } else if (publicData && geomOk && (nameOk || addrOk)) tier = "usable_with_caution";
  else tier = "not_ready";

  if (fam === "wc" && tier === "ready") {
    const sched = coverage(row, "scheduleField");
    if (sched !== null && sched < 0.35) tier = "usable_now";
  }

  return {
    tier,
    checklist: {
      readableName: nameOk,
      addressPresent: addrOk,
      geometryPresent: geomOk,
      categoryPresent: catOk,
      lowRisk,
      publicData,
    },
    reasons,
  };
}

export type ChatbotReadinessStructured = {
  executiveSummary: string;
  ready: { serviceKey: string; layerId: number; layerName: string; label: string }[];
  usableNow: { serviceKey: string; layerId: number; layerName: string; label: string; reasons: string[] }[];
  usableWithCaution: { serviceKey: string; layerId: number; layerName: string; label: string; reasons: string[] }[];
  notReady: { serviceKey: string; layerId: number; layerName: string; label: string; reasons: string[] }[];
  unknownRequiresCheck: { serviceKey: string; layerId: number; layerName: string; label: string; reasons: string[] }[];
  perLayer: ChatbotLayerDetail[];
  typicalQuestions: string[];
  hallucinationRisks: string[];
  source: {
    type: "annecy_sig_mcp_chatbot_readiness";
    schemaVersion: typeof CHATBOT_SCHEMA_VERSION;
    serverVersion: string;
    inventory: Awaited<ReturnType<typeof runInventoryAllLayers>>["source"];
    runtimeMs?: number;
  };
};

export async function runGenerateChatbotReadinessReport(
  cfg: AppConfig,
  input: {
    mode: VisibilityMode;
    sampleLimit?: number;
    concurrency?: number;
    targets?: InventoryTarget[];
    fast?: boolean;
    format: ReportFormat;
    writeOutput?: boolean;
  },
): Promise<{ format: ReportFormat; structured: ChatbotReadinessStructured; body: string; output?: ReportOutput }> {
  const startedAt = Date.now();
  const sampleLimit = clampSampleLimit(input.sampleLimit ?? 20, 20, cfg.maxResultLimit);
  const inv = await runInventoryAllLayers(cfg, {
    mode: input.mode,
    sampleLimit,
    concurrency: input.concurrency,
    targets: input.targets,
    fast: input.fast,
  });

  const labelByKey = new Map<string, string>();
  let scoped: InventoryLayerRow[];

  if (input.targets?.length) {
    scoped = inv.layers;
    for (const l of scoped) {
      labelByKey.set(layerKey(l.serviceKey, l.layerId), l.layerName);
    }
  } else {
    const keySet = new Set(CHATBOT_LAYER_KEYS.map(k => layerKey(k.serviceKey, k.layerId)));
    scoped = inv.layers.filter(l => keySet.has(layerKey(l.serviceKey, l.layerId)));
    for (const k of CHATBOT_LAYER_KEYS) {
      labelByKey.set(layerKey(k.serviceKey, k.layerId), k.label);
    }
  }

  const ready: ChatbotReadinessStructured["ready"] = [];
  const usableNow: ChatbotReadinessStructured["usableNow"] = [];
  const usableWithCaution: ChatbotReadinessStructured["usableWithCaution"] = [];
  const notReady: ChatbotReadinessStructured["notReady"] = [];
  const unknownRequiresCheck: ChatbotReadinessStructured["unknownRequiresCheck"] = [];
  const perLayer: ChatbotLayerDetail[] = [];

  for (const row of scoped) {
    const k = layerKey(row.serviceKey, row.layerId);
    const label = labelByKey.get(k) ?? row.layerName;
    perLayer.push(buildChatbotLayerDetail(row, label));
    const a = assessChatbotReadiness(row);
    if (a.tier === "unknown_requires_check") {
      unknownRequiresCheck.push({
        serviceKey: row.serviceKey,
        layerId: row.layerId,
        layerName: row.layerName,
        label,
        reasons: a.reasons,
      });
    } else if (a.tier === "ready") {
      ready.push({ serviceKey: row.serviceKey, layerId: row.layerId, layerName: row.layerName, label });
    } else if (a.tier === "usable_now") {
      usableNow.push({
        serviceKey: row.serviceKey,
        layerId: row.layerId,
        layerName: row.layerName,
        label,
        reasons: a.reasons,
      });
    } else if (a.tier === "usable_with_caution") {
      usableWithCaution.push({
        serviceKey: row.serviceKey,
        layerId: row.layerId,
        layerName: row.layerName,
        label,
        reasons: a.reasons,
      });
    } else {
      notReady.push({ serviceKey: row.serviceKey, layerId: row.layerId, layerName: row.layerName, label, reasons: a.reasons });
    }
  }

  const executiveSummary = [
    `Évaluation chatbot citoyen (${inv.mode}), ${scoped.length} couche(s) ciblées, échantillon demandé ${inv.requestedSampleLimit} / effectif ${inv.effectiveSampleLimit}.`,
    `Prêtes : ${ready.length}, utilisables maintenant : ${usableNow.length}, avec prudence : ${usableWithCaution.length}, non prêtes : ${notReady.length}, à clarifier (échantillon) : ${unknownRequiresCheck.length}.`,
  ].join(" ");

  const baseTypicalQuestions = [
    "Où sont les toilettes PMR près de moi ?",
    "Où puis-je garer mon vélo près de la gare ?",
    "Quelles écoles publiques sont cartographiées sur Annecy ?",
    "Où sont les bornes de recharge pour véhicule électrique ?",
    "Quels parkings relais existent autour du lac ?",
  ];
  // V0.8 — fusionne les typicalQuestions exposées par le profil chatbot du registre.
  const profileTypical = scoped.flatMap(row => {
    const e = getLayerEntry(row.serviceKey, row.layerId);
    return e ? (getChatbotProfile(e)?.typicalQuestions ?? []) : [];
  });
  const typicalQuestions = Array.from(new Set([...baseTypicalQuestions, ...profileTypical]));

  const hallucinationRisks = [
    "Confusion entre horaires d’ouverture réels et champ « horaire » incomplet.",
    "Interprétation des statuts ou catégories métier sans glossaire officiel.",
    "Géométrie manquante sur un échantillon **réussi** : le modèle peut extrapoler une localisation fausse.",
    "Données non mises à jour : toujours indiquer la date de fraîcheur si disponible.",
  ];

  const structured: ChatbotReadinessStructured = validateContract(
    ChatbotReadinessReportSchema,
    {
      executiveSummary,
      ready,
      usableNow,
      usableWithCaution,
      notReady,
      unknownRequiresCheck,
      perLayer,
      typicalQuestions,
      hallucinationRisks,
      source: {
        type: "annecy_sig_mcp_chatbot_readiness" as const,
        schemaVersion: CHATBOT_SCHEMA_VERSION,
        serverVersion: SERVER_VERSION,
        inventory: inv.source,
        runtimeMs: Date.now() - startedAt,
      },
    } satisfies ChatbotReadinessStructured,
    "ChatbotReadinessReport",
  );

  const md = () => {
    let s = mdH1("Rapport de maturité — chatbot citoyen");
    s += executiveSummaryHeading();
    s += mdParagraph(structured.executiveSummary);
    s += mdH2("Prêtes (ready) — échantillon OK uniquement");
    s +=
      ready.length === 0
        ? mdParagraph("_Aucune couche ne cumule tous les critères sur cet échantillon._")
        : mdBullet(ready.map(x => `**${x.serviceKey}** / ${x.layerId} — ${x.label}`));
    s += mdH2("Utilisables maintenant (usable_now)");
    s +=
      usableNow.length === 0
        ? mdParagraph("_Aucune._")
        : mdBullet(usableNow.map(x => `**${x.serviceKey}** / ${x.layerId} — ${x.label} : ${x.reasons.join(" ; ")}`));
    s += mdH2("Utilisables avec prudence");
    s +=
      usableWithCaution.length === 0
        ? mdParagraph("_Aucune._")
        : mdBullet(
            usableWithCaution.map(
              x => `**${x.serviceKey}** / ${x.layerId} — ${x.label} : ${x.reasons.join(" ; ")}`,
            ),
          );
    s += mdH2("Non prêtes");
    s += mdBullet(
      notReady.map(x => `**${x.serviceKey}** / ${x.layerId} — ${x.label} : ${x.reasons.join(" ; ")}`),
    );
    s += mdH2("À clarifier (échantillon non exploitable)");
    s +=
      unknownRequiresCheck.length === 0
        ? mdParagraph("_Aucune._")
        : mdBullet(
            unknownRequiresCheck.map(
              x => `**${x.serviceKey}** / ${x.layerId} — ${x.label} : ${x.reasons.join(" ; ")}`,
            ),
          );
    s += mdH2("Détail par couche (règles prudentes)");
    for (const p of perLayer) {
      s += mdH3(`${p.label} (${p.serviceKey}/${p.layerId})`);
      s += mdParagraph(`_Statut : **${p.tier}** ; qualifier la réponse : ${p.mustQualifyAnswer ? "oui" : "non"}._`);
      s += mdBullet([
        `Manques pour une bonne réponse citoyenne : ${p.missingForGoodCitizenAnswer.length ? p.missingForGoodCitizenAnswer.join(" ; ") : "—"}`,
        ...p.safeAnswerRules.map(r => `Règle : ${r}`),
        ...p.hallucinationRisks.map(r => `Risque : ${r}`),
      ]);
    }
    s += mdH2("Questions types");
    s += mdBullet(typicalQuestions);
    s += mdH2("Limites / risques d’hallucination");
    s += mdBullet(hallucinationRisks);
    return s.trim();
  };

  const body = input.format === "markdown" ? md() : JSON.stringify(structured, null, 2);
  const output = input.writeOutput
    ? await writeReportOutput(cfg, `chatbot-readiness-${input.mode}`, input.format, body, {
        generatedAt: new Date().toISOString(),
        mode: input.mode,
        sampleLimit,
        concurrency: inv.source.execution.concurrency,
        fast: inv.source.execution.fast,
        sourceVersion: SERVER_VERSION,
        runtimeMs: Date.now() - startedAt,
        filters: {
          chatbotScope: input.targets?.length ? "targets" : "CHATBOT_LAYER_KEYS",
          targets: input.targets ?? null,
        },
      } satisfies ReportExportMeta)
    : undefined;
  return { format: input.format, structured, body, output };
}

import type { AppConfig } from "../config.js";
import type { LayerRegistryEntry, VisibilityMode } from "../registry.js";
import { getLayerEntry, getOpenDataProfile, getSemanticEssentialKeys } from "../registry.js";
import { runInventoryAllLayers, type InventoryLayerRow, type InventoryRunResult } from "./inventoryAllLayers.js";
import type { InventoryTarget } from "../inventory/types.js";
import { OPEN_DATA_SCHEMA_VERSION, SERVER_VERSION } from "../runtime/version.js";
import type { UsageStatus } from "../utils/inventoryUsage.js";
import type { SemanticMappingKey } from "../utils/semanticMappings.js";
import { OpenDataBriefSchema, validateContract } from "../contracts/index.js";

export function getTravauxOpenDataTier(): "orange" | "red" {
  const v = (process.env.OPEN_DATA_TRAVAUX_TIER ?? "orange").toLowerCase().trim();
  return v === "red" ? "red" : "orange";
}

function hasAttachmentFieldInRegistry(row: Pick<InventoryLayerRow, "fields">): boolean {
  const internal = row.fields.internalFields ?? [];
  return internal.some(f => /url_pj|piece_jointe|attachement|attachment/i.test(f));
}

export type PublicationReadiness =
  | "publishable_now"
  | "publishable_after_light_cleanup"
  | "requires_business_validation"
  | "requires_legal_review"
  | "do_not_publish";

export type OpenDataLayerAssessment = {
  serviceKey: string;
  layerId: number;
  layerName: string;
  tier: "green" | "orange" | "red";
  tierReason: string;
  blockingIssues: string[];
  recommendedFixes: string[];
  publicationReadiness: PublicationReadiness;
  usageStatus: UsageStatus;
};

function geometryRequired(row: InventoryLayerRow): boolean {
  return row.semanticMappings?.geometryRequired === true;
}

function labelOrIdOk(row: InventoryLayerRow): boolean {
  const lc = row.semanticCoverage.coverageByMapping.labelField?.coverageRatio;
  const ic = row.semanticCoverage.coverageByMapping.identifierField?.coverageRatio;
  if (lc !== undefined && lc >= 0.55) return true;
  if (ic !== undefined && ic >= 0.55) return true;
  if (!row.semanticMappings) {
    const keys = Object.keys(row.nullRateSummary);
    const avgNull =
      keys.length > 0 ? keys.reduce((s, k) => s + (row.nullRateSummary[k] ?? 0), 0) / keys.length : 0;
    return row.preliminaryQualityScore >= 60 && avgNull < 0.5;
  }
  return false;
}

function registryEntryForRow(row: InventoryLayerRow): LayerRegistryEntry | undefined {
  return getLayerEntry(row.serviceKey, row.layerId);
}

/**
 * Évaluation open data (V0.5 / V0.8) à partir d’une ligne d’inventaire.
 *
 * V0.8 — lit en priorité `entry.usageProfiles.openData` :
 * - `requiresLegalReview` → jamais VERT, classement ORANGE/ROUGE selon contexte ;
 * - `blockingReasons` → ajoutés aux `blockingIssues` ;
 * - `publicationReadinessHint` → utilisé comme borne supérieure quand le score serait sinon « publishable_now ».
 */
export function assessOpenDataCandidate(row: InventoryLayerRow): OpenDataLayerAssessment {
  const blockingIssues: string[] = [];
  const recommendedFixes: string[] = [];
  const entry = registryEntryForRow(row);
  const odProfile = entry ? getOpenDataProfile(entry) : undefined;

  if (odProfile?.blockingReasons?.length) {
    blockingIssues.push(...odProfile.blockingReasons);
  }

  const base = {
    serviceKey: row.serviceKey,
    layerId: row.layerId,
    layerName: row.layerName,
    usageStatus: row.usageStatus,
  };

  // V0.8 — un profil explicitement "requires_legal_review" ne peut jamais devenir VERT,
  // même si toutes les heuristiques sont au vert. Ce verrou est appliqué juste avant
  // la branche "canGreen" plus bas.
  const profileForcesNonGreen =
    odProfile?.requiresLegalReview === true ||
    odProfile?.publicationReadinessHint === "requires_legal_review" ||
    odProfile?.publicationReadinessHint === "do_not_publish" ||
    (odProfile?.blockingReasons?.length ?? 0) > 0;

  if (row.visibility === "internal") {
    if (row.serviceKey === "travaux") {
      const tr = getTravauxOpenDataTier();
      blockingIssues.push("Données travaux / champs étendus : diffusion grand public à risque.");
      recommendedFixes.push("Filtrage métier, exclusion des pièces jointes, validation juridique.");
      if (tr === "red") {
        return {
          ...base,
          tier: "red",
          tierReason: "Travaux classés ROUGE (OPEN_DATA_TRAVAUX_TIER=red) : cadre juridique renforcé requis.",
          blockingIssues,
          recommendedFixes,
          publicationReadiness: "do_not_publish",
        };
      }
      return {
        ...base,
        tier: "orange",
        tierReason: "Travaux en périmètre internal : jamais VERT open data brut ; validation juridique requise.",
        blockingIssues,
        recommendedFixes,
        publicationReadiness: "requires_legal_review",
      };
    }
    return {
      ...base,
      tier: "red",
      tierReason: "Couche internal-only : hors périmètre open data grand public.",
      blockingIssues: [...blockingIssues, "Visibilité internal."],
      recommendedFixes: ["Ne pas publier sur portail grand public ; usage interne ou extranet autorisé uniquement."],
      publicationReadiness: "do_not_publish",
    };
  }

  if (row.riskLevel === "red") {
    return {
      ...base,
      tier: "red",
      tierReason: "riskLevel élevé côté registre.",
      blockingIssues: ["Risque métier / juridique élevé (registre)."],
      recommendedFixes: ["Revue risques, filtrage des champs, anonymisation ou exclusion."],
      publicationReadiness: "requires_legal_review",
    };
  }

  if (hasAttachmentFieldInRegistry(row)) {
    return {
      ...base,
      tier: "red",
      tierReason: "Champs pièces jointes / URL sensibles présents dans le registre.",
      blockingIssues: ["Présence de champs assimilables à pièces jointes ou URL non contrôlées."],
      recommendedFixes: ["Retirer les URL de PJ du jeu publié ou publier un extrait sans ces champs."],
      publicationReadiness: "requires_legal_review",
    };
  }

  if (row.sampleStatus === "failed" || row.sampleStatus === "empty") {
    blockingIssues.push("Échantillon ArcGIS non exploitable (échec ou vide).");
    recommendedFixes.push("Corriger la requête / le registre puis relancer l’inventaire.");
    return {
      ...base,
      tier: "orange",
      tierReason: "Qualité ou disponibilité technique insuffisante pour conclure VERT.",
      blockingIssues,
      recommendedFixes,
      publicationReadiness: "requires_business_validation",
    };
  }

  if (row.usageStatus === "to_investigate_technically") {
    blockingIssues.push("Statut métier : investigation technique requise.");
    recommendedFixes.push("Vérifier Query, champs, timeout ArcGIS.");
    return {
      ...base,
      tier: "orange",
      tierReason: "Problème technique ou échantillon non fiable pour trancher publication.",
      blockingIssues,
      recommendedFixes,
      publicationReadiness: "requires_business_validation",
    };
  }

  if (row.usageStatus === "needs_field_mapping") {
    blockingIssues.push("Mappings métier incomplets ou invalides (semanticMappings).");
    recommendedFixes.push("Aligner semanticMappings sur les champs ArcGIS réels ; valider les essentiels.");
    return {
      ...base,
      tier: "orange",
      tierReason: "Problème principal : mapping métier à compléter — correctible sans toucher au SIG.",
      blockingIssues,
      recommendedFixes,
      publicationReadiness: "requires_business_validation",
    };
  }

  if (row.usageStatus === "needs_data_cleaning") {
    blockingIssues.push("Données souvent incomplètes (nulls, libellés, géométrie requise, etc.).");
    recommendedFixes.push("Campagne qualité sur les champs utiles ; compléter les attributs côté métier.");
    return {
      ...base,
      tier: "orange",
      tierReason: "Qualité data à améliorer ; publication possible après nettoyage léger.",
      blockingIssues,
      recommendedFixes,
      publicationReadiness: "publishable_after_light_cleanup",
    };
  }

  if (row.usageStatus === "not_usable") {
    return {
      ...base,
      tier: "orange",
      tierReason: "Couche non fiable pour un usage public simple même après mapping basique.",
      blockingIssues: ["Score ou signaux d’usage indiquent une fiabilité insuffisante."],
      recommendedFixes: ["Reprofilage métier, enrichissement ou limitation d’usage (agrégats)."],
      publicationReadiness: "do_not_publish",
    };
  }

  const geomOk = !geometryRequired(row) || row.geometryStatus === "present";
  if (!geomOk) {
    blockingIssues.push("Géométrie requise mais absente sur l’échantillon.");
    recommendedFixes.push("Réparer les géométries côté source ou exclure les entités sans géométrie.");
    return {
      ...base,
      tier: "orange",
      tierReason: "Géométrie indispensable pour la carte / open data géolocalisée.",
      blockingIssues,
      recommendedFixes,
      publicationReadiness: "publishable_after_light_cleanup",
    };
  }

  const keys = Object.keys(row.nullRateSummary);
  const avgNull =
    keys.length > 0 ? keys.reduce((s, k) => s + (row.nullRateSummary[k] ?? 0), 0) / keys.length : 0;

  if (!labelOrIdOk(row)) {
    blockingIssues.push("Libellé ou identifiant public peu exploitable (couverture faible).");
    recommendedFixes.push("Renforcer les libellés ou publier avec colonne d’identifiant alternative validée.");
    return {
      ...base,
      tier: "orange",
      tierReason: "Libellé / identifiant insuffisant pour une open data citoyenne claire.",
      blockingIssues,
      recommendedFixes,
      publicationReadiness: "publishable_after_light_cleanup",
    };
  }

  const essentialKeys: SemanticMappingKey[] = entry ? getSemanticEssentialKeys(entry) : [];
  const invalidEssential = row.semanticValidation.invalidMappings.some(im =>
    essentialKeys.includes(im.key as SemanticMappingKey),
  );
  const mappingBlock = row.semanticValidation.missingEssentialMappings.length > 0 || invalidEssential;

  if (mappingBlock) {
    blockingIssues.push("Essentiels sémantiques encore en écart — incohérence à traiter.");
    recommendedFixes.push("Revalider semanticMappings et l’échantillon.");
    return {
      ...base,
      tier: "orange",
      tierReason: "Contrôle sémantique : écarts résiduels sur champs essentiels.",
      blockingIssues,
      recommendedFixes,
      publicationReadiness: "requires_business_validation",
    };
  }

  const canGreen =
    (row.usageStatus === "ready" || row.usageStatus === "usable_now") &&
    row.riskLevel !== "orange" &&
    row.preliminaryQualityScore >= 68 &&
    geomOk &&
    avgNull <= 0.42;

  if (canGreen && !profileForcesNonGreen) {
    return {
      ...base,
      tier: "green",
      tierReason:
        "Couche publique, échantillon OK, mappings essentiels valides, géométrie cohérente si requise, score et nulls favorables.",
      blockingIssues: [],
      recommendedFixes: ["Publier avec métadonnées DCAT minimales et mention de fraîcheur."],
      publicationReadiness: "publishable_now",
    };
  }

  if (profileForcesNonGreen) {
    const hintReadiness: PublicationReadiness = odProfile?.publicationReadinessHint ?? "requires_legal_review";
    recommendedFixes.push(
      odProfile?.requiresLegalReview
        ? "Soumettre la couche à la revue juridique avant toute publication open data."
        : "Soumettre la couche à la validation métier avant publication open data.",
    );
    return {
      ...base,
      tier: hintReadiness === "do_not_publish" ? "red" : "orange",
      tierReason:
        "Profil registry openData : publication subordonnée à une revue (juridique ou métier) — jamais VERT automatique.",
      blockingIssues,
      recommendedFixes,
      publicationReadiness: hintReadiness,
    };
  }

  if (row.usageStatus === "usable_with_caution" || row.riskLevel === "orange" || avgNull > 0.35) {
    blockingIssues.push(
      ...(row.riskLevel === "orange" ? ["Risque modéré (registre) : validation métier conseillée."] : []),
      ...(avgNull > 0.35 ? ["Nulls fréquents sur plusieurs champs exposés."] : []),
    );
    recommendedFixes.push("Compléter catégories / statuts, documenter les limites dans la fiche jeu.");
    return {
      ...base,
      tier: "orange",
      tierReason: "Publication possible avec cadrage (prudence, risque modéré ou champs secondaires).",
      blockingIssues,
      recommendedFixes,
      publicationReadiness:
        row.usageStatus === "usable_with_caution" ? "publishable_after_light_cleanup" : "requires_business_validation",
    };
  }

  if (row.preliminaryQualityScore >= 68 && !profileForcesNonGreen) {
    return {
      ...base,
      tier: "green",
      tierReason: "Signaux globalement favorables pour une publication pilotée.",
      blockingIssues: [],
      recommendedFixes: ["Contrôle métier léger avant mise en ligne."],
      publicationReadiness: "publishable_now",
    };
  }

  return {
    ...base,
    tier: "orange",
    tierReason: "Qualité moyenne : validation métier recommandée avant publication.",
    blockingIssues: ["Score ou signaux hétérogènes."],
    recommendedFixes: ["Passer une revue métier ciblée sur l’échantillon."],
    publicationReadiness: "requires_business_validation",
  };
}

/** Classement open data (compatibilité V0.4 + V0.5). */
export function classifyOpenDataTier(row: InventoryLayerRow): "green" | "orange" | "red" {
  return assessOpenDataCandidate(row).tier;
}

export async function runRecommendOpenDataCandidates(
  cfg: AppConfig,
  input: {
    mode: VisibilityMode;
    sampleLimit?: number;
    concurrency?: number;
    serviceKeys?: string[];
    targets?: InventoryTarget[];
    fast?: boolean;
  },
): Promise<{
  mode: VisibilityMode;
  greenCandidates: InventoryLayerRow[];
  orangeCandidates: InventoryLayerRow[];
  redCandidates: InventoryLayerRow[];
  layerAssessments: OpenDataLayerAssessment[];
  reasoning: string[];
  recommendedNextActions: string[];
  source: {
    type: "annecy_sig_mcp_open_data_recommendation";
    schemaVersion: typeof OPEN_DATA_SCHEMA_VERSION;
    serverVersion: string;
    inventory: InventoryRunResult["source"];
    samplingMode: InventoryRunResult["samplingMode"];
    samplingReliabilityNote: string;
  };
  samplingAudit: {
    failedSampleLayers: { serviceKey: string; layerId: number; layerName: string; sampleError?: string }[];
    emptySampleLayers: { serviceKey: string; layerId: number; layerName: string }[];
    geometryUnknownLayers: { serviceKey: string; layerId: number; layerName: string }[];
  };
}> {
  const inv = await runInventoryAllLayers(cfg, {
    mode: input.mode,
    sampleLimit: input.sampleLimit ?? 20,
    concurrency: input.concurrency,
    serviceKeys: input.serviceKeys,
    targets: input.targets,
    fast: input.fast,
  });
  const layerAssessments = inv.layers.map(l => assessOpenDataCandidate(l));
  const green: InventoryLayerRow[] = [];
  const orange: InventoryLayerRow[] = [];
  const red: InventoryLayerRow[] = [];
  inv.layers.forEach((row, i) => {
    const tier = layerAssessments[i]?.tier ?? "orange";
    if (tier === "green") green.push(row);
    else if (tier === "orange") orange.push(row);
    else red.push(row);
  });

  const reasoning: string[] = [
    inv.samplingReliabilityNote,
    `Analyse basée sur l’inventaire (${inv.layers.length} couches, échantillon demandé ${inv.requestedSampleLimit} / effectif ${inv.effectiveSampleLimit}, mode ${inv.mode}${inv.samplingMode === "fast" ? ", **mode rapide**" : ""}).`,
    "VERT : public, risque maîtrisé, échantillon OK, `usageStatus` favorable, libellé/géométrie cohérents, score suffisant.",
    "ORANGE : mapping incomplet, prudence d’usage, nulls ou risque modéré — nettoyage léger ou validation métier.",
    "ROUGE : internal, risque élevé, PJ sensibles, travaux en tier red, ou `do_not_publish`.",
  ];
  if (inv.mode === "public") {
    reasoning.push("Mode public : les couches internal n’apparaissent pas dans l’inventaire.");
  }

  const recommendedNextActions: string[] = [
    "Utiliser `layerAssessments` (tierReason, publicationReadiness, blockingIssues) pour prioriser les fiches open data.",
    "Pour ORANGE « publishable_after_light_cleanup » : planifier un sprint data court avant DCAT.",
    "Pour ROUGE : exclure ou pipeline juridique / anonymisation avant toute exposition.",
  ];

  const failedSampleLayers = inv.layers
    .filter(l => l.sampleStatus === "failed")
    .map(l => ({
      serviceKey: l.serviceKey,
      layerId: l.layerId,
      layerName: l.layerName,
      sampleError: l.sampleError,
    }));
  const emptySampleLayers = inv.layers
    .filter(l => l.sampleStatus === "empty")
    .map(l => ({ serviceKey: l.serviceKey, layerId: l.layerId, layerName: l.layerName }));
  const geometryUnknownLayers = inv.layers
    .filter(l => l.geometryStatus === "unknown")
    .map(l => ({ serviceKey: l.serviceKey, layerId: l.layerId, layerName: l.layerName }));

  const result = {
    mode: input.mode,
    greenCandidates: green,
    orangeCandidates: orange,
    redCandidates: red,
    layerAssessments,
    reasoning,
    recommendedNextActions,
    source: {
      type: "annecy_sig_mcp_open_data_recommendation" as const,
      schemaVersion: OPEN_DATA_SCHEMA_VERSION,
      serverVersion: SERVER_VERSION,
      inventory: inv.source,
      samplingMode: inv.samplingMode,
      samplingReliabilityNote: inv.samplingReliabilityNote,
    },
    samplingAudit: { failedSampleLayers, emptySampleLayers, geometryUnknownLayers },
  };
  validateContract(OpenDataBriefSchema, result, "OpenDataBrief");
  return result;
}

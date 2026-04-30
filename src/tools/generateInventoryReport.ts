import type { AppConfig } from "../config.js";
import type { VisibilityMode } from "../registry.js";
import { runInventoryAllLayers, type InventoryLayerRow, type InventoryRunResult } from "./inventoryAllLayers.js";
import { SERVICE_REGISTRY } from "../registry.js";
import { clampSampleLimit } from "../utils/validation.js";
import { REPORT_SCHEMA_VERSION, SERVER_VERSION } from "../runtime/version.js";
import {
  executiveSummaryHeading,
  mdBullet,
  mdH1,
  mdH2,
  mdParagraph,
} from "../utils/reportMarkdown.js";
import { writeReportOutput, type ReportOutput, type ReportExportMeta } from "../utils/reportOutput.js";
import type { UsageStatus } from "../utils/inventoryUsage.js";
import type { InventoryTarget } from "../inventory/types.js";
import { InventoryReportSchema, validateContract } from "../contracts/index.js";

export type ReportFormat = "json" | "markdown";

type LayerRef = { serviceKey: string; layerId: number; layerName: string; score: number };

type ToCleanEntry = { serviceKey: string; layerId: number; layerName: string; score: number; reasons: string[] };

type TechEntry = {
  serviceKey: string;
  layerId: number;
  layerName: string;
  sampleStatus: string;
  sampleError?: string;
  missingRegistryFields: string[];
};

export type InventoryReportStructured = {
  executiveSummary: string;
  servicesAnalyzed: number;
  layersAnalyzed: number;
  /** Compteurs par statut d’usage métier (V0.5). */
  usageStatusCounts: Record<UsageStatus, number>;
  countsSummary: {
    ready: number;
    usable: number;
    needsFieldMapping: number;
    toClean: number;
    toInvestigateTechnically: number;
    internal: number;
  };
  samplingFailureCount: number;
  emptySampleCount: number;
  geometryUnknownCount: number;
  samplingFailures: TechEntry[];
  layersWithRegistryFieldGaps: {
    serviceKey: string;
    layerId: number;
    layerName: string;
    missingFields: string[];
  }[];
  top5Best: LayerRef[];
  top5Worst: LayerRef[];
  frequentWarnings: { message: string; count: number }[];
  readyToUse: LayerRef[];
  usableNow: LayerRef[];
  usableWithCaution: LayerRef[];
  needsFieldMapping: { serviceKey: string; layerId: number; layerName: string; score: number; hints: string[] }[];
  toClean: ToCleanEntry[];
  toInvestigateTechnically: TechEntry[];
  keepInternal: { serviceKey: string; layerId: number; layerName: string; visibility: string }[];
  actionRecommendations: string[];
  source: {
    type: "annecy_sig_mcp_report";
    schemaVersion: typeof REPORT_SCHEMA_VERSION;
    serverVersion: string;
    inventory: InventoryRunResult["source"];
    runtimeMs?: number;
  };
};

function frequentWarningsFrom(layers: InventoryLayerRow[]): { message: string; count: number }[] {
  const m = new Map<string, number>();
  for (const l of layers) {
    for (const w of l.warnings) {
      m.set(w, (m.get(w) ?? 0) + 1);
    }
    for (const w of l.usageWarnings) {
      m.set(w, (m.get(w) ?? 0) + 1);
    }
  }
  return [...m.entries()]
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

function buildToCleanReasons(l: InventoryLayerRow): string[] {
  if (l.usageStatus !== "needs_data_cleaning") return [];
  const reasons = new Set<string>();
  for (const w of l.usageWarnings) {
    if (!/^Champs registre absents/i.test(w)) reasons.add(w);
  }
  if (l.geometryStatus === "missing" && l.semanticMappings?.geometryRequired) {
    reasons.add("Géométrie absente sur l’échantillon alors qu’elle est requise pour l’usage métier.");
  }
  const labelCov = l.semanticCoverage.coverageByMapping.labelField?.coverageRatio;
  if (labelCov !== undefined && labelCov < 0.35) {
    reasons.add("Libellé souvent absent ou vide sur l’échantillon (couverture faible).");
  }
  const addrCov = l.semanticCoverage.coverageByMapping.addressField?.coverageRatio;
  if (addrCov !== undefined && addrCov < 0.35) {
    reasons.add("Adresse souvent absente sur l’échantillon alors qu’elle est utile pour la publication.");
  }
  if (l.preliminaryQualityScore < 50 && l.sampleStatus === "ok") {
    reasons.add("Score préliminaire faible malgré un échantillon réussi (cohérence / nulls à revoir).");
  }
  return [...reasons];
}

function buildStructured(inv: InventoryRunResult): InventoryReportStructured {
  const sorted = [...inv.layers].sort((a, b) => b.preliminaryQualityScore - a.preliminaryQualityScore);
  const top5Best = sorted.slice(0, 5).map(l => ({
    serviceKey: l.serviceKey,
    layerId: l.layerId,
    layerName: l.layerName,
    score: l.preliminaryQualityScore,
  }));
  const top5Worst = [...sorted]
    .reverse()
    .slice(0, 5)
    .map(l => ({
      serviceKey: l.serviceKey,
      layerId: l.layerId,
      layerName: l.layerName,
      score: l.preliminaryQualityScore,
    }));
  const fw = frequentWarningsFrom(inv.layers);

  const usageStatusCounts = {
    ready: 0,
    usable_now: 0,
    usable_with_caution: 0,
    needs_field_mapping: 0,
    needs_data_cleaning: 0,
    to_investigate_technically: 0,
    internal_only: 0,
    not_usable: 0,
  } as Record<UsageStatus, number>;
  for (const l of inv.layers) {
    usageStatusCounts[l.usageStatus]++;
  }

  const samplingFailures = inv.layers
    .filter(l => l.sampleStatus === "failed")
    .map(l => ({
      serviceKey: l.serviceKey,
      layerId: l.layerId,
      layerName: l.layerName,
      sampleStatus: l.sampleStatus,
      sampleError: l.sampleError,
      missingRegistryFields: l.fieldValidation.missingFields,
    }));

  const layersWithRegistryFieldGaps = inv.layers
    .filter(l => l.fieldValidation.missingFields.length > 0)
    .map(l => ({
      serviceKey: l.serviceKey,
      layerId: l.layerId,
      layerName: l.layerName,
      missingFields: l.fieldValidation.missingFields,
    }));

  const toInvestigateTechnically = inv.layers
    .filter(l => l.usageStatus === "to_investigate_technically")
    .map(l => ({
      serviceKey: l.serviceKey,
      layerId: l.layerId,
      layerName: l.layerName,
      sampleStatus: l.sampleStatus,
      sampleError: l.sampleError,
      missingRegistryFields: l.fieldValidation.missingFields,
    }));

  const needsFieldMapping = inv.layers
    .filter(l => l.usageStatus === "needs_field_mapping")
    .map(l => ({
      serviceKey: l.serviceKey,
      layerId: l.layerId,
      layerName: l.layerName,
      score: l.preliminaryQualityScore,
      hints: [
        ...l.semanticValidation.missingEssentialMappings.map(k => `Essentiel manquant : ${k}`),
        ...l.semanticValidation.invalidMappings.map(im => `Mapping invalide : ${im.key} → ${im.field}`),
      ].slice(0, 8),
    }));

  const toCleanCandidates = inv.layers.filter(l => l.usageStatus === "needs_data_cleaning");
  const toClean: ToCleanEntry[] = [];
  for (const l of toCleanCandidates) {
    let reasons = buildToCleanReasons(l);
    if (reasons.length === 0) {
      reasons = ["Qualité data : écarts détectés (voir usageWarnings et nullRateSummary en détail JSON)."];
    }
    toClean.push({
      serviceKey: l.serviceKey,
      layerId: l.layerId,
      layerName: l.layerName,
      score: l.preliminaryQualityScore,
      reasons,
    });
  }

  const readyToUse = inv.layers.filter(l => l.usageStatus === "ready").map(l => ({
    serviceKey: l.serviceKey,
    layerId: l.layerId,
    layerName: l.layerName,
    score: l.preliminaryQualityScore,
  }));
  const usableNow = inv.layers.filter(l => l.usageStatus === "usable_now").map(l => ({
    serviceKey: l.serviceKey,
    layerId: l.layerId,
    layerName: l.layerName,
    score: l.preliminaryQualityScore,
  }));
  const usableWithCaution = inv.layers.filter(l => l.usageStatus === "usable_with_caution").map(l => ({
    serviceKey: l.serviceKey,
    layerId: l.layerId,
    layerName: l.layerName,
    score: l.preliminaryQualityScore,
  }));

  const keepInternal = inv.layers
    .filter(l => l.visibility === "internal")
    .map(l => ({
      serviceKey: l.serviceKey,
      layerId: l.layerId,
      layerName: l.layerName,
      visibility: l.visibility,
    }));

  const samplingFailureCount = inv.source.diagnostics.failedSamples;
  const emptySampleCount = inv.source.diagnostics.emptySamples;
  const geometryUnknownCount = inv.source.diagnostics.geometryUnknownLayers;

  const countsSummary = {
    ready: usageStatusCounts.ready,
    usable: usageStatusCounts.usable_now + usageStatusCounts.usable_with_caution,
    needsFieldMapping: usageStatusCounts.needs_field_mapping,
    toClean: toClean.length,
    toInvestigateTechnically: toInvestigateTechnically.length,
    internal: usageStatusCounts.internal_only,
  };

  const executiveSummary = [
    `Inventaire SIG (${inv.mode}) : ${inv.layers.length} couche(s) analysée(s) sur ${SERVICE_REGISTRY.length} service(s) ; échantillon demandé **${inv.requestedSampleLimit}**, effectif **${inv.effectiveSampleLimit}**${inv.samplingMode === "fast" ? " (**mode rapide**)" : ""}.`,
    `Statuts métier : ${countsSummary.ready} prête(s) (ready), ${countsSummary.usable} utilisable(s) maintenant ou avec prudence, ${countsSummary.needsFieldMapping} à mapper, ${countsSummary.toClean} à nettoyer (données), ${countsSummary.toInvestigateTechnically} à investiguer techniquement, ${countsSummary.internal} interne(s) uniquement.`,
    `Échantillons : ${samplingFailureCount} échec(s), ${emptySampleCount} vide(s), géométrie inconnue sur ${geometryUnknownCount} couche(s).`,
  ].join(" ");

  const actionRecommendations = [
    "« À investiguer techniquement » : Query, outFields, droits ArcGIS, timeout — avant de conclure sur la qualité métier.",
    "« À mapper » : compléter `semanticMappings` dans le registre selon les champs réels du service.",
    "« À nettoyer » : nulls, libellés, géométrie sur un échantillon **réussi** — problème de qualité data, pas de mapping.",
    "Les écarts « champs registre absents » ne suffisent pas à classer « à nettoyer » si les `semanticMappings` couvrent l’usage.",
    "Couches internal : hors open data / chatbot grand public sans cadrage.",
  ];

  return {
    executiveSummary,
    servicesAnalyzed: SERVICE_REGISTRY.length,
    layersAnalyzed: inv.layers.length,
    usageStatusCounts,
    countsSummary,
    samplingFailureCount,
    emptySampleCount,
    geometryUnknownCount,
    samplingFailures,
    layersWithRegistryFieldGaps,
    top5Best,
    top5Worst,
    frequentWarnings: fw,
    readyToUse,
    usableNow,
    usableWithCaution,
    needsFieldMapping,
    toClean,
    toInvestigateTechnically,
    keepInternal,
    actionRecommendations,
    source: {
      type: "annecy_sig_mcp_report",
      schemaVersion: REPORT_SCHEMA_VERSION,
      serverVersion: SERVER_VERSION,
      inventory: inv.source,
    },
  };
}

/** Exposé pour tests unitaires (inventaire mocké). */
export function buildInventoryReportStructuredForTest(
  inv: Pick<InventoryRunResult, "mode" | "layers" | "source"> &
    Partial<
      Pick<
        InventoryRunResult,
        | "sampleLimit"
        | "requestedSampleLimit"
        | "effectiveSampleLimit"
        | "samplingMode"
        | "samplingReliabilityNote"
      >
    >,
): InventoryReportStructured {
  const requested = inv.requestedSampleLimit ?? inv.sampleLimit ?? 20;
  const effective =
    inv.effectiveSampleLimit ?? (inv.samplingMode === "fast" ? 1 : inv.sampleLimit ?? requested);
  const full: InventoryRunResult = {
    ...inv,
    requestedSampleLimit: requested,
    effectiveSampleLimit: effective,
    sampleLimit: requested,
    samplingMode: inv.samplingMode ?? "standard",
    samplingReliabilityNote: inv.samplingReliabilityNote ?? "Mode standard (test).",
  };
  return buildStructured(full);
}

function toMarkdown(data: InventoryReportStructured): string {
  let s = mdH1("Rapport d’inventaire SIG Annecy");
  s += executiveSummaryHeading();
  s += mdParagraph(data.executiveSummary);
  s += mdH2("Lecture des statuts");
  s += mdBullet([
    "**À nettoyer** : échantillon ArcGIS OK, mais données incomplètes (nulls massifs, libellé/adresse, géométrie requise absente, etc.) — action **métier / qualité**.",
    "**À mapper** : le service répond, mais les **semanticMappings** (ou champs essentiels métier) sont absents ou ne correspondent pas aux champs ArcGIS — action **registre / intégration**.",
    "**À investiguer techniquement** : échantillon en échec ou vide, Query indisponible, ou métadonnées indisponibles — action **SIG / technique** avant toute lecture métier.",
    "**Utilisable avec prudence** : exploitable mais champs secondaires ou signaux partiels — documenter les limites côté produit.",
  ]);
  s += mdH2("Périmètre");
  s += mdBullet([
    `Services référencés : ${data.servicesAnalyzed}`,
    `Couches analysées : ${data.layersAnalyzed}`,
    `Échantillons en échec : ${data.samplingFailureCount}`,
    `Échantillons vides : ${data.emptySampleCount}`,
    `Géométrie inconnue (couches) : ${data.geometryUnknownCount}`,
  ]);
  s += mdH2("Répartition des statuts d’usage (V0.5)");
  s += mdBullet(
    (Object.entries(data.usageStatusCounts) as [UsageStatus, number][]).map(([k, n]) => `**${k}** : ${n}`),
  );
  s += mdH2("Échecs d’échantillonnage");
  s +=
    data.samplingFailures.length === 0
      ? mdParagraph("_Aucun échec d’échantillon sur cette passe._")
      : mdBullet(
          data.samplingFailures.map(
            x =>
              `**${x.serviceKey}** / ${x.layerId} — ${x.layerName}${x.sampleError ? ` — _${x.sampleError}_` : ""}`,
          ),
        );
  s += mdH2("Champs registre absents côté ArcGIS");
  s +=
    data.layersWithRegistryFieldGaps.length === 0
      ? mdParagraph("_Aucun écart registre ↔ service sur les champs demandés._")
      : mdBullet(
          data.layersWithRegistryFieldGaps.map(
            x =>
              `**${x.serviceKey}** / ${x.layerId} — ${x.layerName} : ${x.missingFields.slice(0, 14).join(", ")}${x.missingFields.length > 14 ? "…" : ""}`,
          ),
        );
  s += mdH2("Top 5 — scores les plus élevés");
  s += mdBullet(
    data.top5Best.map(x => `**${x.serviceKey}** / ${x.layerId} — ${x.layerName} — score **${x.score}**`),
  );
  s += mdH2("Top 5 — scores les plus faibles");
  s += mdBullet(
    data.top5Worst.map(x => `**${x.serviceKey}** / ${x.layerId} — ${x.layerName} — score **${x.score}**`),
  );
  s += mdH2("Warnings fréquents");
  s +=
    data.frequentWarnings.length === 0
      ? mdParagraph("_Aucun warning récurrent._")
      : mdBullet(data.frequentWarnings.map(w => `${w.message} (${w.count}×)`));
  s += mdH2("Prêtes (ready)");
  s +=
    data.readyToUse.length === 0
      ? mdParagraph("_Aucune couche dans cette catégorie._")
      : mdBullet(data.readyToUse.map(x => `**${x.serviceKey}** / ${x.layerId} — ${x.layerName} (${x.score})`));
  s += mdH2("Utilisables maintenant (usable_now)");
  s +=
    data.usableNow.length === 0
      ? mdParagraph("_Aucune._")
      : mdBullet(data.usableNow.map(x => `**${x.serviceKey}** / ${x.layerId} — ${x.layerName} (${x.score})`));
  s += mdH2("Utilisables avec prudence");
  s +=
    data.usableWithCaution.length === 0
      ? mdParagraph("_Aucune._")
      : mdBullet(data.usableWithCaution.map(x => `**${x.serviceKey}** / ${x.layerId} — ${x.layerName} (${x.score})`));
  s += mdH2("À mapper (needs_field_mapping)");
  s +=
    data.needsFieldMapping.length === 0
      ? mdParagraph("_Aucune._")
      : mdBullet(
          data.needsFieldMapping.map(
            x =>
              `**${x.serviceKey}** / ${x.layerId} — ${x.layerName} (${x.score}) : ${x.hints.join(" ; ")}`,
          ),
        );
  s += mdH2("À nettoyer (données, échantillon OK)");
  s +=
    data.toClean.length === 0
      ? mdParagraph("_Aucune couche dans cette catégorie._")
      : mdBullet(
          data.toClean.map(
            x =>
              `**${x.serviceKey}** / ${x.layerId} — ${x.layerName} (${x.score}) : ${x.reasons.join(" ; ")}`,
          ),
        );
  s += mdH2("À investiguer techniquement");
  s +=
    data.toInvestigateTechnically.length === 0
      ? mdParagraph("_Aucune couche dans cette catégorie._")
      : mdBullet(
          data.toInvestigateTechnically.map(
            x =>
              `**${x.serviceKey}** / ${x.layerId} — ${x.layerName} — statut **${x.sampleStatus}**${x.sampleError ? ` — _${x.sampleError}_` : ""}`,
          ),
        );
  s += mdH2("Couches à garder en interne");
  s +=
    data.keepInternal.length === 0
      ? mdParagraph("_Aucune couche internal dans ce mode._")
      : mdBullet(data.keepInternal.map(x => `**${x.serviceKey}** / ${x.layerId} — ${x.layerName}`));
  s += mdH2("Recommandations d’action");
  s += mdBullet(data.actionRecommendations);
  return s.trim();
}

export async function runGenerateInventoryReport(
  cfg: AppConfig,
  input: {
    mode: VisibilityMode;
    sampleLimit?: number;
    concurrency?: number;
    serviceKeys?: string[];
    targets?: InventoryTarget[];
    fast?: boolean;
    format: ReportFormat;
    writeOutput?: boolean;
  },
): Promise<{ format: ReportFormat; structured: InventoryReportStructured; body: string; output?: ReportOutput }> {
  const startedAt = Date.now();
  const sampleLimit = clampSampleLimit(input.sampleLimit ?? 20, 20, cfg.maxResultLimit);
  const inv = await runInventoryAllLayers(cfg, {
    mode: input.mode,
    sampleLimit,
    concurrency: input.concurrency,
    serviceKeys: input.serviceKeys,
    targets: input.targets,
    fast: input.fast,
  });
  const built = buildStructured(inv);
  built.source = {
    ...built.source,
    runtimeMs: Date.now() - startedAt,
  };
  const structured = validateContract<InventoryReportStructured>(
    InventoryReportSchema,
    built,
    "InventoryReport",
  );
  const body =
    input.format === "markdown"
      ? toMarkdown(structured)
      : JSON.stringify(structured, null, 2);
  const output = input.writeOutput
    ? await writeReportOutput(cfg, `inventory-report-${input.mode}`, input.format, body, {
        generatedAt: new Date().toISOString(),
        mode: input.mode,
        sampleLimit: inv.sampleLimit,
        concurrency: inv.source.execution.concurrency,
        fast: inv.source.execution.fast,
        sourceVersion: SERVER_VERSION,
        runtimeMs: Date.now() - startedAt,
        filters: { serviceKeys: input.serviceKeys ?? null, targets: input.targets ?? null },
      } satisfies ReportExportMeta)
    : undefined;
  return { format: input.format, structured, body, output };
}

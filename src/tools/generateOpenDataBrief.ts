import type { AppConfig } from "../config.js";
import type { VisibilityMode } from "../registry.js";
import { runRecommendOpenDataCandidates, type PublicationReadiness } from "./recommendOpenData.js";
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
import type { InventoryTarget } from "../inventory/types.js";
import { OPEN_DATA_SCHEMA_VERSION, SERVER_VERSION } from "../runtime/version.js";

export type OpenDataBriefLayerRef = {
  serviceKey: string;
  layerId: number;
  layerName: string;
  publicationReadiness: PublicationReadiness;
  tierReason: string;
};

export type OpenDataBriefStructured = {
  executiveSummary: string;
  green: { serviceKey: string; layerId: number; layerName: string }[];
  orange: { serviceKey: string; layerId: number; layerName: string }[];
  red: { serviceKey: string; layerId: number; layerName: string }[];
  /** V0.5 — regroupements actionnables. */
  candidatsPubliableRapidement: OpenDataBriefLayerRef[];
  candidatsNettoyageLeger: OpenDataBriefLayerRef[];
  candidatsValidationMetier: OpenDataBriefLayerRef[];
  exclusOuCadreJuridique: OpenDataBriefLayerRef[];
  operationalSynthesis: {
    quickWins7Days: string[];
    plan30Days: string[];
    arbitragesNecessaires: string[];
    questionsSigMetier: string[];
  };
  risks: string[];
  validationsNeeded: string[];
  quickWins: string[];
  plan30Days: string[];
  travauxTierApplied: "orange" | "red" | null;
  samplingReliabilityNote: string;
  source: {
    type: "annecy_sig_mcp_open_data_brief";
    schemaVersion: typeof OPEN_DATA_SCHEMA_VERSION;
    serverVersion: string;
    recommendation: Awaited<ReturnType<typeof runRecommendOpenDataCandidates>>["source"];
    runtimeMs?: number;
  };
};

function layerList(
  rows: { serviceKey: string; layerId: number; layerName: string }[],
): { serviceKey: string; layerId: number; layerName: string }[] {
  return rows.map(r => ({ serviceKey: r.serviceKey, layerId: r.layerId, layerName: r.layerName }));
}

function assessmentToRef(a: {
  serviceKey: string;
  layerId: number;
  layerName: string;
  publicationReadiness: PublicationReadiness;
  tierReason: string;
}): OpenDataBriefLayerRef {
  return {
    serviceKey: a.serviceKey,
    layerId: a.layerId,
    layerName: a.layerName,
    publicationReadiness: a.publicationReadiness,
    tierReason: a.tierReason,
  };
}

export async function runGenerateOpenDataBrief(
  cfg: AppConfig,
  input: {
    mode: VisibilityMode;
    travauxTier?: "orange" | "red";
    sampleLimit?: number;
    concurrency?: number;
    serviceKeys?: string[];
    targets?: InventoryTarget[];
    fast?: boolean;
    format: ReportFormat;
    writeOutput?: boolean;
  },
): Promise<{ format: ReportFormat; structured: OpenDataBriefStructured; body: string; output?: ReportOutput }> {
  const startedAt = Date.now();
  const prev = process.env.OPEN_DATA_TRAVAUX_TIER;
  let travauxTierApplied: "orange" | "red" | null = null;
  if (input.travauxTier) {
    process.env.OPEN_DATA_TRAVAUX_TIER = input.travauxTier;
    travauxTierApplied = input.travauxTier;
  }
  let rec: Awaited<ReturnType<typeof runRecommendOpenDataCandidates>>;
  try {
    rec = await runRecommendOpenDataCandidates(cfg, {
      mode: input.mode,
      sampleLimit: input.sampleLimit ?? 20,
      concurrency: input.concurrency,
      serviceKeys: input.serviceKeys,
      targets: input.targets,
      fast: input.fast,
    });
  } finally {
    if (input.travauxTier !== undefined) {
      if (prev === undefined) delete process.env.OPEN_DATA_TRAVAUX_TIER;
      else process.env.OPEN_DATA_TRAVAUX_TIER = prev;
    }
  }

  const failedN = rec.samplingAudit.failedSampleLayers.length;
  const emptyN = rec.samplingAudit.emptySampleLayers.length;
  const samplingReliabilityNoteBase =
    failedN + emptyN > 0
      ? `${failedN} couche(s) avec échantillon en échec, ${emptyN} avec échantillon vide : classées **au minimum ORANGE**, jamais VERT sans nouvelle passe d’inventaire valide. Échantillon indisponible → validation technique requise avant conclusion open data.`
      : "Tous les échantillons ArcGIS de cette passe sont exploitables pour le classement (succès avec au moins une entité).";
  const invNote = rec.source.samplingReliabilityNote?.trim() ?? "";
  const samplingReliabilityNote = [samplingReliabilityNoteBase, invNote].filter(Boolean).join(" | ");

  const la = rec.layerAssessments;
  const candidatsPubliableRapidement = la
    .filter(a => a.publicationReadiness === "publishable_now")
    .map(assessmentToRef);
  const candidatsNettoyageLeger = la
    .filter(a => a.publicationReadiness === "publishable_after_light_cleanup")
    .map(assessmentToRef);
  const candidatsValidationMetier = la
    .filter(a => a.publicationReadiness === "requires_business_validation")
    .map(assessmentToRef);
  const exclusOuCadreJuridique = la
    .filter(
      a => a.publicationReadiness === "requires_legal_review" || a.publicationReadiness === "do_not_publish",
    )
    .map(assessmentToRef);

  const operationalSynthesis = {
    quickWins7Days: [
      `Publier ou packager en priorité les ${candidatsPubliableRapidement.length} jeu(x) « publiable maintenant » avec fiche DCAT minimale.`,
      `Préparer un backlog data court sur ${candidatsNettoyageLeger.length} jeu(x) « nettoyage léger » (nulls, libellés, catégories).`,
      "Organiser un point juridique de 60 minutes sur les jeux « cadre juridique » si l’objectif est une ouverture partielle.",
    ],
    plan30Days: [
      "J1–J7 : figer la liste publiable maintenant, métadonnées DCAT, URL de téléchargement stable.",
      "J8–J15 : sprint qualité sur jeux nettoyage léger + re-passe inventaire (même sampleLimit) pour valider les gains.",
      "J16–J23 : ateliers métier sur jeux « validation métier » (glossaires, champs optionnels, statuts).",
      "J24–J30 : revue juridique ciblée + décision d’exclusion ou pipeline sécurisé pour jeux sensibles.",
    ],
    arbitragesNecessaires: [
      "Niveau de détail acceptable pour l’open data (tous attributs vs extrait).",
      "Fréquence de mise à jour annoncée vs capacité réelle du service SIG.",
      "Périmètre des couches mobilité à forte densité (stationnement) : carte complète vs agrégats.",
    ],
    questionsSigMetier: [
      "Quels champs « internes » doivent rester hors export même en mode internal MCP ?",
      "Les catégories affichées sont-elles stabilisées (référentiel) ou libres saisie ?",
      "Y a-t-il une gouvernance pour les pièces jointes travaux (hors diffusion brute) ?",
    ],
  };

  const structured: OpenDataBriefStructured = {
    executiveSummary: [
      `Brief open data V0.5 (mode ${rec.mode}) : ${rec.greenCandidates.length} VERT, ${rec.orangeCandidates.length} ORANGE, ${rec.redCandidates.length} ROUGE.`,
      `${candidatsPubliableRapidement.length} jeu(x) classés publiable(s) maintenant, ${candidatsNettoyageLeger.length} après nettoyage léger, ${candidatsValidationMetier.length} avec validation métier, ${exclusOuCadreJuridique.length} à exclure ou à cadrer juridiquement.`,
      "Les classes ROUGE / ORANGE ne dispensent pas d’une validation juridique et métier avant diffusion.",
      samplingReliabilityNote,
    ].join(" "),
    green: layerList(rec.greenCandidates),
    orange: layerList(rec.orangeCandidates),
    red: layerList(rec.redCandidates),
    candidatsPubliableRapidement,
    candidatsNettoyageLeger,
    candidatsValidationMetier,
    exclusOuCadreJuridique,
    operationalSynthesis,
    risks: [
      "Données à caractère personnel ou d’usage interne mélangées aux champs publics.",
      "Pièces jointes ou URL non contrôlées (couches travaux ou métier).",
      "Géométrie ou libellés incomplets → erreurs d’interprétation côté usager.",
      ...(failedN + emptyN > 0
        ? [
            "Un ou plusieurs échantillons ArcGIS sont vides ou en échec : le classement VERT/ORANGE peut être pessimiste ou neutre, mais ne remplace pas une requête terrain réussie.",
          ]
        : []),
    ],
    validationsNeeded: [
      ...(failedN + emptyN > 0
        ? [
            "Échantillon indisponible sur une ou plusieurs couches : validation technique (champs registre vs service, capacité Query) avant toute publication.",
          ]
        : []),
      "Valider la licence / réutilisation pour chaque jeu VERT.",
      "Passer en revue les champs ORANGE (nulls, sémantique, catégories).",
      "Exclure ou anonymiser les jeux ROUGE pour tout canal grand public.",
    ],
    quickWins: [
      "Publier d’abord les jeux « publiable maintenant » à faible volumétrie (WC, mobilité simple).",
      "Publier des extraits ORANGE avec filtre géographique ou agrégats.",
    ],
    plan30Days: operationalSynthesis.plan30Days,
    travauxTierApplied,
    samplingReliabilityNote,
    source: {
      type: "annecy_sig_mcp_open_data_brief",
      schemaVersion: OPEN_DATA_SCHEMA_VERSION,
      serverVersion: SERVER_VERSION,
      recommendation: rec.source,
      runtimeMs: Date.now() - startedAt,
    },
  };

  const md = () => {
    let s = mdH1("Brief open data — Annecy SIG");
    s += executiveSummaryHeading();
    s += mdParagraph(structured.executiveSummary);
    if (structured.travauxTierApplied) {
      s += mdParagraph(`_Classement travaux (paramètre brief) : **${structured.travauxTierApplied}**._`);
    }
    s += mdH2("Fiabilité de l’échantillon");
    s += mdParagraph(structured.samplingReliabilityNote);
    if (rec.samplingAudit.failedSampleLayers.length > 0) {
      s += mdH3("Couches — échantillon en échec");
      s += mdBullet(
        rec.samplingAudit.failedSampleLayers.map(
          x =>
            `**${x.serviceKey}** / ${x.layerId} — ${x.layerName}${x.sampleError ? ` — _${x.sampleError}_` : ""}`,
        ),
      );
    }
    if (rec.samplingAudit.emptySampleLayers.length > 0) {
      s += mdH3("Couches — échantillon vide");
      s += mdBullet(
        rec.samplingAudit.emptySampleLayers.map(x => `**${x.serviceKey}** / ${x.layerId} — ${x.layerName}`),
      );
    }
    s += mdH2("Candidats publiables rapidement");
    s +=
      structured.candidatsPubliableRapidement.length === 0
        ? mdParagraph("_Aucun sur cette passe._")
        : mdBullet(
            structured.candidatsPubliableRapidement.map(
              x => `**${x.serviceKey}** / ${x.layerId} — ${x.layerName} — _${x.tierReason}_`,
            ),
          );
    s += mdH2("Candidats à nettoyage léger");
    s +=
      structured.candidatsNettoyageLeger.length === 0
        ? mdParagraph("_Aucun sur cette passe._")
        : mdBullet(
            structured.candidatsNettoyageLeger.map(
              x => `**${x.serviceKey}** / ${x.layerId} — ${x.layerName} — _${x.tierReason}_`,
            ),
          );
    s += mdH2("Candidats à validation métier");
    s +=
      structured.candidatsValidationMetier.length === 0
        ? mdParagraph("_Aucun sur cette passe._")
        : mdBullet(
            structured.candidatsValidationMetier.map(
              x => `**${x.serviceKey}** / ${x.layerId} — ${x.layerName} — _${x.tierReason}_`,
            ),
          );
    s += mdH2("À exclure ou cadrer juridiquement");
    s +=
      structured.exclusOuCadreJuridique.length === 0
        ? mdParagraph("_Aucun sur cette passe._")
        : mdBullet(
            structured.exclusOuCadreJuridique.map(
              x =>
                `**${x.serviceKey}** / ${x.layerId} — ${x.layerName} (${x.publicationReadiness}) — _${x.tierReason}_`,
            ),
          );
    s += mdH2("Synthèse opérationnelle");
    s += mdH3("Quick wins 7 jours");
    s += mdBullet(structured.operationalSynthesis.quickWins7Days);
    s += mdH3("Plan 30 jours");
    s += mdBullet(structured.operationalSynthesis.plan30Days);
    s += mdH3("Arbitrages nécessaires");
    s += mdBullet(structured.operationalSynthesis.arbitragesNecessaires);
    s += mdH3("Questions à poser au service SIG / métier");
    s += mdBullet(structured.operationalSynthesis.questionsSigMetier);
    s += mdH2("Candidats VERT (tiers)");
    s += mdBullet(structured.green.map(x => `**${x.serviceKey}** / ${x.layerId} — ${x.layerName}`));
    s += mdH2("Candidats ORANGE (tiers)");
    s += mdBullet(structured.orange.map(x => `**${x.serviceKey}** / ${x.layerId} — ${x.layerName}`));
    s += mdH2("Candidats ROUGE (tiers)");
    s += mdBullet(structured.red.map(x => `**${x.serviceKey}** / ${x.layerId} — ${x.layerName}`));
    s += mdH2("Risques");
    s += mdBullet(structured.risks);
    s += mdH2("Validations nécessaires");
    s += mdBullet(structured.validationsNeeded);
    s += mdH2("Quick wins (général)");
    s += mdBullet(structured.quickWins);
    s += mdH2("Plan d’action 30 jours (général)");
    s += mdBullet(structured.plan30Days);
    s += mdH3("Raisonnement (extrait)");
    s += mdBullet(rec.reasoning.slice(0, 4));
    return s.trim();
  };

  const body = input.format === "markdown" ? md() : JSON.stringify(structured, null, 2);
  const output = input.writeOutput
    ? await writeReportOutput(cfg, `open-data-brief-${input.mode}`, input.format, body, {
        generatedAt: new Date().toISOString(),
        mode: input.mode,
        sampleLimit: input.sampleLimit ?? 20,
        concurrency: rec.source.inventory.execution.concurrency,
        fast: rec.source.inventory.execution.fast,
        sourceVersion: SERVER_VERSION,
        runtimeMs: Date.now() - startedAt,
        filters: {
          travauxTier: input.travauxTier ?? null,
          serviceKeys: input.serviceKeys ?? null,
          targets: input.targets ?? null,
        },
      } satisfies ReportExportMeta)
    : undefined;
  return { format: input.format, structured, body, output };
}

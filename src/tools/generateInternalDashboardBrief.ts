import type { AppConfig } from "../config.js";
import type { VisibilityMode } from "../registry.js";
import { AppError } from "../utils/errors.js";
import { runListCurrentWorks, runListLateWorks } from "./works.js";
import {
  executiveSummaryHeading,
  mdBullet,
  mdH1,
  mdH2,
  mdParagraph,
} from "../utils/reportMarkdown.js";
import type { ReportFormat } from "./generateInventoryReport.js";
import { writeReportOutput, type ReportOutput, type ReportExportMeta } from "../utils/reportOutput.js";
import { INTERNAL_DASHBOARD_SCHEMA_VERSION, SERVER_VERSION } from "../runtime/version.js";
import { InternalDashboardBriefSchema, validateContract } from "../contracts/index.js";

function redactTravail(t: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(t)) {
    const kl = k.toLowerCase();
    if (kl === "url_piece_jointe" || kl === "url_pj") continue;
    if (kl === "created_user" || kl === "created_date" || kl === "last_edited_user" || kl === "last_edited_date")
      continue;
    out[k] = v;
  }
  return out;
}

function countNonConforme(rows: Record<string, unknown>[]): number {
  return rows.filter(r => /non.?conforme|anomalie|incomplet/i.test(String(r.statut_interne ?? ""))).length;
}

export type InternalDashboardStructured = {
  executiveSummary: string;
  dateReference: string;
  travauxEnCours: { total: number; stats: Record<string, unknown> };
  travauxEnRetard: { total: number; stats: Record<string, unknown> };
  travauxSansGeometrie: number;
  travauxSansAdresse: number;
  travauxSansTitre: number;
  travauxTerminesNonConformesHeuristique: number;
  recommendedIndicators: string[];
  qualityAlerts: string[];
  travauxEnCoursEchantillon: Record<string, unknown>[];
  travauxEnRetardEchantillon: Record<string, unknown>[];
  source: {
    type: "annecy_sig_mcp_internal_dashboard";
    schemaVersion: typeof INTERNAL_DASHBOARD_SCHEMA_VERSION;
    serverVersion: string;
    travaux: unknown[];
    runtimeMs?: number;
  };
};

export async function runGenerateInternalDashboardBrief(
  cfg: AppConfig,
  input: { mode: VisibilityMode; date?: string; format: ReportFormat; writeOutput?: boolean },
): Promise<{ format: ReportFormat; structured: InternalDashboardStructured; body: string; output?: ReportOutput }> {
  const startedAt = Date.now();
  if (input.mode !== "internal") {
    throw new AppError(
      "FORBIDDEN",
      "generate_internal_dashboard_brief est réservé au mode internal.",
      { hint: "Passer mode=internal pour agréger les indicateurs travaux." },
    );
  }

  const current = await runListCurrentWorks(cfg, { date: input.date, limit: 400, includeGeometry: true });
  const late = await runListLateWorks(cfg, { limit: 200, includeGeometry: true });

  const cur = current.travaux as Record<string, unknown>[];
  const lat = late.travaux as Record<string, unknown>[];
  const curR = cur.map(redactTravail);
  const latR = lat.map(redactTravail);

  const travauxSansGeometrie = current.stats.withoutGeometry;
  const travauxSansAdresse = current.stats.withoutAddress;
  const travauxSansTitre = current.stats.withoutTitle;
  const heuristicNonConforme = countNonConforme(curR) + countNonConforme(latR);

  const qualityAlerts: string[] = [];
  if (travauxSansGeometrie > 0) qualityAlerts.push(`${travauxSansGeometrie} travaux en cours sans géométrie (échantillon courant).`);
  if (travauxSansAdresse > 0) qualityAlerts.push(`${travauxSansAdresse} travaux en cours sans adresse renseignée.`);
  if (late.stats.totalReturned > 0) qualityAlerts.push(`${late.stats.totalReturned} chantier(s) signalé(s) « en cours hors délai ».`);
  if (heuristicNonConforme > 0) {
    qualityAlerts.push(
      `${heuristicNonConforme} occurrence(s) de statuts « non conforme / anomalie » (heuristique texte sur l’échantillon courant + retards).`,
    );
  }

  const recommendedIndicators = [
    "Taux de couverture géométrique des travaux actifs.",
    "Délai moyen entre début et fin d’autorisation.",
    "Nombre de retards (hors délai) par mois.",
    "Taux de fiches avec adresse complète.",
  ];

  const structured: InternalDashboardStructured = validateContract<InternalDashboardStructured>(
    InternalDashboardBriefSchema,
    {
      executiveSummary: [
        `Tableau de bord interne — travaux au ${current.date} : ${current.stats.totalReturned} actif(s) listé(s), ${late.stats.totalReturned} en retard signalé(s).`,
        "Les pièces jointes et URL sensibles sont omises de ce brief.",
      ].join(" "),
      dateReference: current.date,
      travauxEnCours: { total: current.stats.totalReturned, stats: { ...current.stats } },
      travauxEnRetard: { total: late.stats.totalReturned, stats: { ...late.stats } },
      travauxSansGeometrie,
      travauxSansAdresse,
      travauxSansTitre,
      travauxTerminesNonConformesHeuristique: heuristicNonConforme,
      recommendedIndicators,
      qualityAlerts,
      travauxEnCoursEchantillon: curR.slice(0, 15),
      travauxEnRetardEchantillon: latR.slice(0, 15),
      source: {
        type: "annecy_sig_mcp_internal_dashboard",
        schemaVersion: INTERNAL_DASHBOARD_SCHEMA_VERSION,
        serverVersion: SERVER_VERSION,
        travaux: [current.source, late.source],
        runtimeMs: Date.now() - startedAt,
      },
    },
    "InternalDashboardBrief",
  );

  const md = () => {
    let s = mdH1("Brief dashboard interne — travaux");
    s += executiveSummaryHeading();
    s += mdParagraph(structured.executiveSummary);
    s += mdH2("Synthèse chiffrée");
    s += mdBullet([
      `Travaux en cours (liste) : ${structured.travauxEnCours.total}`,
      `Travaux en retard (hors délai) : ${structured.travauxEnRetard.total}`,
      `Sans géométrie : ${structured.travauxSansGeometrie}`,
      `Sans adresse : ${structured.travauxSansAdresse}`,
      `Sans titre : ${structured.travauxSansTitre}`,
      `Statuts « non conforme » (heuristique) : ${structured.travauxTerminesNonConformesHeuristique}`,
    ]);
    s += mdH2("Indicateurs recommandés");
    s += mdBullet(structured.recommendedIndicators);
    s += mdH2("Alertes qualité data");
    s += structured.qualityAlerts.length ? mdBullet(structured.qualityAlerts) : mdParagraph("_Aucune alerte majeure sur les agrégats._");
    s += mdH2("Échantillon travaux en cours (sans pièces jointes)");
    s += mdParagraph("_Données réduites aux 15 premiers enregistrements._");
    s += mdParagraph("```json\n" + JSON.stringify(structured.travauxEnCoursEchantillon, null, 2).slice(0, 8000) + "\n```");
    return s.trim();
  };

  const body = input.format === "markdown" ? md() : JSON.stringify(structured, null, 2);
  const output = input.writeOutput
    ? await writeReportOutput(cfg, `internal-dashboard-${input.date ?? current.date}`, input.format, body, {
        generatedAt: new Date().toISOString(),
        mode: input.mode,
        sourceVersion: SERVER_VERSION,
        runtimeMs: Date.now() - startedAt,
        filters: { date: input.date ?? current.date },
      } satisfies ReportExportMeta)
    : undefined;
  return { format: input.format, structured, body, output };
}

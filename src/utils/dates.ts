export type TimestampParseResult = {
  isoUtc: string;
  /** Indication lisible côté Europe (date locale approximative via ISO). */
  isoLocalNote: string;
  warning?: string;
};

const MS_PER_DAY = 86_400_000;
const MIN_REASONABLE_MS = Date.UTC(1970, 0, 1);
const MAX_REASONABLE_MS = Date.UTC(2100, 0, 1);

function toMilliseconds(value: number): { ms: number; warning?: string } {
  if (!Number.isFinite(value)) return { ms: NaN };
  if (Math.abs(value) < 1e11) {
    return { ms: value * 1000, warning: "Valeur numérique interprétée comme secondes Unix (conversion x1000)." };
  }
  return { ms: value };
}

/**
 * Convertit un timestamp ArcGIS (ms en général) en ISO UTC + note locale.
 */
export function timestampMsToIso(value: unknown): TimestampParseResult | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return {
      isoUtc: "",
      isoLocalNote: "",
      warning: "Valeur de date incohérente ou non numérique.",
    };
  }
  const { ms, warning } = toMilliseconds(n);
  if (!Number.isFinite(ms)) {
    return { isoUtc: "", isoLocalNote: "", warning: "Timestamp invalide après normalisation." };
  }
  const d = new Date(ms);
  if (ms < MIN_REASONABLE_MS || ms > MAX_REASONABLE_MS) {
    return {
      isoUtc: d.toISOString(),
      isoLocalNote: d.toISOString(),
      warning: "Date hors plage raisonnable (avant 1970 ou après 2100).",
    };
  }
  const isoUtc = d.toISOString();
  const w = warning;
  return {
    isoUtc,
    isoLocalNote: `${isoUtc} (UTC ; adapter au fuseau pour affichage citoyen)`,
    ...(w ? { warning: w } : {}),
  };
}

/** Chaîne ISO unique pour les champs *_iso en sortie. */
export function timestampMsToIsoString(value: unknown): { value: string | null; warning?: string } {
  const r = timestampMsToIso(value);
  if (!r) return { value: null };
  if (r.warning && !r.isoUtc) return { value: null, warning: r.warning };
  return { value: r.isoUtc || null, warning: r.warning };
}

/** Bornes du jour civil en UTC pour une date `YYYY-MM-DD`. */
export function utcDayBoundsMs(isoDate: string): { startMs: number; endMs: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) {
    const d = new Date(isoDate);
    const t = d.getTime();
    const startMs = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).getTime();
    const endMs = startMs + MS_PER_DAY - 1;
    return { startMs, endMs: Number.isFinite(t) ? endMs : startMs + MS_PER_DAY - 1 };
  }
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const startMs = Date.UTC(y, mo, day);
  return { startMs, endMs: startMs + MS_PER_DAY - 1 };
}

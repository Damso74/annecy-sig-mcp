import { AppError } from "../utils/errors.js";

const PJSON = "pjson";

export function joinUrl(base: string, ...parts: string[]): string {
  const b = base.replace(/\/+$/, "");
  const p = parts.map(s => s.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/");
  return `${b}/${p}`;
}

export function assertArcgisUrl(baseUrl: string, fullUrl: string, allowedHost: string): void {
  let u: URL;
  try {
    u = new URL(fullUrl);
  } catch {
    throw new AppError("INTERNAL_ERROR", "URL ArcGIS invalide.", {});
  }
  if (u.hostname !== allowedHost) {
    throw new AppError("FORBIDDEN", `Hôte refusé : ${u.hostname} (autorisé : ${allowedHost}).`, {});
  }
  if (u.protocol !== "https:") {
    throw new AppError("FORBIDDEN", "Seul HTTPS est autorisé pour les appels ArcGIS.", {});
  }
  if (!fullUrl.startsWith(baseUrl.replace(/\/+$/, ""))) {
    throw new AppError("FORBIDDEN", "L'URL ne correspond pas à ANNECY_SIG_BASE_URL.", {});
  }
}

export function serviceMetadataUrl(baseUrl: string, servicePath: string): string {
  const url = new URL(joinUrl(baseUrl, servicePath));
  url.searchParams.set("f", PJSON);
  return url.toString();
}

export function layerMetadataUrl(baseUrl: string, servicePath: string, layerId: number): string {
  const url = new URL(joinUrl(baseUrl, servicePath, String(layerId)));
  url.searchParams.set("f", PJSON);
  return url.toString();
}

export type QueryFormat = "geojson" | "json";

export function layerQueryUrl(
  baseUrl: string,
  servicePath: string,
  layerId: number,
  params: Record<string, string | number | boolean | undefined>,
  format: QueryFormat,
): string {
  const url = new URL(joinUrl(baseUrl, servicePath, String(layerId), "query"));
  const f = format === "geojson" ? "geojson" : "json";
  url.searchParams.set("f", f);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

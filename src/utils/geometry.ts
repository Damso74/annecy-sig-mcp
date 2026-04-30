export type LatLon = { lat: number; lon: number };

type GeoJSONGeometry = {
  type?: string;
  coordinates?: unknown;
  x?: number;
  y?: number;
};

function ringCentroid(ring: number[][]): LatLon | null {
  if (!ring.length) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const c of ring) {
    if (c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
      sx += c[0];
      sy += c[1];
      n++;
    }
  }
  if (!n) return null;
  return { lon: sx / n, lat: sy / n };
}

/** Extrait un point représentatif pour distance Haversine (Point, MultiPoint, Polygone simplifié). */
export function representativeLatLon(geometry: unknown): LatLon | null {
  if (!geometry || typeof geometry !== "object") return null;
  const g = geometry as GeoJSONGeometry;

  if ("type" in g && g.type === "Point" && Array.isArray(g.coordinates)) {
    const [lon, lat] = g.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    return null;
  }
  if ("type" in g && g.type === "MultiPoint" && Array.isArray(g.coordinates) && g.coordinates.length) {
    const [lon, lat] = g.coordinates[0];
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    return null;
  }
  if ("type" in g && g.type === "LineString" && Array.isArray(g.coordinates) && g.coordinates.length) {
    const mid = g.coordinates[Math.floor(g.coordinates.length / 2)];
    if (mid && Number.isFinite(mid[1]) && Number.isFinite(mid[0])) return { lat: mid[1], lon: mid[0] };
  }
  if ("type" in g && g.type === "Polygon" && Array.isArray(g.coordinates) && g.coordinates[0]) {
    return ringCentroid(g.coordinates[0] as number[][]);
  }
  if ("type" in g && g.type === "MultiPolygon" && Array.isArray(g.coordinates) && g.coordinates[0]) {
    const first = g.coordinates[0][0] as number[][];
    return ringCentroid(first);
  }
  if (typeof g.x === "number" && typeof g.y === "number" && Number.isFinite(g.x) && Number.isFinite(g.y)) {
    return { lon: g.x, lat: g.y };
  }
  return null;
}

export function geometryIsNullOrEmpty(geometry: unknown): boolean {
  if (geometry === null || geometry === undefined) return true;
  if (typeof geometry !== "object") return true;
  const g = geometry as { type?: string; coordinates?: unknown };
  if (g.type === "Point" && Array.isArray(g.coordinates)) {
    return g.coordinates.length < 2;
  }
  return false;
}

/** Normalise les clés d’attributs en minuscules (ArcGIS / GeoJSON mixtes). */
export function lowerPropertyKeys(props: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    o[k.toLowerCase()] = v;
  }
  return o;
}

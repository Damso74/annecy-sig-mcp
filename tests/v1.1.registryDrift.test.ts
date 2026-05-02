import { describe, expect, it } from "vitest";
import {
  EQUIP_INTERNAL_EXTRA,
  EQUIP_PUBLIC_FIELDS,
  LAYER_REGISTRY,
  MOBIL_INTERNAL_EXTRA,
  MOBIL_PUBLIC_FIELDS,
  TRAVAUX_INTERNAL_FIELDS,
} from "../src/registry.js";
import {
  LAYER_FIELDS_OVERRIDES,
  type LayerFieldsOverride,
} from "../src/registry.fields.generated.js";
import { loadFixture } from "./helpers/mockArcgisClient.js";
import type { EsriLayerMetadata } from "../src/arcgis/types.js";

const SENSITIVE_LC = new Set([
  "created_user",
  "created_date",
  "last_edited_user",
  "last_edited_date",
  "globalid",
  "shape",
  "shape_length",
  "shape_area",
  "token",
  "password",
  "secret",
  "bearer",
  "url_pj",
  "url_piece_jointe",
  "attachment",
]);

/** Charge un override sans planter si la couche n'a pas encore été synchronisée. */
function getOverride(serviceKey: string, layerId: number): LayerFieldsOverride | undefined {
  return LAYER_FIELDS_OVERRIDES[serviceKey]?.[layerId];
}

describe("V1.1 — registry.fields.generated cohérent avec le registre", () => {
  it("toutes les couches du registre ont une override générée", () => {
    const missing: string[] = [];
    for (const e of LAYER_REGISTRY) {
      if (!getOverride(e.serviceKey, e.layerId)) {
        missing.push(`${e.serviceKey}/${e.layerId} (${e.layerName})`);
      }
    }
    expect(missing, `Couches sans override : ${missing.join(", ")}`).toEqual([]);
  });

  it("aucun champ sensible n'est exposé par les overrides", () => {
    const leaks: string[] = [];
    for (const serviceKey of Object.keys(LAYER_FIELDS_OVERRIDES)) {
      const layers = LAYER_FIELDS_OVERRIDES[serviceKey];
      if (!layers) continue;
      for (const layerId of Object.keys(layers)) {
        const o = layers[Number(layerId)];
        if (!o) continue;
        for (const f of [...o.publicFields, ...o.internalExtraFields]) {
          if (SENSITIVE_LC.has(f.toLowerCase())) {
            leaks.push(`${serviceKey}/${layerId}: ${f}`);
          }
        }
      }
    }
    expect(leaks, `Fuites sensibles détectées : ${leaks.join(", ")}`).toEqual([]);
  });

  it("travaux/3 ne fuit aucun champ public (couche internal-only)", () => {
    const o = getOverride("travaux", 3);
    expect(o).toBeDefined();
    expect(o?.publicFields).toEqual([]);
    // url_pj est sensible ⇒ on ne l'expose même pas en internal-extra côté override.
    for (const f of o?.internalExtraFields ?? []) {
      expect(SENSITIVE_LC.has(f.toLowerCase()), `champ sensible ${f} en internal-extra`).toBe(false);
    }
  });

  it("publicFields (registre) ⊆ champs ArcGIS — vérification offline via fixtures connues", () => {
    // Note : mobilite/10 est volontairement **omis** ici. La fixture historique
    // déclare `denomination` (consommée par d'autres tests d'inventaire),
    // alors que le schéma ArcGIS réel expose `titre` à la place. Le drift est
    // détecté en LIVE par `npm run check:registry` (CI quotidien).
    const cases: { serviceKey: string; layerId: number; fixture: string }[] = [
      { serviceKey: "equipements", layerId: 5, fixture: "equipements-wc-metadata.json" },
      { serviceKey: "equipements", layerId: 0, fixture: "equipements-admin-metadata.json" },
      { serviceKey: "travaux", layerId: 3, fixture: "travaux-metadata.json" },
    ];

    for (const c of cases) {
      const meta = loadFixture(c.fixture) as EsriLayerMetadata;
      const arcgis = new Set((meta.fields ?? []).map(f => f.name?.toLowerCase()).filter(Boolean));
      const entry = LAYER_REGISTRY.find(
        e => e.serviceKey === c.serviceKey && e.layerId === c.layerId,
      );
      expect(entry, `Couche ${c.serviceKey}/${c.layerId} introuvable`).toBeDefined();
      const drift: string[] = [];
      for (const f of [...(entry?.publicFields ?? []), ...(entry?.internalFields ?? [])]) {
        if (!arcgis.has(f.toLowerCase())) {
          drift.push(`${c.serviceKey}/${c.layerId}:${f}`);
        }
      }
      expect(drift, `Drift registre ↔ fixture ${c.fixture} : ${drift.join(", ")}`).toEqual([]);
    }
  });

  it("les listes génériques par service restent cohérentes (pas de doublons casse)", () => {
    function lcSet(arr: readonly string[]): Set<string> {
      return new Set(arr.map(x => x.toLowerCase()));
    }
    expect(lcSet(EQUIP_PUBLIC_FIELDS).size, "EQUIP_PUBLIC_FIELDS doublons").toBe(EQUIP_PUBLIC_FIELDS.length);
    expect(lcSet(EQUIP_INTERNAL_EXTRA).size).toBe(EQUIP_INTERNAL_EXTRA.length);
    expect(lcSet(MOBIL_PUBLIC_FIELDS).size).toBe(MOBIL_PUBLIC_FIELDS.length);
    expect(lcSet(MOBIL_INTERNAL_EXTRA).size).toBe(MOBIL_INTERNAL_EXTRA.length);
    expect(lcSet(TRAVAUX_INTERNAL_FIELDS).size).toBe(TRAVAUX_INTERNAL_FIELDS.length);
  });
});

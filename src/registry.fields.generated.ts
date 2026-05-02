/**
 * Surcharges de champs par couche, alignées sur le schéma ArcGIS réel
 * (récupéré via `f=pjson`).
 *
 * Fichier **généré** par `scripts/sync-registry-from-arcgis.ts`.
 * Ne pas éditer à la main : lancer `npm run sync:registry` pour régénérer.
 *
 * Si une couche est absente de cet objet, le registre retombe sur les
 * listes génériques par service (`EQUIP_PUBLIC_FIELDS` / `MOBIL_PUBLIC_FIELDS`).
 */
export type LayerFieldsOverride = {
  /** Champs ArcGIS exposés en mode public (sous-ensemble validé contre `f=pjson`). */
  publicFields: string[];
  /** Champs supplémentaires uniquement disponibles en mode internal. */
  internalExtraFields: string[];
  /** Date ISO du `f=pjson` ayant servi à générer cette entrée. */
  arcgisGeneratedAt: string;
};

/** Synchronisé le 2026-05-02T15:42:14.415Z. */
export const LAYER_FIELDS_OVERRIDES: Record<string, Record<number, LayerFieldsOverride>> = {
  "equipements": {
    0: {
      publicFields: ["objectid","adresse","telephone","categorie","sous_categorie","accessibilite"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:12.715Z",
    },
    1: {
      publicFields: ["objectid","nom","statut","adresse","telephone","commune","horaires","categorie","sous_categorie","accessibilite"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:12.840Z",
    },
    2: {
      publicFields: ["objectid","nom","adresse","telephone","commune","horaire","categorie","sous_categorie","accessibilite"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:12.890Z",
    },
    3: {
      publicFields: ["objectid","nom","adresse","commune","categorie","statut","horaire","telephone","sous_categorie","accessibilite"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:12.947Z",
    },
    4: {
      publicFields: ["objectid","nom","adresse","commune","telephone","horaires","categorie","sous_categorie","accessibilite"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:13.014Z",
    },
    5: {
      publicFields: ["objectid","denomination","ouvert","adresse","commune","pmr","horaire","telephone","categorie","sous_categorie","accessibilite"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:13.086Z",
    },
    6: {
      publicFields: ["objectid","nom","adresse","telephone","commune","horaire","categorie","sous_categorie","accessibilite"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:13.144Z",
    },
    7: {
      publicFields: ["objectid","nom","adresse","horaire","telephone","categorie","sous_categorie","accessibilite"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:13.199Z",
    },
    8: {
      publicFields: ["objectid","adresse","horaire","telephone","categorie","sous_categorie","accessibilite"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:13.257Z",
    },
    9: {
      publicFields: ["objectid","adresse","commune"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:13.324Z",
    },
    10: {
      publicFields: ["objectid","adresse","horaire","telephone","categorie","sous_categorie","accessibilite"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:13.380Z",
    },
  },
  "mobilite": {
    1: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:14.105Z",
    },
    2: {
      publicFields: ["objectid","nom","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:13.489Z",
    },
    3: {
      publicFields: ["objectid","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:13.540Z",
    },
    4: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:13.589Z",
    },
    5: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:13.648Z",
    },
    6: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:13.690Z",
    },
    7: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:13.765Z",
    },
    8: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:13.811Z",
    },
    9: {
      publicFields: ["objectid","site","adresse","commune","nb_place","nb_borne","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:13.898Z",
    },
    10: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:13.969Z",
    },
    11: {
      publicFields: ["objectid","nom","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:14.040Z",
    },
    12: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:14.216Z",
    },
    13: {
      publicFields: ["objectid","nb_place","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:14.165Z",
    },
    14: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:14.328Z",
    },
    15: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:14.273Z",
    },
    16: {
      publicFields: ["objectid","nom","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-02T15:42:13.445Z",
    },
  },
  "travaux": {
    3: {
      publicFields: [],
      internalExtraFields: ["objectid","ac_odp_ref","ac_num","ac_date_debut","ac_date_fin","controle_resultat","titre","adresse","commune_deleguee","description"],
      arcgisGeneratedAt: "2026-05-02T15:42:14.415Z",
    },
  },
};

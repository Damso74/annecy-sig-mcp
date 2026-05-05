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

/** Synchronisé le 2026-05-05T10:39:38.023Z. */
export const LAYER_FIELDS_OVERRIDES: Record<string, Record<number, LayerFieldsOverride>> = {
  "equipements": {
    0: {
      publicFields: ["objectid","adresse","telephone","categorie","sous_categorie","accessibilite"],
      internalExtraFields: ["titre","nom_du_sit","mail","jours_et_h","descriptio","commune_deleguee"],
      arcgisGeneratedAt: "2026-05-05T10:39:37.824Z",
    },
    1: {
      publicFields: ["objectid","nom","statut","adresse","telephone","commune","horaires","categorie","sous_categorie","accessibilite"],
      internalExtraFields: ["niveau","courriel_etab","commune_deleguee"],
      arcgisGeneratedAt: "2026-05-05T10:39:37.833Z",
    },
    2: {
      publicFields: ["objectid","nom","adresse","telephone","commune","horaire","categorie","sous_categorie","accessibilite"],
      internalExtraFields: ["nature"],
      arcgisGeneratedAt: "2026-05-05T10:39:37.841Z",
    },
    3: {
      publicFields: ["objectid","nom","adresse","commune","categorie","statut","horaire","telephone","sous_categorie","accessibilite"],
      internalExtraFields: ["commentaire"],
      arcgisGeneratedAt: "2026-05-05T10:39:37.851Z",
    },
    4: {
      publicFields: ["objectid","nom","adresse","commune","telephone","horaires","categorie","sous_categorie","accessibilite"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-05T10:39:37.859Z",
    },
    5: {
      publicFields: ["objectid","denomination","ouvert","adresse","commune","pmr","horaire","telephone","categorie","sous_categorie","accessibilite"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-05T10:39:37.871Z",
    },
    6: {
      publicFields: ["objectid","nom","adresse","telephone","commune","horaire","categorie","sous_categorie","accessibilite"],
      internalExtraFields: ["type","internet"],
      arcgisGeneratedAt: "2026-05-05T10:39:37.879Z",
    },
    7: {
      publicFields: ["objectid","nom","adresse","horaire","telephone","categorie","sous_categorie","accessibilite"],
      internalExtraFields: ["commune_deleguee"],
      arcgisGeneratedAt: "2026-05-05T10:39:37.886Z",
    },
    8: {
      publicFields: ["objectid","adresse","horaire","telephone","categorie","sous_categorie","accessibilite"],
      internalExtraFields: ["nom_verger","type","commune_deleguee","public"],
      arcgisGeneratedAt: "2026-05-05T10:39:37.894Z",
    },
    9: {
      publicFields: ["objectid","adresse","commune"],
      internalExtraFields: ["nom_site","equipement","nombre","direction","gestionnaire","acces","utilisateurs","date_maj","mobilier"],
      arcgisGeneratedAt: "2026-05-05T10:39:37.901Z",
    },
    10: {
      publicFields: ["objectid","adresse","horaire","telephone","categorie","sous_categorie","accessibilite"],
      internalExtraFields: ["nom_salle","commune_dele"],
      arcgisGeneratedAt: "2026-05-05T10:39:37.909Z",
    },
  },
  "mobilite": {
    1: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-05T10:39:37.992Z",
    },
    2: {
      publicFields: ["objectid","nom","adresse","description","categorie","sous_categorie"],
      internalExtraFields: ["nb_places"],
      arcgisGeneratedAt: "2026-05-05T10:39:37.928Z",
    },
    3: {
      publicFields: ["objectid","adresse","description","categorie","sous_categorie"],
      internalExtraFields: ["name","station","nom_court"],
      arcgisGeneratedAt: "2026-05-05T10:39:37.934Z",
    },
    4: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-05T10:39:37.941Z",
    },
    5: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-05T10:39:37.947Z",
    },
    6: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-05T10:39:37.953Z",
    },
    7: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-05T10:39:37.960Z",
    },
    8: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-05T10:39:37.967Z",
    },
    9: {
      publicFields: ["objectid","site","adresse","commune","nb_place","nb_borne","description","categorie","sous_categorie"],
      internalExtraFields: ["domestique","type2","type3","chademo","comboccs"],
      arcgisGeneratedAt: "2026-05-05T10:39:37.974Z",
    },
    10: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: ["nb_places"],
      arcgisGeneratedAt: "2026-05-05T10:39:37.979Z",
    },
    11: {
      publicFields: ["objectid","nom","adresse","description","categorie","sous_categorie"],
      internalExtraFields: ["nb_places"],
      arcgisGeneratedAt: "2026-05-05T10:39:37.986Z",
    },
    12: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-05T10:39:38.005Z",
    },
    13: {
      publicFields: ["objectid","nb_place","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: ["duree_actuel"],
      arcgisGeneratedAt: "2026-05-05T10:39:37.999Z",
    },
    14: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-05T10:39:38.017Z",
    },
    15: {
      publicFields: ["objectid","titre","adresse","description","categorie","sous_categorie"],
      internalExtraFields: [],
      arcgisGeneratedAt: "2026-05-05T10:39:38.011Z",
    },
    16: {
      publicFields: ["objectid","nom","adresse","description","categorie","sous_categorie"],
      internalExtraFields: ["acces","places"],
      arcgisGeneratedAt: "2026-05-05T10:39:37.921Z",
    },
  },
  "travaux": {
    3: {
      publicFields: [],
      internalExtraFields: ["objectid","ac_odp_ref","ac_num","ac_date_debut","ac_date_fin","controle_resultat","titre","adresse","commune_deleguee","description"],
      arcgisGeneratedAt: "2026-05-05T10:39:38.023Z",
    },
  },
};

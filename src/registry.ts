import type { SemanticMappingKey } from "./utils/semanticMappings.js";

export type VisibilityMode = "public" | "internal";
export type RiskLevel = "green" | "orange" | "red";

/** Champs ArcGIS réels (noms service) alignés sur un rôle métier pour inventaire / rapports. */
export interface SemanticMappings {
  labelField?: string;
  addressField?: string;
  communeField?: string;
  categoryField?: string;
  subCategoryField?: string;
  statusField?: string;
  openingField?: string;
  accessibilityField?: string;
  pmrField?: string;
  phoneField?: string;
  scheduleField?: string;
  descriptionField?: string;
  capacityField?: string;
  identifierField?: string;
  startDateField?: string;
  endDateField?: string;
  geometryRequired?: boolean;
}

/**
 * V0.8 — profils d’usage déclaratifs par couche.
 *
 * L’idée est de centraliser dans le registre les règles métier par usage
 * (chatbot citoyen, open data, dashboard interne) au lieu de les disperser
 * entre `inventoryUsage`, `recommendOpenData` et `generateChatbotReadinessReport`.
 *
 * Les blocs sont **optionnels** : une couche sans profil n’est jamais
 * surinterprétée par les rapports (ils retombent sur les heuristiques V0.7).
 */
export interface LayerChatbotProfile {
  /** Couche pertinente pour un chatbot citoyen (équivalent V0.7 : présence dans CHATBOT_CITIZEN_LAYERS). */
  citizenRelevant?: boolean;
  /** Géométrie indispensable à une réponse utile (« près de moi »). */
  requiresGeometry?: boolean;
  /** Mappings sémantiques essentiels pour formuler une réponse correcte. */
  requiredSemanticKeys?: SemanticMappingKey[];
  /** Mappings sémantiques utiles mais non bloquants. */
  optionalSemanticKeys?: SemanticMappingKey[];
  /** Règles de prudence à injecter dans le prompt système du chatbot. */
  safeAnswerRules?: string[];
  /** Questions citoyennes typiques visées par cette couche. */
  typicalQuestions?: string[];
}

export type OpenDataPublicationReadinessHint =
  | "publishable_now"
  | "publishable_after_light_cleanup"
  | "requires_business_validation"
  | "requires_legal_review"
  | "do_not_publish";

export interface LayerOpenDataProfile {
  /** Couche candidate à un cycle open data (sinon : exclue par défaut, exemple internal). */
  candidate?: boolean;
  /** Indication par défaut sur la maturité de publication (avant inventaire). */
  publicationReadinessHint?: OpenDataPublicationReadinessHint;
  /** Une publication exige une revue juridique préalable, même si la qualité data est bonne. */
  requiresLegalReview?: boolean;
  /** Une publication exige une validation métier (référentiels, glossaires, statuts). */
  requiresBusinessValidation?: boolean;
  /** Liste de raisons explicites bloquant la publication automatique en VERT. */
  blockingReasons?: string[];
}

export interface LayerDashboardProfile {
  /** Couche utile pour un dashboard interne (pilotage, qualité). */
  relevant?: boolean;
  /** Mappings sémantiques nécessaires pour les KPI du dashboard. */
  requiredSemanticKeys?: SemanticMappingKey[];
  /** Indices d’indicateurs / KPI typiques pour cette couche. */
  kpiHints?: string[];
}

/** Profils d’usage déclaratifs (V0.8). */
export interface LayerUsageProfiles {
  chatbot?: LayerChatbotProfile;
  openData?: LayerOpenDataProfile;
  dashboard?: LayerDashboardProfile;
}

export interface LayerRegistryEntry {
  serviceKey: string;
  servicePath: string;
  layerId: number;
  layerName: string;
  geometryType?: string;
  visibility: VisibilityMode;
  riskLevel: RiskLevel;
  publicFields: string[];
  internalFields: string[];
  aliases?: Record<string, string>;
  description: string;
  useCases: string[];
  semanticMappings?: SemanticMappings;
  /** V0.8 — profils d’usage déclaratifs (optionnels par couche). */
  usageProfiles?: LayerUsageProfiles;
}

const EQUIP_PATH = "FLUX_SITE_INTERNET/EQUIPEMENTS/MapServer";
const MOBIL_PATH = "FLUX_SITE_INTERNET/MOBILITE/MapServer";
const TRVX_PATH = "FLUX_SITE_INTERNET/TRAVAUX/MapServer";

const EQUIP_PUBLIC_FIELDS = [
  "objectid",
  "denomination",
  "ouvert",
  "adresse",
  "commune",
  "pmr",
  "horaire",
  "telephone",
  "categorie",
  "sous_categorie",
  "accessibilite",
] as const;

const EQUIP_INTERNAL_EXTRA = ["globalid"] as const;

const SEM_POI_STANDARD: SemanticMappings = {
  labelField: "denomination",
  addressField: "adresse",
  communeField: "commune",
  categoryField: "categorie",
  subCategoryField: "sous_categorie",
  geometryRequired: true,
};

const SEM_WC: SemanticMappings = {
  ...SEM_POI_STANDARD,
  openingField: "ouvert",
  pmrField: "pmr",
  scheduleField: "horaire",
  phoneField: "telephone",
  accessibilityField: "accessibilite",
  geometryRequired: true,
};

const SEM_SCHOOL: SemanticMappings = {
  labelField: "denomination",
  addressField: "adresse",
  communeField: "commune",
  categoryField: "categorie",
  geometryRequired: true,
};

const SEM_CULTURE_SPORT: SemanticMappings = {
  labelField: "denomination",
  addressField: "adresse",
  communeField: "commune",
  categoryField: "categorie",
  subCategoryField: "sous_categorie",
  geometryRequired: true,
};

function equipLayer(
  id: number,
  name: string,
  opts: Partial<
    Pick<
      LayerRegistryEntry,
      "geometryType" | "riskLevel" | "description" | "useCases" | "semanticMappings" | "usageProfiles"
    >
  >,
): LayerRegistryEntry {
  return {
    serviceKey: "equipements",
    servicePath: EQUIP_PATH,
    layerId: id,
    layerName: name,
    geometryType: opts.geometryType ?? "esriGeometryPoint",
    visibility: "public",
    riskLevel: opts.riskLevel ?? "green",
    publicFields: [...EQUIP_PUBLIC_FIELDS],
    internalFields: [...EQUIP_PUBLIC_FIELDS, ...EQUIP_INTERNAL_EXTRA],
    description: opts.description ?? `Couche équipements : ${name}.`,
    useCases:
      opts.useCases ?? [
        "Cartographie citoyenne des équipements.",
        "Recherche d’accessibilité (PMR, horaires).",
      ],
    semanticMappings: opts.semanticMappings,
    usageProfiles: opts.usageProfiles,
  };
}

const MOBIL_PUBLIC_FIELDS = [
  "objectid",
  "denomination",
  "nom",
  "adresse",
  "commune",
  "categorie",
  "sous_categorie",
  "description",
  "capacite",
  "observations",
  "statut",
  "type_stationnement",
  "zone",
  "numero",
] as const;

const MOBIL_INTERNAL_EXTRA = ["globalid", "identifiant"] as const;

const SEM_MOBIL_STANDARD: SemanticMappings = {
  labelField: "denomination",
  addressField: "adresse",
  communeField: "commune",
  categoryField: "categorie",
  identifierField: "nom",
  geometryRequired: true,
};

const SEM_MOBIL_GEO_HEAVY: SemanticMappings = {
  ...SEM_MOBIL_STANDARD,
  subCategoryField: "sous_categorie",
  statusField: "statut",
  geometryRequired: true,
};

function mobilLayer(
  id: number,
  name: string,
  visibility: VisibilityMode,
  risk: RiskLevel,
  extra?: Partial<
    Pick<
      LayerRegistryEntry,
      "geometryType" | "description" | "useCases" | "semanticMappings" | "usageProfiles"
    >
  >,
): LayerRegistryEntry {
  return {
    serviceKey: "mobilite",
    servicePath: MOBIL_PATH,
    layerId: id,
    layerName: name,
    geometryType: extra?.geometryType ?? "esriGeometryPoint",
    visibility,
    riskLevel: risk,
    publicFields: [...MOBIL_PUBLIC_FIELDS],
    internalFields: [...MOBIL_PUBLIC_FIELDS, ...MOBIL_INTERNAL_EXTRA],
    description: extra?.description ?? `Couche mobilité / stationnement : ${name}.`,
    useCases: extra?.useCases ?? ["Stationnement, vélos, bornes, zones réglementées."],
    semanticMappings: extra?.semanticMappings,
    usageProfiles: extra?.usageProfiles,
  };
}

/** V0.8 — profils d’usage réutilisables pour limiter le bruit dans les déclarations couches. */
const PROFILE_CITIZEN_POI: LayerUsageProfiles = {
  chatbot: {
    citizenRelevant: true,
    requiresGeometry: true,
    requiredSemanticKeys: ["labelField", "addressField", "communeField"],
    safeAnswerRules: [
      "Ne répondre qu’à partir des champs effectivement renseignés sur l’entité retournée.",
    ],
  },
  openData: { candidate: true, publicationReadinessHint: "publishable_after_light_cleanup" },
};

const PROFILE_CITIZEN_WC: LayerUsageProfiles = {
  chatbot: {
    citizenRelevant: true,
    requiresGeometry: true,
    requiredSemanticKeys: ["labelField", "addressField", "communeField"],
    optionalSemanticKeys: ["openingField", "pmrField", "scheduleField", "accessibilityField"],
    safeAnswerRules: [
      "Si l’horaire n’est pas dans les données, préciser que les horaires ne sont pas garantis par le chatbot.",
      "Pour PMR / accessibilité : ne jamais inventer une information manquante, recommander la vérification sur le site officiel.",
    ],
    typicalQuestions: [
      "Où sont les toilettes PMR près de moi ?",
      "Quels WC publics sont ouverts maintenant ?",
    ],
  },
  openData: { candidate: true, publicationReadinessHint: "publishable_after_light_cleanup" },
};

const PROFILE_CITIZEN_SCHOOL: LayerUsageProfiles = {
  chatbot: {
    citizenRelevant: true,
    requiresGeometry: true,
    requiredSemanticKeys: ["labelField", "addressField", "communeField"],
    safeAnswerRules: [
      "Ne pas extrapoler la sectorisation scolaire à partir des coordonnées seules.",
    ],
  },
  openData: { candidate: true, publicationReadinessHint: "publishable_after_light_cleanup" },
};

const PROFILE_CITIZEN_CULTURE_SPORT: LayerUsageProfiles = {
  chatbot: {
    citizenRelevant: true,
    requiresGeometry: true,
    requiredSemanticKeys: ["labelField", "categoryField"],
    optionalSemanticKeys: ["addressField", "communeField"],
  },
  openData: { candidate: true, publicationReadinessHint: "publishable_after_light_cleanup" },
};

const PROFILE_CITIZEN_MOBIL_GEO: LayerUsageProfiles = {
  chatbot: {
    citizenRelevant: true,
    requiresGeometry: true,
    requiredSemanticKeys: ["labelField"],
    optionalSemanticKeys: ["categoryField", "capacityField"],
    safeAnswerRules: [
      "Ne pas inférer la disponibilité instantanée d’une place à partir de la seule présence d’un point.",
    ],
  },
  openData: { candidate: true, publicationReadinessHint: "publishable_after_light_cleanup" },
};

const PROFILE_OPEN_DATA_GENERIC: LayerUsageProfiles = {
  openData: { candidate: true, publicationReadinessHint: "publishable_after_light_cleanup" },
};

const PROFILE_INTERNAL_ONLY: LayerUsageProfiles = {
  openData: {
    candidate: false,
    publicationReadinessHint: "do_not_publish",
    blockingReasons: ["Couche internal-only — hors périmètre open data grand public."],
  },
  chatbot: { citizenRelevant: false },
};

const PROFILE_TRAVAUX: LayerUsageProfiles = {
  openData: {
    candidate: false,
    publicationReadinessHint: "requires_legal_review",
    requiresLegalReview: true,
    requiresBusinessValidation: true,
    blockingReasons: [
      "Données travaux : pièces jointes (url_pj) à exclure ; périmètre juridique à arbitrer avant toute diffusion grand public.",
    ],
  },
  chatbot: { citizenRelevant: false },
  dashboard: {
    relevant: true,
    requiredSemanticKeys: ["labelField", "addressField", "startDateField", "endDateField", "statusField"],
    kpiHints: [
      "Taux de couverture géométrique des travaux actifs.",
      "Délai moyen entre début et fin d’autorisation.",
      "Nombre de retards (hors délai) par mois.",
    ],
  },
};

export const LAYER_REGISTRY: LayerRegistryEntry[] = [
  equipLayer(0, "Administration", {
    description: "Services administratifs et guichets associés.",
    useCases: ["Localiser des services administratifs de proximité."],
    semanticMappings: SEM_POI_STANDARD,
    usageProfiles: PROFILE_CITIZEN_POI,
  }),
  equipLayer(1, "Etablissements scolaires", {
    description: "Écoles, collèges, structures scolaires publiées.",
    useCases: ["Carte scolaire grand public.", "Calcul d’itinéraires familles."],
    semanticMappings: SEM_SCHOOL,
    usageProfiles: PROFILE_CITIZEN_SCHOOL,
  }),
  equipLayer(2, "Accueils petite enfance", {
    description: "Crèches, haltes-garderies, accueils du jeune enfant.",
    semanticMappings: SEM_SCHOOL,
    usageProfiles: PROFILE_CITIZEN_SCHOOL,
  }),
  equipLayer(3, "Équipements sénior", {
    description: "Clubs, animations et lieux dédiés aux seniors.",
    semanticMappings: SEM_POI_STANDARD,
    usageProfiles: PROFILE_OPEN_DATA_GENERIC,
  }),
  equipLayer(4, "Cimetière", {
    description: "Cimetières et sites funéraires municipaux.",
    riskLevel: "orange",
    semanticMappings: SEM_POI_STANDARD,
    usageProfiles: {
      openData: { candidate: true, publicationReadinessHint: "requires_business_validation" },
    },
  }),
  equipLayer(5, "WC publics", {
    description: "Toilettes publiques, accessibilité PMR, horaires.",
    useCases: ["Itinéraires touristiques et besoins d’accessibilité.", "Carte des sanitaires ouverts."],
    semanticMappings: SEM_WC,
    usageProfiles: PROFILE_CITIZEN_WC,
  }),
  equipLayer(6, "Équipements culturels", {
    description: "Lieux culturels municipaux ou partenaires.",
    semanticMappings: SEM_CULTURE_SPORT,
    usageProfiles: PROFILE_CITIZEN_CULTURE_SPORT,
  }),
  equipLayer(7, "Jardins partagés", {
    description: "Parcelles et jardins collectifs.",
    semanticMappings: SEM_POI_STANDARD,
    usageProfiles: PROFILE_OPEN_DATA_GENERIC,
  }),
  equipLayer(8, "Vergers communaux", {
    description: "Vergers et espaces fruitiers communaux.",
    semanticMappings: SEM_POI_STANDARD,
    usageProfiles: PROFILE_OPEN_DATA_GENERIC,
  }),
  equipLayer(9, "Équipements sport", {
    description: "Infrastructures sportives municipales.",
    semanticMappings: SEM_CULTURE_SPORT,
    usageProfiles: PROFILE_CITIZEN_CULTURE_SPORT,
  }),
  equipLayer(10, "Salles municipales", {
    description: "Salles polyvalentes et espaces associatifs.",
    semanticMappings: SEM_POI_STANDARD,
    usageProfiles: PROFILE_OPEN_DATA_GENERIC,
  }),

  mobilLayer(16, "Annecy Parking", "public", "green", {
    semanticMappings: SEM_MOBIL_GEO_HEAVY,
    usageProfiles: PROFILE_CITIZEN_MOBIL_GEO,
  }),
  mobilLayer(2, "Parking relais", "public", "green", {
    semanticMappings: SEM_MOBIL_GEO_HEAVY,
    usageProfiles: PROFILE_CITIZEN_MOBIL_GEO,
  }),
  mobilLayer(3, "Stations vélonecy", "public", "green", {
    semanticMappings: SEM_MOBIL_GEO_HEAVY,
    usageProfiles: PROFILE_CITIZEN_MOBIL_GEO,
  }),
  mobilLayer(
    4,
    "Parking convoyeurs de fond",
    "internal",
    "orange",
    {
      description:
        "Stationnement convoyeur / fond de parking : périmètre à risque opérationnel, réservé au mode internal.",
      useCases: ["Pilotage interne stationnement.", "Ne pas exposer en chatbot grand public sans revue."],
      semanticMappings: { ...SEM_MOBIL_GEO_HEAVY, geometryRequired: true },
      usageProfiles: PROFILE_INTERNAL_ONLY,
    },
  ),
  mobilLayer(5, "Places hotel", "public", "green", {
    semanticMappings: SEM_MOBIL_STANDARD,
    usageProfiles: PROFILE_OPEN_DATA_GENERIC,
  }),
  mobilLayer(6, "Places livraison", "public", "green", {
    semanticMappings: SEM_MOBIL_STANDARD,
    usageProfiles: PROFILE_OPEN_DATA_GENERIC,
  }),
  mobilLayer(7, "Parking moto", "public", "green", {
    semanticMappings: SEM_MOBIL_GEO_HEAVY,
    usageProfiles: PROFILE_OPEN_DATA_GENERIC,
  }),
  mobilLayer(8, "Places PMR", "public", "green", {
    semanticMappings: SEM_MOBIL_GEO_HEAVY,
    usageProfiles: PROFILE_CITIZEN_MOBIL_GEO,
  }),
  mobilLayer(9, "Borne de recharge véhicules electriques", "public", "green", {
    semanticMappings: { ...SEM_MOBIL_GEO_HEAVY, descriptionField: "description" },
    usageProfiles: PROFILE_CITIZEN_MOBIL_GEO,
  }),
  mobilLayer(10, "Stationnement velos", "public", "green", {
    semanticMappings: { ...SEM_MOBIL_GEO_HEAVY, capacityField: "capacite" },
    usageProfiles: PROFILE_CITIZEN_MOBIL_GEO,
  }),
  mobilLayer(11, "Stationnements hors parking en ouvrage", "public", "orange", {
    semanticMappings: SEM_MOBIL_GEO_HEAVY,
    usageProfiles: {
      openData: { candidate: true, publicationReadinessHint: "requires_business_validation" },
    },
  }),
  mobilLayer(1, "Horodateurs", "public", "green", {
    semanticMappings: SEM_MOBIL_STANDARD,
    usageProfiles: PROFILE_OPEN_DATA_GENERIC,
  }),
  mobilLayer(13, "Stationnement zone bleue", "public", "green", {
    semanticMappings: SEM_MOBIL_GEO_HEAVY,
    usageProfiles: PROFILE_OPEN_DATA_GENERIC,
  }),
  mobilLayer(12, "Stationnement horodateurs zones longue durée", "public", "green", {
    semanticMappings: SEM_MOBIL_GEO_HEAVY,
    usageProfiles: PROFILE_OPEN_DATA_GENERIC,
  }),
  mobilLayer(15, "Stationnement horodateurs zones courtes durée", "public", "green", {
    semanticMappings: SEM_MOBIL_GEO_HEAVY,
    usageProfiles: PROFILE_OPEN_DATA_GENERIC,
  }),
  mobilLayer(14, "Stationnement horodateurs bords de lac été", "public", "green", {
    semanticMappings: SEM_MOBIL_GEO_HEAVY,
    usageProfiles: PROFILE_OPEN_DATA_GENERIC,
  }),

  {
    serviceKey: "travaux",
    servicePath: TRVX_PATH,
    layerId: 3,
    layerName: "Travaux",
    geometryType: "esriGeometryPolygon",
    visibility: "internal",
    riskLevel: "orange",
    publicFields: [],
    internalFields: [
      "objectid",
      "ac_odp_ref",
      "ac_num",
      "ac_date_debut",
      "ac_date_fin",
      "controle_resultat",
      "titre",
      "adresse",
      "commune_deleguee",
      "description",
      "url_pj",
    ],
    aliases: {
      ac_num: "numero_arrete",
      ac_date_debut: "date_debut_iso",
      ac_date_fin: "date_fin_iso",
      controle_resultat: "statut_interne",
      commune_deleguee: "commune_deleguee",
      url_pj: "url_piece_jointe",
    },
    semanticMappings: {
      labelField: "titre",
      identifierField: "ac_num",
      addressField: "adresse",
      communeField: "commune_deleguee",
      startDateField: "ac_date_debut",
      endDateField: "ac_date_fin",
      statusField: "controle_resultat",
      descriptionField: "description",
      geometryRequired: true,
    },
    description:
      "Autorisations / chantiers : statuts métiers, arrêtés, pièces jointes — réservé mode internal par défaut.",
    useCases: [
      "Suivi DGS / coordination voirie.",
      "Contrôle qualité des dates et statuts.",
      "Ne pas diffuser sur canal grand public sans filtrage métier.",
    ],
    usageProfiles: PROFILE_TRAVAUX,
  },
];

/** Fallback inventaire (lisibilité / dates) par service — complété par `semanticMappings` quand possible. */
export const SERVICE_INVENTORY_DEFAULTS: Record<string, { readableKeys: string[]; dateKeys: string[] }> = {
  equipements: { readableKeys: ["denomination", "adresse", "categorie"], dateKeys: ["horaire"] },
  mobilite: { readableKeys: ["denomination", "nom", "adresse", "categorie"], dateKeys: ["horaire"] },
  travaux: { readableKeys: ["titre", "ac_num", "adresse"], dateKeys: ["ac_date_debut", "ac_date_fin"] },
};

/** Clés sémantiques essentielles (mapping vs qualité data) — piloté par registre. */
export function getSemanticEssentialKeys(entry: LayerRegistryEntry): SemanticMappingKey[] {
  if (!entry.semanticMappings) return [];
  if (entry.serviceKey === "equipements" && entry.layerId === 5) {
    return ["labelField", "addressField", "communeField"];
  }
  if (entry.serviceKey === "equipements" && [0, 1, 2, 3, 4, 7, 8, 10].includes(entry.layerId)) {
    return ["labelField", "addressField", "communeField"];
  }
  if (entry.serviceKey === "equipements" && [6, 9].includes(entry.layerId)) {
    return ["labelField", "categoryField"];
  }
  if (entry.serviceKey === "mobilite") {
    return ["labelField"];
  }
  if (entry.serviceKey === "travaux") {
    return ["labelField", "addressField"];
  }
  return ["labelField"];
}

/** Étiquettes lisibles affichées dans le rapport chatbot — alignées sur les anciens labels V0.7. */
const CHATBOT_LAYER_LABELS: Record<string, string> = {
  "equipements:5": "WC publics",
  "equipements:0": "Administration / équipements",
  "equipements:9": "Équipements sport",
  "equipements:6": "Équipements culturels",
  "equipements:1": "Établissements scolaires",
  "equipements:2": "Accueils petite enfance",
  "mobilite:8": "Places PMR",
  "mobilite:9": "Bornes recharge véhicules électriques",
  "mobilite:10": "Stationnement vélos",
  "mobilite:16": "Annecy Parking",
  "mobilite:2": "Parking relais",
};

export type ChatbotCitizenLayerRef = { serviceKey: string; layerId: number; label: string };

/**
 * Couches « chatbot citoyen » — V0.8 : dérivé déclarativement du registre via
 * `usageProfiles.chatbot.citizenRelevant`. L’ordre est l’ordre de déclaration dans
 * `LAYER_REGISTRY`, et les `label` historiques sont conservés pour compatibilité.
 *
 * Pour ajouter une couche au périmètre chatbot, il suffit désormais d’ajouter
 * `usageProfiles: { chatbot: { citizenRelevant: true } }` dans `LAYER_REGISTRY`
 * — sans toucher à cette liste.
 */
export const CHATBOT_CITIZEN_LAYERS: readonly ChatbotCitizenLayerRef[] = LAYER_REGISTRY
  .filter(e => e.usageProfiles?.chatbot?.citizenRelevant === true)
  .map(e => ({
    serviceKey: e.serviceKey,
    layerId: e.layerId,
    label: CHATBOT_LAYER_LABELS[`${e.serviceKey}:${e.layerId}`] ?? e.layerName,
  }));

/** V0.8 — accès direct au profil chatbot d’une couche (ou undefined). */
export function getChatbotProfile(entry: LayerRegistryEntry): LayerChatbotProfile | undefined {
  return entry.usageProfiles?.chatbot;
}

/** V0.8 — accès direct au profil open data d’une couche (ou undefined). */
export function getOpenDataProfile(entry: LayerRegistryEntry): LayerOpenDataProfile | undefined {
  return entry.usageProfiles?.openData;
}

/** V0.8 — accès direct au profil dashboard d’une couche (ou undefined). */
export function getDashboardProfile(entry: LayerRegistryEntry): LayerDashboardProfile | undefined {
  return entry.usageProfiles?.dashboard;
}

export type ChatbotReportFamily =
  | "wc"
  | "school"
  | "petite"
  | "culture_sport"
  | "mobil_geo"
  | "other";

export function chatbotReportFamily(serviceKey: string, layerId: number): ChatbotReportFamily {
  if (serviceKey === "equipements" && layerId === 5) return "wc";
  if (serviceKey === "equipements" && layerId === 1) return "school";
  if (serviceKey === "equipements" && layerId === 2) return "petite";
  if (serviceKey === "equipements" && (layerId === 6 || layerId === 9)) return "culture_sport";
  if (serviceKey === "mobilite" && [2, 8, 9, 10, 16].includes(layerId)) return "mobil_geo";
  return "other";
}

export const SERVICE_REGISTRY = [
  {
    serviceKey: "equipements",
    servicePath: EQUIP_PATH,
    title: "Équipements",
    description: "Équipements et services de proximité (scolaire, culture, sanitaires, etc.).",
    defaultVisibility: "public" as const,
    defaultRisk: "green" as const,
  },
  {
    serviceKey: "mobilite",
    servicePath: MOBIL_PATH,
    title: "Mobilité & stationnement",
    description: "Parkings, vélos, bornes, zones de stationnement réglementées.",
    defaultVisibility: "public" as const,
    defaultRisk: "green" as const,
  },
  {
    serviceKey: "travaux",
    servicePath: TRVX_PATH,
    title: "Travaux",
    description:
      "Travaux et autorisations : couche brute réservée au mode internal. Sur le MCP public HTTP, consultation citoyenne uniquement via les outils list_public_works et search_public_works_nearby (vue filtrée).",
    defaultVisibility: "internal" as const,
    defaultRisk: "orange" as const,
  },
] as const;

export function isServiceKeyAllowed(key: string): boolean {
  return SERVICE_REGISTRY.some(s => s.serviceKey === key);
}

export function getLayerEntry(serviceKey: string, layerId: number): LayerRegistryEntry | undefined {
  return LAYER_REGISTRY.find(e => e.serviceKey === serviceKey && e.layerId === layerId);
}

export function listLayerEntriesForService(serviceKey: string): LayerRegistryEntry[] {
  return LAYER_REGISTRY.filter(e => e.serviceKey === serviceKey);
}

export function layersVisibleInMode(
  entries: LayerRegistryEntry[],
  mode: VisibilityMode,
): LayerRegistryEntry[] {
  if (mode === "internal") return entries;
  return entries.filter(e => e.visibility === "public");
}

export function getServiceMeta(serviceKey: string): (typeof SERVICE_REGISTRY)[number] | undefined {
  return SERVICE_REGISTRY.find(s => s.serviceKey === serviceKey);
}

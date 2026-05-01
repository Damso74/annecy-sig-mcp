import { z } from "zod";
import {
  PublicWorksSchemaVersionLiteral,
  ServerVersionSchema,
  VisibilityModeSchema,
} from "./common.js";

/**
 * Contrats Zod pour la vue **travaux public-light** (V1.0).
 *
 * Principe absolu :
 * - aucun champ technique brut (`ac_odp_ref`, `url_pj`, `description` brute,
 *   `created_user`, `last_edited_*`) ne peut transiter par ce contrat ;
 * - les champs autorisés sont **explicitement allowlistés** (`PublicWorkItemSchema`) ;
 * - le bloc `source` porte un drapeau `rawLayerExposed=false` qui constitue la
 *   garantie machine-vérifiable que la couche brute n’est jamais retournée
 *   telle quelle au client.
 *
 * Ces schémas sont volontairement `strict()` : un champ inattendu fait sortir
 * l’appel en erreur au lieu d’être silencieusement renvoyé. C’est ce qui permet
 * au test `tests/v1.0.publicWorks.test.ts` de garantir l’absence de fuite.
 */

const NullableNonEmptyString = z.string().min(1).nullable();

export const PublicWorkQualityFlagsSchema = z
  .object({
    missingGeometry: z.boolean().optional(),
    missingAddress: z.boolean().optional(),
    missingTitle: z.boolean().optional(),
    dateIncoherence: z.boolean().optional(),
  })
  .strict()
  .describe(
    "Drapeaux qualité publics — sans révéler de champ technique sensible (uniquement booléens).",
  );

export const PublicWorkItemSchema = z
  .object({
    id_public: z
      .string()
      .min(1)
      .describe("Identifiant opaque public (jamais l’objectid brut tel quel)."),
    titre_public: NullableNonEmptyString.describe(
      "Titre simplifié, sécurisé pour affichage citoyen (ne contient ni numéro d’arrêté brut, ni référence interne).",
    ),
    statut_public: NullableNonEmptyString.describe(
      "Statut simplifié (ex. « En cours », « À venir », « En retard »).",
    ),
    date_debut_iso: z
      .string()
      .nullable()
      .describe("Date de début au format ISO 8601 (ou null si non disponible)."),
    date_fin_iso: z
      .string()
      .nullable()
      .describe("Date de fin au format ISO 8601 (ou null si non disponible)."),
    secteur_public: NullableNonEmptyString.describe(
      "Adresse ou secteur simplifié (jamais inventé) — null si la donnée n’est pas fiable.",
    ),
    commune_deleguee: NullableNonEmptyString.describe(
      "Commune déléguée si présente et non sensible.",
    ),
    geometry: z
      .unknown()
      .optional()
      .describe(
        "Géométrie GeoJSON simplifiée — uniquement si `includeGeometry=true` et que la donnée existe.",
      ),
    qualityFlags: PublicWorkQualityFlagsSchema,
  })
  .strict()
  .describe(
    "Élément travaux public-light — uniquement les champs allowlistés citoyen, jamais la donnée brute.",
  );

export const PublicWorkNearbyItemSchema = PublicWorkItemSchema.extend({
  distance_m: z
    .number()
    .nonnegative()
    .nullable()
    .describe("Distance en mètres au point d’interrogation, null si non calculable."),
})
  .strict()
  .describe("Élément travaux public-light enrichi de la distance Haversine au point requêté.");

const PublicWorksSourceSchema = z
  .object({
    type: z.literal("annecy_sig_mcp_public_works"),
    schemaVersion: PublicWorksSchemaVersionLiteral,
    serverVersion: ServerVersionSchema,
    mode: VisibilityModeSchema,
    filtered: z.literal(true).describe("Toujours `true` : la sortie passe par `normalizePublicWorkFeature`."),
    rawLayerExposed: z
      .literal(false)
      .describe("Toujours `false` : aucune entité brute ArcGIS n’est exposée par cet outil."),
    consultedAt: z.string().describe("Date/heure ISO de consultation côté serveur."),
    disclaimer: z.string().describe("Avertissement à afficher au citoyen."),
  })
  .strict();

const PublicWorksNearbySourceSchema = PublicWorksSourceSchema.extend({
  type: z.literal("annecy_sig_mcp_public_works_nearby"),
}).strict();

export const PublicWorksResultSchema = z
  .object({
    items: z.array(PublicWorkItemSchema),
    count: z.number().int().nonnegative(),
    date: z.string().describe("Date de référence (ISO YYYY-MM-DD) utilisée pour le filtre."),
    warnings: z.array(z.string()),
    source: PublicWorksSourceSchema,
  })
  .strict()
  .describe("Résultat `list_public_works` — contrat `public_works.v1`.");

export const PublicWorksNearbyResultSchema = z
  .object({
    items: z.array(PublicWorkNearbyItemSchema),
    count: z.number().int().nonnegative(),
    radiusMeters: z.number().int().positive(),
    warnings: z.array(z.string()),
    source: PublicWorksNearbySourceSchema,
  })
  .strict()
  .describe("Résultat `search_public_works_nearby` — contrat `public_works.v1`.");

export type PublicWorkItem = z.infer<typeof PublicWorkItemSchema>;
export type PublicWorkNearbyItem = z.infer<typeof PublicWorkNearbyItemSchema>;
export type PublicWorksResult = z.infer<typeof PublicWorksResultSchema>;
export type PublicWorksNearbyResult = z.infer<typeof PublicWorksNearbyResultSchema>;

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ArcgisHttpClient } from "../../src/arcgis/httpClient.js";
import {
  clearArcgisHttpCache,
  setArcgisHttpClient,
} from "../../src/arcgis/httpClient.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(here, "..", "fixtures", "arcgis");

/** Charge une fixture JSON par nom (le suffixe `.json` est optionnel). */
export function loadFixture(name: string): unknown {
  const f = name.endsWith(".json") ? name : `${name}.json`;
  return JSON.parse(readFileSync(join(FIXTURE_DIR, f), "utf8"));
}

export type FixtureMatcher = {
  /** Matcher URL : sous-chaîne (find), regex, ou prédicat. Évalué dans l’ordre déclaré. */
  match: string | RegExp | ((url: string) => boolean);
  /** Fixture à retourner (chemin relatif à `tests/fixtures/arcgis/`). */
  fixture?: string;
  /** Réponse JSON déjà décodée (utile pour count, error inline, etc.). */
  body?: unknown;
  /** Si fourni, jette cette erreur au lieu de retourner un body (simulation panne réseau). */
  throwError?: Error;
  /** Étiquette lisible pour debug. */
  label?: string;
};

export type MockArcgisClient = ArcgisHttpClient & {
  /** Nombre d’appels enregistrés. */
  callCount(): number;
  /** URL appelées dans l’ordre. */
  calls(): readonly string[];
  /** Réinitialise le compteur d’appels. */
  resetCalls(): void;
  /** Ajoute un matcher en tête de liste (priorité maximale). */
  prepend(m: FixtureMatcher): void;
  /** Ajoute un matcher en queue de liste (priorité minimale). */
  append(m: FixtureMatcher): void;
};

function matches(url: string, m: FixtureMatcher): boolean {
  if (typeof m.match === "string") return url.includes(m.match);
  if (m.match instanceof RegExp) return m.match.test(url);
  return m.match(url);
}

/**
 * Client mock ArcGIS hors-ligne :
 * - mappe une URL ou un pattern vers une fixture / un body inline ;
 * - compte les appels ;
 * - jette une erreur claire si aucune fixture n’est associée à l’URL.
 *
 * Par défaut, tout appel non matché échoue : aucun test offline ne doit fuiter une requête réseau.
 */
export function createMockArcgisClient(initial: FixtureMatcher[] = []): MockArcgisClient {
  const matchers: FixtureMatcher[] = [...initial];
  const calls: string[] = [];

  return {
    async getJson(url: string): Promise<unknown> {
      calls.push(url);
      for (const m of matchers) {
        if (!matches(url, m)) continue;
        if (m.throwError) throw m.throwError;
        if (m.fixture !== undefined) return loadFixture(m.fixture);
        if (m.body !== undefined) return m.body;
        throw new Error(
          `mockArcgisClient: matcher "${m.label ?? "<sans label>"}" trouvé pour "${url}" ` +
            "mais ni fixture ni body fourni.",
        );
      }
      throw new Error(
        `mockArcgisClient: aucun matcher pour l’URL "${url}". ` +
          "Ajouter un matcher explicite (fixture ou body) pour ce test.",
      );
    },
    callCount() {
      return calls.length;
    },
    calls() {
      return calls;
    },
    resetCalls() {
      calls.length = 0;
    },
    prepend(m) {
      matchers.unshift(m);
    },
    append(m) {
      matchers.push(m);
    },
  };
}

/**
 * Installe un client mock pour la durée d’un test (à appeler dans `beforeEach`).
 * Retourne le client + une fonction de teardown à appeler dans `afterEach` /
 * `afterAll` pour restaurer le client réseau et purger le cache GET.
 */
export function installMockArcgisClient(matchers: FixtureMatcher[]): {
  client: MockArcgisClient;
  restore: () => void;
} {
  const client = createMockArcgisClient(matchers);
  setArcgisHttpClient(client);
  clearArcgisHttpCache();
  return {
    client,
    restore() {
      setArcgisHttpClient(null);
      clearArcgisHttpCache();
    },
  };
}

/** Helpers de matching ciblés pour tests d’inventaire. */
export function metaMatcher(servicePath: string, layerId: number): (url: string) => boolean {
  return url => url.includes(servicePath) && url.includes(`/${layerId}?`) && !url.includes("/query");
}

export function queryMatcher(servicePath: string, layerId: number): (url: string) => boolean {
  return url => url.includes(servicePath) && url.includes(`/${layerId}/query`);
}

export function countMatcher(servicePath: string, layerId: number): (url: string) => boolean {
  return url =>
    url.includes(servicePath) && url.includes(`/${layerId}/query`) && url.includes("returnCountOnly=true");
}

/**
 * Construit un set de matchers couvrant le périmètre par défaut V0.8 :
 * équipements / WC (5), équipements / Administration (0), mobilité / vélos (10), travaux (3).
 *
 * Couche non listée → fixture `error-failed-query.json` : l’inventaire produit
 * un statut `failed` propre sans planter le run.
 */
export function defaultRegistryMatchers(opts?: {
  /** Force un échantillon vide pour cette couche (au lieu de la fixture standard). */
  emptyForLayer?: { servicePath: string; layerId: number };
  /** Force une erreur ArcGIS sur cette couche (`error-failed-query`). */
  failForLayer?: { servicePath: string; layerId: number };
}): FixtureMatcher[] {
  const m: FixtureMatcher[] = [];
  const EQUIP = "EQUIPEMENTS/MapServer";
  const MOBIL = "MOBILITE/MapServer";
  const TRAVX = "TRAVAUX/MapServer";

  // count first (more specific URL)
  m.push({ match: countMatcher(EQUIP, 5), fixture: "equipements-wc-count.json", label: "wc-count" });
  m.push({
    match: countMatcher(EQUIP, 0),
    fixture: "equipements-admin-count.json",
    label: "admin-count",
  });
  m.push({
    match: countMatcher(MOBIL, 10),
    fixture: "mobilite-stationnement-velos-count.json",
    label: "velo-count",
  });
  m.push({ match: countMatcher(TRAVX, 3), fixture: "travaux-count.json", label: "travaux-count" });

  // metadata
  m.push({
    match: metaMatcher(EQUIP, 5),
    fixture: "equipements-wc-metadata.json",
    label: "wc-meta",
  });
  m.push({
    match: metaMatcher(EQUIP, 0),
    fixture: "equipements-admin-metadata.json",
    label: "admin-meta",
  });
  m.push({
    match: metaMatcher(MOBIL, 10),
    fixture: "mobilite-stationnement-velos-metadata.json",
    label: "velo-meta",
  });
  m.push({ match: metaMatcher(TRAVX, 3), fixture: "travaux-metadata.json", label: "travaux-meta" });

  // sample queries (geojson by default)
  if (opts?.emptyForLayer && opts.emptyForLayer.servicePath === EQUIP && opts.emptyForLayer.layerId === 5) {
    m.push({ match: queryMatcher(EQUIP, 5), fixture: "empty-sample.json", label: "wc-query-empty" });
  } else if (opts?.failForLayer && opts.failForLayer.servicePath === EQUIP && opts.failForLayer.layerId === 5) {
    m.push({ match: queryMatcher(EQUIP, 5), fixture: "error-failed-query.json", label: "wc-query-fail" });
  } else {
    m.push({
      match: queryMatcher(EQUIP, 5),
      fixture: "equipements-wc-query-geojson.json",
      label: "wc-query",
    });
  }

  m.push({
    match: queryMatcher(EQUIP, 0),
    fixture: "equipements-admin-query-geojson.json",
    label: "admin-query",
  });
  m.push({
    match: queryMatcher(MOBIL, 10),
    fixture: "mobilite-stationnement-velos-query-geojson.json",
    label: "velo-query",
  });
  m.push({ match: queryMatcher(TRAVX, 3), fixture: "travaux-query-esri.json", label: "travaux-query" });

  // catch-all fail for any other layer of these services
  m.push({
    match: (url: string) =>
      url.includes("/MapServer/") && (url.includes(EQUIP) || url.includes(MOBIL) || url.includes(TRAVX)),
    fixture: "error-failed-query.json",
    label: "catch-all-fail",
  });

  return m;
}

/**
 * Karttatason valinta ja sen pysyvä tallennus (#59).
 *
 * Linjaus (konsepti 5.5): OpenTopoMap on oletuskarttataso. MML Maastokartta
 * (vain Suomi, vaatii `EXPO_PUBLIC_MML_API_KEY`) ja offline-välimuisti ovat
 * käyttäjän valittavissa. Valinta tallennetaan samalla injektoitavalla
 * tallennusrajapinnalla kuin viimeksi käytetty alue (`AreaStorage`).
 *
 * Puhtaita funktioita; mikään julkinen async-funktio ei heitä poikkeusta.
 * API-avain ei koskaan päädy tallennustiedostoon.
 */
import type { AreaStorage } from './areaPersistence';

export type MapLayerChoice = 'opentopomap' | 'mml-maastokartta' | 'offline';

export const DEFAULT_MAP_LAYER: MapLayerChoice = 'opentopomap';
export const MAP_LAYER_FILE_NAME = 'huntertracker_map_layer.json';
export const MAP_LAYER_PREFERENCE_VERSION = 1;

const ALL_LAYERS: readonly MapLayerChoice[] = ['opentopomap', 'mml-maastokartta', 'offline'];

export const OPENTOPOMAP_ATTRIBUTION = '© OpenTopoMap (CC-BY-SA) · © OpenStreetMap';
export const MML_ATTRIBUTION = '© Maanmittauslaitos (CC BY 4.0)';

export function hasMmlApiKey(apiKey?: string | null): boolean {
  return typeof apiKey === 'string' && apiKey.trim().length > 0;
}

function isMapLayerChoice(v: unknown): v is MapLayerChoice {
  return typeof v === 'string' && (ALL_LAYERS as readonly string[]).includes(v);
}

/** Käytettävissä olevat tasot valintajärjestyksessä. MML vain avaimen kanssa. */
export function getAvailableMapLayers(apiKey?: string | null): MapLayerChoice[] {
  return hasMmlApiKey(apiKey) ? [...ALL_LAYERS] : ['opentopomap', 'offline'];
}

/** Tallennettu tai pyydetty valinta -> käyttökelpoinen taso (oletus OpenTopoMap). */
export function resolveMapLayerChoice(
  stored: string | null | undefined,
  apiKey?: string | null
): MapLayerChoice {
  if (!isMapLayerChoice(stored)) return DEFAULT_MAP_LAYER;
  return getAvailableMapLayers(apiKey).includes(stored) ? stored : DEFAULT_MAP_LAYER;
}

/** Karttatasopainike: seuraava käytettävissä oleva taso kierrossa. */
export function getNextMapLayer(current: MapLayerChoice, apiKey?: string | null): MapLayerChoice {
  const layers = getAvailableMapLayers(apiKey);
  const index = layers.indexOf(resolveMapLayerChoice(current, apiKey));
  return layers[(index + 1) % layers.length];
}

/**
 * Offline-latauksen lähde. OpenTopoMap on vapaaehtoisvoimin ylläpidetty
 * palvelu, jota ei joukkoladata, kun MML on saatavilla. Ilman avainta
 * säilyy aiempi toiminta (OpenTopoMap, latausraja 250 tiiltä / zoom).
 */
export function getOfflineSourceLayer(
  apiKey?: string | null
): Exclude<MapLayerChoice, 'offline'> {
  return hasMmlApiKey(apiKey) ? 'mml-maastokartta' : 'opentopomap';
}

/** Kartalla näytettävä lähdeviite tiililähteen mukaan. */
export function getMapLayerAttribution(sourceLayerId: Exclude<MapLayerChoice, 'offline'>): string {
  return sourceLayerId === 'mml-maastokartta' ? MML_ATTRIBUTION : OPENTOPOMAP_ATTRIBUTION;
}

// ---------------------------------------------------------------------------
// Pysyvä tallennus
// ---------------------------------------------------------------------------

export function buildMapLayerUri(documentDirectory: string): string {
  const dir = documentDirectory.endsWith('/') ? documentDirectory : `${documentDirectory}/`;
  return `${dir}${MAP_LAYER_FILE_NAME}`;
}

export function serializeMapLayerPreference(
  layer: MapLayerChoice,
  savedAt: number = Date.now()
): string {
  return JSON.stringify({ version: MAP_LAYER_PREFERENCE_VERSION, layer, savedAt });
}

/** Palauttaa tallennetun tason tai null, jos tiedosto on tyhjä/vioittunut/tuntematon. */
export function parseMapLayerPreference(text: string): MapLayerChoice | null {
  if (typeof text !== 'string' || text.trim().length === 0) return null;
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.version !== MAP_LAYER_PREFERENCE_VERSION) return null;
  return isMapLayerChoice(raw.layer) ? raw.layer : null;
}

export type SaveMapLayerResult = { ok: true } | { ok: false; error: string };

export async function saveMapLayerPreference(
  storage: AreaStorage,
  documentDirectory: string,
  layer: MapLayerChoice
): Promise<SaveMapLayerResult> {
  try {
    await storage.write(buildMapLayerUri(documentDirectory), serializeMapLayerPreference(layer));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Lukee tallennetun valinnan; virheessä tai puuttuessa oletus (OpenTopoMap). */
export async function loadMapLayerPreference(
  storage: AreaStorage,
  documentDirectory: string,
  apiKey?: string | null
): Promise<MapLayerChoice> {
  try {
    const uri = buildMapLayerUri(documentDirectory);
    if (!(await storage.exists(uri))) return DEFAULT_MAP_LAYER;
    return resolveMapLayerChoice(parseMapLayerPreference(await storage.read(uri)), apiKey);
  } catch {
    return DEFAULT_MAP_LAYER;
  }
}

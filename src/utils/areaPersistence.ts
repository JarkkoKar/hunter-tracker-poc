/**
 * Viimeksi käytetyn jahtialueen ja karttakameran pysyvä tallennus.
 *
 * Puhtaita funktioita: tiedostojärjestelmä injektoidaan (`AreaStorage`), joten
 * kaikki on Jest-testattavissa ilman natiivimoduuleja. App.tsx kytkee
 * `expo-file-system/legacy`-funktiot (documentDirectory + read/write/delete).
 *
 * Mikään julkinen async-funktio ei heitä poikkeusta: käynnistys päätyy aina
 * käyttökelpoiseen alueeseen (viimeksi tallennettu tai Hätilän oletusalue).
 */
import {
  AreaRegion,
  Boundary,
  HuntingArea,
  Stand,
  LatLon,
  calculateAreaCenter,
  getDefaultTestArea,
  getAreaPolygons,
} from './omariistaParser';

export const LAST_AREA_FILE_NAME = 'huntertracker_last_area.json';
export const PERSISTED_AREA_VERSION = 1;

/** Aloitusnäkymä: Hätilä, Hämeenlinna (61.015° N, 24.535° E). */
export const DEFAULT_START_REGION: AreaRegion = Object.freeze({
  latitude: 61.015,
  longitude: 24.535,
  latitudeDelta: 0.045,
  longitudeDelta: 0.07,
}) as AreaRegion;

/** Injektoitava tiedostojärjestelmä. */
export interface AreaStorage {
  exists: (uri: string) => Promise<boolean>;
  read: (uri: string) => Promise<string>;
  write: (uri: string, text: string) => Promise<void>;
  remove: (uri: string) => Promise<void>;
}

/** Se osa `expo-file-system/legacy`-rajapinnasta, jota tallennus tarvitsee. */
export interface LegacyFileSystemLike {
  getInfoAsync: (uri: string) => Promise<{ exists: boolean }>;
  readAsStringAsync: (uri: string, options?: { encoding?: 'utf8' }) => Promise<string>;
  writeAsStringAsync: (uri: string, contents: string, options?: { encoding?: 'utf8' }) => Promise<void>;
  deleteAsync: (uri: string, options?: { idempotent?: boolean }) => Promise<void>;
}

/** Sovitin: `expo-file-system/legacy` -> `AreaStorage` (UTF-8, idempotentti poisto). */
export function createLegacyAreaStorage(fs: LegacyFileSystemLike): AreaStorage {
  return {
    exists: async (uri) => (await fs.getInfoAsync(uri)).exists,
    read: (uri) => fs.readAsStringAsync(uri, { encoding: 'utf8' }),
    write: (uri, text) => fs.writeAsStringAsync(uri, text, { encoding: 'utf8' }),
    remove: (uri) => fs.deleteAsync(uri, { idempotent: true }),
  };
}

export interface PersistedArea {
  version: number;
  name: string;
  area: HuntingArea;
  region: AreaRegion;
  savedAt: number;
}

export type ParsePersistedAreaResult =
  | { ok: true; value: PersistedArea }
  | { ok: false; error: string };

export interface LoadedArea {
  area: HuntingArea;
  region: AreaRegion;
  name: string;
  source: 'saved' | 'default';
  /** Syy oletukseen palaamiselle (vioittunut tiedosto, lukuvirhe). */
  error?: string;
}

export type SaveAreaResult = { ok: true } | { ok: false; error: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function buildLastAreaUri(documentDirectory: string): string {
  const root = documentDirectory.endsWith('/') ? documentDirectory : `${documentDirectory}/`;
  return `${root}${LAST_AREA_FILE_NAME}`;
}

export function getAreaDisplayName(area: HuntingArea): string {
  return area.boundary?.name || getAreaPolygons(area)[0]?.name || 'Nimetön alue';
}

export function getDefaultPersistedArea(): LoadedArea {
  const area = getDefaultTestArea();
  return {
    area,
    region: { ...DEFAULT_START_REGION },
    name: getAreaDisplayName(area),
    source: 'default',
  };
}

// ---------------------------------------------------------------------------
// Validointi
// ---------------------------------------------------------------------------

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isLatLon(v: any): v is LatLon {
  return (
    v != null &&
    isFiniteNumber(v.latitude) &&
    isFiniteNumber(v.longitude) &&
    Math.abs(v.latitude) <= 90 &&
    Math.abs(v.longitude) <= 180
  );
}

function isBoundary(v: any): v is Boundary {
  return (
    v != null &&
    typeof v.name === 'string' &&
    Array.isArray(v.coordinates) &&
    v.coordinates.length >= 3 &&
    v.coordinates.every(isLatLon)
  );
}

function isStand(v: any): v is Stand {
  return v != null && typeof v.id === 'string' && typeof v.name === 'string' && isLatLon(v);
}

export function isValidRegion(v: any): v is AreaRegion {
  return (
    isLatLon(v) &&
    isFiniteNumber((v as any).latitudeDelta) &&
    isFiniteNumber((v as any).longitudeDelta) &&
    (v as any).latitudeDelta > 0 &&
    (v as any).longitudeDelta > 0
  );
}

function validateArea(v: any): string | null {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return 'alue puuttuu';
  if (!Array.isArray(v.stands) || !v.stands.every(isStand)) return 'passilista on virheellinen';
  if (v.boundary !== undefined && !isBoundary(v.boundary)) return 'aluerajaus on virheellinen';
  if (
    v.polygons !== undefined &&
    (!Array.isArray(v.polygons) || !v.polygons.every(isBoundary))
  ) {
    return 'palstat ovat virheellisiä';
  }
  if (v.stands.length === 0 && !v.boundary && !(v.polygons?.length > 0)) {
    return 'alue on tyhjä';
  }
  return null;
}

/** Vain tunnetut kentät mukaan (ei ylimääräistä dataa tiedostosta). */
function cleanArea(v: any): HuntingArea {
  const area: HuntingArea = {
    stands: v.stands.map((s: Stand) => ({
      id: s.id,
      name: s.name,
      latitude: s.latitude,
      longitude: s.longitude,
    })),
  };
  const cleanBoundary = (b: Boundary): Boundary => ({
    name: b.name,
    coordinates: b.coordinates.map((c) => ({ latitude: c.latitude, longitude: c.longitude })),
  });
  if (v.boundary) area.boundary = cleanBoundary(v.boundary);
  if (v.polygons) area.polygons = v.polygons.map(cleanBoundary);
  return area;
}

function regionForArea(area: HuntingArea, region?: AreaRegion | null): AreaRegion {
  if (region && isValidRegion(region)) {
    return {
      latitude: region.latitude,
      longitude: region.longitude,
      latitudeDelta: region.latitudeDelta,
      longitudeDelta: region.longitudeDelta,
    };
  }
  return calculateAreaCenter(area) ?? { ...DEFAULT_START_REGION };
}

// ---------------------------------------------------------------------------
// Sarjallistus
// ---------------------------------------------------------------------------

export function serializePersistedArea(
  area: HuntingArea,
  region?: AreaRegion | null,
  savedAt: number = Date.now()
): string {
  const payload: PersistedArea = {
    version: PERSISTED_AREA_VERSION,
    name: getAreaDisplayName(area),
    area: cleanArea(area),
    region: regionForArea(area, region),
    savedAt,
  };
  return JSON.stringify(payload);
}

/** Jäsentää tallennetun tiedoston. Ei heitä: virheessä `{ ok: false, error }`. */
export function parsePersistedArea(text: string): ParsePersistedAreaResult {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, error: 'Tallennettu aluetiedosto on tyhjä.' };
  }
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Tallennettu aluetiedosto on vioittunut (virheellinen JSON).' };
  }
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Tallennettu aluetiedosto on virheellinen.' };
  }
  if (raw.version !== PERSISTED_AREA_VERSION) {
    return { ok: false, error: `Tuntematon tallennusversio (${String(raw.version)}).` };
  }
  const areaError = validateArea(raw.area);
  if (areaError) {
    return { ok: false, error: `Tallennettu alue on virheellinen: ${areaError}.` };
  }
  const area = cleanArea(raw.area);
  return {
    ok: true,
    value: {
      version: PERSISTED_AREA_VERSION,
      name: typeof raw.name === 'string' && raw.name ? raw.name : getAreaDisplayName(area),
      area,
      region: regionForArea(area, raw.region),
      savedAt: isFiniteNumber(raw.savedAt) ? raw.savedAt : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Tallennus / lataus / nollaus
// ---------------------------------------------------------------------------

export async function saveLastUsedArea(
  storage: AreaStorage,
  documentDirectory: string,
  area: HuntingArea,
  region?: AreaRegion | null
): Promise<SaveAreaResult> {
  const areaError = validateArea(area);
  if (areaError) return { ok: false, error: `Aluetta ei tallennettu: ${areaError}.` };
  try {
    await storage.write(buildLastAreaUri(documentDirectory), serializePersistedArea(area, region));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Alueen tallennus epäonnistui (${errorText(e)})` };
  }
}

export async function loadLastUsedArea(
  storage: AreaStorage,
  documentDirectory: string
): Promise<LoadedArea> {
  const uri = buildLastAreaUri(documentDirectory);
  try {
    if (!(await storage.exists(uri))) return getDefaultPersistedArea();
    const parsed = parsePersistedArea(await storage.read(uri));
    if (!parsed.ok) return { ...getDefaultPersistedArea(), error: parsed.error };
    const { area, region, name } = parsed.value;
    return { area, region, name, source: 'saved' };
  } catch (e) {
    return {
      ...getDefaultPersistedArea(),
      error: `Tallennetun alueen luku epäonnistui (${errorText(e)})`,
    };
  }
}

export async function resetToDefaultArea(
  storage: AreaStorage,
  documentDirectory: string
): Promise<LoadedArea> {
  const uri = buildLastAreaUri(documentDirectory);
  try {
    if (await storage.exists(uri)) await storage.remove(uri);
    return getDefaultPersistedArea();
  } catch (e) {
    return {
      ...getDefaultPersistedArea(),
      error: `Tallennuksen poisto epäonnistui (${errorText(e)})`,
    };
  }
}

/** Kameran siirron kynnys: n. 50 m tai 10 % zoom-muutos ennen uutta kirjoitusta. */
export const REGION_PERSIST_MIN_SHIFT_DEG = 0.0005;
export const REGION_PERSIST_MIN_ZOOM_RATIO = 0.1;

export function shouldPersistRegion(prev: AreaRegion | null, next: AreaRegion): boolean {
  if (!isValidRegion(next)) return false;
  if (!prev || !isValidRegion(prev)) return true;
  const moved =
    Math.abs(next.latitude - prev.latitude) >= REGION_PERSIST_MIN_SHIFT_DEG ||
    Math.abs(next.longitude - prev.longitude) >= REGION_PERSIST_MIN_SHIFT_DEG;
  const zoomed =
    Math.abs(next.latitudeDelta - prev.latitudeDelta) / prev.latitudeDelta >=
    REGION_PERSIST_MIN_ZOOM_RATIO;
  return moved || zoomed;
}

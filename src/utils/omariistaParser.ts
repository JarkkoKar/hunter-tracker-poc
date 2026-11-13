export interface Stand {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface Boundary {
  name: string;
  coordinates: Array<{ latitude: number; longitude: number }>;
}

export interface HuntingArea {
  boundary?: Boundary;
  stands: Stand[];
}

export function parseOmaRiistaGeoJSON(geoJson: any): HuntingArea {
  const area: HuntingArea = {
    stands: []
  };

  if (!geoJson || !Array.isArray(geoJson.features)) {
    return area;
  }

  for (const feature of geoJson.features) {
    const geometry = feature.geometry;
    const properties = feature.properties || {};

    if (!geometry) continue;

    if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
      const ring = geometry.coordinates[0] || [];
      area.boundary = {
        name: properties.name || 'Jahtialue',
        coordinates: ring.map((coord: number[]) => ({
          longitude: coord[0],
          latitude: coord[1]
        }))
      };
    } else if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
      area.stands.push({
        id: properties.id || properties.name || Math.random().toString(),
        name: properties.name || 'Passi',
        longitude: geometry.coordinates[0],
        latitude: geometry.coordinates[1]
      });
    }
  }

  return area;
}

// ---------------------------------------------------------------------------
// Tiedostotuonti (Document Picker) ja kameran keskitys
// ---------------------------------------------------------------------------

/** Tuotavan tekstin enimmäispituus (merkkiä); suojaa muistia ja jäätymistä. */
export const MAX_IMPORT_TEXT_LENGTH = 5_000_000;

export type OmaRiistaImportResult =
  | { ok: true; area: HuntingArea; warnings: string[] }
  | { ok: false; error: string };

export interface AreaRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/** Oletuksena oleva testialue (sama kuin aiempi App.tsx:n mock-data). */
export const DEFAULT_TEST_AREA_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [24.0, 61.0],
            [24.1, 61.0],
            [24.1, 61.1],
            [24.0, 61.1],
            [24.0, 61.0],
          ],
        ],
      },
      properties: { name: 'Hirvilohko 1 (Pohjoinen)' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.05, 61.05] },
      properties: { id: 'p1', name: 'P1 Kuusikko' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.05, 61.06] },
      properties: { id: 'p2', name: 'P2 Kallio (Pohjoinen)' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.07, 61.05] },
      properties: { id: 'p3', name: 'P3 Tiehaara (Itä)' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.03, 61.05] },
      properties: { id: 'p4', name: 'P4 Oja (Länsi)' },
    },
  ],
} as const;

/** Palauttaa oletustestialueen (Hirvilohko 1) uutena kopiona. */
export function getDefaultTestArea(): HuntingArea {
  return parseOmaRiistaGeoJSON(DEFAULT_TEST_AREA_GEOJSON);
}

export function isSupportedGeoJsonFileName(name?: string | null): boolean {
  if (!name) return false;
  return /\.(geo)?json$/i.test(name.trim());
}

const isValidLonLat = (coord: unknown): boolean =>
  Array.isArray(coord) &&
  typeof coord[0] === 'number' &&
  typeof coord[1] === 'number' &&
  Number.isFinite(coord[0]) &&
  Number.isFinite(coord[1]) &&
  Math.abs(coord[0]) <= 180 &&
  Math.abs(coord[1]) <= 90;

/**
 * Jäsentää laitteelta luetun GeoJSON-tekstin. Ei koskaan heitä poikkeusta:
 * virhetilanteissa palauttaa `{ ok: false, error }` selkeällä suomenkielisellä viestillä.
 */
export function importOmaRiistaFromJsonString(text: string): OmaRiistaImportResult {
  if (typeof text !== 'string') {
    return { ok: false, error: 'Tiedoston sisältöä ei voitu lukea tekstinä.' };
  }
  if (text.length > MAX_IMPORT_TEXT_LENGTH) {
    return { ok: false, error: 'Tiedosto on liian suuri (yli 5 Mt).' };
  }

  const cleaned = text.replace(/^﻿/, '').trim();
  if (cleaned.length === 0) {
    return { ok: false, error: 'Tiedosto on tyhjä.' };
  }

  let json: any;
  try {
    json = JSON.parse(cleaned);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Virheellinen JSON-tiedosto: ${detail}` };
  }

  if (!json || typeof json !== 'object' || Array.isArray(json) || json.type !== 'FeatureCollection') {
    return {
      ok: false,
      error: 'Tiedosto ei ole GeoJSON FeatureCollection (type: "FeatureCollection" puuttuu).',
    };
  }
  if (!Array.isArray(json.features)) {
    return { ok: false, error: 'GeoJSON FeatureCollectionista puuttuu features-taulukko.' };
  }

  // Koordinaattien tulee olla WGS84-asteita (GeoJSON-standardi). Esim. ETRS-TM35FIN
  // (EPSG:3067) metreinä piirtyisi muuten väärään paikkaan.
  for (const feature of json.features) {
    const g = feature?.geometry;
    if (!g) continue;
    const coords =
      g.type === 'Polygon' && Array.isArray(g.coordinates)
        ? g.coordinates[0] || []
        : g.type === 'Point'
          ? [g.coordinates]
          : [];
    if (!coords.every(isValidLonLat)) {
      return {
        ok: false,
        error:
          'Koordinaatit eivät ole WGS84-asteita (lon/lat). Tiedosto on todennäköisesti ' +
          'ETRS-TM35FIN-koordinaatistossa (EPSG:3067) – vie aineisto WGS84-muodossa (EPSG:4326).',
      };
    }
  }

  const area = parseOmaRiistaGeoJSON(json);

  if (!area.boundary && area.stands.length === 0) {
    return {
      ok: false,
      error: 'Tiedostossa ei ole aluerajaa (Polygon) eikä passipisteitä (Point).',
    };
  }

  const warnings: string[] = [];
  if (!area.boundary) warnings.push('Tiedostossa ei ole aluerajaa (Polygon) – näytetään vain passit.');
  if (area.stands.length === 0) warnings.push('Tiedostossa ei ole passipisteitä (Point).');

  return { ok: true, area, warnings };
}

export interface ImportFileReaders {
  /** Ensisijainen lukija, esim. expo-file-system/legacy `readAsStringAsync` (tukee file:// ja content://). */
  readAsString: (uri: string) => Promise<string>;
  /** Varalukija, esim. `fetch(uri).then(r => r.text())`. */
  fetchText?: (uri: string) => Promise<string>;
}

export type ImportFileReadResult =
  | { ok: true; text: string; source: 'primary' | 'fallback' }
  | { ok: false; error: string };

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Lukee Document Pickerin palauttaman tiedoston tekstinä. Tukee sekä file://-
 * (copyToCacheDirectory) että Androidin content://-osoitteita. Yrittää ensin
 * ensisijaista lukijaa ja sen hylätessä varalukijaa. Ei koskaan heitä.
 */
export async function readImportFileText(
  uri: string,
  readers: ImportFileReaders
): Promise<ImportFileReadResult> {
  if (!uri || typeof uri !== 'string') {
    return { ok: false, error: 'Tiedoston osoite puuttuu.' };
  }
  if (!/^(file|content):\/\//i.test(uri)) {
    return {
      ok: false,
      error: 'Tukematon tiedosto-osoite: vain file:// ja content:// -osoitteet voidaan lukea.',
    };
  }

  const isEmpty = (text: string) => text.replace(/^﻿/, '').trim().length === 0;
  const emptyError = { ok: false as const, error: 'Valittu tiedosto on tyhjä.' };

  let primaryError: string;
  try {
    const text = await readers.readAsString(uri);
    if (typeof text === 'string') {
      return isEmpty(text) ? emptyError : { ok: true, text, source: 'primary' };
    }
    primaryError = 'ensisijainen lukija ei palauttanut tekstiä';
  } catch (e) {
    primaryError = errorMessage(e);
  }

  if (!readers.fetchText) {
    return { ok: false, error: `Tiedoston luku epäonnistui: ${primaryError}` };
  }

  try {
    const text = await readers.fetchText(uri);
    if (typeof text !== 'string') throw new Error('varalukija ei palauttanut tekstiä');
    return isEmpty(text) ? emptyError : { ok: true, text, source: 'fallback' };
  } catch (e) {
    return {
      ok: false,
      error: `Tiedoston luku epäonnistui: ${primaryError} (varalukija: ${errorMessage(e)})`,
    };
  }
}

/**
 * Kartan näkymä uuden alueen päälle: rajauksen (aluerajan kärkipisteet + passit)
 * keskipiste ja marginaalilla laajennetut deltat (`animateToRegion`-muodossa).
 */
export function calculateAreaCenter(
  area: HuntingArea,
  paddingFactor: number = 1.3,
  minDelta: number = 0.005
): AreaRegion | null {
  const points = [...(area.boundary?.coordinates ?? []), ...area.stands];
  if (points.length === 0) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLon = Math.min(minLon, p.longitude);
    maxLon = Math.max(maxLon, p.longitude);
  }

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * paddingFactor, minDelta),
    longitudeDelta: Math.max((maxLon - minLon) * paddingFactor, minDelta),
  };
}

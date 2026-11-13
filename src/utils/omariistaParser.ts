export interface Stand {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface LatLon {
  latitude: number;
  longitude: number;
}

export interface Boundary {
  name: string;
  coordinates: LatLon[];
}

export interface HuntingArea {
  /** Pääraja: suurin palsta (yhteensopivuus vanhan koodin kanssa). */
  boundary?: Boundary;
  /** Kaikki palstat (Polygon- ja MultiPolygon-ulkokehät) syöttöjärjestyksessä. */
  polygons?: Boundary[];
  stands: Stand[];
}

/** Muuntaa GeoJSON-position (x, y) leveys-/pituusasteiksi. */
export type CoordinateTransform = (x: number, y: number) => LatLon;

const identityTransform: CoordinateTransform = (x, y) => ({ latitude: y, longitude: x });

interface FeatureLike {
  geometry: any;
  properties: Record<string, any>;
  id?: unknown;
}

const GEOMETRY_TYPES = new Set([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection',
]);

type Position = [number, number];

const isPosition = (p: unknown): p is number[] =>
  Array.isArray(p) &&
  p.length >= 2 &&
  typeof p[0] === 'number' &&
  typeof p[1] === 'number' &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]);

/** Juuritaso (FeatureCollection / Feature / pelkkä geometria) -> featurelista. */
function collectFeatures(root: any): FeatureLike[] {
  if (!root || typeof root !== 'object') return [];
  if (root.type === 'FeatureCollection') {
    if (!Array.isArray(root.features)) return [];
    return root.features
      .filter((f: any) => f && typeof f === 'object')
      .map((f: any) => ({ geometry: f.geometry, properties: f.properties || {}, id: f.id }));
  }
  if (root.type === 'Feature') {
    return [{ geometry: root.geometry, properties: root.properties || {}, id: root.id }];
  }
  if (GEOMETRY_TYPES.has(root.type)) {
    return [{ geometry: root, properties: {} }];
  }
  return [];
}

/** Purkaa geometrian ulkokehiksi ja pisteiksi (myös sisäkkäiset GeometryCollectionit). */
function flattenGeometry(
  geometry: any,
  out: { rings: Position[][]; points: Position[] } = { rings: [], points: [] },
  depth = 0
) {
  if (!geometry || typeof geometry !== 'object' || depth > 10) return out;
  const c = geometry.coordinates;
  const toRing = (ring: unknown): Position[] =>
    Array.isArray(ring) ? ring.filter(isPosition).map((p) => [p[0], p[1]] as Position) : [];

  switch (geometry.type) {
    case 'Polygon':
      if (Array.isArray(c)) out.rings.push(toRing(c[0])); // vain ulkokehä, reiät ohitetaan
      break;
    case 'MultiPolygon':
      if (Array.isArray(c)) for (const poly of c) if (Array.isArray(poly)) out.rings.push(toRing(poly[0]));
      break;
    case 'Point':
      if (isPosition(c)) out.points.push([c[0], c[1]]);
      break;
    case 'MultiPoint':
      if (Array.isArray(c)) for (const p of c) if (isPosition(p)) out.points.push([p[0], p[1]]);
      break;
    case 'GeometryCollection':
      if (Array.isArray(geometry.geometries)) {
        for (const g of geometry.geometries) flattenGeometry(g, out, depth + 1);
      }
      break;
  }
  return out;
}

const textField = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s.length > 0 ? s : undefined;
};

/** OmaRiistan nimikentät: name > nimi > title. */
const featureName = (props: Record<string, any>) =>
  textField(props.name) ?? textField(props.nimi) ?? textField(props.title);

/** Pinta-alan vertailuluku (asteina, pituusaste skaalattu cos(lat):lla). */
function ringArea(ring: LatLon[]): number {
  if (ring.length < 3) return 0;
  const meanLat = ring.reduce((s, p) => s + p.latitude, 0) / ring.length;
  const k = Math.cos((meanLat * Math.PI) / 180);
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.longitude * k * b.latitude - b.longitude * k * a.latitude;
  }
  return Math.abs(sum) / 2;
}

/**
 * Jäsentää OmaRiista-GeoJSONin: FeatureCollection, yksittäinen Feature,
 * GeometryCollection tai pelkkä geometria. Tukee Polygon/MultiPolygon-palstoja
 * (ulkokehät) ja Point/MultiPoint-passeja. Suurin palsta on `boundary`.
 *
 * @param transform Koordinaattimuunnos (oletus: GeoJSON-asteet sellaisenaan).
 */
export function parseOmaRiistaGeoJSON(
  geoJson: any,
  transform: CoordinateTransform = identityTransform
): HuntingArea {
  const polygons: Boundary[] = [];
  const stands: Stand[] = [];
  const usedIds = new Set<string>();

  const uniqueId = (base: string) => {
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
    usedIds.add(id);
    return id;
  };

  for (const feature of collectFeatures(geoJson)) {
    const props = feature.properties;
    const { rings, points } = flattenGeometry(feature.geometry);
    const name = featureName(props);

    for (const ring of rings) {
      if (ring.length < 3) continue;
      polygons.push({
        name: name ?? 'Jahtialue',
        coordinates: ring.map(([x, y]) => transform(x, y)),
      });
    }

    const numero = textField(props.numero);
    const propId = textField(props.id) ?? textField(feature.id);

    points.forEach(([x, y], i) => {
      const standNo = stands.length + 1;
      const baseName =
        name ?? (numero ? `Passi ${numero}` : propId ? `Passi ${propId}` : `Passi ${standNo}`);
      const baseId = propId ?? name ?? (numero ? `passi-${numero}` : `passi-${standNo}`);
      const multi = points.length > 1;
      stands.push({
        id: uniqueId(multi ? `${baseId}-${i + 1}` : baseId),
        name: multi && (name || numero || propId) ? `${baseName} ${i + 1}` : baseName,
        ...transform(x, y),
      });
    });
  }

  const area: HuntingArea = { stands };
  if (polygons.length > 0) {
    area.polygons = polygons;
    area.boundary = polygons.reduce((best, p) => (ringArea(p.coordinates) > ringArea(best.coordinates) ? p : best));
  }
  return area;
}

/** Kaikki palstat; vanhoille alueille, joilla on vain `boundary`, palautetaan se. */
export function getAreaPolygons(area: HuntingArea): Boundary[] {
  if (area.polygons && area.polygons.length > 0) return area.polygons;
  return area.boundary ? [area.boundary] : [];
}

/** Kaikki alueen pisteet (palstojen kärkipisteet + passit), esim. rajaukseen. */
export function getAreaPoints(area: HuntingArea): LatLon[] {
  return [...getAreaPolygons(area).flatMap((p) => p.coordinates), ...area.stands];
}

// ---------------------------------------------------------------------------
// ETRS-TM35FIN (EPSG:3067) <-> WGS84 / ETRS89 (JHS 154, GRS80, Krüger n^4 -sarjat)
// ---------------------------------------------------------------------------

const TM35 = (() => {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const n = f / (2 - f);
  const n2 = n * n;
  const n3 = n2 * n;
  const n4 = n3 * n;
  return {
    k0: 0.9996,
    lon0: (27 * Math.PI) / 180,
    e0: 500000,
    e: Math.sqrt(f * (2 - f)),
    A1: (a / (1 + n)) * (1 + n2 / 4 + n4 / 64),
    // Suora muunnos (maantieteellinen -> tasokoordinaatit)
    h: [
      n / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4,
      (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4,
      (61 / 240) * n3 - (103 / 140) * n4,
      (49561 / 161280) * n4,
    ],
    // Käänteinen muunnos (tasokoordinaatit -> maantieteellinen)
    hInv: [
      n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - (1 / 360) * n4,
      (1 / 48) * n2 + (1 / 15) * n3 - (437 / 1440) * n4,
      (17 / 480) * n3 - (37 / 840) * n4,
      (4397 / 161280) * n4,
    ],
  };
})();

/** ETRS-TM35FIN (itä, pohjoinen metreinä) -> WGS84-asteet. */
export function etrsTm35finToWgs84(easting: number, northing: number): LatLon {
  const { k0, lon0, e0, e, A1, hInv } = TM35;
  const xi = northing / (A1 * k0);
  const eta = (easting - e0) / (A1 * k0);

  let xiP = xi;
  let etaP = eta;
  hInv.forEach((hk, idx) => {
    const j = 2 * (idx + 1);
    xiP -= hk * Math.sin(j * xi) * Math.cosh(j * eta);
    etaP -= hk * Math.cos(j * xi) * Math.sinh(j * eta);
  });

  const beta = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  const l = Math.asin(Math.tanh(etaP) / Math.cos(beta));
  const Q = Math.asinh(Math.tan(beta));
  let Qp = Q + e * Math.atanh(e * Math.tanh(Q));
  for (let i = 0; i < 6; i++) Qp = Q + e * Math.atanh(e * Math.tanh(Qp));

  return {
    latitude: (Math.atan(Math.sinh(Qp)) * 180) / Math.PI,
    longitude: ((lon0 + l) * 180) / Math.PI,
  };
}

/** WGS84-asteet -> ETRS-TM35FIN (itä, pohjoinen metreinä). */
export function wgs84ToEtrsTm35fin(latitude: number, longitude: number): { easting: number; northing: number } {
  const { k0, lon0, e0, e, A1, h } = TM35;
  const phi = (latitude * Math.PI) / 180;
  const lambda = (longitude * Math.PI) / 180;

  const Q = Math.asinh(Math.tan(phi)) - e * Math.atanh(e * Math.sin(phi));
  const beta = Math.atan(Math.sinh(Q));
  const etaP = Math.atanh(Math.cos(beta) * Math.sin(lambda - lon0));
  const xiP = Math.asin(Math.sin(beta) * Math.cosh(etaP));

  let xi = xiP;
  let eta = etaP;
  h.forEach((hk, idx) => {
    const j = 2 * (idx + 1);
    xi += hk * Math.sin(j * xiP) * Math.cosh(j * etaP);
    eta += hk * Math.cos(j * xiP) * Math.sinh(j * etaP);
  });

  return { easting: A1 * eta * k0 + e0, northing: A1 * xi * k0 };
}

/** Suomen ETRS-TM35FIN-koordinaattien uskottava vaihteluväli (metreinä). */
const isPlausibleTm35fin = ([x, y]: Position) => x >= 0 && x <= 1_000_000 && y >= 6_400_000 && y <= 7_900_000;
const isDegrees = ([x, y]: Position) => Math.abs(x) <= 180 && Math.abs(y) <= 90;

type CoordinateDetection =
  | { ok: true; system: 'WGS84' | 'ETRS-TM35FIN'; transform: CoordinateTransform }
  | { ok: false; error: string };

/** Tunnistaa koordinaatiston kaikista positioista (|x| > 180 tai |y| > 90 => metrejä). */
function detectCoordinateSystem(features: FeatureLike[]): CoordinateDetection {
  const positions: Position[] = [];
  for (const f of features) {
    const { rings, points } = flattenGeometry(f.geometry);
    rings.forEach((r) => positions.push(...r));
    positions.push(...points);
  }

  const degreeCount = positions.filter(isDegrees).length;
  if (degreeCount === positions.length) {
    return { ok: true, system: 'WGS84', transform: identityTransform };
  }
  if (degreeCount > 0) {
    return {
      ok: false,
      error: 'Tiedostossa on asteita ja metrejä sekaisin – koordinaatistoa ei voida tunnistaa.',
    };
  }
  if (positions.every(isPlausibleTm35fin)) {
    return {
      ok: true,
      system: 'ETRS-TM35FIN',
      transform: (x, y) => etrsTm35finToWgs84(x, y),
    };
  }
  return {
    ok: false,
    error:
      'Tuntematon koordinaatisto: koordinaatit eivät ole WGS84-asteita eivätkä ETRS-TM35FIN-metrejä ' +
      '(EPSG:3067). Vie aineisto WGS84- tai ETRS-TM35FIN-muodossa.',
  };
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

/** Oletuksena oleva testialue: Hätilä, Hämeenlinna (keskipiste 61.015° N, 24.535° E). */
export const DEFAULT_TEST_AREA_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [24.495, 60.995],
            [24.575, 60.995],
            [24.575, 61.035],
            [24.495, 61.035],
            [24.495, 60.995],
          ],
        ],
      },
      properties: { name: 'Hätilä - Metsästysalue' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.532, 61.0145] },
      properties: { id: 'p1', name: 'P1 Ampumaradan reuna' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.535, 61.022] },
      properties: { id: 'p2', name: 'P2 Pohjoislinja' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.552, 61.015] },
      properties: { id: 'p3', name: 'P3 Itäkangas' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.534, 61.006] },
      properties: { id: 'p4', name: 'P4 Eteläsuo' },
    },
  ],
} as const;

/** Palauttaa oletustestialueen (Hätilä - Metsästysalue) uutena kopiona. */
export function getDefaultTestArea(): HuntingArea {
  return parseOmaRiistaGeoJSON(DEFAULT_TEST_AREA_GEOJSON);
}

export function isSupportedGeoJsonFileName(name?: string | null): boolean {
  if (!name) return false;
  return /\.(geo)?json$/i.test(name.trim());
}

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

  const rootType = json && typeof json === 'object' && !Array.isArray(json) ? json.type : undefined;
  if (rootType !== 'FeatureCollection' && rootType !== 'Feature' && !GEOMETRY_TYPES.has(rootType)) {
    return {
      ok: false,
      error:
        'Tiedosto ei ole GeoJSON-aineisto (odotettiin FeatureCollection, Feature tai geometria).',
    };
  }
  if (rootType === 'FeatureCollection' && !Array.isArray(json.features)) {
    return { ok: false, error: 'GeoJSON FeatureCollectionista puuttuu features-taulukko.' };
  }

  // GeoJSON-standardi on WGS84-asteet, mutta suomalaiset viennit ovat usein
  // ETRS-TM35FIN-metrejä (EPSG:3067): tunnistetaan ja muunnetaan.
  const detection = detectCoordinateSystem(collectFeatures(json));
  if (!detection.ok) {
    return { ok: false, error: detection.error };
  }

  const area = parseOmaRiistaGeoJSON(json, detection.transform);

  if (!area.boundary && area.stands.length === 0) {
    return {
      ok: false,
      error:
        'Tiedostossa ei ole aluerajaa (Polygon/MultiPolygon) eikä passipisteitä (Point/MultiPoint).',
    };
  }

  const warnings: string[] = [];
  if (detection.system === 'ETRS-TM35FIN') {
    warnings.push('Koordinaatit muunnettu ETRS-TM35FIN (EPSG:3067) -> WGS84.');
  }
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
  const points = getAreaPoints(area); // kaikki palstat + passit
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

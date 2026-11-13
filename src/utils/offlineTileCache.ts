/**
 * Offline-karttatiilien laskenta ja välimuistin hallinta.
 *
 * Puhtaita funktioita: ei riipu expo-file-systemistä eikä verkosta, joten
 * kaikki on Jest-testattavissa. Varsinainen lataus injektoidaan
 * (`downloadTile`), App.tsx käyttää expo-file-systemin `File.downloadFileAsync`ia.
 *
 * Tiilijärjestelmä: Web Mercator (EPSG:3857), XYZ-indeksointi, y kasvaa etelään.
 * Sama kuin OpenTopoMap ja MML:n WGS84_Pseudo-Mercator WMTS (TileRow = y, TileCol = x).
 */

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export interface LatLon {
  latitude: number;
  longitude: number;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export const DEFAULT_OFFLINE_ZOOM_LEVELS: readonly number[] = [13, 14, 15];
/** Turvaraja: yksi lataus ei saa ylittää tätä tiilimäärää (kaistan ja palvelimen säästö). */
export const MAX_TILES_PER_DOWNLOAD = 250;
export const DEFAULT_OFFLINE_MARGIN_METERS = 500;
export const TILE_CACHE_DIR_NAME = 'tiles';

const MAX_MERCATOR_LAT = 85.05112878;
const METERS_PER_DEGREE_LAT = 111320;

const clampLat = (lat: number) => Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));

export function lonToTileX(lon: number, z: number): number {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  return Math.min(n - 1, Math.max(0, x));
}

export function latToTileY(lat: number, z: number): number {
  const n = 2 ** z;
  const latRad = (clampLat(lat) * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return Math.min(n - 1, Math.max(0, y));
}

/** Tiilen länsireunan pituusaste. */
export function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

/** Tiilen pohjoisreunan leveysaste. */
export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/**
 * Rajaus pistejoukon (esim. jahtialueen polygonin kärkipisteet tai passit) ympärille,
 * laajennettuna marginaalilla (metreinä) joka suuntaan.
 */
export function computeBoundingBox(points: LatLon[], marginMeters: number = 0): BoundingBox {
  if (points.length === 0) {
    throw new Error('computeBoundingBox: pistejoukko on tyhjä');
  }
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

  if (marginMeters > 0) {
    const dLat = marginMeters / METERS_PER_DEGREE_LAT;
    // Pituusasteen pituus lyhenee pohjoiseen: käytetään pohjoisimman reunan leveyttä (varmempi peitto)
    const refLat = Math.max(Math.abs(minLat), Math.abs(maxLat));
    const dLon = marginMeters / (METERS_PER_DEGREE_LAT * Math.cos((refLat * Math.PI) / 180));
    minLat = clampLat(minLat - dLat);
    maxLat = clampLat(maxLat + dLat);
    minLon = Math.max(-180, minLon - dLon);
    maxLon = Math.min(180, maxLon + dLon);
  }

  return { minLat, maxLat, minLon, maxLon };
}

/** Kaikki rajauksen peittävät tiilet yhdellä zoom-tasolla. */
export function getTilesForBoundingBox(bbox: BoundingBox, z: number): TileCoord[] {
  const minX = lonToTileX(bbox.minLon, z);
  const maxX = lonToTileX(bbox.maxLon, z);
  // y kasvaa etelään: pohjoisin leveys antaa pienimmän y:n
  const minY = latToTileY(bbox.maxLat, z);
  const maxY = latToTileY(bbox.minLat, z);

  const tiles: TileCoord[] = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      tiles.push({ z, x, y });
    }
  }
  return tiles;
}

export interface OfflineTilePlanOptions {
  zoomLevels?: readonly number[];
  marginMeters?: number;
  maxTiles?: number;
}

export interface OfflineTilePlan {
  tiles: TileCoord[];
  totalTiles: number;
  /** Kokonaan mukana olevat zoom-tasot. */
  zoomLevels: number[];
  /** Tasot, jotka jätettiin pois turvarajan vuoksi. */
  skippedZoomLevels: number[];
  truncated: boolean;
  bbox: BoundingBox;
}

/**
 * Suunnittelee latauksen: zoom-tasot otetaan mukaan nousevassa järjestyksessä
 * niin kauan kuin kokonaismäärä pysyy turvarajan alla. Taso, joka ylittäisi
 * rajan, ja kaikki sitä suuremmat jätetään kokonaan pois – näin mukana olevat
 * tasot peittävät koko alueen eikä kartalle jää puolikkaita tasoja.
 */
export function planOfflineTileDownload(
  points: LatLon[],
  options: OfflineTilePlanOptions = {}
): OfflineTilePlan {
  const zoomLevels = [...(options.zoomLevels ?? DEFAULT_OFFLINE_ZOOM_LEVELS)].sort((a, b) => a - b);
  const marginMeters = options.marginMeters ?? DEFAULT_OFFLINE_MARGIN_METERS;
  const maxTiles = options.maxTiles ?? MAX_TILES_PER_DOWNLOAD;

  const bbox = computeBoundingBox(points, marginMeters);
  const tiles: TileCoord[] = [];
  const included: number[] = [];
  const skipped: number[] = [];

  for (const z of zoomLevels) {
    if (skipped.length > 0) {
      skipped.push(z);
      continue;
    }
    const levelTiles = getTilesForBoundingBox(bbox, z);
    if (tiles.length + levelTiles.length > maxTiles) {
      skipped.push(z);
      continue;
    }
    tiles.push(...levelTiles);
    included.push(z);
  }

  return {
    tiles,
    totalTiles: tiles.length,
    zoomLevels: included,
    skippedZoomLevels: skipped,
    truncated: skipped.length > 0,
    bbox,
  };
}

const withTrailingSlash = (uri: string) => (uri.endsWith('/') ? uri : `${uri}/`);

/** `file://.../tiles/{layer}/{z}/{x}/{y}.png` */
export function buildLocalTilePath(rootUri: string, layerId: string, tile: TileCoord): string {
  return `${withTrailingSlash(rootUri)}${TILE_CACHE_DIR_NAME}/${layerId}/${tile.z}/${tile.x}/${tile.y}.png`;
}

/** UrlTile-pohja, joka lukee tiilet paikallisesta hakemistosta. */
export function buildLocalTileUrlTemplate(rootUri: string, layerId: string): string {
  return `${withTrailingSlash(rootUri)}${TILE_CACHE_DIR_NAME}/${layerId}/{z}/{x}/{y}.png`;
}

/**
 * Suurin välimuistissa oleva zoom-taso kerroshakemiston alihakemistojen nimistä
 * (`tiles/{layer}/{z}`). Käytetään UrlTilen `maximumNativeZ`-arvona, jotta
 * ladattua tasoa tarkemmilla zoomeilla skaalataan ylös eikä kartta tyhjene.
 */
export function getMaxCachedZoomLevel(directoryNames: string[]): number | null {
  const levels = directoryNames.filter((n) => /^\d+$/.test(n)).map(Number);
  return levels.length > 0 ? Math.max(...levels) : null;
}

/** Täyttää lähde-URL-pohjan ({z}/{x}/{y} missä järjestyksessä tahansa). */
export function buildTileSourceUrl(urlTemplate: string, tile: TileCoord): string {
  return urlTemplate
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y));
}

// ---------------------------------------------------------------------------
// Latausjonon tila (immutable)
// ---------------------------------------------------------------------------

export interface TileDownloadState {
  total: number;
  completed: number;
  failed: number;
  failedTiles: TileCoord[];
}

export function createTileDownloadState(total: number): TileDownloadState {
  return { total, completed: 0, failed: 0, failedTiles: [] };
}

export function markTileCompleted(state: TileDownloadState): TileDownloadState {
  return { ...state, completed: state.completed + 1 };
}

export function markTileFailed(state: TileDownloadState, tile: TileCoord): TileDownloadState {
  return { ...state, failed: state.failed + 1, failedTiles: [...state.failedTiles, tile] };
}

export function getDownloadProgressPercent(state: TileDownloadState): number {
  if (state.total <= 0) return 100;
  return Math.round(((state.completed + state.failed) / state.total) * 100);
}

export function isDownloadFinished(state: TileDownloadState): boolean {
  return state.completed + state.failed >= state.total;
}

export interface DownloadTilesOptions {
  /** Lähdepohja (online-UrlTile), voi sisältää API-avaimen ympäristömuuttujasta. */
  sourceUrlTemplate: string;
  rootUri: string;
  layerId: string;
  /** Lataa yhden tiilen; heittää virheen epäonnistuessa. */
  downloadTile: (url: string, destinationUri: string) => Promise<void>;
  concurrency?: number;
  onProgress?: (state: TileDownloadState) => void;
}

/**
 * Lataa tiilet rajatulla rinnakkaisuudella. Yksittäisen tiilen virhe kirjataan
 * eikä keskeytä muita. Palauttaa lopputilan.
 */
export async function downloadTilesToCache(
  tiles: TileCoord[],
  options: DownloadTilesOptions
): Promise<TileDownloadState> {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  let state = createTileDownloadState(tiles.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < tiles.length) {
      const tile = tiles[nextIndex++];
      const url = buildTileSourceUrl(options.sourceUrlTemplate, tile);
      const dest = buildLocalTilePath(options.rootUri, options.layerId, tile);
      try {
        await options.downloadTile(url, dest);
        state = markTileCompleted(state);
      } catch {
        state = markTileFailed(state, tile);
      }
      options.onProgress?.(state);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, tiles.length) }, worker));
  return state;
}

import { describe, it, expect } from '@jest/globals';
import {
  TileCoord,
  DEFAULT_OFFLINE_ZOOM_LEVELS,
  MAX_TILES_PER_DOWNLOAD,
  lonToTileX,
  latToTileY,
  tileXToLon,
  tileYToLat,
  computeBoundingBox,
  getTilesForBoundingBox,
  planOfflineTileDownload,
  buildLocalTilePath,
  buildLocalTileUrlTemplate,
  buildTileSourceUrl,
  createTileDownloadState,
  markTileCompleted,
  markTileFailed,
  getDownloadProgressPercent,
  isDownloadFinished,
  downloadTilesToCache,
  getMaxCachedZoomLevel,
} from '../src/utils/offlineTileCache';
import { getTopoTileConfig } from '../src/utils/mapTiles';

// Sama jahtialue kuin App.tsx:n MOCK_OMARIISTA_GEOJSON (n. 0.1° x 0.1° @ 61°N)
const HUNTING_AREA_POLYGON = [
  { latitude: 61.0, longitude: 24.0 },
  { latitude: 61.0, longitude: 24.1 },
  { latitude: 61.1, longitude: 24.1 },
  { latitude: 61.1, longitude: 24.0 },
  { latitude: 61.0, longitude: 24.0 },
];

const DOC_ROOT = 'file:///data/user/0/host.exp.exponent/files/';

describe('Tiilimatematiikka (Web Mercator / WMTS z-x-y)', () => {
  it('maailman tiilet tunnetuissa pisteissä', () => {
    expect(lonToTileX(0, 0)).toBe(0);
    expect(latToTileY(0, 0)).toBe(0);
    expect(lonToTileX(0, 1)).toBe(1);
    expect(latToTileY(0, 1)).toBe(1);
    expect(lonToTileX(-180, 5)).toBe(0);
    expect(lonToTileX(179.9999, 5)).toBe(31);
    expect(latToTileY(85.05, 5)).toBe(0);
  });

  it('piste osuu laskemansa tiilen rajojen sisään (z13..15)', () => {
    const p = { latitude: 61.05, longitude: 24.05 };
    for (const z of [13, 14, 15]) {
      const x = lonToTileX(p.longitude, z);
      const y = latToTileY(p.latitude, z);
      expect(tileXToLon(x, z)).toBeLessThanOrEqual(p.longitude);
      expect(tileXToLon(x + 1, z)).toBeGreaterThan(p.longitude);
      // y kasvaa etelään: tiilen yläreuna on pohjoisempana
      expect(tileYToLat(y, z)).toBeGreaterThanOrEqual(p.latitude);
      expect(tileYToLat(y + 1, z)).toBeLessThan(p.latitude);
    }
  });

  it('seuraavan zoom-tason tiili on edellisen lapsi', () => {
    const p = { latitude: 61.05, longitude: 24.05 };
    const x13 = lonToTileX(p.longitude, 13);
    const y13 = latToTileY(p.latitude, 13);
    expect(Math.floor(lonToTileX(p.longitude, 14) / 2)).toBe(x13);
    expect(Math.floor(latToTileY(p.latitude, 14) / 2)).toBe(y13);
  });
});

describe('Rajaus (bounding box) jahtialueen kärkipisteistä + marginaali', () => {
  it('ilman marginaalia rajaus on pisteiden min/max', () => {
    const bbox = computeBoundingBox(HUNTING_AREA_POLYGON);
    expect(bbox).toEqual({ minLat: 61.0, maxLat: 61.1, minLon: 24.0, maxLon: 24.1 });
  });

  it('marginaali metreinä laajentaa rajausta joka suuntaan', () => {
    const bbox = computeBoundingBox(HUNTING_AREA_POLYGON, 1000);
    // 1000 m ≈ 0.009° leveyttä; pituuspiirin suunnassa enemmän (cos 61°)
    expect(61.0 - bbox.minLat).toBeCloseTo(0.009, 3);
    expect(bbox.maxLat - 61.1).toBeCloseTo(0.009, 3);
    expect(24.0 - bbox.minLon).toBeGreaterThan(0.017);
    expect(24.0 - bbox.minLon).toBeLessThan(0.02);
  });

  it('tyhjä pistejoukko heittää virheen', () => {
    expect(() => computeBoundingBox([])).toThrow();
  });
});

describe('Latauksen suunnittelu z = 13..15 ja 250 tiilen turvaraja', () => {
  it('oletukset: zoom 13..15, max 250 tiiltä', () => {
    expect(DEFAULT_OFFLINE_ZOOM_LEVELS).toEqual([13, 14, 15]);
    expect(MAX_TILES_PER_DOWNLOAD).toBe(250);
  });

  it('rajauksen tiilet: täysi suorakaide ilman duplikaatteja', () => {
    const bbox = computeBoundingBox(HUNTING_AREA_POLYGON);
    const tiles = getTilesForBoundingBox(bbox, 13);
    const xs = tiles.map((t) => t.x);
    const ys = tiles.map((t) => t.y);
    const w = Math.max(...xs) - Math.min(...xs) + 1;
    const h = Math.max(...ys) - Math.min(...ys) + 1;
    expect(tiles.length).toBe(w * h);
    expect(new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`)).size).toBe(tiles.length);
    expect(tiles.every((t) => t.z === 13)).toBe(true);
  });

  it('pieni alue (passi + 300 m): kaikki tasot 13..15 mahtuvat', () => {
    const plan = planOfflineTileDownload([{ latitude: 61.05, longitude: 24.05 }], {
      marginMeters: 300,
    });
    expect(plan.zoomLevels).toEqual([13, 14, 15]);
    expect(plan.skippedZoomLevels).toEqual([]);
    expect(plan.truncated).toBe(false);
    expect(plan.tiles.length).toBe(plan.totalTiles);
    expect(plan.totalTiles).toBeLessThanOrEqual(250);
  });

  it('koko jahtialue + 500 m: z15 jätetään pois, ettei 250 tiilen raja ylity', () => {
    const plan = planOfflineTileDownload(HUNTING_AREA_POLYGON, { marginMeters: 500 });
    expect(plan.totalTiles).toBeLessThanOrEqual(MAX_TILES_PER_DOWNLOAD);
    expect(plan.zoomLevels).toEqual([13, 14]);
    expect(plan.skippedZoomLevels).toEqual([15]);
    expect(plan.truncated).toBe(true);
    // Mukana olevat tasot ovat täydellisiä (koko alue peitetty)
    const bbox = computeBoundingBox(HUNTING_AREA_POLYGON, 500);
    expect(plan.tiles.filter((t) => t.z === 14).length).toBe(
      getTilesForBoundingBox(bbox, 14).length
    );
  });

  it('jos jo alin taso ylittää rajan, mitään ei ladata', () => {
    const plan = planOfflineTileDownload(HUNTING_AREA_POLYGON, { maxTiles: 5 });
    expect(plan.tiles).toEqual([]);
    expect(plan.zoomLevels).toEqual([]);
    expect(plan.skippedZoomLevels).toEqual([13, 14, 15]);
    expect(plan.truncated).toBe(true);
  });

  it('järjestää zoom-tasot nousevaan järjestykseen', () => {
    const plan = planOfflineTileDownload([{ latitude: 61.05, longitude: 24.05 }], {
      zoomLevels: [15, 13, 14],
      marginMeters: 100,
    });
    expect(plan.zoomLevels).toEqual([13, 14, 15]);
  });
});

describe('Paikalliset polut ja lähde-URL', () => {
  const tile: TileCoord = { z: 14, x: 9287, y: 4661 };

  it('muodostaa file://.../tiles/{layer}/{z}/{x}/{y}.png -polun', () => {
    expect(buildLocalTilePath(DOC_ROOT, 'mml-maastokartta', tile)).toBe(
      'file:///data/user/0/host.exp.exponent/files/tiles/mml-maastokartta/14/9287/4661.png'
    );
  });

  it('kestää juuren ilman loppukauttaviivaa', () => {
    expect(buildLocalTilePath(DOC_ROOT.slice(0, -1), 'opentopomap', tile)).toBe(
      'file:///data/user/0/host.exp.exponent/files/tiles/opentopomap/14/9287/4661.png'
    );
  });

  it('muodostaa UrlTile-pohjan paikalliselle hakemistolle', () => {
    expect(buildLocalTileUrlTemplate(DOC_ROOT, 'opentopomap')).toBe(
      'file:///data/user/0/host.exp.exponent/files/tiles/opentopomap/{z}/{x}/{y}.png'
    );
  });

  it('täyttää lähdepohjan oikein myös MML:n {z}/{y}/{x}-järjestyksessä', () => {
    const mml = getTopoTileConfig('testi-avain');
    const url = buildTileSourceUrl(mml.urlTemplate, tile);
    expect(url).toContain('/WGS84_Pseudo-Mercator/14/4661/9287.png');
    expect(url).toContain('api-key=testi-avain');
    const otm = getTopoTileConfig('');
    expect(buildTileSourceUrl(otm.urlTemplate, tile)).toBe(
      'https://a.tile.opentopomap.org/14/9287/4661.png'
    );
  });

  it('paikallinen polku ei koskaan sisällä API-avainta', () => {
    const mml = getTopoTileConfig('salainen-avain-xyz');
    expect(buildLocalTilePath(DOC_ROOT, mml.id, tile)).not.toContain('salainen-avain-xyz');
  });
});

describe('Latausjonon tila', () => {
  const t1: TileCoord = { z: 13, x: 1, y: 1 };
  const t2: TileCoord = { z: 13, x: 2, y: 1 };

  it('seuraa ladattuja, epäonnistuneita ja edistymisprosenttia', () => {
    let s = createTileDownloadState(4);
    expect(getDownloadProgressPercent(s)).toBe(0);
    expect(isDownloadFinished(s)).toBe(false);

    s = markTileCompleted(s);
    expect(getDownloadProgressPercent(s)).toBe(25);
    s = markTileFailed(s, t1);
    expect(getDownloadProgressPercent(s)).toBe(50);
    s = markTileCompleted(s);
    s = markTileCompleted(s);

    expect(s.completed).toBe(3);
    expect(s.failed).toBe(1);
    expect(s.failedTiles).toEqual([t1]);
    expect(getDownloadProgressPercent(s)).toBe(100);
    expect(isDownloadFinished(s)).toBe(true);
  });

  it('tilasiirtymät eivät muuta alkuperäistä tilaa (immutable)', () => {
    const s0 = createTileDownloadState(2);
    const s1 = markTileFailed(s0, t2);
    expect(s0.failed).toBe(0);
    expect(s0.failedTiles).toEqual([]);
    expect(s1.failed).toBe(1);
  });

  it('tyhjä lataus on heti valmis (100 %)', () => {
    const s = createTileDownloadState(0);
    expect(getDownloadProgressPercent(s)).toBe(100);
    expect(isDownloadFinished(s)).toBe(true);
  });
});

describe('downloadTilesToCache (injektoitu latausfunktio, ei verkkoa)', () => {
  const plan = planOfflineTileDownload([{ latitude: 61.05, longitude: 24.05 }], {
    zoomLevels: [13, 14],
    marginMeters: 200,
  });

  it('lataa jokaisen tiilen oikeaan polkuun ja raportoi edistymisen', async () => {
    const calls: Array<{ url: string; dest: string }> = [];
    const progress: number[] = [];

    const result = await downloadTilesToCache(plan.tiles, {
      sourceUrlTemplate: 'https://tiles.example/{z}/{x}/{y}.png',
      rootUri: DOC_ROOT,
      layerId: 'opentopomap',
      concurrency: 3,
      downloadTile: async (url, dest) => {
        calls.push({ url, dest });
      },
      onProgress: (s) => progress.push(getDownloadProgressPercent(s)),
    });

    expect(result.completed).toBe(plan.tiles.length);
    expect(result.failed).toBe(0);
    expect(calls.length).toBe(plan.tiles.length);
    const first = plan.tiles[0];
    expect(calls).toContainEqual({
      url: `https://tiles.example/${first.z}/${first.x}/${first.y}.png`,
      dest: buildLocalTilePath(DOC_ROOT, 'opentopomap', first),
    });
    expect(progress[progress.length - 1]).toBe(100);
    // Edistyminen kasvaa monotonisesti
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it('epäonnistunut tiili kirjataan, muut latautuvat silti', async () => {
    const failing = plan.tiles[1];
    const result = await downloadTilesToCache(plan.tiles, {
      sourceUrlTemplate: 'https://tiles.example/{z}/{x}/{y}.png',
      rootUri: DOC_ROOT,
      layerId: 'opentopomap',
      downloadTile: async (url) => {
        if (url.endsWith(`/${failing.z}/${failing.x}/${failing.y}.png`)) {
          throw new Error('HTTP 503');
        }
      },
    });
    expect(result.failed).toBe(1);
    expect(result.failedTiles).toEqual([failing]);
    expect(result.completed).toBe(plan.tiles.length - 1);
    expect(isDownloadFinished(result)).toBe(true);
  });

  it('rinnakkaisuus ei ylitä annettua rajaa', async () => {
    let active = 0;
    let peak = 0;
    await downloadTilesToCache(plan.tiles, {
      sourceUrlTemplate: 'https://tiles.example/{z}/{x}/{y}.png',
      rootUri: DOC_ROOT,
      layerId: 'opentopomap',
      concurrency: 2,
      downloadTile: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 1));
        active--;
      },
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('Välimuistin suurin zoom-taso (maximumNativeZ levyn sisällöstä)', () => {
  it('valitsee suurimman numeerisen zoom-hakemiston', () => {
    expect(getMaxCachedZoomLevel(['13', '14'])).toBe(14);
    expect(getMaxCachedZoomLevel(['15', '13', '14'])).toBe(15);
  });

  it('ohittaa ei-numeeriset nimet ja palauttaa null, jos tasoja ei ole', () => {
    expect(getMaxCachedZoomLevel(['tmp', '.DS_Store', '13'])).toBe(13);
    expect(getMaxCachedZoomLevel([])).toBeNull();
    expect(getMaxCachedZoomLevel(['abc'])).toBeNull();
  });

  it('offline-konfiguraatio käyttää annettua tasoa (vain z13–14 ladattu)', () => {
    const cfg = getTopoTileConfig('', { offlineCacheRootUri: DOC_ROOT, offlineMaxNativeZ: 14 });
    expect(cfg.maximumNativeZ).toBe(14);
  });
});

describe('getTopoTileConfig: offline-tila', () => {
  it('online-oletus ennallaan ja kerroksella on tunniste', () => {
    expect(getTopoTileConfig('avain').id).toBe('mml-maastokartta');
    expect(getTopoTileConfig('').id).toBe('opentopomap');
    expect(getTopoTileConfig('').isOffline).toBe(false);
  });

  it('offline-juuri annettuna UrlTile lukee paikallisesta file://-hakemistosta', () => {
    const cfg = getTopoTileConfig('salainen-avain-xyz', { offlineCacheRootUri: DOC_ROOT });
    expect(cfg.isOffline).toBe(true);
    expect(cfg.isMml).toBe(true);
    expect(cfg.urlTemplate).toBe(
      'file:///data/user/0/host.exp.exponent/files/tiles/mml-maastokartta/{z}/{x}/{y}.png'
    );
    expect(cfg.urlTemplate).not.toContain('salainen-avain-xyz');
    expect(cfg.urlTemplate.startsWith('https://')).toBe(false);
    // Ladattua tasoa suuremmilla zoomeilla skaalataan z15-tiiliä ylös
    expect(cfg.maximumNativeZ).toBe(15);
    expect(cfg.label).toContain('offline');
  });

  it('offline ilman avainta käyttää OpenTopoMap-kerroksen hakemistoa', () => {
    const cfg = getTopoTileConfig(undefined, { offlineCacheRootUri: DOC_ROOT });
    expect(cfg.urlTemplate).toBe(
      'file:///data/user/0/host.exp.exponent/files/tiles/opentopomap/{z}/{x}/{y}.png'
    );
  });
});

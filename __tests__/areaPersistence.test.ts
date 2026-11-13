import { describe, it, expect } from '@jest/globals';
import {
  AreaStorage,
  LAST_AREA_FILE_NAME,
  DEFAULT_START_REGION,
  buildLastAreaUri,
  serializePersistedArea,
  parsePersistedArea,
  getDefaultPersistedArea,
  saveLastUsedArea,
  loadLastUsedArea,
  resetToDefaultArea,
  shouldPersistRegion,
  createLegacyAreaStorage,
} from '../src/utils/areaPersistence';
import {
  HuntingArea,
  getDefaultTestArea,
  importOmaRiistaFromJsonString,
} from '../src/utils/omariistaParser';

const DOC_DIR = 'file:///data/user/0/host.exp.exponent/files/';

/** Muistinvarainen tiedostojärjestelmä testeihin. */
function createMemoryStorage(initial: Record<string, string> = {}) {
  const files: Record<string, string> = { ...initial };
  const storage: AreaStorage = {
    exists: async (uri) => uri in files,
    read: async (uri) => {
      if (!(uri in files)) throw new Error('ENOENT');
      return files[uri];
    },
    write: async (uri, text) => {
      files[uri] = text;
    },
    remove: async (uri) => {
      delete files[uri];
    },
  };
  return { files, storage };
}

const IMPORTED_AREA: HuntingArea = (() => {
  const result = importOmaRiistaFromJsonString(
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [25.1, 62.1],
                [25.2, 62.1],
                [25.2, 62.2],
                [25.1, 62.2],
                [25.1, 62.1],
              ],
            ],
          },
          properties: { name: 'Seuran Pohjoispalsta' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [25.15, 62.15] },
          properties: { id: 'x1', name: 'X1 Kallio' },
        },
      ],
    })
  );
  if (!result.ok) throw new Error('testialueen tuonti epäonnistui');
  return result.area;
})();

const IMPORTED_REGION = {
  latitude: 62.15,
  longitude: 25.15,
  latitudeDelta: 0.02,
  longitudeDelta: 0.03,
};

describe('Vakiot ja polku', () => {
  it('tiedostonimi ja polku documentDirectoryn alle', () => {
    expect(LAST_AREA_FILE_NAME).toBe('huntertracker_last_area.json');
    expect(buildLastAreaUri(DOC_DIR)).toBe(`${DOC_DIR}huntertracker_last_area.json`);
    // kestää juuren ilman loppukauttaviivaa
    expect(buildLastAreaUri(DOC_DIR.slice(0, -1))).toBe(
      `${DOC_DIR}huntertracker_last_area.json`
    );
  });

  it('oletusaloitusnäkymä on Hätilä (61.015 N, 24.535 E)', () => {
    expect(DEFAULT_START_REGION.latitude).toBeCloseTo(61.015, 6);
    expect(DEFAULT_START_REGION.longitude).toBeCloseTo(24.535, 6);
    expect(DEFAULT_START_REGION.latitudeDelta).toBeGreaterThan(0);
    expect(DEFAULT_START_REGION.longitudeDelta).toBeGreaterThan(0);
  });

  it('oletusalue = Hätilän testialue ja Hätilän kamera', () => {
    const def = getDefaultPersistedArea();
    expect(def.area).toEqual(getDefaultTestArea());
    expect(def.region).toEqual(DEFAULT_START_REGION);
    expect(def.name).toContain('Hätilä');
  });
});

describe('Sarjallistus ja jäsennys', () => {
  it('serialize -> parse palauttaa saman alueen, nimen ja kameran', () => {
    const text = serializePersistedArea(IMPORTED_AREA, IMPORTED_REGION, 1_700_000_000_000);
    const parsed = parsePersistedArea(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.area).toEqual(IMPORTED_AREA);
    expect(parsed.value.region).toEqual(IMPORTED_REGION);
    expect(parsed.value.name).toBe('Seuran Pohjoispalsta');
    expect(parsed.value.savedAt).toBe(1_700_000_000_000);
    expect(parsed.value.area.stands).toHaveLength(1);
  });

  it('ilman kameraa käytetään alueen keskipistettä', () => {
    const parsed = parsePersistedArea(serializePersistedArea(IMPORTED_AREA));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.region.latitude).toBeCloseTo(62.15, 6);
    expect(parsed.value.region.longitude).toBeCloseTo(25.15, 6);
  });

  it.each([
    ['tyhjä merkkijono', ''],
    ['rikkinäinen JSON', '{"version":1,"area":{'],
    ['null', 'null'],
    ['väärä versio', JSON.stringify({ version: 99, area: { stands: [] } })],
    ['alue puuttuu', JSON.stringify({ version: 1, name: 'x' })],
    [
      'passin koordinaatti ei ole luku',
      JSON.stringify({
        version: 1,
        name: 'x',
        area: { stands: [{ id: 'a', name: 'a', latitude: 'abc', longitude: 24 }] },
        region: IMPORTED_REGION,
      }),
    ],
    [
      'aluerajan koordinaatti puuttuu',
      JSON.stringify({
        version: 1,
        name: 'x',
        area: { boundary: { name: 'b', coordinates: [{ latitude: 61 }] }, stands: [] },
        region: IMPORTED_REGION,
      }),
    ],
    [
      'tyhjä alue (ei palstoja eikä passeja)',
      JSON.stringify({ version: 1, name: 'x', area: { stands: [] }, region: IMPORTED_REGION }),
    ],
  ])('hylkää vioittuneen sisällön: %s', (_label, text) => {
    const parsed = parsePersistedArea(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.length).toBeGreaterThan(0);
  });

  it('virheellinen kamera korvataan alueen keskipisteellä (alue säilyy)', () => {
    const raw = JSON.parse(serializePersistedArea(IMPORTED_AREA, IMPORTED_REGION));
    raw.region = { latitude: 'x', longitude: null, latitudeDelta: -1 };
    const parsed = parsePersistedArea(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.area).toEqual(IMPORTED_AREA);
    expect(parsed.value.region.latitude).toBeCloseTo(62.15, 6);
  });
});

describe('saveLastUsedArea / loadLastUsedArea', () => {
  it('ensimmäinen käynnistys ilman tiedostoa -> Hätilä (source=default)', async () => {
    const { storage } = createMemoryStorage();
    const loaded = await loadLastUsedArea(storage, DOC_DIR);
    expect(loaded.source).toBe('default');
    expect(loaded.area).toEqual(getDefaultTestArea());
    expect(loaded.region).toEqual(DEFAULT_START_REGION);
    expect(loaded.error).toBeUndefined();
  });

  it('tallennettu alue luetaan käynnistyksessä (source=saved)', async () => {
    const { storage, files } = createMemoryStorage();
    const saved = await saveLastUsedArea(storage, DOC_DIR, IMPORTED_AREA, IMPORTED_REGION);
    expect(saved.ok).toBe(true);
    expect(Object.keys(files)).toEqual([buildLastAreaUri(DOC_DIR)]);

    const loaded = await loadLastUsedArea(storage, DOC_DIR);
    expect(loaded.source).toBe('saved');
    expect(loaded.area).toEqual(IMPORTED_AREA);
    expect(loaded.region).toEqual(IMPORTED_REGION);
    expect(loaded.name).toBe('Seuran Pohjoispalsta');
  });

  it('uusi tallennus korvaa edellisen (viimeisin voittaa)', async () => {
    const { storage } = createMemoryStorage();
    await saveLastUsedArea(storage, DOC_DIR, getDefaultTestArea());
    await saveLastUsedArea(storage, DOC_DIR, IMPORTED_AREA, IMPORTED_REGION);
    const loaded = await loadLastUsedArea(storage, DOC_DIR);
    expect(loaded.area).toEqual(IMPORTED_AREA);
  });

  it('vioittunut tiedosto -> hallittu fallback Hätilään ja virheilmoitus', async () => {
    const { storage } = createMemoryStorage({
      [buildLastAreaUri(DOC_DIR)]: '{"version":1, "area": [rikki',
    });
    const loaded = await loadLastUsedArea(storage, DOC_DIR);
    expect(loaded.source).toBe('default');
    expect(loaded.area).toEqual(getDefaultTestArea());
    expect(loaded.region).toEqual(DEFAULT_START_REGION);
    expect(loaded.error).toBeDefined();
  });

  it('lukuvirhe tiedostojärjestelmästä ei kaada käynnistystä', async () => {
    const { storage } = createMemoryStorage({ [buildLastAreaUri(DOC_DIR)]: 'x' });
    storage.read = async () => {
      throw new Error('EACCES');
    };
    const loaded = await loadLastUsedArea(storage, DOC_DIR);
    expect(loaded.source).toBe('default');
    expect(loaded.error).toContain('EACCES');
  });

  it('kirjoitusvirhe palauttaa ok=false eikä heitä', async () => {
    const { storage } = createMemoryStorage();
    storage.write = async () => {
      throw new Error('ENOSPC');
    };
    const saved = await saveLastUsedArea(storage, DOC_DIR, IMPORTED_AREA);
    expect(saved.ok).toBe(false);
    if (!saved.ok) expect(saved.error).toContain('ENOSPC');
  });

  it('tyhjää aluetta ei tallenneta', async () => {
    const { storage, files } = createMemoryStorage();
    const saved = await saveLastUsedArea(storage, DOC_DIR, { stands: [] });
    expect(saved.ok).toBe(false);
    expect(Object.keys(files)).toHaveLength(0);
  });
});

describe('resetToDefaultArea', () => {
  it('poistaa tallennuksen ja palauttaa Hätilän', async () => {
    const { storage, files } = createMemoryStorage();
    await saveLastUsedArea(storage, DOC_DIR, IMPORTED_AREA, IMPORTED_REGION);

    const reset = await resetToDefaultArea(storage, DOC_DIR);
    expect(reset.source).toBe('default');
    expect(reset.area).toEqual(getDefaultTestArea());
    expect(reset.region).toEqual(DEFAULT_START_REGION);
    expect(Object.keys(files)).toHaveLength(0);

    const loaded = await loadLastUsedArea(storage, DOC_DIR);
    expect(loaded.source).toBe('default');
  });

  it('toimii myös, kun tallennusta ei ole tai poisto epäonnistuu', async () => {
    const { storage } = createMemoryStorage();
    await expect(resetToDefaultArea(storage, DOC_DIR)).resolves.toMatchObject({
      source: 'default',
    });
    storage.exists = async () => true;
    storage.remove = async () => {
      throw new Error('EBUSY');
    };
    const reset = await resetToDefaultArea(storage, DOC_DIR);
    expect(reset.area).toEqual(getDefaultTestArea());
    expect(reset.error).toContain('EBUSY');
  });
});

describe('createLegacyAreaStorage (expo-file-system/legacy -sovitin)', () => {
  function createFakeLegacyFs() {
    const files: Record<string, string> = {};
    const calls: string[] = [];
    const fs = {
      getInfoAsync: async (uri: string) => {
        calls.push(`info ${uri}`);
        return { exists: uri in files };
      },
      readAsStringAsync: async (uri: string, options?: { encoding?: string }) => {
        calls.push(`read ${uri} ${options?.encoding}`);
        if (!(uri in files)) throw new Error('ENOENT');
        return files[uri];
      },
      writeAsStringAsync: async (uri: string, contents: string, options?: { encoding?: string }) => {
        calls.push(`write ${uri} ${options?.encoding}`);
        files[uri] = contents;
      },
      deleteAsync: async (uri: string, options?: { idempotent?: boolean }) => {
        calls.push(`delete ${uri} idempotent=${options?.idempotent}`);
        delete files[uri];
      },
    };
    return { fs, files, calls };
  }

  it('kytkee exists/read/write/remove legacy-funktioihin UTF-8-koodauksella', async () => {
    const { fs, files, calls } = createFakeLegacyFs();
    const storage = createLegacyAreaStorage(fs);
    const uri = buildLastAreaUri(DOC_DIR);

    expect(await storage.exists(uri)).toBe(false);
    await storage.write(uri, '{"a":1}');
    expect(files[uri]).toBe('{"a":1}');
    expect(await storage.exists(uri)).toBe(true);
    expect(await storage.read(uri)).toBe('{"a":1}');
    await storage.remove(uri);
    expect(uri in files).toBe(false);

    expect(calls).toContain(`write ${uri} utf8`);
    expect(calls).toContain(`read ${uri} utf8`);
    expect(calls).toContain(`delete ${uri} idempotent=true`);
  });

  it('koko tallennus-lataus-nollaus-kierros toimii sovittimen läpi', async () => {
    const { fs } = createFakeLegacyFs();
    const storage = createLegacyAreaStorage(fs);
    expect((await saveLastUsedArea(storage, DOC_DIR, IMPORTED_AREA, IMPORTED_REGION)).ok).toBe(true);
    const loaded = await loadLastUsedArea(storage, DOC_DIR);
    expect(loaded.source).toBe('saved');
    expect(loaded.area).toEqual(IMPORTED_AREA);
    expect((await resetToDefaultArea(storage, DOC_DIR)).source).toBe('default');
    expect((await loadLastUsedArea(storage, DOC_DIR)).source).toBe('default');
  });

  it('getInfoAsync-virhe näkyy latauksessa hallitusti (ei kaada)', async () => {
    const { fs } = createFakeLegacyFs();
    fs.getInfoAsync = async () => {
      throw new Error('EIO');
    };
    const loaded = await loadLastUsedArea(createLegacyAreaStorage(fs), DOC_DIR);
    expect(loaded.source).toBe('default');
    expect(loaded.error).toContain('EIO');
  });
});

describe('shouldPersistRegion (kameran tallennuksen kynnys)', () => {
  const base = DEFAULT_START_REGION;

  it('ensimmäinen kamera tallennetaan aina', () => {
    expect(shouldPersistRegion(null, base)).toBe(true);
  });

  it('pieni nykäys ei aiheuta kirjoitusta', () => {
    expect(
      shouldPersistRegion(base, { ...base, latitude: base.latitude + 0.00001 })
    ).toBe(false);
  });

  it('selvä siirto tai zoomaus tallennetaan', () => {
    expect(shouldPersistRegion(base, { ...base, latitude: base.latitude + 0.01 })).toBe(true);
    expect(
      shouldPersistRegion(base, { ...base, latitudeDelta: base.latitudeDelta / 2 })
    ).toBe(true);
  });

  it('virheellistä kameraa ei tallenneta', () => {
    expect(shouldPersistRegion(base, { ...base, latitude: NaN })).toBe(false);
    expect(shouldPersistRegion(base, { ...base, latitudeDelta: 0 })).toBe(false);
  });
});

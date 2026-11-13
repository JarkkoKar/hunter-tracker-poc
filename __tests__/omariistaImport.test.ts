import { describe, it, expect } from '@jest/globals';
import {
  importOmaRiistaFromJsonString,
  calculateAreaCenter,
  getDefaultTestArea,
  DEFAULT_TEST_AREA_GEOJSON,
  isSupportedGeoJsonFileName,
  MAX_IMPORT_TEXT_LENGTH,
  HuntingArea,
  readImportFileText,
  parseOmaRiistaGeoJSON,
  getAreaPolygons,
  etrsTm35finToWgs84,
  wgs84ToEtrsTm35fin,
} from '../src/utils/omariistaParser';

// ---------------------------------------------------------------------------
// Oikeat OmaRiista-viennit: MultiPolygon, MultiPoint, juurityypit, TM35FIN
// ---------------------------------------------------------------------------

const square = (lon: number, lat: number, size: number) => [
  [lon, lat],
  [lon + size, lat],
  [lon + size, lat + size],
  [lon, lat + size],
  [lon, lat],
];

describe('MultiPolygon: monipalstaiset alueet', () => {
  const multi = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'MultiPolygon',
          coordinates: [[square(24.0, 61.0, 0.01)], [square(24.1, 61.1, 0.1)]],
        },
        properties: { nimi: 'Seura Y' },
      },
    ],
  };

  it('ottaa kaikki palstat talteen ja suurimman päärajaksi', () => {
    const area = parseOmaRiistaGeoJSON(multi);
    const polygons = getAreaPolygons(area);
    expect(polygons).toHaveLength(2);
    expect(area.boundary?.name).toBe('Seura Y');
    expect(area.boundary?.coordinates[0]).toEqual({ latitude: 61.1, longitude: 24.1 });
    expect(area.boundary?.coordinates).toHaveLength(5);
  });

  it('ottaa vain ulkokehän (reiät ohitetaan)', () => {
    const withHole = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [square(24, 61, 0.1), square(24.04, 61.04, 0.01)] },
      properties: { name: 'Reiällinen' },
    };
    const area = parseOmaRiistaGeoJSON(withHole);
    expect(getAreaPolygons(area)).toHaveLength(1);
    expect(area.boundary?.coordinates[0]).toEqual({ latitude: 61, longitude: 24 });
  });

  it('useasta Polygon-featuresta suurin on pääraja, kaikki palstoina', () => {
    const two = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [square(25, 62, 0.2)] }, properties: { name: 'Iso' } },
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [square(25.5, 62, 0.01)] }, properties: { name: 'Pieni' } },
      ],
    };
    const area = parseOmaRiistaGeoJSON(two);
    expect(getAreaPolygons(area).map((p) => p.name)).toEqual(['Iso', 'Pieni']);
    expect(area.boundary?.name).toBe('Iso');
  });

  it('kamera keskittyy kaikkien palstojen yhteiseen rajaukseen', () => {
    const r = importOmaRiistaFromJsonString(JSON.stringify(multi));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const region = calculateAreaCenter(r.area)!;
    expect(region.latitude).toBeCloseTo(61.1, 6);
    expect(region.longitude).toBeCloseTo(24.1, 6);
  });

  it('getAreaPolygons toimii myös vanhalle alueelle, jolla on vain boundary', () => {
    const legacy: HuntingArea = {
      boundary: { name: 'B', coordinates: [{ latitude: 61, longitude: 24 }] },
      stands: [],
    };
    expect(getAreaPolygons(legacy)).toHaveLength(1);
    expect(getAreaPolygons({ stands: [] })).toEqual([]);
  });
});

describe('MultiPoint ja juuritasot (Feature, GeometryCollection, pelkkä geometria)', () => {
  it('MultiPoint: jokainen piste on oma passi yksilöllisellä tunnisteella', () => {
    const mp = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'MultiPoint', coordinates: [[24.05, 61.05], [24.06, 61.06]] },
          properties: { nimi: 'Passit' },
        },
      ],
    };
    const area = parseOmaRiistaGeoJSON(mp);
    expect(area.stands.map((s) => s.name)).toEqual(['Passit 1', 'Passit 2']);
    expect(new Set(area.stands.map((s) => s.id)).size).toBe(2);
    expect(area.stands[1]).toMatchObject({ latitude: 61.06, longitude: 24.06 });
  });

  it('juuritaso on yksittäinen Feature', () => {
    const r = importOmaRiistaFromJsonString(
      JSON.stringify({
        type: 'Feature',
        geometry: { type: 'MultiPolygon', coordinates: [[square(24, 61, 0.1)]] },
        properties: { name: 'Yksi Feature' },
      })
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.area.boundary?.name).toBe('Yksi Feature');
  });

  it('juuritaso on GeometryCollection (myös sisäkkäinen)', () => {
    const r = importOmaRiistaFromJsonString(
      JSON.stringify({
        type: 'GeometryCollection',
        geometries: [
          { type: 'Polygon', coordinates: [square(24, 61, 0.1)] },
          { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [24.05, 61.05] }] },
        ],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(getAreaPolygons(r.area)).toHaveLength(1);
    expect(r.area.stands).toHaveLength(1);
  });

  it('Featuren geometria voi olla GeometryCollection', () => {
    const area = parseOmaRiistaGeoJSON({
      type: 'Feature',
      geometry: {
        type: 'GeometryCollection',
        geometries: [
          { type: 'Polygon', coordinates: [square(24, 61, 0.1)] },
          { type: 'Point', coordinates: [24.05, 61.05] },
        ],
      },
      properties: { name: 'Sekalainen' },
    });
    expect(area.boundary?.name).toBe('Sekalainen');
    expect(area.stands).toHaveLength(1);
  });

  it('juuritaso on pelkkä geometria (MultiPolygon)', () => {
    const r = importOmaRiistaFromJsonString(
      JSON.stringify({ type: 'MultiPolygon', coordinates: [[square(24, 61, 0.1)], [square(24.2, 61, 0.05)]] })
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(getAreaPolygons(r.area)).toHaveLength(2);
  });

  it('kolmas koordinaatti (korkeus) ohitetaan', () => {
    const area = parseOmaRiistaGeoJSON({ type: 'Point', coordinates: [24.05, 61.05, 120] });
    expect(area.stands[0]).toMatchObject({ latitude: 61.05, longitude: 24.05 });
  });
});

describe('Passien nimet OmaRiistan ominaisuuskentistä', () => {
  const pt = (properties: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.05, 61.05] },
    properties,
    ...extra,
  });

  it('tunnistaa name, nimi, title, numero ja id', () => {
    const area = parseOmaRiistaGeoJSON({
      type: 'FeatureCollection',
      features: [
        pt({ nimi: 'Kuusikko' }),
        pt({ title: 'Kallio' }),
        pt({ numero: 7 }),
        pt({ id: 'P9' }),
        pt({}),
      ],
    });
    expect(area.stands.map((s) => s.name)).toEqual([
      'Kuusikko',
      'Kallio',
      'Passi 7',
      'Passi P9',
      'Passi 5',
    ]);
  });

  it('name on ensisijainen muihin nähden', () => {
    const area = parseOmaRiistaGeoJSON(pt({ name: 'A', nimi: 'B', title: 'C', numero: 1 }));
    expect(area.stands[0].name).toBe('A');
  });

  it('tunnisteet ovat deterministisiä ja yksilöllisiä (myös Featuren id ja duplikaatit)', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [pt({ nimi: 'Sama' }), pt({ nimi: 'Sama' }), pt({}, { id: 42 }), pt({})],
    };
    const a = parseOmaRiistaGeoJSON(fc);
    const b = parseOmaRiistaGeoJSON(fc);
    expect(a.stands.map((s) => s.id)).toEqual(b.stands.map((s) => s.id));
    expect(new Set(a.stands.map((s) => s.id)).size).toBe(4);
    expect(a.stands[2].id).toBe('42');
  });

  it('palstan nimi tunnistetaan samoista kentistä', () => {
    const area = parseOmaRiistaGeoJSON({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [square(24, 61, 0.1)] },
      properties: { title: 'Lohko Title' },
    });
    expect(area.boundary?.name).toBe('Lohko Title');
  });
});

describe('ETRS-TM35FIN (EPSG:3067) <-> WGS84', () => {
  // Riippumaton tarkistus: GRS80-ellipsoidin meridiaanikaari numeerisella integroinnilla
  const meridianArc = (latDeg: number) => {
    const a = 6378137;
    const f = 1 / 298.257222101;
    const e2 = f * (2 - f);
    const phi = (latDeg * Math.PI) / 180;
    const steps = 20000;
    const h = phi / steps;
    const g = (t: number) => (a * (1 - e2)) / Math.pow(1 - e2 * Math.sin(t) ** 2, 1.5);
    let sum = g(0) + g(phi);
    for (let i = 1; i < steps; i++) sum += (i % 2 === 0 ? 2 : 4) * g(i * h);
    return (sum * h) / 3;
  };

  it('keskimeridiaanilla (27°E) pohjoiskoordinaatti = 0.9996 × meridiaanikaari', () => {
    for (const lat of [60, 62.5, 65, 69.5]) {
      const n = 0.9996 * meridianArc(lat);
      const wgs = etrsTm35finToWgs84(500000, n);
      expect(wgs.latitude).toBeCloseTo(lat, 7);
      expect(wgs.longitude).toBeCloseTo(27, 9);
    }
  });

  it('meno-paluu WGS84 -> TM35FIN -> WGS84 säilyttää sijainnin (< 1 mm)', () => {
    const points = [
      { latitude: 60.1699, longitude: 24.9384 }, // Helsinki
      { latitude: 65.0121, longitude: 25.4651 }, // Oulu
      { latitude: 69.9, longitude: 27.0 },
      { latitude: 60.0, longitude: 20.5 }, // Ahvenanmaa, kaukana keskimeridiaanista
      { latitude: 63.0, longitude: 31.5 },
    ];
    for (const p of points) {
      const tm = wgs84ToEtrsTm35fin(p.latitude, p.longitude);
      const back = etrsTm35finToWgs84(tm.easting, tm.northing);
      expect(back.latitude).toBeCloseTo(p.latitude, 8);
      expect(back.longitude).toBeCloseTo(p.longitude, 8);
    }
  });

  it('itä-länsi-symmetria keskimeridiaanin suhteen', () => {
    const west = etrsTm35finToWgs84(500000 - 150000, 6900000);
    const east = etrsTm35finToWgs84(500000 + 150000, 6900000);
    expect(west.latitude).toBeCloseTo(east.latitude, 9);
    expect(27 - west.longitude).toBeCloseTo(east.longitude - 27, 9);
  });

  it('tyypillinen jahtialueen koordinaatti piirtyy oikeaan paikkaan Suomea', () => {
    const p = etrsTm35finToWgs84(385000, 6770000);
    expect(p.latitude).toBeGreaterThan(61.0);
    expect(p.latitude).toBeLessThan(61.15);
    expect(p.longitude).toBeGreaterThan(24.8);
    expect(p.longitude).toBeLessThan(24.95);
  });

  it('tuonti tunnistaa metrikoordinaatit ja muuntaa koko tiedoston WGS84:ksi', () => {
    const tm35 = {
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3067' } },
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [[[385000, 6770000], [390000, 6770000], [390000, 6775000], [385000, 6775000], [385000, 6770000]]],
            ],
          },
          properties: { nimi: 'Lohko TM35' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [387500, 6772500] },
          properties: { numero: 3 },
        },
      ],
    };
    const r = importOmaRiistaFromJsonString(JSON.stringify(tm35));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.join(' ')).toMatch(/ETRS-TM35FIN/);
    const all = [...getAreaPolygons(r.area).flatMap((p) => p.coordinates), ...r.area.stands];
    for (const c of all) {
      expect(c.latitude).toBeGreaterThan(59);
      expect(c.latitude).toBeLessThan(71);
      expect(c.longitude).toBeGreaterThan(19);
      expect(c.longitude).toBeLessThan(32);
    }
    expect(r.area.stands[0].name).toBe('Passi 3');
    // Passi on palstan sisällä myös muunnoksen jälkeen
    const region = calculateAreaCenter(r.area)!;
    expect(r.area.stands[0].latitude).toBeCloseTo(region.latitude, 3);
    expect(r.area.stands[0].longitude).toBeCloseTo(region.longitude, 2);
  });
});

const VALID_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [25.0, 62.0],
            [25.2, 62.0],
            [25.2, 62.1],
            [25.0, 62.1],
            [25.0, 62.0],
          ],
        ],
      },
      properties: { name: 'Seura X / Lohko 7' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [25.05, 62.05] },
      properties: { id: 'a1', name: 'A1 Suo' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [25.15, 62.08] },
      properties: { id: 'a2', name: 'A2 Harju' },
    },
  ],
};

const expectError = (text: string, pattern: RegExp) => {
  const r = importOmaRiistaFromJsonString(text);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(pattern);
};

describe('importOmaRiistaFromJsonString: onnistunut tuonti', () => {
  it('jäsentää aluerajan ja passit raakatekstistä', () => {
    const r = importOmaRiistaFromJsonString(JSON.stringify(VALID_GEOJSON));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.area.boundary?.name).toBe('Seura X / Lohko 7');
    expect(r.area.boundary?.coordinates).toHaveLength(5);
    expect(r.area.stands.map((s) => s.id)).toEqual(['a1', 'a2']);
    expect(r.area.stands[0]).toMatchObject({ latitude: 62.05, longitude: 25.05 });
    expect(r.warnings).toEqual([]);
  });

  it('sietää UTF-8 BOM:n ja ympäröivät välilyönnit (Windows-tallenteet)', () => {
    const r = importOmaRiistaFromJsonString(`﻿  \n${JSON.stringify(VALID_GEOJSON)}\n `);
    expect(r.ok).toBe(true);
  });

  it('pelkät passit ilman aluerajaa hyväksytään varoituksella', () => {
    const onlyPoints = { ...VALID_GEOJSON, features: VALID_GEOJSON.features.slice(1) };
    const r = importOmaRiistaFromJsonString(JSON.stringify(onlyPoints));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.area.boundary).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/aluerajaa/i);
  });

  it('pelkkä aluraja ilman passeja hyväksytään varoituksella', () => {
    const onlyPolygon = { ...VALID_GEOJSON, features: VALID_GEOJSON.features.slice(0, 1) };
    const r = importOmaRiistaFromJsonString(JSON.stringify(onlyPolygon));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.area.stands).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/passi/i);
  });
});

describe('importOmaRiistaFromJsonString: hallittu hylkäys (ei kaatumista)', () => {
  it('tyhjä tiedosto', () => {
    expectError('', /tyhjä/i);
    expectError('   \n ', /tyhjä/i);
  });

  it('virheellinen JSON-syntaksi', () => {
    expect(() => importOmaRiistaFromJsonString('{"type": "FeatureCollection", ')).not.toThrow();
    expectError('{"type": "FeatureCollection", ', /JSON/);
    expectError('tämä ei ole json', /JSON/);
  });

  it('JSON, mutta ei FeatureCollection-rakennetta', () => {
    expectError('[1, 2, 3]', /FeatureCollection/);
    expectError('null', /FeatureCollection/);
    expectError(JSON.stringify({ type: 'Topology', objects: {} }), /FeatureCollection/);
    expectError(JSON.stringify({ type: 'FeatureCollection' }), /features/);
    expectError(JSON.stringify({ type: 'FeatureCollection', features: 'x' }), /features/);
  });

  it('FeatureCollection ilman aluerajaa ja passeja', () => {
    expectError(JSON.stringify({ type: 'FeatureCollection', features: [] }), /aluerajaa.*passi/i);
    const lines = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[25, 62], [25.1, 62.1]] } },
      ],
    };
    expectError(JSON.stringify(lines), /aluerajaa.*passi/i);
  });

  it('tuntematon projisoitu koordinaatisto (esim. Web Mercator) hylätään selkeästi', () => {
    const webMercator = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [2_700_000, 8_600_000] },
          properties: { name: 'P' },
        },
      ],
    };
    expectError(JSON.stringify(webMercator), /koordinaatisto/i);
  });

  it('asteet ja metrit sekaisin samassa tiedostossa hylätään', () => {
    const mixed = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [24.05, 61.05] }, properties: {} },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [385000, 6770000] }, properties: {} },
      ],
    };
    expectError(JSON.stringify(mixed), /sekaisin/i);
  });

  it('liian suuri tiedosto hylätään ennen jäsennystä', () => {
    expect(MAX_IMPORT_TEXT_LENGTH).toBe(5_000_000);
    expectError(' '.repeat(MAX_IMPORT_TEXT_LENGTH + 1) + '{}', /liian suuri/i);
  });
});

describe('calculateAreaCenter: kameran keskitys uuteen alueeseen', () => {
  it('aluerajan rajauksen keskipiste ja marginaalilla laajennettu näkymä', () => {
    const r = importOmaRiistaFromJsonString(JSON.stringify(VALID_GEOJSON));
    if (!r.ok) throw new Error('fixture');
    const region = calculateAreaCenter(r.area);
    expect(region).not.toBeNull();
    expect(region!.latitude).toBeCloseTo(62.05, 6);
    expect(region!.longitude).toBeCloseTo(25.1, 6);
    // Alue 0.1° x 0.2°, marginaali 1.3x
    expect(region!.latitudeDelta).toBeCloseTo(0.13, 6);
    expect(region!.longitudeDelta).toBeCloseTo(0.26, 6);
  });

  it('ilman aluerajaa käyttää passien rajausta', () => {
    const area: HuntingArea = {
      stands: [
        { id: 'a', name: 'A', latitude: 60.0, longitude: 23.0 },
        { id: 'b', name: 'B', latitude: 60.2, longitude: 23.4 },
      ],
    };
    const region = calculateAreaCenter(area);
    expect(region!.latitude).toBeCloseTo(60.1, 6);
    expect(region!.longitude).toBeCloseTo(23.2, 6);
  });

  it('huomioi alueen ulkopuoliset passit, jotta kaikki näkyvät', () => {
    const area: HuntingArea = {
      boundary: {
        name: 'B',
        coordinates: [
          { latitude: 61.0, longitude: 24.0 },
          { latitude: 61.1, longitude: 24.1 },
        ],
      },
      stands: [{ id: 's', name: 'S', latitude: 61.3, longitude: 24.05 }],
    };
    const region = calculateAreaCenter(area)!;
    expect(region.latitude).toBeCloseTo(61.15, 6);
    expect(region.latitudeDelta).toBeCloseTo(0.3 * 1.3, 6);
  });

  it('yksittäinen piste saa vähimmäiszoomin (ei nollaa)', () => {
    const area: HuntingArea = { stands: [{ id: 'x', name: 'X', latitude: 61, longitude: 24 }] };
    const region = calculateAreaCenter(area)!;
    expect(region.latitudeDelta).toBeGreaterThan(0);
    expect(region.longitudeDelta).toBeGreaterThan(0);
  });

  it('tyhjä alue -> null', () => {
    expect(calculateAreaCenter({ stands: [] })).toBeNull();
  });
});

describe('Oletustestialue (Hirvilohko 1)', () => {
  it('palauttaa Hirvilohko 1 -alueen ja neljä passia', () => {
    const area = getDefaultTestArea();
    expect(area.boundary?.name).toContain('Hirvilohko 1');
    expect(area.stands.map((s) => s.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(area.stands[0].name).toBe('P1 Kuusikko');
  });

  it('on sama kuin tuotu DEFAULT_TEST_AREA_GEOJSON (kiertää tuontireitin)', () => {
    const r = importOmaRiistaFromJsonString(JSON.stringify(DEFAULT_TEST_AREA_GEOJSON));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.area).toEqual(getDefaultTestArea());
  });

  it('palauttaa joka kerta uuden kopion (muutos ei vuoda)', () => {
    const a = getDefaultTestArea();
    a.stands.pop();
    expect(getDefaultTestArea().stands).toHaveLength(4);
  });

  it('keskittyy alueen keskelle (61.05, 24.05)', () => {
    const region = calculateAreaCenter(getDefaultTestArea())!;
    expect(region.latitude).toBeCloseTo(61.05, 6);
    expect(region.longitude).toBeCloseTo(24.05, 6);
  });
});

describe('readImportFileText: file:// ja content:// (Android Document Picker)', () => {
  const GEOJSON_TEXT = JSON.stringify(VALID_GEOJSON);
  const FILE_URI = 'file:///data/user/0/host.exp.exponent/cache/DocumentPicker/abc/lohko.geojson';
  const CONTENT_URI = 'content://com.android.providers.downloads.documents/document/msf%3A1234';

  const makeReaders = (primary: (uri: string) => Promise<string>, fallback?: (uri: string) => Promise<string>) => {
    const calls = { primary: [] as string[], fallback: [] as string[] };
    return {
      calls,
      readers: {
        readAsString: async (uri: string) => {
          calls.primary.push(uri);
          return primary(uri);
        },
        fetchText: fallback
          ? async (uri: string) => {
              calls.fallback.push(uri);
              return fallback(uri);
            }
          : undefined,
      },
    };
  };

  it('lukee file://-osoitteen ensisijaisella lukijalla', async () => {
    const { readers, calls } = makeReaders(async () => GEOJSON_TEXT, async () => 'ei käytetä');
    const r = await readImportFileText(FILE_URI, readers);
    expect(r).toEqual({ ok: true, text: GEOJSON_TEXT, source: 'primary' });
    expect(calls.primary).toEqual([FILE_URI]);
    expect(calls.fallback).toEqual([]);
  });

  it('lukee content://-osoitteen ensisijaisella lukijalla', async () => {
    const { readers, calls } = makeReaders(async () => GEOJSON_TEXT);
    const r = await readImportFileText(CONTENT_URI, readers);
    expect(r.ok).toBe(true);
    expect(calls.primary).toEqual([CONTENT_URI]);
  });

  it('jos ensisijainen hylätään (Android content://), käytetään fetch-varalukijaa', async () => {
    const { readers, calls } = makeReaders(
      async () => {
        throw new Error('Call to function FileSystemFile.text has been rejected');
      },
      async () => GEOJSON_TEXT
    );
    const r = await readImportFileText(CONTENT_URI, readers);
    expect(r).toEqual({ ok: true, text: GEOJSON_TEXT, source: 'fallback' });
    expect(calls.fallback).toEqual([CONTENT_URI]);
  });

  it('molempien lukijoiden epäonnistuessa palautetaan selkeä virhe (ei heitä)', async () => {
    const { readers } = makeReaders(
      async () => {
        throw new Error('Call to function FileSystemFile.text has been rejected');
      },
      async () => {
        throw new Error('Network request failed');
      }
    );
    const r = await readImportFileText(CONTENT_URI, readers);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/luku epäonnistui/i);
      expect(r.error).toContain('FileSystemFile.text has been rejected');
      expect(r.error).toContain('Network request failed');
    }
  });

  it('ilman varalukijaa ensisijaisen virhe palautetaan hallitusti', async () => {
    const { readers } = makeReaders(async () => {
      throw new Error('permission denied');
    });
    const r = await readImportFileText(FILE_URI, readers);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('permission denied');
  });

  it('tyhjä tiedosto (myös pelkkä BOM tai välilyönnit) antaa selkeän virheen', async () => {
    for (const empty of ['', '   \n', '﻿']) {
      const { readers } = makeReaders(async () => empty);
      const r = await readImportFileText(FILE_URI, readers);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/tyhjä/i);
    }
  });

  it('puuttuva tai tukematon osoite hylätään ennen lukemista', async () => {
    const { readers, calls } = makeReaders(async () => GEOJSON_TEXT);
    const missing = await readImportFileText('', readers);
    expect(missing.ok).toBe(false);
    const http = await readImportFileText('https://example.com/lohko.geojson', readers);
    expect(http.ok).toBe(false);
    if (!http.ok) expect(http.error).toMatch(/file:\/\/.*content:\/\//);
    expect(calls.primary).toEqual([]);
  });

  it('luettu teksti kulkee suoraan tuontiin (päästä päähän)', async () => {
    const { readers } = makeReaders(async () => `﻿${GEOJSON_TEXT}`);
    const read = await readImportFileText(CONTENT_URI, readers);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const imported = importOmaRiistaFromJsonString(read.text);
    expect(imported.ok).toBe(true);
  });
});

describe('Tiedostotyypin tarkistus', () => {
  it('hyväksyy .geojson ja .json (kirjainkoosta riippumatta)', () => {
    expect(isSupportedGeoJsonFileName('lohko.geojson')).toBe(true);
    expect(isSupportedGeoJsonFileName('LOHKO.JSON')).toBe(true);
    expect(isSupportedGeoJsonFileName('Seura X alue.GeoJSON')).toBe(true);
  });

  it('hylkää muut ja puuttuvan nimen', () => {
    expect(isSupportedGeoJsonFileName('kuva.png')).toBe(false);
    expect(isSupportedGeoJsonFileName('alue.geojson.zip')).toBe(false);
    expect(isSupportedGeoJsonFileName('')).toBe(false);
    expect(isSupportedGeoJsonFileName(undefined)).toBe(false);
  });
});

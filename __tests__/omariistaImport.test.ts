import { describe, it, expect } from '@jest/globals';
import {
  importOmaRiistaFromJsonString,
  calculateAreaCenter,
  getDefaultTestArea,
  DEFAULT_TEST_AREA_GEOJSON,
  isSupportedGeoJsonFileName,
  MAX_IMPORT_TEXT_LENGTH,
  HuntingArea,
} from '../src/utils/omariistaParser';

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
    expectError(JSON.stringify(VALID_GEOJSON.features[0]), /FeatureCollection/);
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

  it('projisoidut koordinaatit (ETRS-TM35FIN / EPSG:3067) hylätään selkeästi', () => {
    const tm35 = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[[385000, 6770000], [386000, 6770000], [386000, 6771000], [385000, 6770000]]],
          },
          properties: { name: 'Lohko TM35' },
        },
      ],
    };
    expectError(JSON.stringify(tm35), /WGS84/);
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

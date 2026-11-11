import { describe, it, expect } from '@jest/globals';
import { parseOmaRiistaGeoJSON } from '../src/utils/omariistaParser';

describe('OmaRiista GeoJSON Parser', () => {
  const sampleGeoJSON = {
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
              [24.0, 61.0]
            ]
          ]
        },
        properties: { name: 'Hirvilohko Pohjoinen' }
      },
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [24.05, 61.05]
        },
        properties: { name: 'P1 Kuusikko' }
      },
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [24.08, 61.07]
        },
        properties: { name: 'P2 Kallio' }
      }
    ]
  };

  it('erottelee aluerajan ja passipisteet oikein', () => {
    const result = parseOmaRiistaGeoJSON(sampleGeoJSON);

    expect(result.boundary).toBeDefined();
    expect(result.boundary?.name).toBe('Hirvilohko Pohjoinen');
    expect(result.stands.length).toBe(2);
    expect(result.stands[0].name).toBe('P1 Kuusikko');
    expect(result.stands[0].latitude).toBe(61.05);
    expect(result.stands[0].longitude).toBe(24.05);
  });
});

import { describe, it, expect } from '@jest/globals';
import { generateSectorPolygonCoordinates } from '../src/utils/safetySector';

describe('Safety Sector Map Visualization Polygon Generator', () => {
  const center = { latitude: 61.05, longitude: 24.05 };

  it('muodostaa suljetun sektorimonikulmion (alkupiste, kaaripisteet, paluu alkupisteeseen)', () => {
    // 60 asteen viuhka pohjoiseen (330 -> 30 deg), säde 300 metriä
    const coords = generateSectorPolygonCoordinates(center, 330, 30, 300);

    // Varmistetaan, että koordinaatteja on useita (kaaren piirto)
    expect(coords.length).toBeGreaterThan(3);

    // Ensimmäinen piste on itse passi
    expect(coords[0].latitude).toBeCloseTo(center.latitude, 4);
    expect(coords[0].longitude).toBeCloseTo(center.longitude, 4);

    // Viimeinen piste sulkee kuvion takaisin passiin
    const last = coords[coords.length - 1];
    expect(last.latitude).toBeCloseTo(center.latitude, 4);
    expect(last.longitude).toBeCloseTo(center.longitude, 4);
  });
});

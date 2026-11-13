import { describe, it, expect } from '@jest/globals';
import { calculateDistanceMeters, findNearestStand } from '../src/utils/safetySector';

describe('Location and Nearest Stand Detection', () => {
  const stands = [
    { id: 'p1', name: 'P1 Kuusikko', latitude: 61.0500, longitude: 24.0500 },
    { id: 'p2', name: 'P2 Kallio', latitude: 61.0600, longitude: 24.0500 },
    { id: 'p3', name: 'P3 Tiehaara', latitude: 61.0500, longitude: 24.0700 },
  ];

  it('laskee oikean et‰isyyden kahden koordinaatin v‰lill‰ metrein‰', () => {
    // 61.0500 -> 61.0600 samalla pituuspiirill‰ on n. 1112 metri‰
    const dist = calculateDistanceMeters(
      { latitude: 61.0500, longitude: 24.0500 },
      { latitude: 61.0600, longitude: 24.0500 }
    );
    expect(dist).toBeGreaterThan(1100);
    expect(dist).toBeLessThan(1130);
  });

  it('tunnistaa l‰himm‰n passin, kun k‰ytt‰j‰ on sen l‰heisyydess‰', () => {
    // K‰ytt‰j‰ on 20 metrin p‰‰ss‰ P1-passista
    const userLocation = { latitude: 61.0501, longitude: 24.0501 };
    const nearest = findNearestStand(userLocation, stands, 100);

    expect(nearest).not.toBeNull();
    expect(nearest?.stand.id).toBe('p1');
    expect(nearest?.distanceMeters).toBeLessThan(50);
  });

  it('palauttaa null, jos k‰ytt‰j‰ on liian kaukana mist‰‰n passista', () => {
    // K‰ytt‰j‰ on useiden kilometrien p‰‰ss‰
    const userLocation = { latitude: 61.1000, longitude: 24.1000 };
    const nearest = findNearestStand(userLocation, stands, 100);

    expect(nearest).toBeNull();
  });
});

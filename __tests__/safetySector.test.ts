import { describe, it, expect } from '@jest/globals';
import { calculateBearing, calculateDangerZones, isDirectionSafe } from '../src/utils/safetySector';

describe('Safety Sector & Danger Zone Logic', () => {
  // Testipisteet: Oma passi (61.0, 24.0)
  const myStand = { id: 'p1', name: 'Oma Passi', latitude: 61.0, longitude: 24.0 };
  
  // Naapuri suoraan pohjoisessa (suunta ~0 astetta)
  const northNeighbor = { id: 'p2', name: 'Pohjoinen Naapuri', latitude: 61.01, longitude: 24.0 };
  
  // Naapuri suoraan id‰ss‰ (suunta ~90 astetta)
  const eastNeighbor = { id: 'p3', name: 'It‰inen Naapuri', latitude: 61.0, longitude: 24.02 };

  it('laskee kompassisuuntiman (bearing) oikein', () => {
    const bearingNorth = calculateBearing(myStand, northNeighbor);
    expect(Math.round(bearingNorth)).toBe(0);

    const bearingEast = calculateBearing(myStand, eastNeighbor);
    expect(Math.round(bearingEast)).toBe(90);
  });

  it('muodostaa naapurille +-15 asteen kieltokulman', () => {
    const dangerZones = calculateDangerZones(myStand, [northNeighbor, eastNeighbor]);
    
    expect(dangerZones.length).toBe(2);
    
    // Pohjoinen naapuri (0 deg): kieltoalue 345 deg -> 15 deg
    const northZone = dangerZones.find(z => z.standId === 'p2');
    expect(northZone).toBeDefined();
    expect(northZone?.centerAngle).toBeCloseTo(0, 0);
    expect(northZone?.startAngle).toBeCloseTo(345, 0);
    expect(northZone?.endAngle).toBeCloseTo(15, 0);
  });

  it('tunnistaa onko ampumasuunta turvallinen vai osuuko kieltokulmaan', () => {
    const dangerZones = calculateDangerZones(myStand, [northNeighbor]);

    // Suoraan pohjoiseen (0 deg) ampuminen on vaarallista
    expect(isDirectionSafe(0, dangerZones)).toBe(false);
    // 10 astetta pohjoisesta on edelleen vaara-alueella (+-15)
    expect(isDirectionSafe(10, dangerZones)).toBe(false);
    // 25 astetta pohjoisesta on turvallinen
    expect(isDirectionSafe(25, dangerZones)).toBe(true);
    // 180 astetta (etel‰‰n) on turvallinen
    expect(isDirectionSafe(180, dangerZones)).toBe(true);
  });
});

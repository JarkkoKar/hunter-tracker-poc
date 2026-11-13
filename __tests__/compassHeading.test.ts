import { describe, it, expect } from '@jest/globals';
import {
  MapOrientationMode,
  calculateHeadingFromMagnetometer,
  smoothHeading,
  generateViewConeCoordinates,
  getCameraHeadingForMode,
  toggleMapOrientationMode,
} from '../src/utils/compassHeading';
import { calculateBearing, calculateDistanceMeters } from '../src/utils/safetySector';

describe('Kompassi: magnetometrin x/y -> atsimuutti (0-360)', () => {
  // Puhelin vaakatasossa näyttö ylöspäin. Magneettikentän vaakakomponentti osoittaa pohjoiseen.
  it('yläreuna pohjoiseen (kenttä +y) -> 0°', () => {
    expect(calculateHeadingFromMagnetometer({ x: 0, y: 30 })).toBeCloseTo(0, 5);
  });

  it('yläreuna itään (pohjoinen vasemmalla, kenttä -x) -> 90°', () => {
    expect(calculateHeadingFromMagnetometer({ x: -30, y: 0 })).toBeCloseTo(90, 5);
  });

  it('yläreuna etelään (kenttä -y) -> 180°', () => {
    expect(calculateHeadingFromMagnetometer({ x: 0, y: -30 })).toBeCloseTo(180, 5);
  });

  it('yläreuna länteen (kenttä +x) -> 270°', () => {
    expect(calculateHeadingFromMagnetometer({ x: 30, y: 0 })).toBeCloseTo(270, 5);
  });

  it('palauttaa aina arvon välillä [0, 360)', () => {
    const samples = [
      { x: 12, y: 25 },
      { x: -5, y: -40 },
      { x: 33, y: -1 },
      { x: -0.001, y: 50 },
    ];
    for (const s of samples) {
      const h = calculateHeadingFromMagnetometer(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it('huomioi valinnaisen erannon (deklinaation) korjauksen', () => {
    // Pohjoiseen osoittava lukema + 10° itäinen eranto -> 10° tosisuunta
    expect(calculateHeadingFromMagnetometer({ x: 0, y: 30 }, 10)).toBeCloseTo(10, 5);
    // 355° + 10° kiertää ympäri -> 5°
    const near355 = calculateHeadingFromMagnetometer({
      x: Math.sin((5 * Math.PI) / 180) * 30,
      y: Math.cos((5 * Math.PI) / 180) * 30,
    });
    expect(near355).toBeCloseTo(355, 5);
    expect(
      calculateHeadingFromMagnetometer(
        { x: Math.sin((5 * Math.PI) / 180) * 30, y: Math.cos((5 * Math.PI) / 180) * 30 },
        10
      )
    ).toBeCloseTo(5, 5);
  });
});

describe('Kompassi: pehmennys (low-pass), joka ymmärtää 0/360-rajan', () => {
  it('ensimmäinen lukema (ei aiempaa arvoa) palautetaan sellaisenaan', () => {
    expect(smoothHeading(null, 123, 0.2)).toBeCloseTo(123, 5);
  });

  it('liikkuu kohti uutta lukemaa alpha-kertoimen verran', () => {
    // 100 -> 200, alpha 0.25 => 125
    expect(smoothHeading(100, 200, 0.25)).toBeCloseTo(125, 5);
  });

  it('kulkee lyhintä reittiä 0/360-rajan yli (350 -> 10 ei kierrä 180 kautta)', () => {
    // Ero +20°, alpha 0.5 => 360 -> normalisoituna 0
    const result = smoothHeading(350, 10, 0.5);
    expect(result).toBeCloseTo(0, 5);
  });

  it('kulkee lyhintä reittiä myös toiseen suuntaan (10 -> 350)', () => {
    expect(smoothHeading(10, 350, 0.5)).toBeCloseTo(0, 5);
    expect(smoothHeading(10, 350, 0.25)).toBeCloseTo(5, 5);
  });

  it('vaimentaa värinää: toistuvat ±3° heilahtelut pysyvät lähellä keskiarvoa', () => {
    let h: number | null = null;
    const noisy = [90, 93, 87, 93, 87, 93, 87, 93, 87, 93, 87];
    for (const reading of noisy) {
      h = smoothHeading(h, reading, 0.15);
    }
    expect(Math.abs((h as number) - 90)).toBeLessThan(1.5);
  });

  it('alpha rajataan välille (0, 1]', () => {
    expect(smoothHeading(100, 200, 5)).toBeCloseTo(200, 5);
    expect(smoothHeading(100, 200, 0)).toBeCloseTo(100, 5);
  });
});

describe('Katsesuuntakeila (20° sektori, 150 m)', () => {
  const origin = { latitude: 61.05, longitude: 24.05 };

  it('alkaa ja päättyy omaan sijaintiin (suljettu polygoni)', () => {
    const cone = generateViewConeCoordinates(origin, 45);
    expect(cone[0]).toEqual(origin);
    expect(cone[cone.length - 1]).toEqual(origin);
    expect(cone.length).toBeGreaterThanOrEqual(5);
  });

  it('kaaren pisteet ovat oletuksena 150 m päässä', () => {
    const cone = generateViewConeCoordinates(origin, 45);
    const arc = cone.slice(1, -1);
    for (const p of arc) {
      expect(calculateDistanceMeters(origin, p)).toBeCloseTo(150, 0);
    }
  });

  it('keila on 20° leveä ja keskitetty kompassisuuntaan', () => {
    const cone = generateViewConeCoordinates(origin, 45);
    const arc = cone.slice(1, -1);
    expect(calculateBearing(origin, arc[0])).toBeCloseTo(35, 0);
    expect(calculateBearing(origin, arc[arc.length - 1])).toBeCloseTo(55, 0);
  });

  it('kiertää oikein pohjoisen yli (suunta 5° -> 355°...15°)', () => {
    const cone = generateViewConeCoordinates(origin, 5);
    const arc = cone.slice(1, -1);
    expect(calculateBearing(origin, arc[0])).toBeCloseTo(355, 0);
    expect(calculateBearing(origin, arc[arc.length - 1])).toBeCloseTo(15, 0);
    // Kaikki kaaren pisteet pysyvät kapeassa sektorissa eivätkä kierrä täyttä ympyrää
    for (const p of arc) {
      const b = calculateBearing(origin, p);
      const diff = Math.abs(((b - 5 + 540) % 360) - 180);
      expect(diff).toBeLessThanOrEqual(10.5);
    }
  });

  it('hyväksyy mukautetun leveyden ja pituuden', () => {
    const cone = generateViewConeCoordinates(origin, 180, 40, 300);
    const arc = cone.slice(1, -1);
    expect(calculateDistanceMeters(origin, arc[0])).toBeCloseTo(300, 0);
    expect(calculateBearing(origin, arc[0])).toBeCloseTo(160, 0);
    expect(calculateBearing(origin, arc[arc.length - 1])).toBeCloseTo(200, 0);
  });
});

describe('Kartan suuntatila: North-Up / Heading-Up', () => {
  it('North-Up pitää kameran pohjoisessa (heading 0) kompassista riippumatta', () => {
    expect(getCameraHeadingForMode(MapOrientationMode.NORTH_UP, 123)).toBe(0);
  });

  it('Heading-Up kääntää kameran kompassisuuntaan', () => {
    expect(getCameraHeadingForMode(MapOrientationMode.HEADING_UP, 123)).toBeCloseTo(123, 5);
  });

  it('Heading-Up ilman kompassilukemaa pysyy pohjoisessa', () => {
    expect(getCameraHeadingForMode(MapOrientationMode.HEADING_UP, null)).toBe(0);
  });

  it('kytkin vaihtaa tilojen välillä', () => {
    expect(toggleMapOrientationMode(MapOrientationMode.NORTH_UP)).toBe(
      MapOrientationMode.HEADING_UP
    );
    expect(toggleMapOrientationMode(MapOrientationMode.HEADING_UP)).toBe(
      MapOrientationMode.NORTH_UP
    );
  });
});

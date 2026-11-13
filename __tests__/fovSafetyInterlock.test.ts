import { describe, it, expect } from '@jest/globals';
import {
  checkHeadingDangerOverlap,
  shouldTriggerHapticAlert,
  HAPTIC_ALERT_COOLDOWN_MS,
} from '../src/utils/compassHeading';
import { calculateDangerZones, DangerZone } from '../src/utils/safetySector';

// Käsin rakennetut kieltokulmat (±15° naapurin suunnasta)
const northZone: DangerZone = {
  standId: 'p2',
  standName: 'P2 Kallio (Pohjoinen)',
  centerAngle: 0,
  startAngle: 345,
  endAngle: 15,
};
const eastZone: DangerZone = {
  standId: 'p3',
  standName: 'P3 Tiehaara (Itä)',
  centerAngle: 90,
  startAngle: 75,
  endAngle: 105,
};

describe('Katsesuuntakeilan (±10°) ja kieltokulman leikkaus', () => {
  it('suoraan naapuria kohti -> vaara, angleDelta 0', () => {
    const r = checkHeadingDangerOverlap(0, [northZone, eastZone]);
    expect(r.isDanger).toBe(true);
    expect(r.conflictingStandName).toBe('P2 Kallio (Pohjoinen)');
    expect(r.conflictingStandId).toBe('p2');
    expect(r.angleDelta).toBeCloseTo(0, 5);
  });

  it('turvallinen suunta (etelä) -> ei vaaraa', () => {
    const r = checkHeadingDangerOverlap(180, [northZone, eastZone]);
    expect(r.isDanger).toBe(false);
    expect(r.conflictingStandName).toBeUndefined();
  });

  it('keilan reuna riittää: heading 20° -> keila 10..30° leikkaa sektorin 345..15°', () => {
    const r = checkHeadingDangerOverlap(20, [northZone]);
    expect(r.isDanger).toBe(true);
    expect(r.angleDelta).toBeCloseTo(20, 5);
  });

  it('reunat koskettavat (heading 25° -> keila alkaa 15°) -> vaara (turvallisempi tulkinta)', () => {
    expect(checkHeadingDangerOverlap(25, [northZone]).isDanger).toBe(true);
  });

  it('juuri reunan ulkopuolella (heading 25.5°) -> ei vaaraa', () => {
    expect(checkHeadingDangerOverlap(25.5, [northZone]).isDanger).toBe(false);
  });

  it('pohjoisrajan yli toiseen suuntaan: heading 340° (keila 330..350°) -> vaara', () => {
    const r = checkHeadingDangerOverlap(340, [northZone]);
    expect(r.isDanger).toBe(true);
    expect(r.angleDelta).toBeCloseTo(20, 5);
  });

  it('pohjoisrajan molemmin puolin: 359° ja 1° ovat vaarassa, 334° ei', () => {
    expect(checkHeadingDangerOverlap(359, [northZone]).isDanger).toBe(true);
    expect(checkHeadingDangerOverlap(1, [northZone]).isDanger).toBe(true);
    expect(checkHeadingDangerOverlap(334, [northZone]).isDanger).toBe(false);
  });

  it('kieltokulma, joka itse ylittää pohjoisrajan eri kulmasta (350..20°)', () => {
    const zone: DangerZone = { ...northZone, centerAngle: 5, startAngle: 350, endAngle: 20 };
    expect(checkHeadingDangerOverlap(28, [zone]).isDanger).toBe(true); // keila 18..38
    expect(checkHeadingDangerOverlap(31, [zone]).isDanger).toBe(false); // keila 21..41
    expect(checkHeadingDangerOverlap(342, [zone]).isDanger).toBe(true); // keila 332..352
    expect(checkHeadingDangerOverlap(334, [zone]).isDanger).toBe(false); // keila 324..344
  });

  it('valitsee lähimmän naapurin, jos keila osuu useaan sektoriin', () => {
    const nearNorth: DangerZone = {
      standId: 'p9',
      standName: 'P9 Lähellä',
      centerAngle: 30,
      startAngle: 15,
      endAngle: 45,
    };
    const r = checkHeadingDangerOverlap(22, [northZone, nearNorth]);
    expect(r.isDanger).toBe(true);
    expect(r.conflictingStandName).toBe('P9 Lähellä');
    expect(r.angleDelta).toBeCloseTo(8, 5);
  });

  it('ei kieltokulmia -> ei vaaraa', () => {
    expect(checkHeadingDangerOverlap(0, []).isDanger).toBe(false);
  });

  it('toimii calculateDangerZones-tulosten kanssa (oikeat koordinaatit)', () => {
    const me = { id: 'p1', name: 'P1', latitude: 61.05, longitude: 24.05 };
    const east = { id: 'p3', name: 'P3 Tiehaara', latitude: 61.05, longitude: 24.07 };
    const zones = calculateDangerZones(me, [me, east]);
    const r = checkHeadingDangerOverlap(95, zones);
    expect(r.isDanger).toBe(true);
    expect(r.conflictingStandName).toBe('P3 Tiehaara');
    expect(checkHeadingDangerOverlap(270, zones).isDanger).toBe(false);
  });

  it('mukautettu keilan leveys vaikuttaa tunnistukseen', () => {
    // Heading 40°: 20° keila (30..50) ei osu 345..15; 60° keila (10..70) osuu
    expect(checkHeadingDangerOverlap(40, [northZone]).isDanger).toBe(false);
    expect(checkHeadingDangerOverlap(40, [northZone], 60).isDanger).toBe(true);
  });
});

describe('Värinähälytyksen laukaisu (vain siirtymä vaaraan + cooldown)', () => {
  it('cooldown on 2 sekuntia', () => {
    expect(HAPTIC_ALERT_COOLDOWN_MS).toBe(2000);
  });

  it('turvallinen -> vaara ensimmäistä kertaa -> värisee', () => {
    expect(
      shouldTriggerHapticAlert({ wasDanger: false, isDanger: true, lastAlertAtMs: null, nowMs: 1000 })
    ).toBe(true);
  });

  it('pysyy vaarassa -> ei toistuvaa värinää', () => {
    expect(
      shouldTriggerHapticAlert({ wasDanger: true, isDanger: true, lastAlertAtMs: 0, nowMs: 10000 })
    ).toBe(false);
  });

  it('vaara -> turvallinen tai turvallisena pysyminen -> ei värinää', () => {
    expect(
      shouldTriggerHapticAlert({ wasDanger: true, isDanger: false, lastAlertAtMs: 0, nowMs: 10000 })
    ).toBe(false);
    expect(
      shouldTriggerHapticAlert({ wasDanger: false, isDanger: false, lastAlertAtMs: null, nowMs: 10000 })
    ).toBe(false);
  });

  it('rajalla heiluminen: uusi siirtymä vaaraan alle 2 s sisällä -> ei värinää', () => {
    expect(
      shouldTriggerHapticAlert({ wasDanger: false, isDanger: true, lastAlertAtMs: 5000, nowMs: 6500 })
    ).toBe(false);
  });

  it('uusi siirtymä vaaraan cooldownin jälkeen (>= 2 s) -> värisee', () => {
    expect(
      shouldTriggerHapticAlert({ wasDanger: false, isDanger: true, lastAlertAtMs: 5000, nowMs: 7000 })
    ).toBe(true);
  });
});

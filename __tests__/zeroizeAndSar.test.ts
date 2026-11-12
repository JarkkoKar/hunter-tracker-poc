import { describe, it, expect } from '@jest/globals';
import {
  createInitialZeroizeState,
  setZeroizeCoverOpen,
  attemptSlideToZeroize,
  triggerDuressPinZeroize,
} from '../src/utils/zeroizeService';
import {
  compressTrackDelta,
  packSearchSector,
  createPrioritySosAlert,
} from '../src/utils/sarStructures';

describe('Zeroize Emergency Wipe & SAR Tactical Structures', () => {
  it('vaatii suojakannen avaamisen JA >85% liuíun ennen h‰t‰tyhjennyst‰', () => {
    let state = createInitialZeroizeState('SECRET-KEY-999', '9911');

    // 1. Liuku >85% ilman suojakannen avaamista -> estet‰‰n
    const blockedNoCover = attemptSlideToZeroize(state, 95);
    expect(blockedNoCover.wiped).toBe(false);
    expect(blockedNoCover.activeSecretKey).toBe('SECRET-KEY-999');

    // 2. Suojakansi auki, mutta liuku vain 70% -> estet‰‰n
    state = setZeroizeCoverOpen(state, true);
    const blockedShortSlide = attemptSlideToZeroize(state, 70);
    expect(blockedShortSlide.wiped).toBe(false);

    // 3. Suojakansi auki JA liuku 90% (>85%) -> tyhjennys suoritetaan
    const wipedState = attemptSlideToZeroize(state, 90);
    expect(wipedState.wiped).toBe(true);
    expect(wipedState.activeSecretKey).toBe('');
    expect(wipedState.loraRadioCommand).toBe('ADMIN_CMD:ZEROIZE_CHANNEL_PSK');
  });

  it('laukaisee h‰t‰tyhjennyksen v‰littˆm‰sti oikealla Duress PIN -koodilla', () => {
    const state = createInitialZeroizeState('SECRET-KEY-999', '9911');

    const wrongPin = triggerDuressPinZeroize(state, '1234');
    expect(wrongPin.wiped).toBe(false);

    const validDuress = triggerDuressPinZeroize(state, '9911');
    expect(validDuress.wiped).toBe(true);
    expect(validDuress.activeSecretKey).toBe('');
  });

  it('tiivist‰‰ TRACK_DELTA-j‰ljen 3ñ5 pisteen nipuksi (< 60 B)', () => {
    const rawTrack = [
      { latitude: 61.0500, longitude: 24.0500 },
      { latitude: 61.05001, longitude: 24.05001 }, // liian pieni siirtym‰, suodattuu
      { latitude: 61.0510, longitude: 24.0510 },
      { latitude: 61.0520, longitude: 24.0525 },
      { latitude: 61.0535, longitude: 24.0540 },
      { latitude: 61.0550, longitude: 24.0560 },
      { latitude: 61.0565, longitude: 24.0580 },
    ];

    const deltaPacket = compressTrackDelta(12, rawTrack, 25);
    expect(deltaPacket.points.length).toBeGreaterThanOrEqual(3);
    expect(deltaPacket.points.length).toBeLessThanOrEqual(5);
    expect(deltaPacket.binaryFrame.byteLength).toBeLessThan(60);
  });

  it('pakkaa 6ñ8 pisteen SEARCH_SECTOR-etsint‰lohkon ja priorisoidun SOS_ALERT-paketin', () => {
    const sectorVertices = [
      { latitude: 61.05, longitude: 24.04 },
      { latitude: 61.06, longitude: 24.04 },
      { latitude: 61.065, longitude: 24.05 },
      { latitude: 61.06, longitude: 24.06 },
      { latitude: 61.05, longitude: 24.06 },
      { latitude: 61.045, longitude: 24.05 },
    ];

    const sector = packSearchSector('Lohko Alpha', sectorVertices);
    expect(sector.vertices.length).toBe(6);
    expect(sector.binaryFrame.byteLength).toBeLessThanOrEqual(64);

    const sos = createPrioritySosAlert(7, { latitude: 61.052, longitude: 24.053 });
    expect(sos.overrideSilentMode).toBe(true);
    expect(sos.lockSenderOnMap).toBe(true);
    expect(sos.binaryFrame.byteLength).toBeLessThan(60);
  });
});

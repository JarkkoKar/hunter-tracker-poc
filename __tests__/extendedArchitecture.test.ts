import { describe, it, expect } from '@jest/globals';
import {
  ActiveProfile,
  getProfileConfig,
  formatCoordinatesForProfile,
} from '../src/utils/profileEngine';
import {
  RadioTxMode,
  createInitialEmconState,
  setRadioTxMode,
  canTransmitPacket,
} from '../src/utils/emconState';

describe('Extended Architecture: Profile Engine & EMCON State', () => {
  it('palauttaa oikeat profiiliasetukset HUNTER-, SAR- ja TACTICAL-profiileille', () => {
    const hunter = getProfileConfig(ActiveProfile.HUNTER);
    const sar = getProfileConfig(ActiveProfile.SAR);
    const tactical = getProfileConfig(ActiveProfile.TACTICAL);

    expect(hunter.coordinateSystem).toBe('WGS84');
    expect(hunter.accentColor).toBe('#4CAF50');

    expect(sar.coordinateSystem).toBe('WGS84');
    expect(sar.accentColor).toBe('#FF9800');

    expect(tactical.coordinateSystem).toBe('MGRS');
    expect(tactical.accentColor).toBe('#00BCD4');
  });

  it('muotoilee koordinaatit profiilin mukaisesti (WGS84 vs MGRS)', () => {
    const coords = { latitude: 61.05, longitude: 24.05 };

    const wgsText = formatCoordinatesForProfile(coords, ActiveProfile.HUNTER);
    const mgrsText = formatCoordinatesForProfile(coords, ActiveProfile.TACTICAL);

    expect(wgsText).toContain('61.05000');
    expect(wgsText).toContain('24.05000');
    expect(mgrsText).toMatch(/^35V/); // Suomi Etel‰-Suomi 35V-ruudukossa
  });

  it('est‰‰ kaiken l‰hetyksen RX_ONLY-tilassa ja sallii sen NORMAL-tilassa', () => {
    let state = createInitialEmconState();
    expect(state.mode).toBe(RadioTxMode.NORMAL);
    expect(canTransmitPacket(state)).toBe(true);

    // Siirryt‰‰n radiohiljaisuuteen (RX_ONLY)
    state = setRadioTxMode(state, RadioTxMode.RX_ONLY, false);
    expect(state.mode).toBe(RadioTxMode.RX_ONLY);
    expect(canTransmitPacket(state)).toBe(false);

    // Yritet‰‰n palata NORMAL-tilaan ilman vahvistusta (pit‰‰ esty‰)
    const unconfirmedAttempt = setRadioTxMode(state, RadioTxMode.NORMAL, false);
    expect(unconfirmedAttempt.mode).toBe(RadioTxMode.RX_ONLY);

    // Palataan NORMAL-tilaan tietoisella vahvistuksella (Slide / 2s hold)
    const confirmedAttempt = setRadioTxMode(state, RadioTxMode.NORMAL, true);
    expect(confirmedAttempt.mode).toBe(RadioTxMode.NORMAL);
    expect(canTransmitPacket(confirmedAttempt)).toBe(true);
  });
});

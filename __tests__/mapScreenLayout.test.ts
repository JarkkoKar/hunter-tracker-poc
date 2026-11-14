import { describe, it, expect } from '@jest/globals';
import {
  PRIMARY_BUTTON_MIN_HEIGHT,
  MAP_SCREEN_LAYERS,
  getBottomPanelState,
  shouldShowHeadingWarning,
  toggleSheet,
  formatGpsAccuracy,
  formatAreaSummary,
  formatRadioStatus,
  formatHeadingStatus,
} from '../src/utils/mapScreenLayout';

describe('PRIMARY_BUTTON_MIN_HEIGHT', () => {
  it('VALMIS- ja LAUKAUS-painikkeet ovat vähintään 58 px korkeat', () => {
    expect(PRIMARY_BUTTON_MIN_HEIGHT).toBeGreaterThanOrEqual(58);
  });
});

describe('getBottomPanelState', () => {
  it('ilman passia VALMIS ja LAUKAUS ovat pois käytöstä ja kehotetaan valitsemaan passi', () => {
    const s = getBottomPanelState('NOT_IN_STAND', true);
    expect(s.readyEnabled).toBe(false);
    expect(s.shotEnabled).toBe(false);
    expect(s.showOutcomeChoices).toBe(false);
    expect(s.hint).toMatch(/passi/i);
  });

  it('passissa VALMIS on käytössä, LAUKAUS ei', () => {
    const s = getBottomPanelState('IN_STAND', true);
    expect(s.readyEnabled).toBe(true);
    expect(s.readyIsReturn).toBe(false);
    expect(s.shotEnabled).toBe(false);
  });

  it('valmiina LAUKAUS on käytössä, VALMIS ei', () => {
    const s = getBottomPanelState('READY', true);
    expect(s.readyEnabled).toBe(false);
    expect(s.shotEnabled).toBe(true);
    expect(s.showOutcomeChoices).toBe(false);
  });

  it('laukauksen jälkeen näytetään tulosvalinta ja peruutus', () => {
    const s = getBottomPanelState('SHOT_FIRED', true);
    expect(s.showOutcomeChoices).toBe(true);
    expect(s.outcomeEnabled).toBe(true);
    expect(s.cancelEnabled).toBe(true);
    expect(s.readyEnabled).toBe(false);
    expect(s.shotEnabled).toBe(false);
  });

  it.each(['HARVEST', 'WOUNDED'] as const)(
    'tilassa %s VALMIS toimii paluuna valmiuteen',
    (status) => {
      const s = getBottomPanelState(status, true);
      expect(s.readyEnabled).toBe(true);
      expect(s.readyIsReturn).toBe(true);
      expect(s.shotEnabled).toBe(false);
    }
  );

  it('RX_ONLY estää kaikki lähettävät painikkeet, mutta peruutus toimii', () => {
    const ready = getBottomPanelState('IN_STAND', false);
    expect(ready.readyEnabled).toBe(false);
    const shot = getBottomPanelState('READY', false);
    expect(shot.shotEnabled).toBe(false);
    const outcome = getBottomPanelState('SHOT_FIRED', false);
    expect(outcome.showOutcomeChoices).toBe(true);
    expect(outcome.outcomeEnabled).toBe(false);
    expect(outcome.cancelEnabled).toBe(true);
    expect(outcome.hint).toMatch(/RX_ONLY/);
  });
});

describe('shouldShowHeadingWarning ja kerrosjärjestys', () => {
  it('varoitus näkyy aina vaaratilanteessa, vaikka paneeli olisi auki', () => {
    expect(shouldShowHeadingWarning(true, null)).toBe(true);
    expect(shouldShowHeadingWarning(true, 'MORE')).toBe(true);
    expect(shouldShowHeadingWarning(true, 'AREA')).toBe(true);
    expect(shouldShowHeadingWarning(false, null)).toBe(false);
    expect(shouldShowHeadingWarning(false, 'RADIO')).toBe(false);
  });

  it('suuntavaroitus on ylimpänä kerroksena kaikkien paneelien päällä', () => {
    const others = Object.entries(MAP_SCREEN_LAYERS)
      .filter(([k]) => k !== 'headingWarning')
      .map(([, v]) => v);
    expect(MAP_SCREEN_LAYERS.headingWarning).toBeGreaterThan(Math.max(...others));
  });

  it('kartta on alimpana kerroksena', () => {
    const others = Object.entries(MAP_SCREEN_LAYERS)
      .filter(([k]) => k !== 'map')
      .map(([, v]) => v);
    expect(MAP_SCREEN_LAYERS.map).toBeLessThan(Math.min(...others));
  });
});

describe('toggleSheet', () => {
  it('avaa pyydetyn paneelin', () => {
    expect(toggleSheet(null, 'AREA')).toBe('AREA');
  });
  it('saman painikkeen uusi painallus sulkee paneelin', () => {
    expect(toggleSheet('RADIO', 'RADIO')).toBeNull();
  });
  it('toinen pikavalinta vaihtaa paneelin', () => {
    expect(toggleSheet('AREA', 'MORE')).toBe('MORE');
  });
});

describe('formatGpsAccuracy', () => {
  it('pyöristää tarkkuuden metreiksi', () => {
    expect(formatGpsAccuracy(4.6)).toBe('±5 m');
  });
  it('näyttää viivat, kun tarkkuutta ei ole', () => {
    expect(formatGpsAccuracy(null)).toBe('±-- m');
    expect(formatGpsAccuracy(undefined)).toBe('±-- m');
    expect(formatGpsAccuracy(Number.NaN)).toBe('±-- m');
  });
});

describe('formatAreaSummary', () => {
  it('näyttää alueen nimen ja palstamäärän', () => {
    expect(formatAreaSummary('Hätilä', 3)).toBe('Hätilä · 3 palstaa');
  });
  it('yksikkö yhdelle palstalle', () => {
    expect(formatAreaSummary('Testi', 1)).toBe('Testi · 1 palsta');
  });
  it('käyttää oletusnimeä, jos nimi puuttuu', () => {
    expect(formatAreaSummary(undefined, 0)).toBe('Alue 1 · 0 palstaa');
    expect(formatAreaSummary('  ', 2)).toBe('Alue 1 · 2 palstaa');
  });
});

describe('formatRadioStatus', () => {
  it('normaalitilassa näyttää siirtotien ja ok-tason', () => {
    const r = formatRadioStatus('CELLULAR_IP', 'NORMAL', true);
    expect(r.label).toBe('4G/5G');
    expect(r.level).toBe('ok');
  });
  it('USB-LoRa näytetään lyhyesti', () => {
    expect(formatRadioStatus('LORA_USB_SERIAL', 'NORMAL', false).label).toBe('LoRa USB');
    expect(formatRadioStatus('LORA_MESH_BLE', 'NORMAL', false).label).toBe('LoRa BLE');
  });
  it('katve ilman radiota on varoitus', () => {
    const r = formatRadioStatus('NONE', 'NORMAL', false);
    expect(r.label).toBe('EI YHTEYTTÄ');
    expect(r.level).toBe('warn');
  });
  it('RX_ONLY näkyy hiljaisuutena', () => {
    const r = formatRadioStatus('CELLULAR_IP', 'RX_ONLY', true);
    expect(r.label).toBe('4G/5G · RX_ONLY');
    expect(r.level).toBe('silent');
  });
  it('BURST_MANUAL näkyy tunnisteena', () => {
    expect(formatRadioStatus('LORA_MESH_BLE', 'BURST_MANUAL', false).label).toBe(
      'LoRa BLE · BURST'
    );
  });
});

describe('formatHeadingStatus', () => {
  it('vaarassa näyttää naapuripassin', () => {
    const h = formatHeadingStatus({ isDanger: true, conflictingStandName: 'P3 Suo' }, true, 120);
    expect(h.level).toBe('danger');
    expect(h.label).toBe('SUUNTA: VAARA (P3 Suo)');
  });
  it('turvallinen suunta asteina', () => {
    const h = formatHeadingStatus({ isDanger: false }, true, 359.6);
    expect(h.level).toBe('ok');
    expect(h.label).toBe('SUUNTA OK 0°');
  });
  it('ilman kompassia kertoo sen', () => {
    expect(formatHeadingStatus({ isDanger: false }, false, null).label).toBe('Kompassi N/A');
    expect(formatHeadingStatus({ isDanger: false }, null, null).label).toBe('SUUNTA ---');
  });
});

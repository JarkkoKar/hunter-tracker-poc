import { describe, it, expect } from '@jest/globals';
import {
  MORE_PANEL_SECTIONS,
  getMorePanelFocusSection,
  getMorePanelScrollOffset,
  getMapLayerSegments,
  getEmconSegments,
  EMCON_UNLOCK_LONG_PRESS_MS,
} from '../src/utils/morePanel';
import { RadioTxMode } from '../src/utils/emconState';

describe('Lisää-paneelin osiot (#61)', () => {
  it('pääosiot ovat luonnoksen järjestyksessä', () => {
    expect(MORE_PANEL_SECTIONS.slice(0, 5)).toEqual([
      'AREA',
      'MAP_LAYER',
      'RADIO',
      'PROFILE',
      'ZEROIZE',
    ]);
  });

  it('SAR- ja GPS-testaustoiminnot ovat paneelin lopussa', () => {
    const n = MORE_PANEL_SECTIONS.length;
    expect(MORE_PANEL_SECTIONS.slice(n - 2)).toEqual(['SAR', 'GPS_TEST']);
  });

  it('sektoriturvallisuus säilyy paneelissa', () => {
    expect(MORE_PANEL_SECTIONS).toContain('SECTOR_SAFETY');
  });

  it('osiot ovat yksilöllisiä', () => {
    expect(new Set(MORE_PANEL_SECTIONS).size).toBe(MORE_PANEL_SECTIONS.length);
  });
});

describe('getMorePanelFocusSection', () => {
  it('Alue-pikavalinta avaa jahtialueen kohdalta', () => {
    expect(getMorePanelFocusSection('AREA')).toBe('AREA');
  });

  it('Radio-pikavalinta avaa radio-osion kohdalta', () => {
    expect(getMorePanelFocusSection('RADIO')).toBe('RADIO');
  });

  it('Lisää avaa paneelin alusta', () => {
    expect(getMorePanelFocusSection('MORE')).toBeNull();
  });

  it('suljettu paneeli ei kohdista mihinkään', () => {
    expect(getMorePanelFocusSection(null)).toBeNull();
  });
});

describe('getMorePanelScrollOffset', () => {
  it('ilman kohdeosiota vieritetään alkuun', () => {
    expect(getMorePanelScrollOffset({ RADIO: 420 }, null)).toBe(0);
  });

  it('mitattu osio palauttaa sen y-sijainnin', () => {
    expect(getMorePanelScrollOffset({ AREA: 0, RADIO: 420 }, 'RADIO')).toBe(420);
  });

  it('mittaamaton osio palauttaa null (odotetaan asettelua)', () => {
    expect(getMorePanelScrollOffset({}, 'RADIO')).toBeNull();
  });

  it('negatiivinen tai virheellinen mittaus ei vieritä ohi alun', () => {
    expect(getMorePanelScrollOffset({ RADIO: -5 }, 'RADIO')).toBe(0);
    expect(getMorePanelScrollOffset({ RADIO: Number.NaN }, 'RADIO')).toBeNull();
  });
});

describe('getMapLayerSegments', () => {
  it('kolme vaihtoehtoa luonnoksen nimillä ja järjestyksessä', () => {
    const segs = getMapLayerSegments('opentopomap', 'avain');
    expect(segs.map((s) => s.label)).toEqual(['OpenTopoMap', 'MML Maasto', 'Offline']);
    expect(segs.map((s) => s.id)).toEqual(['opentopomap', 'mml-maastokartta', 'offline']);
  });

  it('valittu taso on merkitty', () => {
    const segs = getMapLayerSegments('offline', 'avain');
    expect(segs.filter((s) => s.selected).map((s) => s.id)).toEqual(['offline']);
  });

  it('MML on näkyvissä mutta pois käytöstä ilman API-avainta', () => {
    const segs = getMapLayerSegments('opentopomap', undefined);
    const mml = segs.find((s) => s.id === 'mml-maastokartta');
    expect(mml).toBeDefined();
    expect(mml!.enabled).toBe(false);
    expect(segs.find((s) => s.id === 'opentopomap')!.enabled).toBe(true);
    expect(segs.find((s) => s.id === 'offline')!.enabled).toBe(true);
  });

  it('tyhjä avain tulkitaan puuttuvaksi', () => {
    const segs = getMapLayerSegments('opentopomap', '   ');
    expect(segs.find((s) => s.id === 'mml-maastokartta')!.enabled).toBe(false);
  });

  it('MML on käytössä avaimen kanssa', () => {
    const segs = getMapLayerSegments('opentopomap', 'avain');
    expect(segs.every((s) => s.enabled)).toBe(true);
  });
});

describe('getEmconSegments', () => {
  it('kolme tilaa: NORMAL, BURST, RX_ONLY', () => {
    const segs = getEmconSegments(RadioTxMode.NORMAL);
    expect(segs.map((s) => s.mode)).toEqual([
      RadioTxMode.NORMAL,
      RadioTxMode.BURST_MANUAL,
      RadioTxMode.RX_ONLY,
    ]);
    expect(segs.map((s) => s.label)).toEqual(['NORMAL', 'BURST', 'RX_ONLY']);
  });

  it('nykyinen tila on valittuna', () => {
    const segs = getEmconSegments(RadioTxMode.BURST_MANUAL);
    expect(segs.filter((s) => s.selected).map((s) => s.mode)).toEqual([
      RadioTxMode.BURST_MANUAL,
    ]);
  });

  it('lähetystiloissa mikään valinta ei vaadi pitkää painallusta', () => {
    for (const mode of [RadioTxMode.NORMAL, RadioTxMode.BURST_MANUAL]) {
      expect(getEmconSegments(mode).some((s) => s.requiresLongPress)).toBe(false);
    }
  });

  it('RX_ONLY-tilasta poistuminen vaatii pitkän painalluksen', () => {
    const segs = getEmconSegments(RadioTxMode.RX_ONLY);
    expect(segs.find((s) => s.mode === RadioTxMode.NORMAL)!.requiresLongPress).toBe(true);
    expect(segs.find((s) => s.mode === RadioTxMode.BURST_MANUAL)!.requiresLongPress).toBe(true);
    expect(segs.find((s) => s.mode === RadioTxMode.RX_ONLY)!.requiresLongPress).toBe(false);
  });

  it('pitkän painalluksen kesto on sama kuin ennen (2 s)', () => {
    expect(EMCON_UNLOCK_LONG_PRESS_MS).toBe(2000);
  });
});
